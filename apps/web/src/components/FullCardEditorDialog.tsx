import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { CardEditor } from '../prompt-types';
import { techniqueLabels } from '../project-settings';
import { Dialog } from './Dialog';
const fields = [
  ['intent', '创作意图', 2000],
  ['description', '画面描述', 20000],
  ['framing', '景别', 200],
  ['angle', '视角', 200],
  ['composition', '构图', 2000],
  ['cameraMovement', '运镜', 2000],
  ['action', '动作', 2000],
  ['lighting', '光线', 2000],
  ['mood', '情绪', 200],
  ['dialogue', '对白 / 旁白', 20000],
  ['audioNotes', '声音说明', 2000],
] as const;
export function FullCardEditorDialog({
  shotId,
  onClose,
  onSaved,
}: {
  shotId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [context, setContext] = useState<CardEditor>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  function report(reason: unknown) {
    setError(reason instanceof Error ? reason.message : '读取失败');
    setConflict(reason instanceof ApiError && reason.status === 409);
  }
  useEffect(() => {
    let active = true;
    void api<CardEditor>(`/shots/${shotId}/card/editor`)
      .then((value) => {
        if (active) setContext(value);
      })
      .catch((reason) => {
        if (active) report(reason);
      });
    return () => {
      active = false;
    };
  }, [shotId]);
  return (
    <Dialog
      title="编辑完整制作卡"
      description="保存会追加正式镜头版本。原文引用和已有审核快照保留；未关联原文也可手动创作。"
      busy={busy}
      onClose={onClose}
    >
      {!context ? (
        <div className="dialog-body">
          <p role={error ? 'alert' : 'status'}>{error || '正在读取制作卡…'}</p>
        </div>
      ) : (
        <form
          key={context.shot.version}
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const { summary, ...fields } = Object.fromEntries(form);
            const split = (name: string) =>
              String(fields[name])
                .split(/\r?\n/)
                .map((value) => value.trim())
                .filter(Boolean);
            setBusy(true);
            setError('');
            void api(`/shots/${shotId}/card`, 'PATCH', {
              expectedVersion: context.shot.version,
              summary,
              body: {
                ...fields,
                durationSeconds: Number(fields.durationSeconds),
                assets: split('assets'),
                riskNotes: split('riskNotes'),
                sourceSpanIds: context.body.sourceSpanIds,
              },
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
            <fieldset className="plain-fieldset" disabled={busy || !context.canEdit}>
              <p className="field-hint">
                {context.shot.code} · 基于版本 {context.shot.version} · {context.body.sourceSpanIds.length}{' '}
                段固定原文引用
              </p>
              <label>
                制作卡标题
                <input
                  name="title"
                  required
                  maxLength={200}
                  defaultValue={context.body.title}
                  data-autofocus
                />
              </label>
              {fields.map(([name, label, max]) => (
                <label key={name}>
                  制作卡{label}
                  <textarea
                    name={name}
                    aria-label={`制作卡${label}`}
                    rows={name === 'description' ? 4 : 2}
                    maxLength={max}
                    defaultValue={context.body[name]}
                  />
                </label>
              ))}
              <div className="dialog-field-row">
                <label>
                  制作卡计划时长（秒）
                  <input
                    name="durationSeconds"
                    type="number"
                    required
                    min={1}
                    max={3600}
                    step={1}
                    defaultValue={context.body.durationSeconds ?? ''}
                  />
                </label>
                <label>
                  制作卡制作方式
                  <select name="technique" defaultValue={context.body.technique}>
                    {Object.entries(techniqueLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                原声处理计划
                <select
                  aria-label="原声处理计划"
                  name="sourceAudioPolicy"
                  defaultValue={context.body.sourceAudioPolicy}
                >
                  <option value="inspect">先检查再决定</option>
                  <option value="keep">保留原声</option>
                  <option value="mute">静音原声</option>
                  <option value="replace">替换原声</option>
                </select>
              </label>
              <p className="field-hint">这是制作计划，保存不会修改媒体或音轨。</p>
              <label>
                制作卡资产名称（每行一项）
                <textarea
                  name="assets"
                  rows={3}
                  maxLength={4000}
                  defaultValue={context.body.assets.join('\n')}
                />
              </label>
              <label>
                制作卡风险（每行一项）
                <textarea
                  name="riskNotes"
                  rows={3}
                  maxLength={5000}
                  defaultValue={context.body.riskNotes.join('\n')}
                />
              </label>
              <label>
                制作卡修改说明
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
                  void api<CardEditor>(`/shots/${shotId}/card/editor`)
                    .then((value) => {
                      setContext(value);
                      setConflict(false);
                      setError('');
                    })
                    .catch(report)
                    .finally(() => setBusy(false));
                }}
              >
                载入最新制作卡
              </button>
            )}
            <button type="button" disabled={busy} onClick={onClose}>
              取消
            </button>
            <button className="primary" disabled={busy || !context.canEdit}>
              保存完整制作卡
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
