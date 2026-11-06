import { useEffect, useRef, useState } from 'react';
import { api, CursorPage } from '../api';
import { Dialog } from './Dialog';
import { ParameterValues, parameterLabels, describeParameters } from './GenerationParameters';
import type { GenerationConfig as Config, Workflow } from '../workflows/workflow-types';
import { CreativeParameters, creativeValues } from '../workflows/CreativeParameters';
import type { MediaVersion } from '../media-types';
import { PromptLibraryDialog } from '../prompts/PromptLibraryDialog';
import type { PromptDraft } from '../prompts/prompt-library-types';
export type GenerationJob = {
  boardExecution?: import('../../../../packages/contracts/src/board').BoardExecution;
  id: string;
  shotId: string | null;
  boardId?: string | null;
  inLibrary?: boolean;
  prompt?: {
    positivePrompt: string;
    negativePrompt: string;
    source: string;
  };
  promptLibrary?: { entryId: string; revisionId: string; version: number; title: string };
  createdAt: string;
  shotCode?: string;
  evidenceCurrent?: boolean;
  state: string;
  shotVersion: number | null;
  workflowName: string;
  workflowRevision: number;
  instance: {
    id: string;
    name: string;
    mode: 'auto' | 'manual';
  } | null;
  creativeParameters: {
    label: string;
    value: string | number | boolean;
  }[];
  errorCode: string | null;
  remoteId: string | null;
  mediaVersionId: string | null;
  canControl: boolean;
  image: {
    id: string;
    fileName: string;
    version: number;
  } | null;
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
type ReferenceImage = {
  id: string;
  fileName: string;
  version: number;
  createdAt: string;
};
type InstanceOption = {
  id: string;
  name: string;
  available: boolean;
};
const capabilityLabels: Record<string, string> = {
  'image.text_to_image': '文字生图',
  'video.text_to_video': '文字生视频',
  'video.image_to_video': '图生视频',
};
export const generationStates: Record<string, string> = {
  queued: '排队中',
  preparing: '准备生成',
  submitting: '正在提交',
  submitted: '正在生成',
  fetching: '正在保存结果',
  completed: '候选已生成',
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
  GENERATION_INPUT_CHANGED: '项目或连接已变化。请按当前输入创建任务。',
  GENERATION_APPROVAL_CHANGED: '资产审批已变化。请重新核对输入。',
  ASSET_NOT_READY: '固定资产的审批或声音权限未通过。',
  CONNECTION_DISABLED: '连接已停用。',
  MEDIA_NOT_READY: '本机媒体存储或检测工具未就绪。',
  REMOTE_JOB_UNVERIFIED: '历史记录无法确认属于此任务。',
  TRACKING_STOPPED: '已结束本地跟踪。请在 ComfyUI 核对远端状态。',
  REFERENCE_IMAGE_INVALID: '首帧图片无法读取或校验，请核对项目素材。',
  COMFY_IMAGE_UPLOAD_INVALID: 'ComfyUI 返回的首帧路径不符合预期，任务未提交。',
  WORKFLOW_FIELD_BINDING_INVALID: '工作流的创作参数与当前节点声明不匹配，请管理员核对配置。',
  INSTANCE_WAITING: '所选实例达到负载阈值，任务将继续等待此实例。',
  INSTANCE_CHECK_EXPIRED: '实例检查已过期或设置已变化，请重新检查后提交。',
};
export function GenerationDialog({
  onClose,
  testWorkflow,
  creation,
}: {
  onClose: () => void;
  testWorkflow?: Workflow;
  creation: {
    projectId: string;
    boardId?: string;
    initialDraft?: PromptDraft;
    onPin?: (media: MediaVersion) => Promise<void>;
  };
}) {
  const [config, setConfig] = useState<Config>();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [positivePrompt, setPositivePrompt] = useState(creation.initialDraft?.positivePrompt ?? '');
  const [negativePrompt, setNegativePrompt] = useState(creation.initialDraft?.negativePrompt ?? '');
  const [source, setSource] = useState(creation.initialDraft?.source ?? '');
  const [libraryRevisionId, setLibraryRevisionId] = useState(creation.initialDraft?.promptLibraryRevisionId);
  const [library, setLibrary] = useState<'choose' | 'save'>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const expandedHistory = useRef(false);
  const [workflowId, setWorkflowId] = useState(testWorkflow?.id ?? '');
  const [pinnedWorkflow, setPinnedWorkflow] = useState<Workflow>();
  const [parameterOverrides, setParameterOverrides] = useState<Record<string, string>>({});
  const [fieldOverrides, setFieldOverrides] = useState<Record<string, string | boolean>>({});
  const [images, setImages] = useState<CursorPage<ReferenceImage>>();
  const [imageVersionId, setImageVersionId] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [remoteIds, setRemoteIds] = useState<Record<string, string>>({});
  const [routingMode, setRoutingMode] = useState<'auto' | 'manual'>('auto');
  const [instanceId, setInstanceId] = useState('');
  const [instanceOptions, setInstanceOptions] = useState<InstanceOption[]>();
  const [optionsError, setOptionsError] = useState('');
  const [optionsRefresh, setOptionsRefresh] = useState(0);
  const jobPath = testWorkflow
    ? `/generation-workflows/${testWorkflow.id}/test-jobs`
    : `/projects/${creation.projectId}/generation-jobs${creation.boardId ? `?boardId=${creation.boardId}` : ''}`;
  const projectPath = `/projects/${creation.projectId}`;
  const poolRouting = Boolean(config?.poolConfigured && !testWorkflow);
  const availableWorkflows = config?.workflows ?? [];
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
  const selectableWorkflows = workflows.filter((item) => (poolRouting ? !item.archived : item.enabled));
  const manualChoiceRequired = poolRouting && routingMode === 'manual' && !instanceId;
  const selectedParameters: ParameterValues = Object.fromEntries(
    (selectedWorkflow?.parameters ?? []).map((binding) => {
      const value = parameterOverrides[binding.key] ?? String(binding.defaultValue);
      return [binding.key, binding.key === 'aspectRatio' || value === '' ? value : Number(value)];
    }),
  );
  const selectedImage = images?.items.find((item) => item.id === imageVersionId);
  const canCreateJob = config?.canEdit && (!testWorkflow || config.canConfigure);
  useEffect(() => {
    let active = true;
    void Promise.all([api<Config>(`${projectPath}/generation-config`), api<Job[] | CursorPage<Job>>(jobPath)])
      .then(([settings, history]) => {
        if (active) {
          setConfig(settings);
          setJobs(Array.isArray(history) ? history : history.items);
          setNextCursor(Array.isArray(history) ? null : history.nextCursor);
        }
      })
      .catch((failure) => {
        if (active) setError(failure instanceof Error ? failure.message : '读取生成设置失败');
      });
    return () => {
      active = false;
    };
  }, [jobPath, projectPath]);
  useEffect(() => {
    if (!poolRouting || !workflowId || !canCreateJob) return;
    let active = true;
    setInstanceOptions(undefined);
    setOptionsError('');
    void api<{
      items: InstanceOption[];
    }>(`/generation-workflows/${workflowId}/routing-options?context=exploration`)
      .then((value) => {
        if (active) setInstanceOptions(value.items);
      })
      .catch((failure) => {
        if (active) setOptionsError(failure instanceof Error ? failure.message : '无法读取实例选项');
      });
    return () => {
      active = false;
    };
  }, [poolRouting, workflowId, canCreateJob, optionsRefresh]);
  useEffect(() => {
    let active = true;
    let polling = false;
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      void api<Job[] | CursorPage<Job>>(jobPath)
        .then((value) => {
          if (active) {
            if (Array.isArray(value)) setJobs(value);
            else {
              setJobs((previous) => [
                ...value.items,
                ...previous.filter((item) => !value.items.some((row) => row.id === item.id)),
              ]);
              if (!expandedHistory.current) setNextCursor(value.nextCursor);
            }
          }
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
  }, [jobPath]);
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
    setKey(crypto.randomUUID());
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
      title={testWorkflow ? '工作流试跑' : '自由生成'}
      description={
        testWorkflow
          ? '粘贴提示词试跑固定修订，结果作为独立试跑证据保存。'
          : '粘贴提示词并选择工作流，结果先保留为候选，可预览、复用或存入素材库。'
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

        {canCreateJob && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (manualChoiceRequired) return;
              void run(async () => {
                const value = await api<Job>(
                  `${projectPath}/${testWorkflow ? 'workflow-trials' : 'generation-jobs'}`,
                  'POST',
                  {
                    workflowId: testWorkflow?.id ?? workflowId,
                    positivePrompt,
                    negativePrompt,
                    source,
                    ...(libraryRevisionId ? { promptLibraryRevisionId: libraryRevisionId } : {}),
                    ...(creation.boardId && !testWorkflow ? { boardId: creation.boardId } : {}),
                    ...(poolRouting
                      ? {
                          routing:
                            routingMode === 'manual'
                              ? { mode: 'manual', connectionId: instanceId }
                              : { mode: 'auto' },
                        }
                      : {}),
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
              <div className="review-actions">
                <button type="button" onClick={() => setLibrary('choose')}>
                  从提示词库选择
                </button>
                <button type="button" disabled={!positivePrompt.trim()} onClick={() => setLibrary('save')}>
                  保存到提示词库
                </button>
              </div>
              {libraryRevisionId && (
                <p className="field-hint">已引用提示词库的固定版本；修改文字后将作为自定义提示词。</p>
              )}
              <h3>
                {testWorkflow ? `${testWorkflow.name} · v${testWorkflow.revision ?? 1}` : '新建生成任务'}
              </h3>
              {!testWorkflow && !selectableWorkflows.length && (
                <p className="field-hint">{'请在工作流中心配置或发布可用版本。'}</p>
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
                      setInstanceId('');
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
                    {selectableWorkflows.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name} · v{item.revision ?? 1} · {capabilityLabels[item.capability]} ·{' '}
                        {new Date(item.createdAt).toLocaleString()}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {poolRouting && selectedWorkflow && (
                <section aria-label="实例调度">
                  <label>
                    实例调度方式
                    <select
                      aria-label="实例调度方式"
                      value={routingMode}
                      onChange={(event) => {
                        setRoutingMode(event.target.value === 'manual' ? 'manual' : 'auto');
                        resetRequest();
                      }}
                    >
                      <option value="auto">自动选机</option>
                      <option value="manual">手动指定</option>
                    </select>
                  </label>
                  {routingMode === 'manual' && (
                    <label>
                      生成实例
                      <select
                        aria-label="生成实例"
                        value={instanceId}
                        required
                        onChange={(event) => {
                          setInstanceId(event.target.value);
                          resetRequest();
                        }}
                      >
                        <option value="">选择匹配实例</option>
                        {instanceOptions?.map((item) => (
                          <option value={item.id} key={item.id} disabled={!item.available}>
                            {item.name}
                            {item.available ? '' : ' · 暂无容量'}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {optionsError ? (
                    <p className="field-hint">{optionsError}</p>
                  ) : instanceOptions ? (
                    <p className="field-hint">
                      {instanceOptions.filter((item) => item.available).length} 个匹配实例当前可预留
                    </p>
                  ) : (
                    <p className="field-hint">正在读取实例检查结果…</p>
                  )}
                  <button type="button" onClick={() => setOptionsRefresh((value) => value + 1)}>
                    刷新实例选项
                  </button>
                </section>
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
              {
                <>
                  <label>
                    正向提示词
                    <textarea
                      aria-label="正向提示词"
                      rows={5}
                      value={positivePrompt}
                      required
                      maxLength={16000}
                      onChange={(event) => {
                        setLibraryRevisionId(undefined);
                        setPositivePrompt(event.target.value);
                        resetRequest();
                      }}
                      placeholder="描述你想生成的画面、动作与氛围"
                    />
                  </label>
                  <details>
                    <summary>负向提示词与来源（可选）</summary>
                    <label>
                      负向提示词
                      <textarea
                        aria-label="负向提示词"
                        rows={2}
                        value={negativePrompt}
                        maxLength={16000}
                        onChange={(event) => {
                          setLibraryRevisionId(undefined);
                          setNegativePrompt(event.target.value);
                          resetRequest();
                        }}
                      />
                    </label>
                    <label>
                      提示词来源
                      <input
                        aria-label="提示词来源"
                        value={source}
                        maxLength={300}
                        onChange={(event) => {
                          setLibraryRevisionId(undefined);
                          setSource(event.target.value);
                          resetRequest();
                        }}
                        placeholder="例如外部工具或创作笔记"
                      />
                    </label>
                  </details>
                </>
              }

              <button
                className="primary"
                disabled={
                  !workflowId ||
                  !positivePrompt.trim() ||
                  (needsImage && !imageVersionId) ||
                  manualChoiceRequired
                }
              >
                {testWorkflow ? '加入试跑队列' : '加入生成队列'}
              </button>
            </fieldset>
          </form>
        )}
        <h3>{testWorkflow ? '此修订的试跑任务' : '生成候选'}</h3>
        {!jobs.length && <p className="field-hint">暂无生成任务。</p>}
        {jobs.map((job) => (
          <article className="entity-reference" key={job.id}>
            <div>
              <strong>
                {job.workflowName} · 工作流 v{job.workflowRevision}
                {job.shotVersion !== null ? ` · 制作卡 v${job.shotVersion}` : ''}
              </strong>
              {job.instance && (
                <p className="field-hint">
                  实例 {job.instance.name} · {job.instance.mode === 'auto' ? '自动选机' : '手动指定'}
                </p>
              )}
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
              <p>
                {!job.shotId && job.state === 'completed'
                  ? job.inLibrary
                    ? '已存入素材库'
                    : '候选已生成'
                  : (generationStates[job.state] ?? job.state)}
              </p>
              {job.result &&
                (job.result.mediaType === 'image' ? (
                  <img
                    className="candidate-preview"
                    src={job.result.contentUrl}
                    alt="生成候选"
                    loading="lazy"
                  />
                ) : (
                  <video
                    className="candidate-preview"
                    src={job.result.contentUrl}
                    controls
                    preload="none"
                    playsInline
                  />
                ))}
              {job.promptLibrary && (
                <p className="field-hint">
                  提示词库 · {job.promptLibrary.title} · v{job.promptLibrary.version}
                </p>
              )}
              {job.prompt && (
                <details>
                  <summary>查看此次提示词</summary>
                  <p className="preserve-space">{job.prompt.positivePrompt}</p>
                  {job.prompt.negativePrompt && <p>负向：{job.prompt.negativePrompt}</p>}
                  {job.prompt.source && <p>来源：{job.prompt.source}</p>}
                </details>
              )}
              {!testWorkflow && job.state === 'completed' && (
                <div className="review-actions">
                  {!job.inLibrary && config?.canEdit && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const value = await api<Job>(
                            `/generation-jobs/${job.id}/save-to-library`,
                            'POST',
                            {},
                          );
                          setJobs((previous) =>
                            previous.map((item) => (item.id === value.id ? value : item)),
                          );
                          setMessage('已存入项目素材库。');
                        })
                      }
                    >
                      存入素材库
                    </button>
                  )}
                  {config?.canEdit && job.prompt && (
                    <button
                      disabled={busy}
                      onClick={() => {
                        setLibraryRevisionId(job.promptLibrary?.revisionId);
                        setPositivePrompt(job.prompt!.positivePrompt);
                        setNegativePrompt(job.prompt!.negativePrompt);
                        setSource(job.prompt!.source);
                        resetRequest();
                        setMessage('提示词已复用，可继续修改生成。');
                      }}
                    >
                      复用提示词
                    </button>
                  )}
                  {config?.canEdit &&
                    job.mediaVersionId &&
                    selectedWorkflow?.capability === 'video.image_to_video' &&
                    job.result?.mediaType === 'image' && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const media = await api<MediaVersion>(`/media-versions/${job.mediaVersionId}`);
                            setImages((previous) => ({
                              items: [
                                {
                                  id: media.id,
                                  fileName: media.fileName,
                                  version: media.version,
                                  createdAt: job.createdAt,
                                },
                                ...(previous?.items.filter((item) => item.id !== media.id) ?? []),
                              ],
                              nextCursor: previous?.nextCursor ?? null,
                            }));
                            setImageVersionId(media.id);
                            resetRequest();
                          })
                        }
                      >
                        用作首帧
                      </button>
                    )}
                  {creation.onPin && job.mediaVersionId && (
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await creation.onPin!(
                            await api<MediaVersion>(`/media-versions/${job.mediaVersionId}`),
                          );
                          setMessage('已添加到画布，请保存画布。');
                        })
                      }
                    >
                      添加到画布
                    </button>
                  )}
                </div>
              )}
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
        {!testWorkflow && nextCursor && (
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const more = await api<CursorPage<Job>>(
                  `${jobPath}${jobPath.includes('?') ? '&' : '?'}cursor=${nextCursor}`,
                );
                expandedHistory.current = true;
                setJobs((previous) => [
                  ...previous,
                  ...more.items.filter((item) => !previous.some((row) => row.id === item.id)),
                ]);
                setNextCursor(more.nextCursor);
              })
            }
          >
            更多生成记录
          </button>
        )}
      </div>
      <div className="dialog-footer">
        <button disabled={busy} onClick={onClose}>
          关闭
        </button>
      </div>
      {library && (
        <PromptLibraryDialog
          projectId={creation.projectId}
          initialDraft={
            library === 'save'
              ? { positivePrompt, negativePrompt, source, workflowId: workflowId || null }
              : undefined
          }
          onClose={() => setLibrary(undefined)}
          onApply={(revision) => {
            setPositivePrompt(revision.positivePrompt);
            setNegativePrompt(revision.negativePrompt);
            setSource(revision.source);
            setLibraryRevisionId(revision.id);
            if (
              revision.workflowId &&
              workflows.some((item) => item.id === revision.workflowId) &&
              !testWorkflow
            ) {
              const item = workflows.find((item) => item.id === revision.workflowId)!;
              setWorkflowId(item.id);
              setPinnedWorkflow(item);
              setParameterOverrides({});
              setFieldOverrides({});
              setImageVersionId('');
              setInstanceId('');
            }
            resetRequest();
            setLibrary(undefined);
            setMessage(`已应用 ${revision.title} · v${revision.version}`);
          }}
        />
      )}
    </Dialog>
  );
}
