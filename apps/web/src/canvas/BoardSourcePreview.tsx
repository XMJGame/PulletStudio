import { useEffect, useRef, useState } from 'react';
import type { BoardReference, BoardResolved, BoardSource } from '../../../../packages/contracts/src/board';
import { api } from '../api';
import { StudioButton } from '../shared/ui/StudioUI';
import { kindLabels, statusLabels } from './board-types';
import { roleLabels, type EntityRevision } from '../entity-types';
import { BoardEntityVersions } from './BoardEntityVersions';
import './board-source-preview.css';
import { VideoFrameButton } from '../components/VideoFrameDialog';

export function BoardSourcePreview({
  projectId,
  source,
  editable,
  add,
  report,
  onBack,
  onMediaSaved,
}: {
  projectId: string;
  source: BoardSource;
  editable: boolean;
  add: (source: BoardSource) => boolean;
  report: (reason: unknown) => void;
  onBack: () => void;
  onMediaSaved: () => void;
}) {
  const [selectedRef, setSelectedRef] = useState<BoardReference>(source.ref);
  const [selectedMedia, setSelectedMedia] = useState('');
  const [snapshot, setSnapshot] = useState<{ key: string; value: BoardResolved; media?: BoardResolved }>();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [addingMedia, setAddingMedia] = useState(false);
  const epoch = useRef(0);
  const ref = useRef<HTMLElement>(null);
  const nodeId = useRef(crypto.randomUUID());
  const mediaNodeId = useRef(crypto.randomUUID());
  const reporter = useRef(report);
  reporter.current = report;
  const actions = useRef({ add, editable });
  actions.current = { add, editable };
  const reference = JSON.stringify(selectedRef);
  const key = `${projectId}:${reference}:${selectedMedia}:${retry}`;
  const currentKey = useRef(key);
  currentKey.current = key;
  const value = snapshot?.key === key ? snapshot.value : undefined;
  useEffect(() => {
    ref.current?.focus();
  }, []);
  useEffect(() => {
    let active = true;
    const ticket = ++epoch.current;
    const live = () => active && ticket === epoch.current && currentKey.current === key;
    setSnapshot(undefined);
    setAddingMedia(false);
    setLoading(true);
    setError('');
    setMessage('');
    void api<Record<string, BoardResolved>>(`/projects/${projectId}/board-references/resolve`, 'POST', {
      references: [
        { nodeId: nodeId.current, ref: JSON.parse(reference) },
        ...(selectedMedia
          ? [{ nodeId: mediaNodeId.current, ref: { kind: 'media', id: selectedMedia } }]
          : []),
      ],
    })
      .then((values) => {
        if (!live()) return;
        const resolved = values[nodeId.current];
        const media = selectedMedia ? values[mediaNodeId.current] : undefined;
        if (!resolved || resolved.status === 'unavailable')
          setError('此资源已不可用，请检查文件或访问权限。');
        else if (selectedMedia && (!media?.media || media.status === 'unavailable'))
          setError('此参考素材已不可用，请检查文件或访问权限。');
        else setSnapshot({ key, value: resolved, media });
      })
      .catch((reason) => {
        if (live()) {
          setError(reason instanceof Error ? reason.message : '无法读取资源');
          reporter.current(reason);
        }
      })
      .finally(() => {
        if (live()) setLoading(false);
      });
    return () => {
      active = false;
      epoch.current++;
    };
  }, [projectId, reference, selectedMedia, retry]);
  const failed = () => {
    epoch.current++;
    setSnapshot(undefined);
    setAddingMedia(false);
    setError('预览无法读取或播放，请检查文件或访问权限。');
  };
  const media = value ? (snapshot?.media?.media ?? value.media) : undefined;
  const entityRevision =
    selectedRef.kind === 'entity' ? (value?.detail?.revision as EntityRevision | undefined) : undefined;
  return (
    <section
      className="v2-source-preview"
      aria-label="资源预览"
      tabIndex={-1}
      ref={ref}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !document.fullscreenElement) {
          event.preventDefault();
          event.stopPropagation();
          onBack();
        }
      }}
    >
      <StudioButton variant="ghost" icon="arrow" onClick={onBack}>
        返回资源列表
      </StudioButton>
      {selectedRef.kind === 'entity' && (
        <BoardEntityVersions
          source={source}
          selected={selectedRef.revisionId}
          change={(revisionId) => {
            setSelectedRef({ kind: 'entity', id: selectedRef.id, revisionId });
            setSelectedMedia('');
          }}
          onDenied={(reason) => {
            epoch.current++;
            setSnapshot(undefined);
            setLoading(false);
            setAddingMedia(false);
            setError('资产历史已不可访问，请检查访问权限。');
            reporter.current(reason);
          }}
        />
      )}
      {loading && <p role="status">正在读取固定版本…</p>}
      {error && (
        <div role="alert" className="notice error">
          {error}
          <StudioButton variant="ghost" disabled={loading} onClick={() => setRetry((n) => n + 1)}>
            重新读取预览
          </StudioButton>
        </div>
      )}
      {value && (
        <>
          <div className="v2-source-preview-title">
            <small>{kindLabels[value.kind ?? source.ref.kind] ?? '项目资源'}</small>
            <h4>{value.title}</h4>
            <small>
              {statusLabels[value.status]} · v{value.version ?? 1}
            </small>
          </div>
          {!!entityRevision?.media.length && (
            <div className="v2-entity-references" role="group" aria-label="资产参考素材">
              {entityRevision.media.map((item) => (
                <button
                  key={`${item.role}:${item.mediaVersionId}`}
                  aria-label={`预览${roleLabels[item.role] ?? item.role}：${item.fileName}`}
                  aria-pressed={(selectedMedia || value.media?.id) === item.mediaVersionId}
                  onClick={() => setSelectedMedia(item.mediaVersionId)}
                >
                  {item.mediaType === 'image' ? (
                    <img src={`/api/v1/media-versions/${item.mediaVersionId}/poster`} alt="" loading="lazy" />
                  ) : (
                    <span aria-hidden="true">♫</span>
                  )}
                  <strong>{roleLabels[item.role] ?? item.role}</strong>
                  <small>
                    {item.fileName} · v{item.version}
                  </small>
                </button>
              ))}
            </div>
          )}
          {media && (
            <div className="v2-source-preview-media">
              {media.mediaType === 'image' ? (
                <img src={media.contentUrl} alt="项目资源预览" onError={failed} />
              ) : media.mediaType === 'video' ? (
                <video
                  src={media.contentUrl}
                  poster={media.posterUrl ?? undefined}
                  aria-label="项目资源视频"
                  controls
                  playsInline
                  preload="metadata"
                  onError={failed}
                />
              ) : (
                <audio
                  src={media.contentUrl}
                  aria-label="项目资源音频"
                  controls
                  preload="metadata"
                  onError={failed}
                />
              )}
            </div>
          )}
          {value.summary && <p className="v2-source-preview-description">{value.summary}</p>}
          {media && (
            <dl>
              <div>
                <dt>文件</dt>
                <dd>{media.fileName}</dd>
              </div>
              {media.metadata.width && media.metadata.height && (
                <div>
                  <dt>尺寸</dt>
                  <dd>
                    {media.metadata.width}×{media.metadata.height}
                  </dd>
                </div>
              )}
              {media.metadata.durationMs !== null && (
                <div>
                  <dt>时长</dt>
                  <dd>{Number((media.metadata.durationMs / 1000).toFixed(2))} 秒</dd>
                </div>
              )}
            </dl>
          )}
          <div className="v2-source-preview-actions">
            {editable && media?.mediaType === 'video' && (
              <VideoFrameButton
                mediaId={media.id}
                onSaved={onMediaSaved}
                onAdd={async (image) => {
                  const id = crypto.randomUUID();
                  const values = await api<Record<string, BoardResolved>>(
                    `/projects/${projectId}/board-references/resolve`,
                    'POST',
                    { references: [{ nodeId: id, ref: { kind: 'media', id: image.id } }] },
                  );
                  if (
                    !values[id]?.media ||
                    values[id].status === 'unavailable' ||
                    !actions.current.editable ||
                    !actions.current.add({
                      ref: { kind: 'media', id: image.id },
                      value: values[id],
                      ready: true,
                    })
                  )
                    throw new Error('参考图已入库，请从项目资源库重新添加。');
                }}
              />
            )}
            {editable && (
              <StudioButton
                variant="primary"
                icon="plus"
                onClick={() => {
                  if (!editable) return;
                  if (add({ ref: selectedRef, value, ready: true }))
                    setMessage('已添加到画布草稿，请保存画布。');
                  else setError('无法添加，请检查画布容量与编辑权限。');
                }}
              >
                {selectedRef.kind === 'entity' ? '添加此资产版本' : '添加到画布'}
              </StudioButton>
            )}
            {editable && selectedRef.kind === 'entity' && media && (
              <StudioButton
                icon="plus"
                disabled={addingMedia}
                onClick={() => {
                  const ticket = epoch.current;
                  const live = () => ticket === epoch.current && currentKey.current === key;
                  const mediaRef = { kind: 'media', id: media.id } as const;
                  setAddingMedia(true);
                  setMessage('');
                  void api<Record<string, BoardResolved>>(
                    `/projects/${projectId}/board-references/resolve`,
                    'POST',
                    {
                      references: [
                        { nodeId: nodeId.current, ref: selectedRef },
                        { nodeId: mediaNodeId.current, ref: mediaRef },
                      ],
                    },
                  )
                    .then((values) => {
                      if (!live()) return;
                      const asset = values[nodeId.current],
                        referenceMedia = values[mediaNodeId.current];
                      if (
                        !asset ||
                        asset.status === 'unavailable' ||
                        !referenceMedia?.media ||
                        referenceMedia.status === 'unavailable'
                      ) {
                        setSnapshot(undefined);
                        setError('此参考素材已不可用，请检查文件或访问权限。');
                      } else if (!actions.current.editable) setError('画布已不可编辑，未添加素材。');
                      else if (actions.current.add({ ref: mediaRef, value: referenceMedia, ready: true }))
                        setMessage('已添加参考素材到画布草稿，请保存画布。');
                      else setError('无法添加，请检查画布容量与编辑权限。');
                    })
                    .catch((reason) => {
                      if (!live()) return;
                      setSnapshot(undefined);
                      setError(reason instanceof Error ? reason.message : '无法读取参考素材');
                      reporter.current(reason);
                    })
                    .finally(() => {
                      if (live()) setAddingMedia(false);
                    });
                }}
              >
                添加此参考素材
              </StudioButton>
            )}
            {media && (
              <a href={media.downloadUrl} download>
                下载固定版本原件
              </a>
            )}
          </div>
          {message && <p role="status">{message}</p>}
        </>
      )}
    </section>
  );
}
