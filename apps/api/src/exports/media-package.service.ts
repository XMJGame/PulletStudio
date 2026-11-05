import { HttpException, Injectable } from '@nestjs/common';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { ZipFile } from 'yazl';
import { CurrentUser, fail } from '../common/http';
import { DatabaseService } from '../db/database.service';
import {
  auditEvents,
  generationJobs,
  generationWorkflows,
  mediaPackageExports,
  mediaVersions,
  takeReviewEvents,
  takes,
  users,
} from '../db/schema';
import { AuthorizationService } from '../production/authorization.service';
import { MediaService } from '../assets/media.service';
import { assertSampleAccess } from '../assets/entity-references';
import { TakeReviewService } from '../assets/take-review.service';
import { PromptService } from '../prompt/prompt.service';
import { StoryboardExportsService } from './storyboard-exports.service';
import {
  PackageFile,
  PackageManifest,
  PackageOptions,
  PackageSnapshot,
  packageLimits,
} from './media-package-contract';

const checksum = (text: string) => createHash('sha256').update(text).digest('hex');
const extensions: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/wav': 'wav',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
};
type Row = typeof mediaPackageExports.$inferSelect;
const metadata = {
  id: mediaPackageExports.id,
  projectId: mediaPackageExports.projectId,
  createdAt: mediaPackageExports.createdAt,
  shotCount: mediaPackageExports.shotCount,
  mediaBytes: mediaPackageExports.mediaBytes,
  snapshotHash: mediaPackageExports.snapshotHash,
};
type Metadata = Pick<Row, keyof typeof metadata>;
@Injectable()
export class MediaPackageService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
    private readonly cards: StoryboardExportsService,
    private readonly reviews: TakeReviewService,
    private readonly media: MediaService,
    private readonly prompts: PromptService,
  ) {}
  private view(row: Metadata) {
    return {
      ...row,
      state: 'snapshot_ready' as const,
      fileName: `media-package-${row.id}.zip`,
      downloadPath: `/api/v1/media-packages/${row.id}/file`,
    };
  }
  private access(user: CurrentUser, projectId: string, file: PackageFile) {
    this.authz.project(user, projectId);
    const row = this.database.db
      .select()
      .from(mediaVersions)
      .where(and(eq(mediaVersions.id, file.mediaVersionId), eq(mediaVersions.projectId, projectId)))
      .get();
    if (!row) fail(404, 'NOT_FOUND', '素材包原件不存在或无权访问');
    assertSampleAccess(this.database, user, row);
  }
  private collect(user: CurrentUser, projectId: string, options: PackageOptions) {
    const cards = this.cards.cardsSnapshot(user, projectId, options.scope);
    if (cards.shots.length > packageLimits.shots)
      fail(413, 'PACKAGE_SHOT_LIMIT', '单次素材包最多100个镜头，请缩小范围');
    const snapshot: PackageSnapshot = {
      schemaVersion: 'studio.media-package.v1',
      project: cards.project,
      scope: options.scope,
      units: cards.units,
      shots: [],
      files: [],
    };
    const files = new Map<string, PackageFile>();
    const items: { id: string; code: string; ready: boolean; reason: string; takeNo: number | null }[] = [];
    for (const shot of cards.shots) {
      const selection = this.reviews.selection(user, shot.id);
      if (!selection.valid || !selection.takeId || !selection.approvalId || !shot.card) {
        items.push({
          id: shot.id,
          code: shot.code,
          ready: false,
          reason: selection.takeId ? '选片批准或审核依据已失效，请重新审核并选用' : '尚未选用已批准的候选',
          takeNo: selection.takeNo,
        });
        continue;
      }
      const take = this.database.db.select().from(takes).where(eq(takes.id, selection.takeId)).get()!;
      const media = this.media.version(user, take.mediaVersionId);
      const extension = extensions[media.mime];
      if (!extension) fail(409, 'PACKAGE_MEDIA_UNSUPPORTED', '选片包含暂不支持的媒体类型');
      const file: PackageFile = {
        mediaVersionId: media.id,
        path: `media/${media.id}.${extension}`,
        fileName: media.fileName,
        mime: media.mime,
        byteLength: media.byteLength,
        sha256: media.sha256,
        metadata: media.metadata,
      };
      try {
        this.access(user, projectId, file);
      } catch (error) {
        if (!(error instanceof HttpException) || ![403, 404].includes(error.getStatus())) throw error;
        items.push({
          id: shot.id,
          code: shot.code,
          ready: false,
          reason: '当前账户无权读取所选原件',
          takeNo: take.takeNo,
        });
        continue;
      }
      const approval = this.database.db
        .select({
          id: takeReviewEvents.id,
          version: takeReviewEvents.version,
          actorName: users.name,
          reason: takeReviewEvents.reason,
          createdAt: takeReviewEvents.createdAt,
          shotVersion: takeReviewEvents.shotVersion,
          projectVersion: takeReviewEvents.projectVersion,
          generationJobId: takeReviewEvents.generationJobId,
          promptId: takeReviewEvents.promptId,
        })
        .from(takeReviewEvents)
        .innerJoin(users, eq(users.id, takeReviewEvents.actorId))
        .where(eq(takeReviewEvents.id, selection.approvalId))
        .get()!;
      let source: PackageSnapshot['shots'][number]['source'] = null;
      if (approval.generationJobId && approval.promptId) {
        const job = this.database.db
          .select()
          .from(generationJobs)
          .where(eq(generationJobs.id, approval.generationJobId))
          .get()!;
        const workflow = this.database.db
          .select()
          .from(generationWorkflows)
          .where(eq(generationWorkflows.id, job.workflowId))
          .get()!;
        source = {
          jobId: job.id,
          workflow: {
            id: workflow.id,
            name: workflow.name,
            capability: workflow.capability,
            definitionHash: checksum(workflow.definitionJson),
          },
          parameterValues:
            (JSON.parse(job.snapshotJson) as { parameterValues?: Record<string, string | number> })
              .parameterValues ?? {},
          prompt: this.prompts.artifact(user, shot.id, approval.promptId),
        };
      }
      const { generationJobId: _job, promptId: _prompt, ...approvalEvidence } = approval;
      snapshot.shots.push({
        id: shot.id,
        code: shot.code,
        version: shot.version,
        sequence: shot.sequence,
        unitPath: shot.unitPath,
        card: shot.card,
        selection: { id: selection.id!, version: selection.version, approvalId: selection.approvalId },
        take: { id: take.id, takeNo: take.takeNo, mediaVersionId: media.id },
        approval: approvalEvidence,
        source,
      });
      files.set(media.id, file);
      items.push({
        id: shot.id,
        code: shot.code,
        ready: true,
        reason: '已选用有效批准版本',
        takeNo: take.takeNo,
      });
    }
    snapshot.files = [...files.values()];
    const mediaBytes = snapshot.files.reduce((total, file) => total + file.byteLength, 0);
    if (mediaBytes > packageLimits.mediaBytes)
      fail(413, 'PACKAGE_SIZE_LIMIT', '原件合计超过2GiB，请缩小范围');
    const encoded = JSON.stringify(snapshot);
    if (Buffer.byteLength(encoded) > packageLimits.manifestBytes - 1024)
      fail(413, 'PACKAGE_MANIFEST_LIMIT', '素材包清单超过4MiB，请缩小范围');
    return {
      snapshot,
      snapshotHash: checksum(encoded),
      items,
      mediaBytes,
      ready: items.every((item) => item.ready),
    };
  }
  preview(user: CurrentUser, projectId: string, options: PackageOptions) {
    return this.database.db.transaction(() => {
      const prepared = this.collect(user, projectId, options);
      return {
        snapshotHash: prepared.snapshotHash,
        ready: prepared.ready,
        items: prepared.items,
        shotCount: prepared.items.length,
        fileCount: prepared.snapshot.files.length,
        mediaBytes: prepared.mediaBytes,
        limits: packageLimits,
      };
    });
  }
  private replay(user: CurrentUser, projectId: string, key: string, requestHash: string) {
    this.authz.project(user, projectId);
    const row = this.database.db
      .select()
      .from(mediaPackageExports)
      .where(
        and(
          eq(mediaPackageExports.projectId, projectId),
          eq(mediaPackageExports.createdBy, user.id),
          eq(mediaPackageExports.requestKey, key),
        ),
      )
      .get();
    if (!row) return null;
    if (row.requestHash !== requestHash) fail(409, 'IDEMPOTENCY_CONFLICT', '此请求标识已用于其他素材包');
    for (const file of (JSON.parse(row.manifestJson) as PackageManifest).files)
      this.access(user, projectId, file);
    return { ...this.view(row), replayed: true };
  }
  private async verifyFiles(user: CurrentUser, files: PackageFile[], signal?: AbortSignal) {
    for (const file of files) {
      if (signal?.aborted) fail(409, 'PACKAGE_DOWNLOAD_ABORTED', '素材包下载已中断');
      const opened = await this.media.content(user, file.mediaVersionId, false);
      await new Promise<void>((resolve, reject) => {
        opened.stream.once('close', resolve);
        opened.stream.once('error', reject);
        opened.stream.destroy();
      });
      if (opened.sha256 !== file.sha256 || opened.length !== file.byteLength)
        fail(409, 'PACKAGE_MEDIA_CHANGED', '原件与交付清单不一致');
    }
    if (signal?.aborted) fail(409, 'PACKAGE_DOWNLOAD_ABORTED', '素材包下载已中断');
  }
  async create(
    user: CurrentUser,
    projectId: string,
    options: PackageOptions,
    expectedSnapshotHash: string,
    key: string,
  ) {
    const requestHash = checksum(JSON.stringify({ ...options, expectedSnapshotHash }));
    const existing = this.replay(user, projectId, key, requestHash);
    if (existing) return existing;
    const prepared = this.database.db.transaction(() => this.collect(user, projectId, options));
    if (!prepared.ready) fail(409, 'PACKAGE_NOT_READY', '所选范围有待处理镜头，请先完成审核及选片');
    if (prepared.snapshotHash !== expectedSnapshotHash)
      fail(409, 'PACKAGE_PREVIEW_CHANGED', '选片或制作内容已变化，请重新预检');
    await this.verifyFiles(user, prepared.snapshot.files);
    return this.database.db.transaction(
      () => {
        const existing = this.replay(user, projectId, key, requestHash);
        if (existing) return existing;
        const current = this.collect(user, projectId, options);
        if (!current.ready || current.snapshotHash !== expectedSnapshotHash)
          fail(409, 'PACKAGE_PREVIEW_CHANGED', '检查原件期间选片或制作内容已变化，请重新预检');
        const project = this.authz.project(user, projectId),
          id = randomUUID(),
          createdAt = new Date().toISOString();
        const manifest: PackageManifest = {
          ...current.snapshot,
          packageId: id,
          exportedAt: createdAt,
          snapshotHash: current.snapshotHash,
        };
        const row = this.database.db
          .insert(mediaPackageExports)
          .values({
            id,
            projectId,
            workspaceId: project.workspaceId,
            createdBy: user.id,
            createdAt,
            requestKey: key,
            requestHash,
            snapshotHash: current.snapshotHash,
            manifestJson: JSON.stringify(manifest),
            shotCount: current.items.length,
            mediaBytes: current.mediaBytes,
          })
          .returning(metadata)
          .get()!;
        this.database.db
          .insert(auditEvents)
          .values({
            id: randomUUID(),
            workspaceId: project.workspaceId,
            actorId: user.id,
            action: 'media.package.create',
            targetId: id,
            createdAt,
          })
          .run();
        return { ...this.view(row), replayed: false };
      },
      { behavior: 'immediate' },
    );
  }
  private row(user: CurrentUser, id: string) {
    const row = this.database.db
      .select()
      .from(mediaPackageExports)
      .where(eq(mediaPackageExports.id, id))
      .get();
    if (!row) fail(404, 'NOT_FOUND', '素材包不存在或无权访问');
    this.authz.project(user, row.projectId);
    const manifest = JSON.parse(row.manifestJson) as PackageManifest;
    for (const file of manifest.files) this.access(user, row.projectId, file);
    return { row, manifest };
  }
  read(user: CurrentUser, id: string) {
    const { row, manifest } = this.row(user, id);
    return { ...this.view(row), manifest };
  }
  list(user: CurrentUser, projectId: string, cursor?: string) {
    this.authz.project(user, projectId);
    const boundary = cursor
      ? this.database.db
          .select()
          .from(mediaPackageExports)
          .where(and(eq(mediaPackageExports.id, cursor), eq(mediaPackageExports.projectId, projectId)))
          .get()
      : undefined;
    if (cursor && !boundary) fail(404, 'NOT_FOUND', '素材包分页位置不存在');
    const rows = this.database.db
      .select(metadata)
      .from(mediaPackageExports)
      .where(
        and(
          eq(mediaPackageExports.projectId, projectId),
          boundary
            ? or(
                lt(mediaPackageExports.createdAt, boundary.createdAt),
                and(
                  eq(mediaPackageExports.createdAt, boundary.createdAt),
                  lt(mediaPackageExports.id, boundary.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(mediaPackageExports.createdAt), desc(mediaPackageExports.id))
      .limit(21)
      .all();
    return {
      items: rows.slice(0, 20).map((row) => this.view(row)),
      nextCursor: rows.length > 20 ? rows[19].id : null,
    };
  }
  async file(user: CurrentUser, id: string, signal?: AbortSignal) {
    const { row, manifest } = this.row(user, id);
    await this.verifyFiles(user, manifest.files, signal);
    this.row(user, id);
    if (signal?.aborted) fail(409, 'PACKAGE_DOWNLOAD_ABORTED', '素材包下载已中断');
    const zip = new ZipFile(),
      output = zip.outputStream as Readable;
    let active: Readable | undefined;
    let closed = false;
    zip.on('error', (error) => output.destroy(error));
    const abort = () => output.destroy();
    signal?.addEventListener('abort', abort, { once: true });
    output.once('close', () => {
      closed = true;
      active?.destroy();
      signal?.removeEventListener('abort', abort);
    });
    const options = { compress: false, mtime: new Date(2000, 0, 1), mode: 0o100644, forceDosTimestamp: true };
    zip.addBuffer(Buffer.from(row.manifestJson), 'manifest.json', options);
    for (const file of manifest.files) {
      zip.addReadStreamLazy(file.path, { ...options, size: file.byteLength }, (callback) => {
        void this.media
          .content(user, file.mediaVersionId, false)
          .then((source) => {
            if (closed) {
              source.stream.destroy();
              throw new Error('Download closed');
            }
            const hash = createHash('sha256');
            let bytes = 0;
            const checked = new Transform({
              transform(chunk: Buffer, _encoding, done) {
                bytes += chunk.length;
                hash.update(chunk);
                done(null, chunk);
              },
              flush: (done) => {
                try {
                  this.access(user, row.projectId, file);
                  if (bytes !== file.byteLength || hash.digest('hex') !== file.sha256)
                    throw new Error('Media integrity changed');
                  done();
                } catch (error) {
                  done(error as Error);
                }
              },
            });
            active = checked;
            checked.on('error', (error) => output.destroy(error));
            source.stream.on('error', (error) => checked.destroy(error));
            checked.once('close', () => source.stream.destroy());
            source.stream.pipe(checked);
            callback(null, checked);
          })
          .catch((error) => callback(error, Readable.from([])));
      });
    }
    const length = await new Promise<number>((resolve, reject) => {
      output.once('error', reject);
      zip.end(undefined, (size?: number) => {
        if (size === undefined || size < 0) {
          output.destroy();
          reject(new Error('ZIP length unavailable'));
        } else resolve(size);
      });
    });
    return { stream: output, length, fileName: this.view(row).fileName };
  }
}
