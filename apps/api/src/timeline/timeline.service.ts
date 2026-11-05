import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, lt } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { CurrentUser, fail } from '../common/http';
import { DatabaseService } from '../db/database.service';
import { animaticJobs, auditEvents, mediaVersions, timelineRevisions } from '../db/schema';
import { AuthorizationService } from '../production/authorization.service';
import { ProductionService } from '../production/production.service';
import { MediaService } from '../assets/media.service';
import { assertSampleAccess } from '../assets/entity-references';
import { MediaPackageService } from '../exports/media-package.service';
import { PackageOptions } from '../exports/media-package-contract';
import { profiles, TimelineInput, TimelineSnapshot } from './timeline-contract';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type AnimaticJob = typeof animaticJobs.$inferSelect;
@Injectable()
export class TimelineService {
  constructor(
    readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
    private readonly production: ProductionService,
    private readonly packages: MediaPackageService,
    private readonly media: MediaService,
  ) {}
  audit(user: CurrentUser, workspaceId: string, action: string, targetId: string) {
    this.database.db
      .insert(auditEvents)
      .values({
        id: randomUUID(),
        workspaceId,
        actorId: user.id,
        action,
        targetId,
        createdAt: new Date().toISOString(),
      })
      .run();
  }
  private latestVersion(projectId: string) {
    return (
      this.database.db
        .select({ version: timelineRevisions.version })
        .from(timelineRevisions)
        .where(eq(timelineRevisions.projectId, projectId))
        .orderBy(desc(timelineRevisions.version))
        .get()?.version ?? 0
    );
  }
  editor(user: CurrentUser, projectId: string, options: PackageOptions) {
    return this.database.db.transaction(() => {
      const source = this.packages.selectedSnapshot(user, projectId, options);
      if (source.snapshot.shots.length > 24)
        fail(413, 'TIMELINE_CLIP_LIMIT', '首版预演最多24个片段，请缩小范围');
      const profileByRatio: Record<string, keyof typeof profiles> = {
        '16:9': 'landscape',
        '9:16': 'portrait',
        '1:1': 'square',
        '4:3': 'classic',
        '2.35:1': 'cinema',
      };
      const clips = source.snapshot.shots.map((shot) => {
        const file = source.snapshot.files.find((file) => file.mediaVersionId === shot.take.mediaVersionId)!;
        const image = file.mime.startsWith('image/');
        const policy = shot.card?.body.sourceAudioPolicy ?? 'inspect';
        return {
          shotId: shot.id,
          code: shot.code,
          fileName: file.fileName,
          mediaType: image ? 'image' : file.mime.startsWith('video/') ? 'video' : 'audio',
          sourceDurationMs: file.metadata.durationMs,
          hasAudio: file.metadata.hasAudio,
          inMs: 0,
          durationMs: image
            ? (shot.card?.body.durationSeconds ?? 1) * 1000
            : (file.metadata.durationMs ?? 1000),
          audioPolicy:
            !file.metadata.hasAudio || image ? 'mute' : ['keep', 'mute'].includes(policy) ? policy : '',
        };
      });
      return {
        sourceHash: source.snapshotHash,
        ready: source.ready && clips.every((clip) => clip.mediaType !== 'audio'),
        items: source.items,
        clips,
        profile: profileByRatio[source.snapshot.project.aspectRatio] ?? 'landscape',
        version: this.latestVersion(projectId),
        ...this.production.access(user, projectId),
      };
    });
  }
  private prepare(user: CurrentUser, projectId: string, input: TimelineInput) {
    const source = this.packages.selectedSnapshot(user, projectId, { scope: input.scope });
    if (!source.ready) fail(409, 'TIMELINE_NOT_READY', '请先完成所选范围的审核和选片');
    if (source.snapshotHash !== input.sourceHash)
      fail(409, 'TIMELINE_SOURCE_CHANGED', '源选片或制作内容已变化，请重新载入片段');
    const ids = new Set(input.clips.map((clip) => clip.shotId));
    if (
      ids.size !== input.clips.length ||
      ids.size !== source.snapshot.shots.length ||
      source.snapshot.shots.some((shot) => !ids.has(shot.id))
    )
      fail(400, 'TIMELINE_CLIP_SCOPE', '片段须完整对应所选镜头，每个镜头使用一次');
    let positionMs = 0;
    const clips: TimelineSnapshot['clips'] = input.clips.map((clip) => {
      const shot = source.snapshot.shots.find((shot) => shot.id === clip.shotId)!;
      const file = source.snapshot.files.find((file) => file.mediaVersionId === shot.take.mediaVersionId)!;
      const image = file.mime.startsWith('image/'),
        video = file.mime.startsWith('video/');
      if (!image && !video) fail(400, 'TIMELINE_VISUAL_REQUIRED', '顺序画面轨需要图片或视频候选');
      if (
        (image && clip.inMs !== 0) ||
        (video && clip.inMs + clip.durationMs > (file.metadata.durationMs ?? 0))
      )
        fail(400, 'TIMELINE_CLIP_RANGE', '视频片段超出原件时长，图片入点须为0');
      if (clip.audioPolicy === 'keep' && !file.metadata.hasAudio)
        fail(400, 'TIMELINE_AUDIO_MISSING', '此素材没有原声音轨，请选择静音');
      const frames = Math.ceil(clip.durationMs / 40),
        durationMs = frames * 40;
      const item: TimelineSnapshot['clips'][number] = {
        shotId: shot.id,
        code: shot.code,
        takeId: shot.take.id,
        mediaVersionId: file.mediaVersionId,
        mediaType: image ? 'image' : 'video',
        inMs: clip.inMs,
        requestedDurationMs: clip.durationMs,
        durationMs,
        positionMs,
        frames,
        audioPolicy: clip.audioPolicy,
        hasAudio: file.metadata.hasAudio,
      };
      positionMs += durationMs;
      return item;
    });
    if (positionMs > 300000) fail(413, 'TIMELINE_DURATION_LIMIT', '首版预演最多300秒，请缩短片段或范围');
    const snapshot: TimelineSnapshot = {
      schemaVersion: 'studio.timeline.v1',
      sourceHash: source.snapshotHash,
      sources: source.snapshot,
      profile: input.profile,
      ...profiles[input.profile],
      fps: 25,
      durationMs: positionMs,
      clips,
    };
    if (Buffer.byteLength(JSON.stringify(snapshot)) > 4 * 1024 * 1024)
      fail(413, 'TIMELINE_SNAPSHOT_LIMIT', '时间线快照过大，请缩小范围');
    return { snapshot, snapshotHash: hash(snapshot) };
  }
  preview(user: CurrentUser, projectId: string, input: TimelineInput) {
    return this.database.db.transaction(() => this.prepare(user, projectId, input));
  }
  save(
    user: CurrentUser,
    projectId: string,
    input: TimelineInput,
    expectedVersion: number,
    expectedPreviewHash: string,
    key: string,
  ) {
    return this.database.db.transaction(
      () => {
        const project = this.authz.project(user, projectId, 'edit');
        const requestHash = hash({ input, expectedVersion, expectedPreviewHash });
        const replay = this.database.db
          .select()
          .from(timelineRevisions)
          .where(
            and(
              eq(timelineRevisions.projectId, projectId),
              eq(timelineRevisions.createdBy, user.id),
              eq(timelineRevisions.requestKey, key),
            ),
          )
          .get();
        if (replay) {
          if (replay.requestHash !== requestHash)
            fail(409, 'IDEMPOTENCY_CONFLICT', '此请求标识已用于其他时间线');
          return this.read(user, replay.id);
        }
        if (this.latestVersion(projectId) !== expectedVersion)
          fail(409, 'TIMELINE_VERSION_CONFLICT', '已有新的时间线版本，请重新载入后核对');
        const prepared = this.prepare(user, projectId, input);
        if (prepared.snapshotHash !== expectedPreviewHash)
          fail(409, 'TIMELINE_PREVIEW_CHANGED', '时间线已变化，请重新预览');
        const id = randomUUID();
        this.database.db
          .insert(timelineRevisions)
          .values({
            id,
            projectId,
            workspaceId: project.workspaceId,
            version: expectedVersion + 1,
            createdBy: user.id,
            createdAt: new Date().toISOString(),
            requestKey: key,
            requestHash,
            snapshotHash: prepared.snapshotHash,
            snapshotJson: JSON.stringify(prepared.snapshot),
            durationMs: prepared.snapshot.durationMs,
          })
          .run();
        this.audit(user, project.workspaceId, 'timeline.save', id);
        return this.read(user, id);
      },
      { behavior: 'immediate' },
    );
  }
  read(user: CurrentUser, id: string) {
    const row = this.database.db.select().from(timelineRevisions).where(eq(timelineRevisions.id, id)).get();
    if (!row) fail(404, 'NOT_FOUND', '时间线不存在或无权访问');
    this.authz.project(user, row.projectId);
    const snapshot = JSON.parse(row.snapshotJson) as TimelineSnapshot;
    for (const file of snapshot.sources.files) {
      const media = this.database.db
        .select()
        .from(mediaVersions)
        .where(and(eq(mediaVersions.id, file.mediaVersionId), eq(mediaVersions.projectId, row.projectId)))
        .get();
      if (!media) fail(404, 'NOT_FOUND', '源媒体不存在');
      assertSampleAccess(this.database, user, media);
    }
    return {
      id: row.id,
      projectId: row.projectId,
      version: row.version,
      createdAt: row.createdAt,
      durationMs: row.durationMs,
      snapshotHash: row.snapshotHash,
      snapshot,
    };
  }
  list(user: CurrentUser, projectId: string, before?: number) {
    this.authz.project(user, projectId);
    const rows = this.database.db
      .select({
        id: timelineRevisions.id,
        version: timelineRevisions.version,
        durationMs: timelineRevisions.durationMs,
        createdAt: timelineRevisions.createdAt,
      })
      .from(timelineRevisions)
      .where(
        and(
          eq(timelineRevisions.projectId, projectId),
          before ? lt(timelineRevisions.version, before) : undefined,
        ),
      )
      .orderBy(desc(timelineRevisions.version))
      .limit(21)
      .all();
    return { items: rows.slice(0, 20), nextCursor: rows.length > 20 ? rows[19].version : null };
  }
  check(user: CurrentUser, timelineId: string) {
    const revision = this.read(user, timelineId);
    this.authz.project(user, revision.projectId, 'edit');
    const source = this.packages.selectedSnapshot(user, revision.projectId, {
      scope: revision.snapshot.sources.scope,
    });
    if (!source.ready || source.snapshotHash !== revision.snapshot.sourceHash)
      fail(409, 'ANIMATIC_INPUT_CHANGED', '源选片或制作内容已变化，请保存新时间线后生成');
    return revision;
  }
  queue(user: CurrentUser, timelineId: string, key: string) {
    return this.database.db.transaction(
      () => {
        const revision = this.read(user, timelineId);
        const project = this.authz.project(user, revision.projectId, 'edit');
        const replay = this.database.db
          .select()
          .from(animaticJobs)
          .where(
            and(
              eq(animaticJobs.projectId, project.id),
              eq(animaticJobs.createdBy, user.id),
              eq(animaticJobs.requestKey, key),
            ),
          )
          .get();
        if (replay) {
          if (replay.timelineId !== timelineId)
            fail(409, 'IDEMPOTENCY_CONFLICT', '请求标识已用于其他预演任务');
          return this.jobView(user, replay);
        }
        this.check(user, timelineId);
        if (
          this.database.db
            .select()
            .from(animaticJobs)
            .where(
              and(
                eq(animaticJobs.timelineId, timelineId),
                inArray(animaticJobs.state, ['queued', 'rendering', 'archiving']),
              ),
            )
            .get()
        )
          fail(409, 'ANIMATIC_ACTIVE', '此时间线已有待处理预演任务');
        const id = randomUUID(),
          createdAt = new Date().toISOString();
        const row = this.database.db
          .insert(animaticJobs)
          .values({
            id,
            timelineId,
            projectId: project.id,
            workspaceId: project.workspaceId,
            createdBy: user.id,
            createdAt,
            updatedAt: createdAt,
            requestKey: key,
            state: 'queued',
            nextAt: Date.now(),
          })
          .returning()
          .get()!;
        this.audit(user, project.workspaceId, 'animatic.queue', id);
        return this.jobView(user, row);
      },
      { behavior: 'immediate' },
    );
  }
  private jobView(user: CurrentUser, row: AnimaticJob) {
    const access = this.production.access(user, row.projectId);
    return {
      id: row.id,
      timelineId: row.timelineId,
      state: row.state,
      errorCode: row.errorCode,
      createdAt: row.createdAt,
      canControl: access.canManage || (access.canEdit && row.createdBy === user.id),
      media: row.mediaVersionId ? this.media.version(user, row.mediaVersionId) : null,
    };
  }
  jobs(user: CurrentUser, timelineId: string) {
    this.read(user, timelineId);
    return this.database.db
      .select()
      .from(animaticJobs)
      .where(eq(animaticJobs.timelineId, timelineId))
      .orderBy(desc(animaticJobs.createdAt), desc(animaticJobs.id))
      .limit(20)
      .all()
      .map((row) => this.jobView(user, row));
  }
  cancel(user: CurrentUser, id: string) {
    return this.database.db.transaction(
      () => {
        const job = this.database.db.select().from(animaticJobs).where(eq(animaticJobs.id, id)).get();
        if (!job) fail(404, 'NOT_FOUND', '预演任务不存在');
        this.read(user, job.timelineId);
        if (!this.jobView(user, job).canControl) fail(403, 'FORBIDDEN', '没有取消此任务的权限');
        if (job.state === 'canceled') return this.jobView(user, job);
        if (!['queued', 'rendering', 'archiving'].includes(job.state))
          fail(409, 'ANIMATIC_FINISHED', '此任务已经结束');
        const row = this.database.db
          .update(animaticJobs)
          .set({ state: 'canceled', leaseId: null, leaseUntil: null, updatedAt: new Date().toISOString() })
          .where(eq(animaticJobs.id, id))
          .returning()
          .get()!;
        this.audit(user, job.workspaceId, 'animatic.cancel', id);
        return this.jobView(user, row);
      },
      { behavior: 'immediate' },
    );
  }
}
