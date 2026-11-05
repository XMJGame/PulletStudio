import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { Dialog } from '../components/Dialog';
import { parameterLabels } from '../components/GenerationParameters';
import { GenerationSettings } from './GenerationSettings';
import { capabilityLabels, type GenerationConfig } from './workflow-types';
import './workflow-center.css';
export default function WorkflowCenter({
  projectId,
  onClose,
  onUnauthorized,
}: {
  projectId: string;
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const [config, setConfig] = useState<GenerationConfig>();
  const [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false),
    [leaving, setLeaving] = useState(false);
  const [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [query, setQuery] = useState('');
  const path = `/projects/${projectId}`;
  function report(reason: unknown) {
    if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) {
      setConfig(undefined);
      setDirty(false);
      if (reason.status === 401) onUnauthorized();
    }
    setError(reason instanceof Error ? reason.message : '读取或保存失败，输入已保留');
  }
  async function refreshConfig() {
    setConfig(await api<GenerationConfig>(`${path}/generation-config`));
  }
  useEffect(() => {
    let live = true;
    void api<GenerationConfig>(`${path}/generation-config`)
      .then((value) => {
        if (live) setConfig(value);
      })
      .catch((reason) => {
        if (live) report(reason);
      });
    return () => {
      live = false;
    };
  }, [projectId]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
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
  function close() {
    if (dirty) setLeaving(true);
    else onClose();
  }
  return (
    <Dialog
      title="工作流中心"
      description="管理员配置技术工作流，创作者在镜头中选择已保存配置。此处不执行生成。"
      onClose={close}
      busy={busy}
      className="workflow-center-dialog"
    >
      <div className="dialog-body">
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="notice success">
            {message}
          </p>
        )}
        {!config && !error && <p role="status">正在读取项目工作流…</p>}
        <div className="workflow-center-layout">
          <section aria-label="已保存的工作流">
            <div className="section-heading">
              <h3>已保存配置</h3>
              <button disabled={busy} onClick={() => void run(refreshConfig)}>
                刷新列表
              </button>
            </div>
            <input
              aria-label="搜索工作流"
              maxLength={120}
              placeholder="搜索名称或生成方式"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="workflow-saved-list">
              {config?.workflows
                .filter((item) =>
                  `${item.name} ${capabilityLabels[item.capability]}`
                    .toLowerCase()
                    .includes(query.trim().toLowerCase()),
                )
                .map((item) => (
                  <article className="panel" key={item.id}>
                    <strong>{item.name}</strong>
                    <p>
                      {capabilityLabels[item.capability]} · {item.enabled ? '连接启用' : '连接已停用'}
                    </p>
                    <p className="field-hint">
                      {item.parameters.length
                        ? item.parameters.map((parameter) => parameterLabels[parameter.key]).join(' · ')
                        : '使用工作流固定参数'}{' '}
                      · {new Date(item.createdAt).toLocaleString()}
                    </p>
                  </article>
                ))}
            </div>
            {config && !config.workflows.length && (
              <p className="field-hint">
                尚无工作流配置。管理员导入API JSON并通过绑定校验后，即可在镜头生成中选择。
              </p>
            )}
            <p className="field-hint">
              现有配置独立保存，历史生成继续引用原配置。家族修订、审批与归档将在下一包接入。
            </p>
          </section>
          <section aria-label="配置工作流">
            {config?.canConfigure ? (
              <GenerationSettings
                config={config}
                projectPath={path}
                busy={busy}
                run={run}
                refreshConfig={refreshConfig}
                setMessage={setMessage}
                expanded
                onDraftChange={setDirty}
              />
            ) : (
              config && (
                <p className="field-hint">
                  当前账户可以浏览已保存配置。连接与工作流由具有实例及工作区管理权限的管理员配置。
                </p>
              )
            )}
          </section>
        </div>
      </div>
      <div className="dialog-footer">
        <span className="field-hint">{dirty ? '有未保存的配置输入' : '生成任务仍在原镜头入口创建'}</span>
        <button disabled={busy} onClick={close}>
          关闭工作流中心
        </button>
      </div>
      {leaving && (
        <Dialog
          title="离开工作流配置"
          description="尚有未保存的配置输入，离开会丢弃当前草稿。"
          onClose={() => setLeaving(false)}
        >
          <div className="dialog-footer">
            <button onClick={() => setLeaving(false)}>继续配置</button>
            <button onClick={onClose}>丢弃输入并离开</button>
          </div>
        </Dialog>
      )}
    </Dialog>
  );
}
