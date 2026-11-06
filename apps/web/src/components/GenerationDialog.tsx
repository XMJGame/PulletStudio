import { useEffect, useState } from 'react';
import { api, CursorPage } from '../api';
import { CardEditor, PromptArtifact } from '../prompt-types';
import { Dialog } from './Dialog';
import { ParameterValues, parameterLabels, describeParameters } from './GenerationParameters';

import type { GenerationConfig as Config, Workflow } from '../workflows/workflow-types';
import { GenerationSettings } from '../workflows/GenerationSettings';
import { CreativeParameters, creativeValues } from '../workflows/CreativeParameters';

export type GenerationJob = {
  id: string;
  shotId: string;
  createdAt: string;
  shotCode?: string;
  evidenceCurrent?: boolean;
  state: string;
  shotVersion: number;
  workflowName: string;
  workflowRevision: number;
  creativeParameters: { label: string; value: string | number | boolean }[];
  errorCode: string | null;
  remoteId: string | null;
  mediaVersionId: string | null;
  canControl: boolean;
  image: { id: string; fileName: string; version: number } | null;
  parameterValues: ParameterValues;
  result: {
    mediaType: 'image' | 'video';
    contentUrl: string;
    metadata: {
      width: number | null;
      height: number | null;
      durationMs: number | null;
      frameRate: string | null;
    };
  } | null;
};
type Job = GenerationJob;
type Prompt = { id: string; createdAt: string; cardVersion: number };
type ReferenceImage = { id: string; fileName: string; version: number; createdAt: string };
const capabilityLabels: Record<string, string> = {
  'image.text_to_image': '文字生图',
  'video.text_to_video': '文字生视频',
  'video.image_to_video': '图生视频',
};
export const generationStates: Record<string, string> = {
  queued: '等待 Worker',
  preparing: '正在检查输入',
  submitting: '正在提交',
  submitted: '远端已接收，等待结果',
  fetching: '正在取回和归档',
  completed: '已归档为镜头候选',
  test_completed: '试跑证据已归档',
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
  WORKFLOW_FIELD_BINDING_INVALID: '工作流的创作参数与当前节点声明不匹配，请管理员核对配置。',
};

