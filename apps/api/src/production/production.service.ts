import { Injectable } from '@nestjs/common';
import { and, asc, count, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../db/database.service';
import {
  auditEvents,
  episodes,
  invitations,
  projectMembers,
  projects,
  shots,
  users,
  workspaceMembers,
  workspaces,
  visualStylePresets,
  workFormats,
  narrativeModes,
  unitTypes,
  productionTechniques,
  scripts,
} from '../db/schema';
import { CurrentUser, fail } from '../common/http';
import { digest, secret } from '../auth/password';
import { AuthorizationService } from './authorization.service';
import { validateParent } from './unit-hierarchy';
import { appendCardEdition, cardRecord, readShotCard, shotCardHistory } from './shot-cards';
import { formalCardSchema } from './formal-card';

type ProjectInput = {
  title: string;
  aspectRatio?: string;
  language?: string;
  description?: string;
  stylePreset?: (typeof visualStylePresets)[number];
  styleDescription?: string;
  workFormat?: (typeof workFormats)[number];
  narrativeMode?: (typeof narrativeModes)[number];
  targetDurationSeconds?: number | null;
  directorNotes?: string;
};
type EpisodeInput = { title: string; orderIndex?: number };
type ShotInput = {
  sequence?: number;
  description?: string;
  camera?: string;
  dialogue?: string;
  durationHint?: number;
  technique?: (typeof productionTechniques)[number];
};
export type UnitInput = EpisodeInput & {
  kind: (typeof unitTypes)[number];
  parentId?: string | null;
  outline?: string;
  targetDurationSeconds?: number | null;
};

@Injectable()
export class ProductionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
  ) {}
  private audit(actorId: string, workspaceId: string, action: string, targetId: string) {
    this.database.db
      .insert(auditEvents)
      .values({
        id: randomUUID(),
        actorId,
        workspaceId,
        action,
        targetId,
        createdAt: new Date().toISOString(),
      })
      .run();
  }
  workspaces(user: CurrentUser) {
    return this.database.db
      .select({
        id: workspaces.id,
        name: workspaces.name,
        slug: workspaces.slug,
        role: workspaceMembers.role,
      })
      .from(workspaces)
      .innerJoin(
        workspaceMembers,
        and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, user.id)),
      )
      .orderBy(asc(workspaces.createdAt))
      .all();
  }
  createWorkspace(user: CurrentUser, input: { name: string }) {
    if (!user.instanceAdmin) fail(403, 'FORBIDDEN', '仅实例管理员可创建工作区');
    const id = randomUUID();
    const workspace = {
      id,
      name: input.name,
      slug: `ws-${id}`,
      createdBy: user.id,
      createdAt: new Date().toISOString(),
    };
    this.database.db.transaction((tx) => {
      tx.insert(workspaces).values(workspace).run();
      tx.insert(workspaceMembers)
        .values({ workspaceId: workspace.id, userId: user.id, role: 'WORKSPACE_OWNER' })
        .run();
      this.audit(user.id, workspace.id, 'workspace.create', workspace.id);
    });
    return workspace;
  }
  members(user: CurrentUser, workspaceId: string) {
    this.authz.workspace(user, workspaceId, true);
    return this.database.db
      .select({ id: users.id, name: users.name, email: users.email, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspaceId))
      .all();
  }
  invite(
    user: CurrentUser,
    workspaceId: string,
    input: { email: string; role: 'WORKSPACE_ADMIN' | 'MEMBER' },
  ) {
    const actor = this.authz.workspace(user, workspaceId, true);
    if (input.role === 'WORKSPACE_ADMIN' && actor.role !== 'WORKSPACE_OWNER')
      fail(403, 'FORBIDDEN', '只有工作区所有者可邀请管理员');
    const token = secret();
    const expiresAt = Date.now() + 48 * 3600000;
    const id = randomUUID();
    this.database.db.transaction((tx) => {
      const existing = tx
        .select()
        .from(users)
        .innerJoin(workspaceMembers, eq(workspaceMembers.userId, users.id))
        .where(and(eq(users.email, input.email), eq(workspaceMembers.workspaceId, workspaceId)))
        .get();
      if (existing) fail(409, 'ALREADY_MEMBER', '该用户已经是工作区成员');
      // Reissuing revokes the old invitation, including its role grant.
      tx.delete(invitations)
        .where(
          and(
            eq(invitations.workspaceId, workspaceId),
            eq(invitations.email, input.email),
            isNull(invitations.acceptedAt),
          ),
        )
        .run();
      tx.insert(invitations)
        .values({ id, workspaceId, ...input, tokenHash: digest(token), expiresAt, createdBy: user.id })
        .run();
      this.audit(user.id, workspaceId, 'invitation.create', id);
    });
    return { id, token, expiresAt };
  }
  listProjects(user: CurrentUser, workspaceId: string, cursor?: string) {
    const member = this.authz.workspace(user, workspaceId);
    const condition = and(
      eq(projects.workspaceId, workspaceId),
      isNull(projects.deletedAt),
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
        and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, user.id)),
      )
      .where(condition)
      .orderBy(asc(projects.id))
      .limit(100)
      .all()
      .map((x) => x.project);
  }
  createProject(user: CurrentUser, input: ProjectInput & { workspaceId: string }) {
    this.authz.workspace(user, input.workspaceId, true);
    this.validateStyle(input.stylePreset ?? 'unspecified', input.styleDescription ?? '');
    const now = new Date().toISOString();
    return this.database.db.transaction(
      (tx) => {
        let code: string | undefined;
        // Allocate inside the write transaction so concurrent requests cannot reserve the same number.
        while (!code) {
          const counter = tx
            .update(workspaces)
            .set({ nextProjectNumber: sql`${workspaces.nextProjectNumber} + 1` })
            .where(eq(workspaces.id, input.workspaceId))
            .returning({ value: workspaces.nextProjectNumber })
            .get()!;
          const candidate = `P${String(counter.value - 1).padStart(4, '0')}`;
          if (
            !tx
              .select({ id: projects.id })
              .from(projects)
              .where(and(eq(projects.workspaceId, input.workspaceId), eq(projects.code, candidate)))
              .get()
          )
            code = candidate;
        }
        const result = tx
          .insert(projects)
          .values({ id: randomUUID(), ...input, code, createdAt: now, updatedAt: now })
          .returning()
          .get()!;
        tx.insert(projectMembers)
          .values({ projectId: result.id, userId: user.id, role: 'PROJECT_MANAGER' })
          .run();
        this.audit(user.id, result.workspaceId, 'project.create', result.id);
        return result;
      },
      { behavior: 'immediate' },
    );
  }
  project(user: CurrentUser, id: string) {
    return this.authz.project(user, id);
  }
  access(user: CurrentUser, projectId: string) {
    const project = this.authz.project(user, projectId);
    const membership = this.authz.workspace(user, project.workspaceId);
    const role = this.database.db
      .select()
      .from(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, user.id)))
      .get()?.role;
    return {
      canEdit: membership.role !== 'MEMBER' || role === 'PROJECT_MANAGER' || role === 'EDITOR',
      canManage: membership.role !== 'MEMBER' || role === 'PROJECT_MANAGER',
      canReview: membership.role !== 'MEMBER' || role === 'PROJECT_MANAGER' || role === 'REVIEWER',
    };
  }
  settingsImpact(user: CurrentUser, id: string, input: Partial<ProjectInput> & { expectedVersion: number }) {
    const project = this.authz.project(user, id, 'manage');
    if (project.version !== input.expectedVersion)
      fail(409, 'VERSION_CONFLICT', '项目已被修改，请刷新后重试');
    const fields = [
      'workFormat',
      'narrativeMode',
      'targetDurationSeconds',
      'directorNotes',
      'aspectRatio',
      'stylePreset',
      'styleDescription',
    ] as const;
    const changedFields = fields.filter((key) => input[key] !== undefined && input[key] !== project[key]);
    const units = this.database.db
      .select({ value: count() })
      .from(episodes)
      .where(and(eq(episodes.projectId, id), ne(episodes.unitType, 'project_root')))
      .get()!.value;
    const shotCount = this.database.db
      .select({ value: count() })
      .from(shots)
      .where(eq(shots.projectId, id))
      .get()!.value;
    const scriptCount = this.database.db
      .select({ value: count() })
      .from(scripts)
      .where(eq(scripts.projectId, id))
      .get()!.value;
    return {
      changedFields,
      units,
      shots: shotCount,
      scripts: scriptCount,
      requiresConfirmation: changedFields.length > 0 && units + shotCount + scriptCount > 0,
      warnings: changedFields.length
        ? [
            '仅更新项目设定，已有剧本、结构、镜头及各自时长保持原样。',
            '后续分析与提示词须采用新的设定重新生成候选并确认，不会自动覆盖已保存内容。',
          ]
        : [],
    };
  }
  updateProject(
    user: CurrentUser,
    id: string,
    input: Partial<ProjectInput> & { expectedVersion: number; acknowledgeImpact?: boolean },
  ) {
    const { expectedVersion, acknowledgeImpact, ...changes } = input;
    return this.database.db.transaction(
      (tx) => {
        const project = this.authz.project(user, id, 'manage');
        const latest = project;
        if (latest.version !== expectedVersion)
          fail(409, 'VERSION_CONFLICT', '项目已被修改，请刷新后重试', { latest });
        this.validateStyle(
          changes.stylePreset ?? latest.stylePreset,
          changes.styleDescription ?? latest.styleDescription,
        );
        const impact = this.settingsImpact(user, id, input);
        if (impact.requiresConfirmation && !acknowledgeImpact)
          fail(409, 'IMPACT_REVIEW_REQUIRED', '项目已有制作内容，请先查看影响范围并确认', impact);
        const result = tx
          .update(projects)
          .set({ ...changes, version: expectedVersion + 1, updatedAt: new Date().toISOString() })
          .where(
            and(
              eq(projects.id, id),
              eq(projects.workspaceId, project.workspaceId),
              eq(projects.version, expectedVersion),
            ),
          )
          .returning()
          .get();
        if (!result)
          fail(409, 'VERSION_CONFLICT', '项目已被修改，请刷新后重试', {
            latest: tx.select().from(projects).where(eq(projects.id, id)).get(),
          });
        this.audit(user.id, project.workspaceId, 'project.update', id);
        return result;
      },
      { behavior: 'immediate' },
    );
  }
  private validateStyle(preset: (typeof visualStylePresets)[number], description: string) {
    if (preset === 'custom' && !description.trim())
      fail(400, 'STYLE_DESCRIPTION_REQUIRED', '请填写自定义视觉风格描述');
  }
  listEpisodes(user: CurrentUser, projectId: string) {
    const project = this.authz.project(user, projectId);
    return this.database.db
      .select()
      .from(episodes)
      .where(
        and(
          eq(episodes.projectId, projectId),
          eq(episodes.workspaceId, project.workspaceId),
          eq(episodes.unitType, 'episode'),
        ),
      )
      .orderBy(asc(episodes.orderIndex), asc(episodes.id))
      .all();
  }
  createEpisode(user: CurrentUser, projectId: string, input: EpisodeInput) {
    return this.createUnit(user, projectId, { ...input, kind: 'episode' });
  }
  createUnit(user: CurrentUser, projectId: string, input: UnitInput) {
    const now = new Date().toISOString();
    return this.database.db.transaction(
      (tx) => {
        const project = this.authz.project(user, projectId, 'edit');
        validateParent(this.database, projectId, project.workspaceId, input.parentId);
        const { kind, ...fields } = input;
        let code: string | undefined;
        while (!code) {
          const counter = tx
            .update(projects)
            .set(
              kind === 'episode'
                ? { nextEpisodeNumber: sql`${projects.nextEpisodeNumber} + 1` }
                : { nextUnitNumber: sql`${projects.nextUnitNumber} + 1` },
            )
            .where(eq(projects.id, projectId))
            .returning({ value: kind === 'episode' ? projects.nextEpisodeNumber : projects.nextUnitNumber })
            .get()!;
          const candidate =
            kind === 'episode'
              ? `EP${String(counter.value - 1).padStart(2, '0')}`
              : `U${String(counter.value - 1).padStart(4, '0')}`;
          if (
            !tx
              .select({ id: episodes.id })
              .from(episodes)
              .where(and(eq(episodes.projectId, projectId), eq(episodes.code, candidate)))
              .get()
          )
            code = candidate;
        }
        const result = tx
          .insert(episodes)
          .values({
            id: randomUUID(),
            projectId,
            workspaceId: project.workspaceId,
            ...fields,
            unitType: kind,
            code,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get()!;
        this.audit(
          user.id,
          project.workspaceId,
          kind === 'episode' ? 'episode.create' : 'unit.create',
          result.id,
        );
        return result;
      },
      { behavior: 'immediate' },
    );
  }
  episode(user: CurrentUser, id: string, action: 'read' | 'edit' = 'read') {
    const episode = this.unitRecord(user, id, action);
    if (episode.unitType !== 'episode') fail(404, 'NOT_FOUND', '分集不存在或无权访问');
    return episode;
  }
  unitRecord(user: CurrentUser, id: string, action: 'read' | 'edit' | 'review' = 'read', allowRoot = false) {
    const episode = this.database.db.select().from(episodes).where(eq(episodes.id, id)).get();
    if (!episode) fail(404, 'NOT_FOUND', '分集不存在或无权访问');
    this.authz.project(user, episode.projectId, action);
    if (episode.unitType === 'project_root' && !allowRoot) fail(404, 'NOT_FOUND', '制作单元不存在或无权访问');
    return episode;
  }
  updateEpisode(user: CurrentUser, id: string, input: Partial<EpisodeInput> & { expectedVersion: number }) {
    const { expectedVersion, ...changes } = input;
    return this.database.db.transaction((tx) => {
      const episode = this.episode(user, id, 'edit');
      const result = tx
        .update(episodes)
        .set({ ...changes, version: expectedVersion + 1, updatedAt: new Date().toISOString() })
        .where(
          and(
            eq(episodes.id, id),
            eq(episodes.workspaceId, episode.workspaceId),
            eq(episodes.version, expectedVersion),
          ),
        )
        .returning()
        .get();
      if (!result)
        fail(409, 'VERSION_CONFLICT', '分集已被修改，请刷新后重试', {
          latest: tx.select().from(episodes).where(eq(episodes.id, id)).get(),
        });
      this.audit(user.id, episode.workspaceId, 'episode.update', id);
      return result;
    });
  }
  listShots(user: CurrentUser, episodeId: string) {
    const episode = this.episode(user, episodeId);
    return this.database.db
      .select()
      .from(shots)
      .where(and(eq(shots.episodeId, episodeId), eq(shots.workspaceId, episode.workspaceId)))
      .orderBy(asc(shots.sequence), asc(shots.id))
      .all();
  }
  createShot(user: CurrentUser, episodeId: string, input: ShotInput) {
    this.episode(user, episodeId, 'edit');
    return this.createUnitShot(user, episodeId, input);
  }
  createProjectShot(user: CurrentUser, projectId: string, input: ShotInput & { unitId?: string | null }) {
    return this.createScopedShot(user, projectId, input, 'edit');
  }
  createReviewedShot(user: CurrentUser, projectId: string, input: ShotInput & { unitId?: string | null }) {
    return this.createScopedShot(user, projectId, input, 'review');
  }
  private createScopedShot(
    user: CurrentUser,
    projectId: string,
    input: ShotInput & { unitId?: string | null },
    action: 'edit' | 'review',
  ) {
    return this.database.db.transaction(
      (tx) => {
        const project = this.authz.project(user, projectId, action);
        const { unitId, ...fields } = input;
        let scope;
        if (unitId) {
          scope = this.unitRecord(user, unitId, action);
          if (scope.projectId !== projectId) fail(404, 'NOT_FOUND', '制作单元不属于当前项目');
        } else {
          scope = tx
            .select()
            .from(episodes)
            .where(and(eq(episodes.projectId, projectId), eq(episodes.unitType, 'project_root')))
            .get();
          if (!scope) {
            const now = new Date().toISOString();
            const id = randomUUID();
            scope = tx
              .insert(episodes)
              .values({
                id,
                workspaceId: project.workspaceId,
                projectId,
                unitType: 'project_root',
                code: `ROOT-${id}`,
                title: '',
                createdAt: now,
                updatedAt: now,
              })
              .returning()
              .get()!;
          }
        }
        if (fields.sequence === undefined) {
          const last = tx
            .select({ value: sql<number>`coalesce(max(${shots.sequence}), 0)` })
            .from(shots)
            .where(eq(shots.episodeId, scope.id))
            .get()!;
          fields.sequence = last.value + 1;
          if (fields.sequence > 100000) fail(400, 'ORDER_LIMIT', '镜头排序已达上限，请调整排序后再新增');
        }
        const result = this.createUnitShot(user, scope.id, fields, action);
        return { ...result, episodeId: unitId || null, unitId: unitId || null };
      },
      { behavior: 'immediate' },
    );
  }
  private createUnitShot(
    user: CurrentUser,
    episodeId: string,
    input: ShotInput,
    action: 'edit' | 'review' = 'edit',
  ) {
    const now = new Date().toISOString();
    return this.database.db.transaction(
      (tx) => {
        const episode = this.unitRecord(user, episodeId, action, true);
        let code: string | undefined;
        while (!code) {
          const counter = tx
            .update(episodes)
            .set({ nextShotNumber: sql`${episodes.nextShotNumber} + 1` })
            .where(eq(episodes.id, episodeId))
            .returning({ value: episodes.nextShotNumber })
            .get()!;
          const candidate = `SH${String(counter.value - 1).padStart(3, '0')}`;
          if (
            !tx
              .select({ id: shots.id })
              .from(shots)
              .where(and(eq(shots.episodeId, episodeId), eq(shots.code, candidate)))
              .get()
          )
            code = candidate;
        }
        const result = tx
          .insert(shots)
          .values({
            id: randomUUID(),
            workspaceId: episode.workspaceId,
            projectId: episode.projectId,
            episodeId,
            ...input,
            code,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get()!;
        this.audit(user.id, episode.workspaceId, 'shot.create', result.id);
        return result;
      },
      { behavior: 'immediate' },
    );
  }
  shot(user: CurrentUser, id: string, action: 'read' | 'edit' = 'read') {
    const shot = this.database.db.select().from(shots).where(eq(shots.id, id)).get();
    if (!shot) fail(404, 'NOT_FOUND', '镜头不存在或无权访问');
    this.authz.project(user, shot.projectId, action);
    const scope = this.unitRecord(user, shot.episodeId, action, true);
    return {
      ...shot,
      episodeId: scope.unitType === 'project_root' ? null : shot.episodeId,
      unitId: scope.unitType === 'project_root' ? null : shot.episodeId,
    };
  }
  updateShot(user: CurrentUser, id: string, input: Partial<ShotInput> & { expectedVersion: number }) {
    const { expectedVersion, ...changes } = input;
    return this.database.db.transaction((tx) => {
      const shot = this.shot(user, id, 'edit');
      const previousCard = cardRecord(this.database, id, shot.version);
      const result = tx
        .update(shots)
        .set({ ...changes, version: expectedVersion + 1, updatedAt: new Date().toISOString() })
        .where(
          and(eq(shots.id, id), eq(shots.workspaceId, shot.workspaceId), eq(shots.version, expectedVersion)),
        )
        .returning()
        .get();
      if (!result)
        fail(409, 'VERSION_CONFLICT', '镜头已被修改，请刷新后重试', {
          latest: tx.select().from(shots).where(eq(shots.id, id)).get(),
        });
      this.audit(user.id, shot.workspaceId, 'shot.update', id);
      if (previousCard) {
        const previous = JSON.parse(previousCard.bodyJson);
        const body = formalCardSchema.parse({
          ...previous,
          description: changes.description ?? previous.description,
          cameraMovement: changes.camera ?? previous.cameraMovement,
          dialogue: changes.dialogue ?? previous.dialogue,
          durationSeconds: changes.durationHint ?? previous.durationSeconds,
          technique: changes.technique ?? previous.technique,
        });
        appendCardEdition(
          this.database,
          user,
          result!,
          body,
          previousCard.sourceProposalRevisionId,
          '编辑正式镜头',
        );
      }
      return this.shot(user, id);
    });
  }
  card(user: CurrentUser, id: string, version?: number) {
    const shot = this.shot(user, id);
    return readShotCard(this.database, id, version ?? shot.version, version !== undefined);
  }
  cardHistory(user: CurrentUser, id: string, before?: number) {
    this.shot(user, id);
    return shotCardHistory(this.database, id, before);
  }
}
