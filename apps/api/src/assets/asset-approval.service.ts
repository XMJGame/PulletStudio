import { HttpException, Injectable } from '@nestjs/common';
import { and, desc, eq, lt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { CurrentUser, fail } from '../common/http';
import { DatabaseService } from '../db/database.service';
import {
  assetEntityRevisions,
  assetRevisionDecisions,
  auditEvents,
  mediaVersions,
  users,
} from '../db/schema';
import { AuthorizationService } from '../production/authorization.service';
import { ProductionService } from '../production/production.service';
import { assetApproval } from './asset-approval-state';
import { assertSampleAccess } from './entity-references';

export type AssetDecisionInput = {
  action: 'approve' | 'revoke';
  reason: string;
  expectedDecisionVersion: number;
};

@Injectable()
export class AssetApprovalService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
    private readonly production: ProductionService,
  ) {}

  private revision(user: CurrentUser, entityId: string, version: number, action: 'read' | 'review') {
    const row = this.database.db
      .select()
      .from(assetEntityRevisions)
      .where(and(eq(assetEntityRevisions.entityId, entityId), eq(assetEntityRevisions.version, version)))
      .get();
    if (!row) fail(404, 'NOT_FOUND', '资产版本不存在或无权访问');
    this.authz.project(user, row.projectId, action);
    return row;
  }

  list(user: CurrentUser, entityId: string, version: number, before?: number) {
    return this.database.db.transaction(() => {
      const revision = this.revision(user, entityId, version, 'read');
      const rows = this.database.db
        .select({
          id: assetRevisionDecisions.id,
          version: assetRevisionDecisions.version,
          action: assetRevisionDecisions.action,
          reason: assetRevisionDecisions.reason,
          actorName: users.name,
          createdAt: assetRevisionDecisions.createdAt,
        })
        .from(assetRevisionDecisions)
        .innerJoin(users, eq(users.id, assetRevisionDecisions.actorId))
        .where(
          and(
            eq(assetRevisionDecisions.revisionId, revision.id),
            before ? lt(assetRevisionDecisions.version, before) : undefined,
          ),
        )
        .orderBy(desc(assetRevisionDecisions.version))
        .limit(21)
        .all();
      return {
        ...assetApproval(this.database, revision.id),
        items: rows.slice(0, 20),
        nextCursor: rows.length > 20 ? rows[19].version : null,
      };
    });
  }

  decide(
    user: CurrentUser,
    entityId: string,
    version: number,
    input: AssetDecisionInput,
    requestKey: string,
  ) {
    return this.database.db.transaction(
      () => {
        const revision = this.revision(user, entityId, version, 'review');
        const existing = this.database.db
          .select()
          .from(assetRevisionDecisions)
          .where(
            and(
              eq(assetRevisionDecisions.revisionId, revision.id),
              eq(assetRevisionDecisions.actorId, user.id),
              eq(assetRevisionDecisions.requestKey, requestKey),
            ),
          )
          .get();
        if (existing) {
          if (
            existing.version !== input.expectedDecisionVersion + 1 ||
            existing.action !== input.action ||
            existing.reason !== input.reason
          )
            fail(409, 'IDEMPOTENCY_CONFLICT', '此请求标识已用于其他审核决定');
          return { id: existing.id, version: existing.version };
        }
        const state = assetApproval(this.database, revision.id);
        if (state.decisionVersion !== input.expectedDecisionVersion)
          fail(409, 'ASSET_REVIEW_CONFLICT', '此版本的审批已变化，请刷新审批记录');
        if ((state.status === 'approved') === (input.action === 'approve'))
          fail(409, 'ASSET_REVIEW_TRANSITION', '当前审批状态不支持此操作');
        const id = randomUUID(),
          createdAt = new Date().toISOString();
        const decisionVersion = state.decisionVersion + 1;
        this.database.db
          .insert(assetRevisionDecisions)
          .values({
            id,
            revisionId: revision.id,
            projectId: revision.projectId,
            workspaceId: revision.workspaceId,
            version: decisionVersion,
            action: input.action,
            reason: input.reason,
            actorId: user.id,
            createdAt,
            requestKey,
          })
          .run();
        this.database.db
          .insert(auditEvents)
          .values({
            id: randomUUID(),
            workspaceId: revision.workspaceId,
            actorId: user.id,
            action: `entity.revision.${input.action}`,
            targetId: revision.id,
            createdAt,
          })
          .run();
        return { id, version: decisionVersion };
      },
      { behavior: 'immediate' },
    );
  }

  readiness(user: CurrentUser, shotId: string) {
    return this.database.db.transaction(() => {
      const shot = this.production.shot(user, shotId);
      const card = this.production.card(user, shotId);
      const blockers: { code: string; message: string; revisionId?: string }[] = [];
      if (!card.available) blockers.push({ code: 'CARD_REQUIRED', message: '请先保存完整制作卡' });
      if (card.available) {
        for (const reference of card.assetReferences) {
          const block = (code: string, message: string) =>
            blockers.push({ code, message, revisionId: reference.id });
          if (reference.status !== 'approved')
            block('ASSET_NOT_APPROVED', `「${reference.name}」v${reference.version}需要有效批准`);
          if (reference.kind !== 'voice') continue;
          if (
            !['owned', 'licensed', 'consented'].includes(reference.attributes.consentStatus) ||
            !reference.attributes.usageRights?.trim()
          )
            block('VOICE_RIGHTS_REQUIRED', `「${reference.name}」需要记录声音授权及使用范围`);
          if (
            reference.media.some((sample) => {
              const media = this.database.db
                .select()
                .from(mediaVersions)
                .where(eq(mediaVersions.id, sample.mediaVersionId))
                .get()!;
              try {
                assertSampleAccess(this.database, user, media);
                return false;
              } catch (error) {
                if (error instanceof HttpException && error.getStatus() === 403) return true;
                throw error;
              }
            })
          )
            block('VOICE_SAMPLE_RESTRICTED', `当前账户无权读取「${reference.name}」的样本`);
        }
      }
      return { shotVersion: shot.version, ready: blockers.length === 0, blockers };
    });
  }
}
