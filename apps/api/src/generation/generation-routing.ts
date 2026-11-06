import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { fail } from '../common/http';
import { DatabaseService } from '../db/database.service';
import {
  generationConnections,
  generationInstanceChecks,
  generationJobRoutes,
  generationJobs,
  generationWorkflows,
} from '../db/schema';
import type { CreateJobInput } from './generation-contract';

type Connection = typeof generationConnections.$inferSelect;
type Check = typeof generationInstanceChecks.$inferSelect;
type Workflow = typeof generationWorkflows.$inferSelect;
export type JobRoute = typeof generationJobRoutes.$inferSelect;
const lifetimeMs = 15 * 60 * 1000;
const remoteStates = ['preparing', 'submitting', 'submitted', 'needs_reconciliation'] as const;
const reservingStates = ['queued', ...remoteStates, 'fetching'] as const;

export function freshInstanceCheck(connection: Connection, check?: Check) {
  return Boolean(
    check &&
    connection.enabled &&
    connection.poolEnabled &&
    check.connectionVersion === connection.version &&
    check.poolVersion === connection.poolVersion &&
    Date.now() - check.checkedAt < lifetimeMs,
  );
}

export function jobRoute(database: DatabaseService, jobId: string) {
  return database.db.select().from(generationJobRoutes).where(eq(generationJobRoutes.jobId, jobId)).get();
}

export function instanceLoad(database: DatabaseService, connectionId: string) {
  return database.db
    .select({
      occupied: sql<number>`count(*)`,
      running: sql<number>`coalesce(sum(case when ${inArray(generationJobs.state, remoteStates)} then 1 else 0 end),0)`,
    })
    .from(generationJobs)
    .innerJoin(generationWorkflows, eq(generationJobs.workflowId, generationWorkflows.id))
    .leftJoin(generationJobRoutes, eq(generationJobRoutes.jobId, generationJobs.id))
    .where(
      and(
        inArray(generationJobs.state, reservingStates),
        or(
          eq(generationJobRoutes.connectionId, connectionId),
          and(isNull(generationJobRoutes.jobId), eq(generationWorkflows.connectionId, connectionId)),
        ),
      ),
    )
    .get()!;
}

function candidates(database: DatabaseService, workflow: Workflow) {
  const checked = database.db
    .select({ connection: generationConnections, check: generationInstanceChecks })
    .from(generationInstanceChecks)
    .innerJoin(generationConnections, eq(generationInstanceChecks.connectionId, generationConnections.id))
    .where(
      and(
        eq(generationInstanceChecks.workflowId, workflow.id),
        eq(generationConnections.workspaceId, workflow.workspaceId),
        eq(generationConnections.poolEnabled, true),
        eq(generationConnections.enabled, true),
        eq(generationInstanceChecks.status, 'compatible'),
        eq(generationInstanceChecks.reachable, true),
      ),
    )
    .all();
  return checked
    .flatMap(({ connection, check }) => {
      if (!freshInstanceCheck(connection, check)) return [];
      const { running, pending } = check;
      const limit = connection.maxRunning + connection.maxPending;
      const load = instanceLoad(database, connection.id);
      const observed = (running ?? 0) + (pending ?? 0);
      return [
        {
          connection,
          check,
          load: (observed + load.occupied) / limit,
          available:
            running !== null &&
            pending !== null &&
            running < connection.maxRunning &&
            pending < connection.maxPending &&
            observed + load.occupied < limit,
        },
      ];
    })
    .sort((a, b) => a.load - b.load || a.connection.id.localeCompare(b.connection.id));
}

export function routingOptions(database: DatabaseService, workflow: Workflow) {
  return candidates(database, workflow).map(({ connection, available }) => ({
    id: connection.id,
    name: connection.name,
    available,
  }));
}

export function reserveInstance(
  database: DatabaseService,
  workflow: Workflow,
  routing: NonNullable<CreateJobInput['routing']>,
) {
  const choices = candidates(database, workflow);
  const selected =
    routing.mode === 'manual'
      ? choices.find((item) => item.connection.id === routing.connectionId)
      : choices.find((item) => item.available);
  if (!selected || !selected.available) {
    if (routing.mode === 'manual')
      fail(409, 'MANUAL_INSTANCE_UNAVAILABLE', '指定实例当前不可用，请检查能力、健康和负载后重试');
    if (choices.length) fail(409, 'INSTANCE_POOL_BUSY', '匹配实例暂时没有容量，请稍后重试或更新检查结果');
    fail(409, 'INSTANCE_POOL_UNAVAILABLE', '没有通过当前工作流检查的可用实例，请在工作流中心更新实例检查');
  }
  return selected;
}

export function checkReservedInstance(
  database: DatabaseService,
  connection: Connection,
  workflowId: string,
  route: JobRoute,
) {
  const check = database.db
    .select()
    .from(generationInstanceChecks)
    .where(
      and(
        eq(generationInstanceChecks.workflowId, workflowId),
        eq(generationInstanceChecks.connectionId, connection.id),
      ),
    )
    .get();
  return (
    connection.poolVersion === route.poolVersion &&
    freshInstanceCheck(connection, check) &&
    check?.reachable &&
    check.status === 'compatible'
  );
}
