import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, gt, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { CurrentUser, fail } from '../common/http';
import { DatabaseService } from '../db/database.service';
import { analysisProposals, analysisRuns, auditEvents, systemState } from '../db/schema';
import { AuthorizationService } from '../production/authorization.service';
import { TextConnectionsService } from '../providers/text-connections.service';
import { ScriptsService } from '../scripts/scripts.service';
import { textChecksum } from '../scripts/script-evidence';
import { analysisSchemaName, sourceChunks } from './analysis-contract';
import { ProposalReviewService } from './proposal-review.service';

export type AnalysisInput = {
  modelProfileId: string;
  revisionVersion: number;
  chunkIndex: number;
  contextSummary: string;
  expectedProjectVersion: number;
  acknowledgeExternalProcessing: true;
};
export type AnalysisRow = typeof analysisRuns.$inferSelect;
export const runSummary = (row: AnalysisRow) => {
  const input = JSON.parse(row.inputJson),
    connection = JSON.parse(row.connectionSnapshotJson);
  return {
    id: row.id,
    projectId: row.projectId,
    revisionId: row.revisionId,
    state: row.state,
    version: row.version,
    attempts: row.attempts,
    retryCount: row.retryCount,
    nextRunAt: row.nextRunAt,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    model: connection.model,
    profileName: connection.name,
    connectionName: connection.connectionName,
    revisionVersion: input.revision.version,
    chunkIndex: input.chunk.index,
    startOffset: input.chunk.startOffset,
    endOffset: input.chunk.endOffset,
  };
};
@Injectable()
export class AnalysisService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
    private readonly scripts: ScriptsService,
    private readonly connections: TextConnectionsService,
    private readonly reviews: ProposalReviewService,
  ) {}
  chunks(user: CurrentUser, projectId: string, version: number) {
    const revision = this.scripts.readVersion(user, projectId, version);
    return {
      revisionId: revision.id,
      revisionVersion: version,
      checksum: revision.checksum,
      items: sourceChunks(revision.id, revision.content).map((chunk) => ({
        index: chunk.index,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        blockCount: chunk.blocks.length,
        preview: chunk.blocks
          .map((block) => block.text)
          .join('')
          .slice(0, 160),
        analyzable: chunk.blocks.some((block) => !!block.text.trim()),
      })),
    };
  }
  submit(user: CurrentUser, projectId: string, key: string, input: AnalysisInput) {
    const requestHash = textChecksum(JSON.stringify(input));
    return this.database.db.transaction(
      (tx) => {
        const project = this.authz.project(user, projectId, 'edit');
        const existing = tx
          .select()
          .from(analysisRuns)
          .where(
            and(
              eq(analysisRuns.projectId, projectId),
              eq(analysisRuns.createdBy, user.id),
              eq(analysisRuns.idempotencyKey, key),
            ),
          )
          .get();
        if (existing) {
          if (existing.requestHash !== requestHash)
            fail(409, 'IDEMPOTENCY_CONFLICT', '相同请求标识已用于不同的分析参数');
          return runSummary(existing);
        }
        if (project.version !== input.expectedProjectVersion)
          fail(409, 'VERSION_CONFLICT', '项目设定已变化，请刷新页面后确认分析设定');
        const selected = this.connections.getModel(input.modelProfileId);
        if (selected.profile.workspaceId !== project.workspaceId)
          fail(404, 'NOT_FOUND', '文本模型不属于当前工作区');
        if (!selected.connection.enabled || !selected.profile.enabled)
          fail(400, 'MODEL_DISABLED', '文本连接或模型已停用');
        const active = tx
          .select({ value: count() })
          .from(analysisRuns)
          .where(
            and(
              eq(analysisRuns.workspaceId, project.workspaceId),
              inArray(analysisRuns.state, ['queued', 'preparing', 'submitted', 'retry_waiting']),
            ),
          )
          .get()!.value;
        if (active >= 100) fail(429, 'ANALYSIS_QUEUE_FULL', '工作区待处理分析任务过多，请等待已有任务完成');
        const revision = this.scripts.readVersion(user, projectId, input.revisionVersion);
        const chunk = sourceChunks(revision.id, revision.content)[input.chunkIndex];
        if (!chunk || !chunk.blocks.some((block) => !!block.text.trim()))
          fail(400, 'ANALYSIS_RANGE_INVALID', '请选择包含原文的有效分析范围');
        const { profile, connection } = selected,
          now = new Date().toISOString();
        const snapshot = {
          profileId: profile.id,
          profileVersion: profile.version,
          connectionId: connection.id,
          connectionVersion: connection.version,
          providerType: connection.providerType,
          connectionName: connection.name,
          name: profile.name,
          baseUrl: connection.baseUrl,
          trustedPrivate: connection.trustedPrivate,
          model: profile.model,
          outputMode: profile.outputMode,
          tokenParameter: profile.tokenParameter,
          maxOutputTokens: profile.maxOutputTokens,
          timeoutSeconds: profile.timeoutSeconds,
        };
        const frozen = {
          schemaVersion: analysisSchemaName,
          revision: { id: revision.id, version: revision.version, checksum: revision.checksum },
          chunk,
          contextSummary: input.contextSummary,
          project: {
            id: project.id,
            version: project.version,
            title: project.title,
            workFormat: project.workFormat,
            narrativeMode: project.narrativeMode,
            targetDurationSeconds: project.targetDurationSeconds,
            aspectRatio: project.aspectRatio,
            language: project.language,
            stylePreset: project.stylePreset,
            styleDescription: project.styleDescription,
            directorNotes: project.directorNotes,
          },
        };
        const row = tx
          .insert(analysisRuns)
          .values({
            id: randomUUID(),
            workspaceId: project.workspaceId,
            projectId,
            revisionId: revision.id,
            modelProfileId: profile.id,
            createdBy: user.id,
            idempotencyKey: key,
            requestHash,
            inputJson: JSON.stringify(frozen),
            connectionSnapshotJson: JSON.stringify(snapshot),
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get()!;
        this.audit(user, row, 'analysis.submit');
        return runSummary(row);
      },
      { behavior: 'immediate' },
    );
  }
  private audit(user: CurrentUser, row: AnalysisRow, action: string) {
    this.database.db
      .insert(auditEvents)
      .values({
        id: randomUUID(),
        workspaceId: row.workspaceId,
        actorId: user.id,
        action,
        targetId: row.id,
        createdAt: new Date().toISOString(),
      })
      .run();
  }
  list(user: CurrentUser, projectId: string, cursor?: string) {
    this.authz.project(user, projectId);
    const rows = this.database.db
      .select()
      .from(analysisRuns)
      .where(and(eq(analysisRuns.projectId, projectId), cursor ? gt(analysisRuns.id, cursor) : undefined))
      .orderBy(asc(analysisRuns.id))
      .limit(31)
      .all();
    return { items: rows.slice(0, 30).map(runSummary), nextCursor: rows.length > 30 ? rows[29].id : null };
  }
  record(user: CurrentUser, id: string, edit = false) {
    const row = this.database.db.select().from(analysisRuns).where(eq(analysisRuns.id, id)).get();
    if (!row) fail(404, 'NOT_FOUND', '分析任务不存在');
    this.authz.project(user, row.projectId, edit ? 'edit' : 'read');
    return row;
  }
  read(user: CurrentUser, id: string) {
    const row = this.record(user, id);
    const input = JSON.parse(row.inputJson);
    const proposal = this.database.db
      .select()
      .from(analysisProposals)
      .where(eq(analysisProposals.runId, id))
      .get();
    return {
      ...runSummary(row),
      traceId: `${row.id}:${row.attempts}`,
      providerTaskId: row.providerTaskId,
      contextSummary: input.contextSummary,
      settings: input.project,
      sources: input.chunk.blocks,
      proposal: proposal
        ? {
            ...this.reviews.view(user, proposal.id),
            schemaVersion: proposal.schemaVersion,
            createdAt: proposal.createdAt,
          }
        : null,
    };
  }
  transition(
    user: CurrentUser,
    id: string,
    expectedVersion: number,
    retry: boolean,
    acknowledgePossibleCharge = false,
  ) {
    return this.database.db.transaction(
      (tx) => {
        const row = this.record(user, id, true);
        if (row.version !== expectedVersion)
          fail(409, 'VERSION_CONFLICT', '分析任务状态已变化，请刷新后重试');
        if (
          retry
            ? !['failed', 'needs_reconciliation'].includes(row.state)
            : !['queued', 'preparing', 'submitted', 'retry_waiting'].includes(row.state)
        )
          fail(409, 'ANALYSIS_STATE_CONFLICT', '当前状态不能执行此操作');
        if (retry && !acknowledgePossibleCharge)
          fail(400, 'RETRY_ACK_REQUIRED', '请先核实远端调用，并明确确认可能发生再次计费');
        tx.update(analysisRuns)
          .set({
            state: retry ? 'queued' : 'cancelled',
            retryCount: 0,
            nextRunAt: 0,
            leaseOwner: null,
            leaseUntil: null,
            errorCode: retry ? null : 'TRACKING_STOPPED',
            errorMessage: retry ? null : '已停止跟踪，不代表远端调用已取消',
            version: row.version + 1,
            updatedAt: new Date().toISOString(),
          })
          .where(and(eq(analysisRuns.id, id), eq(analysisRuns.version, expectedVersion)))
          .run();
        this.audit(user, row, retry ? 'analysis.retry_confirmed' : 'analysis.stop_tracking');
        return this.read(user, id);
      },
      { behavior: 'immediate' },
    );
  }
  status(user: CurrentUser, workspaceId: string) {
    this.authz.workspace(user, workspaceId);
    const heartbeat = this.database.db
      .select()
      .from(systemState)
      .where(eq(systemState.key, 'text_worker_heartbeat'))
      .get();
    const lastSeenAt = heartbeat ? Number(heartbeat.value) : null;
    return { online: lastSeenAt !== null && Date.now() - lastSeenAt < 15000, lastSeenAt };
  }
}
