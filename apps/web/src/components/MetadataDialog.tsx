import { useState } from 'react';
import { api, ApiError, Project } from '../api';
import { Dialog } from './Dialog';
import { AspectRatioField } from './AspectRatioField';
import { VisualStyleField } from './VisualStyleField';
import { ProjectSetupFields } from './ProjectSetupFields';
import { projectFormData, SettingsImpact } from '../project-settings';
type Props = {
  item: Project;
  onClose: () => void;
  onUnauthorized: () => void;
  onSaved: (item: Project) => void;
  onTrash: (item: Project) => void;
};
export function MetadataDialog(props: Props) {
  const [baseline, setBaseline] = useState<Project>(props.item);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState<{
    input: Record<string, unknown>;
    impact: SettingsImpact;
  }>();
  const path = `/projects/${baseline.id}`;
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 401) props.onUnauthorized();
      setError(reason instanceof Error ? reason.message : '保存失败');
      setConflict(reason instanceof ApiError && reason.code === 'VERSION_CONFLICT');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="项目设置"
      description="调整项目资料，项目编号由系统维护。"
      busy={busy}
      onClose={props.onClose}
    >
      {error && (
        <div role="alert" className="notice error">
          {error}
          {conflict && '。本地输入已保留，请先加载最新版本再编辑。'}
        </div>
      )}
      <form
        key={baseline.version}
        onSubmit={(event) => {
          event.preventDefault();
          let input: Record<string, unknown> = Object.fromEntries(new FormData(event.currentTarget));
          input = projectFormData(input);
          void run(async () => {
            const body = pending
              ? { ...pending.input, acknowledgeImpact: true }
              : { ...input, expectedVersion: baseline.version };
            if (!pending) {
              const impact = await api<SettingsImpact>(`${path}/settings-impact`, 'POST', body);
              if (impact.requiresConfirmation) {
                setPending({ input: body, impact });
                return;
              }
            }
            const saved = await api<Project>(path, 'PATCH', body);
            props.onSaved(saved);
          });
        }}
      >
        <div className="dialog-body">
          {pending && (
            <div role="status" className="notice impact-notice">
              <strong>确认项目设定变更</strong>
              <p>
                当前有 {pending.impact.units} 个制作单元、{pending.impact.shots} 个镜头、
                {pending.impact.scripts} 份剧本。
              </p>
              {pending.impact.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}
          <fieldset className="plain-fieldset" disabled={busy || !!pending}>
            <label>
              项目名称
              <input name="title" required maxLength={200} defaultValue={baseline.title} data-autofocus />
            </label>

            <div className="metadata-code">
              <span>项目编号</span>
              <strong>{baseline.code}</strong>
              <span className="badge">v{baseline.version}</span>
            </div>
            <ProjectSetupFields initial={baseline} />
            <AspectRatioField value={baseline.aspectRatio} />
            <VisualStyleField preset={baseline.stylePreset} description={baseline.styleDescription} />
            <label>
              语言
              <input name="language" minLength={2} maxLength={20} required defaultValue={baseline.language} />
            </label>
            <label>
              项目简介
              <textarea
                name="description"
                rows={4}
                maxLength={20000}
                defaultValue={baseline.description}
                placeholder="故事设定、剧情概述或创作方向"
              />
            </label>
          </fieldset>
        </div>
        <div className="dialog-footer">
          <button
            className="danger-text"
            type="button"
            disabled={busy || !!pending}
            onClick={() => props.onTrash(baseline)}
          >
            移入回收站
          </button>
          {conflict && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setBaseline(await api<Project>(path));
                  setConflict(false);
                  setPending(undefined);
                })
              }
            >
              加载最新版本
            </button>
          )}
          {pending && (
            <button type="button" disabled={busy} onClick={() => setPending(undefined)}>
              返回修改
            </button>
          )}
          <button type="button" disabled={busy} onClick={props.onClose}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy ? '正在保存…' : pending ? '确认并保存项目设定' : '保存项目'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
