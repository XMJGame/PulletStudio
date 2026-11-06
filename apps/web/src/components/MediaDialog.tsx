import { useEffect, useRef, useState } from 'react';
import { api, CursorPage, uploadMediaContent } from '../api';
import { MediaAsset, MediaUpload, MediaVersion } from '../media-types';
import { Dialog } from './Dialog';
type Status = {
  available: boolean;
  maxBytes: number;
  error?: {
    message: string;
  };
  formats?: string;
};
type Versions = {
  items: MediaVersion[];
  nextCursor: number | null;
};
export function MediaDialog({
  projectId,
  onClose,
  onAddToCanvas,
}: {
  projectId: string;
  onClose: () => void;
  onAddToCanvas?: (media: MediaVersion) => Promise<void>;
}) {
  const [context, setContext] = useState<{
    projectId: string;
    canEdit: boolean;
  }>();
  const [status, setStatus] = useState<Status>();
  const [assets, setAssets] = useState<CursorPage<MediaAsset>>({ items: [], nextCursor: null });
  const [uploads, setUploads] = useState<CursorPage<MediaUpload>>({ items: [], nextCursor: null });
  const [selected, setSelected] = useState<MediaVersion>();
  const [versions, setVersions] = useState<Versions>();
  const [file, setFile] = useState<File>();
  const [target, setTarget] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [session, setSession] = useState<MediaUpload>();
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const abort = useRef<AbortController | undefined>(undefined);
  function report(reason: unknown) {
    setError(reason instanceof Error ? reason.message : '媒体操作失败');
  }
  useEffect(() => {
    let active = true;
    void (async () => {
      const access = await api<{
        canEdit: boolean;
      }>(`/projects/${projectId}/access`);
      const [state, library, pending] = await Promise.all([
        api<Status>(`/projects/${projectId}/media-status`),
        api<CursorPage<MediaAsset>>(`/projects/${projectId}/media-assets`),
        api<CursorPage<MediaUpload>>(`/projects/${projectId}/media-uploads`),
      ]);
      if (active) {
        setContext({ projectId, canEdit: access.canEdit });
        setStatus(state);
        setAssets(library);
        setUploads(pending);
      }
    })().catch((reason) => {
      if (active) report(reason);
    });
    return () => {
      active = false;
      abort.current?.abort();
    };
  }, [projectId]);
  async function refresh() {
    if (!context) return;
    const [library, pending] = await Promise.all([
      api<CursorPage<MediaAsset>>(`/projects/${context.projectId}/media-assets`),
      api<CursorPage<MediaUpload>>(`/projects/${context.projectId}/media-uploads`),
    ]);
    setAssets(library);
    setUploads(pending);
  }
  async function select(version: MediaVersion) {
    setSelected(version);
    setVersions(undefined);
    setMessage('');
    setError('');
    try {
      setVersions(await api<Versions>(`/media-assets/${version.assetId}/versions`));
    } catch (reason) {
      report(reason);
    }
  }
  async function readSession(id: string) {
    const value = await api<MediaUpload>(`/media-uploads/${id}`);
    setSession(value);
    if (value.mediaVersion) {
      await select(value.mediaVersion);
      setMessage('媒体已完成归档');
    }
    await refresh();
    return value;
  }
  async function upload() {
    if (!file || !context) return;
    setBusy(true);
    setUploading(true);
    setError('');
    setMessage('');
    const controller = new AbortController();
    abort.current = controller;
    let job = session;
    const poll = setInterval(() => {
      if (job)
        void api<MediaUpload>(`/media-uploads/${job.id}`)
          .then(setSession)
          .catch(() => undefined);
    }, 2000);
    try {
      if (!job) {
        const asset = assets.items.find((item) => item.id === target);
        job = await api<MediaUpload>(
          `/projects/${context.projectId}/media-uploads`,
          'POST',
          {
            fileName: file.name,
            byteLength: file.size,
            contentType: file.type,
            assetId: asset?.id ?? null,
            expectedAssetVersion: asset?.version ?? 0,
          },
          { 'Idempotency-Key': key },
        );
        setSession(job);
      }
      job = await api<MediaUpload>(`/media-uploads/${job.id}`);
      setSession(job);
      if (job.state === 'complete') {
        await select(job.mediaVersion!);
        setMessage('媒体已归档，已读取现有结果');
        await refresh();
        return;
      }
      if (!['created', 'failed'].includes(job.state))
        throw new Error(
          job.state === 'needs_reconciliation'
            ? '文件已归档但登记未完成，请点击“重试登记”。'
            : '此上传仍在执行，请查看状态后重试。',
        );
      const result = await uploadMediaContent<MediaUpload>(job.id, file, controller.signal);
      setSession(result);
      await select(result.mediaVersion!);
      setMessage('媒体已完成归档');
      await refresh();
    } catch (reason) {
      if (job) {
        try {
          const latest = await api<MediaUpload>(`/media-uploads/${job.id}`);
          setSession(latest);
          if (latest.state === 'complete') {
            await select(latest.mediaVersion!);
            setMessage('媒体已完成归档，已恢复上传结果');
            await refresh();
            return;
          }
        } catch {
          /* The user can read the durable status after reconnecting. */
        }
      }
      report(
        controller.signal.aborted
          ? new Error('已停止等待上传，请查看状态；未完成时可重新发送整个文件。')
          : reason,
      );
    } finally {
      clearInterval(poll);
      setBusy(false);
      setUploading(false);
      abort.current = undefined;
    }
  }
  return (
    <Dialog
      title={'项目素材'}
      description="导入参考素材，预览和下载项目图片、视频与声音，查看保存的媒体版本。"
      busy={busy}
      onClose={onClose}
    >
      <div className="dialog-body">
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="notice success">
            {message}
          </p>
        )}
        {!context ? (
          <p>正在读取媒体资料…</p>
        ) : (
          <>
            {status && !status.available && (
              <p className="notice error">
                {status.error?.message || '媒体处理暂不可用'}；既有记录仍可查看。
              </p>
            )}
            {context.canEdit && (
              <section aria-label="手工媒体上传">
                <h3>导入媒体</h3>
                <fieldset className="plain-fieldset" disabled={busy}>
                  <label>
                    上传目标
                    <select
                      aria-label="上传目标"
                      value={target}
                      onChange={(event) => {
                        setTarget(event.target.value);
                        setSession(undefined);
                        setKey(crypto.randomUUID());
                        setError('');
                      }}
                    >
                      <option value="">新建素材</option>
                      {assets.items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · 追加 v{item.version + 1}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    媒体文件
                    <input
                      aria-label="媒体文件"
                      type="file"
                      accept=".png,.jpg,.jpeg,.webp,.mp4,.mov,.m4a,.webm,.wav,.mp3,.ogg,.opus"
                      onChange={(event) => {
                        setFile(event.target.files?.[0]);
                        setSession(undefined);
                        setKey(crypto.randomUUID());
                        setError('');
                      }}
                    />
                  </label>
                  <p className="field-hint">
                    {status?.formats}。单文件最多{Math.round((status?.maxBytes ?? 0) / 1048576)}
                    MiB；失败重传整个文件。原件可能含EXIF信息，封面另行生成。
                  </p>
                  {file && (
                    <p className="field-hint">
                      {file.name} · {(file.size / 1048576).toFixed(2)} MiB
                    </p>
                  )}
                  <button
                    className="primary"
                    disabled={
                      !file || !status?.available || !!(file && status && file.size > status.maxBytes)
                    }
                    onClick={() => void upload()}
                  >
                    上传并归档
                  </button>
                </fieldset>
                {uploading && (
                  <>
                    <p role="status">正在传输、检测或归档媒体…</p>
                    <button className="danger-text" onClick={() => abort.current?.abort()}>
                      停止等待上传
                    </button>
                  </>
                )}
              </section>
            )}
            {session && (
              <section className="source-evidence" aria-label="当前上传状态">
                <strong>{session.fileName}</strong>
                <p>
                  {
                    (
                      {
                        created: '待传输',
                        uploading: '接收或检测中',
                        complete: '归档完成',
                        failed: '未完成',
                        needs_reconciliation: '待核对登记',
                      } as Record<string, string>
                    )[session.state]
                  }
                </p>
                {session.errorMessage && <p>{session.errorMessage}</p>}
                <button
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void readSession(session.id)
                      .catch(report)
                      .finally(() => setBusy(false));
                  }}
                >
                  查看上传状态
                </button>
                {session.state === 'needs_reconciliation' && context.canEdit && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      setBusy(true);
                      setError('');
                      void api<MediaUpload>(`/media-uploads/${session.id}/reconcile`, 'POST', {})
                        .then(async (value) => {
                          setSession(value);
                          if (value.mediaVersion) await select(value.mediaVersion);
                          setMessage('归档登记已恢复');
                          await refresh();
                        })
                        .catch(report)
                        .finally(() => setBusy(false));
                    }}
                  >
                    重试登记
                  </button>
                )}
              </section>
            )}
            {selected && (
              <section aria-label="媒体版本预览" className="media-preview">
                <h3>
                  {selected.fileName} · v{selected.version}
                </h3>
                {selected.mediaType === 'image' ? (
                  <img alt="导入媒体预览" src={selected.posterUrl ?? selected.contentUrl} />
                ) : selected.mediaType === 'video' ? (
                  <video
                    key={selected.id}
                    controls
                    playsInline
                    preload="metadata"
                    src={selected.contentUrl}
                    poster={selected.posterUrl ?? undefined}
                    onError={() => setError('浏览器暂不能播放此媒体，请核对编码或下载原件。')}
                  />
                ) : (
                  <audio
                    key={selected.id}
                    controls
                    preload="metadata"
                    src={selected.contentUrl}
                    onError={() => setError('浏览器暂不能播放此声音，请核对编码或下载原件。')}
                  />
                )}
                <p className="field-hint">
                  {selected.mime} ·{' '}
                  {selected.metadata.width ? `${selected.metadata.width}×${selected.metadata.height} · ` : ''}
                  {selected.metadata.durationMs !== null
                    ? `${(selected.metadata.durationMs / 1000).toFixed(2)}秒 · `
                    : ''}
                  {selected.metadata.hasAudio ? '含声音流' : '不含声音流'}
                </p>
                <div className="review-actions">
                  <a href={selected.downloadUrl} download>
                    下载原件
                  </a>
                  {onAddToCanvas && (
                    <button
                      disabled={busy}
                      onClick={() => {
                        void onAddToCanvas(selected).catch((reason) =>
                          setError(reason instanceof Error ? reason.message : '无法添加到画布'),
                        );
                      }}
                    >
                      添加到画布
                    </button>
                  )}
                </div>
                {versions && (
                  <div className="review-actions">
                    {versions.items.map((item) => (
                      <button
                        key={item.id}
                        disabled={busy}
                        onClick={() => {
                          setSelected(item);
                        }}
                      >
                        查看媒体 v{item.version}
                      </button>
                    ))}
                    {versions.nextCursor && (
                      <button
                        disabled={busy}
                        onClick={() => {
                          setBusy(true);
                          void api<Versions>(
                            `/media-assets/${selected.assetId}/versions?before=${versions.nextCursor}`,
                          )
                            .then((value) =>
                              setVersions((previous) => ({
                                ...value,
                                items: [...(previous?.items ?? []), ...value.items],
                              })),
                            )
                            .catch(report)
                            .finally(() => setBusy(false));
                        }}
                      >
                        更多媒体版本
                      </button>
                    )}
                  </div>
                )}
              </section>
            )}

            <h3>项目素材</h3>
            <button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void refresh()
                  .catch(report)
                  .finally(() => setBusy(false));
              }}
            >
              刷新素材列表
            </button>
            <div className="media-library">
              {assets.items.map((asset) => (
                <article key={asset.id}>
                  <button disabled={busy} onClick={() => void select(asset.latest)}>
                    {asset.latest.posterUrl && <img alt="" src={asset.latest.posterUrl} loading="lazy" />}
                    <span>
                      {asset.name} · v{asset.version}
                    </span>
                  </button>
                </article>
              ))}
            </div>
            {assets.nextCursor && (
              <button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void api<CursorPage<MediaAsset>>(
                    `/projects/${context.projectId}/media-assets?cursor=${assets.nextCursor}`,
                  )
                    .then((value) =>
                      setAssets((previous) => ({ ...value, items: [...previous.items, ...value.items] })),
                    )
                    .catch(report)
                    .finally(() => setBusy(false));
                }}
              >
                更多项目素材
              </button>
            )}
            <h3>我的上传记录</h3>
            {uploads.items.map((item) => (
              <button
                key={item.id}
                className="revision-item"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void readSession(item.id)
                    .catch(report)
                    .finally(() => setBusy(false));
                }}
              >
                查看上传 · {item.fileName} ·{' '}
                {
                  (
                    {
                      created: '待传输',
                      uploading: '处理中',
                      complete: '已归档',
                      failed: '未完成',
                      needs_reconciliation: '待登记',
                    } as Record<string, string>
                  )[item.state]
                }
              </button>
            ))}
            {uploads.nextCursor && (
              <button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void api<CursorPage<MediaUpload>>(
                    `/projects/${context.projectId}/media-uploads?cursor=${uploads.nextCursor}`,
                  )
                    .then((value) =>
                      setUploads((previous) => ({ ...value, items: [...previous.items, ...value.items] })),
                    )
                    .catch(report)
                    .finally(() => setBusy(false));
                }}
              >
                更多上传记录
              </button>
            )}
          </>
        )}
      </div>
      <div className="dialog-footer">
        <button disabled={busy} onClick={onClose}>
          关闭
        </button>
      </div>
    </Dialog>
  );
}
