import React, { FormEvent, lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, ApiError, Project, User, Workspace } from './api';
import { Dialog } from './components/Dialog';
import { WorkspaceMenu } from './components/WorkspaceMenu';
import { AspectRatioField } from './components/AspectRatioField';
import { MetadataDialog } from './components/MetadataDialog';
import { VisualStyleField } from './components/VisualStyleField';
import { TeamDialog } from './components/TeamDialog';
import { TrashDialog } from './components/TrashDialog';
import { ProjectTrashDialog } from './components/ProjectTrashDialog';
import { ProjectSetupFields } from './components/ProjectSetupFields';
import { projectFormData } from './project-settings';
import './style.css';
import './shared/styles/studio-tokens.css';
import { StudioProjectGallery } from './features/projects/StudioProjectGallery';
import { StudioButton } from './shared/ui/StudioUI';
import {
  readStudioTheme,
  saveStudioTheme,
  readRecentProjects,
  rememberProject,
} from './features/projects/studio-preferences';
const BoardWorkspace = lazy(() => import('./canvas/BoardWorkspace'));
const WorkflowCenter = lazy(() => import('./workflows/WorkflowCenter'));

type Status = { initialized: boolean; setupEnabled: boolean };
type Access = { canEdit: boolean; canManage: boolean };
function values(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
}

function AuthScreen({
  status,
  busy,
  error,
  submit,
}: {
  status: Status;
  busy: boolean;
  error: string;
  submit: (path: string, data: unknown) => void;
}) {
  const [invite, setInvite] = useState(false);
  const setup = !status.initialized;
  return (
    <main className="welcome">
      <section className="welcome-story">
        <div className="brand">
          <span className="mark">P</span>PULLET STUDIO
        </div>
        <span className="eyebrow">从灵感，到每一次创作</span>
        <h1>
          让想象
          <br />
          有序成为影像<span>。</span>
        </h1>
        <p>
          把参考素材、提示词和生成结果放进同一个创作空间。
          <br />
          在画布上探索，让满意的结果成为下一次创作的起点。
        </p>
        <div className="story-lines">
          <span>01 / 项目资产</span>
          <span>02 / 画布创作</span>
          <span>03 / 生成与复用</span>
        </div>
        <small>PRIVATE WORKSPACE · YOUR STORIES, YOUR SPACE</small>
      </section>
      <section className="auth-panel">
        <span className="eyebrow">欢迎来到你的创作空间</span>
        <h2>{setup ? '创建你的工作室' : invite ? '接受团队邀请' : '继续你的创作'}</h2>
        <p className="muted">
          {setup
            ? '设置管理员账户，开启第一个工作区。'
            : invite
              ? '使用管理员提供的邀请令牌加入工作区。'
              : '登录 Pullet Studio，继续你的创作。'}
        </p>
        {error && (
          <div role="alert" className="notice error">
            {error}
          </div>
        )}
        <form
          onSubmit={(e) =>
            submit(setup ? '/setup/initialize' : invite ? '/invitations/accept' : '/auth/login', values(e))
          }
        >
          {setup && (
            <label>
              初始化密钥
              <input
                name="setupToken"
                type="password"
                autoComplete="off"
                required
                minLength={32}
                placeholder="本机 .env 中的 SETUP_TOKEN"
              />
            </label>
          )}
          {invite && (
            <label>
              邀请令牌
              <input name="token" required minLength={64} maxLength={64} autoComplete="off" />
            </label>
          )}
          {(setup || invite) && (
            <label>
              你的名字
              <input name="name" required maxLength={80} autoComplete="name" />
            </label>
          )}
          {!invite && (
            <label>
              邮箱
              <input name="email" type="email" required autoComplete="username" />
            </label>
          )}
          <label>
            密码
            <input
              name="password"
              type="password"
              required
              minLength={setup || invite ? 8 : 1}
              maxLength={setup || invite ? 16 : 128}
              autoComplete={setup || invite ? 'new-password' : 'current-password'}
              placeholder={setup || invite ? '8–16 位密码' : '输入你的密码'}
            />
          </label>
          {setup && (
            <label>
              工作区名称
              <input name="workspaceName" required maxLength={80} placeholder="例如：我的电影工作室" />
            </label>
          )}
          <button className="primary full" disabled={busy || (setup && !status.setupEnabled)}>
            {busy ? '正在处理…' : setup ? '创建工作室' : invite ? '加入工作区' : '登录工作室'}
            <span>↗</span>
          </button>
        </form>
        {setup && !status.setupEnabled && (
          <p role="alert" className="notice error">
            请先运行 npm run setup 并重启 API，生成初始化密钥。
          </p>
        )}
        {!setup && (
          <button className="text-button" disabled={busy} onClick={() => setInvite(!invite)}>
            {invite ? '返回登录' : '收到邀请？加入工作区'}
          </button>
        )}
        <p className="auth-note">你的内容保存在所部署的工作室中。</p>
      </section>
    </main>
  );
}

