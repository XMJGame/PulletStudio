import { useEffect, useRef, useState } from 'react';
import type { BoardResolved, BoardSource } from '../../../../packages/contracts/src/board';
import { api } from '../api';
import { StudioButton } from '../shared/ui/StudioUI';
import { kindLabels, statusLabels } from './board-types';
import './board-source-preview.css';

export function BoardSourcePreview({
  projectId,
  source,
  editable,
  add,
  report,
  onBack,
}: {
  projectId: string;
  source: BoardSource;
  editable: boolean;
  add: (source: BoardSource) => boolean;
  report: (reason: unknown) => void;
  onBack: () => void;
}) {
  const [value, setValue] = useState<BoardResolved>();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const ref = useRef<HTMLElement>(null);
  const nodeId = useRef(crypto.randomUUID());
  const reporter = useRef(report);
  reporter.current = report;
  const reference = JSON.stringify(source.ref);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  useEffect(() => {
    let active = true;
    setValue(undefined);
    setLoading(true);
    setError('');
    setMessage('');
    void api<Record<string, BoardResolved>>(`/projects/${projectId}/board-references/resolve`, 'POST', {
      references: [{ nodeId: nodeId.current, ref: JSON.parse(reference) }],
    })
      .then((values) => {
        if (!active) return;
        const resolved = values[nodeId.current];
        if (!resolved || resolved.status === 'unavailable')
          setError('此资源已不可用，请检查文件或访问权限。');
        else setValue(resolved);
      })
      .catch((reason) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : '无法读取资源');
          reporter.current(reason);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId, reference, retry]);
  const failed = () => {
    setValue(undefined);
    setError('预览无法读取或播放，请检查文件或访问权限。');
  };
  const media = value?.media;
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
            {editable && (
              <StudioButton
                variant="primary"
                icon="plus"
                onClick={() => {
                  if (!editable) return;
                  if (add({ ref: source.ref, value, ready: true }))
                    setMessage('已添加到画布草稿，请保存画布。');
                  else setError('无法添加，请检查画布容量与编辑权限。');
                }}
              >
                添加到画布
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
