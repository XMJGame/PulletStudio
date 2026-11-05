import { desc, eq } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service';
import { assetRevisionDecisions } from '../db/schema';

export function assetApproval(database: DatabaseService, revisionId: string) {
  const latest = database.db
    .select()
    .from(assetRevisionDecisions)
    .where(eq(assetRevisionDecisions.revisionId, revisionId))
    .orderBy(desc(assetRevisionDecisions.version))
    .get();
  const status = latest?.action === 'approve' ? 'approved' : latest ? 'revoked' : 'draft';
  return { status, decisionVersion: latest?.version ?? 0, decisionId: latest?.id ?? null } as const;
}
