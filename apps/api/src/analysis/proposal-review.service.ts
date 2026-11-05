import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, lt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { CurrentUser, fail } from '../common/http';
import { DatabaseService } from '../db/database.service';
import {
  analysisProposals,
  analysisRuns,
  auditEvents,
  proposalAdoptions,
  proposalReviews,
  proposalRevisions,
  scriptRevisions,
  scripts,
  scriptSpans,
  users,
} from '../db/schema';
import { AuthorizationService } from '../production/authorization.service';
import { ProductionService } from '../production/production.service';
import { appendShotCard } from '../production/shot-cards';
import { textChecksum } from '../scripts/script-evidence';
import { ManualShot, SourceBlock, validateShotDraft } from './analysis-contract';

type DraftBody = ReturnType<typeof validateShotDraft>;
type ReviewContext = {
  proposal: typeof analysisProposals.$inferSelect;
  run: typeof analysisRuns.$inferSelect;
  head: typeof proposalReviews.$inferSelect | undefined;
  revision: typeof proposalRevisions.$inferSelect | undefined;
  body: DraftBody;
  version: number;
  status: 'draft' | 'rejected' | 'accepted';
  input: { project: { version: number }; revision: { version: number }; chunk: { blocks: SourceBlock[] } };
};
function editableBody(body: DraftBody) {
  return {
    title: body.title,
    summary: body.summary,
    shots: body.shots.map(({ sources: _sources, ...shot }) => shot),
  };
}
@Injectable()
export class ProposalReviewService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
    private readonly production: ProductionService,
  ) {}
  private context(user: CurrentUser, id: string, action: 'read' | 'edit' | 'review' = 'read'): ReviewContext {
    const proposal = this.database.db
      .select()
      .from(analysisProposals)
      .where(eq(analysisProposals.id, id))
      .get();
    if (!proposal) fail(404, 'NOT_FOUND', '分镜草案不存在');
    this.authz.project(user, proposal.projectId, action);
    const run = this.database.db
      .select()
      .from(analysisRuns)
      .where(eq(analysisRuns.id, proposal.runId))
      .get()!;
    const head = this.database.db
      .select()
      .from(proposalReviews)
      .where(eq(proposalReviews.proposalId, id))
      .get();
    const revision = head
      ? this.database.db
          .select()
          .from(proposalRevisions)
          .where(and(eq(proposalRevisions.proposalId, id), eq(proposalRevisions.version, head.version)))
          .get()
      : undefined;
    return {
      proposal,
      run,
      head,
      revision,
      body: JSON.parse(revision?.bodyJson ?? proposal.bodyJson),
      version: head?.version ?? 0,
      status: head?.state ?? 'draft',
      input: JSON.parse(run.inputJson),
    };
  }
  private changes(user: CurrentUser, context: ReviewContext) {
    const project = this.authz.project(user, context.proposal.projectId);
    const script = this.database.db.select().from(scripts).where(eq(scripts.projectId, project.id)).get();
    return {
      projectChanged: project.version !== context.input.project.version,
      scriptChanged: script?.version !== context.input.revision.version,
      currentProjectVersion: project.version,
      currentScriptVersion: script?.version || 0,
      sourceRevisionVersion: context.input.revision.version,
    };
  }
  private adoptions(user: CurrentUser, context: ReviewContext) {
    return this.database.db
      .select()
      .from(proposalAdoptions)
      .where(eq(proposalAdoptions.proposalId, context.proposal.id))
      .orderBy(asc(proposalAdoptions.candidateIndex))
      .all()
      .map((link) => {
        const shot = this.production.shot(user, link.shotId);
        return {
          id: shot.id,
          code: shot.code,
          version: shot.version,
          unitId: shot.unitId,
          candidateIndex: link.candidateIndex,
        };
      });
  }
  view(user: CurrentUser, id: string) {
    const context = this.context(user, id);
    let canEdit = false,
      canReview = false;
    try {
      this.authz.project(user, context.proposal.projectId, 'edit');
      canEdit = true;
    } catch {
      /* View access was already checked. */
    }
    try {
      this.authz.project(user, context.proposal.projectId, 'review');
      canReview = true;
    } catch {
      /* Review does not grant general editing. */
    }
    return {
      id,
      projectId: context.proposal.projectId,
      runId: context.run.id,
      status: context.status,
      version: context.version,
      body: context.body,
      canEdit,
      canReview,
      summary: context.revision?.summary || '原始模型草案',
      updatedAt: context.head?.updatedAt || context.proposal.createdAt,
      inputChanges: this.changes(user, context),
      sources: context.input.chunk.blocks,
      adoptedShots: this.adoptions(user, context),
    };
  }
  private expect(context: ReviewContext, version: number) {
    if (context.version !== version) fail(409, 'VERSION_CONFLICT', '草案已被修改或审核，本地输入已保留');
  }
  private append(
    user: CurrentUser,
    context: ReviewContext,
    action: 'edit' | 'rejected' | 'reopened' | 'accepted',
    body: DraftBody,
    summary: string,
    decision: Record<string, unknown> = {},
  ) {
    const version = context.version + 1,
      now = new Date().toISOString(),
      id = randomUUID();
    this.database.db
      .insert(proposalRevisions)
      .values({
        id,
        proposalId: context.proposal.id,
        projectId: context.proposal.projectId,
        workspaceId: context.proposal.workspaceId,
        version,
        action,
        bodyJson: JSON.stringify(body),
        summary,
        decisionJson: JSON.stringify(decision),
        createdBy: user.id,
        createdAt: now,
      })
      .run();
    const state = action === 'accepted' ? 'accepted' : action === 'rejected' ? 'rejected' : 'draft';
    if (context.head)
      this.database.db
        .update(proposalReviews)
        .set({ state, version, updatedAt: now })
        .where(
          and(
            eq(proposalReviews.proposalId, context.proposal.id),
            eq(proposalReviews.version, context.version),
          ),
        )
        .run();
    else
      this.database.db
        .insert(proposalReviews)
        .values({
          proposalId: context.proposal.id,
          projectId: context.proposal.projectId,
          workspaceId: context.proposal.workspaceId,
          state,
          version,
          updatedAt: now,
        })
        .run();
    this.database.db
      .insert(auditEvents)
      .values({
        id: randomUUID(),
        workspaceId: context.proposal.workspaceId,
        actorId: user.id,
        action: `proposal.${action}`,
        targetId: context.proposal.id,
        createdAt: now,
      })
      .run();
    return id;
  }
  edit(
    user: CurrentUser,
    id: string,
    index: number,
    expectedVersion: number,
    shot: ManualShot,
    summary: string,
  ) {
    return this.database.db.transaction(
      () => {
        const context = this.context(user, id, 'edit');
        this.expect(context, expectedVersion);
        if (context.status !== 'draft')
          fail(409, 'PROPOSAL_STATE_CONFLICT', '仅待审核草案可以编辑；已采纳草案保持不变');
        const body = editableBody(context.body);
        if (index >= body.shots.length) fail(404, 'NOT_FOUND', '候选镜头不存在');
        body.shots[index] = shot;
        let validated: DraftBody;
        try {
          validated = validateShotDraft(body, context.input.chunk.blocks, true);
        } catch {
          fail(400, 'PROPOSAL_INVALID', '候选内容或来源引用不符合约定');
        }
        this.append(user, context, 'edit', validated, summary || `编辑候选 ${index + 1}`);
        return this.view(user, id);
      },
      { behavior: 'immediate' },
    );
  }
  decide(user: CurrentUser, id: string, expectedVersion: number, reopen: boolean, reason: string) {
    return this.database.db.transaction(
      () => {
        const context = this.context(user, id, 'review');
        this.expect(context, expectedVersion);
        if (context.status !== (reopen ? 'rejected' : 'draft'))
          fail(
            409,
            'PROPOSAL_STATE_CONFLICT',
            reopen ? '只有被拒绝的草案可以重开，已采纳草案不可重开' : '仅待审核草案可以拒绝',
          );
        this.append(user, context, reopen ? 'reopened' : 'rejected', context.body, reason);
        return this.view(user, id);
      },
      { behavior: 'immediate' },
    );
  }
  accept(
    user: CurrentUser,
    id: string,
    input: {
      expectedVersion: number;
      expectedProjectVersion: number;
      unitId: string | null;
      acknowledgeCreation: true;
      acknowledgeInputChanges: boolean;
    },
  ) {
    return this.database.db.transaction(
      () => {
        const context = this.context(user, id, 'review');
        if (context.status === 'accepted') {
          const decision = JSON.parse(context.revision!.decisionJson);
          if (
            input.expectedVersion === context.version - 1 &&
            input.unitId === decision.unitId &&
            input.expectedProjectVersion === decision.projectVersion
          )
            return { ...this.view(user, id), alreadyAccepted: true };
          fail(409, 'PROPOSAL_ALREADY_ACCEPTED', '草案已采纳，不能再次创建或改投其他制作单元');
        }
        this.expect(context, input.expectedVersion);
        if (context.status !== 'draft') fail(409, 'PROPOSAL_STATE_CONFLICT', '仅待审核草案可以采纳');
        const project = this.authz.project(user, context.proposal.projectId, 'review');
        if (project.version !== input.expectedProjectVersion)
          fail(409, 'VERSION_CONFLICT', '项目设定已变化，请刷新审核信息后重试');
        const changes = this.changes(user, context);
        if ((changes.projectChanged || changes.scriptChanged) && !input.acknowledgeInputChanges)
          fail(409, 'PROPOSAL_INPUT_CHANGED', '原文或项目设定已有新版本，请核对旧来源后明确确认采纳');
        if (input.unitId) {
          const target = this.production.unitRecord(user, input.unitId, 'review');
          if (target.projectId !== project.id) fail(404, 'NOT_FOUND', '目标制作单元不属于当前项目');
        }
        const missing = context.body.shots
          .map((shot, index) =>
            Number.isInteger(shot.durationSeconds) &&
            shot.durationSeconds! >= 1 &&
            shot.durationSeconds! <= 3600
              ? -1
              : index,
          )
          .filter((index) => index >= 0);
        if (missing.length)
          fail(
            400,
            'PROPOSAL_DURATION_REQUIRED',
            '请先为每个候选确认 1–3600 整数秒的计划时长，系统不套用默认时长',
            { candidateIndices: missing },
          );
        const acceptedRevisionId = this.append(
          user,
          context,
          'accepted',
          context.body,
          '确认采纳为正式镜头',
          {
            unitId: input.unitId,
            projectVersion: project.version,
            acknowledgeInputChanges: input.acknowledgeInputChanges,
          },
        );
        const revision = this.database.db
          .select()
          .from(scriptRevisions)
          .where(
            and(
              eq(scriptRevisions.id, context.run.revisionId),
              eq(scriptRevisions.projectId, project.id),
              eq(scriptRevisions.workspaceId, project.workspaceId),
            ),
          )
          .get()!;
        const byId = new Map(context.input.chunk.blocks.map((block) => [block.id, block]));
        for (const [index, candidate] of context.body.shots.entries()) {
          const { sources: _sources, ...body } = candidate;
          for (const sourceId of body.sourceSpanIds) {
            const source = byId.get(sourceId);
            if (
              !source ||
              source.revisionId !== revision.id ||
              source.textHash !== textChecksum(revision.content.slice(source.startOffset, source.endOffset))
            )
              fail(409, 'SOURCE_EVIDENCE_CHANGED', '原文证据校验不一致，未创建镜头');
            this.database.db
              .insert(scriptSpans)
              .values({
                id: source.id,
                revisionId: revision.id,
                projectId: project.id,
                workspaceId: project.workspaceId,
                startOffset: source.startOffset,
                endOffset: source.endOffset,
                textHash: source.textHash,
                createdAt: new Date().toISOString(),
              })
              .onConflictDoNothing()
              .run();
          }
          const shot = this.production.createReviewedShot(user, project.id, {
            unitId: input.unitId,
            description: body.description,
            camera: body.cameraMovement,
            dialogue: body.dialogue,
            durationHint: body.durationSeconds!,
            technique: body.technique,
          });
          appendShotCard(this.database, user, shot, body, acceptedRevisionId, '人工采纳分镜草案');
          this.database.db
            .insert(proposalAdoptions)
            .values({
              proposalId: id,
              candidateIndex: index,
              proposalRevisionId: acceptedRevisionId,
              shotId: shot.id,
              projectId: project.id,
              workspaceId: project.workspaceId,
            })
            .run();
        }
        return { ...this.view(user, id), alreadyAccepted: false };
      },
      { behavior: 'immediate' },
    );
  }
  history(user: CurrentUser, id: string, before?: number) {
    const context = this.context(user, id);
    const rows = this.database.db
      .select({
        version: proposalRevisions.version,
        action: proposalRevisions.action,
        summary: proposalRevisions.summary,
        createdAt: proposalRevisions.createdAt,
        authorName: users.name,
      })
      .from(proposalRevisions)
      .innerJoin(users, eq(users.id, proposalRevisions.createdBy))
      .where(
        and(
          eq(proposalRevisions.proposalId, id),
          before === undefined ? undefined : lt(proposalRevisions.version, before),
        ),
      )
      .orderBy(desc(proposalRevisions.version))
      .limit(31)
      .all();
    const items = rows.slice(0, 30);
    if (rows.length > 30 || items.length === 30) return { items, nextCursor: items.at(-1)!.version };
    if (before === undefined || before > 0)
      items.push({
        version: 0,
        action: 'edit',
        summary: '原始模型草案',
        createdAt: context.proposal.createdAt,
        authorName: '模型生成',
      });
    return { items, nextCursor: null };
  }
  version(user: CurrentUser, id: string, version: number) {
    const context = this.context(user, id);
    if (!version)
      return {
        version: 0,
        body: JSON.parse(context.proposal.bodyJson),
        summary: '原始模型草案',
        createdAt: context.proposal.createdAt,
      };
    const row = this.database.db
      .select()
      .from(proposalRevisions)
      .where(and(eq(proposalRevisions.proposalId, id), eq(proposalRevisions.version, version)))
      .get();
    if (!row) fail(404, 'NOT_FOUND', '草案修订不存在');
    return {
      version,
      action: row.action,
      body: JSON.parse(row.bodyJson),
      summary: row.summary,
      createdAt: row.createdAt,
    };
  }
}
