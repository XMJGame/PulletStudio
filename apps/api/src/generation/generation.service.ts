import { HttpException, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, lt, lte, ne, or } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { CurrentUser, fail } from '../common/http';
import { DatabaseService } from '../db/database.service';
import {
  auditEvents,
  generationConnections,
  generationJobs,
  generationWorkflows,
  promptArtifacts,
  shots,
  mediaVersions,
  workflowCatalogs,
  workflowCatalogRevisions,
} from '../db/schema';
import { AuthorizationService } from '../production/authorization.service';
import { ProductionService } from '../production/production.service';
import { ProviderSecrets } from '../providers/provider-secrets';
import { approvedBaseUrl } from '../providers/safe-text-http';
import { AssetApprovalService } from '../assets/asset-approval.service';
import { MediaService } from '../assets/media.service';
import { catalogState, registerWorkflow, workflowHash, workflowReplay } from './workflow-catalog-state';
import { FieldValues, resolveFields } from './workflow-fields';
import { latestCompatibleRevision, latestRelease } from './workflow-release-state';
import { ComfyProvider, GenerationError } from './comfy-provider';
import {
  CreateJobInput,
  renderWorkflow,
  WorkflowInput,
  referenceImageLimit,
  referenceImageExtensions,
  ParameterValues,
  resolveParameters,
} from './generation-contract';

export type Job = typeof generationJobs.$inferSelect;
export type Workflow = typeof generationWorkflows.$inferSelect;
type Connection = typeof generationConnections.$inferSelect;
export type GenerationSnapshot = {
  graph: WorkflowInput['graph'];
  approvals: { revisionId: string; decisionId: string | null }[];
  image?: { id: string; fileName: string; version: number; mime: string; bytes: number; sha256: string };
  parameterValues?: ParameterValues;
  fieldValues?: FieldValues;
};
const now = () => new Date().toISOString();

@Injectable()
export class GenerationService {
  constructor(
    readonly database: DatabaseService,
    private readonly authz: AuthorizationService,
    private readonly production: ProductionService,
    private readonly approval: AssetApprovalService,
    private readonly secrets: ProviderSecrets,
    private readonly comfy: ComfyProvider,
    private readonly media: MediaService,
  ) {}

