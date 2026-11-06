import { useId, useRef, useState } from 'react';
import type { BoardSource } from '../../../../packages/contracts/src/board';
import { kindLabels, statusLabels } from './board-types';
import { useBoardSources } from './useBoardSources';
import { StudioIcon } from '../shared/ui/StudioUI';
import { BoardSourcePreview } from './BoardSourcePreview';
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
  add: (value: BoardSource) => boolean;
  report: (error: unknown) => void;
  onDragSource: (source?: BoardSource) => void;
  onImport: () => void;
  onClose: () => void;
}) {
  const [kind, setKind] = useState('media');
  const [mediaType, setMediaType] = useState('');
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<{ source: BoardSource; scope: string }>();
  const trigger = useRef('');
  const previewPrefix = useId();
  const path = `/projects/${projectId}/board-sources?kind=${kind}&q=${encodeURIComponent(query)}${kind === 'media' && mediaType ? `&mediaType=${mediaType}` : ''}`;
  const { rows, cursor, loading, error, loadMore, reload } = useBoardSources(path, refresh, report);
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
      {preview?.scope === path ? (
        <BoardSourcePreview
          key={JSON.stringify(preview.source.ref)}
          projectId={projectId}
          source={preview.source}
          editable={editable}
          add={add}
          report={report}
          onBack={() => {
            setPreview(undefined);
            requestAnimationFrame(() => {
              document.getElementById(trigger.current)?.focus();
            });
          }}
        />
      ) : (
        <>
          <p className="field-hint">
            {editable ? '点击或拖入画布，复用项目素材。' : '浏览当前项目已归档的资源。'}
          </p>
          <div className="creative-source-tabs">
            {[
              ['media', '媒体'],
              ['entities', '资产'],
            ].map(([id, label]) => (
              <button key={id} aria-pressed={kind === id} onClick={() => setKind(id)}>
                {label}
              </button>
            ))}
          </div>
          {kind === 'media' && (
            <div className="creative-media-filters" role="group" aria-label="媒体类型筛选">
              {[
                ['', '全部'],
                ['image', '图片'],
                ['video', '视频'],
                ['audio', '音频'],
              ].map(([id, label]) => (
                <button key={id} aria-pressed={mediaType === id} onClick={() => setMediaType(id)}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <input
            aria-label="搜索画布资源"
            placeholder={kind === 'media' ? '搜索文件名称' : '搜索资产名称'}
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
            <div role="alert" className="notice error">
              {error}
              <button disabled={loading} onClick={reload}>
                重新加载资源
              </button>
            </div>
          )}
          {loading && <p role="status">正在读取…</p>}
          {!loading && !error && !rows.length && (
            <div className="creative-library-empty">
              <StudioIcon name={kind === 'media' ? 'image' : 'layers'} size={28} />
              <strong>
                {query || (mediaType && kind === 'media')
                  ? '没有匹配的资源'
                  : kind === 'media'
                    ? '还没有项目媒体'
                    : '还没有角色与场景资产'}
              </strong>
              <p>
                {query || (mediaType && kind === 'media')
                  ? '试试其他关键词或分类。'
                  : kind === 'media'
                    ? '上传图片、视频或音频后，可在多张画布使用。'
                    : '在「更多操作 → 角色与场景」整理创作资产。'}
              </p>
            </div>
          )}
          <div className="creative-source-list">
            {rows.map((row) => (
              <div className="creative-source-item" key={JSON.stringify(row.ref)}>
                <button
                  className="creative-source-card"
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
                <button
                  className="creative-source-peek"
                  id={`${previewPrefix}-${row.ref.kind}-${row.ref.id}`}
                  aria-label={`预览 ${row.value.title}`}
                  disabled={!row.ready}
                  onClick={(event) => {
                    trigger.current = event.currentTarget.id;
                    setPreview({ source: row, scope: path });
                  }}
                >
                  <StudioIcon name="eye" size={16} />
                </button>
              </div>
            ))}
          </div>
          {cursor && (
            <button disabled={loading} onClick={() => void loadMore()}>
              更多项目资源
            </button>
          )}
        </>
      )}
    </aside>
  );
}
