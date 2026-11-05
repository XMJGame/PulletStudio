import { useEffect, useState } from 'react';
import type { BoardSource } from '../../../../packages/contracts/src/board';
import { api, CursorPage } from '../api';
import { kindLabels, statusLabels } from './board-types';
export function BoardSources({
  projectId,
  editable,
  refresh,
  add,
  report,
}: {
  projectId: string;
  editable: boolean;
  refresh: number;
  add: (value: BoardSource) => void;
  report: (error: unknown) => void;
}) {
  const [kind, setKind] = useState('shots');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<BoardSource[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const path = `/projects/${projectId}/board-sources?kind=${kind}&q=${encodeURIComponent(query)}`;
  useEffect(() => {
    let live = true;
    setRows([]);
    setCursor(null);
    setError('');
    setLoading(true);
    const timeout = window.setTimeout(
      () =>
        void api<CursorPage<BoardSource>>(path)
          .then((value) => {
            if (live) {
              setRows(value.items);
              setCursor(value.nextCursor);
            }
          })
          .catch((reason) => {
            if (live) {
              setError(reason instanceof Error ? reason.message : '无法读取项目资源');
              report(reason);
            }
          })
          .finally(() => {
            if (live) setLoading(false);
          }),
      180,
    );
    return () => {
      live = false;
      window.clearTimeout(timeout);
    };
  }, [path, refresh]);
  return (
    <aside className="creative-sources" aria-label="正式项目资源">
      <h3>项目资源</h3>
      <p className="field-hint">固定版本引用 · 添加后不会随业务更新替换</p>
      <div className="creative-source-tabs">
        {[
          ['shots', '镜头'],
          ['entities', '资产'],
          ['media', '媒体'],
        ].map(([id, label]) => (
          <button key={id} aria-pressed={kind === id} onClick={() => setKind(id)}>
            {label}
          </button>
        ))}
      </div>
      <input
        aria-label="搜索画布资源"
        placeholder="搜索项目资源"
        maxLength={80}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {loading && <p role="status">正在读取…</p>}
      {!loading && !rows.length && (
        <p className="field-hint">暂无匹配资源。先在生产工作台保存镜头制作卡、资产或媒体。</p>
      )}
      <div className="creative-source-list">
        {rows.map((row) => (
          <button
            key={JSON.stringify(row.ref)}
            disabled={!editable || !row.ready}
            aria-label={`添加 ${row.value.title}`}
            onClick={() => add(row)}
          >
            <span>
              {kindLabels[row.value.kind ?? row.ref.kind] ?? '业务引用'} · {statusLabels[row.value.status]}
            </span>
            <strong>{row.value.title}</strong>
            <small>{row.ready ? `固定 v${row.value.version ?? 1}` : '先保存完整制作卡'}</small>
          </button>
        ))}
      </div>
      {cursor && (
        <button
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            setError('');
            try {
              const value = await api<CursorPage<BoardSource>>(`${path}&cursor=${cursor}`);
              setRows((current) => [...current, ...value.items]);
              setCursor(value.nextCursor);
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : '加载失败');
              report(reason);
            } finally {
              setLoading(false);
            }
          }}
        >
          更多项目资源
        </button>
      )}
    </aside>
  );
}
