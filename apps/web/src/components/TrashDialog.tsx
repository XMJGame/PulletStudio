import { useEffect, useState } from 'react';
import { api, ApiError, Project } from '../api';
import { Dialog } from './Dialog';

export function TrashDialog({
  workspaceId,
  onClose,
  onRestored,
  onUnauthorized,
}: {
  workspaceId: string;
  onClose: () => void;
  onRestored: (project: Project) => void;
  onUnauthorized: () => void;
}) {
  const [items, setItems] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [more, setMore] = useState<string>();
  const path = `/workspaces/${workspaceId}/trash/projects`;
  function report(reason: unknown) {
    if (reason instanceof ApiError && reason.status === 401) onUnauthorized();
    setError(reason instanceof Error ? reason.message : '读取回收站失败');
  }
  async function load(cursor?: string) {
    setLoading(true);
    setError('');
    try {
      const rows = await api<Project[]>(path + (cursor ? `?cursor=${cursor}` : ''));
      setItems((previous) => (cursor ? [...previous, ...rows] : rows));
      setMore(rows.length === 100 ? rows.at(-1)!.id : undefined);
    } catch (reason) {
      report(reason);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let active = true;
    void api<Project[]>(path)
      .then((rows) => {
        if (active) {
          setItems(rows);
          setMore(rows.length === 100 ? rows.at(-1)!.id : undefined);
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
  }, [workspaceId]);
  return (
    <Dialog
      title="项目回收站"
      description="恢复后沿用原编号、成员关系与已保存内容。"
      busy={busy}
      onClose={onClose}
    >
      <div className="dialog-body">
        {error && (
          <div role="alert" className="notice error">
            {error}
          </div>
        )}
        <div className="section-heading">
          <p className="muted">只显示你有管理权限的项目。</p>
          <button disabled={loading || busy} onClick={() => void load()}>
            刷新回收站
          </button>
        </div>
        {loading && (
          <p role="status" className="muted">
            正在读取…
          </p>
        )}
        {!loading && !items.length && (
          <div className="empty-state">
            <h3>回收站为空</h3>
            <p>移入回收站的项目会显示在这里。</p>
          </div>
        )}
        {items.map((project) => (
          <article className="trash-row" key={project.id}>
            <div>
              <h3>{project.title}</h3>
              <p>
                {project.code} · {new Date(project.deletedAt!).toLocaleString('zh-CN')}
              </p>
            </div>
            <button
              className="primary"
              disabled={busy || loading}
              aria-label={`恢复项目 ${project.title}`}
              onClick={() => {
                setBusy(true);
                setError('');
                void api<Project>(`/projects/${project.id}/restore`, 'POST', {
                  expectedVersion: project.version,
                })
                  .then((restored) => {
                    setItems((previous) => previous.filter((item) => item.id !== restored.id));
                    onRestored(restored);
                  })
                  .catch(report)
                  .finally(() => setBusy(false));
              }}
            >
              恢复项目
            </button>
          </article>
        ))}
        {more && (
          <button disabled={loading || busy} onClick={() => void load(more)}>
            加载更多项目
          </button>
        )}
        <p className="field-hint">暂不自动清理，当前没有永久删除入口。</p>
      </div>
    </Dialog>
  );
}
