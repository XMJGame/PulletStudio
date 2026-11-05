import { Injectable } from '@nestjs/common';
import { and, desc, eq, lt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CurrentUser, fail } from '../common/http';
import { DatabaseService } from '../db/database.service';
import {
  auditEvents,
  generationJobs,
  mediaVersions,
  shotTakeSelections,
  takes,
  takeReviewEvents,
  users,
} from '../db/schema';
import { AuthorizationService } from '../production/authorization.service';
import { ProductionService } from '../production/production.service';
import { assertSampleAccess } from './entity-references';
import { takeReviewState } from './take-review-state';

const reason = z.string().trim().min(1).max(1000);
export const takeReviewInput = z
  .object({
    action: z.enum(['submit', 'withdraw', 'approve', 'reject', 'revoke']),
    reason,
    expectedDecisionVersion: z.number().int().nonnegative(),
  })
  .strict();
export const takeSelectionInput = z
  .object({
    takeId: z.uuid().nullable(),
    reason,
    expectedSelectionVersion: z.number().int().nonnegative(),
  })
  .strict();
type ReviewInput = z.infer<typeof takeReviewInput>;
type SelectionInput = z.infer<typeof takeSelectionInput>;
const transitions = {
  submit: ['draft', 'rejected', 'revoked'],
  withdraw: ['submitted'],
  approve: ['submitted'],
  reject: ['submitted'],
  revoke: ['approved'],
};

