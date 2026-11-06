import { useEffect, useRef, useState } from 'react';
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

export function BoardExecutionPanel({
  board,
  userId,
  node,
  layout,
  resolved,
  editable,
  dirty,
  update,
  bind,
  onResult,
  onOpenTasks,
}: {
  board: BoardView;
  userId: string;
  node: BoardNode;
  layout: BoardLayout;
  resolved: Record<string, BoardResolved>;
  editable: boolean;
  dirty: boolean;
  update: (node: BoardNode) => void;
  bind: (port: 'prompt' | 'first_frame', source: string) => void;
  onResult: (job: GenerationJob) => void;
  onOpenTasks: () => void;
}) {
  const [config, setConfig] = useState<GenerationConfig>(),
    [jobs, setJobs] = useState<CursorPage<GenerationJob>>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [mode, setMode] = useState<'auto' | 'manual'>('auto'),
    [instance, setInstance] = useState(''),
    [instances, setInstances] = useState<{ id: string; name: string; available: boolean }[]>([]);
  const attempt = useRef({ body: '', key: '' }),
    expanded = useRef(false),
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
  const text = layout.nodes.find((item) => item.id === source('prompt'))?.data.text?.trim();
  const needsFrame = workflow?.capability === 'video.image_to_video';
  const ready =
    !!text &&
    !!workflow &&
    !workflow.archived &&
    (workflow.enabled || config?.poolConfigured) &&
    (needsFrame ? resolved[firstFrame]?.media?.mediaType === 'image' : !firstFrame);
  const fieldOverrides = Object.fromEntries(
    Object.entries(settings.fieldValues ?? {}).map(([id, value]) => [
      id,
      typeof value === 'boolean' ? value : String(value),
    ]),
  );
  return (
    <section aria-label="生成节点设置">
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
        <label>
          首帧输入
          <select
            aria-label="节点首帧输入"
            value={source('first_frame')}
            onChange={(e) => bind('first_frame', e.target.value)}
          >
            <option value="">不连接首帧</option>
            {firstFrame && resolved[firstFrame]?.media?.mediaType !== 'image' && (
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
        <p className="field-hint">
          选择输入与连接具名端口效果相同。图生视频需要一张首帧，文字生成请解除首帧连接。
        </p>
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
      </fieldset>
      {config?.poolConfigured && editable && (
        <fieldset className="plain-fieldset" disabled={busy}>
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
              <select aria-label="节点实例" value={instance} onChange={(e) => setInstance(e.target.value)}>
                <option value="">选择可用实例</option>
                {instances.map((i) => (
                  <option key={i.id} value={i.id} disabled={!i.available}>
                    {i.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </fieldset>
      )}
      {dirty && <p className="field-hint">请先保存画布，再执行已保存的输入。</p>}
      {editable && (
        <button
          className="primary"
          disabled={
            busy ||
            dirty ||
            !config?.canEdit ||
            !ready ||
            (config.poolConfigured && mode === 'manual' && !instance)
          }
          onClick={() => {
            const body = {
                expectedRevision: board.revision,
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
                if (stored?.body === serialized && typeof stored.key === 'string') pendingKey = stored.key;
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
            setBusy(true);
            setError('');
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
          执行生成节点
        </button>
      )}
      <button
        disabled={busy}
        onClick={() => {
          setError('');
          void load().catch(report);
        }}
      >
        刷新节点任务
      </button>
      <p className="field-hint">只执行此节点，不自动运行其他节点。每次生成保留固定画布修订与输入。</p>
      {(jobs?.items ?? []).map((job) => (
        <article className="entity-reference" key={job.id}>
          <strong>{generationStates[job.state] ?? job.state}</strong>
          <small>
            画布 v{job.boardExecution?.revision} · {new Date(job.createdAt).toLocaleString()}
          </small>
          {job.errorCode && <p role="status">生成遇到问题，请在任务与候选中查看并处理。</p>}
          {job.result &&
            (job.result.mediaType === 'image' ? (
              <img src={job.result.contentUrl} alt="节点生成结果" style={{ maxWidth: '100%' }} />
            ) : (
              <video src={job.result.contentUrl} controls preload="metadata" style={{ maxWidth: '100%' }} />
            ))}
          {editable && (
            <button
              disabled={
                busy ||
                layout.nodes.some((n) => n.type === 'result' && n.data.jobId === job.id) ||
                layout.nodes.length >= 100
              }
              onClick={() => onResult(job)}
            >
              加入画布结果
            </button>
          )}
          <button onClick={onOpenTasks}>查看任务与候选</button>
        </article>
      ))}
      {jobs?.nextCursor && (
        <button
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
        </button>
      )}
    </section>
  );
}
