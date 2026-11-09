import { HttpException, Injectable } from '@nestjs/common';
import { PromptLibraryService } from '../prompt-library/prompt-library.service';
import { and, desc, eq, inArray, isNull, lt, lte, ne, notExists, or, sql } from 'drizzle-orm';
import type { BoardExecution } from '../../../../packages/contracts/src/board';
import { randomUUID } from 'node:crypto';
import { CurrentUser, fail, parse } from '../common/http';
import { outputIds as outputIdsSchema } from './generation-output-batch';
import { DatabaseService } from '../db/database.service';
import {
  auditEvents,
  generationConnections,
  generationJobs,
  generationOutputs,
  generationJobRoutes,
  generationWorkflows,
  promptArtifacts,
  shots,
  mediaVersions,
  workflowCatalogs,
  workflowCatalogRevisions,
  boards,
  mediaAssets,
  entityMediaBindings,
} from '../db/schema';
import { AuthorizationService } from '../production/authorization.service';
import { ProductionService } from '../production/production.service';
import { ProviderSecrets } from '../providers/provider-secrets';
import { approvedBaseUrl } from '../providers/safe-text-http';
import { AssetApprovalService } from '../assets/asset-approval.service';
import { MediaService } from '../assets/media.service';
import { assertSampleAccess } from '../assets/entity-references';
import { catalogState, registerWorkflow, workflowHash, workflowReplay } from './workflow-catalog-state';
import { FieldValues, resolveFields } from './workflow-fields';
import { latestCompatibleRevision, latestRelease } from './workflow-release-state';
import { jobRoute, reserveInstance, routingOptions } from './generation-routing';
import { ComfyProvider, GenerationError } from './comfy-provider';
import { modelScopeBase, modelScopeImage, ModelScopeProvider } from './modelscope-provider';
import {
  assertMediaExecutable,
  hasExtendedMedia,
  mediaExecutionReason,
  publicMediaSchema,
  supportsReferenceMedia,
} from './workflow-media';
import {
  CreateJobInput,
  CreateProjectJobInput,
  renderWorkflow,
  WorkflowInput,
  referenceImagesTotalLimit,
  referenceMediaFormats,
  referenceMediaExtension,
  type ReferenceMediaType,
  ParameterValues,
  resolveParameters,
} from './generation-contract';

