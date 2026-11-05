import { desc, eq } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service';
import { generationJobs, takeReviewEvents } from '../db/schema';

const statuses = {
  submit: 'submitted',
  withdraw: 'draft',
  approve: 'approved',
  reject: 'rejected',
  revoke: 'revoked',
} as const;
export function takeReviewState(
  database: DatabaseService,
  takeId: string,
  shotVersion: number,
  projectVersion: number,
) {
  const latest = database.db
    .select()
    .from(takeReviewEvents)
    .where(eq(takeReviewEvents.takeId, takeId))
    .orderBy(desc(takeReviewEvents.version))
    .get();
  const source = latest?.generationJobId
    ? (database.db
        .select({ shotVersion: generationJobs.shotVersion, projectVersion: generationJobs.projectVersion })
        .from(generationJobs)
        .where(eq(generationJobs.id, latest.generationJobId))
        .get() ?? null)
    : null;
  return {
    status: latest ? statuses[latest.action] : ('draft' as const),
    decisionVersion: latest?.version ?? 0,
    decisionId: latest?.id ?? null,
    stale: Boolean(
      latest && (latest.shotVersion !== shotVersion || latest.projectVersion !== projectVersion),
    ),
    context: latest
      ? {
          shotVersion: latest.shotVersion,
          projectVersion: latest.projectVersion,
          generationJobId: latest.generationJobId,
          promptId: latest.promptId,
        }
      : null,
    source,
  };
}
