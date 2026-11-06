import { Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, lt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { CurrentUser, fail } from '../common/http';
import { DatabaseService } from '../db/database.service';
import {
  generationJobs,
  generationWorkflows,
  shots,
  workflowCatalogs,
  workflowCatalogRevisions,
  workflowReleaseEvents,
  users,
} from '../db/schema';
import { AuthorizationService } from '../production/authorization.service';
import { GenerationService } from './generation.service';
import { CreateJobInput, WorkflowInput } from './generation-contract';
import { catalogState, registerWorkflow, workflowHash, workflowReplay } from './workflow-catalog-state';
import { latestRelease } from './workflow-release-state';
@Injectable()
export class WorkflowCatalogService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
    private readonly generation: GenerationService,
  ) {}
  private family(user: CurrentUser, id: string, action: 'configure' | 'read' | 'review' = 'configure') {
    const row = this.database.db.select().from(workflowCatalogs).where(eq(workflowCatalogs.id, id)).get();
    if (!row) fail(404, 'NOT_FOUND', '工作流目录不存在或无权访问');
    this.authz.project(user, row.projectId, action === 'review' ? 'review' : 'read');
    if (action === 'configure') this.generation.manage(user, row.workspaceId);
    return row;
  }
  read(user: CurrentUser, workflowId: string) {
    const row = this.generation.workflow(workflowId);
    this.authz.project(user, row.projectId);
    this.generation.manage(user, row.workspaceId);
    return {
      id: row.id,
      definition: JSON.parse(row.definitionJson) as WorkflowInput,
      catalog: catalogState(this.database, row.id),
    };
  }
  current(user: CurrentUser, id: string) {
    return this.database.db.transaction(() => {
      const family = this.family(user, id);
      if (!family.headWorkflowId) fail(404, 'NOT_FOUND', '工作流尚无有效修订');
      return this.read(user, family.headWorkflowId);
    });
  }
  history(user: CurrentUser, id: string, before?: number) {
    this.family(user, id);
    const rows = this.database.db
      .select({
        id: workflowCatalogRevisions.workflowId,
        revision: workflowCatalogRevisions.revision,
        summary: workflowCatalogRevisions.summary,
        restoredFromId: workflowCatalogRevisions.restoredFromId,
        createdAt: workflowCatalogRevisions.createdAt,
        authorName: users.name,
        name: generationWorkflows.name,
      })
      .from(workflowCatalogRevisions)
      .innerJoin(generationWorkflows, eq(generationWorkflows.id, workflowCatalogRevisions.workflowId))
      .innerJoin(users, eq(users.id, workflowCatalogRevisions.createdBy))
      .where(
        and(
          eq(workflowCatalogRevisions.familyId, id),
          before ? lt(workflowCatalogRevisions.revision, before) : undefined,
        ),
      )
      .orderBy(desc(workflowCatalogRevisions.revision))
      .limit(21)
      .all();
    return { items: rows.slice(0, 20), nextCursor: rows.length > 20 ? rows[19].revision : null };
  }
  async save(
    user: CurrentUser,
    id: string,
    input: { expectedVersion: number; summary: string; definition: WorkflowInput },
    key: string,
    restore?: string,
  ) {
    const family = this.family(user, id),
      hash = workflowHash({ action: restore ? 'restore' : 'revise', familyId: id, ...input, restore });
    const replay = workflowReplay(this.database, user, family.projectId, key, hash);
    if (replay) return replay;
    if (family.version !== input.expectedVersion)
      fail(409, 'WORKFLOW_VERSION_CONFLICT', '工作流已有新修改，本地草稿已保留，请核对最新版本');
    const connection = this.generation.connection(input.definition.connectionId, family.workspaceId);
    try {
      await (await this.generation.provider(connection)).validate(input.definition);
    } catch (reason) {
      this.generation.remoteFailure(reason);
    }
    return this.database.db.transaction(
      () => {
        const current = this.family(user, id),
          replay = workflowReplay(this.database, user, family.projectId, key, hash);
        if (replay) return replay;
        if (
          current.version !== input.expectedVersion ||
          this.generation.connection(connection.id).version !== connection.version
        )
          fail(409, 'WORKFLOW_VERSION_CONFLICT', '工作流或连接已变化，草稿保留，请重新核对');
        const head = current.headWorkflowId && this.generation.workflow(current.headWorkflowId);
        const previous = head && (JSON.parse(head.definitionJson) as WorkflowInput);
        const definition =
          previous && previous.reviewRequired
            ? { ...input.definition, reviewRequired: true }
            : input.definition;
        const row = this.database.db
          .insert(generationWorkflows)
          .values({
            id: randomUUID(),
            projectId: current.projectId,
            workspaceId: current.workspaceId,
            connectionId: input.definition.connectionId,
            name: input.definition.name,
            capability: input.definition.capability,
            definitionJson: JSON.stringify(definition),
            createdBy: user.id,
            createdAt: new Date().toISOString(),
          })
          .returning()
          .get()!;
        const result = registerWorkflow(this.database, row, key, hash, id, input.summary, restore ?? null);
        this.generation.audit(
          user,
          current.workspaceId,
          restore ? 'generation.workflow.restore' : 'generation.workflow.revise',
          row.id,
        );
        return result;
      },
      { behavior: 'immediate' },
    );
  }
  restore(
    user: CurrentUser,
    id: string,
    input: { expectedVersion: number; summary: string; workflowId: string },
    key: string,
  ) {
    this.family(user, id);
    const source = this.read(user, input.workflowId);
    if (source.catalog?.familyId !== id) fail(404, 'NOT_FOUND', '恢复来源不属于当前工作流目录');
    return this.save(
      user,
      id,
      { expectedVersion: input.expectedVersion, summary: input.summary, definition: source.definition },
      key,
      source.id,
    );
  }
  archive(user: CurrentUser, id: string, input: { expectedVersion: number; archived: boolean }) {
    return this.database.db.transaction(
      () => {
        const row = this.family(user, id);
        if (row.version !== input.expectedVersion)
          fail(409, 'WORKFLOW_VERSION_CONFLICT', '工作流已有新修改，请刷新状态后重试');
        if (row.archived === input.archived) return row;
        const result = this.database.db
          .update(workflowCatalogs)
          .set({ archived: input.archived, version: row.version + 1, updatedAt: new Date().toISOString() })
          .where(and(eq(workflowCatalogs.id, id), eq(workflowCatalogs.version, row.version)))
          .returning()
          .get()!;
        this.generation.audit(
          user,
          row.workspaceId,
          input.archived ? 'generation.workflow.archive' : 'generation.workflow.unarchive',
          id,
        );
        return result;
      },
      { behavior: 'immediate' },
    );
  }
  async inspect(user: CurrentUser, workflowId: string) {
    const saved = this.read(user, workflowId),
      row = this.generation.workflow(workflowId),
      connection = this.generation.connection(row.connectionId, row.workspaceId);
    const provider = await this.generation
      .provider(connection)
      .catch((reason) => this.generation.remoteFailure(reason));
    const report = await provider.inspect(saved.definition);
    // Re-authorize after remote I/O and never return the connection endpoint or upstream values.
    this.read(user, workflowId);
    if (this.generation.connection(row.connectionId).version !== connection.version)
      fail(409, 'VERSION_CONFLICT', '连接已变化，请重新检查依赖');
    return { ...report, workflowId, connectionVersion: connection.version };
  }
  testShots(user: CurrentUser, workflowId: string, cursor?: string) {
    const workflow = this.generation.workflow(workflowId);
    this.authz.project(user, workflow.projectId, 'edit');
    this.generation.manage(user, workflow.workspaceId);
    const rows = this.database.db
      .select({ id: shots.id, code: shots.code, description: shots.description })
      .from(shots)
      .where(and(eq(shots.projectId, workflow.projectId), cursor ? gt(shots.id, cursor) : undefined))
      .orderBy(asc(shots.id))
      .limit(31)
      .all();
    return { items: rows.slice(0, 30), nextCursor: rows.length > 30 ? rows[29].id : null };
  }
  test(user: CurrentUser, shotId: string, input: CreateJobInput, key: string) {
    return this.generation.createJob(user, shotId, input, key, 'workflow_test');
  }
  tests(user: CurrentUser, workflowId: string) {
    return this.generation.testJobs(user, workflowId);
  }
  releases(user: CurrentUser, familyId: string, before?: number) {
    this.family(user, familyId, 'read');
    const rows = this.database.db
      .select({
        id: workflowReleaseEvents.id,
        workflowId: workflowReleaseEvents.workflowId,
        revision: workflowCatalogRevisions.revision,
        sequence: workflowReleaseEvents.sequence,
        action: workflowReleaseEvents.action,
        testJobId: workflowReleaseEvents.testJobId,
        reason: workflowReleaseEvents.reason,
        actor: users.name,
        createdAt: workflowReleaseEvents.createdAt,
      })
      .from(workflowReleaseEvents)
      .innerJoin(
        workflowCatalogRevisions,
        eq(workflowCatalogRevisions.workflowId, workflowReleaseEvents.workflowId),
      )
      .innerJoin(users, eq(users.id, workflowReleaseEvents.actorId))
      .where(
        and(
          eq(workflowReleaseEvents.familyId, familyId),
          before ? lt(workflowReleaseEvents.sequence, before) : undefined,
        ),
      )
      .orderBy(desc(workflowReleaseEvents.sequence))
      .limit(21)
      .all();
    return { items: rows.slice(0, 20), nextCursor: rows.length > 20 ? rows[19].sequence : null };
  }
  release(
    user: CurrentUser,
    familyId: string,
    input: { expectedVersion: number; reason: string } & (
      { action: 'publish'; workflowId: string; testJobId: string } | { action: 'revoke' }
    ),
    key: string,
  ) {
    return this.database.db.transaction(
      () => {
        const family = this.family(user, familyId, 'review');
        const requestHash = workflowHash(input);
        const replay = this.database.db
          .select()
          .from(workflowReleaseEvents)
          .where(
            and(
              eq(workflowReleaseEvents.familyId, familyId),
              eq(workflowReleaseEvents.actorId, user.id),
              eq(workflowReleaseEvents.requestKey, key),
            ),
          )
          .get();
        if (replay) {
          if (replay.requestHash !== requestHash)
            fail(409, 'IDEMPOTENCY_CONFLICT', '此请求标识已用于其他发布操作');
          return { id: replay.id, sequence: replay.sequence };
        }
        if (family.version !== input.expectedVersion)
          fail(409, 'WORKFLOW_VERSION_CONFLICT', '工作流状态已变化，请刷新后核对发布版本');
        const latest = latestRelease(this.database, familyId);
        let workflowId: string;
        let testJobId: string;
        if (input.action === 'publish') {
          if (family.archived || family.headWorkflowId !== input.workflowId)
            fail(409, 'WORKFLOW_RELEASE_INVALID', '请选择未归档目录的当前修订');
          if (latest?.action === 'publish' && latest.workflowId === input.workflowId)
            fail(409, 'WORKFLOW_RELEASE_INVALID', '此修订已发布');
          const workflow = this.generation.workflow(input.workflowId);
          const connection = this.generation.connection(workflow.connectionId, family.workspaceId);
          const test = this.database.db
            .select()
            .from(generationJobs)
            .where(
              and(
                eq(generationJobs.id, input.testJobId),
                eq(generationJobs.workflowId, workflow.id),
                eq(generationJobs.purpose, 'workflow_test'),
                eq(generationJobs.state, 'test_completed'),
                eq(generationJobs.connectionVersion, connection.version),
              ),
            )
            .get();
          if (!connection.enabled || !test?.mediaVersionId)
            fail(409, 'WORKFLOW_TEST_REQUIRED', '请选择该修订在当前连接配置上完成的试跑');
          workflowId = workflow.id;
          testJobId = test.id;
        } else {
          if (latest?.action !== 'publish') fail(409, 'WORKFLOW_RELEASE_INVALID', '目录当前没有已发布的修订');
          workflowId = latest.workflowId;
          testJobId = latest.testJobId;
        }
        const id = randomUUID(),
          sequence = (latest?.sequence ?? 0) + 1,
          createdAt = new Date().toISOString();
        this.database.db
          .insert(workflowReleaseEvents)
          .values({
            id,
            familyId,
            workflowId,
            testJobId,
            sequence,
            action: input.action,
            reason: input.reason,
            actorId: user.id,
            requestKey: key,
            requestHash,
            createdAt,
          })
          .run();
        this.database.db
          .update(workflowCatalogs)
          .set({ version: family.version + 1, updatedAt: createdAt })
          .where(eq(workflowCatalogs.id, familyId))
          .run();
        this.generation.audit(user, family.workspaceId, `generation.workflow.${input.action}`, workflowId);
        return { id, sequence };
      },
      { behavior: 'immediate' },
    );
  }
}
