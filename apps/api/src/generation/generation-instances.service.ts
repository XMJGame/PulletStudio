import { Injectable } from '@nestjs/common';
import { and, asc, eq, ne } from 'drizzle-orm';
import { CurrentUser, fail } from '../common/http';
import { DatabaseService } from '../db/database.service';
import { generationConnections, generationInstanceChecks } from '../db/schema';
import { AuthorizationService } from '../production/authorization.service';
import { GenerationError } from './comfy-provider';
import { WorkflowInput } from './generation-contract';
import { GenerationService } from './generation.service';
import { DependencyReport } from './workflow-inspection';

const poolLimit = 12;
const checkLifetimeMs = 15 * 60 * 1000;
type Connection = typeof generationConnections.$inferSelect;
type Check = typeof generationInstanceChecks.$inferSelect;
export type PoolSettings = Pick<Connection, 'poolEnabled' | 'maxRunning' | 'maxPending'> & {
  expectedPoolVersion: number;
};

@Injectable()
export class GenerationInstancesService {
  private readonly checking = new Set<string>();

  constructor(
    private readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
    private readonly generation: GenerationService,
  ) {}

  private workflow(user: CurrentUser, id: string) {
    const workflow = this.generation.workflow(id);
    this.authz.project(user, workflow.projectId);
    this.generation.manage(user, workflow.workspaceId);
    return workflow;
  }

  private pool(workspaceId: string) {
    return this.database.db
      .select()
      .from(generationConnections)
      .where(
        and(eq(generationConnections.workspaceId, workspaceId), eq(generationConnections.poolEnabled, true)),
      )
      .orderBy(asc(generationConnections.name), asc(generationConnections.id))
      .limit(poolLimit)
      .all();
  }

  private view(connection: Connection, check?: Check) {
    const fresh = Boolean(
      check &&
      connection.enabled &&
      connection.poolEnabled &&
      check.connectionVersion === connection.version &&
      check.poolVersion === connection.poolVersion &&
      Date.now() - check.checkedAt < checkLifetimeMs,
    );
    let capacity: 'available' | 'busy' | 'unverified' = 'unverified';
    if (fresh && check?.reachable && check.running !== null && check.pending !== null) {
      capacity =
        check.running < connection.maxRunning && check.pending < connection.maxPending ? 'available' : 'busy';
    }
    return {
      id: connection.id,
      name: connection.name,
      enabled: connection.enabled,
      maxRunning: connection.maxRunning,
      maxPending: connection.maxPending,
      fresh,
      capacity,
      check: check
        ? {
            checkedAt: new Date(check.checkedAt).toISOString(),
            connectionVersion: check.connectionVersion,
            reachable: check.reachable,
            running: check.running,
            pending: check.pending,
            status: check.status,
            binding: check.binding,
            report: check.reportJson ? (JSON.parse(check.reportJson) as DependencyReport) : null,
          }
        : null,
    };
  }

  configure(user: CurrentUser, connectionId: string, input: PoolSettings) {
    return this.database.db.transaction(
      () => {
        const connection = this.generation.connection(connectionId);
        this.generation.manage(user, connection.workspaceId);
        if (connection.poolVersion !== input.expectedPoolVersion)
          fail(409, 'INSTANCE_POOL_VERSION_CONFLICT', '实例池配置已更新，请刷新后重试');
        if (input.poolEnabled && !connection.poolEnabled) {
          if (this.pool(connection.workspaceId).length >= poolLimit)
            fail(409, 'INSTANCE_POOL_LIMIT', '每个工作区最多登记 12 个池实例');
          const duplicate = this.database.db
            .select({ id: generationConnections.id })
            .from(generationConnections)
            .where(
              and(
                eq(generationConnections.workspaceId, connection.workspaceId),
                eq(generationConnections.baseUrl, connection.baseUrl),
                eq(generationConnections.poolEnabled, true),
                ne(generationConnections.id, connection.id),
              ),
            )
            .get();
          if (duplicate) fail(409, 'INSTANCE_POOL_DUPLICATE', '此 API 地址已加入工作区实例池');
        }
        const { expectedPoolVersion, ...settings } = input;
        if (
          connection.poolEnabled === settings.poolEnabled &&
          connection.maxRunning === settings.maxRunning &&
          connection.maxPending === settings.maxPending
        )
          return { id: connection.id, ...settings, poolVersion: connection.poolVersion };
        const poolVersion = expectedPoolVersion + 1;
        this.database.db
          .update(generationConnections)
          .set({ ...settings, poolVersion })
          .where(eq(generationConnections.id, connection.id))
          .run();
        this.generation.audit(
          user,
          connection.workspaceId,
          'generation.instance.pool.configure',
          connection.id,
        );
        return { id: connection.id, ...settings, poolVersion };
      },
      { behavior: 'immediate' },
    );
  }

