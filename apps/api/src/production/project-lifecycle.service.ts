import { Injectable } from '@nestjs/common';
import { and, asc, eq, gt, isNotNull } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { CurrentUser, fail } from '../common/http';
import { DatabaseService } from '../db/database.service';
import { projects, projectMembers, auditEvents } from '../db/schema';
import { AuthorizationService } from './authorization.service';

@Injectable()
export class ProjectLifecycleService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
  ) {}
  list(user: CurrentUser, workspaceId: string, cursor?: string) {
    const member = this.authz.workspace(user, workspaceId);
    const condition = and(
      eq(projects.workspaceId, workspaceId),
      isNotNull(projects.deletedAt),
      cursor ? gt(projects.id, cursor) : undefined,
    );
    if (member.role !== 'MEMBER')
      return this.database.db
        .select()
        .from(projects)
        .where(condition)
        .orderBy(asc(projects.id))
        .limit(100)
        .all();
    return this.database.db
      .select({ project: projects })
      .from(projects)
      .innerJoin(
        projectMembers,
        and(
          eq(projectMembers.projectId, projects.id),
          eq(projectMembers.userId, user.id),
          eq(projectMembers.role, 'PROJECT_MANAGER'),
        ),
      )
      .where(condition)
      .orderBy(asc(projects.id))
      .limit(100)
      .all()
      .map((row) => row.project);
  }
  transition(user: CurrentUser, projectId: string, expectedVersion: number, restore: boolean) {
    return this.database.db.transaction(
      (tx) => {
        const project = this.authz.project(user, projectId, 'manage', true);
        if (project.version !== expectedVersion)
          fail(409, 'VERSION_CONFLICT', '项目已被修改，请刷新项目资料后重试');
        if (restore ? !project.deletedAt : !!project.deletedAt)
          fail(409, 'PROJECT_STATE_CONFLICT', restore ? '项目已恢复' : '项目已在回收站中');
        const now = new Date().toISOString();
        const result = tx
          .update(projects)
          .set({
            deletedAt: restore ? null : now,
            deletedBy: restore ? null : user.id,
            version: expectedVersion + 1,
            updatedAt: now,
          })
          .where(and(eq(projects.id, projectId), eq(projects.version, expectedVersion)))
          .returning()
          .get();
        if (!result) fail(409, 'VERSION_CONFLICT', '项目已被修改，请刷新后重试');
        tx.insert(auditEvents)
          .values({
            id: randomUUID(),
            workspaceId: project.workspaceId,
            actorId: user.id,
            action: restore ? 'project.restore' : 'project.trash',
            targetId: projectId,
            createdAt: now,
          })
          .run();
        return result;
      },
      { behavior: 'immediate' },
    );
  }
}
