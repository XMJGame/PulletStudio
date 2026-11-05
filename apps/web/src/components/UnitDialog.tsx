import { useState } from 'react';
import { api, ApiError, ProductionUnit } from '../api';
import { unitLabels } from '../project-settings';
import { Dialog } from './Dialog';

export function UnitDialog({
  projectId,
  units,
  parentId,
  item,
  onClose,
  onSaved,
  onUnauthorized,
}: {
  projectId: string;
  units: ProductionUnit[];
  parentId: string;
  item?: ProductionUnit;
  onClose: () => void;
  onSaved: (item: ProductionUnit) => void;
  onUnauthorized: () => void;
}) {
  const [baseline, setBaseline] = useState(item);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  function report(reason: unknown) {
    if (reason instanceof ApiError && reason.status === 401) onUnauthorized();
    setError(reason instanceof Error ? reason.message : '保存失败');
    setConflict(reason instanceof ApiError && reason.status === 409);
  }
  const forbidden = new Set(baseline ? [baseline.id] : []);
  let previousSize;
  do {
    previousSize = forbidden.size;
    for (const unit of units) if (unit.parentId && forbidden.has(unit.parentId)) forbidden.add(unit.id);
  } while (forbidden.size > previousSize);
  return (
    <Dialog
      title={baseline ? '编辑制作单元' : '新建制作单元'}
      description="按作品组织幕、分集和场次，编号由系统生成，排序和改名不会重编。"
      busy={busy}
      onClose={onClose}
    >
      <form
        key={`${baseline?.id || 'new'}:${baseline?.version || 0}`}
        onSubmit={(event) => {
          event.preventDefault();
          const data = Object.fromEntries(new FormData(event.currentTarget));
          const body = {
            ...data,
            parentId: data.parentId || null,
            orderIndex: Number(data.orderIndex),
            targetDurationSeconds: data.targetDurationSeconds ? Number(data.targetDurationSeconds) : null,
            ...(baseline ? { expectedVersion: baseline.version } : {}),
          };
          setBusy(true);
          setError('');
          void api<ProductionUnit>(
            baseline ? `/units/${baseline.id}` : `/projects/${projectId}/units`,
            baseline ? 'PATCH' : 'POST',
            body,
          )
            .then(onSaved)
            .catch(report)
            .finally(() => setBusy(false));
        }}
      >
        <div className="dialog-body">
          {error && (
            <div role="alert" className="notice error">
              {error}
            </div>
          )}
          <fieldset className="plain-fieldset" disabled={busy}>
            <label>
              制作单元名称
              <input
                name="title"
                required
                maxLength={200}
                defaultValue={baseline?.title || ''}
                data-autofocus
              />
            </label>
            <div className="dialog-field-row">
              <label>
                单元类型
                {baseline ? (
                  <input readOnly aria-label="单元类型" value={unitLabels[baseline.kind]} />
                ) : (
                  <select name="kind" aria-label="单元类型" defaultValue="scene">
                    {Object.entries(unitLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                )}
              </label>
              <label>
                上级单元
                <select name="parentId" defaultValue={baseline ? baseline.parentId || '' : parentId}>
                  <option value="">项目直属</option>
                  {baseline?.parentId && !units.some((unit) => unit.id === baseline.parentId) && (
                    <option value={baseline.parentId}>当前上级（尚未载入）</option>
                  )}
                  {units
                    .filter((unit) => !forbidden.has(unit.id))
                    .map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.code} · {unit.title}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            <div className="dialog-field-row">
              <label>
                单元排序
                <input
                  type="number"
                  name="orderIndex"
                  required
                  min={0}
                  max={100000}
                  defaultValue={baseline?.orderIndex || 0}
                />
              </label>
              <label>
                单元目标时长（秒）
                <input
                  type="number"
                  name="targetDurationSeconds"
                  min={1}
                  max={28800}
                  defaultValue={baseline?.targetDurationSeconds || ''}
                  placeholder="可选"
                />
              </label>
            </div>
            <label>
              单元概述
              <textarea name="outline" rows={4} maxLength={20000} defaultValue={baseline?.outline || ''} />
            </label>
            {baseline && (
              <p className="field-hint">
                {baseline.code} · v{baseline.version}，已有镜头保持不变。
              </p>
            )}
          </fieldset>
        </div>
        <div className="dialog-footer">
          {conflict && baseline && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                void api<ProductionUnit>(`/units/${baseline.id}`)
                  .then((value) => {
                    setBaseline(value);
                    setConflict(false);
                    setError('');
                  })
                  .catch(report)
                  .finally(() => setBusy(false));
              }}
            >
              载入单元最新版本
            </button>
          )}
          <button type="button" disabled={busy} onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            {baseline ? '保存制作单元' : '创建制作单元'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
