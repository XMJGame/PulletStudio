import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { Dialog } from '../components/Dialog';
import { TakeReviewPanel } from '../components/TakeReviewPanel';
import { type MediaVersion, type Take, type TakeSelection, takeReviewLabels } from '../media-types';

type TakePage = { items: Take[]; nextCursor: number | null };
const takeName = (take: Take) => `Take ${String(take.takeNo).padStart(2, '0')}`;

function CandidatePreview({ media, label }: { media: MediaVersion; label: string }) {
  const [broken, setBroken] = useState(false);
  if (broken)
    return (
      <p className="notice error" role="status">
        无法预览此媒体。请核对文件、权限或浏览器编码。
      </p>
    );
  if (media.mediaType === 'image')
    return <img src={media.contentUrl} alt={label} onError={() => setBroken(true)} />;
  if (media.mediaType === 'video')
    return (
      <video
        src={media.contentUrl}
        aria-label={label}
        poster={media.posterUrl ?? undefined}
        preload="metadata"
        playsInline
        controls
        onError={() => setBroken(true)}
      />
    );
  return (
    <audio
      src={media.contentUrl}
      aria-label={label}
      preload="metadata"
      controls
      onError={() => setBroken(true)}
    />
  );
}

export function ShotTakeCompareDialog({
  shotId,
  title,
  onClose,
  onPin,
}: {
  shotId: string;
  title: string;
  onClose: () => void;
  onPin?: (media: MediaVersion) => Promise<void>;
}) {
  const [takes, setTakes] = useState<TakePage>();
  const [selection, setSelection] = useState<TakeSelection>();
  const [pair, setPair] = useState<[string, string]>(['', '']);
  const [reviewId, setReviewId] = useState('');
  const [busy, setBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const path = `/shots/${shotId}`;
  const locked = busy || reviewBusy;

  function accept(page: TakePage, nextSelection: TakeSelection) {
    setTakes(page);
    setSelection(nextSelection);
    setPair(([previousA, previousB]) => {
      const first = page.items.find((take) => take.id === previousA) ?? page.items[0];
      const second =
        page.items.find((take) => take.id === previousB && take.id !== first?.id) ??
        page.items.find((take) => take.id !== first?.id);
      return [first?.id ?? '', second?.id ?? ''];
    });
  }
  function request() {
    return Promise.all([api<TakePage>(`${path}/takes`), api<TakeSelection>(`${path}/take-selection`)]);
  }
  function report(failure: unknown) {
    if (failure instanceof ApiError && [401, 403, 404].includes(failure.status)) {
      setTakes(undefined);
      setSelection(undefined);
      setReviewId('');
    }
    setError(failure instanceof Error ? failure.message : '读取候选失败');
  }
  useEffect(() => {
    let active = true;
    setBusy(true);
    void request()
      .then(([page, nextSelection]) => {
        if (active) accept(page, nextSelection);
      })
      .catch((failure) => {
        if (active) report(failure);
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [shotId]);
  async function refresh() {
    accept(...(await request()));
  }
  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await operation();
    } catch (failure) {
      report(failure);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="比较镜头候选"
      description={title}
      className="creative-take-compare"
      busy={locked}
      onClose={onClose}
    >
      <div className="dialog-body">
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="notice success" role="status">
            {message}
          </p>
        )}
        <div className="review-actions">
          <button disabled={locked} onClick={() => void run(refresh)}>
            刷新候选
          </button>
          {pair[0] && pair[1] && (
            <button disabled={locked} onClick={() => setPair(([a, b]) => [b, a])}>
              交换 A / B
            </button>
          )}
          {takes?.nextCursor && (
            <button
              disabled={locked}
              onClick={() =>
                void run(async () => {
                  const next = await api<TakePage>(`${path}/takes?before=${takes.nextCursor}`);
                  setTakes({ ...next, items: [...takes.items, ...next.items] });
                })
              }
            >
              更多候选
            </button>
          )}
        </div>
        {selection && (
          <p className="field-hint">
            {selection.takeId
              ? `当前选片 Take ${String(selection.takeNo).padStart(2, '0')} · ${selection.valid ? '有效' : '已失效'}`
              : '当前尚未选片'}
          </p>
        )}
        {!takes && busy && <p role="status">正在读取镜头候选…</p>}
        {takes?.items.length === 0 && <p>此镜头还没有候选。生成归档后可在此比较。</p>}
        {Boolean(takes?.items.length) && (
          <div className="creative-take-grid">
            {pair.map((id, index) => {
              const take = takes?.items.find((item) => item.id === id);
              const label = index === 0 ? '候选 A' : '候选 B';
              return (
                <section className="panel creative-take-slot" key={label} aria-label={label}>
                  <label>
                    {label}
                    <select
                      aria-label={label}
                      value={id}
                      disabled={locked || (!id && takes?.items.length === 1)}
                      onChange={(event) => {
                        const value = event.target.value;
                        setPair(([a, b]) => (index === 0 ? [value, b] : [a, value]));
                      }}
                    >
                      <option value="" disabled>
                        等待另一条候选
                      </option>
                      {takes?.items.map((item) => (
                        <option key={item.id} value={item.id} disabled={item.id === pair[1 - index]}>
                          {takeName(item)} · {item.media.fileName}
                        </option>
                      ))}
                    </select>
                  </label>
                  {take ? (
                    <>
                      <CandidatePreview key={take.media.id} media={take.media} label={`${label}预览`} />
                      <p className="field-hint">
                        {takeName(take)} · 媒体 v{take.media.version} ·{' '}
                        {takeReviewLabels[take.review?.status ?? 'draft']}
                        {take.review?.stale && ' · 审核依据已变化'}
                        {selection?.valid && selection.takeId === take.id && ' · 当前选片'}
                      </p>
                      <p className="field-hint">
                        {take.media.fileName}
                        {take.media.metadata.width &&
                          ` · ${take.media.metadata.width}×${take.media.metadata.height}`}
                        {take.media.metadata.durationMs !== null &&
                          ` · ${(take.media.metadata.durationMs / 1000).toFixed(2)} 秒`}
                      </p>
                      <div className="review-actions">
                        <button
                          disabled={locked}
                          aria-pressed={reviewId === take.id}
                          onClick={() => setReviewId(reviewId === take.id ? '' : take.id)}
                        >
                          查看候选审核
                        </button>
                        {onPin && (
                          <button
                            disabled={locked}
                            onClick={() =>
                              void run(async () => {
                                await onPin(take.media);
                                setMessage('已将固定媒体加入画布草稿。');
                              })
                            }
                          >
                            加入画布
                          </button>
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="field-hint">有第二条候选后可同屏比较。</p>
                  )}
                </section>
              );
            })}
          </div>
        )}
        {reviewId && pair.includes(reviewId) && takes?.items.some((item) => item.id === reviewId) && (
          <TakeReviewPanel
            key={reviewId}
            takeId={reviewId}
            shotId={shotId}
            onChanged={(review, nextSelection) => {
              setSelection(nextSelection);
              setTakes(
                (page) =>
                  page && {
                    ...page,
                    items: page.items.map((take) => (take.id === reviewId ? { ...take, review } : take)),
                  },
              );
            }}
            onBusyChange={setReviewBusy}
          />
        )}
      </div>
      <div className="dialog-footer">
        <button disabled={locked} onClick={onClose}>
          关闭比较
        </button>
      </div>
    </Dialog>
  );
}
