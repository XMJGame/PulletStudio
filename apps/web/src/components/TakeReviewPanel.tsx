import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { TakeReview, TakeSelection, takeReviewLabels } from '../media-types';

type Action = 'submit' | 'withdraw' | 'approve' | 'reject' | 'revoke';
const actionLabels: Record<Action, string> = {
  submit: '提交审核',
  withdraw: '撤回提审',
  approve: '批准候选',
  reject: '拒绝候选',
  revoke: '撤销批准',
};
export function TakeReviewPanel({
  takeId,
  shotId,
  onChanged,
  onBusyChange,
}: {
  takeId: string;
  shotId: string;
  onChanged: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const [review, setReview] = useState<TakeReview>();
  const [selection, setSelection] = useState<TakeSelection>();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const request = useRef<{ fingerprint: string; key: string } | undefined>(undefined);
  useEffect(() => {
    let active = true;
    void Promise.all([
      api<TakeReview>(`/takes/${takeId}/reviews`),
      api<TakeSelection>(`/shots/${shotId}/take-selection`),
    ])
      .then(([nextReview, nextSelection]) => {
        if (active) {
          setReview(nextReview);
          setSelection(nextSelection);
        }
      })
      .catch((failure) => {
        if (active) setError(failure instanceof Error ? failure.message : '读取审核记录失败');
      });
    return () => {
      active = false;
    };
  }, [takeId, shotId]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    onBusyChange(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '审核操作失败');
    } finally {
      setBusy(false);
      onBusyChange(false);
    }
  }
  async function refresh() {
    const [nextReview, nextSelection] = await Promise.all([
      api<TakeReview>(`/takes/${takeId}/reviews`),
      api<TakeSelection>(`/shots/${shotId}/take-selection`),
    ]);
    setReview(nextReview);
    setSelection(nextSelection);
    await onChanged();
  }
  async function post(path: string, body: object) {
    if (!reason.trim()) throw new Error('请填写审核或选片理由。');
    const fingerprint = path + JSON.stringify(body);
    if (request.current?.fingerprint !== fingerprint)
      request.current = { fingerprint, key: crypto.randomUUID() };
    await api(path, 'POST', body, { 'Idempotency-Key': request.current.key });
    await refresh();
    request.current = undefined;
    setReason('');
  }
  const actions: Action[] = [];
  if (review?.canEdit && ['draft', 'rejected', 'revoked'].includes(review.status)) actions.push('submit');
  if (review?.canEdit && review.status === 'submitted') actions.push('withdraw');
  if (review?.canReview && review.status === 'submitted') {
    if (!review.stale) actions.push('approve');
    actions.push('reject');
  }
  if (review?.canReview && review.status === 'approved') actions.push('revoke');
  return (
    <section aria-label="候选审核">
      <h3>候选审核</h3>
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
      <button type="button" disabled={busy} onClick={() => void run(refresh)}>
        刷新审核与选片
      </button>
      {review && selection && (
        <>
          <p>
            Take {String(review.takeNo).padStart(2, '0')} · {takeReviewLabels[review.status]}
          </p>
          {review.context && (
            <p className="field-hint">
              审核依据 · 制作卡 v{review.context.shotVersion} · 项目 v{review.context.projectVersion}
              {review.source
                ? ` · 生成来源制作卡 v${review.source.shotVersion} / 提示词快照`
                : ' · 手工关联媒体'}
            </p>
          )}
          {review.stale && (
            <p className="notice">
              审核依据的制作卡或项目已变化。待审核候选需撤回后重新提审，已批准候选需先撤销批准。
            </p>
          )}
          <p>
            镜头选片 ·{' '}
            {selection.takeId
              ? `Take ${String(selection.takeNo).padStart(2, '0')}${selection.valid ? '（有效）' : '（已失效，需要重新审核或选用）'}`
              : '尚未选用'}
          </p>
          {(review.canEdit || review.canReview) && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const action = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null)
                  ?.value as Action;
                if (!actions.includes(action)) return;
                void run(async () => {
                  await post(`/takes/${takeId}/reviews`, {
                    action,
                    reason,
                    expectedDecisionVersion: review.decisionVersion,
                  });
                  setMessage('审核记录已保存。');
                });
              }}
            >
              <fieldset className="plain-fieldset" disabled={busy}>
                <label>
                  审核或选片理由
                  <textarea
                    value={reason}
                    required
                    maxLength={1000}
                    rows={2}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
                <div className="review-actions">
                  {actions.map((action) => (
                    <button key={action} value={action}>
                      {actionLabels[action]}
                    </button>
                  ))}
                  {review.canReview &&
                    review.status === 'approved' &&
                    !review.stale &&
                    (selection.takeId !== takeId || !selection.valid) && (
                      <button
                        type="button"
                        onClick={() =>
                          void run(async () => {
                            await post(`/shots/${shotId}/take-selection`, {
                              takeId,
                              reason,
                              expectedSelectionVersion: selection.version,
                            });
                            setMessage('已选用此批准版本。');
                          })
                        }
                      >
                        选用此候选
                      </button>
                    )}
                  {selection.canReview && selection.takeId && (
                    <button
                      type="button"
                      onClick={() =>
                        void run(async () => {
                          await post(`/shots/${shotId}/take-selection`, {
                            takeId: null,
                            reason,
                            expectedSelectionVersion: selection.version,
                          });
                          setMessage('已清除镜头选片。');
                        })
                      }
                    >
                      清除镜头选片
                    </button>
                  )}
                </div>
              </fieldset>
            </form>
          )}
          <details>
            <summary>审核历史</summary>
            {!review.items.length && <p className="field-hint">尚无审核记录。</p>}
            {review.items.map((item) => (
              <article className="revision-item" key={item.id}>
                <strong>
                  {actionLabels[item.action]} · {item.actorName}
                </strong>
                <p>{item.reason}</p>
                <p className="field-hint">
                  制作卡 v{item.shotVersion} · 项目 v{item.projectVersion} ·{' '}
                  {new Date(item.createdAt).toLocaleString()}
                </p>
              </article>
            ))}
            {review.nextCursor && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const more = await api<TakeReview>(
                      `/takes/${takeId}/reviews?before=${review.nextCursor}`,
                    );
                    setReview({ ...more, items: [...review.items, ...more.items] });
                  })
                }
              >
                更多审核记录
              </button>
            )}
          </details>
          <details>
            <summary>选片历史</summary>
            {!selection.items.length && <p className="field-hint">尚无选片记录。</p>}
            {selection.items.map((item) => (
              <article className="revision-item" key={item.id}>
                <strong>
                  {item.takeId ? `选用 Take ${String(item.takeNo).padStart(2, '0')}` : '清除选片'} ·{' '}
                  {item.actorName}
                </strong>
                <p>{item.reason}</p>
                <p className="field-hint">{new Date(item.createdAt).toLocaleString()}</p>
              </article>
            ))}
            {selection.nextCursor && (
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const more = await api<TakeSelection>(
                      `/shots/${shotId}/take-selection?before=${selection.nextCursor}`,
                    );
                    setSelection({ ...more, items: [...selection.items, ...more.items] });
                  })
                }
              >
                更多选片记录
              </button>
            )}
          </details>
        </>
      )}
    </section>
  );
}
