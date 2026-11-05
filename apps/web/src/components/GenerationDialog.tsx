import { useEffect, useId, useMemo, useState } from 'react';
import { api, CursorPage } from '../api';
import { CardEditor, PromptArtifact } from '../prompt-types';
import { Dialog } from './Dialog';
import {
  AvailableParameter,
  ParameterValues,
  parameterLabels,
  describeParameters,
  readParameterBindings,
  WorkflowParameterFields,
} from './GenerationParameters';

type Workflow = {
  id: string;
  name: string;
  capability: string;
  enabled: boolean;
  createdAt: string;
  parameters: AvailableParameter[];
};
type Connection = { id: string; name: string; version: number; enabled: boolean };
type Config = { canConfigure: boolean; canEdit: boolean; workflows: Workflow[]; connections: Connection[] };
type Job = {
  id: string;
  state: string;
  shotVersion: number;
  workflowName: string;
  errorCode: string | null;
  remoteId: string | null;
  mediaVersionId: string | null;
  canControl: boolean;
  image: { id: string; fileName: string; version: number } | null;
  parameterValues: ParameterValues;
  result: {
    metadata: {
      width: number | null;
      height: number | null;
      durationMs: number | null;
      frameRate: string | null;
    };
  } | null;
};
type Prompt = { id: string; createdAt: string; cardVersion: number };
type ReferenceImage = { id: string; fileName: string; version: number; createdAt: string };
function readWorkflowGraph(text: string) {
  const graph: unknown = JSON.parse(text.replace(/^\uFEFF/u, ''));
  if (!graph || typeof graph !== 'object' || Array.isArray(graph)) throw new Error();
  const entries = Object.entries(graph);
  if (
    !entries.length ||
    entries.length > 200 ||
    entries.some(
      ([, node]) =>
        !node ||
        typeof node.class_type !== 'string' ||
        !node.inputs ||
        typeof node.inputs !== 'object' ||
        Array.isArray(node.inputs),
    )
  )
    throw new Error();
  return graph as Record<string, { class_type: string }>;
}
const capabilityLabels: Record<string, string> = {
  'image.text_to_image': '文字生图',
  'video.text_to_video': '文字生视频',
  'video.image_to_video': '图生视频',
};
const states: Record<string, string> = {
  queued: '等待 Worker',
  preparing: '正在检查输入',
  submitting: '正在提交',
  submitted: '远端已接收，等待结果',
  fetching: '正在取回和归档',
  completed: '已归档为镜头候选',
  failed: '任务失败',
  canceled: '已取消',
  needs_reconciliation: '需要核对',
};
const errors: Record<string, string> = {
  SUBMISSION_UNCERTAIN: '未确认远端是否收到任务。请先查远端历史。',
  COMFY_REQUEST_REJECTED: 'ComfyUI 拒绝工作流。请核对工作流、节点和输入。',
  COMFY_HISTORY_PENDING: '查询窗口内未找到已完成的远端记录。',
  COMFY_EXECUTION_FAILED: '远端执行失败。请在 ComfyUI 中查看详情。',
  COMFY_DOWNLOAD_INVALID: '远端文件无法安全下载，请核对大小及返回头。',
  WORKFLOW_OUTPUT_COUNT: '配置的输出位置必须返回一个文件。',
  WORKFLOW_OUTPUT_INVALID: '远端文件描述不符合归档要求。',
  GENERATION_INPUT_CHANGED: '镜头、项目或连接已变化。请按当前输入创建任务。',
  GENERATION_APPROVAL_CHANGED: '资产审批已变化。请重新核对输入。',
  ASSET_NOT_READY: '固定资产的审批或声音权限未通过。',
  CONNECTION_DISABLED: '连接已停用。',
  MEDIA_NOT_READY: '本机媒体存储或检测工具未就绪。',
  REMOTE_JOB_UNVERIFIED: '历史记录无法确认属于此任务。',
  TRACKING_STOPPED: '已结束本地跟踪。请在 ComfyUI 核对远端状态。',
  REFERENCE_IMAGE_INVALID: '首帧图片无法读取或校验，请核对项目素材。',
  COMFY_IMAGE_UPLOAD_INVALID: 'ComfyUI 返回的首帧路径不符合预期，任务未提交。',
};

