import { HttpException, Injectable } from '@nestjs/common';
import { and, count, eq, gt, lt, ne } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { CurrentUser, fail } from '../common/http';
import { AppConfig } from '../config';
import { DatabaseService } from '../db/database.service';
import {
  auditEvents,
  mediaUploads,
  storageConnections,
  workspaceMediaFiles as files,
  workspaceMediaFolders as folders,
  workspaceMediaUploads as uploads,
  workspaceNativeResources as resources,
} from '../db/schema';
import { AuthorizationService } from '../production/authorization.service';
import { LocalStorage, StorageFailure, workspaceObjectPrefix } from '../storage/local-storage';
import { MediaProbe, type MediaDetails } from './media-probe';
import { safeMediaError } from './media.service';
import type { WorkspaceUploadInput } from './workspace-upload.contract';
type Upload = typeof uploads.$inferSelect;
type Prepared = { original: { bytes: number; sha256: string }; details: MediaDetails };
@Injectable()
export class WorkspaceUploadService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
    private readonly storage: LocalStorage,
    private readonly probe: MediaProbe,
    private readonly config: AppConfig,
  ) {}
  private row(user: CurrentUser, workspaceId: string, id: string) {
    const member = this.authz.workspace(user, workspaceId);
    const row = this.database.db
      .select()
      .from(uploads)
      .where(and(eq(uploads.id, id), eq(uploads.workspaceId, workspaceId)))
      .get();
    if (!row || (row.createdBy !== user.id && member.role === 'MEMBER'))
      fail(404, 'NOT_FOUND', '上传记录不存在或无权访问');
    return row;
  }
  private view(row: Upload) {
    return {
      id: row.id,
      fileName: row.fileName,
      expectedBytes: row.expectedBytes,
      receivedBytes: row.receivedBytes,
      state: row.state,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      resourceId: row.state === 'complete' ? row.resourceId : null,
      removed:
        row.state === 'complete'
          ? !!this.database.db
              .select({ removedAt: resources.removedAt })
              .from(resources)
              .where(eq(resources.id, row.resourceId))
              .get()?.removedAt
          : false,
    };
  }
  async status(user: CurrentUser, workspaceId: string) {
    this.authz.workspace(user, workspaceId);
    try {
      await this.storage.ready();
      await this.probe.ready();
      return {
        available: true,
        maxBytes: this.config.mediaMaxBytes,
        formats: 'PNG/JPEG/WebP、MP4/MOV/WebM、WAV/MP3/OGG',
      };
    } catch (error) {
      return { available: false, maxBytes: this.config.mediaMaxBytes, error: safeMediaError(error) };
    }
  }
  async initiate(user: CurrentUser, workspaceId: string, input: WorkspaceUploadInput, key: string) {
    this.authz.workspace(user, workspaceId);
    if (input.byteLength > this.config.mediaMaxBytes)
      fail(413, 'MEDIA_SIZE_LIMIT', '文件超过当前媒体上传限制');
    const hash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const previous = () =>
      this.database.db
        .select()
        .from(uploads)
        .where(
          and(
            eq(uploads.workspaceId, workspaceId),
            eq(uploads.createdBy, user.id),
            eq(uploads.idempotencyKey, key),
          ),
        )
        .get();
    const old = previous();
    if (old) {
      if (old.requestHash !== hash) fail(409, 'IDEMPOTENCY_CONFLICT', '上传请求标识已用于其他文件');
      return this.upload(user, workspaceId, old.id);
    }
    const storageId = await this.storage.ready();
    await this.probe.ready();
    return this.database.db.transaction(
      () => {
        this.authz.workspace(user, workspaceId);
        const replay = previous();
        if (replay) {
          if (replay.requestHash !== hash) fail(409, 'IDEMPOTENCY_CONFLICT', '上传请求标识已用于其他文件');
          return this.view(replay);
        }
        if (
          input.folderId &&
          !this.database.db
            .select({ id: folders.id })
            .from(folders)
            .where(and(eq(folders.id, input.folderId), eq(folders.workspaceId, workspaceId)))
            .get()
        )
          fail(400, 'LIBRARY_FOLDER_UNAVAILABLE', '文件夹已移除或不可用');
        this.database.db
          .insert(storageConnections)
          .values({ id: storageId, kind: 'local', createdAt: new Date().toISOString() })
          .onConflictDoNothing()
          .run();
        const now = new Date().toISOString(),
          row = {
            id: randomUUID(),
            workspaceId,
            fileId: randomUUID(),
            resourceId: randomUUID(),
            folderId: input.folderId,
            storageId,
            fileName: input.fileName,
            declaredMime: input.contentType,
            expectedBytes: input.byteLength,
            createdBy: user.id,
            createdAt: now,
            updatedAt: now,
            idempotencyKey: key,
            requestHash: hash,
          };
        this.database.db.insert(uploads).values(row).run();
        return this.view(this.row(user, workspaceId, row.id));
      },
      { behavior: 'immediate' },
    );
  }
  async upload(user: CurrentUser, workspaceId: string, id: string) {
    let row = this.row(user, workspaceId, id);
    if (row.state === 'uploading' && (row.leaseUntil ?? 0) < Date.now()) {
      if ((await this.storage.ready()) !== row.storageId)
        throw new StorageFailure('STORAGE_CONNECTION_UNAVAILABLE', '原存储连接尚未恢复');
      const archived = await this.storage.stat(
        `${workspaceObjectPrefix(workspaceId, row.fileId)}/original.bin`,
      );
      const changed = this.database.db
        .update(uploads)
        .set({
          state: archived ? 'needs_reconciliation' : 'failed',
          leaseOwner: null,
          leaseUntil: null,
          errorCode: archived ? 'UPLOAD_ARCHIVE_PENDING' : 'UPLOAD_INTERRUPTED',
          errorMessage: archived ? '文件已归档，需重试登记' : '上次上传已中断，请重新发送同一文件',
          updatedAt: new Date().toISOString(),
        })
        .where(and(eq(uploads.id, id), eq(uploads.state, 'uploading'), lt(uploads.leaseUntil, Date.now())))
        .returning()
        .get();
      if (changed && row.leaseOwner && !archived)
        await this.storage.discardStaging(row.leaseOwner).catch(() => undefined);
      row = this.row(user, workspaceId, id);
    }
    return this.view(row);
  }
  list(user: CurrentUser, workspaceId: string, cursor?: string) {
    this.authz.workspace(user, workspaceId);
    const rows = this.database.db
      .select()
      .from(uploads)
      .where(
        and(
          eq(uploads.workspaceId, workspaceId),
          eq(uploads.createdBy, user.id),
          ne(uploads.state, 'complete'),
          cursor ? gt(uploads.id, cursor) : undefined,
        ),
      )
      .orderBy(uploads.id)
      .limit(21)
      .all();
    return {
      items: rows.slice(0, 20).map((row) => this.view(row)),
      nextCursor: rows.length > 20 ? rows[19].id : null,
    };
  }
  private owner(row: Upload, lease: string) {
    const value = this.database.db.select().from(uploads).where(eq(uploads.id, row.id)).get()!;
    if (value.state !== 'uploading' || value.leaseOwner !== lease || (value.leaseUntil ?? 0) < Date.now())
      throw new StorageFailure('UPLOAD_LEASE_LOST', '上传执行权已失效，请读取最新状态');
  }
  private claim(user: CurrentUser, workspaceId: string, id: string, reconcile = false) {
    return this.database.db.transaction(
      () => {
        const row = this.row(user, workspaceId, id);
        if (!(reconcile ? row.state === 'needs_reconciliation' : ['created', 'failed'].includes(row.state)))
          fail(409, 'UPLOAD_STATE_CONFLICT', '上传正在执行、已完成或需要重试登记');
        const now = Date.now();
        const active =
          this.database.db
            .select({ n: count() })
            .from(uploads)
            .where(and(eq(uploads.state, 'uploading'), gt(uploads.leaseUntil, now)))
            .get()!.n +
          this.database.db
            .select({ n: count() })
            .from(mediaUploads)
            .where(and(eq(mediaUploads.state, 'uploading'), gt(mediaUploads.leaseUntil, now)))
            .get()!.n;
        if (active >= 2) fail(429, 'MEDIA_UPLOAD_BUSY', '当前已有两个媒体任务，请稍后重试');
        const lease = randomUUID();
        const updated = this.database.db
          .update(uploads)
          .set({
            state: 'uploading',
            leaseOwner: lease,
            leaseUntil: now + this.config.mediaUploadTimeoutMs + 120000,
            errorCode: null,
            errorMessage: null,
            receivedBytes: reconcile ? row.receivedBytes : 0,
            preparedJson: reconcile ? row.preparedJson : null,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(uploads.id, id))
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
        this.row(user, row.workspaceId, row.id);
        const prefix = workspaceObjectPrefix(row.workspaceId, row.fileId),
          now = new Date().toISOString();
        const folderId =
          row.folderId &&
          this.database.db
            .select({ id: folders.id })
            .from(folders)
            .where(and(eq(folders.id, row.folderId), eq(folders.workspaceId, row.workspaceId)))
            .get()
            ? row.folderId
            : null;
        this.database.db
          .insert(files)
          .values({
            id: row.fileId,
            workspaceId: row.workspaceId,
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
            createdBy: row.createdBy,
            createdAt: now,
          })
          .run();
        this.database.db
          .insert(resources)
          .values({
            id: row.resourceId,
            fileId: row.fileId,
            workspaceId: row.workspaceId,
            folderId,
            createdBy: row.createdBy,
            createdAt: now,
          })
          .run();
        const updated = this.database.db
          .update(uploads)
          .set({
            state: 'complete',
            receivedBytes: row.expectedBytes,
            leaseOwner: null,
            leaseUntil: null,
            errorCode: null,
            errorMessage: null,
            updatedAt: now,
          })
          .where(and(eq(uploads.id, row.id), eq(uploads.leaseOwner, lease)))
          .returning()
          .get()!;
        this.database.db
          .insert(auditEvents)
          .values({
            id: randomUUID(),
            workspaceId: row.workspaceId,
            actorId: user.id,
            action: 'public.media.upload',
            targetId: row.resourceId,
            createdAt: now,
          })
          .run();
        return this.view(updated);
      },
      { behavior: 'immediate' },
    );
  }
  private async failed(row: Upload, lease: string, error: unknown, archived: boolean) {
    if (!archived) await this.storage.discardStaging(lease).catch(() => undefined);
    const failure = safeMediaError(error);
    this.database.db
      .update(uploads)
      .set({
        state: archived ? 'needs_reconciliation' : 'failed',
        leaseOwner: null,
        leaseUntil: null,
        errorCode: failure.code,
        errorMessage: failure.message,
        updatedAt: new Date().toISOString(),
      })
      .where(and(eq(uploads.id, row.id), eq(uploads.leaseOwner, lease)))
      .run();
    fail(
      error instanceof HttpException ? error.getStatus() : archived ? 409 : 400,
      failure.code,
      failure.message,
    );
  }
  async receive(
    user: CurrentUser,
    workspaceId: string,
    id: string,
    body: AsyncIterable<Uint8Array>,
    contentLength?: string,
  ) {
    await this.upload(user, workspaceId, id);
    const initial = this.row(user, workspaceId, id);
    if ((await this.storage.ready()) !== initial.storageId)
      throw new StorageFailure('STORAGE_CONNECTION_UNAVAILABLE', '原存储连接尚未恢复');
    if (
      contentLength !== undefined &&
      (!/^\d+$/.test(contentLength) || Number(contentLength) !== initial.expectedBytes)
    )
      fail(400, 'UPLOAD_SIZE_MISMATCH', '请求大小与上传意图不一致');
    const { row, lease } = this.claim(user, workspaceId, id),
      controller = new AbortController();
    let received = 0,
      archived = false;
    const heartbeat = setInterval(() => {
      try {
        this.owner(row, lease);
        this.row(user, workspaceId, id);
        this.database.db
          .update(uploads)
          .set({
            leaseUntil: Date.now() + this.config.mediaUploadTimeoutMs + 120000,
            receivedBytes: received,
            updatedAt: new Date().toISOString(),
          })
          .where(and(eq(uploads.id, id), eq(uploads.leaseOwner, lease)))
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
        controller.signal,
        (bytes) => {
          received = bytes;
        },
      );
      this.owner(row, lease);
      this.row(user, workspaceId, id);
      const details = await this.probe.inspect(
        original.key,
        `staging/${lease}/poster.jpg`,
        row.fileName,
        row.declaredMime,
      );
      this.owner(row, lease);
      this.row(user, workspaceId, id);
      const prepared = { original, details };
      this.database.db
        .update(uploads)
        .set({ preparedJson: JSON.stringify(prepared), receivedBytes: received })
        .where(and(eq(uploads.id, id), eq(uploads.leaseOwner, lease)))
        .run();
      await this.storage.publish(lease, workspaceObjectPrefix(workspaceId, row.fileId));
      archived = true;
      return this.commit(user, row, lease, prepared);
    } catch (error) {
      if (!archived)
        archived = !!(await this.storage
          .stat(`${workspaceObjectPrefix(workspaceId, row.fileId)}/original.bin`)
          .catch(() => null));
      return await this.failed(row, lease, error, archived);
    } finally {
      clearInterval(heartbeat);
    }
  }
  async reconcile(user: CurrentUser, workspaceId: string, id: string) {
    await this.upload(user, workspaceId, id);
    const initial = this.row(user, workspaceId, id);
    if ((await this.storage.ready()) !== initial.storageId)
      throw new StorageFailure('STORAGE_CONNECTION_UNAVAILABLE', '原存储连接尚未恢复');
    const { row, lease } = this.claim(user, workspaceId, id, true);
    try {
      if (!row.preparedJson)
        throw new StorageFailure('UPLOAD_EVIDENCE_MISSING', '归档校验依据缺失，需管理员核查');
      const prepared = JSON.parse(row.preparedJson) as Prepared,
        prefix = workspaceObjectPrefix(workspaceId, row.fileId),
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
      return await this.failed(row, lease, error, true);
    }
  }
}
