import { useEffect, useState } from 'react';
import { api, ApiError, CursorPage, ProductionUnit } from '../api';
import { ProposalReview } from '../analysis-types';
import { Dialog } from './Dialog';
export function ReviewDecisionDialog({
  review,
  action,
  onClose,
  onSaved,
  onUnauthorized,
}: {
  review: ProposalReview;
  action: 'accept' | 'reject' | 'reopen';
  onClose: () => void;
  onSaved: (value: ProposalReview) => void;
  onUnauthorized: () => void;
}) {
  const [baseline, setBaseline] = useState(review);
  const [units, setUnits] = useState<ProductionUnit[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const changed = baseline.inputChanges.projectChanged || baseline.inputChanges.scriptChanged;
  function report(reason: unknown) {
    if (reason instanceof ApiError && reason.status === 401) onUnauthorized();
    setError(reason instanceof Error ? reason.message : '操作失败');
    setConflict(reason instanceof ApiError && reason.status === 409);
  }
  useEffect(() => {
    if (action !== 'accept') return;
    let active = true;
    void api<CursorPage<ProductionUnit>>(`/projects/${review.projectId}/units`)
      .then((value) => {
        if (active) {
          setUnits(value.items);
          setCursor(value.nextCursor);
        }
      })
      .catch((reason) => {
        if (active) report(reason);
      });
    return () => {
      active = false;
    };
  }, [review.id, action]);
  const stateAllowed = baseline.status === (action === 'reopen' ? 'rejected' : 'draft');
  return (
    <Dialog
      title={action === 'accept' ? '确认采纳为正式镜头' : action === 'reject' ? '拒绝这份草案' : '重开草案'}
      description={
        action === 'accept'
          ? '一次性创建本草案全部候选的正式镜头，保留原文引用与审核版本。'
          : '记录本次决定与理由，全部修订历史继续保留。'
      }
      busy={busy}
      onClose={onClose}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          setBusy(true);
          setError('');
          const body =
            action === 'accept'
              ? {
                  expectedVersion: baseline.version,
                  expectedProjectVersion: baseline.inputChanges.currentProjectVersion,
                  unitId: data.get('unitId') || null,
                  acknowledgeCreation: confirmed,
                  acknowledgeInputChanges: acknowledged,
                }
              : { expectedVersion: baseline.version, reason: data.get('reason') };
          void api<ProposalReview>(`/proposals/${review.id}/${action}`, 'POST', body)
            .then(onSaved)
            .catch(report)
            .finally(() => setBusy(false));
        }}
      >
        <div className="dialog-body">
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <fieldset className="plain-fieldset" disabled={busy || !stateAllowed}>
            <p>
              草案 v{baseline.version} · {baseline.body.shots.length} 个候选
            </p>
            {action === 'accept' ? (
              <>
                <label>
                  正式镜头目标
                  <select name="unitId" aria-label="正式镜头目标">
                    <option value="">项目直属镜头</option>
                    {units.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.code} · {unit.title}
                      </option>
                    ))}
                  </select>
                </label>
                {cursor && (
                  <button
                    type="button"
                    onClick={() => {
                      setBusy(true);
                      void api<CursorPage<ProductionUnit>>(
                        `/projects/${review.projectId}/units?cursor=${cursor}`,
                      )
                        .then((value) => {
                          setUnits((previous) => [...previous, ...value.items]);
                          setCursor(value.nextCursor);
                        })
                        .catch(report)
                        .finally(() => setBusy(false));
                    }}
                  >
                    载入更多目标单元
                  </button>
                )}
                {changed && (
                  <div className="notice error">
                    <p>
                      分析使用原文 v{baseline.inputChanges.sourceRevisionVersion}；当前原文 v
                      {baseline.inputChanges.currentScriptVersion}
                      ，项目设定也请核对。采纳不会自动将引用迁移到新版本。
                    </p>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={acknowledged}
                        onChange={(event) => setAcknowledged(event.target.checked)}
                      />
                      已核对新版本差异，仍按这份草案的旧原文引用采纳
                    </label>
                  </div>
                )}
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  已核对候选内容、计划时长及原文引用，确认创建正式镜头
                </label>
              </>
            ) : (
              <label>
                审核理由
                <textarea name="reason" required maxLength={1000} rows={5} data-autofocus />
              </label>
            )}
          </fieldset>
        </div>
        <div className="dialog-footer">
          {conflict && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void api<ProposalReview>(`/proposals/${review.id}`)
                  .then((value) => {
                    setBaseline(value);
                    setAcknowledged(false);
                    setConfirmed(false);
                    setConflict(false);
                    setError('');
                  })
                  .catch(report)
                  .finally(() => setBusy(false));
              }}
            >
              刷新审核信息
            </button>
          )}
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button
            className="primary"
            disabled={
              busy || !stateAllowed || (action === 'accept' && (!confirmed || (changed && !acknowledged)))
            }
          >
            {action === 'accept' ? '确认创建正式镜头' : action === 'reject' ? '确认拒绝草案' : '确认重开草案'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
