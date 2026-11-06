import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, isNull, like, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { CurrentUser, fail } from '../common/http';
import { DatabaseService } from '../db/database.service';
import {
  auditEvents,
  mediaUploads,
  mediaVersions,
  workspaceMediaFolders as folders,
  workspaceMediaImports as imports,
  workspaceMediaResources as resources,
  workspaceMediaFiles,
  workspaceNativeResources as nativeResources,
  workspaceNativeImports,
} from '../db/schema';
import { AuthorizationService } from '../production/authorization.service';
import { MediaService } from './media.service';
import { ResourceAccessService } from './resource-access.service';
import { uploadInput } from './media-contract';
export type LibraryScope = string | { workspaceId: string };

@Injectable()
export class WorkspaceLibraryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
    private readonly access: ResourceAccessService,
    private readonly media: MediaService,
  ) {}
  private context(user: CurrentUser, scope: LibraryScope) {
    const workspaceId =
      typeof scope === 'string' ? this.authz.project(user, scope).workspaceId : scope.workspaceId;
    return { workspaceId, member: this.authz.workspace(user, workspaceId) };
  }
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
  private folder(workspaceId: string, id: string) {
    const row = this.database.db
      .select()
      .from(folders)
      .where(and(eq(folders.id, id), eq(folders.workspaceId, workspaceId)))
      .get();
    if (!row) fail(400, 'LIBRARY_FOLDER_UNAVAILABLE', '文件夹已移除或不可用');
    return row;
  }
  listFolders(user: CurrentUser, projectId: LibraryScope) {
    const { workspaceId } = this.context(user, projectId);
    return this.database.db
      .select({ id: folders.id, name: folders.name, version: folders.version })
      .from(folders)
      .where(eq(folders.workspaceId, workspaceId))
      .orderBy(asc(folders.nameKey))
      .all();
  }
  changeFolder(
    user: CurrentUser,
    projectId: LibraryScope,
    input: { name?: string; id?: string; expectedVersion?: number; remove?: boolean },
    key?: string,
  ) {
    return this.database.db.transaction(
      () => {
        const { workspaceId } = this.context(user, projectId);
        this.authz.workspace(user, workspaceId, true);
        const row = input.id ? this.folder(workspaceId, input.id) : undefined;
        if (row && row.version !== input.expectedVersion)
          fail(409, 'VERSION_CONFLICT', '文件夹已更新，请刷新后重试');
        if (row && input.remove) {
          this.database.db
            .update(resources)
            .set({ folderId: null, version: sql`${resources.version}+1` })
            .where(eq(resources.folderId, row.id))
            .run();
          this.database.db
            .update(nativeResources)
            .set({ folderId: null, version: sql`${nativeResources.version}+1` })
            .where(eq(nativeResources.folderId, row.id))
            .run();
          this.database.db.delete(folders).where(eq(folders.id, row.id)).run();
          this.audit(user, workspaceId, 'public.folder.remove', row.id);
          return { removed: true };
        }
        const name = input.name!,
          nameKey = name.toLowerCase();
        if (!row) {
          const replay = this.database.db
            .select()
            .from(folders)
            .where(
              and(
                eq(folders.workspaceId, workspaceId),
                eq(folders.createdBy, user.id),
                eq(folders.creationKey, key!),
              ),
            )
            .get();
          if (replay) {
            if (replay.nameKey !== nameKey) fail(409, 'IDEMPOTENCY_CONFLICT', '请求标识已用于其他文件夹');
            return { id: replay.id, name: replay.name, version: replay.version };
          }
          if (this.listFolders(user, projectId).length >= 100)
            fail(409, 'FOLDER_LIMIT', '每个公共库最多 100 个文件夹');
        }
        const duplicate = this.database.db
          .select()
          .from(folders)
          .where(and(eq(folders.workspaceId, workspaceId), eq(folders.nameKey, nameKey)))
          .get();
        if (duplicate && duplicate.id !== row?.id) fail(409, 'FOLDER_NAME_EXISTS', '公共库中已有同名文件夹');
        const result = { id: row?.id ?? randomUUID(), name, version: (row?.version ?? 0) + 1 };
        if (row)
          this.database.db
            .update(folders)
            .set({ name, nameKey, version: result.version })
            .where(eq(folders.id, row.id))
            .run();
        else
          this.database.db
            .insert(folders)
            .values({ ...result, nameKey, workspaceId, createdBy: user.id, creationKey: key! })
            .run();
        this.audit(user, workspaceId, row ? 'public.folder.rename' : 'public.folder.create', result.id);
        return result;
      },
      { behavior: 'immediate' },
    );
  }
  list(
    user: CurrentUser,
    scope: LibraryScope,
    query: { folderId?: string; q?: string; mediaType?: 'image' | 'video' | 'audio'; cursor?: string },
  ) {
    const { workspaceId, member } = this.context(user, scope);
    const projectId = typeof scope === 'string' ? scope : undefined;
    const base = projectId
      ? `/api/v1/projects/${projectId}/public-library`
      : `/api/v1/workspaces/${workspaceId}/public-library`;
    if (query.folderId && query.folderId !== 'root') this.folder(workspaceId, query.folderId);
    const legacyRows = this.database.db
      .select({ resource: resources, media: mediaVersions })
      .from(resources)
      .innerJoin(mediaVersions, eq(mediaVersions.id, resources.sourceMediaVersionId))
      .where(
        and(
          this.access.publicVisibility(workspaceId),
          query.folderId === 'root'
            ? isNull(resources.folderId)
            : query.folderId
              ? eq(resources.folderId, query.folderId)
              : undefined,
          query.cursor ? gt(resources.id, query.cursor) : undefined,
          query.q?.trim() ? like(mediaVersions.fileName, `%${query.q.trim()}%`) : undefined,
          query.mediaType ? eq(mediaVersions.mediaType, query.mediaType) : undefined,
        ),
      )
      .orderBy(asc(resources.id))
      .limit(21)
      .all();
    const nativeRows = this.database.db
      .select({ resource: nativeResources, media: workspaceMediaFiles })
      .from(nativeResources)
      .innerJoin(workspaceMediaFiles, eq(workspaceMediaFiles.id, nativeResources.fileId))
      .where(
        and(
          eq(nativeResources.workspaceId, workspaceId),
          isNull(nativeResources.removedAt),
          query.folderId === 'root'
            ? isNull(nativeResources.folderId)
            : query.folderId
              ? eq(nativeResources.folderId, query.folderId)
              : undefined,
          query.cursor ? gt(nativeResources.id, query.cursor) : undefined,
          query.q?.trim() ? like(workspaceMediaFiles.fileName, `%${query.q.trim()}%`) : undefined,
          query.mediaType ? eq(workspaceMediaFiles.mediaType, query.mediaType) : undefined,
        ),
      )
      .orderBy(asc(nativeResources.id))
      .limit(21)
      .all()
      .map((row) => ({ ...row, resource: { ...row.resource, sourceProjectId: null } }));
    const rows = [...legacyRows, ...nativeRows]
      .sort((a, b) => a.resource.id.localeCompare(b.resource.id))
      .slice(0, 21);
    return {
      workspaceId,
      canManageFolders: member.role !== 'MEMBER',
      items: rows.slice(0, 20).map(({ resource, media }) => ({
        id: resource.id,
        version: resource.version,
        folderId: resource.folderId,
        title: media.fileName,
        mediaType: media.mediaType,
        mime: media.mime,
        metadata: JSON.parse(media.metadataJson),
        byteLength: media.byteLength,
        canManage: member.role !== 'MEMBER' || resource.createdBy === user.id,
        inProject:
          !!projectId &&
          (resource.sourceProjectId === projectId ||
            this.inProject(projectId, resource.id, resource.sourceProjectId === null)),
        contentUrl: `${base}/resources/${resource.id}/content`,
        posterUrl: media.posterJson ? `${base}/resources/${resource.id}/poster` : null,
      })),
      nextCursor: rows.length > 20 ? rows[19].resource.id : null,
    };
  }
  private inProject(projectId: string, resourceId: string, native: boolean) {
    const table = native ? workspaceNativeImports : imports;
    return !!this.database.db
      .select({ id: table.id })
      .from(table)
      .innerJoin(mediaUploads, eq(mediaUploads.id, table.uploadId))
      .where(
        and(
          eq(table.resourceId, resourceId),
          eq(table.projectId, projectId),
          eq(mediaUploads.state, 'complete'),
        ),
      )
      .get();
  }
  collect(user: CurrentUser, projectId: string, sourceId: string, folderId: string | null, key: string) {
    return this.database.db.transaction(
      () => {
        const { workspaceId } = this.context(user, projectId);
        const media = this.database.db
          .select()
          .from(mediaVersions)
          .where(and(eq(mediaVersions.id, sourceId), eq(mediaVersions.projectId, projectId)))
          .get();
        if (!media) fail(404, 'NOT_FOUND', '源素材不存在或无权访问');
        this.authz.project(user, projectId, 'edit');
        if (media.createdBy !== user.id) this.authz.project(user, projectId, 'manage');
        this.access.shareable(media);
        if (folderId) this.folder(workspaceId, folderId);
        const replay = this.database.db
          .select()
          .from(resources)
          .where(
            and(
              eq(resources.workspaceId, workspaceId),
              eq(resources.createdBy, user.id),
              eq(resources.creationKey, key),
            ),
          )
          .get();
        if (replay) {
          if (replay.sourceMediaVersionId !== sourceId || replay.folderId !== folderId)
            fail(409, 'IDEMPOTENCY_CONFLICT', '请求标识已用于其他收录');
          if (replay.removedAt) fail(409, 'PUBLIC_RESOURCE_REMOVED', '此前收录已移除，请刷新后重新收录');
          return { id: replay.id };
        }
        const existing = this.database.db
          .select()
          .from(resources)
          .where(
            and(
              eq(resources.workspaceId, workspaceId),
              eq(resources.sourceMediaVersionId, sourceId),
              isNull(resources.removedAt),
            ),
          )
          .get();
        if (existing) return { id: existing.id };
        const id = randomUUID();
        this.database.db
          .insert(resources)
          .values({
            id,
            workspaceId,
            sourceMediaVersionId: sourceId,
            sourceProjectId: projectId,
            folderId,
            createdBy: user.id,
            creationKey: key,
            createdAt: new Date().toISOString(),
          })
          .run();
        this.audit(user, workspaceId, 'public.resource.collect', id);
        return { id };
      },
      { behavior: 'immediate' },
    );
  }
  change(
    user: CurrentUser,
    projectId: LibraryScope,
    id: string,
    expectedVersion: number,
    folderId?: string | null,
  ) {
    return this.database.db.transaction(
      () => {
        const { workspaceId } = this.context(user, projectId);
        const { resource, native } = this.access.publicMedia(user, id, 'manage');
        const table = native ? nativeResources : resources;
        if (resource.workspaceId !== workspaceId) fail(404, 'NOT_FOUND', '公共素材不存在或无权访问');
        if (resource.version !== expectedVersion)
          fail(409, 'VERSION_CONFLICT', '公共素材已更新，请刷新后重试');
        if (folderId) this.folder(workspaceId, folderId);
        this.database.db
          .update(table)
          .set({
            version: expectedVersion + 1,
            ...(folderId === undefined ? { removedAt: new Date().toISOString() } : { folderId }),
          })
          .where(eq(table.id, id))
          .run();
        this.audit(
          user,
          workspaceId,
          folderId === undefined ? 'public.resource.remove' : 'public.resource.move',
          id,
        );
        return { version: expectedVersion + 1 };
      },
      { behavior: 'immediate' },
    );
  }
  async content(user: CurrentUser, projectId: LibraryScope, id: string, poster: boolean, range?: string) {
    const authorize = () => {
      const { workspaceId } = this.context(user, projectId);
      const value = this.access.publicMedia(user, id);
      if (value.resource.workspaceId !== workspaceId) fail(404, 'NOT_FOUND', '公共素材不存在或无权访问');
      return value;
    };
    const value = authorize();
    return this.media.openContent(value.media, poster, range, authorize);
  }
  async import(user: CurrentUser, projectId: string, id: string, key: string) {
    const project = this.authz.project(user, projectId, 'edit');
    const getRecord = (table: typeof imports | typeof workspaceNativeImports) =>
      this.database.db
        .select()
        .from(table)
        .where(and(eq(table.projectId, projectId), eq(table.createdBy, user.id), eq(table.creationKey, key)))
        .get();
    let record = getRecord(imports) ?? getRecord(workspaceNativeImports);
    if (record && record.resourceId !== id) fail(409, 'IDEMPOTENCY_CONFLICT', '请求标识已用于其他导入');
    if (record) {
      const current = await this.media.upload(user, record.uploadId);
      if (current.state === 'complete') return current.mediaVersion!;
    }
    const { media, resource, native } = this.access.publicMedia(user, id);
    const importTable = native ? workspaceNativeImports : imports;
    if (resource.workspaceId !== project.workspaceId) fail(404, 'NOT_FOUND', '公共素材不属于当前工作区');
    if (!record) {
      const hex = createHash('sha256').update(`public-import:${user.id}:${projectId}:${key}`).digest('hex');
      const uploadKey = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
      const upload = await this.media.initiate(
        user,
        projectId,
        uploadInput.parse({
          fileName: media.fileName,
          byteLength: media.byteLength,
          contentType: media.mime,
        }),
        uploadKey,
      );
      record = this.database.db.transaction(
        () => {
          this.authz.project(user, projectId, 'edit');
          this.access.publicMedia(user, id);
          const old = getRecord(imports) ?? getRecord(workspaceNativeImports);
          if (old) {
            if (old.resourceId !== id) fail(409, 'IDEMPOTENCY_CONFLICT', '请求标识已用于其他导入');
            return old;
          }
          const row = {
            id: randomUUID(),
            resourceId: id,
            projectId,
            workspaceId: project.workspaceId,
            uploadId: upload.id,
            createdBy: user.id,
            creationKey: key,
            createdAt: new Date().toISOString(),
          };
          this.database.db.insert(importTable).values(row).run();
          this.audit(user, project.workspaceId, 'public.resource.import', row.id);
          return row;
        },
        { behavior: 'immediate' },
      );
    }
    const current = await this.media.upload(user, record.uploadId);
    if (current.state === 'complete') return current.mediaVersion!;
    if (current.state === 'needs_reconciliation')
      return (await this.media.reconcile(user, record.uploadId)).mediaVersion!;
    const file = await this.content(user, projectId, id, false);
    try {
      return (await this.media.receive(user, record.uploadId, file.stream, String(file.total))).mediaVersion!;
    } finally {
      file.stream.destroy();
    }
  }
}
