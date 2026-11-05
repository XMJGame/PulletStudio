import { useEffect, useState } from 'react';
import { api, ApiError, CursorPage, ProductionUnit, Shot } from '../api';
import { Dialog } from './Dialog';
type Preview = {
  snapshotHash: string;
  shotCount: number;
  byteLength: number;
  projectVersion: number;
  warnings: string[];
  items: {
    id: string;
    code: string;
    path: string;
    version: number;
    cardVersion: number | null;
    promptKind: string | null;
    warnings: string[];
  }[];
};
type ExportFile = {
  id: string;
  format: string;
  createdAt: string;
  shotCount: number;
  fileName: string;
  byteLength: number;
  sha256: string;
  downloadPath: string;
  replayed?: boolean;
};
export function StoryboardExportDialog({
  projectId,
  units,
  currentUnit,
  selectedShot,
  onClose,
  onUnauthorized,
}: {
  projectId: string;
  units: ProductionUnit[];
  currentUnit?: ProductionUnit;
  selectedShot?: Shot;
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const [scope, setScope] = useState(currentUnit ? 'unit' : 'root');
  const [unitId, setUnitId] = useState(currentUnit?.id ?? '');
  const [descendants, setDescendants] = useState(false);
  const [format, setFormat] = useState('json');
  const [promptMode, setPromptMode] = useState('saved');
  const [preview, setPreview] = useState<Preview>();
  const [file, setFile] = useState<ExportFile>();
  const [history, setHistory] = useState<CursorPage<ExportFile>>({ items: [], nextCursor: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [choices, setChoices] = useState<CursorPage<ProductionUnit>>({ items: units, nextCursor: null });
  const path = `/projects/${projectId}/storyboard-exports`;
  function report(reason: unknown) {
    if (reason instanceof ApiError && reason.status === 401) onUnauthorized();
    setError(reason instanceof Error ? reason.message : '导出失败');
    if (reason instanceof ApiError && reason.status === 409) {
      setConflict(true);
    }
  }
  function invalidate() {
    setPreview(undefined);
    setFile(undefined);
    setError('');
    setConflict(false);
    setKey(crypto.randomUUID());
  }
  useEffect(() => {
    let active = true;
    void Promise.all([
      api<CursorPage<ExportFile>>(path),
      api<CursorPage<ProductionUnit>>(`/projects/${projectId}/units`),
    ])
      .then(([files, value]) => {
        if (active) {
          setHistory(files);
          setChoices({
            ...value,
            items: [...new Map([...units, ...value.items].map((unit) => [unit.id, unit])).values()],
          });
        }
      })
      .catch((reason) => {
        if (active) report(reason);
      });
    return () => {
      active = false;
    };
  }, [projectId]);
  function options() {
    return {
      format,
      promptMode,
      scope:
        scope === 'unit'
          ? { type: 'unit', unitId, includeDescendants: descendants }
          : scope === 'shots'
            ? { type: 'shots', shotIds: [selectedShot!.id] }
            : { type: scope },
    };
  }
  async function refreshPreview() {
    setBusy(true);
    setError('');
    try {
      const value = await api<Preview>(`${path}/preview`, 'POST', options());
      setPreview(value);
      setFile(undefined);
      setConflict(false);
      setKey(crypto.randomUUID());
    } catch (reason) {
      report(reason);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="导出分镜文档"
      description="先核对范围和警告，再生成固定版本文件。不调用模型；文件包含创作正文和来源，请按项目资料保管。"
      busy={busy}
      onClose={onClose}
    >
      <div className="dialog-body">
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        <fieldset className="plain-fieldset" disabled={busy}>
          <div className="dialog-field-row">
            <label>
              导出格式
              <select
                aria-label="导出格式"
                value={format}
                onChange={(event) => {
                  setFormat(event.target.value);
                  invalidate();
                }}
              >
                <option value="json">JSON · 完整结构</option>
                <option value="md">Markdown · 可读文档</option>
                <option value="csv">CSV · 表格</option>
              </select>
            </label>
            <label>
              导出范围
              <select
                aria-label="导出范围"
                value={scope}
                onChange={(event) => {
                  setScope(event.target.value);
                  invalidate();
                }}
              >
                <option value="root">仅项目直属镜头</option>
                <option value="project">全部项目镜头</option>
                <option value="unit">指定制作单元</option>
                {selectedShot && <option value="shots">仅当前镜头 {selectedShot.code}</option>}
              </select>
            </label>
          </div>
          {scope === 'unit' && (
            <>
              <label>
                导出制作单元
                <select
                  aria-label="导出制作单元"
                  value={unitId}
                  onChange={(event) => {
                    setUnitId(event.target.value);
                    invalidate();
                  }}
                >
                  <option value="">请选择单元</option>
                  {choices.items.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.code} · {unit.title}
                    </option>
                  ))}
                </select>
              </label>
              {choices.nextCursor && (
                <button
                  type="button"
                  onClick={() => {
                    setBusy(true);
                    void api<CursorPage<ProductionUnit>>(
                      `/projects/${projectId}/units?cursor=${choices.nextCursor}`,
                    )
                      .then((value) =>
                        setChoices((previous) => ({
                          ...value,
                          items: [
                            ...new Map(
                              [...previous.items, ...value.items].map((unit) => [unit.id, unit]),
                            ).values(),
                          ],
                        })),
                      )
                      .catch(report)
                      .finally(() => setBusy(false));
                  }}
                >
                  更多导出单元
                </button>
              )}
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={descendants}
                  onChange={(event) => {
                    setDescendants(event.target.checked);
                    invalidate();
                  }}
                />
                包含该单元的下级镜头
              </label>
            </>
          )}
          <label>
            提示词来源
            <select
              aria-label="提示词来源"
              value={promptMode}
              onChange={(event) => {
                setPromptMode(event.target.value);
                invalidate();
              }}
            >
              <option value="saved">各镜头最新已保存快照（保留过期警告）</option>
              <option value="neutral">本次中立离线编译（不另存提示词）</option>
            </select>
          </label>
        </fieldset>
        <p className="field-hint">
          每份最多200镜头、快照4MiB、文件8MiB。超限请按单元或当前镜头拆分，系统不会截断内容。未保存完整卡或提示词会明确标记。
        </p>
        <button disabled={busy || (scope === 'unit' && !unitId)} onClick={() => void refreshPreview()}>
          {conflict ? '重新预览分镜导出' : '预览分镜导出'}
        </button>
        {preview && (
          <section aria-label="分镜导出预览" className="export-preview">
            <h3>
              {preview.shotCount} 个镜头 · 项目 v{preview.projectVersion}
            </h3>
            <p className="field-hint">预计 {(preview.byteLength / 1024).toFixed(1)} KiB</p>
            <ul className="field-hint">
              {preview.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
            {preview.items.map((item) => (
              <article key={item.id} className="export-preview-item">
                <strong>
                  {item.path} / {item.code}
                </strong>
                <p className="field-hint">
                  镜头 v{item.version} · 制作卡{' '}
                  {item.cardVersion === null ? '未保存' : `v${item.cardVersion}`} · 提示词{' '}
                  {item.promptKind === 'saved'
                    ? '已保存快照'
                    : item.promptKind === 'neutral'
                      ? '本次中立编译'
                      : '未提供'}
                </p>
                {!!item.warnings.length && (
                  <ul className="field-hint">
                    {item.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </section>
        )}
        {file && (
          <section className="notice success export-download" aria-label="已生成分镜导出">
            <p role="status">分镜文件已生成并固定保存{file.replayed ? '（复用已有请求）' : ''}</p>
            <a href={file.downloadPath} download>
              下载 {file.format.toUpperCase()} 分镜文件
            </a>
            <small>
              {file.byteLength.toLocaleString()} 字节 · {file.shotCount} 个镜头
            </small>
          </section>
        )}
        <h3>已生成的分镜文件</h3>
        {!history.items.length && <p className="muted">暂无导出记录。</p>}
        {history.items.map((item) => (
          <article key={item.id} className="export-history-item">
            <a href={item.downloadPath} download>
              下载 {item.format.toUpperCase()} · {item.shotCount} 镜头 ·{' '}
              {new Date(item.createdAt).toLocaleString()}
            </a>
          </article>
        ))}
        {history.nextCursor && (
          <button
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void api<CursorPage<ExportFile>>(`${path}?cursor=${history.nextCursor}`)
                .then((value) =>
                  setHistory((previous) => ({ ...value, items: [...previous.items, ...value.items] })),
                )
                .catch(report)
                .finally(() => setBusy(false));
            }}
          >
            更多分镜导出
          </button>
        )}
      </div>
      <div className="dialog-footer">
        <button disabled={busy} onClick={onClose}>
          关闭
        </button>
        <button
          className="primary"
          disabled={busy || !preview || conflict || !!file}
          onClick={() => {
            setBusy(true);
            setError('');
            void api<ExportFile>(
              path,
              'POST',
              { ...options(), expectedSnapshotHash: preview!.snapshotHash },
              { 'Idempotency-Key': key },
            )
              .then(async (value) => {
                setFile(value);
                setHistory(await api<CursorPage<ExportFile>>(path));
              })
              .catch(report)
              .finally(() => setBusy(false));
          }}
        >
          生成分镜文件
        </button>
      </div>
    </Dialog>
  );
}
