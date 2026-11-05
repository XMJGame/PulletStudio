import { useEffect, useState } from 'react';
import { api, ApiError, CursorPage, ProductionUnit, Shot } from '../api';
import { Dialog } from './Dialog';
type Preview = {
  snapshotHash: string;
  ready: boolean;
  shotCount: number;
  fileCount: number;
  mediaBytes: number;
  items: { id: string; code: string; ready: boolean; reason: string; takeNo: number | null }[];
};
type Package = {
  id: string;
  createdAt: string;
  shotCount: number;
  mediaBytes: number;
  state: 'snapshot_ready';
  fileName: string;
  downloadPath: string;
};
export function MediaPackageDialog({
  projectId,
  units,
  currentUnit,
  selectedShot,
  onClose,
}: {
  projectId: string;
  units: ProductionUnit[];
  currentUnit?: ProductionUnit;
  selectedShot?: Shot;
  onClose: () => void;
}) {
  const [scope, setScope] = useState(selectedShot ? 'shots' : currentUnit ? 'unit' : 'root');
  const [unitId, setUnitId] = useState(currentUnit?.id ?? '');
  const [descendants, setDescendants] = useState(false);
  const [choices, setChoices] = useState<CursorPage<ProductionUnit>>({ items: units, nextCursor: null });
  const [preview, setPreview] = useState<Preview>();
  const [confirmed, setConfirmed] = useState(false);
  const [saved, setSaved] = useState<Package>();
  const [history, setHistory] = useState<CursorPage<Package>>({ items: [], nextCursor: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const path = `/projects/${projectId}/media-packages`;
  useEffect(() => {
    let active = true;
    void Promise.all([
      api<CursorPage<Package>>(path),
      api<CursorPage<ProductionUnit>>(`/projects/${projectId}/units`),
    ])
      .then(([files, available]) => {
        if (active) {
          setHistory(files);
          setChoices({
            ...available,
            items: [...new Map([...units, ...available.items].map((unit) => [unit.id, unit])).values()],
          });
        }
      })
      .catch((failure) => {
        if (active) setError(failure instanceof Error ? failure.message : '读取素材包失败');
      });
    return () => {
      active = false;
    };
  }, [projectId]);
  function reset() {
    setPreview(undefined);
    setSaved(undefined);
    setConfirmed(false);
    setConflict(false);
    setError('');
    setKey(crypto.randomUUID());
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '素材包操作失败');
      if (failure instanceof ApiError && failure.status === 409) setConflict(true);
    } finally {
      setBusy(false);
    }
  }
  function options() {
    return {
      scope:
        scope === 'unit'
          ? { type: 'unit', unitId, includeDescendants: descendants }
          : scope === 'shots'
            ? { type: 'shots', shotIds: [selectedShot!.id] }
            : { type: scope },
    };
  }
  async function preflight() {
    setPreview(undefined);
    setSaved(undefined);
    setConfirmed(false);
    const result = await api<Preview>(`${path}/preview`, 'POST', options());
    setPreview(result);
    setConflict(false);
    setKey(crypto.randomUUID());
  }
  return (
    <Dialog
      title="导出已选素材包"
      description="核对范围内的有效选片，下载包含原件、审核依据和来源清单的 ZIP。"
      busy={busy}
      onClose={onClose}
    >
      <div className="dialog-body">
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <fieldset className="plain-fieldset" disabled={busy}>
          <label>
            素材包范围
            <select
              value={scope}
              onChange={(event) => {
                setScope(event.target.value);
                reset();
              }}
            >
              <option value="project">整个项目</option>
              <option value="root">项目直属镜头</option>
              <option value="unit">指定制作单元</option>
              {selectedShot && <option value="shots">当前镜头 {selectedShot.code}</option>}
            </select>
          </label>
          {scope === 'unit' && (
            <>
              <label>
                素材包制作单元
                <select
                  value={unitId}
                  required
                  onChange={(event) => {
                    setUnitId(event.target.value);
                    reset();
                  }}
                >
                  <option value="">选择制作单元</option>
                  {choices.items.map((unit) => (
                    <option value={unit.id} key={unit.id}>
                      {unit.code} · {unit.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={descendants}
                  onChange={(event) => {
                    setDescendants(event.target.checked);
                    reset();
                  }}
                />
                包含下级制作单元
              </label>
              {choices.nextCursor && (
                <button
                  type="button"
                  onClick={() =>
                    void run(async () => {
                      const more = await api<CursorPage<ProductionUnit>>(
                        `/projects/${projectId}/units?cursor=${choices.nextCursor}`,
                      );
                      setChoices({
                        ...more,
                        items: [
                          ...new Map(
                            [...choices.items, ...more.items].map((unit) => [unit.id, unit]),
                          ).values(),
                        ],
                      });
                    })
                  }
                >
                  更多制作单元
                </button>
              )}
            </>
          )}
          <p className="field-hint">每包最多100个镜头，原件合计不超过2 GiB。所选范围内的镜头均需有效选片。</p>
          <button type="button" disabled={scope === 'unit' && !unitId} onClick={() => void run(preflight)}>
            预检素材包
          </button>
          {preview && (
            <section aria-label="素材包预检">
              <h3>{preview.ready ? '可创建素材包' : '需要处理选片'}</h3>
              <p>
                {preview.shotCount} 个镜头 · {preview.fileCount} 个原件 ·{' '}
                {Math.ceil(preview.mediaBytes / 1024).toLocaleString()} KiB
              </p>
              {preview.items.map((item) => (
                <article className="revision-item" key={item.id}>
                  <strong>
                    {item.code}
                    {item.takeNo !== null ? ` · Take ${String(item.takeNo).padStart(2, '0')}` : ''}
                  </strong>
                  <p>{item.reason}</p>
                </article>
              ))}
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={!preview.ready || conflict}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                确认范围、选片和原件交付
              </label>
              <button
                className="primary"
                type="button"
                disabled={!preview.ready || !confirmed || conflict || Boolean(saved)}
                onClick={() =>
                  void run(async () => {
                    const result = await api<Package>(
                      path,
                      'POST',
                      { ...options(), expectedSnapshotHash: preview.snapshotHash },
                      { 'Idempotency-Key': key },
                    );
                    setSaved(result);
                    setHistory(await api<CursorPage<Package>>(path));
                  })
                }
              >
                保存交付清单
              </button>
            </section>
          )}
          {conflict && <p className="notice">请重新预检，核对最新选片后再确认。</p>}
          {saved && (
            <section aria-label="已保存素材包">
              <p className="notice success" role="status">
                交付清单已保存，下载时按此快照组装素材包。
              </p>
              <a href={saved.downloadPath} download={saved.fileName}>
                下载素材包 ZIP
              </a>
            </section>
          )}
          <h3>历史素材包</h3>
          <p className="field-hint">历史包保留创建时的选片和批准依据。下载仍需当前项目及原件读取权限。</p>
          {!history.items.length && <p className="field-hint">尚无素材包。</p>}
          {history.items.map((item) => (
            <article className="revision-item" key={item.id}>
              <p>
                {new Date(item.createdAt).toLocaleString()} · {item.shotCount} 个镜头 ·{' '}
                {Math.ceil(item.mediaBytes / 1024).toLocaleString()} KiB
              </p>
              <a href={item.downloadPath} download={item.fileName}>
                下载历史素材包
              </a>
            </article>
          ))}
          {history.nextCursor && (
            <button
              type="button"
              onClick={() =>
                void run(async () => {
                  const more = await api<CursorPage<Package>>(`${path}?cursor=${history.nextCursor}`);
                  setHistory({ ...more, items: [...history.items, ...more.items] });
                })
              }
            >
              更多历史素材包
            </button>
          )}
        </fieldset>
      </div>
      <div className="dialog-footer">
        <button disabled={busy} onClick={onClose}>
          关闭
        </button>
      </div>
    </Dialog>
  );
}