export function GenerationDialog({ shotId, onClose }: { shotId: string; onClose: () => void }) {
  const [context, setContext] = useState<CardEditor>();
  const [config, setConfig] = useState<Config>();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [workflowId, setWorkflowId] = useState('');
  const [parameterOverrides, setParameterOverrides] = useState<Record<string, string>>({});
  const [bindingFormVersion, setBindingFormVersion] = useState(0);
  const [capability, setCapability] = useState('image.text_to_image');
  const [graphText, setGraphText] = useState('');
  const nodeListId = useId();
  const workflowNodes = useMemo(() => {
    try {
      return Object.entries(readWorkflowGraph(graphText));
    } catch {
      return [];
    }
  }, [graphText]);
  const [images, setImages] = useState<CursorPage<ReferenceImage>>();
  const [imageVersionId, setImageVersionId] = useState('');
  const [promptId, setPromptId] = useState('');
  const [preview, setPreview] = useState<PromptArtifact>();
  const [confirmed, setConfirmed] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [remoteIds, setRemoteIds] = useState<Record<string, string>>({});
  const jobPath = `/shots/${shotId}/generation-jobs`;
  const projectPath = `/projects/${context?.shot.projectId}`;
  const selectedWorkflow = config?.workflows.find((item) => item.id === workflowId);
  const needsImage = selectedWorkflow?.capability === 'video.image_to_video';
  const selectedParameters: ParameterValues = Object.fromEntries(
    (selectedWorkflow?.parameters ?? []).map((binding) => {
      const value = parameterOverrides[binding.key] ?? String(binding.defaultValue);
      return [binding.key, binding.key === 'aspectRatio' || value === '' ? value : Number(value)];
    }),
  );
  const selectedImage = images?.items.find((item) => item.id === imageVersionId);
  useEffect(() => {
    let active = true;
    void api<CardEditor>(`/shots/${shotId}/card/editor`)
      .then(async (value) => {
        const [settings, history, available] = await Promise.all([
          api<Config>(`/projects/${value.shot.projectId}/generation-config`),
          api<Job[]>(jobPath),
          api<{ items: Prompt[] }>(`/shots/${shotId}/prompts`),
        ]);
        if (active) {
          setContext(value);
          setConfig(settings);
          setJobs(history);
          setPrompts(available.items);
        }
      })
      .catch((failure) => {
        if (active) setError(failure instanceof Error ? failure.message : '读取生成设置失败');
      });
    return () => {
      active = false;
    };
  }, [shotId, jobPath]);
  useEffect(() => {
    if (!context) return;
    let active = true;
    let polling = false;
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      void api<Job[]>(jobPath)
        .then((value) => {
          if (active) setJobs(value);
        })
        .catch(() => undefined)
        .finally(() => {
          polling = false;
        });
    }, 4000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [context, jobPath]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '生成操作失败');
    } finally {
      setBusy(false);
    }
  }
  function resetRequest() {
    setConfirmed(false);
    setKey(crypto.randomUUID());
  }
  async function refreshConfig() {
    setConfig(await api<Config>(`${projectPath}/generation-config`));
  }
  async function control(job: Job, action: 'cancel' | 'reconcile' | 'stop') {
    const remoteId = remoteIds[job.id]?.trim();
    const value = await api<Job>(
      `/generation-jobs/${job.id}/${action}`,
      'POST',
      action === 'reconcile' && remoteId ? { remoteId } : {},
    );
    setJobs((previous) => previous.map((item) => (item.id === job.id ? value : item)));
  }
  return (
    <Dialog
      title="镜头媒体生成"
      description="选定工作流和提示词，结果归档后会出现在镜头素材的候选列表中。"
      busy={busy}
      onClose={onClose}
    >
      <div className="dialog-body">
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="notice success" role="status">
            {message}
          </p>
        )}
        {config?.canEdit && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!confirmed) return;
              void run(async () => {
                const value = await api<Job>(
                  jobPath,
                  'POST',
                  {
                    workflowId,
                    promptId,
                    parameterValues: selectedParameters,
                    ...(needsImage ? { imageVersionId } : {}),
                    confirmed: true,
                  },
                  { 'Idempotency-Key': key },
                );
                setJobs((previous) => [value, ...previous.filter((item) => item.id !== value.id)]);
                resetRequest();
                setMessage('生成任务已加入队列。');
              });
            }}
          >
            <fieldset className="plain-fieldset" disabled={busy}>
              <h3>新建生成任务</h3>
              {!config.workflows.some((item) => item.enabled) && (
                <p className="field-hint">请先由管理员配置并验证工作流。</p>
              )}
              <label>
                生成工作流
                <select
                  aria-label="生成工作流"
                  value={workflowId}
                  required
                  onChange={(event) => {
                    const id = event.target.value;
                    setWorkflowId(id);
                    setParameterOverrides({});
                    setImageVersionId('');
                    resetRequest();
                    if (
                      config.workflows.find((item) => item.id === id)?.capability ===
                        'video.image_to_video' &&
                      !images
                    )
                      void run(async () =>
                        setImages(await api<CursorPage<ReferenceImage>>(`${projectPath}/generation-images`)),
                      );
                  }}
                >
                  <option value="">选择工作流</option>
                  {config.workflows
                    .filter((item) => item.enabled)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · {capabilityLabels[item.capability]} ·{' '}
                        {new Date(item.createdAt).toLocaleString()}
                      </option>
                    ))}
                </select>
              </label>
              {selectedWorkflow && (
                <>
                  {(selectedWorkflow.parameters ?? []).map((binding) => (
                    <label key={binding.key}>
                      {parameterLabels[binding.key]}
                      {binding.key === 'aspectRatio' ? (
                        <select
                          aria-label="生成画幅"
                          value={parameterOverrides[binding.key] ?? String(binding.defaultValue)}
                          onChange={(event) => {
                            setParameterOverrides({
                              ...parameterOverrides,
                              [binding.key]: event.target.value,
                            });
                            resetRequest();
                          }}
                        >
                          {binding.options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          aria-label={binding.key === 'seed' ? '生成 Seed' : '生成时长（秒）'}
                          type="number"
                          required
                          min={binding.min}
                          max={binding.max}
                          step={binding.step}
                          value={parameterOverrides[binding.key] ?? String(binding.defaultValue)}
                          onChange={(event) => {
                            setParameterOverrides({
                              ...parameterOverrides,
                              [binding.key]: event.target.value,
                            });
                            resetRequest();
                          }}
                        />
                      )}
                    </label>
                  ))}
                  <p className="field-hint" aria-label="将发送的生成参数">
                    {Object.keys(selectedParameters).length
                      ? `将发送 · ${describeParameters(selectedParameters)}`
                      : '尺寸、时长和 Seed 沿用工作流配置。'}
                  </p>
                  <p className="field-hint">实际尺寸和时长以生成文件为准。</p>
                </>
              )}
              {needsImage && (
                <>
                  <label>
                    首帧图片
                    <select
                      aria-label="首帧图片"
                      required
                      value={imageVersionId}
                      onChange={(event) => {
                        setImageVersionId(event.target.value);
                        resetRequest();
                      }}
                    >
                      <option value="">选择项目图片版本</option>
                      {images?.items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.fileName} · v{item.version} · {new Date(item.createdAt).toLocaleString()}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(!images || images.nextCursor) && (
                    <button
                      type="button"
                      onClick={() =>
                        void run(async () => {
                          const cursor = images?.nextCursor;
                          const more = await api<CursorPage<ReferenceImage>>(
                            `${projectPath}/generation-images${cursor ? `?cursor=${cursor}` : ''}`,
                          );
                          setImages({ ...more, items: [...(images?.items ?? []), ...more.items] });
                        })
                      }
                    >
                      {images ? '更多图片版本' : '读取项目图片'}
                    </button>
                  )}
                  {images?.items.length === 0 && (
                    <p className="field-hint">请先导入 PNG、JPEG 或 WebP 图片，大小不超过 16 MiB。</p>
                  )}
                  {selectedImage && (
                    <div className="entity-reference">
                      <img src={`/api/v1/media-versions/${selectedImage.id}/poster`} alt="选中的首帧" />
                      <span>
                        {selectedImage.fileName} · v{selectedImage.version}
                      </span>
                    </div>
                  )}
                </>
              )}
              <label>
                已保存提示词
                <select
                  aria-label="已保存提示词"
                  value={promptId}
                  required
                  onChange={(event) => {
                    setPromptId(event.target.value);
                    setPreview(undefined);
                    resetRequest();
                  }}
                >
                  <option value="">选择当前制作卡的提示词</option>
                  {prompts
                    .filter((item) => item.cardVersion === context?.shot.version)
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        制作卡 v{item.cardVersion} · {new Date(item.createdAt).toLocaleString()}
                      </option>
                    ))}
                </select>
              </label>
              <button
                type="button"
                disabled={!promptId}
                onClick={() =>
                  void run(async () =>
                    setPreview(await api<PromptArtifact>(`/shots/${shotId}/prompts/${promptId}`)),
                  )
                }
              >
                核对提示词
              </button>
              {preview && (
                <>
                  <label>
                    正向提示词
                    <textarea
                      aria-label="正向提示词"
                      rows={4}
                      readOnly
                      value={preview.rendered.positivePrompt}
                    />
                  </label>
                  {preview.rendered.negativePrompt && (
                    <label>
                      负向提示词
                      <textarea
                        aria-label="负向提示词"
                        rows={2}
                        readOnly
                        value={preview.rendered.negativePrompt}
                      />
                    </label>
                  )}
                  {preview.freshness.reasons.map((item) => (
                    <p className="field-hint" key={item}>
                      {item}
                    </p>
                  ))}
                </>
              )}
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                {needsImage
                  ? '确认发送所选提示词和首帧图片到该工作流并消耗生成资源'
                  : '确认发送所选提示词到该工作流并消耗生成资源'}
              </label>
              <button
                className="primary"
                disabled={!workflowId || !promptId || !confirmed || (needsImage && !imageVersionId)}
              >
                加入生成队列
              </button>
            </fieldset>
          </form>
        )}
        <h3>此镜头的生成任务</h3>
        {!jobs.length && <p className="field-hint">暂无生成任务。</p>}
        {jobs.map((job) => (
          <article className="entity-reference" key={job.id}>
            <div>
              <strong>
                {job.workflowName} · 制作卡 v{job.shotVersion}
              </strong>
              {job.image && (
                <p className="field-hint">
                  首帧 {job.image.fileName} · v{job.image.version}
                </p>
              )}
              {Object.keys(job.parameterValues ?? {}).length > 0 && (
                <p className="field-hint">请求参数 · {describeParameters(job.parameterValues)}</p>
              )}
              {job.result && (
                <p className="field-hint">
                  实际产物 ·{' '}
                  {job.result.metadata.width
                    ? `${job.result.metadata.width}×${job.result.metadata.height}`
                    : ''}
                  {job.result.metadata.durationMs !== null
                    ? ` · ${(job.result.metadata.durationMs / 1000).toFixed(2)} 秒`
                    : ''}
                  {job.result.metadata.frameRate ? ` · ${job.result.metadata.frameRate} fps` : ''}
                </p>
              )}
              <p>{states[job.state] ?? job.state}</p>
              {job.errorCode && (
                <p className="field-hint">
                  {errors[job.errorCode] ?? '任务遇到问题，请核对输入、连接或文件归档。'}
                </p>
              )}
              {job.mediaVersionId && (
                <a href={`/api/v1/media-versions/${job.mediaVersionId}/content?download=1`} download>
                  下载生成原件
                </a>
              )}
            </div>
            {job.canControl && ['queued', 'preparing'].includes(job.state) && (
              <button disabled={busy} onClick={() => void run(() => control(job, 'cancel'))}>
                取消待提交任务
              </button>
            )}
            {job.canControl && job.state === 'submitted' && (
              <button
                disabled={busy}
                onClick={() => {
                  if (window.confirm('确认结束本地跟踪？远端任务可能仍在运行。'))
                    void run(() => control(job, 'stop'));
                }}
              >
                结束本地跟踪
              </button>
            )}
            {job.canControl && job.state === 'needs_reconciliation' && (
              <div>
                {!job.remoteId && (
                  <label>
                    远端任务编号（旧版 ComfyUI 可选填）
                    <input
                      value={remoteIds[job.id] ?? ''}
                      onChange={(event) => setRemoteIds({ ...remoteIds, [job.id]: event.target.value })}
                    />
                  </label>
                )}
                <div className="review-actions">
                  <button disabled={busy} onClick={() => void run(() => control(job, 'reconcile'))}>
                    查询并恢复
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm('确认结束本地跟踪？远端任务可能仍在运行。'))
                        void run(() => control(job, 'stop'));
                    }}
                  >
                    结束本地跟踪
                  </button>
                </div>
              </div>
            )}
          </article>
        ))}
        {config?.canConfigure && (
          <details>
            <summary>配置 ComfyUI 连接与工作流</summary>
            <h3>生成连接</h3>
            {config.connections.map((item) => (
              <div className="entity-reference" key={item.id}>
                <span>
                  {item.name} · {item.enabled ? '启用' : '停用'}
                </span>
                <div className="review-actions">
                  <button
                    disabled={busy || !item.enabled}
                    onClick={() =>
                      void run(async () => {
                        await api(`/generation-connections/${item.id}/test`, 'POST', {});
                        setMessage('ComfyUI 可达。');
                      })
                    }
                  >
                    测试连接
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api(`/generation-connections/${item.id}`, 'PATCH', {
                          enabled: !item.enabled,
                          expectedVersion: item.version,
                        });
                        await refreshConfig();
                      })
                    }
                  >
                    {item.enabled ? '停用' : '启用'}
                  </button>
                </div>
              </div>
            ))}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);
                void run(async () => {
                  await api(`${projectPath}/generation-connections`, 'POST', {
                    name: data.get('name'),
                    baseUrl: data.get('baseUrl'),
                    token: data.get('token'),
                    trustedPrivate: data.has('trustedPrivate'),
                  });
                  form.reset();
                  await refreshConfig();
                  setMessage('已添加生成连接。');
                });
              }}
            >
              <fieldset className="plain-fieldset" disabled={busy}>
                <label>
                  连接名称
                  <input name="name" required maxLength={120} />
                </label>
                <label>
                  ComfyUI 基础地址
                  <input name="baseUrl" type="url" placeholder="http://192.168.x.x:8188" required />
                </label>
                <label>
                  Bearer 凭据（可选）
                  <input name="token" type="password" autoComplete="off" />
                </label>
                <label className="checkbox-label">
                  <input type="checkbox" name="trustedPrivate" />
                  批准自部署 HTTP 或私有网络地址
                </label>
                <button>添加连接</button>
              </fieldset>
            </form>
            <h3>工作流</h3>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const data = new FormData(form);
                void run(async () => {
                  let graph: unknown;
                  try {
                    graph = readWorkflowGraph(graphText);
                  } catch {
                    throw new Error('请输入有效的 API 格式 JSON。');
                  }
                  const negativeNode = data.get('negativeNode'),
                    negativeInput = data.get('negativeInput');
                  if (Boolean(negativeNode) !== Boolean(negativeInput))
                    throw new Error('负向绑定须同时填写节点和输入。');
                  await api(`${projectPath}/generation-workflows`, 'POST', {
                    name: data.get('name'),
                    connectionId: data.get('connectionId'),
                    capability: data.get('capability'),
                    graph,
                    positive: { node: data.get('positiveNode'), input: data.get('positiveInput') },
                    ...(negativeNode ? { negative: { node: negativeNode, input: negativeInput } } : {}),
                    ...(data.get('capability') === 'video.image_to_video'
                      ? { image: { node: data.get('imageNode'), input: data.get('imageInput') } }
                      : {}),
                    output: { node: data.get('outputNode'), field: data.get('outputField') },
                    parameters: readParameterBindings(data),
                  });
                  form.reset();
                  setCapability('image.text_to_image');
                  setGraphText('');
                  setBindingFormVersion((value) => value + 1);
                  await refreshConfig();
                  setMessage('工作流的绑定节点已验证并保存。');
                });
              }}
            >
              <fieldset className="plain-fieldset" disabled={busy}>
                <label>
                  工作流名称
                  <input name="name" required maxLength={120} />
                </label>
                <label>
                  工作流连接
                  <select name="connectionId" required>
                    <option value="">选择连接</option>
                    {config.connections
                      .filter((item) => item.enabled)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  生成方式
                  <select
                    aria-label="生成方式"
                    name="capability"
                    value={capability}
                    onChange={(event) => setCapability(event.target.value)}
                  >
                    <option value="image.text_to_image">文字生图</option>
                    <option value="video.text_to_video">文字生视频</option>
                    <option value="video.image_to_video">图生视频</option>
                  </select>
                </label>
                {capability === 'video.image_to_video' && (
                  <div className="dialog-field-row">
                    <label>
                      首帧图片节点
                      <input name="imageNode" list={nodeListId} required />
                    </label>
                    <label>
                      首帧图片输入
                      <input name="imageInput" defaultValue="image" required />
                    </label>
                  </div>
                )}
                <label>
                  选择 API 格式 JSON 文件
                  <input
                    type="file"
                    accept=".json,application/json"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = '';
                      if (!file) return;
                      void run(async () => {
                        if (file.size > 160000) throw new Error('工作流文件不能超过 160 KB。');
                        const content = await file.text();
                        try {
                          readWorkflowGraph(content);
                        } catch {
                          throw new Error('请选择从 ComfyUI 导出的 API 格式 JSON。');
                        }
                        setGraphText(content);
                      });
                    }}
                  />
                </label>
                <label>
                  API 格式工作流 JSON
                  <textarea
                    aria-label="API 格式工作流 JSON"
                    rows={5}
                    required
                    maxLength={160000}
                    value={graphText}
                    onChange={(event) => setGraphText(event.target.value)}
                  />
                </label>
                <datalist id={nodeListId}>
                  {workflowNodes.map(([id, node]) => (
                    <option key={id} value={id} label={node.class_type} />
                  ))}
                </datalist>
                <p className="field-hint">
                  使用你已验证并信任的工作流。节点可能访问该 ComfyUI 主机上的文件或外部服务。
                </p>
                <div className="dialog-field-row">
                  <label>
                    正向文本节点
                    <input name="positiveNode" list={nodeListId} required />
                  </label>
                  <label>
                    正向文本输入
                    <input name="positiveInput" required defaultValue="text" />
                  </label>
                </div>
                <div className="dialog-field-row">
                  <label>
                    负向文本节点（可选）
                    <input name="negativeNode" list={nodeListId} />
                  </label>
                  <label>
                    负向文本输入（可选）
                    <input name="negativeInput" />
                  </label>
                </div>
                <div className="dialog-field-row">
                  <label>
                    输出节点
                    <input name="outputNode" list={nodeListId} required />
                  </label>
                  <label>
                    历史输出字段
                    <input name="outputField" required defaultValue="images" />
                  </label>
                </div>
                <WorkflowParameterFields
                  key={bindingFormVersion}
                  nodeListId={nodeListId}
                  capability={capability}
                />
                <button>验证绑定并保存</button>
              </fieldset>
            </form>
          </details>
        )}
      </div>
      <div className="dialog-footer">
        <button disabled={busy} onClick={onClose}>
          关闭
        </button>
      </div>
    </Dialog>
  );
}
