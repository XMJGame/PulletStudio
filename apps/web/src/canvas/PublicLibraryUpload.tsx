import { useEffect, useRef, useState } from 'react';
import { api, uploadBinaryContent, type CursorPage } from '../api';
import { mediaFileAccept, type MediaStatus } from '../media-upload';
import './public-library-upload.css';
type Upload = {
  id: string;
  fileName: string;
  expectedBytes: number;
  receivedBytes: number;
  state: string;
  errorMessage: string | null;
  resourceId: string | null;
  removed: boolean;
};
type Entry = { key: string; file?: File; folderId: string | null; session?: Upload; error?: string };
export function PublicLibraryUpload({
  workspaceId,
  folderId,
  onBusyChange,
  onComplete,
}: {
  workspaceId: string;
  folderId: string;
  onBusyChange: (value: boolean) => void;
  onComplete: () => void;
}) {
  const [expanded, setExpanded] = useState(false),
    [status, setStatus] = useState<MediaStatus>(),
    [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0),
    [cursor, setCursor] = useState<string | null>(null);
  const live = useRef(true),
    running = useRef(false),
    abort = useRef<AbortController | undefined>(undefined),
    input = useRef<HTMLInputElement>(null);
  const callbacks = useRef({ onBusyChange, onComplete });
  callbacks.current = { onBusyChange, onComplete };
  const base = `/workspaces/${workspaceId}/public-library`;
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      abort.current?.abort();
    };
  }, []);
  useEffect(() => {
    onBusyChange(busy);
  }, [busy, onBusyChange]);
  function merge(rows: Upload[]) {
    setEntries((old) => [
      ...old,
      ...rows
        .filter((row) => !old.some((entry) => entry.session?.id === row.id))
        .map((session) => ({ key: crypto.randomUUID(), session, folderId: null })),
    ]);
  }
  useEffect(() => {
    if (!expanded) return;
    let active = true;
    setLoading(true);
    setError('');
    Promise.all([api<MediaStatus>(`${base}/media-status`), api<CursorPage<Upload>>(`${base}/media-uploads`)])
      .then(
        ([capabilities, rows]) => {
          if (active) {
            setStatus(capabilities);
            merge(rows.items);
            setCursor(rows.nextCursor);
          }
        },
        (reason) => {
          if (active) setError(reason.message || '无法读取上传状态');
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [expanded, base, retry]);
  function patch(key: string, value: Partial<Entry>) {
    if (live.current)
      setEntries((old) => old.map((entry) => (entry.key === key ? { ...entry, ...value } : entry)));
  }
  function choose(files: File[]) {
    if (files.length > 20) {
      setError('一次最多选择 20 份文件');
      return;
    }
    if (status && files.some((file) => file.size > status.maxBytes || file.size === 0)) {
      setError(`请选择非空且不超过 ${Math.floor(status.maxBytes / 1024 / 1024)} MB 的文件`);
      return;
    }
    setError('');
    setEntries((old) => [
      ...old,
      ...files.map((file) => ({
        key: crypto.randomUUID(),
        file,
        folderId: folderId && folderId !== 'root' ? folderId : null,
      })),
    ]);
  }
  async function run(selected: Entry[]) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    abort.current = controller;
    let completed = false;
    try {
      for (const entry of selected) {
        if (controller.signal.aborted) break;
        if (
          entry.session?.state === 'complete' ||
          (!entry.file && entry.session?.state !== 'needs_reconciliation')
        )
          continue;
        let session = entry.session;
        let observing = true;
        patch(entry.key, { error: undefined });
        const accept = (value: Upload) => {
          session = value;
          patch(entry.key, { session: value });
          return value;
        };
        const poll = setInterval(() => {
          if (session)
            void api<Upload>(`${base}/media-uploads/${session.id}`)
              .then((value) => {
                if (observing && live.current && !controller.signal.aborted)
                  patch(entry.key, { session: value });
              })
              .catch(() => undefined);
        }, 2000);
        try {
          controller.signal.throwIfAborted();
          if (!session)
            accept(
              await api<Upload>(
                `${base}/media-uploads`,
                'POST',
                {
                  fileName: entry.file!.name,
                  byteLength: entry.file!.size,
                  contentType: entry.file!.type,
                  folderId: entry.folderId,
                },
                { 'Idempotency-Key': entry.key },
              ),
            );
          accept(await api<Upload>(`${base}/media-uploads/${session!.id}`));
          controller.signal.throwIfAborted();
          if (session!.state === 'needs_reconciliation')
            accept(await api<Upload>(`${base}/media-uploads/${session!.id}/reconcile`, 'POST', {}));
          else if (['created', 'failed'].includes(session!.state))
            accept(
              await uploadBinaryContent<Upload>(
                `${base}/media-uploads/${session!.id}/content`,
                entry.file!,
                controller.signal,
              ),
            );
          if (session!.state !== 'complete') throw new Error('上传仍在执行，请稍后读取状态再重试');
          completed = true;
        } catch (reason) {
          let recovered = false;
          if (session)
            try {
              const latest = accept(await api<Upload>(`${base}/media-uploads/${session.id}`));
              recovered = latest.state === 'complete';
              if (recovered) completed = true;
            } catch {
              /* Retry keeps the original request key and server state. */
            }
          if (!recovered)
            patch(entry.key, {
              error: controller.signal.aborted
                ? '已停止等待，可重新选择同一文件重试'
                : reason instanceof Error
                  ? reason.message
                  : '上传失败，请重试',
            });
        } finally {
          observing = false;
          clearInterval(poll);
        }
      }
    } finally {
      running.current = false;
      if (live.current) {
        setBusy(false);
        if (completed) callbacks.current.onComplete();
      }
    }
  }
  async function refresh(entry: Entry) {
    if (!entry.session || busy) return;
    try {
      patch(entry.key, {
        session: await api<Upload>(`${base}/media-uploads/${entry.session.id}`),
        error: undefined,
      });
    } catch (reason) {
      patch(entry.key, { error: reason instanceof Error ? reason.message : '状态读取失败' });
    }
  }
  const ready = entries.filter(
    (entry) =>
      entry.session?.state !== 'complete' && (entry.file || entry.session?.state === 'needs_reconciliation'),
  );
  return (
    <section className="creative-public-upload" aria-label="公共库上传">
      <button aria-expanded={expanded} disabled={busy} onClick={() => setExpanded((value) => !value)}>
        上传素材
      </button>
      {expanded && (
        <div className="creative-public-upload-content">
          <p className="field-hint">
            上传完成后，当前工作区成员可浏览和使用。素材保存在公共库，随后可添加到项目。
          </p>
          {loading && <p role="status">正在读取上传能力…</p>}
          {error && (
            <p role="alert">
              {error}
              <button disabled={busy} onClick={() => setRetry((value) => value + 1)}>
                重新读取上传状态
              </button>
            </p>
          )}
          {status && !status.available && (
            <p role="alert">
              {status.error?.message || '媒体存储暂不可用'}
              <button disabled={busy} onClick={() => setRetry((value) => value + 1)}>
                重新检测媒体服务
              </button>
            </p>
          )}
          {status?.available && (
            <>
              <p className="field-hint">
                {status.formats} · 单文件上限 {Math.floor(status.maxBytes / 1024 / 1024)} MB
              </p>
              <label>
                选择公共素材
                <input
                  ref={input}
                  type="file"
                  aria-label="选择公共素材"
                  accept={mediaFileAccept}
                  multiple
                  disabled={busy}
                  onChange={(event) => {
                    choose([...(event.target.files ?? [])]);
                    event.target.value = '';
                  }}
                />
              </label>
              <button disabled={busy || !ready.length} onClick={() => void run(ready)}>
                开始上传
              </button>
            </>
          )}
          {busy && (
            <p role="status">
              正在上传和归档，请稍候…<button onClick={() => abort.current?.abort()}>停止等待</button>
            </p>
          )}
          {entries.length > 0 && (
            <ul className="creative-public-upload-list">
              {entries.map((entry) => (
                <li key={entry.key}>
                  <strong>{entry.file?.name ?? entry.session?.fileName}</strong>
                  <span>
                    {entry.session?.state === 'complete'
                      ? entry.session.removed
                        ? '此前归档的条目已移出公共库'
                        : '已归档到公共库'
                      : entry.session?.state === 'needs_reconciliation'
                        ? '原件已归档，等待重试登记'
                        : entry.session?.state === 'uploading'
                          ? `正在上传 · ${Math.round((entry.session.receivedBytes / entry.session.expectedBytes) * 100)}%`
                          : entry.session?.state === 'failed'
                            ? '上传失败，可重试'
                            : '等待上传'}
                  </span>
                  {(entry.error || entry.session?.errorMessage) && (
                    <p role="alert">{entry.error || entry.session?.errorMessage}</p>
                  )}
                  {entry.session && ['created', 'failed'].includes(entry.session.state) && (
                    <label>
                      重新选择同一文件
                      <input
                        type="file"
                        aria-label={`继续上传 ${entry.session.fileName}`}
                        disabled={busy}
                        accept={mediaFileAccept}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) {
                            if (
                              file.name.trim() !== entry.session!.fileName ||
                              file.size !== entry.session!.expectedBytes
                            )
                              patch(entry.key, { error: '请选择名称和大小相同的原文件' });
                            else patch(entry.key, { file, error: undefined });
                          }
                          event.target.value = '';
                        }}
                      />
                    </label>
                  )}
                  {entry.session?.state === 'needs_reconciliation' && (
                    <button disabled={busy} onClick={() => void run([entry])}>
                      重试登记
                    </button>
                  )}
                  {entry.session && entry.session.state !== 'complete' && (
                    <button disabled={busy} onClick={() => void refresh(entry)}>
                      读取此上传状态
                    </button>
                  )}
                  {!entry.session && (
                    <button
                      disabled={busy}
                      onClick={() => setEntries((old) => old.filter((row) => row.key !== entry.key))}
                    >
                      移出待上传列表
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {cursor && (
            <button
              disabled={busy || loading}
              onClick={async () => {
                setLoading(true);
                try {
                  const rows = await api<CursorPage<Upload>>(`${base}/media-uploads?cursor=${cursor}`);
                  merge(rows.items);
                  setCursor(rows.nextCursor);
                } catch (reason) {
                  setError(reason instanceof Error ? reason.message : '无法读取更多上传');
                } finally {
                  setLoading(false);
                }
              }}
            >
              更多未完成上传
            </button>
          )}
        </div>
      )}
    </section>
  );
}
