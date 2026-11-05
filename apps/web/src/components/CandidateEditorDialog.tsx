import { useState } from 'react';
import { api, ApiError } from '../api';
import { ProposalReview } from '../analysis-types';
import { techniqueLabels } from '../project-settings';
import { Dialog } from './Dialog';
const textFields = [
  ['intent', '创作意图', 2000],
  ['description', '候选画面描述', 20000],
  ['framing', '候选景别', 200],
  ['angle', '候选视角', 200],
  ['composition', '候选构图', 2000],
  ['cameraMovement', '候选运镜', 2000],
  ['action', '候选动作', 2000],
  ['lighting', '候选光线', 2000],
  ['mood', '候选情绪', 200],
  ['dialogue', '候选对白 / 旁白', 20000],
  ['audioNotes', '候选声音说明', 2000],
] as const;
export function CandidateEditorDialog({
  review,
  index,
  onSaved,
  onClose,
  onUnauthorized,
}: {
  review: ProposalReview;
  index: number;
  onSaved: (value: ProposalReview) => void;
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const [baseline, setBaseline] = useState(review);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const shot = baseline.body.shots[index];
  function report(reason: unknown) {
    if (reason instanceof ApiError && reason.status === 401) onUnauthorized();
    setError(reason instanceof Error ? reason.message : '保存失败');
    setConflict(reason instanceof ApiError && reason.status === 409);
  }
  return (
    <Dialog
      title={`编辑候选 ${index + 1}`}
      description="保存会追加草案修订，原始模型结果和已有历史保持不变。"
      busy={busy}
      onClose={onClose}
    >
      <form
        key={baseline.version}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const values = Object.fromEntries(form);
          const { summary, ...fields } = values;
          const body = {
            ...fields,
            durationSeconds: fields.durationSeconds === '' ? null : Number(fields.durationSeconds),
            assets: String(fields.assets)
              .split(/\r?\n/)
              .map((value) => value.trim())
              .filter(Boolean),
            riskNotes: String(fields.riskNotes)
              .split(/\r?\n/)
              .map((value) => value.trim())
              .filter(Boolean),
            sourceSpanIds: form.getAll('sourceSpanIds'),
          };
          setBusy(true);
          setError('');
          void api<ProposalReview>(`/proposals/${review.id}/shots/${index}`, 'PATCH', {
            expectedVersion: baseline.version,
            shot: body,
            summary,
          })
            .then(onSaved)
            .catch(report)
            .finally(() => setBusy(false));
        }}
      >
        <div className="dialog-body">
          {error && (
            <p role="alert" className="notice error">
              {error}；输入已保留。
            </p>
          )}
          <fieldset className="plain-fieldset" disabled={busy || baseline.status !== 'draft'}>
            <label>
              候选标题
              <input name="title" required maxLength={200} defaultValue={shot.title} data-autofocus />
            </label>
            <div className="dialog-field-row">
              <label>
                候选计划时长（秒）
                <input
                  name="durationSeconds"
                  type="number"
                  min={1}
                  max={3600}
                  step={1}
                  defaultValue={shot.durationSeconds ?? ''}
                  placeholder="留空为待确认"
                />
              </label>
              <label>
                候选制作方式
                <select aria-label="候选制作方式" name="technique" defaultValue={shot.technique}>
                  {Object.entries(techniqueLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="field-hint">采纳前须明确整数秒计划时长；这不等于实际配音或成片时长。</p>
            {textFields.map(([name, label, limit]) => (
              <label key={name}>
                {label}
                <textarea
                  name={name}
                  rows={name === 'description' ? 4 : 2}
                  maxLength={limit}
                  defaultValue={shot[name]}
                />
              </label>
            ))}
            <label>
              候选资产（每行一项）
              <textarea name="assets" rows={3} maxLength={4000} defaultValue={shot.assets.join('\n')} />
            </label>
            <label>
              风险与待核对项（每行一项）
              <textarea name="riskNotes" rows={3} maxLength={5000} defaultValue={shot.riskNotes.join('\n')} />
            </label>
            <fieldset className="candidate-sources">
              <legend>引用原文（至少一段）</legend>
              {baseline.sources.map((source) => (
                <label className="checkbox-label" key={source.id}>
                  <input
                    type="checkbox"
                    name="sourceSpanIds"
                    value={source.id}
                    defaultChecked={shot.sourceSpanIds.includes(source.id)}
                  />
                  <span>
                    {source.startOffset}–{source.endOffset} · {source.text.slice(0, 160) || '空行'}
                  </span>
                </label>
              ))}
            </fieldset>
            <label>
              本次草案修改说明
              <input name="summary" maxLength={200} />
            </label>
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
                    setConflict(false);
                    setError(value.status === 'draft' ? '' : '草案已审核，不能继续编辑');
                  })
                  .catch(report)
                  .finally(() => setBusy(false));
              }}
            >
              载入最新草案
            </button>
          )}
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy || baseline.status !== 'draft'}>
            保存候选修订
          </button>
        </div>
      </form>
    </Dialog>
  );
}