export function GenerationDialog({
  shotId,
  onClose,
  testWorkflow,
}: {
  shotId: string;
  onClose: () => void;
  testWorkflow?: Workflow;
}) {
  const [context, setContext] = useState<CardEditor>();
  const [config, setConfig] = useState<Config>();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [workflowId, setWorkflowId] = useState(testWorkflow?.id ?? '');
  const [pinnedWorkflow, setPinnedWorkflow] = useState<Workflow>();
  const [parameterOverrides, setParameterOverrides] = useState<Record<string, string>>({});
  const [fieldOverrides, setFieldOverrides] = useState<Record<string, string | boolean>>({});
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
  const jobPath = testWorkflow
    ? `/generation-workflows/${testWorkflow.id}/test-jobs`
    : `/shots/${shotId}/generation-jobs`;
  const projectPath = `/projects/${context?.shot.projectId}`;
  const availableWorkflows = config?.productionWorkflows ?? [];
  const selectedWorkflow =
    testWorkflow ??
    (pinnedWorkflow?.id === workflowId
      ? pinnedWorkflow
      : availableWorkflows.find((item) => item.id === workflowId));
  const workflows = [
    ...availableWorkflows,
    ...(pinnedWorkflow && !availableWorkflows.some((item) => item.id === pinnedWorkflow.id)
      ? [pinnedWorkflow]
      : []),
  ];
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
      title={testWorkflow ? '工作流试跑' : '镜头媒体生成'}
      description={
        testWorkflow
          ? '使用此镜头已保存的提示词验证固定修订。结果保存在工作流的试跑记录中。'
          : '选定工作流和提示词，结果归档后会出现在镜头素材的候选列表中。'
      }
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
        {config?.canEdit && (!testWorkflow || config.canConfigure) && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!confirmed || (testWorkflow && !preview)) return;
              void run(async () => {
                const value = await api<Job>(
                  jobPath,
                  'POST',
                  {
                    ...(testWorkflow ? { shotId } : { workflowId }),
                    promptId,
                    parameterValues: selectedParameters,
                    fieldValues: creativeValues(selectedWorkflow?.fields ?? [], fieldOverrides),
                    ...(needsImage ? { imageVersionId } : {}),
                    confirmed: true,
                  },
                  { 'Idempotency-Key': key },
                );
                setJobs((previous) => [value, ...previous.filter((item) => item.id !== value.id)]);
                resetRequest();
                setMessage(testWorkflow ? '试跑任务已加入队列。' : '生成任务已加入队列。');
              });
            }}
          >
            <fieldset className="plain-fieldset" disabled={busy}>
              <h3>
                {testWorkflow ? `${testWorkflow.name} · v${testWorkflow.revision ?? 1}` : '新建生成任务'}
              </h3>
              {!testWorkflow && !workflows.some((item) => item.enabled) && (
                <p className="field-hint">请在工作流中心配置或发布可用版本。</p>
              )}
              {!testWorkflow && (
                <label>
                  生成工作流
                  <select
                    aria-label="生成工作流"
                    value={workflowId}
                    required
                    onChange={(event) => {
                      const id = event.target.value;
                      setWorkflowId(id);
                      setPinnedWorkflow(workflows.find((item) => item.id === id));
                      setParameterOverrides({});
                      setFieldOverrides({});
                      setImageVersionId('');
                      resetRequest();
                      if (
                        workflows.find((item) => item.id === id)?.capability === 'video.image_to_video' &&
                        !images
                      )
                        void run(async () =>
                          setImages(
                            await api<CursorPage<ReferenceImage>>(`${projectPath}/generation-images`),
                          ),
                        );
                    }}
                  >
                    <option value="">选择工作流</option>
                    {workflows
                      .filter((item) => item.enabled)
                      .map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · v{item.revision ?? 1} · {capabilityLabels[item.capability]} ·{' '}
                          {new Date(item.createdAt).toLocaleString()}
                        </option>
                      ))}
                  </select>
                </label>
              )}
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
                  <CreativeParameters
                    fields={selectedWorkflow.fields ?? []}
                    overrides={fieldOverrides}
                    change={(id, value) => {
                      setFieldOverrides((current) => ({ ...current, [id]: value }));
                      resetRequest();
                    }}
                  />
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
              {testWorkflow && !prompts.some((item) => item.cardVersion === context?.shot.version) && (
                <p className="field-hint">请先为此镜头当前制作卡保存一版提示词。</p>
              )}
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
                {testWorkflow
                  ? '确认将所选输入发送到 ComfyUI 并消耗试跑资源'
                  : needsImage
                    ? '确认发送所选提示词和首帧图片到该工作流并消耗生成资源'
                    : '确认发送所选提示词到该工作流并消耗生成资源'}
              </label>
              <button
                className="primary"
                disabled={
                  !workflowId ||
                  !promptId ||
                  !confirmed ||
                  (needsImage && !imageVersionId) ||
                  Boolean(testWorkflow && !preview)
                }
              >
                {testWorkflow ? '加入试跑队列' : '加入生成队列'}
              </button>
            </fieldset>
          </form>
        )}
        <h3>{testWorkflow ? '此修订的试跑任务' : '此镜头的生成任务'}</h3>
        {!jobs.length && <p className="field-hint">暂无生成任务。</p>}
        {jobs.map((job) => (
          <article className="entity-reference" key={job.id}>
            <div>
              <strong>
                {job.workflowName} · 工作流 v{job.workflowRevision} · 制作卡 v{job.shotVersion}
              </strong>
              {job.image && (
                <p className="field-hint">
                  首帧 {job.image.fileName} · v{job.image.version}
                </p>
              )}
              {Object.keys(job.parameterValues ?? {}).length > 0 && (
                <p className="field-hint">请求参数 · {describeParameters(job.parameterValues)}</p>
              )}
              {job.creativeParameters?.map((parameter, index) => (
                <p className="field-hint" key={index}>
                  {parameter.label}：
                  {typeof parameter.value === 'boolean'
                    ? parameter.value
                      ? '开启'
                      : '关闭'
                    : String(parameter.value)}
                </p>
              ))}
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
              <p>{generationStates[job.state] ?? job.state}</p>
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
        {config && !testWorkflow && (
          <GenerationSettings
            config={config}
            projectPath={projectPath}
            busy={busy}
            run={run}
            refreshConfig={refreshConfig}
            setMessage={setMessage}
          />
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
