import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { CurrentUser, fail } from '../common/http';
import { DatabaseService } from '../db/database.service';
import { auditEvents, projects, projectMembers, workspaceMembers, users, invitations } from '../db/schema';
import { AuthorizationService } from './authorization.service';

type ProjectRole = typeof projectMembers.$inferSelect.role;
type WorkspaceRole = typeof workspaceMembers.$inferSelect.role;
@Injectable()
export class MembersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
  ) {}
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
  candidates(user: CurrentUser, projectId: string) {
    const project = this.authz.project(user, projectId, 'manage');
    return this.database.db
      .select({ id: users.id, name: users.name, email: users.email, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, project.workspaceId))
      .all();
  }
  listProject(user: CurrentUser, projectId: string) {
    const project = this.authz.project(user, projectId, 'manage');
    return this.database.db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: projectMembers.role,
        workspaceRole: workspaceMembers.role,
      })
      .from(projectMembers)
      .innerJoin(users, eq(users.id, projectMembers.userId))
      .innerJoin(
        workspaceMembers,
        and(eq(workspaceMembers.workspaceId, project.workspaceId), eq(workspaceMembers.userId, users.id)),
      )
      .where(eq(projectMembers.projectId, projectId))
      .all();
  }
  assign(
    user: CurrentUser,
    projectId: string,
    input: { userId: string; role: ProjectRole; expectedRole?: ProjectRole },
  ) {
    return this.database.db.transaction(
      (tx) => {
        const project = this.authz.project(user, projectId, 'manage');
        const target = this.authz.workspace({ ...user, id: input.userId }, project.workspaceId);
        if (target.role !== 'MEMBER')
          fail(400, 'IMPLICIT_ADMIN_ACCESS', '工作区管理员已拥有项目管理权限，无需分配项目角色');
        const condition = and(
          eq(projectMembers.projectId, projectId),
          eq(projectMembers.userId, input.userId),
        );
        const current = tx.select().from(projectMembers).where(condition).get();
        if (
          input.expectedRole ? current?.role !== input.expectedRole : !!current && current.role !== input.role
        )
          fail(409, 'MEMBER_CHANGED', '成员角色已变化，请刷新成员列表');
        if (current) tx.update(projectMembers).set({ role: input.role }).where(condition).run();
        else tx.insert(projectMembers).values({ projectId, userId: input.userId, role: input.role }).run();
        this.audit(user, project.workspaceId, 'project.member.assign', input.userId);
        return { projectId, userId: input.userId, role: input.role };
      },
      { behavior: 'immediate' },
    );
  }
  removeProject(user: CurrentUser, projectId: string, userId: string, expectedRole: ProjectRole) {
    return this.database.db.transaction(
      (tx) => {
        const project = this.authz.project(user, projectId, 'manage');
        const member = this.authz.workspace({ ...user, id: userId }, project.workspaceId);
        if (member.role !== 'MEMBER')
          fail(400, 'IMPLICIT_ADMIN_ACCESS', '工作区管理员的访问权由工作区身份决定');
        const deleted = tx
          .delete(projectMembers)
          .where(
            and(
              eq(projectMembers.projectId, projectId),
              eq(projectMembers.userId, userId),
              eq(projectMembers.role, expectedRole),
            ),
          )
          .returning()
          .get();
        if (!deleted) fail(409, 'MEMBER_CHANGED', '成员已移除或角色已变化，请刷新成员列表');
        this.audit(user, project.workspaceId, 'project.member.remove', userId);
        return { ok: true };
      },
      { behavior: 'immediate' },
    );
  }
  private workspaceTarget(user: CurrentUser, workspaceId: string, userId: string) {
    const actor = this.authz.workspace(user, workspaceId, true);
    const target = this.authz.workspace({ ...user, id: userId }, workspaceId);
    if (target.role === 'WORKSPACE_OWNER') fail(400, 'OWNER_PROTECTED', '工作区所有者不能直接降级或移除');
    if (target.role === 'WORKSPACE_ADMIN' && actor.role !== 'WORKSPACE_OWNER')
      fail(403, 'FORBIDDEN', '只有所有者可管理工作区管理员');
    return { actor, target };
  }
  updateWorkspace(
    user: CurrentUser,
    workspaceId: string,
    userId: string,
    expectedRole: WorkspaceRole,
    role: 'WORKSPACE_ADMIN' | 'MEMBER',
  ) {
    return this.database.db.transaction(
      (tx) => {
        const { actor, target } = this.workspaceTarget(user, workspaceId, userId);
        if (role === 'WORKSPACE_ADMIN' && actor.role !== 'WORKSPACE_OWNER')
          fail(403, 'FORBIDDEN', '只有所有者可授予管理员权限');
        if (target.role !== expectedRole) fail(409, 'MEMBER_CHANGED', '工作区角色已变化，请刷新成员列表');
        tx.update(workspaceMembers)
          .set({ role })
          .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
          .run();
        if (role === 'MEMBER')
          tx.delete(invitations)
            .where(
              and(
                eq(invitations.workspaceId, workspaceId),
                eq(invitations.createdBy, userId),
                isNull(invitations.acceptedAt),
              ),
            )
            .run();
        this.audit(user, workspaceId, 'workspace.member.role', userId);
        return { userId, workspaceId, role };
      },
      { behavior: 'immediate' },
    );
  }
  removeWorkspace(user: CurrentUser, workspaceId: string, userId: string, expectedRole: WorkspaceRole) {
    return this.database.db.transaction(
      (tx) => {
        const { target } = this.workspaceTarget(user, workspaceId, userId);
        if (target.role !== expectedRole) fail(409, 'MEMBER_CHANGED', '工作区角色已变化，请刷新成员列表');
        const projectIds = tx
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.workspaceId, workspaceId));
        tx.delete(projectMembers)
          .where(and(eq(projectMembers.userId, userId), inArray(projectMembers.projectId, projectIds)))
          .run();
        const account = tx.select().from(users).where(eq(users.id, userId)).get()!;
        tx.delete(invitations)
          .where(
            and(
              eq(invitations.workspaceId, workspaceId),
              or(eq(invitations.email, account.email), eq(invitations.createdBy, userId)),
              isNull(invitations.acceptedAt),
            ),
          )
          .run();
        tx.delete(workspaceMembers)
          .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
          .run();
        this.audit(user, workspaceId, 'workspace.member.remove', userId);
        return { ok: true };
      },
      { behavior: 'immediate' },
    );
  }
}
