import { useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  BoardInputPort,
  BoardLayout,
  BoardNode,
  BoardResolved,
  BoardView,
} from '../../../../packages/contracts/src/board';
import { api, ApiError, CursorPage } from '../api';
import { GenerationJob } from '../components/GenerationDialog';
import { BoardCandidates } from './BoardCandidates';
import { parameterLabels } from '../components/GenerationParameters';
import { CreativeParameters } from '../workflows/CreativeParameters';
import {
  GenerationConfig,
  capabilityLabels,
  referenceMediaLabels,
  type Workflow,
  workflowEngine,
  workflowOutputType,
  matchesGenerationType,
  type GenerationEngine,
  type GenerationOutputFilter,
} from '../workflows/workflow-types';
import type { PromptDraft, LibraryRevision } from '../prompts/prompt-library-types';
import { PromptLibraryPicker } from '../prompts/PromptLibraryPicker';
import { StudioButton, StudioIcon } from '../shared/ui/StudioUI';
import '../features/canvas/studio-live-composer.css';
import { GenerationTypePicker } from '../workflows/GenerationTypePicker';
import type { MediaVersion } from '../media-types';

export function BoardExecutionPanel({
  board,
  userId,
  node,
  layout,
  resolved,
  editable,
  dirty,
  save,
  onPromptChange,
  onPromptLibrary,
  onApplyPrompt,
  onSavedToLibrary,
  onPinMedia,
  update,
  bind,
  onResult,
  onOpenTasks,
  onDismiss,
  onWorkflow,
  children,
}: {
  board: BoardView;
  userId: string;
  node: BoardNode;
  layout: BoardLayout;
  resolved: Record<string, BoardResolved>;
  editable: boolean;
  dirty: boolean;
  save?: () => Promise<number | undefined>;
  onPromptChange: (draft: PromptDraft) => void;
  onPromptLibrary: (draft?: PromptDraft) => void;
  onApplyPrompt: (revision: LibraryRevision) => void;
  onSavedToLibrary: () => void;
  onPinMedia?: (media: MediaVersion) => Promise<void>;
  update: (node: BoardNode, clearFirstFrame?: boolean) => void;
  bind: (port: BoardInputPort, source: string) => void;
  onResult: (job: GenerationJob, grouped?: boolean) => void;
  onOpenTasks: () => void;
  onDismiss: () => void;
  onWorkflow: (nodeId: string, workflow: Workflow | undefined, latestState?: string) => void;
  children: ReactNode;
}) {
  const [config, setConfig] = useState<GenerationConfig>(),
    [jobs, setJobs] = useState<CursorPage<GenerationJob>>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [showPrompts, setShowPrompts] = useState(false);
  const [pinned, setPinned] = useState<Workflow>();
  const [choice, setChoice] = useState<{
    workflowId?: string;
    engine: GenerationEngine;
    output: GenerationOutputFilter;
  }>();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [mode, setMode] = useState<'auto' | 'manual'>('auto'),
    [instance, setInstance] = useState(''),
    [instances, setInstances] = useState<{ id: string; name: string; available: boolean }[]>([]);
  const attempt = useRef({ body: '', key: '' }),
    expanded = useRef(false),
    candidates = useRef<HTMLElement>(null),
    attemptKey = `pullet.board.run.${userId}.${board.id}.${node.id}`,
    settings = node.data.generation ?? {},
    listed = config?.workflows.find((w) => w.id === settings.workflowId),
    workflow = listed ?? (pinned?.id === settings.workflowId ? pinned : undefined),
    selection = choice?.workflowId === settings.workflowId ? choice : undefined,
    engine = selection?.engine ?? workflowEngine(workflow),
    output = selection?.output ?? workflowOutputType(workflow) ?? settings.creationTarget ?? 'image',
    apiImage = workflow?.provider === 'modelscope',
    poolConfigured =
      (!!config?.poolConfigured || workflow?.defaultRouting === 'auto') &&
      workflow?.defaultRouting !== 'fixed' &&
      engine !== 'api',
    path = `/boards/${board.id}/nodes/${node.id}/generation-jobs`;
  const workflows = [
    ...(config?.workflows ?? []),
    ...(pinned && !config?.workflows.some((w) => w.id === pinned.id) ? [pinned] : []),
  ];
  const visibleWorkflows = workflows.filter(
    (w) => !w.archived && matchesGenerationType(w, engine, engine === 'comfyui' ? 'all' : output),
  );
  function confirmChange() {
    const hasMedia = layout.edges.some(
      (edge) => edge.target === node.id && edge.kind === 'input_binding' && edge.targetPort !== 'prompt',
    );
    return (
      !(
        settings.workflowId &&
        (hasMedia ||
          Object.keys(settings.parameterValues ?? {}).length ||
          Object.keys(settings.fieldValues ?? {}).length)
      ) || window.confirm('切换将清除当前工作流的参数和素材绑定，保留提示词和原素材。继续吗？')
    );
  }
  function selectWorkflow(id: string) {
    if (id === settings.workflowId || !confirmChange()) return;
    const next = workflows.find((w) => w.id === id);
    setChoice({
      workflowId: id || undefined,
      engine: next ? workflowEngine(next) : engine,
      output: workflowOutputType(next) ?? output,
    });
    update(
      {
        ...node,
        data: {
          ...node.data,
          generation: {
            ...(id ? { workflowId: id } : {}),
            creationTarget: workflowOutputType(next) ?? settings.creationTarget,
          },
        },
      },
      next?.capability !== 'video.image_to_video',
    );
  }
  function selectOutput(next: GenerationOutputFilter) {
    const clear = workflow
      ? !matchesGenerationType(workflow, engine, next)
      : Boolean(firstFrame && next !== 'all' && next !== 'video');
    if (clear && !confirmChange()) return;
    setChoice({ workflowId: clear ? undefined : settings.workflowId, engine, output: next });
    if (next !== 'all')
      update(
        { ...node, data: { ...node.data, generation: { ...(clear ? {} : settings), creationTarget: next } } },
        clear,
      );
  }
  async function selectEngine(next: GenerationEngine) {
    if (next === engine || !confirmChange()) return;
    if (next === 'comfyui') {
      setChoice({ engine: next, output });
      update(
        { ...node, data: { ...node.data, generation: { creationTarget: settings.creationTarget } } },
        true,
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      const { id } = await api<{ id: string }>(`/projects/${board.projectId}/modelscope-generation`, 'POST');
      const value = await api<GenerationConfig>(
        `/projects/${board.projectId}/generation-config?workflowId=${id}`,
      );
      if (!alive.current) return;
      if (!value.pinnedWorkflow) throw new Error('API 模型配置暂不可用，请重试。');
      setPinned(value.pinnedWorkflow);
      setChoice({ workflowId: id, engine: next, output: 'image' });
      update(
        { ...node, data: { ...node.data, generation: { workflowId: id, creationTarget: 'image' } } },
        true,
      );
    } catch (reason) {
      if (alive.current) report(reason);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function report(reason: unknown) {
    setError(reason instanceof Error ? reason.message : '无法读取生成任务');
    if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) {
      setJobs(undefined);
      setConfig(undefined);
    }
  }
  async function load() {
    const list = await api<CursorPage<GenerationJob>>(path);
    setJobs((old) => ({
      ...list,
      items: [
        ...list.items,
        ...(old?.items ?? []).filter((item) => !list.items.some((row) => row.id === item.id)),
      ],
      nextCursor: expanded.current ? (old?.nextCursor ?? null) : list.nextCursor,
    }));
  }
  useEffect(() => {
    let active = true,
      running = false;
    void Promise.all([
      api<GenerationConfig>(`/projects/${board.projectId}/generation-config`),
      api<CursorPage<GenerationJob>>(path),
    ])
      .then(([c, j]) => {
        if (active) {
          setConfig(c);
          setJobs(j);
        }
      })
      .catch((e) => {
        if (active) report(e);
      });
    const timer = setInterval(() => {
      if (running) return;
      running = true;
      void api<CursorPage<GenerationJob>>(path)
        .then((j) => {
          if (active)
            setJobs((old) => ({
              ...j,
              items: [
                ...j.items,
                ...(old?.items ?? []).filter((item) => !j.items.some((row) => row.id === item.id)),
              ],
              nextCursor: expanded.current ? (old?.nextCursor ?? null) : j.nextCursor,
            }));
        })
        .catch((e) => {
          if (active) report(e);
        })
        .finally(() => {
          running = false;
        });
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [path, board.projectId]);
  useEffect(() => {
    if (!config || listed || !settings.workflowId) return;
    let active = true;
    void api<GenerationConfig>(
      `/projects/${board.projectId}/generation-config?workflowId=${settings.workflowId}`,
    )
      .then((value) => {
        if (active) setPinned(value.pinnedWorkflow);
      })
      .catch((reason) => {
        if (active) report(reason);
      });
    return () => {
      active = false;
    };
  }, [config, listed, settings.workflowId, board.projectId]);
  useEffect(() => {
    let active = true;
    setInstances([]);
    setInstance('');
    if (poolConfigured && workflow && settings.workflowId)
      void api<{ items: { id: string; name: string; available: boolean }[] }>(
        `/generation-workflows/${settings.workflowId}/routing-options?context=exploration`,
      )
        .then((value) => {
          if (active) setInstances(value.items);
        })
        .catch((e) => {
          if (active) report(e);
        });
    return () => {
      active = false;
    };
  }, [poolConfigured, workflow, settings.workflowId]);
  const source = (port: BoardInputPort) =>
    layout.edges.find((e) => e.kind === 'input_binding' && e.target === node.id && e.targetPort === port)
      ?.source ?? '';
  const firstFrame = source('first_frame');
  const promptNode = layout.nodes.find((item) => item.id === source('prompt'));
  const prompt = promptNode?.data;
  const text = prompt?.text?.trim();
  const needsFrame = workflow?.capability === 'video.image_to_video';
  const frame = resolved[firstFrame];
  const referenceNodes = layout.nodes.filter(
    (n) =>
      (n.type === 'result' || (n.type === 'reference' && n.data.ref?.kind === 'media')) &&
      resolved[n.id]?.media &&
      resolved[n.id]?.status !== 'unavailable',
  );
  const imageNodes = referenceNodes.filter((n) => resolved[n.id]?.media?.mediaType === 'image');
  const referenceSlots = workflow?.executable === true ? (workflow.mediaSchema?.inputs ?? []) : [];
  useEffect(() => {
    onWorkflow(node.id, workflow, jobs?.items[0]?.state);
  }, [node.id, workflow, jobs?.items[0]?.state, onWorkflow]);
  const missingSlot = referenceSlots.find((slot) => {
    const selected = source(`reference:${slot.id}`);
    return (
      (slot.required || selected) &&
      !referenceNodes.some(
        (item) => item.id === selected && resolved[item.id]?.media?.mediaType === slot.mediaType,
      )
    );
  });
  let blocked = '';
  if (!config) blocked = error ? '工作流暂不可用。' : '正在读取工作流与权限…';
  else if (!editable || !config.canEdit) blocked = '此节点为只读。';
  else if (workflow?.executable === false)
    blocked = workflow.executionBlocker ?? '此工作流的媒体执行尚未接通。';
  else if (!workflow || workflow.archived || (!workflow.enabled && !poolConfigured))
    blocked = '选择一个可用工作流。';
  else if (needsFrame && frame?.media?.mediaType !== 'image') blocked = '图生视频需要选择一张首帧。';
  else if (!needsFrame && firstFrame) blocked = '当前工作流没有首帧槽位，请移除首帧。';
  else if (missingSlot)
    blocked = `请选择参考${referenceMediaLabels[missingSlot.mediaType]}：${missingSlot.label}`;
  else if (!text) blocked = '填写提示词或连接文字节点。';
  else if (apiImage && prompt?.prompt?.negativePrompt?.trim()) blocked = '当前 API 模型仅支持正向提示词。';
  else if (poolConfigured && mode === 'manual' && !instance) blocked = '选择一台可用实例。';
  else if (dirty && !save) blocked = '填写画布名称后才能保存并生成。';
  const fieldOverrides = Object.fromEntries(
    Object.entries(settings.fieldValues ?? {}).map(([id, value]) => [
      id,
      typeof value === 'boolean' ? value : String(value),
    ]),
  );
  return (
    <section className="v2-live-composer" aria-label="生成节点设置">
      <header className="v2-live-composer-header">
        <span className="v2-live-composer-mark">
          <StudioIcon
            name={
              ({ image: 'image', video: 'film', audio: 'audio' } as const)[
                workflowOutputType(workflow) ?? settings.creationTarget ?? 'image'
              ]
            }
          />
        </span>
        <div>
          <h3>
            {workflow?.name ??
              `${({ image: '图片', video: '视频', audio: '音频' } as const)[settings.creationTarget ?? 'image']}创作`}
          </h3>
          <p>{workflow ? capabilityLabels[workflow.capability] : '选择工作流后开始创作'}</p>
        </div>
        <div className="v2-live-inline v2-live-composer-header-actions">
          {!!jobs?.items.length && (
            <StudioButton
              variant="ghost"
              icon="clock"
              onClick={() => {
                candidates.current?.scrollIntoView({ block: 'start' });
                candidates.current?.focus({ preventScroll: true });
              }}
            >
              本节点任务
            </StudioButton>
          )}
          <StudioButton
            variant="ghost"
            icon="close"
            aria-label="关闭节点面板"
            title="关闭节点面板"
            onClick={onDismiss}
          />
        </div>
      </header>
      <div className="v2-live-composer-body">
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        <fieldset className="plain-fieldset" disabled={!editable || busy || !config?.canEdit}>
          <GenerationTypePicker
            engine={engine}
            output={output}
            onEngine={(next) => void selectEngine(next)}
            onOutput={selectOutput}
            empty={Boolean(config && !visibleWorkflows.length && !workflow)}
          />
          <label>
            {engine === 'api' ? 'API 模型' : '节点工作流'}
            <select
              aria-label="节点工作流"
              value={settings.workflowId ?? ''}
              onChange={(e) => selectWorkflow(e.target.value)}
            >
              <option value="">{engine === 'api' ? '选择 API 模型' : '选择已保存工作流'}</option>
              {settings.workflowId && !visibleWorkflows.some((w) => w.id === settings.workflowId) && (
                <option value={settings.workflowId}>
                  {workflow && !workflow.archived
                    ? `${workflow.name} · 固定 v${workflow.revision ?? 1}`
                    : '固定工作流不可用'}
                </option>
              )}
              {visibleWorkflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name} · {config?.workflows.some((item) => item.id === w.id) ? 'v' : '固定 v'}
                  {w.revision ?? 1} · {capabilityLabels[w.capability]}
                  {!w.enabled ? ' · 连接停用' : ''}
                </option>
              ))}
            </select>
          </label>
          {(needsFrame || firstFrame) && (
            <div className="v2-live-frame-row">
              {frame?.media?.mediaType === 'image' && (
                <div className="creative-frame-chip">
                  <img src={frame.media.contentUrl} alt="" loading="lazy" />
                  <div>
                    <small>首帧参考</small>
                    <strong>{frame.title}</strong>
                  </div>
                  <StudioButton
                    icon="close"
                    variant="ghost"
                    aria-label="移除首帧"
                    title="移除首帧"
                    onClick={() => bind('first_frame', '')}
                  />
                </div>
              )}
              <label>
                {frame?.media?.mediaType === 'image' ? '更换首帧' : '首帧输入'}
                <select
                  aria-label="节点首帧输入"
                  value={firstFrame}
                  onChange={(e) => bind('first_frame', e.target.value)}
                >
                  <option value="">不连接首帧</option>
                  {firstFrame && frame?.media?.mediaType !== 'image' && (
                    <option value={firstFrame}>当前首帧不可用</option>
                  )}
                  {imageNodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {resolved[n.id]?.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {referenceSlots.length > 0 && (
            <section className="v2-live-reference-slots" aria-label="节点参考素材">
              <strong>参考素材</strong>

              {referenceSlots.map((slot, index) => {
                const port = `reference:${slot.id}` as const;
                const selected = source(port);
                const candidates = referenceNodes.filter(
                  (item) => resolved[item.id]?.media?.mediaType === slot.mediaType,
                );
                const media = candidates.some((item) => item.id === selected)
                  ? resolved[selected]?.media
                  : undefined;
                const poster =
                  media?.posterUrl ?? (slot.mediaType === 'image' ? media?.contentUrl : undefined);
                const label = referenceMediaLabels[slot.mediaType];
                return (
                  <div className="creative-frame-chip" key={slot.id}>
                    {poster && <img src={poster} alt="" loading="lazy" />}
                    <label>
                      {index + 1} · {slot.label}
                      {!slot.required && ' · 可选'}
                      <select
                        aria-label={`节点参考${label} ${index + 1}：${slot.label}`}
                        value={selected}
                        onChange={(event) => bind(port, event.target.value)}
                      >
                        <option value="">{slot.required ? `选择画布${label}` : `不使用参考${label}`}</option>
                        {selected && !media && <option value={selected}>当前{label}不可用</option>}
                        {candidates.map((item) => (
                          <option key={item.id} value={item.id}>
                            {resolved[item.id]?.title} · v{resolved[item.id]?.version ?? 1}
                          </option>
                        ))}
                      </select>
                    </label>
                    {selected && (
                      <StudioButton
                        icon="close"
                        variant="ghost"
                        aria-label={`断开参考${label} ${index + 1}：${slot.label}`}
                        title={`断开${slot.label}`}
                        onClick={() => bind(port, '')}
                      />
                    )}
                  </div>
                );
              })}
            </section>
          )}
          <div className="v2-live-prompt">
            <label>
              提示词
              <textarea
                aria-label="生成提示词"
                rows={3}
                maxLength={promptNode?.type === 'brief' ? 4000 : 16000}
                value={prompt?.text ?? ''}
                placeholder={
                  workflow?.capability === 'audio.music'
                    ? '描述音乐风格、节奏、乐器与氛围…'
                    : '描述画面、动作或镜头如何变化…'
                }
                onChange={(event) =>
                  onPromptChange({
                    positivePrompt: event.target.value,
                    negativePrompt: prompt?.prompt?.negativePrompt,
                    source: prompt?.prompt?.source,
                  })
                }
              />
            </label>
            <div className="v2-live-inline">
              <StudioButton
                variant="ghost"
                icon="book"
                aria-expanded={showPrompts}
                onClick={() => setShowPrompts((value) => !value)}
              >
                应用提示词库
              </StudioButton>
              {text && (
                <StudioButton
                  variant="ghost"
                  onClick={() => onPromptLibrary({ positivePrompt: prompt?.text ?? '', ...prompt?.prompt })}
                >
                  存入提示词库
                </StudioButton>
              )}
            </div>
          </div>
          {showPrompts && (
            <PromptLibraryPicker
              projectId={board.projectId}
              editable={editable}
              onApply={onApplyPrompt}
              onManage={() => onPromptLibrary()}
              onClose={() => setShowPrompts(false)}
            />
          )}
          {workflow?.parameters.length || workflow?.fields?.length ? (
            <section className="v2-common-parameters" aria-label="常用生成参数">
              <span className="v2-common-parameters-label">生成参数</span>{' '}
              {workflow?.parameters.map((p) => (
                <label key={p.key}>
                  {p.key === 'seed' ? '随机种子' : parameterLabels[p.key]}
                  {p.key === 'aspectRatio' ? (
                    <select
                      aria-label={`节点${parameterLabels[p.key]}`}
                      value={String(settings.parameterValues?.[p.key] ?? p.defaultValue)}
                      onChange={(e) =>
                        update({
                          ...node,
                          data: {
                            generation: {
                              ...settings,
                              parameterValues: { ...settings.parameterValues, [p.key]: e.target.value },
                            },
                          },
                        })
                      }
                    >
                      {p.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      aria-label={`节点${parameterLabels[p.key]}`}
                      type="number"
                      min={p.min}
                      max={p.max}
                      step={p.step}
                      value={settings.parameterValues?.[p.key] ?? p.defaultValue}
                      onChange={(e) =>
                        update({
                          ...node,
                          data: {
                            generation: {
                              ...settings,
                              parameterValues: {
                                ...settings.parameterValues,
                                [p.key]: Number(e.target.value),
                              },
                            },
                          },
                        })
                      }
                    />
                  )}
                </label>
              ))}
              <CreativeParameters
                fields={workflow?.fields ?? []}
                overrides={fieldOverrides}
                change={(id, value) => {
                  const field = workflow?.fields?.find((f) => f.id === id);
                  update({
                    ...node,
                    data: {
                      generation: {
                        ...settings,
                        fieldValues: {
                          ...settings.fieldValues,
                          [id]: field?.type === 'number' ? Number(value) : value,
                        },
                      },
                    },
                  });
                }}
              />
            </section>
          ) : null}
          <details className="creative-advanced">
            <summary>
              <StudioIcon name="sliders" size={16} />
              <span>输入绑定与参数</span>
              <StudioIcon name="chevron" size={15} />
            </summary>
            <label>
              负向提示词
              <textarea
                rows={2}
                maxLength={16000}
                value={prompt?.prompt?.negativePrompt ?? ''}
                onChange={(event) =>
                  onPromptChange({
                    positivePrompt: prompt?.text ?? '',
                    negativePrompt: event.target.value,
                    source: prompt?.prompt?.source,
                  })
                }
              />
            </label>
            <label>
              提示词输入
              <select
                aria-label="节点提示词输入"
                value={source('prompt')}
                onChange={(e) => bind('prompt', e.target.value)}
              >
                <option value="">连接文字节点</option>
                {layout.nodes
                  .filter((n) => n.type === 'note' || n.type === 'brief')
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.data.text?.slice(0, 50) || '空文字'}
                    </option>
                  ))}
              </select>
            </label>
            {workflow?.defaultRouting === 'fixed' && <p className="field-hint">运行实例：工作流指定实例</p>}
            {poolConfigured && editable && (
              <div>
                <label>
                  节点调度
                  <select
                    aria-label="节点调度"
                    value={mode}
                    onChange={(e) => setMode(e.target.value as 'auto' | 'manual')}
                  >
                    <option value="auto">自动选机</option>
                    <option value="manual">手动指定</option>
                  </select>
                </label>
                {mode === 'manual' && (
                  <label>
                    节点实例
                    <select
                      aria-label="节点实例"
                      value={instance}
                      onChange={(e) => setInstance(e.target.value)}
                    >
                      <option value="">选择可用实例</option>
                      {instances.map((i) => (
                        <option key={i.id} value={i.id} disabled={!i.available}>
                          {i.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            )}
          </details>
        </fieldset>
        {children}
        {jobs && (jobs.items.length > 0 || jobs.nextCursor) ? (
          <section className="v2-live-candidates" aria-label="节点任务与候选" ref={candidates} tabIndex={-1}>
            <BoardCandidates
              jobs={jobs}
              layout={layout}
              editable={editable}
              busy={busy}
              onResult={onResult}
              onMediaSaved={onSavedToLibrary}
              onPinMedia={onPinMedia}
              onLibrarySaved={(saved) => {
                setJobs(
                  (value) =>
                    value && {
                      ...value,
                      items: value.items.map((item) => (item.id === saved.id ? saved : item)),
                    },
                );
                onSavedToLibrary();
              }}
              onReuse={(job) => {
                if (!editable || !job.prompt) return;
                onPromptChange({ ...job.prompt, promptLibraryRevisionId: job.promptLibrary?.revisionId });
              }}
              onArchive={(job) => {
                if (!editable || busy) return;
                setBusy(true);
                setError('');
                void api<GenerationJob>(`/generation-jobs/${job.id}/save-to-library`, 'POST', {
                  outputId: job.selectedOutputId,
                })
                  .then((saved) => {
                    setJobs(
                      (value) =>
                        value && {
                          ...value,
                          items: value.items.map((item) => (item.id === saved.id ? saved : item)),
                        },
                    );
                    onSavedToLibrary();
                  })
                  .catch(report)
                  .finally(() => setBusy(false));
              }}
              onMore={() => {
                if (busy || !jobs.nextCursor) return;
                setBusy(true);
                void api<CursorPage<GenerationJob>>(`${path}?cursor=${jobs.nextCursor}`)
                  .then((more) => {
                    expanded.current = true;
                    setJobs((old) => ({
                      ...more,
                      items: [
                        ...(old?.items ?? []),
                        ...more.items.filter((item) => !old?.items.some((row) => row.id === item.id)),
                      ],
                    }));
                  })
                  .catch(report)
                  .finally(() => setBusy(false));
              }}
            />
          </section>
        ) : null}
      </div>
      <footer className="v2-live-composer-footer">
        <div className="v2-live-composer-status">
          {busy ? (
            <span role="status">正在处理…</span>
          ) : (
            blocked || (dirty ? '提交前保存当前画布' : '使用已保存的画布版本')
          )}
        </div>
        <div className="v2-live-inline">
          <StudioButton variant="ghost" icon="clock" onClick={onOpenTasks}>
            查看任务与候选
          </StudioButton>
          <StudioButton
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setError('');
              void load().catch(report);
            }}
          >
            刷新节点任务
          </StudioButton>
          {editable && (
            <StudioButton
              variant="primary"
              icon="spark"
              disabled={busy || Boolean(blocked)}
              onClick={async () => {
                setBusy(true);
                setError('');
                const revision = dirty ? await save?.() : board.revision;
                if (revision === undefined) {
                  setBusy(false);
                  return;
                }
                const body = {
                    expectedRevision: revision,
                    confirmed: true,
                    ...(poolConfigured
                      ? { routing: mode === 'auto' ? { mode } : { mode, connectionId: instance } }
                      : {}),
                  },
                  serialized = JSON.stringify(body);
                if (attempt.current.body !== serialized) {
                  let pendingKey = '';
                  try {
                    const stored = JSON.parse(sessionStorage.getItem(attemptKey) ?? 'null');
                    if (stored?.body === serialized && typeof stored.key === 'string')
                      pendingKey = stored.key;
                  } catch {
                    // The current tab can still retry using the in-memory key.
                  }
                  attempt.current = { body: serialized, key: pendingKey || crypto.randomUUID() };
                  try {
                    sessionStorage.setItem(attemptKey, JSON.stringify(attempt.current));
                  } catch {
                    // Browser storage is optional.
                  }
                }
                void api<GenerationJob>(path, 'POST', body, { 'Idempotency-Key': attempt.current.key })
                  .then(async () => {
                    await load();
                    attempt.current = { body: '', key: '' };
                    try {
                      sessionStorage.removeItem(attemptKey);
                    } catch {
                      // The task already exists in the server history.
                    }
                  })
                  .catch(report)
                  .finally(() => setBusy(false));
              }}
            >
              {dirty ? '保存并生成' : '执行生成节点'}
            </StudioButton>
          )}
        </div>
      </footer>
    </section>
  );
}
