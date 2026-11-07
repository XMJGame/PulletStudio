import { HttpException, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { addAbortSignal } from 'node:stream';
import { CurrentUser } from '../common/http';
import { DatabaseService } from '../db/database.service';
import { generationJobs, mediaUploads, users } from '../db/schema';
import { ProductionService } from '../production/production.service';
import { MediaService } from '../assets/media.service';
import { AppConfig } from '../config';
import { GenerationError } from './comfy-provider';
import { modelScopeImage, modelScopeResult } from './modelscope-provider';
import { GenerationService, GenerationSnapshot, Job } from './generation.service';
import { resultDescriptor, WorkflowInput, type ReferenceMediaType } from './generation-contract';
import { mediaDisconnectTargets, supportsReferenceMedia } from './workflow-media';
import { checkReservedInstance, instanceLoad, jobRoute, type JobRoute } from './generation-routing';

const leaseMs = 45_000;
const pollMs = 3000;
const jobTimeout = 60 * 60 * 1000;

@Injectable()
export class GenerationWorker {
  constructor(
    private readonly database: DatabaseService,
    private readonly jobs: GenerationService,
    private readonly media: MediaService,
    private readonly production: ProductionService,
    private readonly config: AppConfig,
  ) {}

  private claim() {
    return this.database.db.transaction(
      () => {
        const now = Date.now(),
          updatedAt = new Date(now).toISOString();
        this.database.db
          .update(generationJobs)
          .set({
            state: 'needs_reconciliation',
            leaseId: null,
            leaseUntil: null,
            errorCode: 'SUBMISSION_UNCERTAIN',
            updatedAt,
          })
          .where(and(eq(generationJobs.state, 'submitting'), lte(generationJobs.leaseUntil, now)))
          .run();
        const row = this.database.db
          .select()
          .from(generationJobs)
          .where(
            and(
              inArray(generationJobs.state, ['queued', 'preparing', 'submitted', 'fetching']),
              lte(generationJobs.nextAt, now),
              or(isNull(generationJobs.leaseUntil), lte(generationJobs.leaseUntil, now)),
            ),
          )
          .orderBy(asc(generationJobs.nextAt), asc(generationJobs.id))
          .limit(1)
          .get();
        if (!row) return null;
        const route = jobRoute(this.database, row.id);
        if (route && row.state === 'queued') {
          const connection = this.jobs.connection(route.connectionId, row.workspaceId);
          if (
            connection.version === row.connectionVersion &&
            checkReservedInstance(this.database, connection, row.workflowId, route) &&
            instanceLoad(this.database, connection.id).running >= connection.maxRunning
          ) {
            this.database.db
              .update(generationJobs)
              .set({
                nextAt: now + pollMs,
                errorCode: 'INSTANCE_WAITING',
                updatedAt,
              })
              .where(eq(generationJobs.id, row.id))
              .run();
            return null;
          }
        }
        const snapshot = JSON.parse(row.snapshotJson) as GenerationSnapshot;
        const referenceImages = Array.isArray(snapshot.referenceImages);
        const workflow = this.jobs.workflow(row.workflowId);
        const apiImage =
          this.jobs.connection(workflow.connectionId, row.workspaceId).provider === 'modelscope';
        const leaseId = apiImage
          ? `free:api-v1:${randomUUID()}`
          : snapshot.referenceMedia
            ? `${route ? 'pool:' : ''}free:media-v1:disconnect:multimodal:${randomUUID()}`
            : referenceImages
              ? `${route ? 'pool:' : ''}free:media-v1:${snapshot.optionalReferenceImages ? 'disconnect:' : ''}${randomUUID()}`
              : route
                ? `${row.shotId ? 'pool:' : 'pool:free:'}${randomUUID()}`
                : row.shotId
                  ? randomUUID()
                  : `free:${randomUUID()}`;
        return this.database.db
          .update(generationJobs)
          .set({
            leaseId: leaseId + (snapshot.optionalReferenceMedia || snapshot.audioOutput ? ':b4' : ''),
            leaseUntil: now + leaseMs,
            state: row.state === 'queued' ? 'preparing' : row.state,
            updatedAt,
          })
          .where(eq(generationJobs.id, row.id))
          .returning()
          .get()!;
      },
      { behavior: 'immediate' },
    );
  }
  private owns(job: Job) {
    const row = this.database.db.select().from(generationJobs).where(eq(generationJobs.id, job.id)).get();
    if (!row || row.leaseId !== job.leaseId || (row.leaseUntil ?? 0) <= Date.now())
      throw new GenerationError('LEASE_LOST');
    return row;
  }
  private update(job: Job, changes: Partial<Job>) {
    this.owns(job);
    this.database.db
      .update(generationJobs)
      .set({ ...changes, updatedAt: new Date().toISOString() })
      .where(and(eq(generationJobs.id, job.id), eq(generationJobs.leaseId, job.leaseId!)))
      .run();
  }
  private release(job: Job, changes: Partial<Job>) {
    this.update(job, { ...changes, leaseId: null, leaseUntil: null });
  }
  private actor(job: Job): CurrentUser {
    const row = this.database.db
      .select({ id: users.id, email: users.email, name: users.name, instanceAdmin: users.instanceAdmin })
      .from(users)
      .where(eq(users.id, job.creatorId))
      .get();
    if (!row) throw new GenerationError('CREATOR_UNAVAILABLE');
    return row;
  }
  private checkInputs(
    user: CurrentUser,
    job: Job,
    connectionId: string,
    snapshot: GenerationSnapshot,
    route?: JobRoute,
  ) {
    this.owns(job);
    if (job.purpose === 'workflow_test') this.jobs.manage(user, job.workspaceId);
    const connection = this.jobs.connection(connectionId, job.workspaceId);
    if (
      (job.shotId !== null &&
        (this.production.shot(user, job.shotId, 'edit').version !== job.shotVersion ||
          this.production.project(user, job.projectId).version !== job.projectVersion)) ||
      connection.version !== job.connectionVersion
    )
      throw new GenerationError('GENERATION_INPUT_CHANGED');
    if (route && !checkReservedInstance(this.database, connection, job.workflowId, route))
      throw new GenerationError('INSTANCE_CHECK_EXPIRED');
    this.jobs.authorizeCreation(user, job.projectId);
    if (snapshot.referenceImages || snapshot.referenceMedia) {
      const references = snapshot.referenceMedia ?? snapshot.referenceImages ?? [];
      for (const media of [...references, ...(snapshot.image ? [snapshot.image] : [])]) {
        const type = 'mediaType' in media ? (media.mediaType as ReferenceMediaType) : 'image';
        const current = this.jobs.referenceMedia(user, job.projectId, media.id, type);
        if (current.sha256 !== media.sha256 || current.bytes !== media.bytes || current.mime !== media.mime)
          throw new GenerationError(type === 'image' ? 'REFERENCE_IMAGE_INVALID' : 'REFERENCE_MEDIA_INVALID');
      }
    }
    if (
      job.shotId &&
      JSON.stringify(this.jobs.approvals(user, job.shotId)) !== JSON.stringify(snapshot.approvals)
    )
      throw new GenerationError('GENERATION_APPROVAL_CHANGED');
  }
  private async readReference(
    user: CurrentUser,
    media: NonNullable<GenerationSnapshot['image']>,
    signal: AbortSignal,
    type: ReferenceMediaType = 'image',
  ) {
    const code = type === 'image' ? 'REFERENCE_IMAGE_INVALID' : 'REFERENCE_MEDIA_INVALID';
    const file = await this.media.content(user, media.id, false);
    try {
      if (file.total !== media.bytes || file.sha256 !== media.sha256 || file.mime !== media.mime)
        throw new GenerationError(code);
      const chunks: Buffer[] = [];
      const hash = createHash('sha256');
      let size = 0;
      for await (const chunk of addAbortSignal(signal, file.stream)) {
        size += chunk.length;
        if (size > media.bytes) throw new GenerationError(code);
        hash.update(chunk);
        chunks.push(chunk);
      }
      if (size !== media.bytes || hash.digest('hex') !== media.sha256) throw new GenerationError(code);
      return Buffer.concat(chunks, size);
    } finally {
      file.stream.destroy();
    }
  }
  async tick() {
    const job = this.claim();
    if (!job) return false;
    const controller = new AbortController();
    const heartbeat = setInterval(() => {
      try {
        this.update(job, { leaseUntil: Date.now() + leaseMs });
      } catch {
        controller.abort();
      }
    }, 5000);
    try {
      await this.process(job, controller.signal);
    } catch (error) {
      let current: Job;
      try {
        current = this.owns(job);
      } catch {
        return true;
      }
      const code =
        error instanceof GenerationError
          ? error.code
          : error instanceof HttpException
            ? ((error.getResponse() as { code?: string }).code ?? 'GENERATION_ACCESS_CHANGED')
            : 'GENERATION_PROCESS_FAILED';
      if (current.state === 'submitting') {
        if (
          [
            'COMFY_REQUEST_REJECTED',
            'MODELSCOPE_REQUEST_REJECTED',
            'MODELSCOPE_ACCOUNT_BINDING_REQUIRED',
            'MODELSCOPE_RATE_LIMIT',
          ].includes(code)
        )
          this.release(job, { state: 'failed', errorCode: code });
        else this.release(job, { state: 'needs_reconciliation', errorCode: 'SUBMISSION_UNCERTAIN' });
      } else if (current.state === 'preparing') this.release(job, { state: 'failed', errorCode: code });
      else if (
        current.state === 'submitted' &&
        [
          'COMFY_CONNECTION_FAILED',
          'COMFY_HTTP_ERROR',
          'COMFY_RATE_LIMIT',
          'MODELSCOPE_NETWORK',
          'MODELSCOPE_HTTP_ERROR',
          'MODELSCOPE_RATE_LIMIT',
        ].includes(code) &&
        (current.deadline ?? 0) > Date.now()
      )
        this.release(job, { nextAt: Date.now() + 10000, errorCode: code });
      else this.release(job, { state: 'needs_reconciliation', errorCode: code });
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }
  private async process(job: Job, signal: AbortSignal) {
    const user = this.actor(job),
      shot = job.shotId ? this.production.shot(user, job.shotId, 'edit') : null;
    this.jobs.authorizeCreation(user, job.projectId);
    const workflow = this.jobs.workflow(job.workflowId),
      definition = JSON.parse(workflow.definitionJson) as WorkflowInput;
    const route = jobRoute(this.database, job.id);
    const connection = this.jobs.connection(route?.connectionId ?? workflow.connectionId, job.workspaceId);
    if (!connection.enabled) throw new GenerationError('CONNECTION_DISABLED');
    const apiImage = connection.provider === 'modelscope';
    if (apiImage && connection.version !== job.connectionVersion)
      throw new GenerationError('GENERATION_INPUT_CHANGED');
    if (apiImage && job.state === 'preparing') {
      const snapshot = JSON.parse(job.snapshotJson) as GenerationSnapshot;
      const prompt = snapshot.prompt?.positivePrompt;
      const model = snapshot.graph['1']?.inputs.model;
      if (!prompt || model !== modelScopeImage) throw new GenerationError('MODELSCOPE_INPUT_UNSUPPORTED');
      if (!(await this.media.status(user, job.projectId)).available)
        throw new GenerationError('MEDIA_NOT_READY');
      const token = this.database.db.transaction(
        () => {
          this.checkInputs(user, job, connection.id, snapshot);
          const credential = this.jobs.modelScopeToken(
            this.jobs.connection(connection.id),
            job.connectionVersion,
          );
          this.update(job, { state: 'submitting' });
          return credential;
        },
        { behavior: 'immediate' },
      );
      const remoteId = await this.jobs.modelScope.submit(token, model, prompt, signal);
      this.release(job, {
        state: 'submitted',
        remoteId,
        deadline: Date.now() + jobTimeout,
        nextAt: Date.now(),
        errorCode: null,
      });
      return;
    }
    if (job.state === 'preparing') {
      const snapshot = JSON.parse(job.snapshotJson) as GenerationSnapshot;
      const slots = definition.mediaSchema?.inputs ?? [];
      const references =
        snapshot.referenceMedia ??
        snapshot.referenceImages?.map((item) => ({ ...item, mediaType: 'image' as const })) ??
        [];
      const referencesBySlot = new Map(references.map((reference) => [reference.slotId, reference]));
      const selectedSlots = slots.filter((slot) => referencesBySlot.has(slot.id));
      if (
        (slots.length > 0 || (definition.mediaSchema?.outputs.length ?? 0) > 0 || references.length > 0) &&
        (!supportsReferenceMedia(definition.mediaSchema) ||
          selectedSlots.length !== references.length ||
          selectedSlots.some(
            (slot, index) =>
              slot.id !== references[index].slotId || slot.mediaType !== references[index].mediaType,
          ) ||
          slots.some((slot) => slot.mediaType !== 'image') !== Boolean(snapshot.referenceMedia) ||
          slots.some((slot) => slot.mediaType !== 'image' && slot.onMissing === 'disconnect') !==
            Boolean(snapshot.optionalReferenceMedia) ||
          slots.some((slot) => slot.required && !referencesBySlot.has(slot.id)) ||
          slots.some((slot) => slot.onMissing === 'disconnect') !== Boolean(snapshot.optionalReferenceImages))
      )
        throw new GenerationError('WORKFLOW_MEDIA_UNSUPPORTED');
      if ((definition.capability === 'audio.music') !== Boolean(snapshot.audioOutput))
        throw new GenerationError('WORKFLOW_MEDIA_UNSUPPORTED');
      if (route)
        this.database.db.transaction(() => this.checkInputs(user, job, connection.id, snapshot, route));
      const storage = await this.media.status(user, job.projectId);
      if (!storage.available) throw new GenerationError('MEDIA_NOT_READY');
      const provider = await this.jobs.provider(connection);
      await provider.probe(signal);
      if (route) {
        const load = await provider.queueStatus(signal);
        if (load.running >= connection.maxRunning || load.pending >= connection.maxPending) {
          this.release(job, { state: 'queued', nextAt: Date.now() + pollMs, errorCode: 'INSTANCE_WAITING' });
          return;
        }
      }
      if (!shot || route || definition.fields?.length)
        await provider.validate({ ...definition, graph: snapshot.graph });
      if (definition.image) {
        if (!snapshot.image) throw new GenerationError('REFERENCE_IMAGE_INVALID');
        const image = await this.readReference(user, snapshot.image, signal);
        this.database.db.transaction(() => this.checkInputs(user, job, connection.id, snapshot, route));
        const path = await provider.uploadMedia(job.id, snapshot.image.mime, image, signal);
        snapshot.graph[definition.image.node].inputs[definition.image.input] = path;
      }
      for (const slot of slots) {
        const image = referencesBySlot.get(slot.id);
        if (!image) {
          for (const target of mediaDisconnectTargets(snapshot.graph, slot.node))
            delete snapshot.graph[target.node].inputs[target.input];
          delete snapshot.graph[slot.node];
          continue;
        }
        const bytes = await this.readReference(user, image, signal, slot.mediaType);
        this.database.db.transaction(() => this.checkInputs(user, job, connection.id, snapshot, route));
        snapshot.graph[slot.node].inputs[slot.input] = await provider.uploadMedia(
          job.id,
          image.mime,
          bytes,
          signal,
          slot.id,
          slot.mediaType,
        );
      }
      this.database.db.transaction(
        () => {
          this.checkInputs(user, job, connection.id, snapshot, route);
          this.update(job, { state: 'submitting' });
        },
        { behavior: 'immediate' },
      );
      const remoteId = await provider.submit(job.id, snapshot.graph, signal);
      this.release(job, {
        state: 'submitted',
        remoteId,
        deadline: Date.now() + jobTimeout,
        nextAt: Date.now(),
        errorCode: null,
      });
      return;
    }
    if (job.state === 'submitted') {
      const candidate =
        job.remoteId ?? (job.resultJson ? JSON.parse(job.resultJson).candidateRemoteId : undefined) ?? job.id;
      if (apiImage && !job.remoteId) throw new GenerationError('SUBMISSION_UNCERTAIN');
      const result = apiImage
        ? await this.jobs.modelScope.observe(
            this.jobs.modelScopeToken(connection, job.connectionVersion),
            candidate,
            signal,
          )
        : await (
            await this.jobs.provider(connection)
          ).observe(candidate, job.id, definition, !job.remoteId, signal);
      if (result.state === 'pending') {
        const expired = (job.deadline ?? 0) <= Date.now();
        this.release(job, {
          state: expired ? 'needs_reconciliation' : 'submitted',
          nextAt: Date.now() + pollMs,
          errorCode: expired ? (apiImage ? 'MODELSCOPE_TASK_PENDING' : 'COMFY_HISTORY_PENDING') : null,
        });
      } else if (result.state === 'failed') {
        this.release(job, {
          state: 'failed',
          remoteId: candidate,
          errorCode: apiImage ? 'MODELSCOPE_EXECUTION_FAILED' : 'COMFY_EXECUTION_FAILED',
        });
      } else if (result.state === 'ready') {
        this.release(job, {
          state: 'fetching',
          remoteId: candidate,
          resultJson: JSON.stringify(result.result),
          nextAt: Date.now(),
          errorCode: null,
        });
      }
      return;
    }
    if (job.state !== 'fetching') return;
    const storedResult = JSON.parse(job.resultJson!);
    const result = apiImage ? modelScopeResult.parse(storedResult) : resultDescriptor.parse(storedResult);
    const mediaType =
      workflow.capability === 'image.text_to_image'
        ? 'image'
        : workflow.capability === 'audio.music'
          ? 'audio'
          : 'video';
    const reserved = this.database.db
      .select({ id: mediaUploads.id })
      .from(mediaUploads)
      .where(eq(mediaUploads.generationJobId, job.id))
      .get();
    let upload = reserved ? await this.media.upload(user, reserved.id) : null;
    if (upload?.state === 'needs_reconciliation')
      upload = await this.media.reconcile(user, upload.id, job.id);
    if (upload?.state !== 'complete') {
      if (upload?.state === 'uploading') {
        this.release(job, { nextAt: Date.now() + 10000 });
        return;
      }
      const download =
        'url' in result
          ? await this.jobs.modelScope.download(result, this.config.mediaMaxBytes, signal)
          : {
              ...(await (
                await this.jobs.provider(connection)
              ).download(result, this.config.mediaMaxBytes, signal)),
              fileName: result.filename,
            };
      try {
        this.owns(job);
        upload = await this.media.initiate(
          user,
          job.projectId,
          {
            fileName: download.fileName,
            byteLength: download.length,
            assetId: null,
            expectedAssetVersion: 0,
            contentType: '',
          },
          `generation:${job.id}`,
          job.id,
        );
        upload = await this.media.receive(user, upload.id, download.body, String(download.length), {
          jobId: job.id,
          mediaType,
          signal,
        });
      } finally {
        download.body.destroy();
      }
    }
    if (!upload?.mediaVersion || upload.mediaVersion.mediaType !== mediaType)
      throw new GenerationError('GENERATION_OUTPUT_INVALID');
    const mediaVersionId = upload.mediaVersion.id;
    this.database.db.transaction(
      () => {
        this.owns(job);
        const currentConnection = this.jobs.connection(connection.id);
        if (!currentConnection.enabled) throw new GenerationError('CONNECTION_DISABLED');
        if (apiImage && currentConnection.version !== job.connectionVersion)
          throw new GenerationError('GENERATION_INPUT_CHANGED');
        this.jobs.authorizeCreation(user, job.projectId);
        const currentShot = shot ? this.production.shot(user, shot.id, 'edit') : null;
        if (job.purpose === 'workflow_test') {
          this.jobs.audit(user, job.workspaceId, 'generation.test.complete', job.id);
          this.release(job, { state: 'test_completed', mediaVersionId, errorCode: null });
          return;
        }
        const take =
          shot && currentShot ? this.media.addTake(user, shot.id, mediaVersionId, currentShot.version) : null;
        this.jobs.audit(user, job.workspaceId, 'generation.job.complete', job.id);
        this.release(job, {
          state: 'completed',
          mediaVersionId,
          takeId: take?.id ?? null,
          errorCode: null,
          ...(apiImage ? { resultJson: null } : {}),
        });
      },
      { behavior: 'immediate' },
    );
  }
}