export type Job = typeof generationJobs.$inferSelect;
export type Workflow = typeof generationWorkflows.$inferSelect;
type Connection = typeof generationConnections.$inferSelect;
export type GenerationSnapshot = {
  boardExecution?: BoardExecution & { requestHash: string };
  graph: WorkflowInput['graph'];
  approvals: { revisionId: string; decisionId: string | null }[];
  image?: { id: string; fileName: string; version: number; mime: string; bytes: number; sha256: string };
  referenceImages?: ({ slotId: string } & NonNullable<GenerationSnapshot['image']>)[];
  referenceMedia?: ({ slotId: string; mediaType: ReferenceMediaType } & NonNullable<
    GenerationSnapshot['image']
  >)[];
  optionalReferenceImages?: true;
  optionalReferenceMedia?: true;
  audioOutput?: true;
  extendedOutputs?: true;
  primaryBatch?: true;
  parameterValues?: ParameterValues;
  fieldValues?: FieldValues;
  prompt?: { positivePrompt: string; negativePrompt: string; source: string };
  promptLibrary?: { entryId: string; revisionId: string; version: number; title: string };
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
    readonly modelScope: ModelScopeProvider,
    private readonly media: MediaService,
    private readonly promptLibrary: PromptLibraryService,
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
  authorizeCreation(user: CurrentUser, projectId: string) {
    return this.authz.project(user, projectId, 'edit');
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
    if (connection.provider !== 'comfyui') throw new GenerationError('WORKFLOW_PROVIDER_UNSUPPORTED');
    return this.comfy.prepare({
      baseUrl: connection.baseUrl,
      trustedPrivate: connection.trustedPrivate,
      token: this.secrets.decrypt(connection.encryptedSecret, connection.id, connection.workspaceId),
    });
  }
  private modelScopeConnection(workspaceId: string) {
    return this.database.db
      .select()
      .from(generationConnections)
      .where(
        and(
          eq(generationConnections.workspaceId, workspaceId),
          eq(generationConnections.provider, 'modelscope'),
        ),
      )
      .get();
  }
  modelScopeStatus(user: CurrentUser, workspaceId: string) {
    this.manage(user, workspaceId);
    const row = this.modelScopeConnection(workspaceId);
    return { configured: Boolean(row?.enabled && row.encryptedSecret), encryptionReady: this.secrets.ready };
  }
  configureModelScope(user: CurrentUser, workspaceId: string, token: string) {
    this.manage(user, workspaceId);
    return this.database.db.transaction(
      () => {
        const previous = this.modelScopeConnection(workspaceId);
        const id = previous?.id ?? randomUUID();
        const encryptedSecret = this.secrets.encrypt(token, id, workspaceId);
        if (previous) {
          this.database.db
            .update(generationConnections)
            .set({ encryptedSecret, enabled: true, version: previous.version + 1 })
            .where(eq(generationConnections.id, id))
            .run();
        } else {
          this.database.db
            .insert(generationConnections)
            .values({
              id,
              workspaceId,
              name: 'ModelScope',
              baseUrl: modelScopeBase,
              provider: 'modelscope',
              trustedPrivate: false,
              encryptedSecret,
              createdAt: now(),
            })
            .run();
        }
        this.audit(user, workspaceId, 'generation.modelscope.configure', id);
        return { configured: true };
      },
      { behavior: 'immediate' },
    );
  }
  modelScopeToken(connection: Connection, expectedVersion: number) {
    if (connection.provider !== 'modelscope' || !connection.enabled || connection.version !== expectedVersion)
      throw new GenerationError('GENERATION_INPUT_CHANGED');
    const token = this.secrets.decrypt(connection.encryptedSecret, connection.id, connection.workspaceId);
    if (!token) throw new GenerationError('MODELSCOPE_KEY_REQUIRED');
    return token;
  }
  projectModelScope(user: CurrentUser, projectId: string) {
    return this.database.db.transaction(
      () => {
        const project = this.authorizeCreation(user, projectId);
        const connection = this.modelScopeConnection(project.workspaceId);
        if (!connection?.enabled || !connection.encryptedSecret)
          fail(409, 'MODELSCOPE_KEY_REQUIRED', '当前工作区尚未配置 ModelScope 文生图凭据');
        const name = 'ModelScope · Qwen Image 2512';
        const existing = this.database.db
          .select({ id: generationWorkflows.id })
          .from(generationWorkflows)
          .where(
            and(
              eq(generationWorkflows.projectId, project.id),
              eq(generationWorkflows.connectionId, connection.id),
              eq(generationWorkflows.name, name),
            ),
          )
          .get();
        if (existing) return existing;
        const id = randomUUID();
        const definition: WorkflowInput = {
          name,
          connectionId: connection.id,
          capability: 'image.text_to_image',
          graph: { '1': { class_type: 'StudioApiImage', inputs: { prompt: '', model: modelScopeImage } } },
          positive: { node: '1', input: 'prompt' },
          output: { node: '1', field: 'images' },
        };
        this.database.db
          .insert(generationWorkflows)
          .values({
            id,
            projectId: project.id,
            workspaceId: project.workspaceId,
            connectionId: connection.id,
            name,
            capability: definition.capability,
            definitionJson: JSON.stringify(definition),
            createdBy: user.id,
            createdAt: now(),
          })
          .run();
        this.audit(user, project.workspaceId, 'generation.modelscope.project', id);
        return { id };
      },
      { behavior: 'immediate' },
    );
  }
  config(user: CurrentUser, projectId: string, workflowId?: string) {
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
          provider: generationConnections.provider,
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
          eq(generationConnections.provider, 'comfyui'),
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
            baseUrl: generationConnections.baseUrl,
            enabled: generationConnections.enabled,
            version: generationConnections.version,
            poolEnabled: generationConnections.poolEnabled,
            poolVersion: generationConnections.poolVersion,
            maxRunning: generationConnections.maxRunning,
            maxPending: generationConnections.maxPending,
          })
          .from(generationConnections)
          .where(
            and(
              eq(generationConnections.workspaceId, project.workspaceId),
              eq(generationConnections.provider, 'comfyui'),
            ),
          )
          .limit(50)
          .all()
      : [];
    const summary = ({ definitionJson, ...workflow }: (typeof heads)[number]) => {
      const definition = JSON.parse(definitionJson) as WorkflowInput;
      const executable =
        !hasExtendedMedia(definition.mediaSchema) || supportsReferenceMedia(definition.mediaSchema);
      const values = resolveParameters(definition),
        fieldValues = resolveFields(definition);
      return {
        ...workflow,
        mediaSchema: publicMediaSchema(definition.mediaSchema),
        executable,
        executionBlocker: executable ? null : mediaExecutionReason,
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
    const pinned =
      workflowId &&
      query()
        .where(and(eq(generationWorkflows.projectId, projectId), eq(generationWorkflows.id, workflowId)))
        .get();
    return {
      canConfigure,
      canEdit: access.canEdit,
      canReview: access.canReview,
      poolConfigured: Boolean(
        this.database.db
          .select({ id: generationConnections.id })
          .from(generationConnections)
          .where(
            and(
              eq(generationConnections.workspaceId, project.workspaceId),
              eq(generationConnections.poolEnabled, true),
            ),
          )
          .get(),
      ),
      workflows,
      ...(pinned ? { pinnedWorkflow: summary(pinned) } : {}),
      productionWorkflows,
      connections,
    };
  }
  routingOptions(user: CurrentUser, workflowId: string, exploration = false) {
    const workflow = this.workflow(workflowId);
    this.authz.project(user, workflow.projectId, 'edit');
    if (this.connection(workflow.connectionId).provider === 'modelscope') return { items: [] };
    const catalog = catalogState(this.database, workflowId);
    const release = catalog && latestRelease(this.database, catalog.familyId);
    const definition = JSON.parse(workflow.definitionJson) as WorkflowInput;
    if (
      catalog?.archived ||
      (!exploration &&
        (release
          ? release.action !== 'publish' || release.workflowId !== workflowId
          : definition.reviewRequired))
    )
      fail(409, 'WORKFLOW_NOT_PUBLISHED', '请选择项目当前可用的生产工作流版本');
    return { items: routingOptions(this.database, workflow) };
  }
  images(user: CurrentUser, projectId: string, cursor?: string, type: ReferenceMediaType = 'image') {
    this.authz.project(user, projectId, 'edit');
    const canReadSamples = this.production.access(user, projectId).canReview;
    const format = referenceMediaFormats[type];
    const scope = and(
      eq(mediaVersions.projectId, projectId),
      eq(mediaVersions.mediaType, type),
      ne(mediaVersions.origin, 'workflow_test'),
      lte(mediaVersions.byteLength, format.limit),
      inArray(mediaVersions.mime, Object.keys(format.extensions)),
      !canReadSamples
        ? or(
            eq(mediaVersions.createdBy, user.id),
            notExists(
              this.database.db
                .select({ id: entityMediaBindings.revisionId })
                .from(entityMediaBindings)
                .where(
                  and(
                    eq(entityMediaBindings.mediaVersionId, mediaVersions.id),
                    eq(entityMediaBindings.role, 'voice_sample'),
                  ),
                ),
            ),
          )
        : undefined,
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
    if (code === 'WORKFLOW_MEDIA_BINDING_INVALID')
      fail(400, code, '媒体槽位与远端声明的上传类型或输出节点不匹配，请检查媒体配置');
    if (code === 'WORKFLOW_MEDIA_DISCONNECT_INVALID')
      fail(400, code, '可选参考图的所有下游连接都必须是该实例声明可省略的图片输入');
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
    const {
      image,
      referenceImages,
      referenceMedia,
      parameterValues,
      fieldValues,
      prompt,
      promptLibrary,
      boardExecution,
    } = JSON.parse(row.snapshotJson) as GenerationSnapshot;
    const definition = JSON.parse(workflow.definitionJson) as WorkflowInput;
    const result = row.mediaVersionId ? this.media.version(user, row.mediaVersionId) : null;
    const route = jobRoute(this.database, row.id);
    return {
      id: row.id,
      purpose: row.purpose,
      instance: route ? { id: route.connectionId, name: route.instanceName, mode: route.mode } : null,
      shotId: row.shotId,
      boardId: row.boardId,
      prompt,
      promptLibrary,
      boardExecution: boardExecution && {
        boardId: boardExecution.boardId,
        revision: boardExecution.revision,
        nodeId: boardExecution.nodeId,
        bindings: boardExecution.bindings,
      },
      inLibrary: result
        ? (this.database.db
            .select({ value: mediaAssets.inLibrary })
            .from(mediaAssets)
            .where(eq(mediaAssets.id, result.assetId))
            .get()?.value ?? false)
        : false,
      shotVersion: row.shotVersion,
      promptId: row.promptId,
      image: image ? { id: image.id, fileName: image.fileName, version: image.version } : null,
      ...(referenceImages && {
        referenceImages: referenceImages.map(({ slotId, fileName, version }) => ({
          slotId,
          fileName,
          version,
          label: definition.mediaSchema?.inputs.find((slot) => slot.id === slotId)?.label,
        })),
      }),
      ...(referenceMedia && {
        referenceMedia: referenceMedia.map(({ slotId, fileName, version, mediaType }) => ({
          slotId,
          fileName,
          version,
          mediaType,
          label: definition.mediaSchema?.inputs.find((slot) => slot.id === slotId)?.label,
        })),
      }),
      parameterValues: parameterValues ?? {},
      fieldValues: fieldValues ?? {},
      creativeParameters: (definition.fields ?? []).map((field) => ({
        label: field.label,
        value: fieldValues?.[field.id] ?? definition.graph[field.node].inputs[field.input],
      })),
      workflowRevision: catalogState(this.database, row.workflowId)?.revision ?? 1,
      result: result
        ? {
            fileName: result.fileName,
            byteLength: result.byteLength,
            mediaType: result.mediaType,
            metadata: result.metadata,
            contentUrl: result.contentUrl,
            posterUrl: result.posterUrl,
          }
        : null,
      outputs: ['completed', 'test_completed'].includes(row.state)
        ? [
            ...(definition.output.batch ? [definition.output.batch] : []),
            ...(definition.mediaSchema?.outputs ?? []),
          ].flatMap((slot) =>
            this.database.db
              .select()
              .from(generationOutputs)
              .where(and(eq(generationOutputs.jobId, row.id), eq(generationOutputs.slotId, slot.id)))
              .all()
              .sort((a, b) => a.position - b.position)
              .map((output) => {
                const file = output.mediaVersionId ? this.media.version(user, output.mediaVersionId) : null;
                return {
                  id: output.id,
                  slotId: output.slotId,
                  index: output.position,
                  label: output.label,
                  role: output.primaryIndex != null ? 'primary' : output.role,
                  mediaVersionId: output.mediaVersionId,
                  inLibrary: file
                    ? (this.database.db
                        .select({ value: mediaAssets.inLibrary })
                        .from(mediaAssets)
                        .where(eq(mediaAssets.id, file.assetId))
                        .get()?.value ?? false)
                    : false,
                  result: file
                    ? {
                        fileName: file.fileName,
                        byteLength: file.byteLength,
                        mediaType: file.mediaType,
                        metadata: file.metadata,
                        contentUrl: file.contentUrl,
                        posterUrl: file.posterUrl,
                      }
                    : null,
                };
              }),
          )
        : [],
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
    return this.enqueue(user, { shotId }, input, key, purpose);
  }
  createProjectJob(
    user: CurrentUser,
    projectId: string,
    input: CreateProjectJobInput,
    key: string,
    purpose: Job['purpose'] = 'production',
  ) {
    return this.enqueue(user, { projectId }, input, key, purpose);
  }
  createBoardJob(
    user: CurrentUser,
    projectId: string,
    input: CreateProjectJobInput,
    key: string,
    execution: NonNullable<GenerationSnapshot['boardExecution']>,
  ) {
    return this.enqueue(user, { projectId }, input, key, 'production', execution);
  }
  referenceMedia(
    user: CurrentUser,
    projectId: string,
    id: string,
    type: ReferenceMediaType = 'image',
  ): NonNullable<GenerationSnapshot['image']> {
    this.authz.project(user, projectId);
    const source = this.database.db
      .select()
      .from(mediaVersions)
      .where(and(eq(mediaVersions.id, id), eq(mediaVersions.projectId, projectId)))
      .get();
    if (!source) fail(404, 'NOT_FOUND', '参考素材不属于当前项目');
    assertSampleAccess(this.database, user, source);
    if (
      source.origin === 'workflow_test' ||
      source.mediaType !== type ||
      !referenceMediaExtension(type, source.mime) ||
      source.byteLength <= 0 ||
      source.byteLength > referenceMediaFormats[type].limit
    )
      fail(
        400,
        type === 'image' ? 'REFERENCE_IMAGE_INVALID' : 'REFERENCE_MEDIA_INVALID',
        '参考素材类型、格式或大小不符合当前槽位要求',
      );
    return {
      id: source.id,
      fileName: source.fileName,
      version: source.version,
      mime: source.mime,
      bytes: source.byteLength,
      sha256: source.sha256,
    };
  }
  private enqueue(
    user: CurrentUser,
    context: { shotId: string; projectId?: never } | { projectId: string; shotId?: never },
    input: Omit<CreateJobInput, 'promptId'> & {
      promptId?: string;
      positivePrompt?: string;
      negativePrompt?: string;
      source?: string;
      boardId?: string;
      promptLibraryRevisionId?: string;
      referenceImageVersions?: CreateProjectJobInput['referenceImageVersions'];
      referenceMediaVersions?: CreateProjectJobInput['referenceMediaVersions'];
    },
    key: string,
    purpose: Job['purpose'],
    boardExecution?: GenerationSnapshot['boardExecution'],
  ) {
    return this.database.db.transaction(
      () => {
        const shot = context.shotId ? this.production.shot(user, context.shotId, 'edit') : null,
          shotId = shot?.id ?? null,
          project = this.authz.project(user, shot?.projectId ?? context.projectId!, 'edit');
        if (purpose === 'workflow_test') this.manage(user, project.workspaceId);
        if (input.referenceImageVersions && input.referenceMediaVersions)
          fail(400, 'REFERENCE_INPUT_CONFLICT', '请选择一种参考素材提交格式');
        const supplied = input.referenceMediaVersions ?? input.referenceImageVersions ?? {};
        if (
          input.boardId &&
          !this.database.db
            .select({ id: boards.id })
            .from(boards)
            .where(and(eq(boards.id, input.boardId), eq(boards.projectId, project.id)))
            .get()
        )
          fail(404, 'NOT_FOUND', '画布不属于当前项目');
        const replay = this.database.db
          .select()
          .from(generationJobs)
          .where(
            and(
              shotId
                ? eq(generationJobs.shotId, shotId)
                : and(isNull(generationJobs.shotId), eq(generationJobs.projectId, project.id)),
              eq(generationJobs.creatorId, user.id),
              eq(generationJobs.requestKey, key),
            ),
          )
          .get();
        if (replay) {
          const route = jobRoute(this.database, replay.id);
          if (
            replay.purpose !== purpose ||
            route?.mode !== input.routing?.mode ||
            (input.routing?.mode === 'manual' && route?.connectionId !== input.routing.connectionId) ||
            replay.workflowId !== input.workflowId ||
            replay.promptId !== (input.promptId ?? null) ||
            replay.boardId !== (input.boardId ?? null) ||
            (input.canvasShotVersion !== undefined && replay.shotVersion !== input.canvasShotVersion) ||
            (JSON.parse(replay.snapshotJson) as GenerationSnapshot).image?.id !== input.imageVersionId
          )
            fail(409, 'IDEMPOTENCY_CONFLICT', '此请求标识已用于其他生成输入');
          const definition = JSON.parse(this.workflow(replay.workflowId).definitionJson) as WorkflowInput;
          const requested = resolveParameters(definition, input.parameterValues);
          const snapshot = JSON.parse(replay.snapshotJson) as GenerationSnapshot;
          const frozen = snapshot.referenceMedia ?? snapshot.referenceImages ?? [];
          if (
            Object.keys(supplied).length !== frozen.length ||
            frozen.some((item) => supplied[item.slotId] !== item.id)
          )
            fail(409, 'IDEMPOTENCY_CONFLICT', '此请求标识已用于其他参考图片');
          if (snapshot.boardExecution?.requestHash !== boardExecution?.requestHash)
            fail(409, 'IDEMPOTENCY_CONFLICT', '此请求标识已用于其他画布执行');
          if (snapshot.promptLibrary?.revisionId !== input.promptLibraryRevisionId)
            fail(409, 'IDEMPOTENCY_CONFLICT', '此请求标识已用于其他提示词库版本');
          if (
            !shot &&
            JSON.stringify(snapshot.prompt) !==
              JSON.stringify({
                positivePrompt: input.positivePrompt,
                negativePrompt: input.negativePrompt ?? '',
                source: input.source ?? '',
              })
          )
            fail(409, 'IDEMPOTENCY_CONFLICT', '此请求标识已用于其他提示词');
          if (JSON.stringify(snapshot.parameterValues ?? {}) !== JSON.stringify(requested))
            fail(409, 'IDEMPOTENCY_CONFLICT', '此请求标识已用于其他生成参数');
          if (
            JSON.stringify(snapshot.fieldValues ?? {}) !==
            JSON.stringify(resolveFields(definition, input.fieldValues))
          )
            fail(409, 'IDEMPOTENCY_CONFLICT', '此请求标识已用于其他创作字段值');
          return this.view(replay, user);
        }
        if (input.canvasShotVersion !== undefined && shot?.version !== input.canvasShotVersion)
          fail(409, 'CANVAS_SHOT_OUTDATED', '制作卡已有新版本，请更新画布镜头引用后再生成');
        const workflow = this.workflow(input.workflowId);
        const promptLibrary = input.promptLibraryRevisionId
          ? this.promptLibrary.reference(
              user,
              project.id,
              input.promptLibraryRevisionId,
              input.positivePrompt!,
              input.negativePrompt ?? '',
            )
          : undefined;
        if (workflow.projectId !== project.id) fail(404, 'NOT_FOUND', '工作流不属于当前项目');
        const catalog = catalogState(this.database, workflow.id);
        if (catalog?.archived) fail(409, 'WORKFLOW_ARCHIVED', '此工作流目录已归档，请选择其他配置');
        const definition = JSON.parse(workflow.definitionJson) as WorkflowInput;
        const projectReferences = !shot;
        if (shot && definition.output.batch)
          fail(409, 'WORKFLOW_MEDIA_UNSUPPORTED', '批量主结果请使用项目创作或画布入口。');
        assertMediaExecutable(definition.mediaSchema, projectReferences);
        const slots = definition.mediaSchema?.inputs ?? [];
        if (shot && definition.capability === 'audio.music')
          fail(409, 'WORKFLOW_MEDIA_UNSUPPORTED', '音频生成请使用项目创作或画布入口。');
        if (Object.keys(supplied).some((id) => !slots.some((slot) => slot.id === id)))
          fail(400, 'REFERENCE_SLOT_UNKNOWN', '此工作流没有所选参考槽位');
        const mixed = slots.some((slot) => slot.mediaType !== 'image');
        const references = slots.length
          ? slots.flatMap((slot) => {
              const id = supplied[slot.id];
              if (!id && !slot.required) return [];
              if (!id) fail(400, 'REFERENCE_SLOT_REQUIRED', `请选择参考素材：${slot.label}`);
              return [
                {
                  slotId: slot.id,
                  mediaType: slot.mediaType,
                  ...this.referenceMedia(user, project.id, id, slot.mediaType),
                },
              ];
            })
          : undefined;
        if (shot && purpose === 'production') {
          const release = catalog && latestRelease(this.database, catalog.familyId);
          if (
            release
              ? release.action !== 'publish' || release.workflowId !== workflow.id
              : definition.reviewRequired || input.canvasShotVersion !== undefined
          )
            fail(409, 'WORKFLOW_NOT_PUBLISHED', '请选择项目当前可用的生产工作流版本');
        }
        const boundConnection = this.connection(workflow.connectionId, project.workspaceId);
        if (
          boundConnection.provider === 'modelscope' &&
          (shot || input.routing || purpose !== 'production' || input.negativePrompt?.trim())
        )
          fail(400, 'MODELSCOPE_INPUT_UNSUPPORTED', 'ModelScope 首版只接收项目文生图正向提示词');
        if (!input.routing && !boundConnection.enabled) fail(409, 'CONNECTION_DISABLED', '生成连接已停用');
        const prompt = shot
          ? this.database.db
              .select()
              .from(promptArtifacts)
              .where(and(eq(promptArtifacts.id, input.promptId!), eq(promptArtifacts.shotId, shot.id)))
              .get()
          : null;
        if (shot && !prompt) fail(404, 'NOT_FOUND', '提示词不属于当前镜头');
        if (prompt && (prompt.cardVersion !== shot!.version || prompt.projectVersion !== project.version))
          fail(409, 'PROMPT_OUTDATED', '请按当前制作卡及项目设定重新保存提示词');
        const active = shot
          ? this.database.db
              .select({ id: generationJobs.id })
              .from(generationJobs)
              .where(
                and(
                  eq(generationJobs.shotId, shot.id),
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
              .get()
          : null;
        if (active) fail(409, 'GENERATION_ACTIVE', '此镜头已有待处理任务，请先查看任务记录');
        const approvals = shot ? this.approvals(user, shot.id) : [];
        if ((workflow.capability === 'video.image_to_video') !== Boolean(input.imageVersionId))
          fail(400, 'REFERENCE_IMAGE_REQUIRED', '图生视频须选择一个项目图片版本');
        const image = input.imageVersionId
          ? this.referenceMedia(user, project.id, input.imageVersionId)
          : undefined;
        if (
          references &&
          references.reduce((total, item) => total + item.bytes, image?.bytes ?? 0) >
            referenceImagesTotalLimit
        )
          fail(400, 'REFERENCE_IMAGE_LIMIT', '参考素材与首帧总大小不能超过 64 MiB');
        const rendered = (
          prompt
            ? JSON.parse(prompt.renderedJson)
            : { positivePrompt: input.positivePrompt!, negativePrompt: input.negativePrompt ?? '' }
        ) as {
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
          projectReferences,
        );
        const id = randomUUID(),
          createdAt = now();
        const reservation = input.routing && reserveInstance(this.database, workflow, input.routing);
        const connection = reservation ? reservation.connection : boundConnection;
        const row = this.database.db
          .insert(generationJobs)
          .values({
            id,
            purpose,
            shotId,
            boardId: input.boardId,
            projectId: project.id,
            workspaceId: project.workspaceId,
            workflowId: workflow.id,
            promptId: prompt?.id,
            shotVersion: shot?.version,
            projectVersion: project.version,
            connectionVersion: connection.version,
            creatorId: user.id,
            requestKey: key,
            snapshotJson: JSON.stringify({
              boardExecution,
              promptLibrary,
              graph,
              approvals,
              image,
              ...(mixed
                ? { referenceMedia: references }
                : { referenceImages: references?.map(({ mediaType: _mediaType, ...item }) => item) }),
              ...(slots.some((slot) => slot.onMissing === 'disconnect')
                ? { optionalReferenceImages: true }
                : {}),
              ...(slots.some((slot) => slot.mediaType !== 'image' && slot.onMissing === 'disconnect')
                ? { optionalReferenceMedia: true }
                : {}),
              ...(definition.capability === 'audio.music' ? { audioOutput: true } : {}),
              ...(definition.mediaSchema?.outputs.length || definition.output.batch
                ? { extendedOutputs: true }
                : {}),
              ...(definition.output.batch ? { primaryBatch: true } : {}),
              parameterValues,
              fieldValues,
              ...(!shot ? { prompt: { ...rendered, source: input.source ?? '' } } : {}),
            }),
            state: 'queued',
            nextAt: Date.now(),
            createdAt,
            updatedAt: createdAt,
          })
          .returning()
          .get()!;
        if (input.routing && reservation) {
          this.database.db
            .insert(generationJobRoutes)
            .values({
              jobId: id,
              workspaceId: project.workspaceId,
              connectionId: connection.id,
              instanceName: connection.name,
              mode: input.routing.mode,
              poolVersion: connection.poolVersion,
              checkedAt: reservation.check.checkedAt,
            })
            .run();
        }
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
  projectJobs(user: CurrentUser, projectId: string, boardId?: string, cursor?: string, nodeId?: string) {
    const access = this.production.access(user, projectId);
    if (
      boardId &&
      !this.database.db
        .select({ id: boards.id })
        .from(boards)
        .where(and(eq(boards.id, boardId), eq(boards.projectId, projectId)))
        .get()
    )
      fail(404, 'NOT_FOUND', '画布不属于当前项目');
    const scope = and(
      eq(generationJobs.projectId, projectId),
      isNull(generationJobs.shotId),
      eq(generationJobs.purpose, 'production'),
      boardId ? eq(generationJobs.boardId, boardId) : undefined,
      nodeId
        ? sql`json_extract(${generationJobs.snapshotJson},'$.boardExecution.nodeId')=${nodeId}`
        : undefined,
    );
    const boundary = cursor
      ? this.database.db
          .select()
          .from(generationJobs)
          .where(and(scope, eq(generationJobs.id, cursor)))
          .get()
      : undefined;
    if (cursor && !boundary) fail(400, 'INVALID_CURSOR', '任务分页位置无效');
    const rows = this.database.db
      .select()
      .from(generationJobs)
      .where(
        and(
          scope,
          boundary
            ? or(
                lt(generationJobs.createdAt, boundary.createdAt),
                and(eq(generationJobs.createdAt, boundary.createdAt), lt(generationJobs.id, boundary.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(generationJobs.createdAt), desc(generationJobs.id))
      .limit(31)
      .all();
    return {
      items: rows.slice(0, 30).map((row) => this.view(row, user, access)),
      nextCursor: rows.length > 30 ? rows[29].id : null,
    };
  }
  saveCandidate(user: CurrentUser, id: string, outputId?: string) {
    return this.saveCandidates(user, id, [outputId ?? null]);
  }
  candidateFiles(user: CurrentUser, id: string, outputIds: (string | null)[]) {
    outputIds = parse(outputIdsSchema, outputIds);
    const job = this.job(id);
    this.authz.project(user, job.projectId);
    if (job.shotId || job.purpose !== 'production' || job.state !== 'completed' || !job.mediaVersionId)
      fail(409, 'CANDIDATE_NOT_READY', '请选择已完成的自由创作结果');
    const files = outputIds.map((outputId) => {
      const output = outputId
        ? this.database.db
            .select()
            .from(generationOutputs)
            .where(and(eq(generationOutputs.id, outputId), eq(generationOutputs.jobId, job.id)))
            .get()
        : undefined;
      if (outputId && !output?.mediaVersionId)
        fail(404, 'GENERATION_OUTPUT_UNAVAILABLE', '生成产物不存在或无权访问');
      const version = this.media.version(user, output?.mediaVersionId ?? job.mediaVersionId!);
      const original = this.database.db
        .select()
        .from(mediaVersions)
        .where(eq(mediaVersions.id, version.id))
        .get()!;
      if (version.projectId !== job.projectId)
        fail(404, 'GENERATION_OUTPUT_UNAVAILABLE', '生成产物不存在或无权访问');
      assertSampleAccess(this.database, user, original);
      return {
        outputId,
        label: output?.label ?? '主结果',
        role: output
          ? output.primaryIndex != null
            ? ('primary' as const)
            : output.role
          : ('primary' as const),
        index: output?.position ?? 0,
        version,
      };
    });
    return { job, files };
  }
  saveCandidates(user: CurrentUser, id: string, outputIds: (string | null)[]) {
    return this.database.db.transaction(
      () => {
        const job = this.job(id);
        this.authz.project(user, job.projectId, 'edit');
        const { files } = this.candidateFiles(user, id, outputIds);
        for (const { version } of files) {
          const saved = this.database.db
            .update(mediaAssets)
            .set({ inLibrary: true })
            .where(
              and(
                eq(mediaAssets.id, version.assetId),
                eq(mediaAssets.projectId, job.projectId),
                eq(mediaAssets.inLibrary, false),
              ),
            )
            .returning()
            .get();
          if (saved) this.audit(user, job.workspaceId, 'generation.candidate.save', job.id);
        }
        return this.view(job, user);
      },
      { behavior: 'immediate' },
    );
  }
  testJobs(user: CurrentUser, workflowId: string) {
    const workflow = this.workflow(workflowId);
    const access = this.production.access(user, workflow.projectId);
    const connection = this.connection(workflow.connectionId, workflow.workspaceId);
    const rows = this.database.db
      .select({ job: generationJobs, shotCode: shots.code })
      .from(generationJobs)
      .leftJoin(shots, eq(shots.id, generationJobs.shotId))
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
          const apiImage =
            this.connection(this.workflow(row.workflowId).connectionId).provider === 'modelscope';
          if (!row.remoteId && apiImage)
            fail(
              409,
              'SUBMISSION_UNCERTAIN',
              'ModelScope 未返回任务编号，无法安全重查。请结束跟踪后按需重新生成。',
            );
          if (row.remoteId && remoteId && row.remoteId !== remoteId)
            fail(409, 'REMOTE_ID_FIXED', '已确认的远端任务标识不可替换');
          // A null ID stays unverified. The worker checks the correlation marker.
          changes = {
            state: row.remoteId && row.resultJson && !apiImage ? 'fetching' : 'submitted',
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
