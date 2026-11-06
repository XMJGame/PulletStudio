import { useEffect, useRef, useState } from 'react';
import { api, ApiError, type CursorPage } from '../api';
import type { LibraryRevision, LibrarySummary, LibraryView } from './prompt-library-types';
import { StudioButton } from '../shared/ui/StudioUI';
import './prompt-picker.css';

export function PromptLibraryPicker({
  projectId,
  editable,
  onApply,
  onManage,
  onClose,
}: {
  projectId: string;
  editable: boolean;
  onApply: (revision: LibraryRevision) => void;
  onManage: () => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<CursorPage<LibrarySummary>>();
  const [selected, setSelected] = useState<LibraryRevision>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [retry, setRetry] = useState(0);
  const epoch = useRef(0);
  const latest = useRef({ onApply, editable });
  latest.current = { onApply, editable };
  const path = `/projects/${projectId}/prompt-library?q=${encodeURIComponent(q)}`;
  function failed(reason: unknown) {
    setError(reason instanceof Error ? reason.message : '无法读取提示词');
    if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) {
      setList(undefined);
      setSelected(undefined);
    }
  }
  useEffect(() => {
    const ticket = ++epoch.current;
    setList(undefined);
    setSelected(undefined);
    setError('');
    setMessage('');
    setLoading(true);
    setBusy(false);
    const timer = window.setTimeout(
      () =>
        void api<CursorPage<LibrarySummary>>(path)
          .then((value) => {
            if (ticket === epoch.current) setList(value);
          })
          .catch((reason) => {
            if (ticket === epoch.current) failed(reason);
          })
          .finally(() => {
            if (ticket === epoch.current) setLoading(false);
          }),
      180,
    );
    return () => {
      epoch.current++;
      window.clearTimeout(timer);
    };
  }, [path, retry]);
  async function run(action: () => Promise<void>) {
    if (busy) return;
    const ticket = epoch.current;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (reason) {
      if (ticket === epoch.current) failed(reason);
    } finally {
      if (ticket === epoch.current) setBusy(false);
    }
  }
  async function read(entryId: string, version: number) {
    const value = await api<LibraryView>(`/prompt-library/${entryId}/revisions/${version}`);
    if (value.revision.projectId !== projectId) throw new Error('提示词不属于当前项目');
    return value.revision;
  }
  async function useSelected(copy?: 'positivePrompt' | 'negativePrompt') {
    if (!selected) return;
    const ticket = epoch.current;
    const fresh = await read(selected.entryId, selected.version);
    if (ticket !== epoch.current) return;
    if (copy) {
      if (!navigator.clipboard) throw new Error('此浏览器暂不支持复制，请从预览中选择文字。');
      await navigator.clipboard.writeText(fresh[copy]);
      if (ticket === epoch.current) setMessage('已复制完整提示词');
    } else {
      if (!latest.current.editable) throw new Error('当前画布已不可编辑，草稿已保留');
      latest.current.onApply(fresh);
      onClose();
    }
  }
  return (
    <section className="v2-prompt-picker" aria-label="快速选择提示词">
      <div className="v2-prompt-picker-heading">
        <strong>项目提示词</strong>
        <StudioButton variant="ghost" icon="close" aria-label="收起提示词选择" onClick={onClose} />
      </div>
      <input
        type="search"
        aria-label="快速搜索提示词"
        maxLength={80}
        placeholder="搜索标题、正文或来源"
        value={q}
        disabled={busy}
        onChange={(event) => setQ(event.target.value)}
      />
      {error && (
        <div role="alert" className="notice error">
          {error}
          <StudioButton
            variant="ghost"
            disabled={busy || loading}
            onClick={() => setRetry((value) => value + 1)}
          >
            重新加载提示词
          </StudioButton>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {loading && <p role="status">正在读取提示词…</p>}
      {list?.items.length === 0 && (
        <p className="field-hint">没有匹配的提示词。可以在提示词库保存常用内容。</p>
      )}
      <div className="v2-prompt-picker-list">
        {list?.items.map((item) => (
          <button
            key={item.id}
            className="v2-prompt-picker-item"
            aria-pressed={selected?.entryId === item.id}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const ticket = epoch.current;
                const revision = await read(item.id, item.version);
                if (ticket === epoch.current) setSelected(revision);
              })
            }
          >
            <span>
              <strong>{item.title}</strong>
              <small>v{item.version}</small>
            </span>
            <p>{item.preview}</p>
          </button>
        ))}
      </div>
      {list?.nextCursor && (
        <StudioButton
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              const ticket = epoch.current;
              const more = await api<CursorPage<LibrarySummary>>(`${path}&cursor=${list.nextCursor}`);
              if (ticket === epoch.current)
                setList((old) => ({
                  ...more,
                  items: [
                    ...(old?.items ?? []),
                    ...more.items.filter((item) => !old?.items.some((row) => row.id === item.id)),
                  ],
                }));
            })
          }
        >
          更多提示词
        </StudioButton>
      )}
      {selected && (
        <div className="v2-prompt-picker-preview">
          <strong>
            {selected.title} · v{selected.version}
          </strong>
          <p>{selected.positivePrompt}</p>
          {selected.negativePrompt && (
            <details>
              <summary>负向提示词</summary>
              <p>{selected.negativePrompt}</p>
            </details>
          )}
          <div className="v2-live-inline">
            <StudioButton
              variant="primary"
              disabled={busy || !editable}
              onClick={() => void run(() => useSelected())}
            >
              应用到当前节点
            </StudioButton>
            <StudioButton
              variant="ghost"
              disabled={busy}
              onClick={() => void run(() => useSelected('positivePrompt'))}
            >
              复制正向
            </StudioButton>
            {selected.negativePrompt && (
              <StudioButton
                variant="ghost"
                disabled={busy}
                onClick={() => void run(() => useSelected('negativePrompt'))}
              >
                复制负向
              </StudioButton>
            )}
          </div>
          <small>应用此固定版本会替换节点当前提示词，不会自动生成。</small>
        </div>
      )}
      <StudioButton variant="ghost" icon="book" disabled={busy} onClick={onManage}>
        管理提示词库
      </StudioButton>
    </section>
  );
}
