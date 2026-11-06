import { Injectable } from '@nestjs/common';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { randomUUID, createHash } from 'node:crypto';
import { CurrentUser, fail, parse } from '../common/http';
import { DatabaseService } from '../db/database.service';
import {
  assetEntities,
  assetEntityRevisions,
  entityMediaBindings,
  mediaVersions,
  auditEvents,
  shotAssetBindings,
  shots,
} from '../db/schema';
import { AuthorizationService } from '../production/authorization.service';
import { attributesByKind, EntityBody, entityKinds } from './entity-contract';
import { assertSampleAccess, entityRevisionSnapshot } from './entity-references';
import { assetApproval } from './asset-approval-state';
type Kind = (typeof entityKinds)[number];
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
@Injectable()
export class EntitiesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
  ) {}
  private entity(user: CurrentUser, id: string, action: 'read' | 'edit' = 'read') {
    const row = this.database.db.select().from(assetEntities).where(eq(assetEntities.id, id)).get();
    if (!row) fail(404, 'NOT_FOUND', '资产不存在或无权访问');
    this.authz.project(user, row.projectId, action);
    return row;
  }
  read(user: CurrentUser, id: string, version?: number) {
    const entity = this.entity(user, id);
    const row = this.database.db
      .select()
      .from(assetEntityRevisions)
      .where(
        and(
          eq(assetEntityRevisions.entityId, id),
          eq(assetEntityRevisions.version, version ?? entity.version),
        ),
      )
      .get();
    if (!row) fail(404, 'NOT_FOUND', '资产修订不存在');
    return {
      id: entity.id,
      kind: entity.kind,
      projectId: entity.projectId,
      currentVersion: entity.version,
      revision: {
        ...entityRevisionSnapshot(this.database, row.id, entity.projectId),
        createdAt: row.createdAt,
      },
      canEdit: this.canEdit(user, entity.projectId),
      canReview: this.canReview(user, entity.projectId),
    };
  }
  private canEdit(user: CurrentUser, projectId: string) {
    try {
      this.authz.project(user, projectId, 'edit');
      return true;
    } catch {
      return false;
    }
  }
  private canReview(user: CurrentUser, projectId: string) {
    try {
      this.authz.project(user, projectId, 'review');
      return true;
    } catch {
      return false;
    }
  }
  list(user: CurrentUser, projectId: string, kind?: Kind, cursor?: string) {
    this.authz.project(user, projectId);
    const boundary = cursor
      ? this.database.db
          .select()
          .from(assetEntities)
          .where(
            and(
              eq(assetEntities.id, cursor),
              eq(assetEntities.projectId, projectId),
              kind ? eq(assetEntities.kind, kind) : undefined,
            ),
          )
          .get()
      : undefined;
    if (cursor && !boundary) fail(400, 'INVALID_CURSOR', '资产分页位置无效');
    const rows = this.database.db
      .select()
      .from(assetEntities)
      .where(
        and(
          eq(assetEntities.projectId, projectId),
          kind ? eq(assetEntities.kind, kind) : undefined,
          boundary
            ? or(
                lt(assetEntities.createdAt, boundary.createdAt),
                and(eq(assetEntities.createdAt, boundary.createdAt), lt(assetEntities.id, boundary.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(assetEntities.createdAt), desc(assetEntities.id))
      .limit(21)
      .all();
    return {
      items: rows.slice(0, 20).map((row) => this.read(user, row.id)),
      nextCursor: rows.length > 20 ? rows[19].id : null,
    };
  }
  revisions(user: CurrentUser, id: string, before?: number) {
    this.entity(user, id);
    const rows = this.database.db
      .select({
        id: assetEntityRevisions.id,
        version: assetEntityRevisions.version,
        name: assetEntityRevisions.name,
        createdAt: assetEntityRevisions.createdAt,
      })
      .from(assetEntityRevisions)
      .where(
        and(
          eq(assetEntityRevisions.entityId, id),
          before ? lt(assetEntityRevisions.version, before) : undefined,
        ),
      )
      .orderBy(desc(assetEntityRevisions.version))
      .limit(21)
      .all();
    return {
      items: rows
        .slice(0, 20)
        .map((row) => ({ ...row, status: assetApproval(this.database, row.id).status })),
      nextCursor: rows.length > 20 ? rows[19].version : null,
    };
  }
  save(
    user: CurrentUser,
    projectId: string | null,
    id: string | null,
    kind: Kind | null,
    body: EntityBody,
    key: string,
    expectedVersion?: number,
  ) {
    return this.database.db.transaction(
      () => {
        const previous = id ? this.entity(user, id, 'edit') : null;
        const project = this.authz.project(user, previous?.projectId ?? projectId!, 'edit');
        const actualKind = previous?.kind ?? kind!;
        const attributes = parse<Record<string, string>>(attributesByKind[actualKind], body.attributes),
          normalized = { ...body, attributes };
        const requestHash = hash({
          kind: actualKind,
          body: normalized,
          expectedVersion: expectedVersion ?? 0,
        });
        if (previous) {
          const replay = this.database.db
            .select()
            .from(assetEntityRevisions)
            .where(
              and(
                eq(assetEntityRevisions.entityId, previous.id),
                eq(assetEntityRevisions.idempotencyKey, key),
              ),
            )
            .get();
          if (replay) {
            if (replay.requestHash !== requestHash)
              fail(409, 'IDEMPOTENCY_CONFLICT', '同一请求已用于其他资产内容');
            return this.read(user, previous.id, replay.version);
          }
        } else {
          const replay = this.database.db
            .select()
            .from(assetEntities)
            .where(
              and(
                eq(assetEntities.projectId, project.id),
                eq(assetEntities.createdBy, user.id),
                eq(assetEntities.creationKey, key),
              ),
            )
            .get();
          if (replay) {
            if (replay.requestHash !== requestHash)
              fail(409, 'IDEMPOTENCY_CONFLICT', '同一请求已用于其他资产内容');
            return this.read(user, replay.id, 1);
          }
        }
        if (previous && previous.version !== expectedVersion)
          fail(409, 'VERSION_CONFLICT', '资产已有新修订，输入已保留，请载入最新版本后重试');
        for (const ref of body.media) {
          const media = this.database.db
            .select()
            .from(mediaVersions)
            .where(and(eq(mediaVersions.id, ref.mediaVersionId), eq(mediaVersions.projectId, project.id)))
            .get();
          if (!media) fail(404, 'NOT_FOUND', '参考媒体不存在或不属于当前项目');
          if (media.origin === 'workflow_test') fail(409, 'WORKFLOW_TEST_MEDIA', '试跑证据不能用作资产参考');
          assertSampleAccess(this.database, user, media);
          if (
            actualKind === 'voice'
              ? ref.role !== 'voice_sample' || media.mediaType !== 'audio'
              : ref.role === 'voice_sample' || media.mediaType !== 'image'
          )
            fail(400, 'ENTITY_MEDIA_KIND', '声音样本需要音频，视觉参考需要图片');
          if (
            (actualKind === 'character' &&
              !['front', 'side', 'back', 'closeup', 'detail', 'reference'].includes(ref.role)) ||
            (actualKind === 'environment' &&
              !['overview', 'floorplan', 'detail', 'reference'].includes(ref.role)) ||
            (actualKind === 'prop' &&
              !['front', 'side', 'back', 'closeup', 'detail', 'reference'].includes(ref.role))
          )
            fail(400, 'ENTITY_MEDIA_ROLE', '此参考位置不适用于当前资产类型');
        }
        const entityId = previous?.id ?? randomUUID(),
          version = (previous?.version ?? 0) + 1,
          now = new Date().toISOString();
        if (previous)
          this.database.db
            .update(assetEntities)
            .set({ version })
            .where(and(eq(assetEntities.id, entityId), eq(assetEntities.version, expectedVersion!)))
            .run();
        else
          this.database.db
            .insert(assetEntities)
            .values({
              id: entityId,
              kind: actualKind,
              projectId: project.id,
              workspaceId: project.workspaceId,
              version,
              createdBy: user.id,
              createdAt: now,
              creationKey: key,
              requestHash,
            })
            .run();
        const revisionId = randomUUID();
        this.database.db
          .insert(assetEntityRevisions)
          .values({
            id: revisionId,
            entityId,
            projectId: project.id,
            workspaceId: project.workspaceId,
            version,
            name: body.name,
            description: body.description,
            attributesJson: JSON.stringify(attributes),
            createdBy: user.id,
            createdAt: now,
            idempotencyKey: key,
            requestHash,
          })
          .run();
        for (const ref of body.media)
          this.database.db
            .insert(entityMediaBindings)
            .values({ revisionId, projectId: project.id, workspaceId: project.workspaceId, ...ref })
            .run();
        this.database.db
          .insert(auditEvents)
          .values({
            id: randomUUID(),
            workspaceId: project.workspaceId,
            actorId: user.id,
            action: 'entity.revise',
            targetId: revisionId,
            createdAt: now,
          })
          .run();
        return this.read(user, entityId);
      },
      { behavior: 'immediate' },
    );
  }
  impacts(user: CurrentUser, id: string, cursor?: string) {
    this.entity(user, id);
    const rows = this.database.db
      .select({
        id: shotAssetBindings.id,
        shotId: shots.id,
        code: shots.code,
        cardVersion: shotAssetBindings.cardVersion,
        currentVersion: shots.version,
        entityVersion: assetEntityRevisions.version,
        purpose: shotAssetBindings.purpose,
      })
      .from(shotAssetBindings)
      .innerJoin(assetEntityRevisions, eq(assetEntityRevisions.id, shotAssetBindings.revisionId))
      .innerJoin(shots, eq(shots.id, shotAssetBindings.shotId))
      .where(
        and(eq(assetEntityRevisions.entityId, id), cursor ? lt(shotAssetBindings.id, cursor) : undefined),
      )
      .orderBy(desc(shotAssetBindings.id))
      .limit(21)
      .all();
    return {
      items: rows.slice(0, 20).map((row) => ({ ...row, current: row.cardVersion === row.currentVersion })),
      nextCursor: rows.length > 20 ? rows[19].id : null,
    };
  }
}