function App() {
  const [status, setStatus] = useState<Status>();
  const [user, setUser] = useState<User>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [projectForm, setProjectForm] = useState(false);
  const [editProject, setEditProject] = useState<Project>();
  const [theme, setTheme] = useState(readStudioTheme);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [showWorkflowCenter, setShowWorkflowCenter] = useState(false);
  const [workspaceForm, setWorkspaceForm] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [trashProject, setTrashProject] = useState<Project>();
  const [showTrash, setShowTrash] = useState(false);
  const [projectAccess, setProjectAccess] = useState<{ id: string; value: Access }>();
  const access = projectAccess?.id === projectId ? projectAccess.value : { canEdit: false, canManage: false };
  const workspace = workspaces.find((x) => x.id === workspaceId);
  const project = projects.find((x) => x.id === projectId);
  const workspaceManager = !!workspace && workspace.role !== 'MEMBER';
  const dialogOpen =
    projectForm || workspaceForm || showTeam || showJoin || !!editProject || !!trashProject || showTrash;
  async function refreshMemberships() {
    const available = await api<Workspace[]>('/workspaces');
    setWorkspaces(available);
    const current = available.find((item) => item.id === workspaceId);
    if (!current) {
      setShowTeam(false);
      selectWorkspace(available[0]?.id || '');
      return;
    }
    const rows = await api<Project[]>(`/projects?workspaceId=${workspaceId}`);
    setProjects(rows);
    if (projectId && !rows.some((item) => item.id === projectId)) {
      leaveProject();
      setShowTeam(false);
    } else if (projectId) {
      const next = await api<Access>(`/projects/${projectId}/access`);
      setProjectAccess({ id: projectId, value: next });
      if (current.role === 'MEMBER' && !next.canManage) setShowTeam(false);
    }
  }
  function selectWorkspace(id: string) {
    leaveProject();
    if (user) localStorage.setItem(`pullet.workspace.${user.id}`, id);
    setWorkspaceId(id);
  }
  function leaveProject() {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    setProjectId('');
    setShowWorkflowCenter(false);
  }
  function openProject(id: string) {
    if (!user || !id) return;
    setMessage('');
    window.history.replaceState(null, '', '#canvas');
    setRecentIds(rememberProject(user.id, workspaceId, id));
    setProjectId(id);
  }
  function toggleTheme() {
    const next = theme === 'light' ? 'dark' : 'light';
    setTheme(next);
    saveStudioTheme(next);
  }
  function report(reason: unknown) {
    if (reason instanceof ApiError && reason.status === 401) setUser(undefined);
    setError(reason instanceof Error ? reason.message : '操作失败');
  }
  async function act(action: () => Promise<void>) {
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
  async function boot() {
    const state = await api<Status>('/setup/status');
    setStatus(state);
    if (state.initialized) {
      try {
        setUser((await api<{ user: User }>('/auth/me')).user);
      } catch (reason) {
        if (!(reason instanceof ApiError && reason.status === 401)) throw reason;
      }
    }
  }
  useEffect(() => {
    void boot().catch(report);
  }, []);
  useEffect(() => {
    if (!user) {
      setWorkspaces([]);
      setWorkspaceId('');
      return;
    }
    let live = true;
    void api<Workspace[]>('/workspaces')
      .then((data) => {
        if (live) {
          setWorkspaces(data);
          const stored = localStorage.getItem(`pullet.workspace.${user.id}`);
          setWorkspaceId(data.find((item) => item.id === stored)?.id || data[0]?.id || '');
        }
      })
      .catch((reason) => {
        if (live) report(reason);
      });
    return () => {
      live = false;
    };
  }, [user?.id]);
  useEffect(() => {
    setProjects([]);
    setRecentIds(user && workspaceId ? readRecentProjects(user.id, workspaceId) : []);
    setProjectId('');
    setShowTrash(false);
    setTrashProject(undefined);
    setShowTeam(false);
    setProjectForm(false);
    setError('');
    if (!workspaceId) return;
    let live = true;
    void api<Project[]>(`/projects?workspaceId=${workspaceId}`)
      .then((data) => {
        if (live) {
          setProjects(data);
          let stored: string | null = null;
          try {
            stored = localStorage.getItem(`pullet.project.${user?.id}.${workspaceId}`);
          } catch {
            /* Project selection is optional browser state. */
          }
          if (/^#canvas(?:\/|$)/.test(window.location.hash) && data.some((item) => item.id === stored))
            setProjectId(stored!);
        }
      })
      .catch((reason) => {
        if (live) report(reason);
      });
    return () => {
      live = false;
    };
  }, [workspaceId]);
  useEffect(() => {
    if (
      !user ||
      !projectId ||
      !projects.some((item) => item.id === projectId && item.workspaceId === workspaceId)
    )
      return;
    try {
      localStorage.setItem(`pullet.project.${user.id}.${workspaceId}`, projectId);
    } catch {
      /* Access is always rechecked by the API. */
    }
  }, [projectId, workspaceId, user?.id, projects]);
  useEffect(() => {
    setProjectAccess(undefined);
    setShowWorkflowCenter(false);
    setEditProject(undefined);
    if (!projectId) return;
    let active = true;
    void api<Access>(`/projects/${projectId}/access`)
      .then((value) => {
        if (active) setProjectAccess({ id: projectId, value });
      })
      .catch((reason) => {
        if (active) report(reason);
      });
    return () => {
      active = false;
    };
  }, [projectId]);
  if (!status)
    return (
      <div className="loading">
        <span className="mark">P</span>
        <p>{error || '正在打开工作室…'}</p>
        {error && <button onClick={() => void boot().catch(report)}>重新连接</button>}
      </div>
    );
  if (!user)
    return (
      <AuthScreen
        status={status}
        busy={busy}
        error={error}
        submit={(path, data) =>
          void act(async () => {
            const result = await api<{ user: User }>(path, 'POST', data);
            setUser(result.user);
            setStatus({ ...status, initialized: true });
          })
        }
      />
    );
  return (
    <div className="studio-v2" data-theme={theme}>
      <StudioProjectGallery
        key={workspaceId}
        projects={projects.map((item) => ({
          id: item.id,
          title: item.title,
          category: item.aspectRatio,
          updated: item.updatedAt ? new Date(item.updatedAt).toLocaleDateString() : '',
        }))}
        recentIds={recentIds}
        onOpen={(item) => openProject(item.id)}
        requestCreate={
          workspaceManager
            ? () => {
                setError('');
                setProjectForm(true);
              }
            : undefined
        }
        dark={theme === 'dark'}
        toggleTheme={toggleTheme}
        emptyText={workspaceManager ? '创建一个项目，从第一帧开始。' : '管理员分配给你的项目会显示在这里。'}
        notice={
          !dialogOpen &&
          !project &&
          (error ? (
            <p className="v2-project-notice" role="alert">
              {error}
            </p>
          ) : message ? (
            <p className="v2-project-notice" role="status">
              {message}
            </p>
          ) : undefined)
        }
        topActions={
          <div className="v2-project-top-actions">
            {workspaces.length > 1 && (
              <WorkspaceMenu
                workspaces={workspaces}
                value={workspaceId}
                disabled={busy}
                canCreate={user.instanceAdmin}
                onChange={selectWorkspace}
                onCreate={() => setWorkspaceForm(true)}
                onJoin={() => setShowJoin(true)}
              />
            )}
            <details
              className="v2-account-menu"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
              }}
              onClick={(event) => {
                if (event.target instanceof Element && event.target.closest('button'))
                  event.currentTarget.open = false;
              }}
            >
              <summary>{user.name}</summary>
              <div>
                <StudioButton variant="ghost" disabled={busy} onClick={() => setShowJoin(true)}>
                  加入工作区
                </StudioButton>
                {user.instanceAdmin && (
                  <StudioButton variant="ghost" disabled={busy} onClick={() => setWorkspaceForm(true)}>
                    新建工作区
                  </StudioButton>
                )}
                {workspaceManager && (
                  <StudioButton variant="ghost" disabled={busy} onClick={() => setShowTeam(true)}>
                    团队协作
                  </StudioButton>
                )}
                {workspaceId && (
                  <StudioButton variant="ghost" disabled={busy} onClick={() => setShowTrash(true)}>
                    项目回收站
                  </StudioButton>
                )}
                <StudioButton className="v2-mobile-theme" variant="ghost" onClick={toggleTheme}>
                  {theme === 'dark' ? '浅色界面' : '深色界面'}
                </StudioButton>
                <StudioButton
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await api('/auth/logout', 'POST');
                      leaveProject();
                      setUser(undefined);
                    })
                  }
                >
                  退出
                </StudioButton>
              </div>
            </details>
          </div>
        }
      />
      {project && (
        <Suspense fallback={<p role="status">正在打开创作画布…</p>}>
          <BoardWorkspace
            key={project.id}
            projectId={project.id}
            projectTitle={project.title}
            projectMessage={message}
            userId={user.id}
            canEdit={access.canEdit}
            theme={theme}
            onToggleTheme={toggleTheme}
            onUnauthorized={() => setUser(undefined)}
            onClose={leaveProject}
            onWorkflows={() => setShowWorkflowCenter(true)}
            projectActions={
              <>
                {access.canManage && (
                  <StudioButton variant="ghost" disabled={busy} onClick={() => setEditProject(project)}>
                    项目设置
                  </StudioButton>
                )}
                {(workspaceManager || access.canManage) && (
                  <StudioButton variant="ghost" disabled={busy} onClick={() => setShowTeam(true)}>
                    团队协作
                  </StudioButton>
                )}
              </>
            }
          />
        </Suspense>
      )}
      {project && showWorkflowCenter && (
        <Suspense fallback={<p role="status">正在打开工作流中心…</p>}>
          <WorkflowCenter
            key={projectId}
            theme={theme}
            projectId={projectId}
            onClose={() => setShowWorkflowCenter(false)}
            onUnauthorized={() => setUser(undefined)}
          />
        </Suspense>
      )}
      {projectForm && (
        <Dialog
          title="新建项目"
          description={`在「${workspace?.name || '当前工作区'}」中创建项目，随后进入创作画布。`}
          busy={busy}
          onClose={() => {
            setError('');
            setProjectForm(false);
          }}
        >
          {error && (
            <div role="alert" className="notice error">
              {error}
            </div>
          )}
          <form
            onSubmit={(e) => {
              const data = projectFormData(values(e));
              void act(async () => {
                const created = await api<Project>('/projects', 'POST', { ...data, workspaceId });
                setProjects((previous) => [...previous, created]);
                openProject(created.id);
                setProjectForm(false);
              });
            }}
          >
            <div className="dialog-body">
              <label>
                项目名称
                <input
                  name="title"
                  required
                  maxLength={200}
                  data-autofocus
                  placeholder="为你的故事取个名字"
                />
              </label>
              <ProjectSetupFields creating />
              <AspectRatioField />
              <VisualStyleField />
              <p className="field-hint">项目编号将在创建时自动生成。</p>
            </div>
            <div className="dialog-footer">
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setError('');
                  setProjectForm(false);
                }}
              >
                取消
              </button>
              <button className="primary" disabled={busy}>
                {busy ? '正在创建…' : '创建项目'}
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {editProject && (
        <MetadataDialog
          item={editProject}
          onClose={() => setEditProject(undefined)}
          onUnauthorized={() => setUser(undefined)}
          onTrash={(item) => {
            setEditProject(undefined);
            setTrashProject(item);
          }}
          onSaved={(updated) => {
            setProjects((previous) => previous.map((item) => (item.id === updated.id ? updated : item)));
            setEditProject(undefined);
            setMessage('项目资料已保存');
          }}
        />
      )}
      {workspaceForm && (
        <Dialog
          title="新建工作区"
          description="为独立团队或创作方向建立工作区，成员和项目分别管理。"
          busy={busy}
          onClose={() => {
            setError('');
            setWorkspaceForm(false);
          }}
        >
          {error && (
            <div role="alert" className="notice error">
              {error}
            </div>
          )}
          <form
            onSubmit={(event) => {
              const input = values(event);
              void act(async () => {
                const created = await api<Workspace>('/workspaces', 'POST', input);
                setWorkspaces((previous) => [...previous, { ...created, role: 'WORKSPACE_OWNER' }]);
                selectWorkspace(created.id);
                setWorkspaceForm(false);
                setMessage('工作区已创建');
              });
            }}
          >
            <div className="dialog-body">
              <label>
                工作区名称
                <input name="name" required maxLength={200} data-autofocus placeholder="例如：短片创作团队" />
              </label>
            </div>
            <div className="dialog-footer">
              <button type="button" disabled={busy} onClick={() => setWorkspaceForm(false)}>
                取消
              </button>
              <button className="primary" disabled={busy}>
                {busy ? '正在创建…' : '创建工作区'}
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {showJoin && (
        <Dialog
          title="加入工作区"
          description="输入管理员发给你的邀请令牌，加入对应工作区。"
          busy={busy}
          onClose={() => {
            setError('');
            setShowJoin(false);
          }}
        >
          {error && (
            <div role="alert" className="notice error">
              {error}
            </div>
          )}
          <form
            onSubmit={(event) => {
              const input = values(event);
              void act(async () => {
                await api('/invitations/accept', 'POST', input);
                setWorkspaces(await api<Workspace[]>('/workspaces'));
                setShowJoin(false);
                setMessage('已加入新工作区，可从左上角切换');
              });
            }}
          >
            <div className="dialog-body">
              <label>
                邀请令牌
                <input
                  name="token"
                  required
                  minLength={64}
                  maxLength={64}
                  autoComplete="off"
                  data-autofocus
                />
              </label>
            </div>
            <div className="dialog-footer">
              <button type="button" disabled={busy} onClick={() => setShowJoin(false)}>
                取消
              </button>
              <button className="primary" disabled={busy}>
                接受邀请
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {showTeam && workspace && (
        <TeamDialog
          workspaceId={workspaceId}
          workspaceRole={workspace.role}
          projectId={projectId || undefined}
          canManageProject={access.canManage}
          currentUserId={user.id}
          onClose={() => setShowTeam(false)}
          onChanged={refreshMemberships}
          onUnauthorized={() => setUser(undefined)}
        />
      )}
      {trashProject && (
        <ProjectTrashDialog
          project={trashProject}
          onClose={() => setTrashProject(undefined)}
          onUnauthorized={() => setUser(undefined)}
          onTrashed={(item) => {
            setTrashProject(undefined);
            setProjects((current) => current.filter((x) => x.id !== item.id));
            if (projectId === item.id) leaveProject();
            setShowTeam(false);
            setMessage('项目已移入回收站');
          }}
        />
      )}
      {showTrash && (
        <TrashDialog
          workspaceId={workspaceId}
          onClose={() => setShowTrash(false)}
          onUnauthorized={() => setUser(undefined)}
          onRestored={(item) => {
            setProjects((current) => [...current.filter((x) => x.id !== item.id), item]);
            openProject(item.id);
            setShowTrash(false);
            setMessage('项目已恢复');
          }}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
