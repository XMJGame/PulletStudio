import { HttpException, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gt, inArray, isNull, lt, notExists, or, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { CurrentUser, fail } from '../common/http';
import { AppConfig } from '../config';
import { DatabaseService } from '../db/database.service';
import {
  auditEvents,
  generationJobs,
  mediaAssets,
  mediaUploads,
  mediaVersions,
  storageConnections,
  takes,
  workspaceMediaImports,
  workspaceNativeImports,
  workspaceMediaUploads,
} from '../db/schema';
import { AuthorizationService } from '../production/authorization.service';
import { ProductionService } from '../production/production.service';
import { LocalStorage, objectPrefix, StorageFailure } from '../storage/local-storage';
import { MediaDetails, MediaProbe } from './media-probe';
import { UploadInput } from './media-contract';
import { assertSampleAccess } from './entity-references';
import { takeReviewState } from './take-review-state';
import { ResourceAccessService } from './resource-access.service';
type Upload = typeof mediaUploads.$inferSelect;
type Prepared = { original: { bytes: number; sha256: string }; details: MediaDetails };
export type ArchivedMedia = Pick<
  typeof mediaVersions.$inferSelect,
  'id' | 'storageId' | 'objectKey' | 'fileName' | 'mime' | 'byteLength' | 'sha256' | 'posterJson'
>;
export function safeMediaError(error: unknown) {
  if (error instanceof StorageFailure) return { code: error.code, message: error.message };
  if (error instanceof HttpException) {
    const body = error.getResponse() as { code?: string; message?: string };
    return { code: body.code ?? 'MEDIA_REQUEST_FAILED', message: body.message ?? '媒体操作失败' };
  }
  const code =
    (error as { cause?: NodeJS.ErrnoException })?.cause?.code ?? (error as NodeJS.ErrnoException)?.code;
  if (code?.startsWith('SQLITE_CONSTRAINT'))
    return { code: 'MEDIA_DATABASE_CONFLICT', message: '归档登记发生冲突，文件已保留，请核对后重试登记' };
  if (code === 'ENOENT')
    return { code: 'MEDIA_OBJECT_UNAVAILABLE', message: '媒体文件或工具暂不可用，请检查存储与安装' };
  if (code === 'ENOSPC' || code === 'EACCES' || code === 'EPERM')
    return { code: 'STORAGE_WRITE_FAILED', message: '存储空间或访问权限不足，文件未登记完成' };
  if (code === 'ABORT_ERR' || (error as Error)?.name === 'AbortError')
    return { code: 'UPLOAD_INTERRUPTED', message: '上传中断或超时，请重新发送同一文件' };
  return { code: 'MEDIA_OPERATION_FAILED', message: '媒体操作未完成，请检查上传状态后重试' };
}
@Injectable()
export class MediaService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
    private readonly production: ProductionService,
    private readonly storage: LocalStorage,
    private readonly probe: MediaProbe,
    private readonly config: AppConfig,
    private readonly resourceAccess: ResourceAccessService,
  ) {}
  private audit(user: CurrentUser, workspaceId: string, action: string, targetId: string) {
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
  private view(row: typeof mediaVersions.$inferSelect) {
    const librarySource =
      row.origin === 'workspace_library'
        ? (this.database.db
            .select({ importId: workspaceMediaImports.id, resourceId: workspaceMediaImports.resourceId })
            .from(workspaceMediaImports)
            .innerJoin(mediaUploads, eq(mediaUploads.id, workspaceMediaImports.uploadId))
            .where(eq(mediaUploads.mediaVersionId, row.id))
            .get() ?? null)
        : null;
    const nativeSource =
      row.origin === 'workspace_library' && !librarySource
        ? this.database.db
            .select({ importId: workspaceNativeImports.id, resourceId: workspaceNativeImports.resourceId })
            .from(workspaceNativeImports)
            .innerJoin(mediaUploads, eq(mediaUploads.id, workspaceNativeImports.uploadId))
            .where(eq(mediaUploads.mediaVersionId, row.id))
            .get()
        : null;
    return {
      id: row.id,
      assetId: row.assetId,
      projectId: row.projectId,
      version: row.version,
      fileName: row.fileName,
      mediaType: row.mediaType,
      mime: row.mime,
      byteLength: row.byteLength,
      sha256: row.sha256,
      metadata: JSON.parse(row.metadataJson) as MediaDetails['metadata'],
      origin: row.origin,
      ...((librarySource ?? nativeSource) ? { librarySource: librarySource ?? nativeSource } : {}),
      createdAt: row.createdAt,
      contentUrl: `/api/v1/media-versions/${row.id}/content`,
      downloadUrl: `/api/v1/media-versions/${row.id}/content?download=1`,
      posterUrl: row.posterJson ? `/api/v1/media-versions/${row.id}/poster` : null,
    };
  }
  version(user: CurrentUser, id: string) {
    const row = this.database.db.select().from(mediaVersions).where(eq(mediaVersions.id, id)).get();
    if (!row) fail(404, 'NOT_FOUND', '媒体版本不存在或无权访问');
    this.authz.project(user, row.projectId);
    return this.view(row);
  }
  private asset(user: CurrentUser, id: string, action: 'read' | 'edit' = 'read') {
    const row = this.database.db.select().from(mediaAssets).where(eq(mediaAssets.id, id)).get();
    if (!row) fail(404, 'NOT_FOUND', '素材不存在或无权访问');
    this.authz.project(user, row.projectId, action);
    if (
      action === 'edit' &&
      this.database.db
        .select({ id: mediaVersions.id })
        .from(mediaVersions)
        .where(
          and(
            eq(mediaVersions.assetId, id),
            eq(mediaVersions.version, 1),
            eq(mediaVersions.origin, 'workflow_test'),
          ),
        )
        .get()
    )
      fail(409, 'WORKFLOW_TEST_MEDIA', '试跑证据不能追加素材版本');
    return row;
  }
  async status(user: CurrentUser, projectId: string) {
    this.authz.project(user, projectId);
    try {
      await this.storage.ready();
      const tools = await this.probe.ready();
      return {
        available: true,
        maxBytes: this.config.mediaMaxBytes,
        tools,
        formats: 'PNG/JPEG/WebP、MP4/MOV/WebM、WAV/MP3/OGG',
      };
    } catch (error) {
      return { available: false, maxBytes: this.config.mediaMaxBytes, error: safeMediaError(error) };
    }
  }
  async initiate(
    user: CurrentUser,
    projectId: string,
    input: UploadInput,
    key: string,
    generationJobId?: string,
    animaticJobId?: string,
  ) {
    const project = this.authz.project(user, projectId, 'edit');
    if (input.byteLength > this.config.mediaMaxBytes)
      fail(413, 'MEDIA_SIZE_LIMIT', '文件超过当前媒体上传限制');
    const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const existing = this.database.db
      .select()
      .from(mediaUploads)
      .where(
        and(
          eq(mediaUploads.projectId, projectId),
          eq(mediaUploads.createdBy, user.id),
          eq(mediaUploads.idempotencyKey, key),
        ),
      )
      .get();
    if (existing) {
      if (
        existing.requestHash !== requestHash ||
        existing.generationJobId !== (generationJobId ?? null) ||
        existing.animaticJobId !== (animaticJobId ?? null)
      )
        fail(409, 'IDEMPOTENCY_CONFLICT', '上传请求标识已用于另一文件或目标');
      return this.upload(user, existing.id);
    }
    await this.probe.ready();
    const storageId = await this.storage.ready();
    return this.database.db.transaction(
      () => {
        this.authz.project(user, projectId, 'edit');
        const replay = this.database.db
          .select()
          .from(mediaUploads)
          .where(
            and(
              eq(mediaUploads.projectId, projectId),
              eq(mediaUploads.createdBy, user.id),
              eq(mediaUploads.idempotencyKey, key),
            ),
          )
          .get();
        if (replay) {
          if (
            replay.requestHash !== requestHash ||
            replay.generationJobId !== (generationJobId ?? null) ||
            replay.animaticJobId !== (animaticJobId ?? null)
          )
            fail(409, 'IDEMPOTENCY_CONFLICT', '上传请求标识已用于其他文件');
          return this.uploadView(replay);
        }
        if (input.assetId) {
          const asset = this.asset(user, input.assetId, 'edit');
          if (asset.projectId !== projectId) fail(404, 'NOT_FOUND', '素材不属于当前项目');
          if (asset.version !== input.expectedAssetVersion)
            fail(409, 'VERSION_CONFLICT', '素材已有新版本，请刷新后重新选择目标');
        }
        this.database.db
          .insert(storageConnections)
          .values({ id: storageId, kind: 'local', createdAt: new Date().toISOString() })
          .onConflictDoNothing()
          .run();
        const id = randomUUID(),
          now = new Date().toISOString();
        this.database.db
          .insert(mediaUploads)
          .values({
            id,
            projectId,
            workspaceId: project.workspaceId,
            createdBy: user.id,
            createdAt: now,
            updatedAt: now,
            assetId: input.assetId ?? randomUUID(),
            mediaVersionId: randomUUID(),
            expectedAssetVersion: input.expectedAssetVersion,
            storageId,
            fileName: input.fileName,
            declaredMime: input.contentType,
            expectedBytes: input.byteLength,
            idempotencyKey: key,
            generationJobId,
            animaticJobId,
            requestHash,
            state: 'created',
          })
          .run();
        return this.uploadView(
          this.database.db.select().from(mediaUploads).where(eq(mediaUploads.id, id)).get()!,
        );
      },
      { behavior: 'immediate' },
    );
  }
  private uploadRow(user: CurrentUser, id: string, write = false) {
    const row = this.database.db.select().from(mediaUploads).where(eq(mediaUploads.id, id)).get();
    if (!row) fail(404, 'NOT_FOUND', '上传记录不存在或无权访问');
    this.authz.project(user, row.projectId, write ? 'edit' : 'read');
    if (write && row.state !== 'complete') this.resourceAccess.pendingImport(user, row.id);
    if (write && row.createdBy !== user.id) this.authz.project(user, row.projectId, 'manage');
    return row;
  }
  private uploadView(row: Upload) {
    return {
      id: row.id,
      projectId: row.projectId,
      fileName: row.fileName,
      expectedBytes: row.expectedBytes,
      receivedBytes: row.receivedBytes,
      state: row.state,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      assetId: row.assetId,
      expectedAssetVersion: row.expectedAssetVersion,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      mediaVersion:
        row.state === 'complete'
          ? this.view(
              this.database.db
                .select()
                .from(mediaVersions)
                .where(eq(mediaVersions.id, row.mediaVersionId))
                .get()!,
            )
          : null,
    };
  }
  async upload(user: CurrentUser, id: string) {
    let row = this.uploadRow(user, id);
    if (row.state === 'uploading' && (row.leaseUntil ?? 0) < Date.now()) {
      if ((await this.storage.ready()) !== row.storageId)
        throw new StorageFailure('STORAGE_CONNECTION_UNAVAILABLE', '上传使用的存储根尚未恢复');
      const archived = await this.storage.stat(
        `${objectPrefix(row.workspaceId, row.projectId, row.mediaVersionId)}/original.bin`,
      );
      const result = this.database.db
        .update(mediaUploads)
        .set({
          state: archived ? 'needs_reconciliation' : 'failed',
          leaseOwner: null,
          leaseUntil: null,
          errorCode: archived ? 'UPLOAD_ARCHIVE_PENDING' : 'UPLOAD_INTERRUPTED',
          errorMessage: archived
            ? '文件已归档但登记未完成，请核对后重试登记'
            : '上次传输中断，请重新发送文件',
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(mediaUploads.id, id),
            eq(mediaUploads.state, 'uploading'),
            lt(mediaUploads.leaseUntil, Date.now()),
          ),
        )
        .returning()
        .get();
      if (result && row.leaseOwner && !archived)
        await this.storage.discardStaging(row.leaseOwner).catch(() => undefined);
      row = this.uploadRow(user, id);
    }
    return this.uploadView(row);
  }
  private owner(row: Upload, lease: string) {
    const current = this.database.db.select().from(mediaUploads).where(eq(mediaUploads.id, row.id)).get()!;
    if (
      current.state !== 'uploading' ||
      current.leaseOwner !== lease ||
      (current.leaseUntil ?? 0) < Date.now()
    )
      throw new StorageFailure('UPLOAD_LEASE_LOST', '上传执行权已失效，请读取最新状态');
    return current;
  }
  private claim(user: CurrentUser, id: string, reconcile = false) {
    return this.database.db.transaction(
      () => {
        const row = this.uploadRow(user, id, true);
        if (!(
          (reconcile && row.state === 'needs_reconciliation') ||
          (!reconcile && ['created', 'failed'].includes(row.state))
        ))
          fail(409, 'UPLOAD_STATE_CONFLICT', '上传正在执行、已完成或需要核对，请先查看当前状态');
        const active = this.database.db
          .select({ n: count() })
          .from(mediaUploads)
          .where(and(eq(mediaUploads.state, 'uploading'), gt(mediaUploads.leaseUntil, Date.now())))
          .get()!.n;
        const publicActive = this.database.db
          .select({ n: count() })
          .from(workspaceMediaUploads)
          .where(
            and(
              eq(workspaceMediaUploads.state, 'uploading'),
              gt(workspaceMediaUploads.leaseUntil, Date.now()),
            ),
          )
          .get()!.n;
        if (active + publicActive >= 2) fail(429, 'MEDIA_UPLOAD_BUSY', '当前已有两个媒体任务，请稍后重试');
        const lease = randomUUID();
        const updated = this.database.db
          .update(mediaUploads)
          .set({
            state: 'uploading',
            leaseOwner: lease,
            leaseUntil: Date.now() + this.config.mediaUploadTimeoutMs + 120000,
            errorCode: null,
            errorMessage: null,
            receivedBytes: reconcile ? row.receivedBytes : 0,
            preparedJson: reconcile ? row.preparedJson : null,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(mediaUploads.id, id))
          .returning()
          .get()!;
        return { row: updated, lease };
      },
      { behavior: 'immediate' },
    );
  }
  private commit(user: CurrentUser, row: Upload, lease: string, prepared: Prepared) {
    return this.database.db.transaction(
      () => {
        this.owner(row, lease);
        this.authz.project(user, row.projectId, 'edit');
        const imported = this.resourceAccess.pendingImport(user, row.id);
        if (
          imported &&
          (prepared.original.sha256 !== imported.media.sha256 ||
            prepared.original.bytes !== imported.media.byteLength)
        )
          fail(409, 'PUBLIC_IMPORT_CONTENT_MISMATCH', '导入内容与公共素材版本不一致');
        const existing = this.database.db
            .select()
            .from(mediaAssets)
            .where(eq(mediaAssets.id, row.assetId))
            .get(),
          now = new Date().toISOString();
        if (row.expectedAssetVersion === 0) {
          if (existing) fail(409, 'VERSION_CONFLICT', '素材身份已有其他记录');
          this.database.db
            .insert(mediaAssets)
            .values({
              id: row.assetId,
              projectId: row.projectId,
              workspaceId: row.workspaceId,
              name: row.fileName,
              inLibrary:
                !row.generationJobId ||
                this.database.db
                  .select({ shotId: generationJobs.shotId })
                  .from(generationJobs)
                  .where(eq(generationJobs.id, row.generationJobId))
                  .get()?.shotId != null,
              version: 1,
              createdBy: row.createdBy,
              createdAt: now,
              updatedAt: now,
            })
            .run();
        } else {
          if (
            !existing ||
            existing.projectId !== row.projectId ||
            existing.version !== row.expectedAssetVersion
          )
            fail(409, 'VERSION_CONFLICT', '素材版本已变化，归档文件保留待核对');
          this.database.db
            .update(mediaAssets)
            .set({ version: existing.version + 1, updatedAt: now })
            .where(and(eq(mediaAssets.id, row.assetId), eq(mediaAssets.version, row.expectedAssetVersion)))
            .run();
        }
        const prefix = objectPrefix(row.workspaceId, row.projectId, row.mediaVersionId);
        const version = this.database.db
          .insert(mediaVersions)
          .values({
            id: row.mediaVersionId,
            assetId: row.assetId,
            projectId: row.projectId,
            workspaceId: row.workspaceId,
            version: row.expectedAssetVersion + 1,
            storageId: row.storageId,
            objectKey: `${prefix}/original.bin`,
            fileName: row.fileName,
            mediaType: prepared.details.mediaType,
            mime: prepared.details.mime,
            byteLength: prepared.original.bytes,
            sha256: prepared.original.sha256,
            metadataJson: JSON.stringify(prepared.details.metadata),
            posterJson: prepared.details.poster
              ? JSON.stringify({ ...prepared.details.poster, key: `${prefix}/poster.jpg` })
              : null,
            origin: imported
              ? 'workspace_library'
              : row.generationJobId
                ? this.database.db
                    .select({ purpose: generationJobs.purpose })
                    .from(generationJobs)
                    .where(eq(generationJobs.id, row.generationJobId))
                    .get()?.purpose === 'workflow_test'
                  ? 'workflow_test'
                  : 'generation'
                : row.animaticJobId
                  ? 'animatic'
                  : 'manual',
            createdBy: row.createdBy,
            createdAt: now,
          })
          .returning()
          .get()!;
        this.database.db
          .update(mediaUploads)
          .set({
            state: 'complete',
            leaseOwner: null,
            leaseUntil: null,
            receivedBytes: row.expectedBytes,
            updatedAt: now,
          })
          .where(eq(mediaUploads.id, row.id))
          .run();
        this.audit(user, row.workspaceId, 'media.import', version.id);
        return this.uploadView(
          this.database.db.select().from(mediaUploads).where(eq(mediaUploads.id, row.id)).get()!,
        );
      },
      { behavior: 'immediate' },
    );
  }
  private async failed(row: Upload, lease: string, error: unknown, archived: boolean) {
    const current = this.database.db.select().from(mediaUploads).where(eq(mediaUploads.id, row.id)).get();
    if (current?.state !== 'uploading' || current.leaseOwner !== lease) return;
    if (!archived) await this.storage.discardStaging(lease).catch(() => undefined);
    const failure = safeMediaError(error);
    this.database.db
      .update(mediaUploads)
      .set({
        state: archived ? 'needs_reconciliation' : 'failed',
        leaseOwner: null,
        leaseUntil: null,
        errorCode: failure.code,
        errorMessage: failure.message,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(mediaUploads.id, row.id), eq(mediaUploads.leaseOwner, lease)))
      .run();
  }
  async receive(
    user: CurrentUser,
    id: string,
    body: AsyncIterable<Uint8Array>,
    contentLength?: string,
    generation?: {
      jobId?: string;
      animaticJobId?: string;
      mediaType: 'image' | 'video';
      signal: AbortSignal;
    },
  ) {
    const requested = this.uploadRow(user, id, true);
    if (requested.generationJobId !== (generation?.jobId ?? null))
      fail(403, 'GENERATION_UPLOAD_RESERVED', '此上传由生成任务管理');
    if (requested.animaticJobId !== (generation?.animaticJobId ?? null))
      fail(403, 'ANIMATIC_UPLOAD_RESERVED', '此上传由预演任务管理');
    await this.upload(user, id);
    const initial = this.uploadRow(user, id, true);
    if ((await this.storage.ready()) !== initial.storageId)
      throw new StorageFailure('STORAGE_CONNECTION_UNAVAILABLE', '上传使用的存储根尚未恢复');
    if (
      contentLength !== undefined &&
      (!/^\d+$/.test(contentLength) || Number(contentLength) !== initial.expectedBytes)
    )
      fail(400, 'UPLOAD_SIZE_MISMATCH', '请求大小与上传意图不一致');
    const { row, lease } = this.claim(user, id),
      controller = new AbortController();
    let received = 0,
      archived = false;
    const heartbeat = setInterval(() => {
      try {
        this.owner(row, lease);
        this.database.db
          .update(mediaUploads)
          .set({
            leaseUntil: Date.now() + this.config.mediaUploadTimeoutMs + 120000,
            receivedBytes: received,
            updatedAt: new Date().toISOString(),
          })
          .where(and(eq(mediaUploads.id, id), eq(mediaUploads.leaseOwner, lease)))
          .run();
      } catch {
        controller.abort();
      }
    }, 5000);
    try {
      const original = await this.storage.stage(
        lease,
        body,
        { bytes: row.expectedBytes, timeoutMs: this.config.mediaUploadTimeoutMs },
        generation ? AbortSignal.any([controller.signal, generation.signal]) : controller.signal,
        (bytes) => {
          received = bytes;
        },
      );
      this.owner(row, lease);
      this.authz.project(user, row.projectId, 'edit');
      const details = await this.probe.inspect(
        original.key,
        `staging/${lease}/poster.jpg`,
        row.fileName,
        row.declaredMime,
      );
      if (generation && (generation.signal.aborted || details.mediaType !== generation.mediaType))
        throw new StorageFailure('GENERATION_OUTPUT_INVALID', '生成输出类型不符或任务已停止');
      const prepared: Prepared = { original, details };
      this.owner(row, lease);
      this.database.db
        .update(mediaUploads)
        .set({ preparedJson: JSON.stringify(prepared), receivedBytes: received })
        .where(and(eq(mediaUploads.id, id), eq(mediaUploads.leaseOwner, lease)))
        .run();
      await this.storage.publish(lease, objectPrefix(row.workspaceId, row.projectId, row.mediaVersionId));
      archived = true;
      return this.commit(user, row, lease, prepared);
    } catch (error) {
      if (!archived)
        archived = !!(await this.storage
          .stat(`${objectPrefix(row.workspaceId, row.projectId, row.mediaVersionId)}/original.bin`)
          .catch(() => null));
      await this.failed(row, lease, error, archived);
      const failure = safeMediaError(error);
      fail(
        error instanceof HttpException ? error.getStatus() : archived ? 409 : 400,
        failure.code,
        failure.message,
      );
    } finally {
      clearInterval(heartbeat);
    }
  }
  async reconcile(user: CurrentUser, id: string, generationJobId?: string, animaticJobId?: string) {
    if (this.uploadRow(user, id, true).generationJobId !== (generationJobId ?? null))
      fail(403, 'GENERATION_UPLOAD_RESERVED', '此上传由生成任务管理');
    if (this.uploadRow(user, id, true).animaticJobId !== (animaticJobId ?? null))
      fail(403, 'ANIMATIC_UPLOAD_RESERVED', '此上传由预演任务管理');
    await this.upload(user, id);
    const initial = this.uploadRow(user, id, true);
    if ((await this.storage.ready()) !== initial.storageId)
      throw new StorageFailure('STORAGE_CONNECTION_UNAVAILABLE', '原存储连接尚未恢复');
    const { row, lease } = this.claim(user, id, true);
    try {
      if (!row.preparedJson)
        throw new StorageFailure('UPLOAD_EVIDENCE_MISSING', '归档校验依据缺失，需要管理员核查，未登记成功');
      const prepared = JSON.parse(row.preparedJson) as Prepared,
        prefix = objectPrefix(row.workspaceId, row.projectId, row.mediaVersionId),
        actual = await this.storage.digest(`${prefix}/original.bin`);
      if (actual.bytes !== prepared.original.bytes || actual.sha256 !== prepared.original.sha256)
        throw new StorageFailure('MEDIA_INTEGRITY_FAILED', '归档原件校验不一致');
      if (prepared.details.poster) {
        const poster = await this.storage.digest(`${prefix}/poster.jpg`);
        if (
          poster.bytes !== prepared.details.poster.bytes ||
          poster.sha256 !== prepared.details.poster.sha256
        )
          throw new StorageFailure('MEDIA_INTEGRITY_FAILED', '归档封面校验不一致');
      }
      return this.commit(user, row, lease, prepared);
    } catch (error) {
      await this.failed(row, lease, error, true);
      const failure = safeMediaError(error);
      fail(error instanceof HttpException ? error.getStatus() : 409, failure.code, failure.message);
    }
  }
  uploads(user: CurrentUser, projectId: string, cursor?: string) {
    this.authz.project(user, projectId);
    const boundary = cursor
      ? this.database.db
          .select()
          .from(mediaUploads)
          .where(
            and(
              eq(mediaUploads.id, cursor),
              eq(mediaUploads.projectId, projectId),
              eq(mediaUploads.createdBy, user.id),
              isNull(mediaUploads.generationJobId),
              isNull(mediaUploads.animaticJobId),
            ),
          )
          .get()
      : undefined;
    if (cursor && !boundary) fail(400, 'MEDIA_CURSOR_INVALID', '上传记录分页位置无效');
    const rows = this.database.db
      .select()
      .from(mediaUploads)
      .where(
        and(
          eq(mediaUploads.projectId, projectId),
          eq(mediaUploads.createdBy, user.id),
          isNull(mediaUploads.generationJobId),
          isNull(mediaUploads.animaticJobId),
          boundary
            ? or(
                lt(mediaUploads.createdAt, boundary.createdAt),
                and(eq(mediaUploads.createdAt, boundary.createdAt), lt(mediaUploads.id, boundary.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(mediaUploads.createdAt), desc(mediaUploads.id))
      .limit(21)
      .all();
    return {
      items: rows.slice(0, 20).map((row) => this.uploadView(row)),
      nextCursor: rows.length > 20 ? rows[19].id : null,
    };
  }
  assets(user: CurrentUser, projectId: string, cursor?: string) {
    this.authz.project(user, projectId);
    const productionAsset = and(
      eq(mediaAssets.inLibrary, true),
      notExists(
        this.database.db
          .select({ id: mediaVersions.id })
          .from(mediaVersions)
          .where(
            and(
              eq(mediaVersions.assetId, mediaAssets.id),
              eq(mediaVersions.version, 1),
              eq(mediaVersions.origin, 'workflow_test'),
            ),
          ),
      ),
    );
    const boundary = cursor
      ? this.database.db
          .select()
          .from(mediaAssets)
          .where(and(eq(mediaAssets.id, cursor), eq(mediaAssets.projectId, projectId), productionAsset))
          .get()
      : undefined;
    if (cursor && !boundary) fail(400, 'MEDIA_CURSOR_INVALID', '素材分页位置无效');
    const rows = this.database.db
      .select()
      .from(mediaAssets)
      .where(
        and(
          eq(mediaAssets.projectId, projectId),
          productionAsset,
          boundary
            ? or(
                lt(mediaAssets.createdAt, boundary.createdAt),
                and(eq(mediaAssets.createdAt, boundary.createdAt), lt(mediaAssets.id, boundary.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(mediaAssets.createdAt), desc(mediaAssets.id))
      .limit(21)
      .all();
    return {
      items: rows.slice(0, 20).map((row) => ({
        id: row.id,
        name: row.name,
        version: row.version,
        latest: this.view(
          this.database.db
            .select()
            .from(mediaVersions)
            .where(and(eq(mediaVersions.assetId, row.id), eq(mediaVersions.version, row.version)))
            .get()!,
        ),
      })),
      nextCursor: rows.length > 20 ? rows[19].id : null,
    };
  }
  versions(user: CurrentUser, assetId: string, before?: number) {
    this.asset(user, assetId);
    const rows = this.database.db
      .select()
      .from(mediaVersions)
      .where(and(eq(mediaVersions.assetId, assetId), before ? lt(mediaVersions.version, before) : undefined))
      .orderBy(desc(mediaVersions.version))
      .limit(21)
      .all();
    return {
      items: rows.slice(0, 20).map((row) => this.view(row)),
      nextCursor: rows.length > 20 ? rows[19].version : null,
    };
  }
  takeList(user: CurrentUser, shotId: string, before?: number) {
    return this.database.db.transaction(() => {
      const shot = this.production.shot(user, shotId);
      const project = this.authz.project(user, shot.projectId);
      const rows = this.database.db
        .select()
        .from(takes)
        .where(and(eq(takes.shotId, shotId), before ? lt(takes.takeNo, before) : undefined))
        .orderBy(desc(takes.takeNo))
        .limit(21)
        .all();
      return {
        items: rows.slice(0, 20).map((row) => ({
          ...row,
          media: this.version(user, row.mediaVersionId),
          review: takeReviewState(this.database, row.id, shot.version, project.version),
        })),
        nextCursor: rows.length > 20 ? rows[19].takeNo : null,
      };
    });
  }
  addTake(user: CurrentUser, shotId: string, mediaVersionId: string, expectedShotVersion: number) {
    return this.database.db.transaction(
      () => {
        const shot = this.production.shot(user, shotId, 'edit');
        const version = this.version(user, mediaVersionId);
        if (version.projectId !== shot.projectId) fail(404, 'NOT_FOUND', '媒体版本不属于当前项目');
        if (version.origin === 'workflow_test') fail(409, 'WORKFLOW_TEST_MEDIA', '试跑证据不能加入生产候选');
        const old = this.database.db
          .select()
          .from(takes)
          .where(and(eq(takes.shotId, shotId), eq(takes.mediaVersionId, mediaVersionId)))
          .get();
        if (old) return { ...old, media: version };
        if (shot.version !== expectedShotVersion)
          fail(409, 'VERSION_CONFLICT', '镜头已有新版本，请刷新后再关联候选');
        const number = this.database.db
          .select({ n: sql<number>`coalesce(max(${takes.takeNo}),0)+1` })
          .from(takes)
          .where(eq(takes.shotId, shotId))
          .get()!.n;
        const row = this.database.db
          .insert(takes)
          .values({
            id: randomUUID(),
            shotId,
            projectId: shot.projectId,
            workspaceId: shot.workspaceId,
            mediaVersionId,
            takeNo: number,
            state: 'draft',
            createdBy: user.id,
            createdAt: new Date().toISOString(),
          })
          .returning()
          .get()!;
        this.audit(user, shot.workspaceId, 'take.import', row.id);
        return { ...row, media: version };
      },
      { behavior: 'immediate' },
    );
  }
  async content(user: CurrentUser, id: string, poster: boolean, rangeHeader?: string) {
    const row = this.database.db.select().from(mediaVersions).where(eq(mediaVersions.id, id)).get();
    if (!row) fail(404, 'NOT_FOUND', '媒体版本不存在或无权访问');
    const authorize = () => {
      this.authz.project(user, row.projectId);
      assertSampleAccess(this.database, user, row);
    };
    return this.openContent(row, poster, rangeHeader, authorize);
  }
  async openContent(
    row: ArchivedMedia,
    poster: boolean,
    rangeHeader: string | undefined,
    authorize: () => void,
  ) {
    authorize();
    if ((await this.storage.ready()) !== row.storageId)
      throw new StorageFailure('STORAGE_CONNECTION_UNAVAILABLE', '此媒体的原存储根尚未恢复');
    const file =
      poster && row.posterJson
        ? (JSON.parse(row.posterJson) as { key: string; bytes: number; sha256: string; mime: string })
        : !poster
          ? { key: row.objectKey, bytes: row.byteLength, sha256: row.sha256, mime: row.mime }
          : null;
    if (!file) fail(404, 'NOT_FOUND', '此媒体没有封面');
    let range: { start: number; end: number } | undefined;
    if (rangeHeader) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
      if (!match || (!match[1] && !match[2]))
        fail(416, 'RANGE_INVALID', '仅支持单段字节范围', { bytes: file.bytes });
      const start = match[1] ? Number(match[1]) : Math.max(0, file.bytes - Number(match[2])),
        end = match[1]
          ? match[2]
            ? Math.min(Number(match[2]), file.bytes - 1)
            : file.bytes - 1
          : file.bytes - 1;
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start < 0 ||
        start >= file.bytes ||
        end < start ||
        (!match[1] && Number(match[2]) <= 0)
      )
        fail(416, 'RANGE_INVALID', '字节范围不可满足', { bytes: file.bytes });
      range = { start, end };
    }
    const stream = await this.storage.openVerified(
      file.key,
      { bytes: file.bytes, sha256: file.sha256 },
      range,
    );
    try {
      authorize();
      return {
        stream,
        mime: file.mime,
        total: file.bytes,
        sha256: file.sha256,
        range,
        length: range ? range.end - range.start + 1 : file.bytes,
        fileName: poster ? `poster-${row.id}.jpg` : row.fileName,
        id: row.id,
      };
    } catch (error) {
      stream.destroy();
      throw error;
    }
  }
}
