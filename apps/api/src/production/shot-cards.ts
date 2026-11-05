import { and, desc, eq, lt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../db/database.service';
import {
  proposalRevisions,
  analysisProposals,
  analysisRuns,
  scriptRevisions,
  scriptSpans,
  shotCardRevisions,
  shotScriptSpans,
  users,
} from '../db/schema';
import { CurrentUser, fail } from '../common/http';
import { ManualShot } from '../analysis/analysis-contract';

export function cardRecord(database: DatabaseService, shotId: string, version: number) {
  return database.db
    .select()
    .from(shotCardRevisions)
    .where(and(eq(shotCardRevisions.shotId, shotId), eq(shotCardRevisions.version, version)))
    .get();
}
export function cardSources(database: DatabaseService, cardRevisionId: string) {
  return database.db
    .select({ span: scriptSpans, text: scriptRevisions.content, revisionVersion: scriptRevisions.version })
    .from(shotScriptSpans)
    .innerJoin(scriptSpans, eq(scriptSpans.id, shotScriptSpans.spanId))
    .innerJoin(scriptRevisions, eq(scriptRevisions.id, scriptSpans.revisionId))
    .where(eq(shotScriptSpans.cardRevisionId, cardRevisionId))
    .all()
    .map((row) => ({
      ...row.span,
      text: row.text.slice(row.span.startOffset, row.span.endOffset),
      revisionVersion: row.revisionVersion,
    }));
}
export function appendShotCard(
  database: DatabaseService,
  user: CurrentUser,
  shot: { id: string; projectId: string; workspaceId: string; version: number },
  body: ManualShot,
  sourceProposalRevisionId: string,
  summary: string,
) {
  const id = randomUUID(),
    now = new Date().toISOString();
  database.db
    .insert(shotCardRevisions)
    .values({
      id,
      shotId: shot.id,
      projectId: shot.projectId,
      workspaceId: shot.workspaceId,
      version: shot.version,
      bodyJson: JSON.stringify(body),
      sourceProposalRevisionId,
      createdBy: user.id,
      summary,
      createdAt: now,
    })
    .run();
  for (const spanId of body.sourceSpanIds)
    database.db
      .insert(shotScriptSpans)
      .values({ cardRevisionId: id, spanId, projectId: shot.projectId, workspaceId: shot.workspaceId })
      .run();
  return id;
}
export function readShotCard(database: DatabaseService, shotId: string, version: number, required = false) {
  const row = cardRecord(database, shotId, version);
  if (!row) {
    if (required) fail(404, 'NOT_FOUND', '完整制作卡版本不存在');
    return { available: false, shotId, version };
  }
  const origin = database.db
    .select({ revision: proposalRevisions, proposal: analysisProposals, run: analysisRuns })
    .from(proposalRevisions)
    .innerJoin(analysisProposals, eq(analysisProposals.id, proposalRevisions.proposalId))
    .innerJoin(analysisRuns, eq(analysisRuns.id, analysisProposals.runId))
    .where(eq(proposalRevisions.id, row.sourceProposalRevisionId))
    .get()!;
  const actor = database.db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, row.createdBy))
    .get()!;
  const snapshot = JSON.parse(origin.run.connectionSnapshotJson);
  return {
    available: true,
    id: row.id,
    shotId,
    version,
    body: JSON.parse(row.bodyJson),
    sources: cardSources(database, row.id),
    summary: row.summary,
    createdAt: row.createdAt,
    authorName: actor.name,
    origin: {
      proposalId: origin.proposal.id,
      proposalVersion: origin.revision.version,
      runId: origin.run.id,
      model: snapshot.model,
      profileName: snapshot.name,
      adoptedBy: origin.revision.createdBy,
      adoptedAt: origin.revision.createdAt,
    },
  };
}
export function shotCardHistory(database: DatabaseService, shotId: string, before?: number) {
  const rows = database.db
    .select({
      version: shotCardRevisions.version,
      summary: shotCardRevisions.summary,
      createdAt: shotCardRevisions.createdAt,
      authorName: users.name,
    })
    .from(shotCardRevisions)
    .innerJoin(users, eq(users.id, shotCardRevisions.createdBy))
    .where(
      and(
        eq(shotCardRevisions.shotId, shotId),
        before === undefined ? undefined : lt(shotCardRevisions.version, before),
      ),
    )
    .orderBy(desc(shotCardRevisions.version))
    .limit(31)
    .all();
  return { items: rows.slice(0, 30), nextCursor: rows.length > 30 ? rows[29].version : null };
}
