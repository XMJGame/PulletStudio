import { useEffect, useRef, useState } from 'react';
import { api, ApiError, ScriptHistory, ScriptVersion } from '../api';
import { ScriptImportDialog } from './ScriptImportDialog';
import { ScriptSourceDialog } from './ScriptSourceDialog';

type Draft = { title: string; content: string; summary: string; baseVersion: number };
const fromVersion = (value: ScriptVersion): Draft => ({
  title: value.title,
  content: value.content,
  summary: '',
  baseVersion: value.version,
});
const timestamp = (value: string | null) => (value ? new Date(value).toLocaleString('zh-CN') : '尚未保存');

export function ScriptWorkbench({
  projectId,
  userId,
  canEdit,
  canManage,
  onUnauthorized,
}: {
  projectId: string;
  userId: string;
  canEdit: boolean;
  canManage: boolean;
  onUnauthorized: () => void;
}) {
  const [head, setHead] = useState<ScriptVersion>();
  const [draft, setDraft] = useState<Draft>();
  const [history, setHistory] = useState<ScriptHistory>({ items: [], nextCursor: null });
  const [preview, setPreview] = useState<ScriptVersion>();
  const [busy, setBusy] = useState(false);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [error, setError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const [message, setMessage] = useState('');
  const [storageError, setStorageError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [sourceRevision, setSourceRevision] = useState<ScriptVersion>();
  const previewRequest = useRef(0);
  const draftKey = `pullet.script.${userId}.${projectId}`;
  const dirty =
    !!head &&
    !!draft &&
    (draft.title !== head.title ||
      draft.content !== head.content ||
      draft.summary !== '' ||
      draft.baseVersion !== head.version);
  const path = `/projects/${projectId}/script`;
  function report(reason: unknown) {
    if (reason instanceof ApiError && reason.status === 401) onUnauthorized();
    setError(reason instanceof Error ? reason.message : '操作失败');
    setConflict(
      reason instanceof ApiError && (reason.code === 'VERSION_CONFLICT' || reason.code === 'SCRIPT_LOCKED'),
    );
  }
  useEffect(() => {
    let active = true;
    // Capture before permission/loading effects can clear an old baseline's storage entry.
    let cachedDraft: string | null = null;
    try {
      cachedDraft = sessionStorage.getItem(draftKey);
    } catch {
      setStorageError('浏览器暂存不可用，请及时保存到工作室。');
    }
    void api<ScriptVersion>(path)
      .then((value) => {
        if (!active) return;
        setHead(value);
        let savedDraft: Draft | undefined;
        try {
          const candidate = JSON.parse(cachedDraft || 'null');
          if (
            canEdit &&
            candidate &&
            typeof candidate.title === 'string' &&
            typeof candidate.content === 'string' &&
            typeof candidate.summary === 'string' &&
            Number.isInteger(candidate.baseVersion) &&
            candidate.baseVersion >= 0
          )
            savedDraft = candidate;
        } catch {
          setStorageError('浏览器暂存不可用，请及时保存到工作室。');
        }
        setDraft(savedDraft || fromVersion(value));
        if (savedDraft) setMessage('已恢复本窗口未保存的输入。');
      })
      .catch((reason) => {
        if (active) report(reason);
      });
    void api<ScriptHistory>(`${path}/versions`)
      .then((value) => {
        if (active) setHistory(value);
      })
      .catch(() => {
        if (active) setHistoryError('版本列表暂时无法加载');
      });
    return () => {
      active = false;
      previewRequest.current++;
    };
  }, [projectId, userId, canEdit]);
  useEffect(() => {
    if (!draft || !head || !canEdit) return;
    try {
      if (dirty) sessionStorage.setItem(draftKey, JSON.stringify(draft));
      else sessionStorage.removeItem(draftKey);
    } catch {
      setStorageError('浏览器暂存不可用，请及时保存到工作室。');
    }
  }, [draft, head, dirty, canEdit, draftKey]);
  useEffect(() => {
    if (!dirty) return;
    const leaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', leaving);
    return () => window.removeEventListener('beforeunload', leaving);
  }, [dirty]);
  async function refreshHistory() {
    try {
      setHistory(await api<ScriptHistory>(`${path}/versions`));
      setHistoryError('');
    } catch {
      setHistoryError('版本列表刷新失败；已保存内容不受影响，可点击刷新版本。');
    }
  }
  function adopt(value: ScriptVersion) {
    previewRequest.current++;
    setHistoryBusy(false);
    setHead(value);
    setDraft(fromVersion(value));
    setPreview(undefined);
    setConflict(false);
  }
  async function save() {
    if (!draft || busy || head?.locked) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const value = await api<ScriptVersion>(path, 'POST', {
        expectedVersion: draft.baseVersion,
        title: draft.title,
        content: draft.content,
        summary: draft.summary,
      });
      adopt(value);
      setMessage(`剧本已保存为 v${value.version}`);
      await refreshHistory();
    } catch (reason) {
      report(reason);
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      adopt(await api<ScriptVersion>(path));
      setMessage('已载入最新剧本');
      await refreshHistory();
    } catch (reason) {
      report(reason);
    } finally {
      setBusy(false);
    }
  }
  async function inspect(version: number) {
    const request = ++previewRequest.current;
    setHistoryBusy(true);
    setHistoryError('');
    try {
      const value = await api<ScriptVersion>(`${path}/versions/${version}`);
      if (request === previewRequest.current) setPreview(value);
    } catch {
      if (request === previewRequest.current) setHistoryError('无法读取该版本，请重试');
    } finally {
      if (request === previewRequest.current) setHistoryBusy(false);
    }
  }
  async function restore() {
    if (!preview || !head || busy || dirty || !canEdit || head.locked) return;
    setBusy(true);
    setError('');
    try {
      const value = await api<ScriptVersion>(`${path}/versions/${preview.version}/restore`, 'POST', {
        expectedVersion: head.version,
      });
      adopt(value);
      setMessage(`已恢复内容并保存为 v${value.version}，原版本仍然保留`);
      await refreshHistory();
    } catch (reason) {
      report(reason);
    } finally {
      setBusy(false);
    }
  }
  async function toggleLock() {
    if (!head || !canManage || busy || (dirty && !head.locked)) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api<ScriptVersion>(`${path}/${head.locked ? 'unlock' : 'lock'}`, 'POST', {
        expectedVersion: head.version,
        expectedLockVersion: head.lockVersion,
      });
      setHead(result);
      setMessage(
        result.locked
          ? '当前剧本已锁定；后续修订需要管理员明确解锁。'
          : '已解锁，可创建新修订；历史版本仍然保留。',
      );
    } catch (reason) {
      report(reason);
    } finally {
      setBusy(false);
    }
  }
  if (!draft || !head)
    return (
      <section className="panel">
        <p role={error ? 'alert' : 'status'}>{error || '正在读取项目剧本…'}</p>
        {error && <button onClick={() => void reload()}>重新加载</button>}
      </section>
    );
  return (
    <section className="script-workbench" aria-label="项目剧本工作台">
      <div className="script-header">
        <div>
          <span className="eyebrow">STORY DEVELOPMENT</span>
          <h2>
            项目剧本 <span className="badge">{head.version ? `v${head.version}` : '未保存'}</span>
          </h2>
          <p className="muted">每次保存保留独立版本，供后续分集与镜头创作参考。</p>
        </div>
        <span className={dirty ? 'draft-status unsaved' : 'draft-status'}>
          {dirty ? '有未保存修改 · 本窗口暂存' : canEdit ? '与已保存版本一致' : '只读访问'}
        </span>
      </div>
      <div className="script-tools">
        {canEdit && (
          <button disabled={busy || dirty || head.locked} onClick={() => setShowImport(true)}>
            导入剧本
          </button>
        )}
        {head.version > 0 && (
          <button disabled={busy || historyBusy} onClick={() => setSourceRevision(preview || head)}>
            查看原文与段落
          </button>
        )}
        {canManage && head.version > 0 && (
          <button disabled={busy || (dirty && !head.locked)} onClick={() => void toggleLock()}>
            {head.locked ? '解锁以继续修订' : '锁定当前版本'}
          </button>
        )}
        {head.locked ? (
          <span className="badge">当前定稿已锁定</span>
        ) : dirty && canEdit ? (
          <span className="field-hint">请先保存当前修改，再导入或锁定。</span>
        ) : null}
      </div>
      {showImport && (
        <ScriptImportDialog
          projectId={projectId}
          baseline={head}
          onClose={() => setShowImport(false)}
          onUnauthorized={onUnauthorized}
          onImported={(value) => {
            adopt(value);
            setShowImport(false);
            setMessage(`原文已导入为 v${value.version}，原文件及校验信息已保存。`);
            void refreshHistory();
          }}
        />
      )}
      {sourceRevision && (
        <ScriptSourceDialog
          projectId={projectId}
          revision={sourceRevision}
          onClose={() => setSourceRevision(undefined)}
          onUnauthorized={onUnauthorized}
        />
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
          {conflict && '。可先复制本地内容，再载入最新剧本；系统不会自动覆盖输入。'}
        </div>
      )}
      {storageError && (
        <div className="notice error" role="alert">
          {storageError}
        </div>
      )}
      {message && (
        <div className="notice success" role="status">
          {message}
        </div>
      )}
      <div className="script-layout">
        <div className="script-editor panel">
          {preview ? (
            <>
              <div className="section-heading">
                <div>
                  <span className="eyebrow">历史版本 · 只读预览</span>
                  <h2>
                    {preview.title} · v{preview.version}
                  </h2>
                </div>
                <button
                  disabled={busy}
                  onClick={() => {
                    previewRequest.current++;
                    setPreview(undefined);
                  }}
                >
                  返回当前编辑
                </button>
              </div>
              <p className="muted">
                {preview.authorName} · {timestamp(preview.createdAt)}
              </p>
              <label>
                历史剧本内容
                <textarea className="script-textarea" readOnly value={preview.content} />
              </label>
              <div className="script-savebar">
                <span className="muted">
                  {dirty ? '请先保存当前修改，再恢复历史版本。' : '恢复会创建新版本，保留全部历史。'}
                </span>
                <button
                  className="primary"
                  disabled={busy || dirty || !canEdit || head.locked || preview.version === head.version}
                  onClick={() => void restore()}
                >
                  恢复为新版本
                </button>
              </div>
            </>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void save();
              }}
            >
              <fieldset className="plain-fieldset" disabled={busy}>
                <label>
                  剧本标题
                  <input
                    required
                    maxLength={200}
                    value={draft.title}
                    readOnly={!canEdit || head.locked}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  />
                </label>
                <label>
                  剧本正文
                  <textarea
                    className="script-textarea"
                    maxLength={60000}
                    value={draft.content}
                    readOnly={!canEdit || head.locked}
                    placeholder="写下故事大纲、人物关系、分场与对白。"
                    onChange={(event) => setDraft({ ...draft, content: event.target.value })}
                  />
                </label>
                <div className="script-text-meta">
                  <span>{draft.content.length.toLocaleString()} / 60,000 字符</span>
                  <span>
                    {head.authorName ? `${head.authorName} · ${timestamp(head.createdAt)}` : '尚无保存记录'}
                  </span>
                </div>
                {canEdit && !head.locked && (
                  <label>
                    本次修改说明
                    <input
                      maxLength={200}
                      value={draft.summary}
                      onChange={(event) => setDraft({ ...draft, summary: event.target.value })}
                      placeholder="例如：补充第一幕冲突（可选）"
                    />
                  </label>
                )}
                <div className="script-savebar">
                  <button
                    type="button"
                    title="将已保存的最新内容载入编辑区，替换当前输入"
                    onClick={() => void reload()}
                  >
                    载入最新剧本
                  </button>
                  {canEdit && !head.locked && (
                    <button className="primary" disabled={!dirty}>
                      {busy ? '正在保存…' : '保存剧本版本'}
                    </button>
                  )}
                </div>
              </fieldset>
            </form>
          )}
        </div>
        <aside className="script-history panel" aria-label="剧本版本历史">
          <div className="section-heading">
            <h3>版本历史</h3>
            <button
              className="text-button"
              disabled={busy || historyBusy}
              onClick={() => void refreshHistory()}
            >
              刷新版本
            </button>
          </div>
          {historyError && (
            <p role="alert" className="muted">
              {historyError}
            </p>
          )}
          {!history.items.length && <p className="muted">第一次保存后，版本会出现在这里。</p>}
          {history.items.map((item) => (
            <button
              className={`revision-item ${preview?.version === item.version ? 'selected' : ''}`}
              disabled={busy || historyBusy}
              key={item.id}
              onClick={() => void inspect(item.version)}
            >
              <span>
                <strong>v{item.version}</strong>
                {item.version === head.version && <span className="badge">当前</span>}
              </span>
              <p>{item.summary || '保存剧本'}</p>
              <small>
                {item.authorName} · {timestamp(item.createdAt)}
              </small>
            </button>
          ))}
          {history.nextCursor && (
            <button
              disabled={busy || historyBusy}
              onClick={() => {
                const cursor = history.nextCursor;
                setHistoryBusy(true);
                void api<ScriptHistory>(`${path}/versions?before=${cursor}`)
                  .then((value) =>
                    setHistory((previous) => ({
                      items: [...previous.items, ...value.items],
                      nextCursor: value.nextCursor,
                    })),
                  )
                  .catch(() => setHistoryError('加载历史失败，请重试'))
                  .finally(() => setHistoryBusy(false));
              }}
            >
              加载更早版本
            </button>
          )}
        </aside>
      </div>
    </section>
  );
}
