import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, like, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { CurrentUser, fail } from '../common/http';
import { DatabaseService } from '../db/database.service';
import {
  assetEntities,
  assetEntityRevisions,
  auditEvents,
  mediaUploads,
  mediaVersions,
  workspaceEntityResources as resources,
  workspaceEntityImports as imports,
  workspaceEntityImportMedia as copies,
  workspaceMediaFolders as folders,
} from '../db/schema';
import { AuthorizationService } from '../production/authorization.service';
import { ResourceAccessService } from './resource-access.service';
import { MediaService } from './media.service';
import { EntitiesService } from './entities.service';
import { entityBody } from './entity-contract';
import { entityRevisionSnapshot } from './entity-references';
import { uploadInput } from './media-contract';
import type { LibraryScope } from './workspace-library.service';
const requestKey = (value: string) => {
  const h = createHash('sha256').update(value).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
@Injectable()
export class WorkspaceEntitiesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
    private readonly access: ResourceAccessService,
    private readonly media: MediaService,
    private readonly entities: EntitiesService,
  ) {}
  private context(user: CurrentUser, scope: LibraryScope) {
    const workspaceId =
      typeof scope === 'string' ? this.authz.project(user, scope).workspaceId : scope.workspaceId;
    return { workspaceId, member: this.authz.workspace(user, workspaceId) };
  }
  private folder(workspaceId: string, id: string) {
    if (
      !this.database.db
        .select({ id: folders.id })
        .from(folders)
        .where(and(eq(folders.id, id), eq(folders.workspaceId, workspaceId)))
        .get()
    )
      fail(400, 'LIBRARY_FOLDER_UNAVAILABLE', '文件夹已移除或不可用');
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
  private scoped(user: CurrentUser, scope: LibraryScope, id: string, action: 'read' | 'manage' = 'read') {
    const { workspaceId } = this.context(user, scope),
      source = this.access.publicEntity(user, id, action);
    if (source.resource.workspaceId !== workspaceId)
      fail(404, 'PUBLIC_ENTITY_UNAVAILABLE', '公共资产不存在或无权访问');
    return source;
  }
  private imported(projectId: string, id: string) {
    return this.database.db
      .select()
      .from(imports)
      .where(
        and(
          eq(imports.projectId, projectId),
          eq(imports.resourceId, id),
          sql`${imports.entityId} IS NOT NULL`,
        ),
      )
      .get();
  }
  read(user: CurrentUser, scope: LibraryScope, id: string) {
    const { resource, snapshot, media, canManage } = this.scoped(user, scope, id),
      projectId = typeof scope === 'string' ? scope : undefined;
    const prefix = projectId
      ? `/api/v1/projects/${projectId}/public-library/entities/${id}`
      : `/api/v1/workspaces/${resource.workspaceId}/public-library/entities/${id}`;
    const pendingImport = projectId
      ? this.database.db
          .select({ key: imports.creationKey })
          .from(imports)
          .where(
            and(
              eq(imports.projectId, projectId),
              eq(imports.resourceId, id),
              eq(imports.createdBy, user.id),
              sql`${imports.entityId} IS NULL`,
            ),
          )
          .get()
      : undefined;
    return {
      id,
      version: resource.version,
      folderId: resource.folderId,
      kind: snapshot.kind,
      name: snapshot.name,
      description: snapshot.description,
      attributes: snapshot.attributes,
      snapshotVersion: snapshot.version,
      canManage,
      inProject: !!projectId && (resource.sourceProjectId === projectId || !!this.imported(projectId, id)),
      ...(pendingImport ? { pendingImportKey: pendingImport.key } : {}),
      media: media.map((value) => ({
        id: value.id,
        role: value.role,
        fileName: value.fileName,
        metadata: JSON.parse(value.metadataJson),
        contentUrl: `${prefix}/media/${value.id}/content`,
        posterUrl: value.posterJson ? `${prefix}/media/${value.id}/poster` : null,
      })),
    };
  }
  list(
    user: CurrentUser,
    scope: LibraryScope,
    query: { folderId?: string; kind?: 'character' | 'environment' | 'prop'; q?: string; cursor?: string },
  ) {
    const { workspaceId, member } = this.context(user, scope);
    if (query.folderId && query.folderId !== 'root') this.folder(workspaceId, query.folderId);
    const rows = this.database.db
      .select({ id: resources.id })
      .from(resources)
      .innerJoin(assetEntities, eq(assetEntities.id, resources.sourceEntityId))
      .innerJoin(assetEntityRevisions, eq(assetEntityRevisions.id, resources.sourceRevisionId))
      .where(
        and(
          this.access.publicEntityVisibility(workspaceId),
          query.folderId === 'root'
            ? sql`${resources.folderId} IS NULL`
            : query.folderId
              ? eq(resources.folderId, query.folderId)
              : undefined,
          query.kind ? eq(assetEntities.kind, query.kind) : undefined,
          query.q?.trim() ? like(assetEntityRevisions.name, `%${query.q.trim()}%`) : undefined,
          query.cursor ? gt(resources.id, query.cursor) : undefined,
        ),
      )
      .orderBy(asc(resources.id))
      .limit(21)
      .all();
    return {
      workspaceId,
      canManageFolders: member.role !== 'MEMBER',
      items: rows.slice(0, 20).map((row) => this.read(user, scope, row.id)),
      nextCursor: rows.length > 20 ? rows[19].id : null,
    };
  }
  collect(user: CurrentUser, projectId: string, revisionId: string, folderId: string | null, key: string) {
    return this.database.db.transaction(
      () => {
        const project = this.authz.project(user, projectId, 'edit'),
          snapshot = entityRevisionSnapshot(this.database, revisionId, projectId);
        if (snapshot.kind === 'voice') fail(403, 'VOICE_SAMPLE_RESTRICTED', '声音身份暂不支持公共收录');
        if (snapshot.status === 'revoked') fail(409, 'PUBLIC_ENTITY_REVOKED', '已撤销的修订不能收录');
        const entity = this.database.db
          .select()
          .from(assetEntities)
          .where(eq(assetEntities.id, snapshot.entityId))
          .get()!;
        if (entity.createdBy !== user.id) this.authz.project(user, projectId, 'manage');
        for (const ref of snapshot.media) {
          const value = this.database.db
            .select()
            .from(mediaVersions)
            .where(eq(mediaVersions.id, ref.mediaVersionId))
            .get()!;
          if (value.mediaType !== 'image' || ref.role === 'voice_sample')
            fail(403, 'VOICE_SAMPLE_RESTRICTED', '公共视觉资产只能收录图片参考');
          this.access.shareable(value);
          if (value.createdBy !== user.id) this.authz.project(user, projectId, 'manage');
        }
        const replay = this.database.db
          .select()
          .from(resources)
          .where(
            and(
              eq(resources.workspaceId, project.workspaceId),
              eq(resources.createdBy, user.id),
              eq(resources.creationKey, key),
            ),
          )
          .get();
        if (replay) {
          if (replay.sourceRevisionId !== revisionId || replay.folderId !== folderId)
            fail(409, 'IDEMPOTENCY_CONFLICT', '请求标识已用于其他收录');
          if (replay.removedAt) fail(409, 'PUBLIC_ENTITY_REMOVED', '此前收录已移除，请刷新后重新收录');
          return { id: replay.id };
        }
        if (folderId) this.folder(project.workspaceId, folderId);
        const existing = this.database.db
          .select()
          .from(resources)
          .where(
            and(
              eq(resources.workspaceId, project.workspaceId),
              eq(resources.sourceRevisionId, revisionId),
              sql`${resources.removedAt} IS NULL`,
            ),
          )
          .get();
        if (existing) return { id: existing.id };
        const id = randomUUID();
        this.database.db
          .insert(resources)
          .values({
            id,
            workspaceId: project.workspaceId,
            sourceProjectId: projectId,
            sourceEntityId: entity.id,
            sourceRevisionId: revisionId,
            folderId,
            createdBy: user.id,
            createdAt: new Date().toISOString(),
            creationKey: key,
          })
          .run();
        this.audit(user, project.workspaceId, 'public.entity.collect', id);
        return { id };
      },
      { behavior: 'immediate' },
    );
  }
  change(
    user: CurrentUser,
    scope: LibraryScope,
    id: string,
    expectedVersion: number,
    folderId?: string | null,
  ) {
    return this.database.db.transaction(
      () => {
        const { resource } = this.scoped(user, scope, id, 'manage');
        if (resource.version !== expectedVersion)
          fail(409, 'VERSION_CONFLICT', '公共资产已更新，请刷新后重试');
        if (folderId) this.folder(resource.workspaceId, folderId);
        this.database.db
          .update(resources)
          .set({
            version: expectedVersion + 1,
            ...(folderId === undefined ? { removedAt: new Date().toISOString() } : { folderId }),
          })
          .where(eq(resources.id, id))
          .run();
        this.audit(
          user,
          resource.workspaceId,
          folderId === undefined ? 'public.entity.remove' : 'public.entity.move',
          id,
        );
        return { version: expectedVersion + 1 };
      },
      { behavior: 'immediate' },
    );
  }
  async content(
    user: CurrentUser,
    scope: LibraryScope,
    id: string,
    mediaId: string,
    poster: boolean,
    range?: string,
  ) {
    const authorize = () => {
      const source = this.scoped(user, scope, id);
      if (!source.media.some((value) => value.id === mediaId))
        fail(404, 'NOT_FOUND', '此参考图不属于当前公共资产');
      return source;
    };
    const source = authorize(),
      value = source.media.find((value) => value.id === mediaId)!;
    return this.media.openContent(value, poster, range, authorize);
  }
  async import(user: CurrentUser, projectId: string, id: string, key: string) {
    const project = this.authz.project(user, projectId, 'edit');
    const find = () =>
      this.database.db
        .select()
        .from(imports)
        .where(
          and(eq(imports.projectId, projectId), eq(imports.createdBy, user.id), eq(imports.creationKey, key)),
        )
        .get();
    let record = find();
    if (record && record.resourceId !== id) fail(409, 'IDEMPOTENCY_CONFLICT', '请求标识已用于其他资产导入');
    if (record?.entityId) {
      const revision = this.database.db
        .select()
        .from(assetEntityRevisions)
        .where(eq(assetEntityRevisions.id, record.revisionId!))
        .get()!;
      return this.entities.read(user, record.entityId, revision.version);
    }
    const source = this.scoped(user, projectId, id);
    if (!record)
      record = this.database.db.transaction(
        () => {
          this.authz.project(user, projectId, 'edit');
          this.scoped(user, projectId, id);
          const old = find();
          if (old) {
            if (old.resourceId !== id) fail(409, 'IDEMPOTENCY_CONFLICT', '请求标识已用于其他资产导入');
            return old;
          }
          const value = {
            id: randomUUID(),
            resourceId: id,
            projectId,
            workspaceId: project.workspaceId,
            createdBy: user.id,
            createdAt: new Date().toISOString(),
            creationKey: key,
          };
          const pending = this.database.db
            .select({ id: imports.id })
            .from(imports)
            .where(
              and(
                eq(imports.projectId, projectId),
                eq(imports.createdBy, user.id),
                eq(imports.resourceId, id),
                sql`${imports.entityId} IS NULL`,
              ),
            )
            .get();
          if (pending)
            fail(409, 'PUBLIC_ENTITY_IMPORT_PENDING', '已有未完成的资产导入，请刷新公共资产后继续');
          this.database.db.insert(imports).values(value).run();
          return this.database.db.select().from(imports).where(eq(imports.id, value.id)).get()!;
        },
        { behavior: 'immediate' },
      );
    const importId = record.id;
    for (const value of new Map(source.media.map((media) => [media.id, media])).values()) {
      let copy = this.database.db
        .select()
        .from(copies)
        .where(and(eq(copies.importId, importId), eq(copies.sourceMediaVersionId, value.id)))
        .get();
      if (!copy) {
        const upload = await this.media.initiate(
          user,
          projectId,
          uploadInput.parse({
            fileName: value.fileName,
            byteLength: value.byteLength,
            contentType: value.mime,
          }),
          requestKey(`entity-media:${importId}:${value.id}`),
        );
        copy = this.database.db.transaction(
          () => {
            this.scoped(user, projectId, id);
            const old = this.database.db
              .select()
              .from(copies)
              .where(and(eq(copies.importId, importId), eq(copies.sourceMediaVersionId, value.id)))
              .get();
            if (old) return old;
            const row = {
              id: randomUUID(),
              importId,
              projectId,
              workspaceId: project.workspaceId,
              sourceProjectId: source.resource.sourceProjectId,
              sourceMediaVersionId: value.id,
              uploadId: upload.id,
            };
            this.database.db.insert(copies).values(row).run();
            return row;
          },
          { behavior: 'immediate' },
        );
      }
      const state = await this.media.upload(user, copy.uploadId);
      if (state.state === 'complete') continue;
      if (state.state === 'needs_reconciliation') {
        await this.media.reconcile(user, copy.uploadId);
        continue;
      }
      const file = await this.content(user, projectId, id, value.id, false);
      try {
        await this.media.receive(user, copy.uploadId, file.stream, String(file.total));
      } finally {
        file.stream.destroy();
      }
    }
    return this.database.db.transaction(
      () => {
        this.authz.project(user, projectId, 'edit');
        const current = this.scoped(user, projectId, id),
          old = find()!;
        if (old.entityId) {
          const revision = this.database.db
            .select()
            .from(assetEntityRevisions)
            .where(eq(assetEntityRevisions.id, old.revisionId!))
            .get()!;
          return this.entities.read(user, old.entityId, revision.version);
        }
        const bindings = current.snapshot.media.map((ref) => {
          const copied = this.database.db
            .select({ upload: mediaUploads })
            .from(copies)
            .innerJoin(mediaUploads, eq(mediaUploads.id, copies.uploadId))
            .where(and(eq(copies.importId, importId), eq(copies.sourceMediaVersionId, ref.mediaVersionId)))
            .get();
          if (!copied || copied.upload.state !== 'complete')
            fail(409, 'PUBLIC_ENTITY_IMPORT_INCOMPLETE', '参考图尚未导入完成，请重试');
          return { role: ref.role, mediaVersionId: copied.upload.mediaVersionId };
        });
        const body = entityBody.parse({
          name: current.snapshot.name,
          description: current.snapshot.description,
          attributes: current.snapshot.attributes,
          media: bindings,
        });
        const created = this.entities.save(
          user,
          projectId,
          null,
          current.snapshot.kind,
          body,
          requestKey(`entity-result:${importId}`),
        );
        this.database.db
          .update(imports)
          .set({ entityId: created.id, revisionId: created.revision.id })
          .where(eq(imports.id, importId))
          .run();
        this.audit(user, project.workspaceId, 'public.entity.import', importId);
        return this.entities.read(user, created.id, created.revision.version);
      },
      { behavior: 'immediate' },
    );
  }
}
