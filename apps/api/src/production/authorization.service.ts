import { Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../db/database.service';
import { projectMembers, projects, workspaceMembers } from '../db/schema';
import { CurrentUser, fail } from '../common/http';

@Injectable()
export class AuthorizationService {
  constructor(private readonly database: DatabaseService) {}
  workspace(user: CurrentUser, workspaceId: string, manage = false) {
    const member = this.database.db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, user.id)))
      .get();
    if (!member) fail(404, 'NOT_FOUND', '工作区不存在或无权访问');
    if (manage && member.role === 'MEMBER') fail(403, 'FORBIDDEN', '需要工作区管理权限');
    return member;
  }
  project(
    user: CurrentUser,
    projectId: string,
    action: 'read' | 'edit' | 'manage' | 'review' = 'read',
    includeDeleted = false,
  ) {
    const project = this.database.db.select().from(projects).where(eq(projects.id, projectId)).get();
    if (!project) fail(404, 'NOT_FOUND', '项目不存在或无权访问');
    if (project.deletedAt && !includeDeleted) fail(404, 'NOT_FOUND', '项目不存在或已移入回收站');
    const workspaceRole = this.workspace(user, project.workspaceId);
    if (workspaceRole.role !== 'MEMBER') return project;
    const member = this.database.db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, user.id)))
      .get();
    if (!member) fail(404, 'NOT_FOUND', '项目不存在或无权访问');
    const allowed =
      action === 'read' ||
      member.role === 'PROJECT_MANAGER' ||
      (action === 'edit' && member.role === 'EDITOR') ||
      (action === 'review' && member.role === 'REVIEWER');
    if (!allowed) fail(403, 'FORBIDDEN', '没有执行此操作的项目权限');
    return project;
  }
}
