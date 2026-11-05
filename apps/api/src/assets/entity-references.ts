import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service';
import { CurrentUser, fail } from '../common/http';
import {
  assetEntities,
  assetEntityRevisions,
  entityMediaBindings,
  mediaAssets,
  mediaVersions,
  projectMembers,
  workspaceMembers,
} from '../db/schema';
import { AssetReference } from './entity-contract';

export function assertSampleAccess(
  database: DatabaseService,
  user: CurrentUser,
  media: typeof mediaVersions.$inferSelect,
) {
  const protectedSample = database.db
    .select({ id: entityMediaBindings.revisionId })
    .from(entityMediaBindings)
    .where(
      and(eq(entityMediaBindings.mediaVersionId, media.id), eq(entityMediaBindings.role, 'voice_sample')),
    )
    .limit(1)
    .get();
  if (!protectedSample || media.createdBy === user.id) return;
  const workspace = database.db
    .select()
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, media.workspaceId), eq(workspaceMembers.userId, user.id)))
    .get();
  const project = database.db
    .select()
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, media.projectId), eq(projectMembers.userId, user.id)))
    .get();
  if (
    !workspace ||
    (workspace.role === 'MEMBER' && !['PROJECT_MANAGER', 'REVIEWER'].includes(project?.role ?? ''))
  )
    fail(403, 'VOICE_SAMPLE_RESTRICTED', '声音样本仅上传者、项目管理者或审核者可读取');
}
export function entityRevisionSnapshot(database: DatabaseService, id: string, projectId: string) {
  const row = database.db
    .select({ revision: assetEntityRevisions, entity: assetEntities })
    .from(assetEntityRevisions)
    .innerJoin(assetEntities, eq(assetEntities.id, assetEntityRevisions.entityId))
    .where(and(eq(assetEntityRevisions.id, id), eq(assetEntityRevisions.projectId, projectId)))
    .get();
  if (!row) fail(404, 'NOT_FOUND', '资产修订不存在或不属于当前项目');
  const refs = database.db
    .select({ role: entityMediaBindings.role, media: mediaVersions })
    .from(entityMediaBindings)
    .innerJoin(mediaVersions, eq(mediaVersions.id, entityMediaBindings.mediaVersionId))
    .where(eq(entityMediaBindings.revisionId, id))
    .orderBy(entityMediaBindings.role, mediaVersions.id)
    .all();
  return {
    id: row.revision.id,
    entityId: row.entity.id,
    kind: row.entity.kind,
    version: row.revision.version,
    name: row.revision.name,
    description: row.revision.description,
    attributes: JSON.parse(row.revision.attributesJson) as Record<string, string>,
    status: 'draft' as const,
    media: refs.map((ref) => ({
      role: ref.role,
      mediaVersionId: ref.media.id,
      assetId: ref.media.assetId,
      version: ref.media.version,
      fileName: ref.media.fileName,
      mediaType: ref.media.mediaType,
      mime: ref.media.mime,
      byteLength: ref.media.byteLength,
      sha256: ref.media.sha256,
      metadata: JSON.parse(ref.media.metadataJson),
    })),
  };
}
export type EntitySnapshot = ReturnType<typeof entityRevisionSnapshot>;
export function resolveAssetReferences(
  database: DatabaseService,
  projectId: string,
  bindings: AssetReference[] = [],
) {
  const references = bindings.map((ref) => ({
    ...entityRevisionSnapshot(database, ref.revisionId, projectId),
    purpose: ref.purpose,
  }));
  if (new Set(references.map((ref) => ref.entityId)).size !== references.length)
    fail(400, 'ENTITY_DUPLICATE', '同一镜头只可引用一个实体修订，请明确采用的版本');
  return references;
}
export function entityFreshness(database: DatabaseService, references: EntitySnapshot[]) {
  const reasons: string[] = [];
  for (const ref of references) {
    const entity = database.db.select().from(assetEntities).where(eq(assetEntities.id, ref.entityId)).get();
    if (entity && entity.version !== ref.version)
      reasons.push(`资产「${ref.name}」已有新修订，仍引用 v${ref.version}`);
    for (const media of ref.media) {
      const head = database.db
        .select({ version: mediaAssets.version })
        .from(mediaAssets)
        .where(eq(mediaAssets.id, media.assetId))
        .get();
      if (head && head.version !== media.version)
        reasons.push(`资产「${ref.name}」的参考媒体已有新版本，仍引用 v${media.version}`);
    }
  }
  return [...new Set(reasons)];
}
