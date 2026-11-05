import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { Dialog } from '../components/Dialog';
import { parameterLabels } from '../components/GenerationParameters';
import { GenerationSettings } from './GenerationSettings';
import {
  capabilityLabels,
  type GenerationConfig,
  type Workflow,
  type WorkflowEditing,
} from './workflow-types';
import { DependencyView, type Inspection } from './DependencyView';
import './workflow-center.css';
type History = {
  familyId: string;
  version: number;
  items: {
    id: string;
    revision: number;
    name: string;
    summary: string;
    createdAt: string;
    authorName: string;
    restoredFromId: string | null;
  }[];
  nextCursor: number | null;
};
export default function WorkflowCenter({
  projectId,
  onClose,
  onUnauthorized,
}: {
  projectId: string;
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const [config, setConfig] = useState<GenerationConfig>();
  const [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [leaving, setLeaving] = useState(false);
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [query, setQuery] = useState('');
  const [editing, setEditing] = useState<WorkflowEditing>(),
    [editorKey, setEditorKey] = useState(0);
  const [pending, setPending] = useState<{ id?: string; latestFamilyId?: string }>(),
    [history, setHistory] = useState<History>();
  const [restoring, setRestoring] = useState<History['items'][number]>(),
    [inspection, setInspection] = useState<Inspection>();
  const [inspectionName, setInspectionName] = useState('');
  const restoreAttempt = useState(() => ({ body: '', key: '' }))[0];
  const path = `/projects/${projectId}`;
  function report(reason: unknown) {
    if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) {
      setConfig(undefined);
      setEditing(undefined);
      setHistory(undefined);
      setInspection(undefined);
      setDirty(false);
      if (reason.status === 401) onUnauthorized();
    }
    setError(reason instanceof Error ? reason.message : '读取或保存失败，输入已保留');
  }
  async function refreshConfig() {
    setConfig(await api<GenerationConfig>(`${path}/generation-config`));
  }
  useEffect(() => {
    let live = true;
    void api<GenerationConfig>(`${path}/generation-config`)
      .then((value) => {
        if (live) setConfig(value);
      })
      .catch((reason) => {
        if (live) report(reason);
      });
    return () => {
      live = false;
    };
  }, [projectId]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  async function run(action: () => Promise<void>) {
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
  async function loadEditor(id?: string, latestFamilyId?: string) {
    const value = latestFamilyId
      ? await api<WorkflowEditing>(`/workflow-catalogs/${latestFamilyId}/definition`)
      : id
        ? await api<WorkflowEditing>(`/generation-workflows/${id}/definition`)
        : undefined;
    await refreshConfig();
    setEditing(value);
    setEditorKey((key) => key + 1);
    setDirty(false);
    setInspection(undefined);
  }
  function requestEditor(id?: string) {
    setHistory(undefined);
    if (dirty) setPending({ id });
    else void run(() => loadEditor(id));
  }
  async function openHistory(item: Workflow) {
    const current = await api<WorkflowEditing>(`/workflow-catalogs/${item.familyId}/definition`);
    const value = await api<Omit<History, 'familyId' | 'version'>>(
      `/workflow-catalogs/${item.familyId}/revisions`,
    );
    setHistory({ ...value, familyId: item.familyId!, version: current.catalog.version });
  }
  function close() {
    if (dirty) setLeaving(true);
    else onClose();
  }
  return (
    <Dialog
      title="工作流中心"
      description="管理员配置技术工作流，创作者在镜头中选择固定修订。此处不执行生成。"
      onClose={close}
      busy={busy}
      className="workflow-center-dialog"
    >
      <div className="dialog-body">
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="notice success">
            {message}
          </p>
        )}
        {!config && !error && <p role="status">正在读取项目工作流…</p>}
        <div className="workflow-center-layout">
          <section aria-label="已保存的工作流">
            <div className="section-heading">
              <h3>已保存配置</h3>
              <button disabled={busy} onClick={() => void run(refreshConfig)}>
                刷新列表
              </button>
            </div>
            <input
              aria-label="搜索工作流"
              maxLength={120}
              placeholder="搜索名称或生成方式"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {config?.canConfigure && (
              <button disabled={busy} onClick={() => requestEditor()}>
                新建工作流配置
              </button>
            )}
            <div className="workflow-saved-list">
              {config?.workflows
                .filter((item) =>
                  `${item.name} ${capabilityLabels[item.capability]}`
                    .toLowerCase()
                    .includes(query.trim().toLowerCase()),
                )
                .map((item) => (
                  <article className="panel" key={item.id}>
                    <strong>
                      {item.name} · v{item.revision ?? 1}
                    </strong>
                    <p>
                      {capabilityLabels[item.capability]} ·{' '}
                      {item.archived ? '已归档' : item.enabled ? '连接启用' : '连接已停用'}
                    </p>
                    <p className="field-hint">
                      {[
                        ...item.parameters.map((parameter) => parameterLabels[parameter.key]),
                        ...(item.fields ?? []).map((field) => field.label),
                      ].join(' · ') || '使用工作流固定参数'}{' '}
                      · {new Date(item.createdAt).toLocaleString()}
                    </p>
                    {config.canConfigure && (
                      <div className="workflow-map-actions">
                        <button disabled={busy} onClick={() => requestEditor(item.id)}>
                          查看 / 修订
                        </button>
                        <button
                          disabled={busy || !item.familyId}
                          onClick={() => void run(() => openHistory(item))}
                        >
                          修订历史
                        </button>
                        <button
                          disabled={busy || dirty || !item.familyId}
                          onClick={() =>
                            void run(async () => {
                              await api(`/workflow-catalogs/${item.familyId}`, 'PATCH', {
                                expectedVersion: item.catalogVersion,
                                archived: !item.archived,
                              });
                              await refreshConfig();
                              if (editing?.catalog.familyId === item.familyId) await loadEditor(item.id);
                              setMessage(item.archived ? '目录已取消归档' : '目录已归档，旧任务及历史保留');
                            })
                          }
                        >
                          {item.archived ? '取消归档' : '归档目录'}
                        </button>
                        <button
                          disabled={busy || !item.enabled}
                          onClick={() =>
                            void run(async () => {
                              setInspection(undefined);
                              const value = await api<Inspection>(
                                `/generation-workflows/${item.id}/inspection`,
                                'POST',
                                {},
                              );
                              setInspection(value);
                              setInspectionName(`${item.name} · 固定 v${item.revision ?? 1}`);
                            })
                          }
                        >
                          检查已保存依赖
                        </button>
                      </div>
                    )}
                  </article>
                ))}
            </div>
            {config && !config.workflows.length && (
              <p className="field-hint">
                尚无工作流配置。管理员导入API JSON并通过绑定校验后，即可在镜头生成中选择。
              </p>
            )}
            <p className="field-hint">
              修改和回滚追加新修订，历史任务保持原引用。技术校验不等于正式审批或真实生成成功。归档与历史恢复前请先保存或明确放弃当前草稿。
            </p>
          </section>
          <section aria-label="配置工作流">
            {inspection && (
              <>
                <p>{inspectionName}</p>
                <DependencyView report={inspection} />
              </>
            )}
            {config?.canConfigure ? (
              <>
                <h3>{editing ? `修订配置 · 固定 v${editing.catalog.revision}` : '新建配置'}</h3>
                {editing && (
                  <div className="workflow-editor-heading">
                    <p className="field-hint">
                      目录当前 v{editing.catalog.headRevision} · 保存基线 {editing.catalog.version}
                      {editing.catalog.archived ? ' · 目录已归档' : ''}
                    </p>
                    <button
                      disabled={busy}
                      onClick={() => {
                        if (dirty) setPending({ latestFamilyId: editing.catalog.familyId });
                        else void run(() => loadEditor(undefined, editing.catalog.familyId));
                      }}
                    >
                      载入最新配置
                    </button>
                  </div>
                )}
                <GenerationSettings
                  key={editorKey}
                  config={config}
                  projectPath={path}
                  busy={busy}
                  run={run}
                  refreshConfig={refreshConfig}
                  setMessage={setMessage}
                  expanded
                  onDraftChange={setDirty}
                  editing={editing}
                  onSaved={loadEditor}
                />
              </>
            ) : (
              config && (
                <p className="field-hint">
                  当前账户可以浏览已保存配置。连接与工作流由具有实例及工作区管理权限的管理员配置。
                </p>
              )
            )}
          </section>
        </div>
      </div>
      <div className="dialog-footer">
        <span className="field-hint">{dirty ? '有未保存的配置输入' : '生成任务仍在原镜头入口创建'}</span>
        <button disabled={busy} onClick={close}>
          关闭工作流中心
        </button>
      </div>
      {leaving && (
        <Dialog
          title="离开工作流配置"
          description="尚有未保存的配置输入，离开会丢弃当前草稿。"
          onClose={() => setLeaving(false)}
        >
          <div className="dialog-footer">
            <button onClick={() => setLeaving(false)}>继续配置</button>
            <button onClick={onClose}>丢弃输入并离开</button>
          </div>
        </Dialog>
      )}
      {pending && (
        <Dialog
          title="切换工作流配置"
          description="切换将丢弃当前未保存草稿；服务器历史修订不会删除。"
          onClose={() => setPending(undefined)}
        >
          <div className="dialog-footer">
            <button onClick={() => setPending(undefined)}>保留草稿</button>
            <button
              onClick={() => {
                const id = pending.id;
                const latestFamilyId = pending.latestFamilyId;
                setPending(undefined);
                void run(() => loadEditor(id, latestFamilyId));
              }}
            >
              丢弃草稿并切换
            </button>
          </div>
        </Dialog>
      )}
      {history && (
        <Dialog
          title="工作流修订历史"
          description="查看旧版本或恢复为新的修订，不覆盖已有定义。"
          onClose={() => setHistory(undefined)}
        >
          <div className="dialog-body workflow-history">
            {error && (
              <p role="alert" className="notice error">
                {error}
              </p>
            )}
            {history.items.map((item) => (
              <article key={item.id} className="panel">
                <strong>
                  v{item.revision} · {item.name}
                </strong>
                <p>{item.summary}</p>
                <p className="field-hint">
                  {item.authorName} · {new Date(item.createdAt).toLocaleString()}
                  {item.restoredFromId ? ' · 从历史恢复' : ''}
                </p>
                <button disabled={busy} onClick={() => requestEditor(item.id)}>
                  查看 v{item.revision}
                </button>
                <button disabled={busy || dirty} onClick={() => setRestoring(item)}>
                  恢复 v{item.revision} 为新修订
                </button>
              </article>
            ))}
            {history.nextCursor && (
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const next = await api<Pick<History, 'items' | 'nextCursor'>>(
                      `/workflow-catalogs/${history.familyId}/revisions?before=${history.nextCursor}`,
                    );
                    setHistory(
                      (current) =>
                        current && {
                          ...current,
                          items: [...current.items, ...next.items],
                          nextCursor: next.nextCursor,
                        },
                    );
                  })
                }
              >
                更多修订
              </button>
            )}
          </div>
        </Dialog>
      )}
      {restoring && history && (
        <Dialog
          title="从历史创建新修订"
          description={`将固定v${restoring.revision}配置重新验证并追加为新版本；旧任务和历史保留。`}
          onClose={() => setRestoring(undefined)}
          busy={busy}
        >
          <div className="dialog-body">
            {error && (
              <p role="alert" className="notice error">
                {error}
              </p>
            )}
          </div>
          <div className="dialog-footer">
            <button onClick={() => setRestoring(undefined)} disabled={busy}>
              取消恢复
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const body = {
                      expectedVersion: history.version,
                      workflowId: restoring.id,
                      summary: `从修订 v${restoring.revision} 恢复`,
                    },
                    serialized = JSON.stringify({ familyId: history.familyId, ...body });
                  if (restoreAttempt.body !== serialized) {
                    restoreAttempt.body = serialized;
                    restoreAttempt.key = crypto.randomUUID();
                  }
                  const result = await api<{ id: string }>(
                    `/workflow-catalogs/${history.familyId}/restore`,
                    'POST',
                    body,
                    { 'Idempotency-Key': restoreAttempt.key },
                  );
                  await refreshConfig();
                  await loadEditor(result.id);
                  setHistory(undefined);
                  setRestoring(undefined);
                  setMessage('已从历史追加新修订');
                })
              }
            >
              确认恢复为新修订
            </button>
          </div>
        </Dialog>
      )}
    </Dialog>
  );
}
