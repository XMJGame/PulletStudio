import { HttpException, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { CurrentUser, fail } from '../common/http';
import { DatabaseService } from '../db/database.service';
import { animaticJobs, mediaUploads, users } from '../db/schema';
import { MediaService, safeMediaError } from '../assets/media.service';
import { AnimaticJob, TimelineService } from './timeline.service';
import { AnimaticRenderer } from './animatic-renderer';
const leaseMs = 90000;
@Injectable()
export class AnimaticWorker {
  constructor(
    private readonly database: DatabaseService,
    private readonly timelines: TimelineService,
    private readonly media: MediaService,
    private readonly renderer: AnimaticRenderer,
  ) {}
  private claim() {
    return this.database.db.transaction(
      () => {
        const now = Date.now();
        if (
          this.database.db
            .select()
            .from(animaticJobs)
            .where(
              and(inArray(animaticJobs.state, ['rendering', 'archiving']), gt(animaticJobs.leaseUntil, now)),
            )
            .get()
        )
          return null;
        const job = this.database.db
          .select()
          .from(animaticJobs)
          .where(
            and(
              inArray(animaticJobs.state, ['queued', 'rendering', 'archiving']),
              lte(animaticJobs.nextAt, now),
              or(isNull(animaticJobs.leaseUntil), lte(animaticJobs.leaseUntil, now)),
            ),
          )
          .orderBy(asc(animaticJobs.nextAt), asc(animaticJobs.id))
          .get();
        if (!job) return null;
        return this.database.db
          .update(animaticJobs)
          .set({
            state: job.state === 'queued' ? 'rendering' : job.state,
            leaseId: randomUUID(),
            leaseUntil: now + leaseMs,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(animaticJobs.id, job.id))
          .returning()
          .get()!;
      },
      { behavior: 'immediate' },
    );
  }
  private owns(job: AnimaticJob) {
    const row = this.database.db.select().from(animaticJobs).where(eq(animaticJobs.id, job.id)).get();
    if (!row || row.leaseId !== job.leaseId || (row.leaseUntil ?? 0) <= Date.now())
      fail(409, 'ANIMATIC_LEASE_LOST', '预演任务已由其他执行者接管或取消');
    return row;
  }
  private update(job: AnimaticJob, changes: Partial<AnimaticJob>) {
    this.owns(job);
    this.database.db
      .update(animaticJobs)
      .set({ ...changes, updatedAt: new Date().toISOString() })
      .where(and(eq(animaticJobs.id, job.id), eq(animaticJobs.leaseId, job.leaseId!)))
      .run();
  }
  private actor(job: AnimaticJob): CurrentUser {
    const user = this.database.db
      .select({ id: users.id, email: users.email, name: users.name, instanceAdmin: users.instanceAdmin })
      .from(users)
      .where(eq(users.id, job.createdBy))
      .get();
    if (!user) fail(403, 'ANIMATIC_CREATOR_UNAVAILABLE', '预演创建者不可用');
    return user;
  }
  async tick() {
    const job = this.claim();
    if (!job) return false;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15 * 60 * 1000)]);
    const heartbeat = setInterval(() => {
      try {
        this.timelines.check(this.actor(job), job.timelineId);
        this.update(job, { leaseUntil: Date.now() + leaseMs });
      } catch (error) {
        controller.abort(error);
      }
    }, 5000);
    try {
      await this.process(job, signal);
    } catch (error) {
      try {
        this.owns(job);
        const cause = signal.aborted && signal.reason instanceof HttpException ? signal.reason : error;
        const failure = safeMediaError(cause);
        const current = this.owns(job);
        const archived = this.database.db
          .select()
          .from(mediaUploads)
          .where(
            and(
              eq(mediaUploads.animaticJobId, job.id),
              inArray(mediaUploads.state, ['complete', 'needs_reconciliation']),
            ),
          )
          .get();
        const recoverable =
          current.state === 'archiving' &&
          archived &&
          ['DATA_CONFLICT', 'MEDIA_DATABASE_CONFLICT', 'MEDIA_OPERATION_FAILED'].includes(failure.code);
        this.update(job, {
          state: recoverable ? 'archiving' : 'failed',
          leaseId: null,
          leaseUntil: null,
          nextAt: Date.now() + 10000,
          errorCode: failure.code === 'MEDIA_OPERATION_FAILED' ? 'ANIMATIC_RENDER_FAILED' : failure.code,
        });
      } catch {
        /* A canceled or superseded lease retains its current state. */
      }
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }
  private async process(job: AnimaticJob, signal: AbortSignal) {
    const user = this.actor(job);
    const check = () => {
      this.owns(job);
      this.timelines.check(user, job.timelineId);
      if (signal.aborted) throw signal.reason;
    };
    check();
    const revision = this.timelines.read(user, job.timelineId);
    const reserved = this.database.db
      .select({ id: mediaUploads.id })
      .from(mediaUploads)
      .where(eq(mediaUploads.animaticJobId, job.id))
      .get();
    let upload = reserved ? await this.media.upload(user, reserved.id) : null;
    if (upload?.state === 'needs_reconciliation')
      upload = await this.media.reconcile(user, upload.id, undefined, job.id);
    if (upload?.state === 'uploading') {
      this.update(job, { leaseId: null, leaseUntil: null, nextAt: Date.now() + 10000 });
      return;
    }
    if (upload?.state !== 'complete') {
      const directory = await mkdtemp(join(tmpdir(), 'pullet-animatic-'));
      try {
        this.update(job, { state: 'rendering' });
        const output = await this.renderer.render(user, revision.snapshot, directory, signal, check);
        check();
        this.update(job, { state: 'archiving' });
        upload = await this.media.initiate(
          user,
          job.projectId,
          {
            fileName: `animatic-${job.id}.mp4`,
            byteLength: output.byteLength,
            contentType: '',
            assetId: null,
            expectedAssetVersion: 0,
          },
          `animatic:${job.id}`,
          undefined,
          job.id,
        );
        const stream = createReadStream(output.path);
        try {
          upload = await this.media.receive(user, upload.id, stream, String(output.byteLength), {
            animaticJobId: job.id,
            mediaType: 'video',
            signal,
          });
        } finally {
          stream.destroy();
        }
      } finally {
        if (
          dirname(resolve(directory)) !== resolve(tmpdir()) ||
          !basename(directory).startsWith('pullet-animatic-')
        )
          throw new Error('Unexpected animatic temporary directory');
        await rm(directory, { recursive: true, force: true });
      }
    }
    if (!upload?.mediaVersion || upload.mediaVersion.mediaType !== 'video')
      fail(409, 'ANIMATIC_OUTPUT_INVALID', '预演文件归档未完成');
    const mediaVersionId = upload.mediaVersion.id;
    this.database.db.transaction(
      () => {
        check();
        this.timelines.audit(user, job.workspaceId, 'animatic.complete', job.id);
        this.update(job, {
          state: 'completed',
          mediaVersionId,
          leaseId: null,
          leaseUntil: null,
          errorCode: null,
        });
      },
      { behavior: 'immediate' },
    );
  }
}
