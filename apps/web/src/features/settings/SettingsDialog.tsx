import { useCallback, useContext, useEffect, useState } from 'react';
import { api, ApiError } from '../../api';
import { Dialog } from '../../components/Dialog';
import { ApiConnectionsPanel } from '../../components/ApiConnectionsDialog';
import { ComfyInstances } from '../../workflows/ComfyInstances';
import WorkflowCenter from '../../workflows/WorkflowCenter';
import type { GenerationConfig } from '../../workflows/workflow-types';
import { StudioButton } from '../../shared/ui/StudioUI';
import { SettingsLayout, type SettingsSection } from './SettingsLayout';
import './settings.css';

type Parts = Record<SettingsSection, boolean>;
const emptyParts: Parts = { instances: false, workflows: false, api: false };
export default function SettingsDialog({
  workspaceId,
  workspaceName,
  projects,
  canManageApi,
  canCreateApi,
  theme,
  onClose,
  onUnauthorized,
}: {
  workspaceId: string;
  workspaceName: string;
  projects: { id: string; title: string }[];
  canManageApi: boolean;
  canCreateApi: boolean;
  theme: 'light' | 'dark';
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const [section, setSection] = useState<SettingsSection>('instances');
  const [provider, setProvider] = useState<'ModelScope' | 'Agnes AI'>('ModelScope');
  const [navigation, setNavigation] = useState<HTMLElement | null>(null);
  const [mobilePane, setMobilePane] = useState<'navigation' | 'detail'>('navigation');
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [pendingProject, setPendingProject] = useState<string>();
  const [dirty, setDirty] = useState<Parts>(emptyParts);
  const [working, setWorking] = useState<Parts>(emptyParts);
  const [leaving, setLeaving] = useState(false);
  const busy = Object.values(working).some(Boolean);
  const hasDraft = Object.values(dirty).some(Boolean);
  const instanceDirty = useCallback(
    (value: boolean) => setDirty((old) => ({ ...old, instances: value })),
    [],
  );
  const workflowDirty = useCallback(
    (value: boolean) => setDirty((old) => ({ ...old, workflows: value })),
    [],
  );
  const apiDirty = useCallback((value: boolean) => setDirty((old) => ({ ...old, api: value })), []);
  const instanceBusy = useCallback(
    (value: boolean) => setWorking((old) => ({ ...old, instances: value })),
    [],
  );
  const workflowBusy = useCallback(
    (value: boolean) => setWorking((old) => ({ ...old, workflows: value })),
    [],
  );
  const apiBusy = useCallback((value: boolean) => setWorking((old) => ({ ...old, api: value })), []);
  const showDetail = useCallback(() => setMobilePane('detail'), []);
  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projectId, projects]);
  useEffect(() => {
    if (!hasDraft) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [hasDraft]);
  function choose(next: SettingsSection, platform?: typeof provider) {
    setSection(next);
    if (platform) setProvider(platform);
    setMobilePane(next === 'api' ? 'detail' : 'navigation');
  }
  function changeProject(next: string) {
    if (dirty.workflows) setPendingProject(next);
    else setProjectId(next);
  }
  return (
    <Dialog
      title="设置"
      description={`当前工作区：${workspaceName}。连接在工作区共用，工作流保留所属项目。`}
      className="studio-v2 v2-library studio-settings"
      theme={theme}
      busy={busy}
      onClose={() => (hasDraft ? setLeaving(true) : onClose())}
    >
      <div className="settings-mobile-nav">
        <button
          disabled={busy}
          aria-pressed={mobilePane === 'navigation'}
          onClick={() => setMobilePane('navigation')}
        >
          设置导航
        </button>
        <button disabled={busy} aria-pressed={mobilePane === 'detail'} onClick={showDetail}>
          当前配置
        </button>
      </div>
      <div className="dialog-body settings-split" data-pane={mobilePane}>
        <aside className="settings-navigation" aria-label="设置导航栏">
          <nav aria-label="设置分类">
            <span className="settings-category">ComfyUI</span>
            <button
              disabled={busy}
              aria-current={section === 'instances' ? 'page' : undefined}
              onClick={() => choose('instances')}
            >
              实例
            </button>
            <button
              disabled={busy}
              aria-current={section === 'workflows' ? 'page' : undefined}
              onClick={() => choose('workflows')}
            >
              工作流
            </button>
            <span className="settings-category">API 设置</span>
            {(['ModelScope', 'Agnes AI'] as const).map((item) => (
              <button
                key={item}
                disabled={busy}
                aria-current={section === 'api' && provider === item ? 'page' : undefined}
                onClick={() => choose('api', item)}
              >
                {item}
              </button>
            ))}
          </nav>
          {section === 'workflows' && (
            <label className="settings-project-filter">
              所属项目
              <select
                aria-label="工作流所属项目"
                disabled={busy || !projects.length}
                value={projectId}
                onChange={(event) => changeProject(event.target.value)}
              >
                {!projects.length && <option value="">尚无项目</option>}
                {projects.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div ref={setNavigation} />
        </aside>
        <main className="settings-detail" aria-label="设置详情">
          <SettingsLayout.Provider value={{ navigation, section, provider, showDetail }}>
            <div className="settings-panel" hidden={section !== 'instances'}>
              <InstancesPanel
                workspaceId={workspaceId}
                onDirty={instanceDirty}
                onBusy={instanceBusy}
                onUnauthorized={onUnauthorized}
              />
            </div>
            <div className="settings-panel" hidden={section !== 'workflows'}>
              {projectId ? (
                <WorkflowCenter
                  key={projectId}
                  projectId={projectId}
                  theme={theme}
                  onUnauthorized={onUnauthorized}
                  onDraftChange={workflowDirty}
                  onBusyChange={workflowBusy}
                />
              ) : (
                <div className="settings-empty">
                  <h3>工作流按项目管理</h3>
                  <p>
                    当前工作区尚无可访问的项目。创建项目后，可在这里导入和配置其工作流。实例与 API
                    可以先行配置。
                  </p>
                </div>
              )}
            </div>
            <div className="settings-panel" hidden={section !== 'api'}>
              {canManageApi ? (
                <ApiConnectionsPanel
                  workspaceId={workspaceId}
                  canCreate={canCreateApi}
                  onDraftChange={apiDirty}
                  onBusyChange={apiBusy}
                  onUnauthorized={onUnauthorized}
                />
              ) : (
                <p className="notice">API 配置需要工作区管理权限。</p>
              )}
            </div>
          </SettingsLayout.Provider>
        </main>
      </div>
      <div className="dialog-footer">
        <span className="field-hint">
          {hasDraft ? '有未保存的配置输入，切换分类会保留。' : '设置仅作用于当前工作区。'}
        </span>
        <StudioButton disabled={busy} onClick={() => (hasDraft ? setLeaving(true) : onClose())}>
          关闭设置
        </StudioButton>
      </div>
      {leaving && (
        <Dialog
          title="离开设置"
          description="尚有未保存的实例、工作流或 API 输入。离开会丢弃当前草稿，已保存配置不变。"
          theme={theme}
          onClose={() => setLeaving(false)}
        >
          <div className="dialog-footer">
            <button onClick={() => setLeaving(false)}>继续配置</button>
            <button onClick={onClose}>丢弃输入并离开</button>
          </div>
        </Dialog>
      )}
      {pendingProject !== undefined && (
        <Dialog
          title="切换工作流项目"
          description="切换将丢弃当前工作流草稿。实例和 API 草稿会保留，服务器上的历史修订不变。"
          theme={theme}
          onClose={() => setPendingProject(undefined)}
        >
          <div className="dialog-footer">
            <button onClick={() => setPendingProject(undefined)}>保留草稿</button>
            <button
              onClick={() => {
                setProjectId(pendingProject);
                workflowDirty(false);
                setPendingProject(undefined);
              }}
            >
              丢弃工作流草稿并切换
            </button>
          </div>
        </Dialog>
      )}
    </Dialog>
  );
}

function InstancesPanel({
  workspaceId,
  onDirty,
  onBusy,
  onUnauthorized,
}: {
  workspaceId: string;
  onDirty: (value: boolean) => void;
  onBusy: (value: boolean) => void;
  onUnauthorized: () => void;
}) {
  const { section } = useContext(SettingsLayout);
  const [config, setConfig] = useState<Pick<GenerationConfig, 'connections' | 'canConfigure'>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const path = `/workspaces/${workspaceId}`;
  useEffect(() => onBusy(busy), [busy, onBusy]);
  function report(reason: unknown) {
    if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) {
      setConfig(undefined);
      onDirty(false);
      if (reason.status === 401) onUnauthorized();
    }
    setError(reason instanceof Error ? reason.message : '无法读取实例配置');
  }
  async function refresh() {
    setConfig(await api(`${path}/generation-connections`));
  }
  useEffect(() => {
    if (section !== 'instances') return;
    let live = true;
    void api<Pick<GenerationConfig, 'connections' | 'canConfigure'>>(`${path}/generation-connections`)
      .then((value) => {
        if (live) setConfig(value);
      })
      .catch((reason) => {
        if (live) report(reason);
      });
    return () => {
      live = false;
    };
  }, [path, section]);
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
  return (
    <>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="notice success" role="status">
          {message}
        </p>
      )}
      {!config && !error && <p role="status">正在读取工作区实例…</p>}
      {config && (
        <ComfyInstances
          config={config}
          workspacePath={path}
          busy={busy}
          run={run}
          refreshConfig={refresh}
          setMessage={setMessage}
          onDraftChange={onDirty}
        />
      )}
    </>
  );
}
