import { useEffect, useMemo, useState } from 'react';
import { api, ApiError, CursorPage, ProductionUnit, Shot } from '../api';
import { techniqueLabels, unitLabels } from '../project-settings';
import { ShotEditor } from './ShotEditor';
import { UnitDialog } from './UnitDialog';
import { StoryboardExportDialog } from './StoryboardExportDialog';
import { MediaDialog } from './MediaDialog';
import { EntityLibraryDialog } from './EntityLibraryDialog';
import { MediaPackageDialog } from './MediaPackageDialog';
import { AnimaticDialog } from './AnimaticDialog';
const mergeRows = <T extends { id: string }>(current: T[], incoming: T[]) => [
  ...new Map([...current, ...incoming].map((item) => [item.id, item])).values(),
];

export function StructureWorkbench({
  projectId,
  canEdit,
  onUnauthorized,
}: {
  projectId: string;
  canEdit: boolean;
  onUnauthorized: () => void;
}) {
  const [units, setUnits] = useState<ProductionUnit[]>([]);
  const [unitCursor, setUnitCursor] = useState<string | null>(null);
  const [scope, setScope] = useState('');
  const [shots, setShots] = useState<Shot[]>([]);
  const [shotCursor, setShotCursor] = useState<string | null>(null);
  const [selectedShot, setSelectedShot] = useState<Shot>();
  const [form, setForm] = useState<'create' | ProductionUnit>();
  const [showShotForm, setShowShotForm] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showPackage, setShowPackage] = useState(false);
  const [showAnimatic, setShowAnimatic] = useState(false);
  const [showMedia, setShowMedia] = useState(false);
  const [showEntities, setShowEntities] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const selectedUnit = units.find((unit) => unit.id === scope);
  const path = `/projects/${projectId}`;
  const shotPath = `${path}/shots${scope ? `?unitId=${scope}` : ''}`;
  function report(reason: unknown) {
    if (reason instanceof ApiError && reason.status === 401) onUnauthorized();
    setError(reason instanceof Error ? reason.message : '操作失败');
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (reason) {
      report(reason);
    } finally {
      setBusy(false);
    }
  }
  async function refreshUnits() {
    const value = await api<CursorPage<ProductionUnit>>(`${path}/units`);
    setUnits(
      value.items.some((item) => item.id === scope) || !selectedUnit
        ? value.items
        : [...value.items, selectedUnit],
    );
    setUnitCursor(value.nextCursor);
  }
  useEffect(() => {
    let active = true;
    void api<CursorPage<ProductionUnit>>(`${path}/units`)
      .then((value) => {
        if (active) {
          setUnits(value.items);
          setUnitCursor(value.nextCursor);
        }
      })
      .catch((reason) => {
        if (active) report(reason);
      });
    return () => {
      active = false;
    };
  }, [projectId]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setShots([]);
    setSelectedShot(undefined);
    setShowShotForm(false);
    setShotCursor(null);
    void api<CursorPage<Shot>>(shotPath)
      .then((value) => {
        if (active) {
          setShots(value.items);
          setShotCursor(value.nextCursor);
        }
      })
      .catch((reason) => {
        if (active) report(reason);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [projectId, scope]);
  const orderedUnits = useMemo(() => {
    const result: { unit: ProductionUnit; depth: number }[] = [];
    const ids = new Set(units.map((unit) => unit.id));
    const sorted = [...units].sort((a, b) => a.orderIndex - b.orderIndex || a.code.localeCompare(b.code));
    const stack = sorted
      .filter((unit) => !unit.parentId || !ids.has(unit.parentId))
      .reverse()
      .map((unit) => ({ unit, depth: 0 }));
    const seen = new Set<string>();
    while (stack.length) {
      const entry = stack.pop()!;
      if (seen.has(entry.unit.id)) continue;
      seen.add(entry.unit.id);
      result.push(entry);
      stack.push(
        ...sorted
          .filter((unit) => unit.parentId === entry.unit.id)
          .reverse()
          .map((unit) => ({ unit, depth: entry.depth + 1 })),
      );
    }
    return result;
  }, [units]);
  return (
    <section aria-label="项目制作结构">
      <div className="section-heading">
        <div>
          <span className="eyebrow">PRODUCTION STRUCTURE</span>
          <h2>制作结构</h2>
        </div>
        <div className="heading-actions">
          <button onClick={() => setShowMedia(true)}>项目素材</button>
          <button onClick={() => setShowEntities(true)}>资产库</button>
          <button onClick={() => setShowExport(true)}>导出分镜文档</button>
          <button onClick={() => setShowPackage(true)}>导出素材包</button>
          <button onClick={() => setShowAnimatic(true)}>时间线与预演</button>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await refreshUnits();
                const value = await api<CursorPage<Shot>>(shotPath);
                setShots(value.items);
                setShotCursor(value.nextCursor);
                setMessage('制作结构已刷新');
              })
            }
          >
            刷新结构
          </button>
          {canEdit && (
            <button disabled={busy} onClick={() => setForm('create')}>
              新建制作单元
            </button>
          )}
        </div>
      </div>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="notice success">
          {message}
        </div>
      )}
      <div className="structure-layout">
        <aside className="unit-tree panel" aria-label="制作单元列表">
          <button
            disabled={busy}
            className={!scope ? 'selected' : ''}
            aria-pressed={!scope}
            onClick={() => setScope('')}
          >
            项目直属镜头
          </button>
          {orderedUnits.map(({ unit, depth }) => (
            <button
              disabled={busy}
              key={unit.id}
              className={scope === unit.id ? 'selected' : ''}
              aria-pressed={scope === unit.id}
              aria-label={`选择制作单元 ${unit.title}`}
              style={{ paddingLeft: 12 + Math.min(depth, 8) * 14 }}
              onClick={() => setScope(unit.id)}
            >
              <small>
                {unitLabels[unit.kind]} · {unit.code}
              </small>
              <span>{unit.title}</span>
              {unit.parentId && !units.some((parent) => parent.id === unit.parentId) && (
                <small>上级尚未载入</small>
              )}
            </button>
          ))}
          {!units.length && <p className="field-hint">可直接制作项目镜头，也可建立幕、场次或分集。</p>}
          {unitCursor && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const value = await api<CursorPage<ProductionUnit>>(`${path}/units?cursor=${unitCursor}`);
                  setUnits((current) => mergeRows(current, value.items));
                  setUnitCursor(value.nextCursor);
                })
              }
            >
              加载更多制作单元
            </button>
          )}
        </aside>
        <div className="structure-content">
          <div className="section-heading">
            <div>
              <h3>{selectedUnit ? `${selectedUnit.code} · ${selectedUnit.title}` : '项目直属镜头'}</h3>
              {selectedUnit?.outline && <p className="muted">{selectedUnit.outline}</p>}
            </div>
            {canEdit && selectedUnit && (
              <button disabled={busy} onClick={() => setForm(selectedUnit)}>
                编辑制作单元
              </button>
            )}
          </div>
          {loading && <p role="status">正在读取镜头…</p>}
          {canEdit && (
            <button disabled={busy || loading} onClick={() => setShowShotForm((value) => !value)}>
              添加结构镜头
            </button>
          )}
          {showShotForm && (
            <form
              className="panel compact structure-shot-form"
              onSubmit={(event) => {
                event.preventDefault();
                const data = Object.fromEntries(new FormData(event.currentTarget));
                void run(async () => {
                  const created = await api<Shot>(`${path}/shots`, 'POST', {
                    ...data,
                    durationHint: Number(data.durationHint),
                    unitId: scope || null,
                  });
                  setShots((current) => [...current, created]);
                  setSelectedShot(created);
                  setShowShotForm(false);
                  setMessage('镜头已创建');
                });
              }}
            >
              <fieldset className="plain-fieldset" disabled={busy || !canEdit}>
                <label>
                  镜头画面
                  <textarea name="description" maxLength={20000} rows={3} />
                </label>
                <div className="dialog-field-row">
                  <label>
                    计划时长（秒）
                    <input type="number" name="durationHint" required min={1} max={3600} defaultValue={5} />
                  </label>
                  <label>
                    制作方式
                    <select name="technique" aria-label="制作方式" defaultValue="unspecified">
                      {Object.entries(techniqueLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="field-hint">这是手动计划时长；旁白对齐和自动分镜将在后续实现。</p>
                <button className="primary">创建结构镜头</button>
              </fieldset>
            </form>
          )}
          <div className="structure-shot-list">
            {[...shots]
              .sort((a, b) => a.sequence - b.sequence || a.code.localeCompare(b.code))
              .map((shot) => (
                <button
                  key={shot.id}
                  aria-pressed={selectedShot?.id === shot.id}
                  onClick={() => setSelectedShot(shot)}
                >
                  <strong>{shot.code}</strong>
                  <span>{shot.description || '尚无画面描述'}</span>
                  <small>
                    {shot.durationHint}s · {techniqueLabels[shot.technique]}
                  </small>
                </button>
              ))}
          </div>
          {!loading && !shots.length && <p className="muted">当前范围还没有镜头。</p>}
          {shotCursor && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const value = await api<CursorPage<Shot>>(
                    `${shotPath}${scope ? '&' : '?'}cursor=${shotCursor}`,
                  );
                  setShots((current) => mergeRows(current, value.items));
                  setShotCursor(value.nextCursor);
                })
              }
            >
              加载更多镜头
            </button>
          )}
          {selectedShot && (
            <ShotEditor
              key={`${selectedShot.id}:${selectedShot.version}`}
              shot={selectedShot}
              disabled={busy || !canEdit}
              save={(data) =>
                void run(async () => {
                  const updated = await api<Shot>(`/shots/${selectedShot.id}`, 'PATCH', data);
                  setSelectedShot(updated);
                  setShots((current) => current.map((shot) => (shot.id === updated.id ? updated : shot)));
                  setMessage('镜头已保存');
                })
              }
              reload={() =>
                void run(async () => {
                  const latest = await api<Shot>(`/shots/${selectedShot.id}`);
                  setSelectedShot(latest);
                  setShots((current) => current.map((shot) => (shot.id === latest.id ? latest : shot)));
                  setMessage('已载入最新版本');
                })
              }
            />
          )}
        </div>
      </div>
      {form && (
        <UnitDialog
          projectId={projectId}
          units={units}
          parentId={scope}
          item={form === 'create' ? undefined : form}
          onClose={() => setForm(undefined)}
          onUnauthorized={onUnauthorized}
          onSaved={(unit) => {
            setUnits((current) => [...current.filter((item) => item.id !== unit.id), unit]);
            setScope(unit.id);
            setForm(undefined);
            setMessage(form === 'create' ? '制作单元已创建' : '制作单元已保存');
          }}
        />
      )}
      {showExport && (
        <StoryboardExportDialog
          projectId={projectId}
          units={units}
          currentUnit={selectedUnit}
          selectedShot={selectedShot}
          onClose={() => setShowExport(false)}
          onUnauthorized={onUnauthorized}
        />
      )}
      {showMedia && <MediaDialog projectId={projectId} onClose={() => setShowMedia(false)} />}
      {showAnimatic && (
        <AnimaticDialog
          projectId={projectId}
          units={units}
          currentUnit={selectedUnit}
          selectedShot={selectedShot}
          canEdit={canEdit}
          onClose={() => setShowAnimatic(false)}
        />
      )}
      {showPackage && (
        <MediaPackageDialog
          projectId={projectId}
          units={units}
          currentUnit={selectedUnit}
          selectedShot={selectedShot}
          onClose={() => setShowPackage(false)}
        />
      )}
      {showEntities && <EntityLibraryDialog projectId={projectId} onClose={() => setShowEntities(false)} />}
    </section>
  );
}
