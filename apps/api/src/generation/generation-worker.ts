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
import { GenerationService, GenerationSnapshot, Job } from './generation.service';
import { resultDescriptor, WorkflowInput } from './generation-contract';

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
        const leaseId = randomUUID();
        return this.database.db
          .update(generationJobs)
          .set({
            leaseId,
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
  private checkInputs(user: CurrentUser, job: Job, connectionId: string, snapshot: GenerationSnapshot) {
    this.owns(job);
    if (
      this.production.shot(user, job.shotId, 'edit').version !== job.shotVersion ||
      this.production.project(user, job.projectId).version !== job.projectVersion ||
      this.jobs.connection(connectionId).version !== job.connectionVersion
    )
      throw new GenerationError('GENERATION_INPUT_CHANGED');
    if (JSON.stringify(this.jobs.approvals(user, job.shotId)) !== JSON.stringify(snapshot.approvals))
      throw new GenerationError('GENERATION_APPROVAL_CHANGED');
  }
  private async readImage(
    user: CurrentUser,
    image: NonNullable<GenerationSnapshot['image']>,
    signal: AbortSignal,
  ) {
    const file = await this.media.content(user, image.id, false);
    try {
      if (file.total !== image.bytes || file.sha256 !== image.sha256 || file.mime !== image.mime)
        throw new GenerationError('REFERENCE_IMAGE_INVALID');
      const chunks: Buffer[] = [];
      const hash = createHash('sha256');
      let size = 0;
      for await (const chunk of addAbortSignal(signal, file.stream)) {
        size += chunk.length;
        if (size > image.bytes) throw new GenerationError('REFERENCE_IMAGE_INVALID');
        hash.update(chunk);
        chunks.push(chunk);
      }
      if (size !== image.bytes || hash.digest('hex') !== image.sha256)
        throw new GenerationError('REFERENCE_IMAGE_INVALID');
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
        if (code === 'COMFY_REQUEST_REJECTED') this.release(job, { state: 'failed', errorCode: code });
        else this.release(job, { state: 'needs_reconciliation', errorCode: 'SUBMISSION_UNCERTAIN' });
      } else if (current.state === 'preparing') this.release(job, { state: 'failed', errorCode: code });
      else if (
        current.state === 'submitted' &&
        ['COMFY_CONNECTION_FAILED', 'COMFY_HTTP_ERROR', 'COMFY_RATE_LIMIT'].includes(code) &&
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
      shot = this.production.shot(user, job.shotId, 'edit');
    const workflow = this.jobs.workflow(job.workflowId),
      definition = JSON.parse(workflow.definitionJson) as WorkflowInput;
    const connection = this.jobs.connection(workflow.connectionId, job.workspaceId);
    if (!connection.enabled) throw new GenerationError('CONNECTION_DISABLED');
    if (job.state === 'preparing') {
      const storage = await this.media.status(user, job.projectId);
      if (!storage.available) throw new GenerationError('MEDIA_NOT_READY');
      const provider = await this.jobs.provider(connection);
      await provider.probe(signal);
      const snapshot = JSON.parse(job.snapshotJson) as GenerationSnapshot;
      if (definition.image) {
        if (!snapshot.image) throw new GenerationError('REFERENCE_IMAGE_INVALID');
        const image = await this.readImage(user, snapshot.image, signal);
        this.database.db.transaction(() => this.checkInputs(user, job, connection.id, snapshot));
        const path = await provider.uploadImage(job.id, snapshot.image.mime, image, signal);
        snapshot.graph[definition.image.node].inputs[definition.image.input] = path;
      }
      this.database.db.transaction(
        () => {
          this.checkInputs(user, job, connection.id, snapshot);
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
      const provider = await this.jobs.provider(connection);
      const result = await provider.observe(candidate, job.id, definition, !job.remoteId, signal);
      if (result.state === 'pending') {
        const expired = (job.deadline ?? 0) <= Date.now();
        this.release(job, {
          state: expired ? 'needs_reconciliation' : 'submitted',
          nextAt: Date.now() + pollMs,
          errorCode: expired ? 'COMFY_HISTORY_PENDING' : null,
        });
      } else if (result.state === 'failed') {
        this.release(job, { state: 'failed', remoteId: candidate, errorCode: 'COMFY_EXECUTION_FAILED' });
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
    const result = resultDescriptor.parse(JSON.parse(job.resultJson!));
    const mediaType = workflow.capability === 'image.text_to_image' ? 'image' : 'video';
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
      const provider = await this.jobs.provider(connection);
      const download = await provider.download(result, this.config.mediaMaxBytes, signal);
      try {
        this.owns(job);
        upload = await this.media.initiate(
          user,
          job.projectId,
          {
            fileName: result.filename,
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
        if (!this.jobs.connection(connection.id).enabled) throw new GenerationError('CONNECTION_DISABLED');
        const currentShot = this.production.shot(user, shot.id, 'edit');
        const take = this.media.addTake(user, shot.id, mediaVersionId, currentShot.version);
        this.jobs.audit(user, job.workspaceId, 'generation.job.complete', job.id);
        this.release(job, { state: 'completed', mediaVersionId, takeId: take.id, errorCode: null });
      },
      { behavior: 'immediate' },
    );
  }
}
