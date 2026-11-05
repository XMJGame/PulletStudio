import { useState } from 'react';
import { api, ApiError, Project, Episode } from '../api';
import { Dialog } from './Dialog';
import { AspectRatioField } from './AspectRatioField';
import { VisualStyleField } from './VisualStyleField';
import { ProjectSetupFields } from './ProjectSetupFields';
import { projectFormData, SettingsImpact } from '../project-settings';

type Props = { onClose: () => void; onUnauthorized: () => void } & (
  | { kind: 'project'; item: Project; onSaved: (item: Project) => void; onTrash: (item: Project) => void }
  | { kind: 'episode'; item: Episode; onSaved: (item: Episode) => void }
);
export function MetadataDialog(props: Props) {
  const [baseline, setBaseline] = useState<Project | Episode>(props.item);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [pending, setPending] = useState<{ input: Record<string, unknown>; impact: SettingsImpact }>();
  const project = props.kind === 'project';
  const path = `/${project ? 'projects' : 'episodes'}/${baseline.id}`;
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
      title={project ? '项目设置' : '编辑分集'}
      description={
        project ? '调整项目资料，项目编号由系统维护。' : '修改分集资料及排列顺序，已有镜头会保留。'
      }
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
          if (!project) input.orderIndex = Number(input.orderIndex);
          else input = projectFormData(input);
          void run(async () => {
            const body = pending
              ? { ...pending.input, acknowledgeImpact: true }
              : { ...input, expectedVersion: baseline.version };
            if (project && !pending) {
              const impact = await api<SettingsImpact>(`${path}/settings-impact`, 'POST', body);
              if (impact.requiresConfirmation) {
                setPending({ input: body, impact });
                return;
              }
            }
            const saved = await api<Project | Episode>(path, 'PATCH', body);
            if (props.kind === 'project') props.onSaved(saved as Project);
            else props.onSaved(saved as Episode);
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
              {project ? '项目名称' : '分集名称'}
              <input name="title" required maxLength={200} defaultValue={baseline.title} data-autofocus />
            </label>
            {project ? (
              <>
                <div className="metadata-code">
                  <span>项目编号</span>
                  <strong>{baseline.code}</strong>
                  <span className="badge">v{baseline.version}</span>
                </div>
                <ProjectSetupFields initial={baseline as Project} />
                <AspectRatioField value={(baseline as Project).aspectRatio} />
                <VisualStyleField
                  preset={(baseline as Project).stylePreset}
                  description={(baseline as Project).styleDescription}
                />
                <label>
                  语言
                  <input
                    name="language"
                    minLength={2}
                    maxLength={20}
                    required
                    defaultValue={(baseline as Project).language}
                  />
                </label>
                <label>
                  项目简介
                  <textarea
                    name="description"
                    rows={4}
                    maxLength={20000}
                    defaultValue={(baseline as Project).description}
                    placeholder="故事设定、剧情概述或创作方向"
                  />
                </label>
              </>
            ) : (
              <div className="dialog-field-row">
                <label>
                  分集编号
                  <input readOnly value={baseline.code} />
                </label>
                <label>
                  排列顺序
                  <input
                    name="orderIndex"
                    type="number"
                    required
                    min={0}
                    max={100000}
                    defaultValue={(baseline as Episode).orderIndex}
                  />
                </label>
              </div>
            )}
          </fieldset>
        </div>
        <div className="dialog-footer">
          {props.kind === 'project' && (
            <button
              className="danger-text"
              type="button"
              disabled={busy || !!pending}
              onClick={() => props.onTrash(baseline as Project)}
            >
              移入回收站
            </button>
          )}
          {conflict && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  setBaseline(await api<Project | Episode>(path));
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
            {busy ? '正在保存…' : pending ? '确认并保存项目设定' : project ? '保存项目' : '保存分集'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
