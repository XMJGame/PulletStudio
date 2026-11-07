import { useEffect, useId, useRef, useState } from 'react';
import { api, type CursorPage } from '../api';
import { LibraryFolderControls, type LibraryFolder } from './LibraryFolderControls';
import { StudioIcon } from '../shared/ui/StudioUI';
import { PublicLibraryUpload } from './PublicLibraryUpload';
import { PublicEntityLibrary, type PublicEntityFilters } from './PublicEntityLibrary';
export type PublicLibraryFilters = {
  folderId: string;
  query: string;
  mediaType: string;
  category?: 'media' | 'entities';
  entityFilters?: PublicEntityFilters;
};
type PublicMedia = {
  id: string;
  version: number;
  title: string;
  folderId: string | null;
  canManage: boolean;
  inProject: boolean;
  mediaType: 'image' | 'video' | 'audio';
  contentUrl: string;
  posterUrl: string | null;
  metadata: { width: number | null; height: number | null; durationMs: number | null };
};
type PublicPage = CursorPage<PublicMedia> & { canManageFolders: boolean; workspaceId?: string };
export function PublicLibraryPanel({
  projectId,
  workspaceId,
  editable,
  onImported,
  filters,
  onFiltersChange,
  onBusyChange,
}: ({ projectId: string; workspaceId?: never } | { workspaceId: string; projectId?: never }) & {
  editable: boolean;
  onImported: (kind?: 'media' | 'entity') => void;
  filters: PublicLibraryFilters;
  onFiltersChange: (value: PublicLibraryFilters) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [folders, setFolders] = useState<LibraryFolder[]>([]),
    [folderId, setFolderId] = useState(filters.folderId);
  const [query, setQuery] = useState(filters.query),
    [mediaType, setMediaType] = useState(filters.mediaType);
  const [category, setCategory] = useState(filters.category ?? 'media');
  const [entityFilters, setEntityFilters] = useState<PublicEntityFilters>(
    filters.entityFilters ?? { folderId: '', query: '', kind: '' },
  );
  const [entityBusy, setEntityBusy] = useState(false);
  useEffect(() => {
    onFiltersChange({ folderId, query, mediaType, category, entityFilters });
  }, [folderId, query, mediaType, category, entityFilters, onFiltersChange]);
  const [value, setValue] = useState<PublicPage>({ items: [], nextCursor: null, canManageFolders: false });
  const [retry, setRetry] = useState(0),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(''),
    [operationError, setOperationError] = useState('');
  const [folderBusy, setFolderBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  useEffect(() => {
    onBusyChange?.(busy || folderBusy || uploadBusy || entityBusy);
    return () => onBusyChange?.(false);
  }, [busy, folderBusy, uploadBusy, entityBusy, onBusyChange]);
  const [preview, setPreview] = useState<PublicMedia>(),
    [remove, setRemove] = useState<string>();
  const [previewError, setPreviewError] = useState(false);
  const previewId = useId();
  const previewRegion = useRef<HTMLElement>(null);
  useEffect(() => {
    if (preview) previewRegion.current?.focus();
  }, [preview?.id]);
  function closePreview() {
    const id = preview?.id;
    setPreview(undefined);
    requestAnimationFrame(() => {
      document.getElementById(`${previewId}-${id}`)?.focus();
    });
  }
  const attempts = useRef(new Map<string, string>());
  const base = projectId
    ? `/projects/${projectId}/public-library`
    : `/workspaces/${workspaceId}/public-library`;
  const path = `${base}/resources?q=${encodeURIComponent(query)}${folderId ? `&folderId=${folderId}` : ''}${mediaType ? `&mediaType=${mediaType}` : ''}`;
  const scope = `${path}:${retry}`,
    current = useRef(scope);
  current.current = scope;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setValue((old) => ({
      items: [],
      nextCursor: null,
      canManageFolders: old.canManageFolders,
      workspaceId: old.workspaceId,
    }));
    setError('');
    api<PublicPage>(path)
      .then(
        (rows) => {
          if (active) setValue(rows);
        },
        (reason) => {
          if (active) setError(reason.message || '公共库读取失败');
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, retry]);
  async function more() {
    if (loading || !value.nextCursor) return;
    const pending = scope;
    setLoading(true);
    try {
      const rows = await api<PublicPage>(`${path}&cursor=${value.nextCursor}`);
      if (current.current === pending)
        setValue((old) => ({
          ...rows,
          items: [
            ...old.items,
            ...rows.items.filter((row) => !old.items.some((existing) => existing.id === row.id)),
          ],
        }));
    } catch (reason) {
      if (current.current === pending) setError(reason instanceof Error ? reason.message : '公共库读取失败');
    } finally {
      if (current.current === pending) setLoading(false);
    }
  }
  async function change(row: PublicMedia, action: 'import' | 'remove' | 'move', folder?: string) {
    if (busy) return;
    setBusy(true);
    setOperationError('');
    try {
      if (action === 'import') {
        if (!attempts.current.has(row.id)) attempts.current.set(row.id, crypto.randomUUID());
        await api(`${base}/resources/${row.id}/import`, 'POST', undefined, {
          'Idempotency-Key': attempts.current.get(row.id)!,
        });
        onImported();
      } else {
        await api(`${base}/resources/${row.id}`, action === 'move' ? 'PATCH' : 'DELETE', {
          expectedVersion: row.version,
          ...(action === 'move' ? { folderId: folder || null } : {}),
        });
        setRemove(undefined);
        setRetry((count) => count + 1);
      }
    } catch (reason) {
      setOperationError(reason instanceof Error ? reason.message : '公共素材操作失败');
    } finally {
      setBusy(false);
    }
  }
  if (preview)
    return (
      <section
        className="creative-public-preview"
        aria-label="公共素材预览"
        aria-busy={busy}
        ref={previewRegion}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            closePreview();
          }
        }}
      >
        <button onClick={closePreview}>返回公共库</button>
        <h4>{preview.title}</h4>
        {preview.mediaType === 'image' ? (
          <img alt={preview.title} src={preview.contentUrl} onError={() => setPreviewError(true)} />
        ) : preview.mediaType === 'video' ? (
          <video
            aria-label={preview.title}
            controls
            preload="none"
            poster={preview.posterUrl ?? undefined}
            src={preview.contentUrl}
            onError={() => setPreviewError(true)}
          />
        ) : (
          <audio
            aria-label={preview.title}
            controls
            preload="none"
            src={preview.contentUrl}
            onError={() => setPreviewError(true)}
          />
        )}
        <p className="field-hint">
          {preview.metadata.width ? `${preview.metadata.width} × ${preview.metadata.height}` : ''}
          {preview.metadata.durationMs ? ` · ${(preview.metadata.durationMs / 1000).toFixed(1)} 秒` : ''}
        </p>
        <a href={`${preview.contentUrl}?download=1`} download>
          下载原件
        </a>
        {projectId && editable && (
          <button disabled={busy || preview.inProject} onClick={() => void change(preview, 'import')}>
            {preview.inProject ? '已在本项目' : '添加到本项目'}
          </button>
        )}
        {operationError && <p role="alert">{operationError}</p>}
        {previewError && <p role="alert">预览读取失败，可返回列表后重试。</p>}
        {busy && <p role="status">正在处理公共素材，请稍候…</p>}
      </section>
    );
  return (
    <section aria-label="工作区公共媒体库" className="creative-public-library" aria-busy={busy}>
      <div className="creative-public-categories" role="group" aria-label="公共库内容">
        <button
          aria-pressed={category === 'media'}
          disabled={busy || folderBusy || uploadBusy || entityBusy}
          onClick={() => setCategory('media')}
        >
          媒体素材
        </button>
        <button
          aria-pressed={category === 'entities'}
          disabled={busy || folderBusy || uploadBusy || entityBusy}
          onClick={() => setCategory('entities')}
        >
          角色与场景
        </button>
      </div>
      {category === 'entities' && (
        <PublicEntityLibrary
          base={base}
          projectId={projectId}
          editable={editable}
          filters={entityFilters}
          onFiltersChange={setEntityFilters}
          onBusyChange={setEntityBusy}
          onImported={() => onImported('entity')}
        />
      )}
      <div hidden={category !== 'media'}>
        <p className="field-hint">
          {projectId
            ? '工作区成员共享。添加到项目后，可用于画布与生成。'
            : '整理团队共用的参考素材。进入项目后，可从资源库添加并用于创作。'}
        </p>
        {(workspaceId ?? value.workspaceId) && (
          <PublicLibraryUpload
            workspaceId={(workspaceId ?? value.workspaceId)!}
            folderId={folderId}
            onBusyChange={setUploadBusy}
            onComplete={() => setRetry((count) => count + 1)}
          />
        )}
        <div className="creative-public-controls">
          <LibraryFolderControls
            projectId={projectId ?? ''}
            apiPath={`${base}/library-folders`}
            editable={value.canManageFolders}
            folders={folders}
            onFolders={setFolders}
            value={folderId}
            onChange={setFolderId}
            onBusyChange={setFolderBusy}
          />
          <div className="creative-media-filters" role="group" aria-label="公共库媒体类型筛选">
            {[
              ['', '全部'],
              ['image', '图片'],
              ['video', '视频'],
              ['audio', '音频'],
            ].map(([id, label]) => (
              <button
                key={id}
                aria-pressed={id === mediaType}
                onClick={() => {
                  setMediaType(id);
                  setRemove(undefined);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            aria-label="搜索公共素材"
            placeholder="搜索公共素材名称"
            maxLength={80}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        {error && (
          <p role="alert">
            {error}
            <button onClick={() => setRetry((count) => count + 1)}>重新读取公共库</button>
          </p>
        )}
        {operationError && (
          <p role="alert">
            {operationError}
            <button disabled={busy} onClick={() => setRetry((count) => count + 1)}>
              刷新公共素材
            </button>
          </p>
        )}
        {loading && <p role="status">正在读取公共素材…</p>}
        {busy && <p role="status">正在处理公共素材，请稍候…</p>}
        {!loading && !error && !value.items.length && (
          <p className="field-hint">
            {query || folderId || mediaType
              ? '没有匹配的公共素材。'
              : projectId
                ? '公共库还没有素材。可以从本项目收录可复用的媒体。'
                : '公共库还没有素材。可先在项目中收录可复用的图片、视频或音频。'}
          </p>
        )}
        <div className="creative-source-list">
          {value.items.map((row) => (
            <div className="creative-source-item creative-public-item" key={row.id}>
              <button
                className="creative-source-card"
                disabled={folderBusy || uploadBusy}
                id={`${previewId}-${row.id}`}
                aria-label={`预览公共素材 ${row.title}`}
                onClick={() => {
                  setPreviewError(false);
                  setOperationError('');
                  setPreview(row);
                }}
              >
                <div className="creative-source-thumbnail">
                  {(row.mediaType === 'image' || row.posterUrl) && (
                    <img alt="" loading="lazy" src={row.posterUrl ?? row.contentUrl} />
                  )}
                  {row.mediaType === 'audio' && <StudioIcon name="note" size={28} />}
                  <span>{{ image: '图片', video: '视频', audio: '音频' }[row.mediaType]}</span>
                </div>
                <strong>{row.title}</strong>
              </button>
              {projectId && editable && (
                <button
                  className="creative-public-action"
                  disabled={busy || row.inProject}
                  aria-label={`添加公共素材 ${row.title} 到本项目`}
                  onClick={() => void change(row, 'import')}
                >
                  {row.inProject ? '已在本项目' : '添加到项目'}
                </button>
              )}
              {row.canManage && (
                <>
                  {folders.length > 0 && (
                    <select
                      aria-label={`移动公共素材 ${row.title} 到文件夹`}
                      disabled={busy}
                      value={row.folderId ?? ''}
                      onChange={(event) => void change(row, 'move', event.target.value)}
                    >
                      <option value="">未分类</option>
                      {folders.map((folder) => (
                        <option value={folder.id} key={folder.id}>
                          {folder.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <button
                    className="creative-public-action"
                    disabled={busy}
                    aria-label={`移除公共素材 ${row.title}`}
                    onClick={() => setRemove(row.id)}
                  >
                    移出公共库
                  </button>
                  {remove === row.id && (
                    <div className="creative-public-remove">
                      <p className="field-hint">已添加到项目的版本继续保留。</p>
                      <button disabled={busy} onClick={() => void change(row, 'remove')}>
                        确认移除公共素材
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
            更多公共素材
          </button>
        )}
      </div>
    </section>
  );
}
