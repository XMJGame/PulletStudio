import { useEffect, useRef, useState } from 'react';
import type { BoardSource } from '../../../../packages/contracts/src/board';
import { Dialog } from '../components/Dialog';
import { StudioButton, StudioIcon } from '../shared/ui/StudioUI';
import { useBoardSources } from './useBoardSources';
import { LibraryFolderControls, type LibraryFolder } from './LibraryFolderControls';
import { PublicLibraryPanel, type PublicLibraryFilters } from './PublicLibraryPanel';
import './media-library-picker.css';

export function MediaLibraryPicker({
  projectId,
  editable,
  report,
  onClose,
  onAdd,
  onLibraryChanged,
}: {
  projectId: string;
  editable: boolean;
  report: (reason: unknown) => void;
  onClose: () => void;
  onAdd: (sources: BoardSource[]) => Promise<void>;
  onLibraryChanged: () => void;
}) {
  const [scope, setScope] = useState<'project' | 'public'>('project');
  const [query, setQuery] = useState(''),
    [mediaType, setMediaType] = useState(''),
    [folderId, setFolderId] = useState('');
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [selected, setSelected] = useState<BoardSource[]>([]),
    [preview, setPreview] = useState<BoardSource>();
  const previewRegion = useRef<HTMLElement>(null);
  const previewTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (preview) previewRegion.current?.focus();
    else if (previewTrigger.current?.isConnected) previewTrigger.current.focus();
  }, [preview]);
  const [adding, setAdding] = useState(false),
    [publicBusy, setPublicBusy] = useState(false);
  const [operationError, setOperationError] = useState(''),
    [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [publicFilters, setPublicFilters] = useState<PublicLibraryFilters>({
    folderId: '',
    query: '',
    mediaType: '',
  });
  const path = `/projects/${projectId}/board-sources?kind=media&q=${encodeURIComponent(query)}${mediaType ? `&mediaType=${mediaType}` : ''}${folderId ? `&folderId=${folderId}` : ''}`;
  const { rows, cursor, loading, error, loadMore, reload } = useBoardSources(path, refresh, report);
  const busy = adding || publicBusy;
  const media = preview?.value.media;
  return (
    <Dialog
      title="选择素材"
      description="从项目库选择固定素材加入画布。公共素材需先明确添加到项目。"
      busy={busy}
      onClose={onClose}
      className="creative-media-picker"
    >
      <div className="dialog-body">
        {preview && media ? (
          <section
            aria-label="网格素材预览"
            className="creative-picker-preview"
            ref={previewRegion}
            tabIndex={-1}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                setPreview(undefined);
              }
            }}
          >
            <StudioButton onClick={() => setPreview(undefined)}>返回选择素材</StudioButton>
            <h3>{preview.value.title}</h3>
            {media.mediaType === 'image' ? (
              <img src={media.contentUrl} alt={preview.value.title} />
            ) : media.mediaType === 'video' ? (
              <video
                src={media.contentUrl}
                poster={media.posterUrl ?? undefined}
                controls
                preload="metadata"
              />
            ) : (
              <audio src={media.contentUrl} controls preload="metadata" />
            )}
            <p>固定版本 v{preview.value.version ?? 1}</p>
          </section>
        ) : (
          <>
            <div className="creative-picker-scopes" role="group" aria-label="素材选择范围">
              <StudioButton
                disabled={busy}
                aria-pressed={scope === 'project'}
                onClick={() => setScope('project')}
              >
                本项目
              </StudioButton>
              <StudioButton
                disabled={busy}
                aria-pressed={scope === 'public'}
                onClick={() => setScope('public')}
              >
                公共库
              </StudioButton>
            </div>
            {notice && <p role="status">{notice}</p>}
            {scope === 'public' ? (
              <PublicLibraryPanel
                pickerMode
                projectId={projectId}
                editable={editable}
                filters={publicFilters}
                onFiltersChange={setPublicFilters}
                onBusyChange={setPublicBusy}
                onImported={() => {
                  setScope('project');
                  setQuery('');
                  setMediaType('');
                  setFolderId('');
                  setRefresh((value) => value + 1);
                  setNotice('已添加到项目素材库，请选中后加入画布。');
                  onLibraryChanged();
                }}
              />
            ) : (
              <>
                <fieldset disabled={adding} className="plain-fieldset creative-picker-filters">
                  <LibraryFolderControls
                    projectId={projectId}
                    editable={false}
                    folders={folders}
                    onFolders={setFolders}
                    value={folderId}
                    onChange={setFolderId}
                  />
                  <label>
                    搜索素材
                    <input
                      aria-label="网格搜索素材"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="按名称搜索"
                    />
                  </label>
                </fieldset>
                <div role="group" aria-label="网格媒体类型" className="creative-picker-types">
                  {[
                    ['', '全部'],
                    ['image', '图片'],
                    ['video', '视频'],
                    ['audio', '音频'],
                  ].map(([id, label]) => (
                    <StudioButton
                      key={id}
                      disabled={adding}
                      aria-pressed={mediaType === id}
                      onClick={() => setMediaType(id)}
                    >
                      {label}
                    </StudioButton>
                  ))}
                </div>
                {error && (
                  <div role="alert">
                    <p>{error}</p>
                    <StudioButton onClick={reload}>重试读取素材</StudioButton>
                  </div>
                )}
                {loading && <p role="status">正在读取素材…</p>}
                {!loading && !rows.length && !error && (
                  <p className="empty-state">没有符合条件的素材。未收藏的画布文件不会出现在这里。</p>
                )}
                <div className="creative-media-grid" role="group" aria-label="项目素材网格">
                  {rows.map((source) => {
                    const media = source.value.media;
                    const chosen = selected.some((row) => row.ref.id === source.ref.id);
                    const poster = media?.mediaType === 'image' ? media.contentUrl : media?.posterUrl;
                    return (
                      <article key={source.ref.id}>
                        <button
                          type="button"
                          className="creative-media-choice"
                          aria-label={`选择素材 ${source.value.title}`}
                          aria-pressed={chosen}
                          disabled={!editable || adding || !source.ready || !media}
                          onClick={() => {
                            setOperationError('');
                            if (!chosen && selected.length >= 100) {
                              setOperationError('一次最多选择 100 份素材。');
                              return;
                            }
                            setSelected((old) =>
                              chosen ? old.filter((row) => row.ref.id !== source.ref.id) : [...old, source],
                            );
                          }}
                        >
                          <div className="creative-media-choice-preview">
                            {poster ? (
                              <img src={poster} alt="" loading="lazy" />
                            ) : (
                              <StudioIcon name={media?.mediaType === 'audio' ? 'audio' : 'film'} size={30} />
                            )}
                            <span aria-hidden="true" className="creative-media-check">
                              {chosen ? '✓' : ''}
                            </span>
                          </div>
                          <strong>{source.value.title}</strong>
                          <small>
                            {media
                              ? ({ image: '图片', video: '视频', audio: '音频' } as const)[media.mediaType]
                              : '不可用'}{' '}
                            · v{source.value.version ?? 1}
                          </small>
                        </button>
                        {media && (
                          <StudioButton
                            disabled={adding}
                            variant="ghost"
                            aria-label={`预览素材 ${source.value.title}`}
                            onClick={(event) => {
                              previewTrigger.current = event.currentTarget;
                              setPreview(source);
                            }}
                          >
                            预览
                          </StudioButton>
                        )}
                      </article>
                    );
                  })}
                </div>
                {cursor && (
                  <StudioButton disabled={loading || adding} onClick={() => void loadMore()}>
                    加载更多素材
                  </StudioButton>
                )}
              </>
            )}
          </>
        )}
        {operationError && (
          <p role="alert" className="notice error">
            {operationError}
          </p>
        )}
      </div>
      <div className="dialog-footer creative-picker-footer">
        <span role="status">已选 {selected.length} 份素材</span>
        {!!selected.length && (
          <StudioButton disabled={busy} variant="ghost" onClick={() => setSelected([])}>
            清空选择
          </StudioButton>
        )}
        <StudioButton disabled={busy} onClick={onClose}>
          取消
        </StudioButton>
        {editable && (
          <StudioButton
            variant="primary"
            disabled={busy || !selected.length || scope !== 'project' || !!preview}
            onClick={() => {
              setAdding(true);
              setOperationError('');
              void onAdd(selected)
                .catch((reason) =>
                  setOperationError(reason instanceof Error ? reason.message : '添加失败，选择已保留。'),
                )
                .finally(() => setAdding(false));
            }}
          >
            {adding ? '正在添加…' : '加入画布'}
          </StudioButton>
        )}
      </div>
    </Dialog>
  );
}
