import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { CurrentUser, fail } from '../common/http';
import { DatabaseService } from '../db/database.service';
import { generationWorkflows, workflowCatalogs, workflowCatalogRevisions } from '../db/schema';
export const workflowHash = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function catalogState(database: DatabaseService, workflowId: string) {
  return database.db
    .select({
      familyId: workflowCatalogs.id,
      version: workflowCatalogs.version,
      revision: workflowCatalogRevisions.revision,
      headRevision: workflowCatalogs.revision,
      headWorkflowId: workflowCatalogs.headWorkflowId,
      archived: workflowCatalogs.archived,
    })
    .from(workflowCatalogRevisions)
    .innerJoin(workflowCatalogs, eq(workflowCatalogs.id, workflowCatalogRevisions.familyId))
    .where(eq(workflowCatalogRevisions.workflowId, workflowId))
    .get();
}
export function workflowReplay(
  database: DatabaseService,
  user: CurrentUser,
  projectId: string,
  key: string,
  hash: string,
) {
  const previous = database.db
    .select()
    .from(workflowCatalogRevisions)
    .where(
      and(
        eq(workflowCatalogRevisions.projectId, projectId),
        eq(workflowCatalogRevisions.createdBy, user.id),
        eq(workflowCatalogRevisions.requestKey, key),
      ),
    )
    .get();
  if (!previous) return;
  if (previous.requestHash !== hash) fail(409, 'IDEMPOTENCY_CONFLICT', '此请求标识已用于其他工作流输入');
  return { id: previous.workflowId, familyId: previous.familyId, revision: previous.revision };
}
export function registerWorkflow(
  database: DatabaseService,
  row: typeof generationWorkflows.$inferSelect,
  key: string,
  hash: string,
  familyId = row.id,
  summary = '创建工作流配置',
  restoredFromId: string | null = null,
) {
  let family = database.db.select().from(workflowCatalogs).where(eq(workflowCatalogs.id, familyId)).get();
  if (!family)
    family = database.db
      .insert(workflowCatalogs)
      .values({
        id: familyId,
        projectId: row.projectId,
        workspaceId: row.workspaceId,
        headWorkflowId: null,
        revision: 0,
        version: 0,
        updatedAt: row.createdAt,
      })
      .returning()
      .get()!;
  const revision = family.revision + 1;
  database.db
    .insert(workflowCatalogRevisions)
    .values({
      workflowId: row.id,
      familyId,
      projectId: row.projectId,
      workspaceId: row.workspaceId,
      revision,
      summary,
      restoredFromId,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      requestKey: key,
      requestHash: hash,
    })
    .run();
  database.db
    .update(workflowCatalogs)
    .set({ headWorkflowId: row.id, revision, version: family.version + 1, updatedAt: row.createdAt })
    .where(and(eq(workflowCatalogs.id, familyId), eq(workflowCatalogs.version, family.version)))
    .run();
  return { id: row.id, familyId, revision };
}
