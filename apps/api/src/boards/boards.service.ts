import { Injectable } from '@nestjs/common';
import { and, desc, eq, lt, or } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import type { BoardLayout, BoardView } from '../../../../packages/contracts/src/board';
import { CurrentUser, fail } from '../common/http';
import { DatabaseService } from '../db/database.service';
import { boards, boardRevisions, auditEvents, episodes, users } from '../db/schema';
import { AuthorizationService } from '../production/authorization.service';
import { ProductionService } from '../production/production.service';
import { BoardReferencesService } from './board-references.service';
import { emptyBoard } from './board-contract';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
@Injectable()
export class BoardsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
    private readonly production: ProductionService,
    private readonly references: BoardReferencesService,
  ) {}
  private row(user: CurrentUser, id: string, action: 'read' | 'edit' = 'read') {
    const row = this.database.db.select().from(boards).where(eq(boards.id, id)).get();
    if (!row) fail(404, 'NOT_FOUND', '画布不存在或无权访问');
    this.authz.project(user, row.projectId, action);
    return row;
  }
  private audit(user: CurrentUser, workspaceId: string, action: string, targetId: string) {
    this.database.db
      .insert(auditEvents)
      .values({
        id: randomUUID(),
        workspaceId,
        actorId: user.id,
        action,
        targetId,
        createdAt: new Date().toISOString(),
      })
      .run();
  }
  list(user: CurrentUser, projectId: string, unitId?: string, cursor?: string) {
    this.authz.project(user, projectId);
    if (unitId) {
      const unit = this.production.unitRecord(user, unitId);
      if (unit.projectId !== projectId) fail(404, 'NOT_FOUND', '制作单元不存在');
    }
    const boundary = cursor
      ? this.database.db
          .select()
          .from(boards)
          .where(
            and(
              eq(boards.id, cursor),
              eq(boards.projectId, projectId),
              unitId ? eq(boards.unitId, unitId) : undefined,
            ),
          )
          .get()
      : undefined;
    if (cursor && !boundary) fail(400, 'INVALID_CURSOR', '画布分页位置无效');
    const rows = this.database.db
      .select()
      .from(boards)
      .where(
        and(
          eq(boards.projectId, projectId),
          unitId ? eq(boards.unitId, unitId) : undefined,
          boundary
            ? or(
                lt(boards.createdAt, boundary.createdAt),
                and(eq(boards.createdAt, boundary.createdAt), lt(boards.id, boundary.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(boards.createdAt), desc(boards.id))
      .limit(21)
      .all();
    return {
      items: rows.slice(0, 20).map((row) => ({
        id: row.id,
        title: row.title,
        unitId: row.unitId,
        revision: row.version,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
      nextCursor: rows.length > 20 ? rows[19].id : null,
    };
  }
  read(user: CurrentUser, id: string, version?: number): BoardView {
    return this.database.db.transaction(() => {
      const board = this.row(user, id);
      const revision = this.database.db
        .select()
        .from(boardRevisions)
        .where(and(eq(boardRevisions.boardId, id), eq(boardRevisions.version, version ?? board.version)))
        .get();
      if (!revision) fail(404, 'NOT_FOUND', '画布修订不存在');
      const layout = JSON.parse(revision.layoutJson) as BoardLayout;
      const resolved: BoardView['resolved'] = {};
      for (const node of layout.nodes)
        if (node.type === 'reference' && node.data.ref)
          resolved[node.id] = this.references.resolve(user, board.projectId, node.data.ref);
      const unit = board.unitId
        ? this.database.db
            .select()
            .from(episodes)
            .where(and(eq(episodes.id, board.unitId), eq(episodes.projectId, board.projectId)))
            .get()
        : null;
      return {
        id,
        projectId: board.projectId,
        unitId: board.unitId,
        unitTitle: unit?.title ?? null,
        title: revision.title,
        revision: revision.version,
        headRevision: board.version,
        canEdit: this.production.access(user, board.projectId).canEdit,
        createdAt: revision.createdAt,
        layout,
        resolved,
      };
    });
  }
  private append(
    user: CurrentUser,
    row: typeof boards.$inferSelect,
    title: string,
    layout: BoardLayout,
    key: string,
    requestHash: string,
  ) {
    const version = row.version + 1,
      createdAt = new Date().toISOString();
    this.database.db
      .insert(boardRevisions)
      .values({
        id: randomUUID(),
        boardId: row.id,
        projectId: row.projectId,
        workspaceId: row.workspaceId,
        version,
        title,
        schemaVersion: layout.schemaVersion,
        layoutJson: JSON.stringify(layout),
        createdBy: user.id,
        createdAt,
        requestKey: key,
        requestHash,
      })
      .run();
    this.database.db
      .update(boards)
      .set({ version, title, updatedAt: createdAt })
      .where(and(eq(boards.id, row.id), eq(boards.version, row.version)))
      .run();
    this.audit(user, row.workspaceId, 'board.save', row.id);
    return this.read(user, row.id, version);
  }
  create(user: CurrentUser, projectId: string, title: string, unitId: string | null, key: string) {
    return this.database.db.transaction(
      () => {
        const project = this.authz.project(user, projectId, 'edit'),
          requestHash = hash({ title, unitId });
        const replay = this.database.db
          .select()
          .from(boards)
          .where(
            and(eq(boards.projectId, projectId), eq(boards.createdBy, user.id), eq(boards.creationKey, key)),
          )
          .get();
        if (replay) {
          if (replay.requestHash !== requestHash)
            fail(409, 'IDEMPOTENCY_CONFLICT', '此请求标识已用于其他画布');
          return this.read(user, replay.id, 1);
        }
        if (unitId && this.production.unitRecord(user, unitId).projectId !== projectId)
          fail(404, 'NOT_FOUND', '制作单元不属于当前项目');
        const now = new Date().toISOString();
        const row = this.database.db
          .insert(boards)
          .values({
            id: randomUUID(),
            projectId,
            workspaceId: project.workspaceId,
            unitId,
            title,
            version: 0,
            createdBy: user.id,
            createdAt: now,
            updatedAt: now,
            creationKey: key,
            requestHash,
          })
          .returning()
          .get()!;
        return this.append(user, row, title, emptyBoard, key, requestHash);
      },
      { behavior: 'immediate' },
    );
  }
  save(
    user: CurrentUser,
    id: string,
    input: { title: string; expectedRevision: number; layout: BoardLayout },
    key: string,
  ) {
    return this.database.db.transaction(
      () => {
        const row = this.row(user, id, 'edit'),
          requestHash = hash(input);
        const replay = this.database.db
          .select()
          .from(boardRevisions)
          .where(
            and(
              eq(boardRevisions.boardId, id),
              eq(boardRevisions.createdBy, user.id),
              eq(boardRevisions.requestKey, key),
            ),
          )
          .get();
        if (replay) {
          if (replay.requestHash !== requestHash)
            fail(409, 'IDEMPOTENCY_CONFLICT', '此请求标识已用于其他画布内容');
          return this.read(user, id, replay.version);
        }
        if (row.version !== input.expectedRevision)
          fail(409, 'BOARD_VERSION_CONFLICT', '画布已有新修订，本地输入已保留，请比较后重新载入或更新基线', {
            currentRevision: row.version,
          });
        const current = this.database.db
          .select()
          .from(boardRevisions)
          .where(and(eq(boardRevisions.boardId, id), eq(boardRevisions.version, row.version)))
          .get()!;
        const previous = JSON.parse(current.layoutJson) as BoardLayout;
        for (const node of input.layout.nodes)
          if (node.type === 'reference' && node.data.ref) {
            const old = previous.nodes.find((item) => item.id === node.id && item.type === 'reference');
            const unchanged = old && JSON.stringify(old.data.ref) === JSON.stringify(node.data.ref);
            this.references.resolve(user, row.projectId, node.data.ref, !unchanged);
          }
        return this.append(user, row, input.title, input.layout, key, requestHash);
      },
      { behavior: 'immediate' },
    );
  }
  history(user: CurrentUser, id: string, before?: number) {
    this.row(user, id);
    const rows = this.database.db
      .select({
        revision: boardRevisions.version,
        title: boardRevisions.title,
        createdAt: boardRevisions.createdAt,
        authorName: users.name,
      })
      .from(boardRevisions)
      .innerJoin(users, eq(users.id, boardRevisions.createdBy))
      .where(and(eq(boardRevisions.boardId, id), before ? lt(boardRevisions.version, before) : undefined))
      .orderBy(desc(boardRevisions.version))
      .limit(21)
      .all();
    return { items: rows.slice(0, 20), nextCursor: rows.length > 20 ? rows[19].revision : null };
  }
}
