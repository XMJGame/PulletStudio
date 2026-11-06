import { useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  BoardLayout,
  BoardNode,
  BoardResolved,
  BoardView,
} from '../../../../packages/contracts/src/board';
import { api, ApiError, CursorPage } from '../api';
import { GenerationJob, generationStates } from '../components/GenerationDialog';
import { parameterLabels } from '../components/GenerationParameters';
import { CreativeParameters } from '../workflows/CreativeParameters';
import { GenerationConfig, capabilityLabels } from '../workflows/workflow-types';
import type { PromptDraft, LibraryRevision } from '../prompts/prompt-library-types';
import { PromptLibraryPicker } from '../prompts/PromptLibraryPicker';
import { StudioButton, StudioIcon } from '../shared/ui/StudioUI';
import '../features/canvas/studio-live-composer.css';

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
  update,
  bind,
  onResult,
  onOpenTasks,
  onDismiss,
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
  update: (node: BoardNode) => void;
  bind: (port: 'prompt' | 'first_frame', source: string) => void;
  onResult: (job: GenerationJob) => void;
  onOpenTasks: () => void;
  onDismiss: () => void;
  children: ReactNode;
}) {
  const [config, setConfig] = useState<GenerationConfig>(),
    [jobs, setJobs] = useState<CursorPage<GenerationJob>>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [showPrompts, setShowPrompts] = useState(false);
  const [mode, setMode] = useState<'auto' | 'manual'>('auto'),
    [instance, setInstance] = useState(''),
    [instances, setInstances] = useState<{ id: string; name: string; available: boolean }[]>([]);
  const attempt = useRef({ body: '', key: '' }),
    expanded = useRef(false),
    candidates = useRef<HTMLElement>(null),
    attemptKey = `pullet.board.run.${userId}.${board.id}.${node.id}`,
    settings = node.data.generation ?? {},
    workflow = config?.workflows.find((w) => w.id === settings.workflowId),
    path = `/boards/${board.id}/nodes/${node.id}/generation-jobs`;
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
    let active = true;
    setInstances([]);
    setInstance('');
    if (config?.poolConfigured && settings.workflowId)
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
  }, [config?.poolConfigured, settings.workflowId]);
  const source = (port: string) =>
    layout.edges.find((e) => e.kind === 'input_binding' && e.target === node.id && e.targetPort === port)
      ?.source ?? '';
  const firstFrame = source('first_frame');
  const prompt = layout.nodes.find((item) => item.id === source('prompt'))?.data;
  const text = prompt?.text?.trim();
  const needsFrame = workflow?.capability === 'video.image_to_video';
  const frame = resolved[firstFrame];
  let blocked = '';
  if (!config) blocked = error ? '工作流暂不可用。' : '正在读取工作流与权限…';
  else if (!editable || !config.canEdit) blocked = '此节点为只读。';
  else if (!workflow || workflow.archived || (!workflow.enabled && !config.poolConfigured))
    blocked = '选择一个可用工作流。';
  else if (needsFrame && frame?.media?.mediaType !== 'image') blocked = '图生视频需要选择一张首帧。';
  else if (!needsFrame && firstFrame) blocked = '当前工作流仅使用文字，请移除首帧。';
  else if (!text) blocked = '填写提示词或连接文本便签。';
  else if (config.poolConfigured && mode === 'manual' && !instance) blocked = '选择一台可用实例。';
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
          <StudioIcon name="spark" />
        </span>
        <div>
          <h3>生成节点</h3>
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
          <label>
            节点工作流
            <select
              aria-label="节点工作流"
              value={settings.workflowId ?? ''}
              onChange={(e) =>
                update({ ...node, data: { generation: { workflowId: e.target.value || undefined } } })
              }
            >
              <option value="">选择已保存工作流</option>
              {settings.workflowId && (!workflow || workflow.archived) && (
                <option value={settings.workflowId}>固定工作流不可用</option>
              )}
              {config?.workflows
                .filter((w) => !w.archived)
                .map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} · v{w.revision ?? 1} · {capabilityLabels[w.capability]}
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
                  {layout.nodes
                    .filter(
                      (n) =>
                        (n.type === 'result' || (n.type === 'reference' && n.data.ref?.kind === 'media')) &&
                        resolved[n.id]?.media?.mediaType === 'image',
                    )
                    .map((n) => (
                      <option key={n.id} value={n.id}>
                        {resolved[n.id]?.title}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          )}
          <div className="v2-live-prompt">
            <label>
              提示词
              <textarea
                aria-label="生成提示词"
                rows={3}
                maxLength={16000}
                value={prompt?.text ?? ''}
                placeholder="描述画面、动作或镜头如何变化…"
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
                <option value="">连接文本便签</option>
                {layout.nodes
                  .filter((n) => n.type === 'note')
                  .map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.data.text?.slice(0, 50) || '空便签'}
                    </option>
                  ))}
              </select>
            </label>
            {workflow?.parameters.map((p) => (
              <label key={p.key}>
                {parameterLabels[p.key]}
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
                            parameterValues: { ...settings.parameterValues, [p.key]: Number(e.target.value) },
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
            {config?.poolConfigured && editable && (
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
            <h4>任务与候选</h4>
            {jobs.items.slice(0, 1).map(renderJob)}
            {(jobs.items.length > 1 || jobs.nextCursor) && (
              <details className="creative-advanced">
                <summary>历史任务</summary>
                {jobs.items.slice(1).map(renderJob)}
                {jobs.nextCursor && (
                  <StudioButton
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
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
                    }
                  >
                    更多节点任务
                  </StudioButton>
                )}
              </details>
            )}
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
                    ...(config?.poolConfigured
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

  function renderJob(job: GenerationJob) {
    return (
      <article className="v2-live-candidate" key={job.id}>
        <header>
          <strong data-state={job.state} aria-live="polite">
            {generationStates[job.state] ?? job.state}
          </strong>
          <small>
            画布 v{job.boardExecution?.revision} · {new Date(job.createdAt).toLocaleString()}
          </small>
        </header>
        {job.errorCode && <p role="status">生成遇到问题，请在任务与候选中查看并处理。</p>}
        {job.result &&
          (job.result.mediaType === 'image' ? (
            <img src={job.result.contentUrl} alt="节点生成结果" loading="lazy" />
          ) : (
            <video src={job.result.contentUrl} aria-label="节点生成视频" controls preload="metadata" />
          ))}
        <div className="v2-live-inline">
          {editable && (
            <StudioButton
              icon="plus"
              disabled={
                busy ||
                layout.nodes.some((n) => n.type === 'result' && n.data.jobId === job.id) ||
                layout.nodes.length >= 100
              }
              onClick={() => onResult(job)}
            >
              加入画布结果
            </StudioButton>
          )}
          {editable && job.state === 'completed' && !job.inLibrary && (
            <StudioButton
              icon="folder"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                setError('');
                void api(`/generation-jobs/${job.id}/save-to-library`, 'POST', {})
                  .then(async () => {
                    setJobs(
                      (value) =>
                        value && {
                          ...value,
                          items: value.items.map((item) =>
                            item.id === job.id ? { ...item, inLibrary: true } : item,
                          ),
                        },
                    );
                    onSavedToLibrary();
                  })
                  .catch(report)
                  .finally(() => setBusy(false));
              }}
            >
              存入素材库
            </StudioButton>
          )}
          {job.inLibrary && <small>已存入素材库</small>}
        </div>
      </article>
    );
  }
}
