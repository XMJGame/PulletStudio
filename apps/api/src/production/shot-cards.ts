import { and, desc, eq, lt, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../db/database.service';
import {
  proposalRevisions,
  analysisProposals,
  analysisRuns,
  scriptRevisions,
  scriptSpans,
  shotCardRevisions,
  shotCardEditions,
  shotScriptSpans,
  users,
  shotAssetBindings,
} from '../db/schema';
import { CurrentUser, fail } from '../common/http';
import { ManualShot } from '../analysis/analysis-contract';
import { FormalCard } from './formal-card';
import { resolveAssetReferences, entityFreshness } from '../assets/entity-references';

export function cardRecord(database: DatabaseService, shotId: string, version: number) {
  return (
    database.db
      .select()
      .from(shotCardEditions)
      .where(and(eq(shotCardEditions.shotId, shotId), eq(shotCardEditions.version, version)))
      .get() ??
    database.db
      .select()
      .from(shotCardRevisions)
      .where(and(eq(shotCardRevisions.shotId, shotId), eq(shotCardRevisions.version, version)))
      .get()
  );
}
export function editionSources(database: DatabaseService, body: { sourceSpanIds: string[] }) {
  if (!body.sourceSpanIds.length) return [];
  const rows = database.db
    .select({ span: scriptSpans, text: scriptRevisions.content, revisionVersion: scriptRevisions.version })
    .from(scriptSpans)
    .innerJoin(scriptRevisions, eq(scriptRevisions.id, scriptSpans.revisionId))
    .where(inArray(scriptSpans.id, body.sourceSpanIds))
    .all();
  return body.sourceSpanIds.map((id) => {
    const row = rows.find((row) => row.span.id === id)!;
    return {
      ...row.span,
      text: row.text.slice(row.span.startOffset, row.span.endOffset),
      revisionVersion: row.revisionVersion,
    };
  });
}
export function appendCardEdition(
  database: DatabaseService,
  user: CurrentUser,
  shot: { id: string; projectId: string; workspaceId: string; version: number },
  body: FormalCard,
  sourceProposalRevisionId: string | null,
  summary: string,
) {
  const references = resolveAssetReferences(database, shot.projectId, body.assetBindings);
  const edition = database.db
    .insert(shotCardEditions)
    .values({
      id: randomUUID(),
      shotId: shot.id,
      projectId: shot.projectId,
      workspaceId: shot.workspaceId,
      version: shot.version,
      bodyJson: JSON.stringify(body),
      sourceProposalRevisionId,
      summary,
      createdBy: user.id,
      createdAt: new Date().toISOString(),
    })
    .returning()
    .get()!;
  for (const reference of references)
    database.db
      .insert(shotAssetBindings)
      .values({
        id: randomUUID(),
        shotId: shot.id,
        cardVersion: shot.version,
        projectId: shot.projectId,
        workspaceId: shot.workspaceId,
        revisionId: reference.id,
        purpose: reference.purpose,
      })
      .run();
  return edition;
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
    return { available: false as const, shotId, version };
  }
  const origin = row.sourceProposalRevisionId
    ? database.db
        .select({ revision: proposalRevisions, proposal: analysisProposals, run: analysisRuns })
        .from(proposalRevisions)
        .innerJoin(analysisProposals, eq(analysisProposals.id, proposalRevisions.proposalId))
        .innerJoin(analysisRuns, eq(analysisRuns.id, analysisProposals.runId))
        .where(eq(proposalRevisions.id, row.sourceProposalRevisionId))
        .get()
    : undefined;
  const actor = database.db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, row.createdBy))
    .get()!;
  const snapshot = origin ? JSON.parse(origin.run.connectionSnapshotJson) : null;
  const body = JSON.parse(row.bodyJson);
  const assetReferences = resolveAssetReferences(database, row.projectId, body.assetBindings);
  return {
    available: true as const,
    id: row.id,
    shotId,
    version,
    body: { ...body, sourceAudioPolicy: body.sourceAudioPolicy ?? 'inspect' },
    assetReferences,
    assetWarnings: entityFreshness(database, assetReferences),
    sources: editionSources(database, body),
    summary: row.summary,
    createdAt: row.createdAt,
    authorName: actor.name,
    origin: origin
      ? {
          proposalId: origin.proposal.id,
          proposalVersion: origin.revision.version,
          runId: origin.run.id,
          model: snapshot.model,
          profileName: snapshot.name,
          adoptedBy: origin.revision.createdBy,
          adoptedAt: origin.revision.createdAt,
        }
      : null,
  };
}
export function shotCardHistory(database: DatabaseService, shotId: string, before?: number) {
  const oldRows = database.db
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
  const editions = database.db
    .select({
      version: shotCardEditions.version,
      summary: shotCardEditions.summary,
      createdAt: shotCardEditions.createdAt,
      authorName: users.name,
    })
    .from(shotCardEditions)
    .innerJoin(users, eq(users.id, shotCardEditions.createdBy))
    .where(
      and(
        eq(shotCardEditions.shotId, shotId),
        before === undefined ? undefined : lt(shotCardEditions.version, before),
      ),
    )
    .orderBy(desc(shotCardEditions.version))
    .limit(31)
    .all();
  const rows = [...oldRows, ...editions].sort((a, b) => b.version - a.version).slice(0, 31);
  return { items: rows.slice(0, 30), nextCursor: rows.length > 30 ? rows[29].version : null };
}
