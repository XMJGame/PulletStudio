import { useEffect, useRef, useState } from 'react';
import { api, ApiError, CursorPage, Project, ScriptVersion } from '../api';
import {
  AnalysisChunk,
  AnalysisDetail,
  AnalysisRun,
  TextConnectionList,
  stateLabels,
} from '../analysis-types';
import { ProposalReviewPanel } from './ProposalReviewPanel';
import { TextConnectionsDialog } from './TextConnectionsDialog';

const activeStates = ['queued', 'preparing', 'submitted', 'retry_waiting'];
export function AnalysisWorkbench({
  project,
  workspaceId,
  canEdit,
  canManageConnections,
  instanceAdmin,
  onUnauthorized,
}: {
  project: Project;
  workspaceId: string;
  canEdit: boolean;
  canManageConnections: boolean;
  instanceAdmin: boolean;
  onUnauthorized: () => void;
}) {
  const [connections, setConnections] = useState<TextConnectionList>();
  const [showConnections, setShowConnections] = useState(false);
  const [revision, setRevision] = useState<ScriptVersion>();
  const [chunks, setChunks] = useState<AnalysisChunk[]>([]);
  const [runs, setRuns] = useState<AnalysisRun[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<AnalysisDetail>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [workerOnline, setWorkerOnline] = useState(false);
  const [retryAcknowledged, setRetryAcknowledged] = useState(false);
  const [lastSubmitted, setLastSubmitted] = useState('');
  const requestKey = useRef<{ signature: string; key: string } | undefined>(undefined);
  const detailRequest = useRef(0);
  const path = `/projects/${project.id}`;
  const options =
    connections?.items
      .filter((connection) => connection.enabled)
      .flatMap((connection) =>
        connection.profiles
          .filter((profile) => profile.enabled)
          .map((profile) => ({ ...profile, connectionName: connection.name })),
      ) || [];
  function report(reason: unknown) {
    if (reason instanceof ApiError && reason.status === 401) onUnauthorized();
    setError(reason instanceof Error ? reason.message : '读取失败');
  }
  async function refreshConnections() {
    setConnections(await api<TextConnectionList>(`/workspaces/${workspaceId}/text-connections`));
  }
  async function loadDetail(id: string) {
    const request = ++detailRequest.current;
    const value = await api<AnalysisDetail>(`/analysis-runs/${id}`);
    if (request === detailRequest.current) setDetail(value);
  }
  useEffect(() => {
    let active = true;
    void Promise.all([
      api<TextConnectionList>(`/workspaces/${workspaceId}/text-connections`),
      api<ScriptVersion>(`${path}/script`),
      api<CursorPage<AnalysisRun>>(`${path}/analysis-runs`),
      api<{ online: boolean }>(`/workspaces/${workspaceId}/analysis-status`),
    ])
      .then(async ([available, script, history, worker]) => {
        const ranges = script.version
          ? await api<{ items: AnalysisChunk[] }>(`${path}/analysis-chunks?revisionVersion=${script.version}`)
          : { items: [] };
        if (!active) return;
        setConnections(available);
        setRevision(script);
        setRuns(history.items);
        setCursor(history.nextCursor);
        setChunks(ranges.items);
        setWorkerOnline(worker.online);
        if (history.items.length)
          setSelectedId([...history.items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0].id);
      })
      .catch((reason) => {
        if (active) report(reason);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      detailRequest.current++;
    };
  }, [project.id, workspaceId]);
  useEffect(() => {
    setDetail(undefined);
    setRetryAcknowledged(false);
    if (!selectedId) return;
    void loadDetail(selectedId).catch(report);
    return () => {
      detailRequest.current++;
    };
  }, [selectedId]);
  useEffect(() => {
    let active = true,
      polling = false;
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      void Promise.all([
        api<CursorPage<AnalysisRun>>(`${path}/analysis-runs`),
        api<{ online: boolean }>(`/workspaces/${workspaceId}/analysis-status`),
        selectedId ? api<AnalysisDetail>(`/analysis-runs/${selectedId}`) : Promise.resolve(undefined),
      ])
        .then(([page, worker, current]) => {
          if (!active) return;
          setRuns((previous) => [
            ...new Map(
              [...previous, ...page.items, ...(current ? [current] : [])].map((row) => [row.id, row]),
            ).values(),
          ]);
          setWorkerOnline(worker.online);
          if (current)
            setDetail((previous) =>
              previous?.id === current.id && previous.version > current.version ? previous : current,
            );
        })
        .catch((reason) => {
          if (active) report(reason);
        })
        .finally(() => {
          polling = false;
        });
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [project.id, selectedId, workspaceId]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (reason) {
      report(reason);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="AI 分镜分析工作台">
      <div className="section-heading">
        <div>
          <span className="eyebrow">STORYBOARD ANALYSIS</span>
          <h2>AI 分镜分析</h2>
        </div>
        <button disabled={busy} onClick={() => setShowConnections(true)}>
          文本模型连接
        </button>
      </div>
      <p className="muted">
        选择已保存的原文范围进行分析，结果先保存为待审核草案。正式剧本、制作结构和镜头保持原样。
      </p>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="notice success">
          {message}
        </div>
      )}
      {loading && <p role="status">正在读取模型与剧本…</p>}
      {!loading && (
        <p className="field-hint">
          {workerOnline ? '后台分析服务在线' : '后台分析服务未在线，任务可先入队；请管理员启动分析服务。'}
        </p>
      )}
      {canEdit && revision && (
        <form
          className="panel analysis-submit"
          onSubmit={(event) => {
            event.preventDefault();
            const data = Object.fromEntries(new FormData(event.currentTarget));
            const body = {
              modelProfileId: data.modelProfileId,
              revisionVersion: revision.version,
              chunkIndex: Number(data.chunkIndex),
              contextSummary: data.contextSummary || '',
              expectedProjectVersion: project.version,
              acknowledgeExternalProcessing: true,
            };
            const signature = JSON.stringify(body);
            if (!requestKey.current || requestKey.current.signature !== signature)
              requestKey.current = { signature, key: crypto.randomUUID() };
            const key = requestKey.current.key;
            void run(async () => {
              const created = await api<AnalysisRun>(`${path}/analysis-runs`, 'POST', body, {
                'Idempotency-Key': key,
              });
              setLastSubmitted(created.id);
              setRuns((previous) => [...previous.filter((row) => row.id !== created.id), created]);
              setSelectedId(created.id);
              setMessage(
                created.state === 'queued'
                  ? '分析任务已入队；生成结果将出现在待审核草案中。'
                  : '该请求已有分析任务，已打开现有结果。',
              );
            });
          }}
        >
          <fieldset
            className="plain-fieldset"
            disabled={
              busy || !options.length || !revision.version || !chunks.some((chunk) => chunk.analyzable)
            }
          >
            <div className="dialog-field-row">
              <label>
                分析文本模型
                <select name="modelProfileId" required aria-label="分析文本模型">
                  {options.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.connectionName} / {profile.name} · {profile.model}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                分析原文范围
                <select name="chunkIndex" required aria-label="分析原文范围">
                  {chunks.map((chunk) => (
                    <option key={chunk.index} value={chunk.index} disabled={!chunk.analyzable}>
                      v{revision.version} · {chunk.startOffset}–{chunk.endOffset} · {chunk.blockCount} 段
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              本次分析上下文摘要
              <textarea
                name="contextSummary"
                rows={3}
                maxLength={2000}
                placeholder="可选：已确认的人物、场景和前情摘要。只发送你在这里填写的内容及所选原文范围。"
              />
            </label>
            <p className="field-hint">
              每次原文最多 8,000
              字符，另外包含项目格式、风格和导演设定。提交后冻结这些输入，不自动发送其他范围的正文。
            </p>
            <label className="checkbox-label">
              <input type="checkbox" required />
              确认将所选原文范围与上述设定发送至所选模型服务
            </label>
            <button className="primary">创建分镜分析任务</button>
            {lastSubmitted && (
              <button
                type="button"
                onClick={() => {
                  requestKey.current = undefined;
                  setLastSubmitted('');
                  setMessage('已准备新一轮分析；再次提交会创建新任务，可能再次计费。');
                }}
              >
                准备新一轮分析
              </button>
            )}
          </fieldset>
          {!revision.version && <p>请先在“项目剧本”保存或导入原文。</p>}
          {!options.length && <p>请管理员配置并启用文本模型连接。</p>}
        </form>
      )}
      <div className="analysis-layout">
        <aside className="panel analysis-history" aria-label="分析任务列表">
          <h3>分析任务</h3>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const page = await api<CursorPage<AnalysisRun>>(`${path}/analysis-runs`);
                setRuns(page.items);
                setCursor(page.nextCursor);
              })
            }
          >
            刷新分析任务
          </button>
          {[...runs]
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((row) => (
              <button
                key={row.id}
                aria-label={`查看分析任务 ${row.id}`}
                aria-pressed={selectedId === row.id}
                onClick={() => setSelectedId(row.id)}
              >
                <strong>{stateLabels[row.state]}</strong>
                <span>
                  v{row.revisionVersion} · 原文 {row.startOffset}–{row.endOffset}
                </span>
                <small>
                  {row.profileName} · {new Date(row.createdAt).toLocaleString('zh-CN')}
                </small>
              </button>
            ))}
          {!runs.length && <p className="field-hint">尚无分析任务。</p>}
          {cursor && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const page = await api<CursorPage<AnalysisRun>>(`${path}/analysis-runs?cursor=${cursor}`);
                  setRuns((previous) => [
                    ...new Map([...previous, ...page.items].map((row) => [row.id, row])).values(),
                  ]);
                  setCursor(page.nextCursor);
                })
              }
            >
              加载更多分析任务
            </button>
          )}
        </aside>
        <div className="analysis-result">
          {detail ? (
            <>
              <div className="section-heading">
                <h3>{stateLabels[detail.state]}</h3>
                <span className="badge">调用尝试 {detail.attempts}</span>
              </div>
              <p className="field-hint">
                {detail.connectionName} / {detail.model} · 原文 v{detail.revisionVersion} · 项目设定 v
                {detail.settings.version}
              </p>
              {detail.errorMessage && (
                <div className="notice error">
                  {detail.errorMessage}
                  {detail.attempts > 0 && (
                    <p className="field-hint">
                      请求追踪：{detail.traceId}
                      {detail.providerTaskId ? ` · 上游记录：${detail.providerTaskId}` : ''}
                    </p>
                  )}
                  {detail.state === 'retry_waiting' && (
                    <p>下次尝试不早于 {new Date(detail.nextRunAt).toLocaleString('zh-CN')}</p>
                  )}
                </div>
              )}
              {canEdit && activeStates.includes(detail.state) && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setDetail(
                        await api<AnalysisDetail>(`/analysis-runs/${detail.id}/cancel`, 'POST', {
                          expectedVersion: detail.version,
                        }),
                      );
                      setMessage('已停止跟踪；远端调用可能仍在进行。');
                    })
                  }
                >
                  停止跟踪此分析
                </button>
              )}
              {canEdit && ['failed', 'needs_reconciliation'].includes(detail.state) && (
                <div className="analysis-retry">
                  <p>请先核实远端调用状态。重新排队可能产生新的调用及费用。</p>
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={retryAcknowledged}
                      onChange={(event) => setRetryAcknowledged(event.target.checked)}
                    />
                    已核实，并接受可能的再次调用及费用
                  </label>
                  <button
                    disabled={busy || !retryAcknowledged}
                    onClick={() =>
                      void run(async () => {
                        setDetail(
                          await api<AnalysisDetail>(`/analysis-runs/${detail.id}/retry`, 'POST', {
                            expectedVersion: detail.version,
                            acknowledgePossibleCharge: true,
                          }),
                        );
                        setRetryAcknowledged(false);
                      })
                    }
                  >
                    确认重新排队
                  </button>
                </div>
              )}
              {detail.proposal && (
                <ProposalReviewPanel
                  key={detail.proposal.id}
                  incoming={detail.proposal}
                  onUnauthorized={onUnauthorized}
                  onChanged={(proposal) =>
                    setDetail((current) => (current?.id === detail.id ? { ...current, proposal } : current))
                  }
                />
              )}
            </>
          ) : (
            <p className="muted">选择任务查看进度及草案。</p>
          )}
        </div>
      </div>
      {showConnections && (
        <TextConnectionsDialog
          workspaceId={workspaceId}
          canManage={canManageConnections}
          instanceAdmin={instanceAdmin}
          onClose={() => setShowConnections(false)}
          onUnauthorized={onUnauthorized}
          onChanged={() => {
            void refreshConnections().catch(report);
          }}
        />
      )}
    </section>
  );
}