  list(user: CurrentUser, workflowId: string) {
    const workflow = this.workflow(user, workflowId);
    const checks = this.database.db
      .select()
      .from(generationInstanceChecks)
      .where(eq(generationInstanceChecks.workflowId, workflow.id))
      .all();
    const byInstance = new Map(checks.map((check) => [check.connectionId, check]));
    return {
      items: this.pool(workflow.workspaceId).map((connection) =>
        this.view(connection, byInstance.get(connection.id)),
      ),
    };
  }

  async check(user: CurrentUser, workflowId: string, connectionId: string) {
    const workflow = this.workflow(user, workflowId);
    const connection = this.generation.connection(connectionId, workflow.workspaceId);
    if (!connection.enabled || !connection.poolEnabled)
      fail(409, 'INSTANCE_NOT_ENABLED', '请先启用该连接并加入实例池');
    if (this.checking.has(connection.id) || this.checking.size >= 4)
      fail(409, 'INSTANCE_CHECK_BUSY', '实例检查正在运行，请稍后重试');
    const startedAt = Date.now();
    this.checking.add(connection.id);
    try {
      const definition = JSON.parse(workflow.definitionJson) as WorkflowInput;
      const observation = await this.observe(connection, definition);
      return this.database.db.transaction(
        () => {
          this.workflow(user, workflowId);
          const current = this.generation.connection(connectionId, workflow.workspaceId);
          if (current.version !== connection.version || current.poolVersion !== connection.poolVersion)
            fail(409, 'INSTANCE_CHECK_OUTDATED', '实例配置在检查期间已变化，请重新检查');
          const row: Check = {
            workflowId,
            connectionId,
            projectId: workflow.projectId,
            workspaceId: workflow.workspaceId,
            connectionVersion: current.version,
            poolVersion: current.poolVersion,
            checkedAt: startedAt,
            ...observation,
          };
          const existing = this.database.db
            .select()
            .from(generationInstanceChecks)
            .where(
              and(
                eq(generationInstanceChecks.workflowId, workflowId),
                eq(generationInstanceChecks.connectionId, connectionId),
              ),
            )
            .get();
          if (existing && existing.checkedAt > startedAt) return this.view(current, existing);
          this.database.db
            .insert(generationInstanceChecks)
            .values(row)
            .onConflictDoUpdate({
              target: [generationInstanceChecks.workflowId, generationInstanceChecks.connectionId],
              set: row,
            })
            .run();
          return this.view(current, row);
        },
        { behavior: 'immediate' },
      );
    } finally {
      this.checking.delete(connection.id);
    }
  }

  private async observe(
    connection: Connection,
    definition: WorkflowInput,
  ): Promise<Pick<Check, 'reachable' | 'running' | 'pending' | 'status' | 'binding' | 'reportJson'>> {
    let provider;
    try {
      provider = await this.generation.provider(connection);
      await provider.probe(AbortSignal.timeout(5000));
    } catch {
      return {
        reachable: false,
        running: null,
        pending: null,
        status: 'unverified',
        binding: 'unverified',
        reportJson: null,
      };
    }
    const [queue, inspection, validation] = await Promise.allSettled([
      provider.queueStatus(AbortSignal.timeout(5000)),
      provider.inspect(definition),
      provider.validate(definition),
    ]);
    const report = inspection.status === 'fulfilled' ? inspection.value : null;
    const binding =
      validation.status === 'fulfilled'
        ? 'passed'
        : validation.reason instanceof GenerationError && validation.reason.code.startsWith('WORKFLOW_')
          ? 'failed'
          : 'unverified';
    let status: Check['status'] = 'unverified';
    if (report?.status === 'incompatible' || binding === 'failed') status = 'incompatible';
    else if (report?.status === 'compatible' && binding === 'passed') status = 'compatible';
    return {
      reachable: true,
      running: queue.status === 'fulfilled' ? queue.value.running : null,
      pending: queue.status === 'fulfilled' ? queue.value.pending : null,
      status,
      binding,
      reportJson: report ? JSON.stringify(report) : null,
    };
  }
}
