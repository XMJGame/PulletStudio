import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Dialog } from './Dialog';
import type { GenerationJob } from './GenerationDialog';
import { referenceMediaLabels } from '../workflows/workflow-types';
import { StudioButton } from '../shared/ui/StudioUI';
import './generation-output-batch.css';

export function GenerationOutputBatchDialog({
  job,
  editable,
  onSaved,
  onClose,
  theme,
}: {
  job: GenerationJob;
  editable: boolean;
  onSaved: (job: GenerationJob) => void;
  onClose: () => void;
  theme?: 'light' | 'dark';
}) {
  const [current, setCurrent] = useState(job);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const files = [
    {
      id: current.id,
      outputId: null,
      label: current.outputs?.some((o) => o.role === 'primary') ? '主结果 · 1' : '主结果',
      result: current.result,
      inLibrary: current.inLibrary,
    },
    ...(current.outputs ?? []).map((output) => ({
      id: output.id,
      outputId: output.id,
      label: `${output.label} · ${output.index + 1}`,
      result: output.result,
      inLibrary: output.inLibrary,
    })),
  ];
  const chosen = files.filter((file) => selected.includes(file.id));
  const pending = chosen.filter((file) => !file.inLibrary).length;
  const total = chosen.reduce((n, file) => n + (file.result?.byteLength ?? 0), 0);
  async function act(action: 'archive' | 'download') {
    if (busy || !chosen.length) return;
    setBusy(true);
    setError('');
    setMessage('');
    const outputIds = chosen.map((file) => file.outputId);
    try {
      if (action === 'archive') {
        const saved = await api<GenerationJob>(
          `/generation-jobs/${current.id}/save-outputs-to-library`,
          'POST',
          { outputIds },
        );
        if (!alive.current) return;
        setCurrent(saved);
        onSaved(saved);
        setMessage(`已将所选 ${chosen.length} 份产物存入素材库。`);
      } else {
        const query = encodeURIComponent(outputIds.map((id) => id ?? 'main').join(','));
        const preview = await api<{ downloadPath: string; fileName: string }>(
          `/generation-jobs/${current.id}/output-package/preview?outputIds=${query}`,
        );
        if (!alive.current) return;
        const link = document.createElement('a');
        link.href = preview.downloadPath;
        link.download = preview.fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setMessage('已发起原件包下载，完成或中断请查看浏览器下载记录。');
      }
    } catch (reason) {
      if (alive.current)
        setError(
          `${reason instanceof Error ? reason.message : '操作未确认'}。选择已保留，可重试；已入库文件不会重复归档。`,
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Dialog
      title="批量处理生成产物"
      description={`${current.workflowName} · ${new Date(current.createdAt).toLocaleString()}。只处理本次任务中勾选的文件。`}
      busy={busy}
      onClose={onClose}
      theme={theme}
      className="generation-output-batch"
    >
      <div className="dialog-body">
        <label className="checkbox-label">
          <input
            type="checkbox"
            aria-label="全选产物"
            disabled={busy}
            checked={selected.length === files.length}
            onChange={(e) => setSelected(e.target.checked ? files.map((file) => file.id) : [])}
          />
          全选 · {files.length} 份
        </label>
        <div className="generation-output-batch-list" aria-label="本次任务产物">
          {files.map((file) => (
            <label key={file.id} className="generation-output-batch-file">
              <input
                type="checkbox"
                aria-label={`选择产物 ${file.label}`}
                disabled={busy}
                checked={selected.includes(file.id)}
                onChange={(e) =>
                  setSelected((old) =>
                    e.target.checked ? [...old, file.id] : old.filter((id) => id !== file.id),
                  )
                }
              />
              <span>
                <strong>
                  {file.label} · {file.result && referenceMediaLabels[file.result.mediaType]}
                </strong>
                <small>
                  {file.result?.fileName ?? file.label}
                  {file.result?.byteLength != null ? ` · ${size(file.result.byteLength)}` : ''}
                </small>
              </span>
              <small>{file.inLibrary ? '已入库' : '未入库'}</small>
            </label>
          ))}
        </div>
        <p className="field-hint">
          已选 {chosen.length} 份{total ? ` · ${size(total)}` : ''}。原件包包含所选文件与来源清单，每次最多 40
          份、合计 2 GiB；下载不会自动入库。
        </p>
        {error && <p role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
      </div>
      <div className="dialog-footer">
        <StudioButton disabled={busy} onClick={onClose}>
          关闭
        </StudioButton>
        {editable && (
          <StudioButton disabled={busy || !pending} onClick={() => void act('archive')}>
            {busy ? '处理中…' : '入库已选产物'}
          </StudioButton>
        )}
        <StudioButton
          variant="primary"
          disabled={busy || !chosen.length}
          onClick={() => void act('download')}
        >
          打包下载原件
        </StudioButton>
      </div>
    </Dialog>
  );
}
function size(bytes: number) {
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
