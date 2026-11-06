import React, { FormEvent, lazy, Suspense, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, ApiError, Project, User, Workspace } from './api';
import { Dialog } from './components/Dialog';
import { WorkspaceMenu } from './components/WorkspaceMenu';
import { AspectRatioField } from './components/AspectRatioField';
import { MetadataDialog } from './components/MetadataDialog';
import { VisualStyleField } from './components/VisualStyleField';
import { visualStyleLabel } from './visual-style';
import { TeamDialog } from './components/TeamDialog';
import { TrashDialog } from './components/TrashDialog';
import { ProjectTrashDialog } from './components/ProjectTrashDialog';
import { ProjectSetupFields } from './components/ProjectSetupFields';
import { projectFormData } from './project-settings';
import { CreationWorkspace } from './components/CreationWorkspace';
import { lastBoard } from './canvas/board-preferences';
import './style.css';
const BoardWorkspace = lazy(() => import('./canvas/BoardWorkspace'));
const WorkflowCenter = lazy(() => import('./workflows/WorkflowCenter'));

type Status = { initialized: boolean; setupEnabled: boolean };
type Access = { canEdit: boolean; canManage: boolean };
const roles: Record<string, string> = {
  WORKSPACE_OWNER: '所有者',
  WORKSPACE_ADMIN: '管理员',
  MEMBER: '成员',
  PROJECT_MANAGER: '项目管理',
  EDITOR: '编辑',
  GENERATOR: '生成',
  REVIEWER: '审核',
  VIEWER: '只读',
};
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
  const [projectView, setProjectView] = useState<'create' | 'canvas'>('create');
  const [showWorkflowCenter, setShowWorkflowCenter] = useState(false);
  const [workspaceForm, setWorkspaceForm] = useState(false);
  const [showTeam, setShowTeam] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [trashProject, setTrashProject] = useState<Project>();
  const [showTrash, setShowTrash] = useState(false);
  const [access, setAccess] = useState<Access>({ canEdit: false, canManage: false });
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
      setProjectId(rows[0]?.id || '');
      setShowTeam(false);
    } else if (projectId) {
      const next = await api<Access>(`/projects/${projectId}/access`);
      setAccess(next);
      if (current.role === 'MEMBER' && !next.canManage) setShowTeam(false);
    }
  }
  function selectWorkspace(id: string) {
    if (user) localStorage.setItem(`pullet.workspace.${user.id}`, id);
    setWorkspaceId(id);
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
          setProjectId(data.find((item) => item.id === stored)?.id || data[0]?.id || '');
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
    setProjectView(
      window.location.hash.startsWith('#canvas') || (user && lastBoard(user.id, projectId))
        ? 'canvas'
        : 'create',
    );
    setAccess({ canEdit: false, canManage: false });
    setShowWorkflowCenter(false);
    setEditProject(undefined);
    if (!projectId) return;
    let active = true;
    void api<Access>(`/projects/${projectId}/access`)
      .then((value) => {
        if (active) setAccess(value);
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
    <div className="studio">
      <aside className="sidebar">
        <div className="brand">
          <span className="mark">P</span>
          <div>
            PULLET<small>STUDIO</small>
          </div>
        </div>
        <WorkspaceMenu
          workspaces={workspaces}
          value={workspaceId}
          disabled={busy}
          canCreate={user.instanceAdmin}
          onChange={selectWorkspace}
          onCreate={() => {
            setError('');
            setWorkspaceForm(true);
          }}
          onJoin={() => {
            setError('');
            setShowJoin(true);
          }}
        />
        <div className="nav-label">
          创作空间<span>01</span>
        </div>
        <div className="nav-active">▦　项目工作台</div>
        <div className="nav-label">
          我的项目
          {workspaceManager && (
            <button
              className="icon-button"
              aria-label="新建项目"
              disabled={busy}
              onClick={() => {
                setError('');
                setProjectForm(true);
              }}
            >
              ＋
            </button>
          )}
        </div>
        <nav aria-label="项目列表">
          {projects.map((x) => (
            <button
              disabled={busy}
              className={`project-link ${projectId === x.id ? 'active' : ''}`}
              key={x.id}
              onClick={() => {
                setProjectId(x.id);
                setShowTeam(false);
              }}
            >
              <span className="project-dot" />
              <span>
                {x.title}
                <small>{x.code}</small>
              </span>
            </button>
          ))}
        </nav>
        {workspaceId && (
          <button
            className="sidebar-trash"
            disabled={busy}
            onClick={() => {
              setError('');
              setShowTrash(true);
            }}
          >
            项目回收站
          </button>
        )}
        {!projects.length && (
          <p className="sidebar-hint">
            {workspaceManager ? '创建一个项目，开始构建故事。' : '等待管理员为你分配项目。'}
          </p>
        )}
        <div className="sidebar-bottom">
          <span className="avatar">{user.name.slice(0, 1)}</span>
          <div>
            {user.name}
            <small>{roles[workspace?.role || 'MEMBER']}</small>
          </div>
          <button
            className="text-button"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await api('/auth/logout', 'POST');
                setUser(undefined);
              })
            }
          >
            退出
          </button>
        </div>
      </aside>
      <div className="workspace-main">
        <header className="topbar">
          <div className="breadcrumb">
            工作室 <span>/</span> 项目工作台{' '}
            {project && (
              <>
                <span>/</span>
                <strong>{project.title}</strong>
              </>
            )}
          </div>
          <span className="local-indicator">
            <i /> 私有工作区
          </span>
        </header>
        <main className="content">
          {error && !dialogOpen && (
            <div className="notice error" role="alert">
              {error}
              {error.includes('已被修改') && '。本地输入已保留；点击“加载最新版本”可重新载入。'}
            </div>
          )}
          {message && !dialogOpen && (
            <div className="notice success" role="status">
              {message}
            </div>
          )}
          {projectForm && (
            <Dialog
              title="新建项目"
              description={`在「${workspace?.name || '当前工作区'}」中创建项目，接着规划分集与镜头。`}
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
                    setProjectId(created.id);
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
                    <input
                      name="name"
                      required
                      maxLength={200}
                      data-autofocus
                      placeholder="例如：短片创作团队"
                    />
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
          <div className="page-heading">
            <div>
              <span className="eyebrow">CREATIVE WORKSPACE</span>
              <h1>{project?.title || '每个故事，都从这里开始'}</h1>
              <p className="muted">
                {project
                  ? `${project.code} · ${project.aspectRatio} · ${visualStyleLabel(project.stylePreset)}`
                  : '整理你的想法，逐步搭建属于你的影像世界。'}
              </p>
            </div>
            <div className="heading-actions">
              {project && access.canManage && (
                <button
                  disabled={busy}
                  onClick={() => {
                    setMessage('');
                    setError('');
                    setEditProject(project);
                  }}
                >
                  项目设置
                </button>
              )}
              {(workspaceManager || access.canManage) && (
                <button
                  disabled={busy}
                  onClick={() => {
                    setMessage('');
                    setError('');
                    setShowTeam(true);
                  }}
                >
                  团队协作
                </button>
              )}
              {workspaceManager && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => {
                    setError('');
                    setProjectForm(true);
                  }}
                >
                  ＋ 新建项目
                </button>
              )}
            </div>
          </div>
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
                if (projectId === item.id) setProjectId(projects.find((x) => x.id !== item.id)?.id || '');
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
                setProjectId(item.id);
                setShowTrash(false);
                setMessage('项目已恢复');
              }}
            />
          )}
          {project ? (
            <>
              <div className="workbench-tabs" aria-label="项目工作台视图">
                <button
                  aria-pressed={projectView === 'create'}
                  onClick={() => {
                    setProjectView('create');
                    window.history.replaceState(null, '', window.location.pathname + window.location.search);
                  }}
                >
                  项目创作
                </button>
                <button
                  aria-pressed={projectView === 'canvas'}
                  onClick={() => {
                    setProjectView('canvas');
                    window.history.replaceState(null, '', '#canvas');
                  }}
                >
                  创作画布
                </button>
                <button aria-expanded={showWorkflowCenter} onClick={() => setShowWorkflowCenter(true)}>
                  工作流中心
                </button>
              </div>
              {showWorkflowCenter && (
                <Suspense fallback={<p role="status">正在打开工作流中心…</p>}>
                  <WorkflowCenter
                    key={projectId}
                    projectId={projectId}
                    onClose={() => setShowWorkflowCenter(false)}
                    onUnauthorized={() => setUser(undefined)}
                  />
                </Suspense>
              )}
              {projectView === 'canvas' ? (
                <Suspense fallback={<p role="status">正在打开创作画布…</p>}>
                  <BoardWorkspace
                    key={projectId}
                    projectId={projectId}
                    projectTitle={project.title}
                    userId={user.id}
                    canEdit={access.canEdit}
                    onUnauthorized={() => setUser(undefined)}
                    onClose={() => {
                      window.history.replaceState(
                        null,
                        '',
                        window.location.pathname + window.location.search,
                      );
                      setProjectView('create');
                    }}
                  />
                </Suspense>
              ) : (
                <CreationWorkspace
                  key={projectId}
                  projectId={projectId}
                  canEdit={access.canEdit}
                  onCanvas={() => {
                    setProjectView('canvas');
                    window.history.replaceState(null, '', '#canvas');
                  }}
                  onWorkflows={() => setShowWorkflowCenter(true)}
                />
              )}
            </>
          ) : (
            <div className="empty-state large">
              <span className="empty-symbol">▦</span>
              <h2>{workspaceManager ? '开启你的第一个影像项目' : '你的项目会出现在这里'}</h2>
              <p>
                {workspaceManager
                  ? '一个名字，一段故事，无数种可能。'
                  : '请管理员邀请你参与项目，然后刷新页面。'}
              </p>
              {workspaceManager && (
                <button className="primary" onClick={() => setProjectForm(true)}>
                  创建第一个项目 ↗
                </button>
              )}
            </div>
          )}
          <footer className="workspace-footer">
            <span>PULLET STUDIO</span>
            <span>把创作留给灵感，把秩序交给工作室。</span>
          </footer>
        </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
