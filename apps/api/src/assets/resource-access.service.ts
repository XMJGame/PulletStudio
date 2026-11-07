import { Injectable } from '@nestjs/common';
import { and, eq, exists, inArray, isNull, ne, notExists, or, sql } from 'drizzle-orm';
import { CurrentUser, fail } from '../common/http';
import { DatabaseService } from '../db/database.service';
import {
  entityMediaBindings,
  mediaAssets,
  mediaVersions,
  workspaceMediaImports,
  workspaceMediaResources,
  workspaceMediaFiles,
  workspaceNativeResources,
  workspaceNativeImports,
  workspaceEntityResources,
  workspaceEntityImports,
  workspaceEntityImportMedia,
  assetEntities,
  assetEntityRevisions,
} from '../db/schema';
import { AuthorizationService } from '../production/authorization.service';
import { entityRevisionSnapshot } from './entity-references';

@Injectable()
export class ResourceAccessService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
  ) {}
  publicEntityVisibility(workspaceId: string) {
    return and(
      eq(workspaceEntityResources.workspaceId, workspaceId),
      isNull(workspaceEntityResources.removedAt),
      inArray(assetEntities.kind, ['character', 'environment', 'prop']),
      sql`coalesce((SELECT action FROM asset_revision_decisions WHERE revision_id=${workspaceEntityResources.sourceRevisionId} ORDER BY version DESC LIMIT 1),'') <> 'revoke'`,
      notExists(
        this.database.db
          .select({ id: entityMediaBindings.mediaVersionId })
          .from(entityMediaBindings)
          .innerJoin(mediaVersions, eq(mediaVersions.id, entityMediaBindings.mediaVersionId))
          .innerJoin(mediaAssets, eq(mediaAssets.id, mediaVersions.assetId))
          .where(
            and(
              eq(entityMediaBindings.revisionId, workspaceEntityResources.sourceRevisionId),
              or(
                ne(mediaVersions.mediaType, 'image'),
                eq(mediaVersions.origin, 'workflow_test'),
                eq(mediaAssets.inLibrary, false),
                exists(
                  this.database.db
                    .select({ id: sql`1` })
                    .from(sql`entity_media_bindings protected`)
                    .where(
                      sql`protected.media_version_id=${mediaVersions.id} AND protected.role='voice_sample'`,
                    ),
                ),
              ),
            ),
          ),
      ),
    );
  }
  publicEntity(user: CurrentUser, id: string, action: 'read' | 'manage' = 'read') {
    const row = this.database.db
      .select()
      .from(workspaceEntityResources)
      .where(eq(workspaceEntityResources.id, id))
      .get();
    if (!row || row.removedAt) fail(404, 'PUBLIC_ENTITY_UNAVAILABLE', '公共资产已移除或不可用');
    const member = this.authz.workspace(user, row.workspaceId);
    if (action === 'manage' && member.role === 'MEMBER' && row.createdBy !== user.id)
      fail(403, 'FORBIDDEN', '仅收录者和工作区管理员可管理此资产');
    const snapshot = entityRevisionSnapshot(this.database, row.sourceRevisionId, row.sourceProjectId);
    if (snapshot.entityId !== row.sourceEntityId || (snapshot.kind === 'voice' && action === 'read'))
      fail(409, 'PUBLIC_ENTITY_KIND', '当前仅支持角色、场景和道具的公共复用');
    if (snapshot.status === 'revoked' && action === 'read')
      fail(409, 'PUBLIC_ENTITY_REVOKED', '此资产修订已撤销，不能继续复用');
    const media = (action === 'manage' ? [] : snapshot.media).map((ref) => {
      const value = this.database.db
        .select()
        .from(mediaVersions)
        .where(eq(mediaVersions.id, ref.mediaVersionId))
        .get()!;
      if (value.mediaType !== 'image' || ref.role === 'voice_sample')
        fail(403, 'VOICE_SAMPLE_RESTRICTED', '公共视觉资产只能使用图片参考');
      this.shareable(value);
      return { ...value, role: ref.role };
    });
    return {
      resource: row,
      snapshot,
      media,
      canManage: member.role !== 'MEMBER' || row.createdBy === user.id,
    };
  }
  publicVisibility(workspaceId: string) {
    return and(
      eq(workspaceMediaResources.workspaceId, workspaceId),
      isNull(workspaceMediaResources.removedAt),
      ne(mediaVersions.origin, 'workflow_test'),
      exists(
        this.database.db
          .select({ id: mediaAssets.id })
          .from(mediaAssets)
          .where(and(eq(mediaAssets.id, mediaVersions.assetId), eq(mediaAssets.inLibrary, true))),
      ),
      notExists(
        this.database.db
          .select({ id: entityMediaBindings.revisionId })
          .from(entityMediaBindings)
          .where(
            and(
              eq(entityMediaBindings.mediaVersionId, mediaVersions.id),
              eq(entityMediaBindings.role, 'voice_sample'),
            ),
          ),
      ),
    );
  }
  publicMedia(user: CurrentUser, id: string, action: 'read' | 'manage' = 'read') {
    const legacy = this.database.db
      .select()
      .from(workspaceMediaResources)
      .where(eq(workspaceMediaResources.id, id))
      .get();
    const native = legacy
      ? undefined
      : this.database.db
          .select()
          .from(workspaceNativeResources)
          .where(eq(workspaceNativeResources.id, id))
          .get();
    const row =
      legacy ?? (native ? { ...native, sourceProjectId: null, sourceMediaVersionId: null } : undefined);
    if (!row || row.removedAt) fail(404, 'PUBLIC_RESOURCE_UNAVAILABLE', '公共素材已移除或不可用');
    const member = this.authz.workspace(user, row.workspaceId);
    if (action === 'manage' && member.role === 'MEMBER' && row.createdBy !== user.id)
      fail(403, 'FORBIDDEN', '仅收录者和工作区管理员可管理此素材');
    const media = legacy
      ? this.database.db
          .select()
          .from(mediaVersions)
          .where(eq(mediaVersions.id, legacy.sourceMediaVersionId))
          .get()
      : this.database.db
          .select()
          .from(workspaceMediaFiles)
          .where(eq(workspaceMediaFiles.id, native!.fileId))
          .get();
    if (!media || media.workspaceId !== row.workspaceId)
      fail(404, 'PUBLIC_RESOURCE_UNAVAILABLE', '公共素材不可用');
    if (legacy) this.shareable(media as typeof mediaVersions.$inferSelect);
    return {
      resource: row,
      media,
      native: !!native,
      canManage: member.role !== 'MEMBER' || row.createdBy === user.id,
    };
  }
  shareable(media: typeof mediaVersions.$inferSelect) {
    const asset = this.database.db.select().from(mediaAssets).where(eq(mediaAssets.id, media.assetId)).get();
    if (!asset?.inLibrary || media.origin === 'workflow_test')
      fail(409, 'PUBLIC_RESOURCE_NOT_ARCHIVED', '请先将正式素材入库');
    if (
      this.database.db
        .select({ id: entityMediaBindings.revisionId })
        .from(entityMediaBindings)
        .where(
          and(eq(entityMediaBindings.mediaVersionId, media.id), eq(entityMediaBindings.role, 'voice_sample')),
        )
        .get()
    )
      fail(403, 'VOICE_SAMPLE_RESTRICTED', '受保护的声音样本不能收录到公共库');
  }
  pendingImport(user: CurrentUser, uploadId: string) {
    const entityMedia = this.database.db
      .select({ media: workspaceEntityImportMedia, import: workspaceEntityImports })
      .from(workspaceEntityImportMedia)
      .innerJoin(workspaceEntityImports, eq(workspaceEntityImports.id, workspaceEntityImportMedia.importId))
      .where(eq(workspaceEntityImportMedia.uploadId, uploadId))
      .get();
    if (entityMedia) {
      const project = this.authz.project(user, entityMedia.import.projectId, 'edit');
      const source = this.publicEntity(user, entityMedia.import.resourceId);
      const media = source.media.find((value) => value.id === entityMedia.media.sourceMediaVersionId);
      if (project.workspaceId !== source.resource.workspaceId || !media)
        fail(404, 'PUBLIC_ENTITY_UNAVAILABLE', '参考图已不可用');
      return { resource: source.resource, media };
    }
    const legacy = this.database.db
      .select()
      .from(workspaceMediaImports)
      .where(eq(workspaceMediaImports.uploadId, uploadId))
      .get();
    const row =
      legacy ??
      this.database.db
        .select()
        .from(workspaceNativeImports)
        .where(eq(workspaceNativeImports.uploadId, uploadId))
        .get();
    if (!row) return;
    const project = this.authz.project(user, row.projectId, 'edit');
    const source = this.publicMedia(user, row.resourceId);
    if (project.workspaceId !== source.resource.workspaceId) fail(404, 'NOT_FOUND', '素材不属于当前工作区');
    return source;
  }
}
