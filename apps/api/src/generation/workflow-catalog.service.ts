import { Injectable } from '@nestjs/common';
import { and, desc, eq, lt } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { CurrentUser, fail } from '../common/http';
import { DatabaseService } from '../db/database.service';
import { generationWorkflows, workflowCatalogs, workflowCatalogRevisions, users } from '../db/schema';
import { AuthorizationService } from '../production/authorization.service';
import { GenerationService } from './generation.service';
import { WorkflowInput } from './generation-contract';
import { catalogState, registerWorkflow, workflowHash, workflowReplay } from './workflow-catalog-state';
@Injectable()
export class WorkflowCatalogService {
  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
    private readonly generation: GenerationService,
  ) {}
  private family(user: CurrentUser, id: string) {
    const row = this.database.db.select().from(workflowCatalogs).where(eq(workflowCatalogs.id, id)).get();
    if (!row) fail(404, 'NOT_FOUND', '工作流目录不存在或无权访问');
    this.authz.project(user, row.projectId);
    this.generation.manage(user, row.workspaceId);
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
        const row = this.database.db
          .insert(generationWorkflows)
          .values({
            id: randomUUID(),
            projectId: current.projectId,
            workspaceId: current.workspaceId,
            connectionId: input.definition.connectionId,
            name: input.definition.name,
            capability: input.definition.capability,
            definitionJson: JSON.stringify(input.definition),
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
}