  audit(user: CurrentUser, workspaceId: string, action: string, targetId: string) {
    this.database.db
      .insert(auditEvents)
      .values({ id: randomUUID(), workspaceId, actorId: user.id, action, targetId, createdAt: now() })
      .run();
  }
  private canConfigure(user: CurrentUser, workspaceId: string) {
    return user.instanceAdmin && this.authz.workspace(user, workspaceId).role !== 'MEMBER';
  }
  manage(user: CurrentUser, workspaceId: string) {
    if (!this.canConfigure(user, workspaceId))
      fail(403, 'ENDPOINT_APPROVAL_REQUIRED', '配置生成连接或工作流需要实例和工作区管理权限');
  }
  connection(id: string, workspaceId?: string) {
    const row = this.database.db
      .select()
      .from(generationConnections)
      .where(eq(generationConnections.id, id))
      .get();
    if (!row || (workspaceId && row.workspaceId !== workspaceId))
      fail(404, 'NOT_FOUND', '生成连接不存在或无权访问');
    return row;
  }
  workflow(id: string) {
    const row = this.database.db
      .select()
      .from(generationWorkflows)
      .where(eq(generationWorkflows.id, id))
      .get();
    if (!row) fail(404, 'NOT_FOUND', '工作流不存在或无权访问');
    return row;
  }
  async provider(connection: Connection) {
    if (!connection.enabled) throw new GenerationError('CONNECTION_DISABLED');
    return this.comfy.prepare({
      baseUrl: connection.baseUrl,
      trustedPrivate: connection.trustedPrivate,
      token: this.secrets.decrypt(connection.encryptedSecret, connection.id, connection.workspaceId),
    });
  }
  config(user: CurrentUser, projectId: string) {
    const project = this.authz.project(user, projectId);
    const canConfigure = this.canConfigure(user, project.workspaceId);
    const access = this.production.access(user, projectId);
    const query = () =>
      this.database.db
        .select({
          id: generationWorkflows.id,
          name: generationWorkflows.name,
          capability: generationWorkflows.capability,
          createdAt: generationWorkflows.createdAt,
          enabled: generationConnections.enabled,
          definitionJson: generationWorkflows.definitionJson,
          familyId: workflowCatalogs.id,
          revision: workflowCatalogRevisions.revision,
          catalogVersion: workflowCatalogs.version,
          archived: workflowCatalogs.archived,
        })
        .from(generationWorkflows)
        .innerJoin(generationConnections, eq(generationWorkflows.connectionId, generationConnections.id))
        .leftJoin(workflowCatalogRevisions, eq(workflowCatalogRevisions.workflowId, generationWorkflows.id))
        .leftJoin(workflowCatalogs, eq(workflowCatalogs.id, workflowCatalogRevisions.familyId));
    const heads = query()
      .where(
        and(
          eq(generationWorkflows.projectId, projectId),
          or(
            isNull(workflowCatalogRevisions.workflowId),
            eq(workflowCatalogs.headWorkflowId, generationWorkflows.id),
          ),
        ),
      )
      .orderBy(desc(generationWorkflows.createdAt), desc(generationWorkflows.id))
      .limit(100)
      .all();
    const connections = canConfigure
      ? this.database.db
          .select({
            id: generationConnections.id,
            name: generationConnections.name,
            enabled: generationConnections.enabled,
            version: generationConnections.version,
            poolEnabled: generationConnections.poolEnabled,
            poolVersion: generationConnections.poolVersion,
            maxRunning: generationConnections.maxRunning,
            maxPending: generationConnections.maxPending,
          })
          .from(generationConnections)
          .where(eq(generationConnections.workspaceId, project.workspaceId))
          .limit(50)
          .all()
      : [];
    const summary = ({ definitionJson, ...workflow }: (typeof heads)[number]) => {
      const definition = JSON.parse(definitionJson) as WorkflowInput;
      const values = resolveParameters(definition),
        fieldValues = resolveFields(definition);
      return {
        ...workflow,
        reviewRequired: definition.reviewRequired === true,
        enabled: workflow.enabled && !workflow.archived,
        parameters: (definition.parameters ?? []).map((binding) => ({
          ...binding,
          defaultValue: values[binding.key],
        })),
        fields: (definition.fields ?? []).map(({ node: _node, input: _input, ...field }) => ({
          ...field,
          defaultValue: fieldValues[field.id],
        })),
      };
    };
    const productionIds = new Map<string, 'published' | 'compatible'>();
    const workflows = heads.map((head) => {
      const workflow = summary(head);
      const release = head.familyId ? latestRelease(this.database, head.familyId) : undefined;
      const productionId = release
        ? release.action === 'publish'
          ? release.workflowId
          : undefined
        : workflow.reviewRequired && head.familyId
          ? latestCompatibleRevision(this.database, head.familyId)
          : head.id;
      if (productionId) productionIds.set(productionId, release ? 'published' : 'compatible');
      return {
        ...workflow,
        releaseState: productionId === head.id ? (release ? 'published' : 'compatible') : 'draft',
        publishedWorkflowId: release?.action === 'publish' ? release.workflowId : null,
      };
    });
    const productionWorkflows = productionIds.size
      ? query()
          .where(
            and(
              eq(generationWorkflows.projectId, projectId),
              inArray(generationWorkflows.id, [...productionIds.keys()]),
            ),
          )
          .orderBy(desc(generationWorkflows.createdAt), desc(generationWorkflows.id))
          .all()
          .map((row) => ({ ...summary(row), releaseState: productionIds.get(row.id)! }))
      : [];
    return {
      canConfigure,
      canEdit: access.canEdit,
      canReview: access.canReview,
      workflows,
      productionWorkflows,
      connections,
    };
  }
  images(user: CurrentUser, projectId: string, cursor?: string) {
    this.authz.project(user, projectId, 'edit');
    const scope = and(
      eq(mediaVersions.projectId, projectId),
      eq(mediaVersions.mediaType, 'image'),
      ne(mediaVersions.origin, 'workflow_test'),
      lte(mediaVersions.byteLength, referenceImageLimit),
      inArray(mediaVersions.mime, Object.keys(referenceImageExtensions)),
    );
    const boundary = cursor
      ? this.database.db
          .select({ id: mediaVersions.id, createdAt: mediaVersions.createdAt })
          .from(mediaVersions)
          .where(and(scope, eq(mediaVersions.id, cursor)))
          .get()
      : undefined;
    if (cursor && !boundary) fail(400, 'INVALID_CURSOR', '图片分页位置无效');
    const rows = this.database.db
      .select({
        id: mediaVersions.id,
        fileName: mediaVersions.fileName,
        version: mediaVersions.version,
        createdAt: mediaVersions.createdAt,
      })
      .from(mediaVersions)
      .where(
        and(
          scope,
          boundary
            ? or(
                lt(mediaVersions.createdAt, boundary.createdAt),
                and(eq(mediaVersions.createdAt, boundary.createdAt), lt(mediaVersions.id, boundary.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(mediaVersions.createdAt), desc(mediaVersions.id))
      .limit(31)
      .all();
    return { items: rows.slice(0, 30), nextCursor: rows.length > 30 ? rows[29].id : null };
  }
  createConnection(
    user: CurrentUser,
    projectId: string,
    input: { name: string; baseUrl: string; trustedPrivate: boolean; token: string },
  ) {
    const project = this.authz.project(user, projectId);
    this.manage(user, project.workspaceId);
    let baseUrl: string;
    try {
      baseUrl = approvedBaseUrl(input.baseUrl, input.trustedPrivate);
    } catch {
      fail(400, 'ENDPOINT_INVALID', '请提供合法 HTTPS 地址，自部署 HTTP 需明确批准');
    }
    return this.database.db.transaction(() => {
      const id = randomUUID();
      this.database.db
        .insert(generationConnections)
        .values({
          id,
          workspaceId: project.workspaceId,
          name: input.name,
          baseUrl,
          trustedPrivate: input.trustedPrivate,
          encryptedSecret: input.token ? this.secrets.encrypt(input.token, id, project.workspaceId) : null,
          createdAt: now(),
        })
        .run();
      this.audit(user, project.workspaceId, 'generation.connection.create', id);
      return { id };
    });
  }
  updateConnection(user: CurrentUser, id: string, enabled: boolean, expectedVersion: number) {
    return this.database.db.transaction(
      () => {
        const row = this.connection(id);
        this.manage(user, row.workspaceId);
        if (row.version !== expectedVersion) fail(409, 'VERSION_CONFLICT', '连接已变化，请刷新设置');
        this.database.db
          .update(generationConnections)
          .set({ enabled, version: expectedVersion + 1 })
          .where(eq(generationConnections.id, id))
          .run();
        this.audit(user, row.workspaceId, 'generation.connection.toggle', id);
        return { id, enabled, version: expectedVersion + 1 };
      },
      { behavior: 'immediate' },
    );
  }
  async testConnection(user: CurrentUser, id: string) {
    const row = this.connection(id);
    this.manage(user, row.workspaceId);
    try {
      await (await this.provider(row)).probe();
    } catch (error) {
      this.remoteFailure(error);
    }
    return { reachable: true };
  }
  async createWorkflow(
    user: CurrentUser,
    projectId: string,
    input: WorkflowInput,
    key: string = randomUUID(),
  ) {
    const project = this.authz.project(user, projectId);
    this.manage(user, project.workspaceId);
    const hash = workflowHash({ action: 'create', definition: input });
    const replay = workflowReplay(this.database, user, projectId, key, hash);
    if (replay) return replay;
    const connection = this.connection(input.connectionId, project.workspaceId);
    try {
      await (await this.provider(connection)).validate(input);
    } catch (error) {
      this.remoteFailure(error);
    }
    return this.database.db.transaction(
      () => {
        this.authz.project(user, projectId);
        this.manage(user, project.workspaceId);
        const replay = workflowReplay(this.database, user, projectId, key, hash);
        if (replay) return replay;
        if (this.connection(connection.id).version !== connection.version)
          fail(409, 'VERSION_CONFLICT', '连接已变化，请重新验证');
        const id = randomUUID();
        this.database.db
          .insert(generationWorkflows)
          .values({
            id,
            workspaceId: project.workspaceId,
            projectId,
            connectionId: connection.id,
            name: input.name,
            capability: input.capability,
            definitionJson: JSON.stringify(input),
            createdBy: user.id,
            createdAt: now(),
          })
          .run();
        const row = this.workflow(id);
        const result = registerWorkflow(this.database, row, key, hash);
        this.audit(user, project.workspaceId, 'generation.workflow.create', id);
        return result;
      },
      { behavior: 'immediate' },
    );
  }
  remoteFailure(error: unknown): never {
    if (error instanceof HttpException) throw error;
    const code = error instanceof GenerationError ? error.code : 'COMFY_CONNECTION_FAILED';
    if (code === 'WORKFLOW_IMAGE_BINDING_INVALID')
      fail(400, code, '请绑定 ComfyUI 声明可上传图片的输入，例如 LoadImage.image');
    if (code === 'WORKFLOW_PARAMETER_BINDING_INVALID')
      fail(400, code, '参数绑定与远端输入类型、可选值或数值范围不匹配');
    if (code === 'WORKFLOW_FIELD_BINDING_INVALID')
      fail(400, code, '公开字段与节点声明的类型、范围或选项不匹配，请核对参数合同');
    fail(
      502,
      code,
      code.startsWith('WORKFLOW_')
        ? '远端节点或绑定不匹配，请核对工作流及 ComfyUI 节点版本'
        : '无法验证 ComfyUI，请核对连接与服务状态',
    );
  }
  approvals(user: CurrentUser, shotId: string) {
    const readiness = this.approval.readiness(user, shotId);
    if (!readiness.ready) fail(409, 'ASSET_NOT_READY', '镜头的资产条件尚未通过', readiness.blockers);
    const card = this.production.card(user, shotId);
    if (!card.available) fail(409, 'CARD_REQUIRED', '请先保存完整制作卡');
    return card.assetReferences.map((ref) => ({ revisionId: ref.id, decisionId: ref.decisionId }));
  }
  private view(row: Job, user: CurrentUser, access = this.production.access(user, row.projectId)) {
    const workflow = this.workflow(row.workflowId);
    const { image, parameterValues, fieldValues } = JSON.parse(row.snapshotJson) as GenerationSnapshot;
    const definition = JSON.parse(workflow.definitionJson) as WorkflowInput;
    const result = row.mediaVersionId ? this.media.version(user, row.mediaVersionId) : null;
    return {
      id: row.id,
      purpose: row.purpose,
      shotId: row.shotId,
      shotVersion: row.shotVersion,
      promptId: row.promptId,
      image: image ? { id: image.id, fileName: image.fileName, version: image.version } : null,
      parameterValues: parameterValues ?? {},
      fieldValues: fieldValues ?? {},
      creativeParameters: (definition.fields ?? []).map((field) => ({
        label: field.label,
        value: fieldValues?.[field.id] ?? definition.graph[field.node].inputs[field.input],
      })),
      workflowRevision: catalogState(this.database, row.workflowId)?.revision ?? 1,
      result: result
        ? { mediaType: result.mediaType, metadata: result.metadata, contentUrl: result.contentUrl }
        : null,
      workflowName: workflow.name,
      capability: workflow.capability,
      state: row.state,
      remoteId: row.remoteId,
      errorCode: row.errorCode,
      mediaVersionId: row.mediaVersionId,
      takeId: row.takeId,
      canControl: access.canManage || (access.canEdit && row.creatorId === user.id),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
  createJob(
    user: CurrentUser,
    shotId: string,
    input: CreateJobInput,
    key: string,
    purpose: Job['purpose'] = 'production',
  ) {
    return this.database.db.transaction(
      () => {
        const shot = this.production.shot(user, shotId, 'edit'),
          project = this.authz.project(user, shot.projectId);
        if (purpose === 'workflow_test') this.manage(user, project.workspaceId);
        const replay = this.database.db
          .select()
          .from(generationJobs)
          .where(
            and(
              eq(generationJobs.shotId, shotId),
              eq(generationJobs.creatorId, user.id),
              eq(generationJobs.requestKey, key),
            ),
          )
          .get();
        if (replay) {
          if (
            replay.purpose !== purpose ||
            replay.workflowId !== input.workflowId ||
            replay.promptId !== input.promptId ||
            (input.canvasShotVersion !== undefined && replay.shotVersion !== input.canvasShotVersion) ||
            (JSON.parse(replay.snapshotJson) as GenerationSnapshot).image?.id !== input.imageVersionId
          )
            fail(409, 'IDEMPOTENCY_CONFLICT', '此请求标识已用于其他生成输入');
          const definition = JSON.parse(this.workflow(replay.workflowId).definitionJson) as WorkflowInput;
          const requested = resolveParameters(definition, input.parameterValues);
          const snapshot = JSON.parse(replay.snapshotJson) as GenerationSnapshot;
          if (JSON.stringify(snapshot.parameterValues ?? {}) !== JSON.stringify(requested))
            fail(409, 'IDEMPOTENCY_CONFLICT', '此请求标识已用于其他生成参数');
          if (
            JSON.stringify(snapshot.fieldValues ?? {}) !==
            JSON.stringify(resolveFields(definition, input.fieldValues))
          )
            fail(409, 'IDEMPOTENCY_CONFLICT', '此请求标识已用于其他创作字段值');
          return this.view(replay, user);
        }
        if (input.canvasShotVersion !== undefined && shot.version !== input.canvasShotVersion)
          fail(409, 'CANVAS_SHOT_OUTDATED', '制作卡已有新版本，请更新画布镜头引用后再生成');
        const workflow = this.workflow(input.workflowId);
        if (workflow.projectId !== project.id) fail(404, 'NOT_FOUND', '工作流不属于当前项目');
        const catalog = catalogState(this.database, workflow.id);
        if (catalog?.archived) fail(409, 'WORKFLOW_ARCHIVED', '此工作流目录已归档，请选择其他配置');
        const definition = JSON.parse(workflow.definitionJson) as WorkflowInput;
        if (purpose === 'production') {
          const release = catalog && latestRelease(this.database, catalog.familyId);
          if (
            release
              ? release.action !== 'publish' || release.workflowId !== workflow.id
              : definition.reviewRequired || input.canvasShotVersion !== undefined
          )
            fail(409, 'WORKFLOW_NOT_PUBLISHED', '请选择项目当前可用的生产工作流版本');
        }
        const connection = this.connection(workflow.connectionId, project.workspaceId);
        if (!connection.enabled) fail(409, 'CONNECTION_DISABLED', '生成连接已停用');
        const prompt = this.database.db
          .select()
          .from(promptArtifacts)
          .where(and(eq(promptArtifacts.id, input.promptId), eq(promptArtifacts.shotId, shotId)))
          .get();
        if (!prompt) fail(404, 'NOT_FOUND', '提示词不属于当前镜头');
        if (prompt.cardVersion !== shot.version || prompt.projectVersion !== project.version)
          fail(409, 'PROMPT_OUTDATED', '请按当前制作卡及项目设定重新保存提示词');
        const active = this.database.db
          .select({ id: generationJobs.id })
          .from(generationJobs)
          .where(
            and(
              eq(generationJobs.shotId, shotId),
              inArray(generationJobs.state, [
                'queued',
                'preparing',
                'submitting',
                'submitted',
                'fetching',
                'needs_reconciliation',
              ]),
            ),
          )
          .get();
        if (active) fail(409, 'GENERATION_ACTIVE', '此镜头已有待处理任务，请先查看任务记录');
        const approvals = this.approvals(user, shotId);
        if ((workflow.capability === 'video.image_to_video') !== Boolean(input.imageVersionId))
          fail(400, 'REFERENCE_IMAGE_REQUIRED', '图生视频须选择一个项目图片版本');
        let image: GenerationSnapshot['image'];
        if (input.imageVersionId) {
          const source = this.media.version(user, input.imageVersionId);
          if (source.projectId !== project.id) fail(404, 'NOT_FOUND', '首帧不属于当前项目');
          if (
            source.origin === 'workflow_test' ||
            source.mediaType !== 'image' ||
            !referenceImageExtensions[source.mime] ||
            source.byteLength > referenceImageLimit
          )
            fail(400, 'REFERENCE_IMAGE_INVALID', '首帧须为不超过 16 MiB 的 PNG、JPEG 或 WebP');
          image = {
            id: source.id,
            fileName: source.fileName,
            version: source.version,
            mime: source.mime,
            bytes: source.byteLength,
            sha256: source.sha256,
          };
        }
        const rendered = JSON.parse(prompt.renderedJson) as {
          positivePrompt: string;
          negativePrompt: string;
        };
        const parameterValues = resolveParameters(definition, input.parameterValues);
        const fieldValues = resolveFields(definition, input.fieldValues);
        const graph = renderWorkflow(
          definition,
          rendered.positivePrompt,
          rendered.negativePrompt,
          parameterValues,
          fieldValues,
        );
        const id = randomUUID(),
          createdAt = now();
        const row = this.database.db
          .insert(generationJobs)
          .values({
            id,
            purpose,
            shotId,
            projectId: project.id,
            workspaceId: project.workspaceId,
            workflowId: workflow.id,
            promptId: prompt.id,
            shotVersion: shot.version,
            projectVersion: project.version,
            connectionVersion: connection.version,
            creatorId: user.id,
            requestKey: key,
            snapshotJson: JSON.stringify({ graph, approvals, image, parameterValues, fieldValues }),
            state: 'queued',
            nextAt: Date.now(),
            createdAt,
            updatedAt: createdAt,
          })
          .returning()
          .get()!;
        this.audit(
          user,
          project.workspaceId,
          purpose === 'workflow_test' ? 'generation.test.queue' : 'generation.job.queue',
          id,
        );
        return this.view(row, user);
      },
      { behavior: 'immediate' },
    );
  }
  jobs(user: CurrentUser, shotId: string) {
    const shot = this.production.shot(user, shotId);
    const access = this.production.access(user, shot.projectId);
    const rows = this.database.db
      .select()
      .from(generationJobs)
      .where(and(eq(generationJobs.shotId, shotId), eq(generationJobs.purpose, 'production')))
      .orderBy(desc(generationJobs.createdAt), desc(generationJobs.id))
      .limit(30)
      .all();
    return rows.map((row) => this.view(row, user, access));
  }
  testJobs(user: CurrentUser, workflowId: string) {
    const workflow = this.workflow(workflowId);
    const access = this.production.access(user, workflow.projectId);
    const connection = this.connection(workflow.connectionId, workflow.workspaceId);
    const rows = this.database.db
      .select({ job: generationJobs, shotCode: shots.code })
      .from(generationJobs)
      .innerJoin(shots, eq(shots.id, generationJobs.shotId))
      .where(and(eq(generationJobs.workflowId, workflowId), eq(generationJobs.purpose, 'workflow_test')))
      .orderBy(desc(generationJobs.createdAt), desc(generationJobs.id))
      .limit(30)
      .all();
    return rows.map(({ job, shotCode }) => ({
      ...this.view(job, user, access),
      shotCode,
      evidenceCurrent:
        job.state === 'test_completed' && connection.enabled && job.connectionVersion === connection.version,
    }));
  }
  get(user: CurrentUser, id: string) {
    const row = this.job(id);
    this.authz.project(user, row.projectId);
    return this.view(row, user);
  }
  private job(id: string) {
    const row = this.database.db.select().from(generationJobs).where(eq(generationJobs.id, id)).get();
    if (!row) fail(404, 'NOT_FOUND', '生成任务不存在或无权访问');
    return row;
  }
  control(user: CurrentUser, id: string, action: 'cancel' | 'reconcile' | 'stop', remoteId?: string) {
    return this.database.db.transaction(
      () => {
        const row = this.job(id);
        this.authz.project(user, row.projectId, 'edit');
        if (row.creatorId !== user.id) this.authz.project(user, row.projectId, 'manage');
        let changes: Partial<Job>;
        if (action === 'cancel' && ['queued', 'preparing'].includes(row.state))
          changes = { state: 'canceled', errorCode: null };
        else if (action === 'stop' && ['submitted', 'needs_reconciliation'].includes(row.state))
          changes = { state: 'failed', errorCode: 'TRACKING_STOPPED' };
        else if (action === 'reconcile' && row.state === 'needs_reconciliation') {
          if (row.remoteId && remoteId && row.remoteId !== remoteId)
            fail(409, 'REMOTE_ID_FIXED', '已确认的远端任务标识不可替换');
          // A null ID stays unverified. The worker checks the correlation marker.
          changes = {
            state: row.remoteId && row.resultJson ? 'fetching' : 'submitted',
            nextAt: Date.now(),
            deadline: Date.now() + 120000,
            errorCode: row.remoteId ? null : 'VERIFY_REMOTE_ID',
            ...(!row.remoteId
              ? { resultJson: remoteId ? JSON.stringify({ candidateRemoteId: remoteId }) : null }
              : {}),
          };
        } else fail(409, 'GENERATION_STATE_CONFLICT', '当前任务状态无法执行此操作');
        const updated = this.database.db
          .update(generationJobs)
          .set({ ...changes, leaseId: null, leaseUntil: null, updatedAt: now() })
          .where(eq(generationJobs.id, id))
          .returning()
          .get()!;
        this.audit(user, row.workspaceId, `generation.job.${action}`, id);
        return this.view(updated, user);
      },
      { behavior: 'immediate' },
    );
  }
}