@Injectable()
export class TakeReviewService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
    private readonly production: ProductionService,
  ) {}

  private take(user: CurrentUser, id: string, action: 'read' | 'edit' | 'review' = 'read') {
    const take = this.database.db.select().from(takes).where(eq(takes.id, id)).get();
    if (!take) fail(404, 'NOT_FOUND', '候选不存在或无权访问');
    const project = this.authz.project(user, take.projectId, action);
    const shot = this.production.shot(user, take.shotId);
    return { take, project, shot };
  }
  private mediaAccess(user: CurrentUser, mediaId: string) {
    const media = this.database.db.select().from(mediaVersions).where(eq(mediaVersions.id, mediaId)).get();
    if (!media) fail(404, 'NOT_FOUND', '媒体版本不存在或无权访问');
    assertSampleAccess(this.database, user, media);
  }
  private audit(user: CurrentUser, workspaceId: string, action: string, targetId: string, createdAt: string) {
    this.database.db
      .insert(auditEvents)
      .values({
        id: randomUUID(),
        workspaceId,
        actorId: user.id,
        action,
        targetId,
        createdAt,
      })
      .run();
  }
  list(user: CurrentUser, id: string, before?: number) {
    return this.database.db.transaction(() => {
      const { take, shot, project } = this.take(user, id);
      const rows = this.database.db
        .select({
          id: takeReviewEvents.id,
          version: takeReviewEvents.version,
          action: takeReviewEvents.action,
          reason: takeReviewEvents.reason,
          actorName: users.name,
          createdAt: takeReviewEvents.createdAt,
          shotVersion: takeReviewEvents.shotVersion,
          projectVersion: takeReviewEvents.projectVersion,
          mediaVersionId: takeReviewEvents.mediaVersionId,
          promptId: takeReviewEvents.promptId,
          generationJobId: takeReviewEvents.generationJobId,
        })
        .from(takeReviewEvents)
        .innerJoin(users, eq(users.id, takeReviewEvents.actorId))
        .where(
          and(eq(takeReviewEvents.takeId, id), before ? lt(takeReviewEvents.version, before) : undefined),
        )
        .orderBy(desc(takeReviewEvents.version))
        .limit(21)
        .all();
      return {
        ...takeReviewState(this.database, id, shot.version, project.version),
        ...this.production.access(user, project.id),
        takeId: id,
        takeNo: take.takeNo,
        shotId: take.shotId,
        mediaVersionId: take.mediaVersionId,
        items: rows.slice(0, 20),
        nextCursor: rows.length > 20 ? rows[19].version : null,
      };
    });
  }
  decide(user: CurrentUser, id: string, input: ReviewInput, key: string) {
    return this.database.db.transaction(
      () => {
        const permission = ['submit', 'withdraw'].includes(input.action) ? 'edit' : 'review';
        const { take, shot, project } = this.take(user, id, permission);
        this.mediaAccess(user, take.mediaVersionId);
        const replay = this.database.db
          .select()
          .from(takeReviewEvents)
          .where(
            and(
              eq(takeReviewEvents.takeId, id),
              eq(takeReviewEvents.actorId, user.id),
              eq(takeReviewEvents.requestKey, key),
            ),
          )
          .get();
        if (replay) {
          if (
            replay.action !== input.action ||
            replay.reason !== input.reason ||
            replay.version !== input.expectedDecisionVersion + 1
          )
            fail(409, 'IDEMPOTENCY_CONFLICT', '此请求标识已用于其他审核决定');
          return { id: replay.id, version: replay.version };
        }
        const state = takeReviewState(this.database, id, shot.version, project.version);
        if (state.decisionVersion !== input.expectedDecisionVersion)
          fail(409, 'TAKE_REVIEW_CONFLICT', '审核已有新记录，请刷新后核对');
        if (!transitions[input.action].includes(state.status))
          fail(409, 'TAKE_REVIEW_TRANSITION', '当前候选状态不支持此操作');
        if (input.action === 'approve' && state.stale)
          fail(409, 'TAKE_REVIEW_INPUT_CHANGED', '制作卡或项目已变化，请先撤回并重新提审');
        let context = state.context;
        if (input.action === 'submit') {
          if (!this.production.card(user, shot.id).available)
            fail(409, 'CARD_REQUIRED', '请先保存完整制作卡');
          const source = this.database.db
            .select()
            .from(generationJobs)
            .where(and(eq(generationJobs.takeId, id), eq(generationJobs.state, 'completed')))
            .get();
          context = {
            shotVersion: shot.version,
            projectVersion: project.version,
            generationJobId: source?.id ?? null,
            promptId: source?.promptId ?? null,
          };
        }
        const eventId = randomUUID(),
          createdAt = new Date().toISOString(),
          version = state.decisionVersion + 1;
        this.database.db
          .insert(takeReviewEvents)
          .values({
            id: eventId,
            takeId: id,
            shotId: shot.id,
            projectId: project.id,
            workspaceId: project.workspaceId,
            mediaVersionId: take.mediaVersionId,
            version,
            action: input.action,
            ...context!,
            reason: input.reason,
            actorId: user.id,
            createdAt,
            requestKey: key,
          })
          .run();
        this.audit(user, project.workspaceId, `take.${input.action}`, id, createdAt);
        return { id: eventId, version };
      },
      { behavior: 'immediate' },
    );
  }
  selection(user: CurrentUser, shotId: string, before?: number) {
    return this.database.db.transaction(() => {
      const shot = this.production.shot(user, shotId);
      const project = this.authz.project(user, shot.projectId);
      const latest = this.database.db
        .select()
        .from(shotTakeSelections)
        .where(eq(shotTakeSelections.shotId, shotId))
        .orderBy(desc(shotTakeSelections.version))
        .get();
      const selected = latest?.takeId ? this.take(user, latest.takeId).take : null;
      const review = selected
        ? takeReviewState(this.database, selected.id, shot.version, project.version)
        : null;
      const valid = Boolean(
        review && review.status === 'approved' && !review.stale && review.decisionId === latest?.approvalId,
      );
      const rows = this.database.db
        .select({
          id: shotTakeSelections.id,
          version: shotTakeSelections.version,
          takeId: shotTakeSelections.takeId,
          approvalId: shotTakeSelections.approvalId,
          reason: shotTakeSelections.reason,
          actorName: users.name,
          createdAt: shotTakeSelections.createdAt,
          takeNo: takes.takeNo,
        })
        .from(shotTakeSelections)
        .innerJoin(users, eq(users.id, shotTakeSelections.actorId))
        .leftJoin(takes, eq(takes.id, shotTakeSelections.takeId))
        .where(
          and(
            eq(shotTakeSelections.shotId, shotId),
            before ? lt(shotTakeSelections.version, before) : undefined,
          ),
        )
        .orderBy(desc(shotTakeSelections.version))
        .limit(21)
        .all();
      return {
        id: latest?.id ?? null,
        version: latest?.version ?? 0,
        takeId: latest?.takeId ?? null,
        approvalId: latest?.approvalId ?? null,
        takeNo: selected?.takeNo ?? null,
        mediaVersionId: selected?.mediaVersionId ?? null,
        valid,
        invalidReason: selected && !valid ? (review?.stale ? 'INPUT_CHANGED' : 'APPROVAL_CHANGED') : null,
        canReview: this.production.access(user, project.id).canReview,
        items: rows.slice(0, 20),
        nextCursor: rows.length > 20 ? rows[19].version : null,
      };
    });
  }
  select(user: CurrentUser, shotId: string, input: SelectionInput, key: string) {
    return this.database.db.transaction(
      () => {
        const shot = this.production.shot(user, shotId);
        const project = this.authz.project(user, shot.projectId, 'review');
        const replay = this.database.db
          .select()
          .from(shotTakeSelections)
          .where(
            and(
              eq(shotTakeSelections.shotId, shotId),
              eq(shotTakeSelections.actorId, user.id),
              eq(shotTakeSelections.requestKey, key),
            ),
          )
          .get();
        if (replay) {
          if (
            replay.takeId !== input.takeId ||
            replay.reason !== input.reason ||
            replay.version !== input.expectedSelectionVersion + 1
          )
            fail(409, 'IDEMPOTENCY_CONFLICT', '此请求标识已用于其他选片决定');
          return { id: replay.id, version: replay.version };
        }
        const current = this.selection(user, shotId);
        if (current.version !== input.expectedSelectionVersion)
          fail(409, 'TAKE_SELECTION_CONFLICT', '镜头选片已变化，请刷新后核对');
        let approvalId: string | null = null;
        if (input.takeId) {
          const { take } = this.take(user, input.takeId, 'review');
          if (take.shotId !== shotId) fail(404, 'NOT_FOUND', '候选不属于当前镜头');
          this.mediaAccess(user, take.mediaVersionId);
          const review = takeReviewState(this.database, take.id, shot.version, project.version);
          if (review.status !== 'approved' || review.stale)
            fail(409, 'TAKE_NOT_APPROVED', '请选择当前制作卡及项目版本下有效批准的候选');
          approvalId = review.decisionId;
        }
        if (current.takeId === input.takeId && current.approvalId === approvalId)
          fail(409, 'TAKE_SELECTION_UNCHANGED', '此选片决定已经生效');
        const id = randomUUID(),
          createdAt = new Date().toISOString(),
          version = current.version + 1;
        this.database.db
          .insert(shotTakeSelections)
          .values({
            id,
            shotId,
            projectId: project.id,
            workspaceId: project.workspaceId,
            version,
            takeId: input.takeId,
            approvalId,
            reason: input.reason,
            actorId: user.id,
            createdAt,
            requestKey: key,
          })
          .run();
        this.audit(user, project.workspaceId, 'take.select', shotId, createdAt);
        return { id, version };
      },
      { behavior: 'immediate' },
    );
  }
}
