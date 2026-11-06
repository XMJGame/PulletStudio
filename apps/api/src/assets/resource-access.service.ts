import { Injectable } from '@nestjs/common';
import { and, eq, exists, isNull, ne, notExists } from 'drizzle-orm';
import { CurrentUser, fail } from '../common/http';
import { DatabaseService } from '../db/database.service';
import {
  entityMediaBindings,
  mediaAssets,
  mediaVersions,
  workspaceMediaImports,
  workspaceMediaResources,
} from '../db/schema';
import { AuthorizationService } from '../production/authorization.service';

@Injectable()
export class ResourceAccessService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
  ) {}
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
    const row = this.database.db
      .select()
      .from(workspaceMediaResources)
      .where(eq(workspaceMediaResources.id, id))
      .get();
    if (!row || row.removedAt) fail(404, 'PUBLIC_RESOURCE_UNAVAILABLE', '公共素材已移除或不可用');
    const member = this.authz.workspace(user, row.workspaceId);
    if (action === 'manage' && member.role === 'MEMBER' && row.createdBy !== user.id)
      fail(403, 'FORBIDDEN', '仅收录者和工作区管理员可管理此素材');
    const media = this.database.db
      .select()
      .from(mediaVersions)
      .where(eq(mediaVersions.id, row.sourceMediaVersionId))
      .get();
    if (!media || media.workspaceId !== row.workspaceId)
      fail(404, 'PUBLIC_RESOURCE_UNAVAILABLE', '公共素材不可用');
    this.shareable(media);
    return { resource: row, media, canManage: member.role !== 'MEMBER' || row.createdBy === user.id };
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
    const row = this.database.db
      .select()
      .from(workspaceMediaImports)
      .where(eq(workspaceMediaImports.uploadId, uploadId))
      .get();
    if (!row) return;
    const project = this.authz.project(user, row.projectId, 'edit');
    const source = this.publicMedia(user, row.resourceId);
    if (project.workspaceId !== source.resource.workspaceId) fail(404, 'NOT_FOUND', '素材不属于当前工作区');
    return source;
  }
}
