import { and, desc, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service';
import { generationWorkflows, workflowCatalogRevisions, workflowReleaseEvents } from '../db/schema';

export function latestRelease(database: DatabaseService, familyId: string) {
  return database.db
    .select()
    .from(workflowReleaseEvents)
    .where(eq(workflowReleaseEvents.familyId, familyId))
    .orderBy(desc(workflowReleaseEvents.sequence))
    .get();
}

export function latestCompatibleRevision(database: DatabaseService, familyId: string) {
  return database.db
    .select({ id: workflowCatalogRevisions.workflowId })
    .from(workflowCatalogRevisions)
    .innerJoin(generationWorkflows, eq(generationWorkflows.id, workflowCatalogRevisions.workflowId))
    .where(
      and(
        eq(workflowCatalogRevisions.familyId, familyId),
        sql`json_extract(${generationWorkflows.definitionJson}, '$.reviewRequired') IS NOT 1`,
      ),
    )
    .orderBy(desc(workflowCatalogRevisions.revision))
    .get()?.id;
}
