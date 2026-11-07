import { useEffect, useId, useRef, useState } from 'react';
import { api, type CursorPage } from '../api';
import { attributeLabels, roleLabels } from '../entity-types';
import { StudioIcon } from '../shared/ui/StudioUI';
import { LibraryFolderControls, type LibraryFolder } from './LibraryFolderControls';
import './public-entity-library.css';
export type PublicEntityFilters = { folderId: string; query: string; kind: string };
const labels = { character: '角色', environment: '场景', prop: '道具' };
type PublicEntity = {
  id: string;
  version: number;
  folderId: string | null;
  kind: keyof typeof labels;
  name: string;
  description: string;
  attributes: Record<string, string>;
  snapshotVersion: number;
  canManage: boolean;
  inProject: boolean;
  pendingImportKey?: string;
  media: { id: string; role: string; fileName: string; contentUrl: string; posterUrl: string | null }[];
};
type Page = CursorPage<PublicEntity> & { canManageFolders: boolean };
export function PublicEntityLibrary({
  base,
  projectId,
  editable,
  filters,
  onFiltersChange,
  onBusyChange,
  onImported,
}: {
  base: string;
  projectId?: string;
  editable: boolean;
  filters: PublicEntityFilters;
  onFiltersChange: (value: PublicEntityFilters) => void;
  onBusyChange: (value: boolean) => void;
  onImported: () => void;
}) {
  const [folderId, setFolderId] = useState(filters.folderId),
    [query, setQuery] = useState(filters.query),
    [kind, setKind] = useState(filters.kind);
  useEffect(() => {
    onFiltersChange({ folderId, query, kind });
  }, [folderId, query, kind, onFiltersChange]);
  const [folders, setFolders] = useState<LibraryFolder[]>([]),
    [value, setValue] = useState<Page>({ items: [], nextCursor: null, canManageFolders: false });
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [operationError, setOperationError] = useState(''),
    [retry, setRetry] = useState(0),
    [busy, setBusy] = useState(false),
    [folderBusy, setFolderBusy] = useState(false),
    [remove, setRemove] = useState<string>();
  const [previewId, setPreviewId] = useState<string>(),
    [detail, setDetail] = useState<PublicEntity>(),
    [detailError, setDetailError] = useState(''),
    [detailRetry, setDetailRetry] = useState(0),
    [imageError, setImageError] = useState(false);
  const detailRef = useRef<HTMLElement>(null),
    prefix = useId(),
    attempts = useRef(new Map<string, string>());
  const path = `${base}/entities?q=${encodeURIComponent(query)}${folderId ? `&folderId=${folderId}` : ''}${kind ? `&kind=${kind}` : ''}`,
    scope = `${path}:${retry}`,
    current = useRef(scope);
  current.current = scope;
  useEffect(() => {
    onBusyChange(busy || folderBusy);
    return () => onBusyChange(false);
  }, [busy, folderBusy, onBusyChange]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setValue((old) => ({ ...old, items: [], nextCursor: null }));
    api<Page>(path)
      .then(
        (rows) => {
          if (active) setValue(rows);
        },
        (reason) => {
          if (active) setError(reason.message || '公共资产读取失败');
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, retry]);
  useEffect(() => {
    if (!previewId) return;
    let active = true;
    setDetail(undefined);
    setDetailError('');
    setImageError(false);
    api<PublicEntity>(`${base}/entities/${previewId}`).then(
      (row) => {
        if (active) setDetail(row);
      },
      (reason) => {
        if (active) setDetailError(reason.message || '公共资产详情读取失败');
      },
    );
    return () => {
      active = false;
    };
  }, [previewId, base, detailRetry]);
  useEffect(() => {
    if (previewId) detailRef.current?.focus();
  }, [previewId]);
  function back() {
    const id = previewId;
    setPreviewId(undefined);
    requestAnimationFrame(() => document.getElementById(`${prefix}-${id}`)?.focus());
  }
  async function change(row: PublicEntity, action: 'import' | 'move' | 'remove', folder?: string) {
    if (busy) return;
    setBusy(true);
    setOperationError('');
    try {
      if (action === 'import') {
        if (row.pendingImportKey) attempts.current.set(row.id, row.pendingImportKey);
        if (!attempts.current.has(row.id)) attempts.current.set(row.id, crypto.randomUUID());
        await api(`${base}/entities/${row.id}/import`, 'POST', undefined, {
          'Idempotency-Key': attempts.current.get(row.id)!,
        });
        onImported();
      } else {
        await api(`${base}/entities/${row.id}`, action === 'move' ? 'PATCH' : 'DELETE', {
          expectedVersion: row.version,
          ...(action === 'move' ? { folderId: folder || null } : {}),
        });
        setRemove(undefined);
        setRetry((count) => count + 1);
      }
    } catch (reason) {
      setOperationError(reason instanceof Error ? reason.message : '公共资产操作失败');
    } finally {
      setBusy(false);
    }
  }
  async function more() {
    if (loading || !value.nextCursor) return;
    const pending = scope;
    setLoading(true);
    try {
      const rows = await api<Page>(`${path}&cursor=${value.nextCursor}`);
      if (current.current === pending)
        setValue((old) => ({
          ...rows,
          items: [...old.items, ...rows.items.filter((row) => !old.items.some((item) => item.id === row.id))],
        }));
    } catch (reason) {
      if (current.current === pending)
        setError(reason instanceof Error ? reason.message : '公共资产读取失败');
    } finally {
      if (current.current === pending) setLoading(false);
    }
  }
  if (previewId)
    return (
      <section
        className="creative-public-entity-detail"
        aria-label="公共资产详情"
        ref={detailRef}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            back();
          }
        }}
      >
        <button disabled={busy} onClick={back}>
          返回公共资产
        </button>
        {!detail && !detailError && <p role="status">正在读取固定资产修订…</p>}
        {detailError && (
          <p role="alert">
            {detailError}
            <button onClick={() => setDetailRetry((count) => count + 1)}>重试资产详情</button>
          </p>
        )}
        {detail && (
          <>
            <div>
              <span className="field-hint">
                {labels[detail.kind]} · 收录修订 v{detail.snapshotVersion}
              </span>
              <h3>{detail.name}</h3>
            </div>
            {detail.description && <p className="creative-entity-description">{detail.description}</p>}
            <dl className="creative-entity-attributes">
              {Object.entries(detail.attributes)
                .filter(([, text]) => text)
                .map(([key, text]) => (
                  <div key={key}>
                    <dt>{attributeLabels[detail.kind][key] ?? key}</dt>
                    <dd>{text}</dd>
                  </div>
                ))}
            </dl>
            {projectId && editable && (
              <button disabled={busy || detail.inProject} onClick={() => void change(detail, 'import')}>
                {detail.inProject ? '已在本项目' : '添加资产到本项目'}
              </button>
            )}
            <p className="field-hint">添加后创建独立的项目草稿，保留参考图位置；后续修改分别管理。</p>
            <div className="creative-entity-media">
              {detail.media.map((media) => (
                <figure key={`${media.role}:${media.id}`}>
                  <img
                    alt={`${roleLabels[media.role] ?? media.role} · ${media.fileName}`}
                    src={media.posterUrl ?? media.contentUrl}
                    onError={(event) => {
                      event.currentTarget.hidden = true;
                      setImageError(true);
                    }}
                  />
                  <figcaption>
                    {roleLabels[media.role] ?? media.role} · {media.fileName}
                  </figcaption>
                  <a href={`${media.contentUrl}?download=1`} download>
                    下载参考图原件
                  </a>
                </figure>
              ))}
            </div>
            {imageError && <p role="alert">参考图读取失败，可重新读取资产详情后重试。</p>}
          </>
        )}
        {busy && <p role="status">正在导入资产与参考图，请稍候…</p>}
        {operationError && <p role="alert">{operationError}</p>}
      </section>
    );
  return (
    <section className="creative-public-entity-library" aria-label="公共结构化资产">
      <p className="field-hint">复用角色、场景和道具的固定设定与参考图。声音身份暂不公开收录。</p>
      <div className="creative-public-controls">
        <LibraryFolderControls
          apiPath={`${base}/library-folders`}
          projectId={projectId ?? ''}
          editable={value.canManageFolders}
          folders={folders}
          onFolders={setFolders}
          value={folderId}
          onChange={setFolderId}
          onBusyChange={setFolderBusy}
        />
        <div className="creative-media-filters" role="group" aria-label="公共资产类型筛选">
          {[['', '全部'], ...Object.entries(labels)].map(([id, label]) => (
            <button key={id} aria-pressed={kind === id} onClick={() => setKind(id)}>
              {label}
            </button>
          ))}
        </div>
        <input
          aria-label="搜索公共资产"
          placeholder="搜索角色、场景或道具"
          maxLength={80}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {error && (
        <p role="alert">
          {error}
          <button onClick={() => setRetry((count) => count + 1)}>重新读取公共资产</button>
        </p>
      )}
      {operationError && (
        <p role="alert">
          {operationError}
          <button disabled={busy} onClick={() => setRetry((count) => count + 1)}>
            刷新公共资产
          </button>
        </p>
      )}
      {loading && <p role="status">正在读取公共资产…</p>}
      {busy && <p role="status">正在处理公共资产，请稍候…</p>}
      {!loading && !error && !value.items.length && (
        <p className="field-hint">
          {query || folderId || kind
            ? '没有匹配的公共资产。'
            : '还没有公共资产。可从项目资源库的资产分类收录角色、场景或道具。'}
        </p>
      )}
      <div className="creative-source-list">
        {value.items.map((row) => (
          <div className="creative-source-item creative-public-item" key={row.id}>
            <button
              className="creative-source-card"
              id={`${prefix}-${row.id}`}
              aria-label={`查看公共资产 ${row.name}`}
              disabled={busy || folderBusy}
              onClick={() => {
                setOperationError('');
                setPreviewId(row.id);
              }}
            >
              <div className="creative-source-thumbnail">
                {row.media[0] ? (
                  <img alt="" loading="lazy" src={row.media[0].posterUrl ?? row.media[0].contentUrl} />
                ) : (
                  <StudioIcon name="layers" size={28} />
                )}
                <span>{labels[row.kind]}</span>
              </div>
              <strong>{row.name}</strong>
              <small>收录修订 v{row.snapshotVersion}</small>
            </button>
            {projectId && editable && (
              <button
                className="creative-public-action"
                aria-label={`添加公共资产 ${row.name} 到本项目`}
                disabled={busy || row.inProject}
                onClick={() => void change(row, 'import')}
              >
                {row.inProject ? '已在本项目' : '添加资产到项目'}
              </button>
            )}
            {row.canManage && (
              <>
                {folders.length > 0 && (
                  <select
                    aria-label={`移动公共资产 ${row.name} 到文件夹`}
                    value={row.folderId ?? ''}
                    disabled={busy}
                    onChange={(event) => void change(row, 'move', event.target.value)}
                  >
                    <option value="">未分类</option>
                    {folders.map((folder) => (
                      <option key={folder.id} value={folder.id}>
                        {folder.name}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  className="creative-public-action"
                  aria-label={`移除公共资产 ${row.name}`}
                  disabled={busy}
                  onClick={() => setRemove(row.id)}
                >
                  移出公共库
                </button>
                {remove === row.id && (
                  <div className="creative-public-remove">
                    <p className="field-hint">已导入项目的资产和图片继续保留。</p>
                    <button disabled={busy} onClick={() => void change(row, 'remove')}>
                      确认移除公共资产
                    </button>
                    <button disabled={busy} onClick={() => setRemove(undefined)}>
                      取消移除
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
      {value.nextCursor && (
        <button disabled={loading} onClick={() => void more()}>
          更多公共资产
        </button>
      )}
    </section>
  );
}
