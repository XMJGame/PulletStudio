import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, ne } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { CurrentUser, fail } from '../common/http';
import { DatabaseService } from '../db/database.service';
import { auditEvents, episodes, shots } from '../db/schema';
import { AuthorizationService } from './authorization.service';
import { ProductionService, UnitInput } from './production.service';
import { validateParent } from './unit-hierarchy';

export const unitView = (row: typeof episodes.$inferSelect) => ({
  id: row.id,
  projectId: row.projectId,
  kind: row.unitType,
  parentId: row.parentId,
  code: row.code,
  title: row.title,
  orderIndex: row.orderIndex,
  outline: row.outline,
  targetDurationSeconds: row.targetDurationSeconds,
  version: row.version,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});
@Injectable()
export class UnitsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
    private readonly production: ProductionService,
  ) {}
  list(user: CurrentUser, projectId: string, limit = 100, cursor?: string) {
    const project = this.authz.project(user, projectId);
    const rows = this.database.db
      .select()
      .from(episodes)
      .where(
        and(
          eq(episodes.projectId, projectId),
          eq(episodes.workspaceId, project.workspaceId),
          ne(episodes.unitType, 'project_root'),
          cursor ? gt(episodes.id, cursor) : undefined,
        ),
      )
      .orderBy(asc(episodes.id))
      .limit(limit + 1)
      .all();
    return {
      items: rows.slice(0, limit).map(unitView),
      nextCursor: rows.length > limit ? rows[limit - 1].id : null,
    };
  }
  read(user: CurrentUser, id: string) {
    return unitView(this.production.unitRecord(user, id));
  }
  create(user: CurrentUser, projectId: string, input: UnitInput) {
    return unitView(this.production.createUnit(user, projectId, input));
  }
  update(
    user: CurrentUser,
    id: string,
    input: Partial<Omit<UnitInput, 'kind'>> & { expectedVersion: number },
  ) {
    return this.database.db.transaction(
      (tx) => {
        const current = this.production.unitRecord(user, id, 'edit');
        if (current.version !== input.expectedVersion)
          fail(409, 'VERSION_CONFLICT', '制作单元已被修改，本地输入已保留');
        validateParent(
          this.database,
          current.projectId,
          current.workspaceId,
          input.parentId === undefined ? current.parentId : input.parentId,
          id,
        );
        const { expectedVersion, ...changes } = input;
        const now = new Date().toISOString();
        const updated = tx
          .update(episodes)
          .set({ ...changes, version: expectedVersion + 1, updatedAt: now })
          .where(and(eq(episodes.id, id), eq(episodes.version, expectedVersion)))
          .returning()
          .get()!;
        tx.insert(auditEvents)
          .values({
            id: randomUUID(),
            workspaceId: current.workspaceId,
            actorId: user.id,
            action: 'unit.update',
            targetId: id,
            createdAt: now,
          })
          .run();
        return unitView(updated);
      },
      { behavior: 'immediate' },
    );
  }
  shots(user: CurrentUser, projectId: string, unitId?: string | null, limit = 100, cursor?: string) {
    const project = this.authz.project(user, projectId);
    let scope;
    if (unitId) {
      scope = this.production.unitRecord(user, unitId);
      if (scope.projectId !== projectId) fail(404, 'NOT_FOUND', '制作单元不属于当前项目');
    } else
      scope = this.database.db
        .select()
        .from(episodes)
        .where(and(eq(episodes.projectId, projectId), eq(episodes.unitType, 'project_root')))
        .get();
    if (!scope) return { items: [], nextCursor: null };
    const rows = this.database.db
      .select()
      .from(shots)
      .where(
        and(
          eq(shots.episodeId, scope.id),
          eq(shots.projectId, projectId),
          eq(shots.workspaceId, project.workspaceId),
          cursor ? gt(shots.id, cursor) : undefined,
        ),
      )
      .orderBy(asc(shots.id))
      .limit(limit + 1)
      .all();
    return {
      items: rows
        .slice(0, limit)
        .map((row) => ({ ...row, episodeId: unitId || null, unitId: unitId || null })),
      nextCursor: rows.length > limit ? rows[limit - 1].id : null,
    };
  }
}
