import { useEffect, useState } from 'react';
import { api } from '../api';
import { Entity, approvalLabels, roleLabels, attributeLabels } from '../entity-types';

type DecisionPage = {
  status: keyof typeof approvalLabels;
  decisionVersion: number;
  items: { id: string; action: 'approve' | 'revoke'; reason: string; actorName: string; createdAt: string }[];
  nextCursor: number | null;
};

export function AssetApprovalPanel({
  entity,
  disabled,
  onStatus,
}: {
  entity: Entity;
  disabled: boolean;
  onStatus: (status: DecisionPage['status']) => void;
}) {
  const revision = entity.revision;
  const path = `/entities/${entity.id}/revisions/${revision.version}/decisions`;
  const [page, setPage] = useState<DecisionPage>();
  const [reason, setReason] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    let active = true;
    void api<DecisionPage>(path)
      .then((value) => {
        if (active) setPage(value);
      })
      .catch(() => {
        if (active) setError('读取审批记录失败，请刷新。');
      });
    return () => {
      active = false;
    };
  }, [path]);
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '审批操作失败');
    } finally {
      setBusy(false);
    }
  }
  async function refresh() {
    const value = await api<DecisionPage>(path);
    setPage(value);
    onStatus(value.status);
  }
  const action = page?.status === 'approved' ? 'revoke' : 'approve';
  const actionLabel = action === 'approve' ? '批准此版本' : '撤销此版本的批准';
  return (
    <section aria-label="资产版本审批">
      <h3>资产版本审批</h3>
      <p role="status">
        {revision.name} · v{revision.version} · {approvalLabels[page?.status ?? revision.status]}
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() =>
          void run(async () => {
            await refresh();
            setConfirm(false);
            setKey(crypto.randomUUID());
          })
        }
      >
        刷新审批记录
      </button>
      {entity.canReview && page && (
        <>
          <details>
            <summary>核对已保存的版本内容</summary>
            <p>{revision.description}</p>
            {Object.entries(attributeLabels[revision.kind])
              .filter(([name]) => revision.attributes[name])
              .map(([name, label]) => (
                <p key={name}>
                  <strong>{label}</strong> · {revision.attributes[name]}
                </p>
              ))}
            {revision.media.map((media) => (
              <div className="entity-reference" key={media.role + media.mediaVersionId}>
                <span>
                  {roleLabels[media.role]} · {media.fileName} · v{media.version}
                </span>
                {media.mediaType === 'image' && (
                  <img
                    loading="lazy"
                    src={`/api/v1/media-versions/${media.mediaVersionId}/poster`}
                    alt={`${roleLabels[media.role]}审核参考图`}
                  />
                )}
                {media.mediaType === 'audio' && (
                  <audio
                    controls
                    preload="none"
                    aria-label="审核声音样本"
                    src={`/api/v1/media-versions/${media.mediaVersionId}/content`}
                  />
                )}
              </div>
            ))}
          </details>
          {!confirm && (
            <button type="button" disabled={disabled || busy} onClick={() => setConfirm(true)}>
              {actionLabel}
            </button>
          )}
          {confirm && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  await api(
                    path,
                    'POST',
                    { action, reason, expectedDecisionVersion: page.decisionVersion },
                    { 'Idempotency-Key': key },
                  );
                  await refresh();
                  setConfirm(false);
                  setReason('');
                  setKey(crypto.randomUUID());
                });
              }}
            >
              <p className="field-hint">
                正在审核已保存的 v{revision.version}。
                {action === 'revoke' && '撤销后，引用此版本的镜头将无法通过资产准入。'}
              </p>
              <label>
                审批理由
                <textarea
                  required
                  maxLength={1000}
                  rows={2}
                  value={reason}
                  disabled={busy || disabled}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setKey(crypto.randomUUID());
                  }}
                />
              </label>
              <div className="review-actions">
                <button type="button" disabled={disabled || busy} onClick={() => setConfirm(false)}>
                  取消审批操作
                </button>
                <button className="primary" disabled={disabled || busy || !reason.trim()}>
                  确认{actionLabel}
                </button>
              </div>
            </form>
          )}
        </>
      )}
      {page?.items.map((item) => (
        <article key={item.id} className="entity-reference">
          <div>
            <strong>
              {item.action === 'approve' ? '批准' : '撤销批准'} · {item.actorName}
            </strong>
            <p>{item.reason}</p>
            <small>{new Date(item.createdAt).toLocaleString()}</small>
          </div>
        </article>
      ))}
      {page?.nextCursor && (
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() =>
            void run(async () => {
              const more = await api<DecisionPage>(`${path}?before=${page.nextCursor}`);
              setPage({ ...more, items: [...page.items, ...more.items] });
              if (more.decisionVersion !== page.decisionVersion) {
                await refresh();
                setConfirm(false);
                setKey(crypto.randomUUID());
              }
            })
          }
        >
          更早审批记录
        </button>
      )}
    </section>
  );
}
