import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { DraftShot, ProposalReview } from '../analysis-types';
import { Dialog } from './Dialog';
import { CandidateEditorDialog } from './CandidateEditorDialog';
import { ReviewDecisionDialog } from './ReviewDecisionDialog';
import { ShotDraftDetails } from './ShotDraftDetails';
import { ShotCardDialog } from './ShotCardDialog';
type History = {
  items: { version: number; summary: string; authorName: string }[];
  nextCursor: number | null;
};
export function ProposalReviewPanel({
  incoming,
  onChanged,
  onUnauthorized,
}: {
  incoming: ProposalReview;
  onChanged: (value: ProposalReview) => void;
  onUnauthorized: () => void;
}) {
  const [review, setReview] = useState(incoming);
  const [editing, setEditing] = useState<number>();
  const [decision, setDecision] = useState<'accept' | 'reject' | 'reopen'>();
  const [history, setHistory] = useState<History>();
  const [snapshot, setSnapshot] = useState<{
    version: number;
    body: ProposalReview['body'];
    summary: string;
  }>();
  const [cardId, setCardId] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setReview((current) => (incoming.version >= current.version ? incoming : current));
  }, [incoming]);
  const label = review.status === 'accepted' ? '已采纳' : review.status === 'rejected' ? '已拒绝' : '待审核';
  const missingDuration = review.body.shots.some(
    (shot) => !Number.isInteger(shot.durationSeconds) || !shot.durationSeconds || shot.durationSeconds > 3600,
  );
  function report(reason: unknown) {
    if (reason instanceof ApiError && reason.status === 401) onUnauthorized();
    setError(reason instanceof Error ? reason.message : '操作失败');
  }
  function saved(value: ProposalReview) {
    setReview(value);
    setEditing(undefined);
    setDecision(undefined);
    setHistory(undefined);
    setError('');
    setMessage(
      value.status === 'accepted'
        ? `已采纳并关联 ${value.adoptedShots.length} 个正式镜头。`
        : value.status === 'rejected'
          ? '草案已拒绝，理由和历史已保存。'
          : '草案修订已保存',
    );
    onChanged(value);
  }
  return (
    <div className="proposal-preview" aria-label="分镜草案预览">
      <div className="section-heading">
        <h3>{review.body.title}</h3>
        <span className="badge">
          {label} · 草案 v{review.version}
        </span>
      </div>
      <p>{review.body.summary}</p>
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
      <div className="review-actions">
        <button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void api<History>(`/proposals/${review.id}/versions`)
              .then(setHistory)
              .catch(report)
              .finally(() => setBusy(false));
          }}
        >
          查看草案修订
        </button>
        {review.status === 'draft' && review.canReview && (
          <>
            <button onClick={() => setDecision('reject')}>拒绝草案</button>
            <button className="primary" disabled={missingDuration} onClick={() => setDecision('accept')}>
              采纳为正式镜头
            </button>
          </>
        )}
        {review.status === 'rejected' && review.canReview && (
          <button onClick={() => setDecision('reopen')}>重开草案</button>
        )}
      </div>
      {review.status === 'draft' && missingDuration && (
        <p className="field-hint">
          采纳前请编辑候选，确认每个镜头的 1–3600 整数秒计划时长；不自动套用默认时长。
        </p>
      )}
      {review.status === 'draft' && !review.canReview && (
        <p className="field-hint">由项目管理者或审核者决定采纳；编辑者可先完善候选。</p>
      )}
      {review.status === 'rejected' && <p className="notice error">拒绝理由：{review.summary}</p>}
      {review.status === 'accepted' && (
        <div className="accepted-shots">
          <p>采纳快照已固定，后续修改正式镜头会追加制作卡版本。</p>
          {review.adoptedShots.map((shot) => (
            <button key={shot.id} onClick={() => setCardId(shot.id)}>
              查看正式镜头 {shot.code}
            </button>
          ))}
        </div>
      )}
      {history && (
        <aside className="review-history" aria-label="草案修订记录">
          {history.items.map((item) => (
            <button
              className="revision-item"
              key={item.version}
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void api<typeof snapshot>(`/proposals/${review.id}/versions/${item.version}`)
                  .then((value) => setSnapshot(value))
                  .catch(report)
                  .finally(() => setBusy(false));
              }}
            >
              预览草案 v{item.version} · {item.summary} · {item.authorName}
            </button>
          ))}
          {history.nextCursor !== null && (
            <button
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void api<History>(`/proposals/${review.id}/versions?before=${history.nextCursor}`)
                  .then((value) =>
                    setHistory((current) => ({
                      items: [...(current?.items || []), ...value.items],
                      nextCursor: value.nextCursor,
                    })),
                  )
                  .catch(report)
                  .finally(() => setBusy(false));
              }}
            >
              更多草案修订
            </button>
          )}
        </aside>
      )}
      {review.body.shots.map((shot, index) => (
        <article className="panel proposal-shot" key={index}>
          <div className="section-heading">
            <h3>
              候选 {index + 1} · {shot.title}
            </h3>
            <span className="badge">{label}</span>
          </div>
          <ShotDraftDetails
            shot={shot}
            sources={review.sources}
            revisionVersion={review.inputChanges.sourceRevisionVersion}
          />
          {review.status === 'draft' && review.canEdit && (
            <button className="candidate-edit" onClick={() => setEditing(index)}>
              编辑候选 {index + 1}
            </button>
          )}
        </article>
      ))}
      {editing !== undefined && (
        <CandidateEditorDialog
          review={review}
          index={editing}
          onSaved={saved}
          onClose={() => setEditing(undefined)}
          onUnauthorized={onUnauthorized}
        />
      )}
      {decision && (
        <ReviewDecisionDialog
          review={review}
          action={decision}
          onSaved={saved}
          onClose={() => setDecision(undefined)}
          onUnauthorized={onUnauthorized}
        />
      )}
      {cardId && <ShotCardDialog shotId={cardId} onClose={() => setCardId('')} />}
      {snapshot && (
        <Dialog
          title={`草案历史 · v${snapshot.version}`}
          description="只读预览；查看旧版本不会替换当前草案。"
          onClose={() => setSnapshot(undefined)}
        >
          <div className="dialog-body">
            <p>{snapshot.summary}</p>
            {snapshot.body.shots.map((shot: DraftShot, index: number) => (
              <article className="proposal-shot panel" key={index}>
                <h3>{shot.title}</h3>
                <ShotDraftDetails
                  shot={shot}
                  sources={review.sources}
                  revisionVersion={review.inputChanges.sourceRevisionVersion}
                />
              </article>
            ))}
          </div>
        </Dialog>
      )}
    </div>
  );
}
