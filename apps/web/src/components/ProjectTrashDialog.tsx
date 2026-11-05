import { useState } from 'react';
import { api, ApiError, Project } from '../api';
import { Dialog } from './Dialog';

export function ProjectTrashDialog({
  project,
  onClose,
  onTrashed,
  onUnauthorized,
}: {
  project: Project;
  onClose: () => void;
  onTrashed: (project: Project) => void;
  onUnauthorized: () => void;
}) {
  const [baseline, setBaseline] = useState(project);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) onUnauthorized();
      setError(reason instanceof Error ? reason.message : '操作失败');
      setConflict(reason instanceof ApiError && reason.code === 'VERSION_CONFLICT');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="移入项目回收站"
      description="已保存的剧本、分集、镜头与版本历史会保留。"
      busy={busy}
      onClose={onClose}
    >
      <div className="dialog-body">
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <div className="trash-project-summary">
          <strong>{baseline.title}</strong>
          <span className="badge">{baseline.code}</span>
        </div>
        <p className="muted">
          移入后，项目将从工作台隐藏，成员暂时无法访问。你可以从项目回收站恢复，编号和已保存内容保持不变。
        </p>
        <p className="field-hint">
          本阶段不提供永久删除，也不会自动清理回收站。未保存的表单输入不会写入项目。
        </p>
      </div>
      <div className="dialog-footer">
        {conflict && (
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setBaseline(await api<Project>(`/projects/${project.id}`));
                setConflict(false);
              })
            }
          >
            刷新项目资料
          </button>
        )}
        <button disabled={busy} onClick={onClose}>
          取消
        </button>
        <button
          className="danger"
          disabled={busy || conflict}
          onClick={() =>
            void run(async () => {
              onTrashed(
                await api<Project>(`/projects/${baseline.id}/trash`, 'POST', {
                  expectedVersion: baseline.version,
                }),
              );
            })
          }
        >
          确认移入回收站
        </button>
      </div>
    </Dialog>
  );
}
