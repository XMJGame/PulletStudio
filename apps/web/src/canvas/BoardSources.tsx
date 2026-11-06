import { useEffect, useState } from 'react';
import type { BoardSource } from '../../../../packages/contracts/src/board';
import { api, CursorPage } from '../api';
import { kindLabels, statusLabels } from './board-types';
export const boardResourceDrag = 'application/x-pullet-board-resource';
export function BoardSources({
  projectId,
  editable,
  refresh,
  add,
  report,
  onDragSource,
  onImport,
  onClose,
}: {
  projectId: string;
  editable: boolean;
  refresh: number;
  add: (value: BoardSource) => void;
  report: (error: unknown) => void;
  onDragSource: (source?: BoardSource) => void;
  onImport: () => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState('entities');
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
      <div className="creative-pane-heading">
        <div>
          <span className="creative-kicker">PROJECT LIBRARY</span>
          <h3>项目资源库</h3>
        </div>
        <button className="creative-icon-button" aria-label="收起资源库" onClick={onClose}>
          ×
        </button>
      </div>
      <p className="field-hint">点击添加，或拖到画布上的任意位置。</p>
      <div className="creative-source-tabs">
        {[
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
      {editable && (
        <button className="creative-import" onClick={onImport}>
          ＋ 导入项目素材
        </button>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {loading && <p role="status">正在读取…</p>}
      {!loading && !rows.length && (
        <p className="field-hint">暂无匹配资源。请在项目资产库创建资产或导入媒体。</p>
      )}
      <div className="creative-source-list">
        {rows.map((row) => (
          <button
            key={JSON.stringify(row.ref)}
            disabled={!editable || !row.ready}
            aria-label={`添加 ${row.value.title}`}
            onClick={() => add(row)}
            draggable={editable && row.ready}
            onDragStart={(event) => {
              event.dataTransfer.setData(boardResourceDrag, 'resource');
              event.dataTransfer.effectAllowed = 'copy';
              onDragSource(row);
            }}
            onDragEnd={() => onDragSource()}
          >
            <div className="creative-source-thumbnail">
              {row.value.media?.mediaType === 'image' || row.value.media?.posterUrl ? (
                <img
                  alt=""
                  draggable={false}
                  loading="lazy"
                  src={row.value.media.posterUrl ?? row.value.media.contentUrl}
                  onError={(event) => {
                    event.currentTarget.hidden = true;
                  }}
                />
              ) : null}
              <span>{kindLabels[row.value.kind ?? row.ref.kind] ?? '引用'}</span>
            </div>
            <strong>{row.value.title}</strong>
            <small title={statusLabels[row.value.status]}>
              {row.ready ? `v${row.value.version ?? 1}` : '暂不可用'}
            </small>
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
