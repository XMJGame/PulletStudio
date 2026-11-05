import { useEffect, useRef, useState } from 'react';
import { api, ApiError, Member } from '../api';
import { Dialog } from './Dialog';

const projectRoles = {
  PROJECT_MANAGER: '项目管理',
  EDITOR: '编辑',
  GENERATOR: '生成',
  REVIEWER: '审核',
  VIEWER: '只读',
};
const workspaceRoles: Record<string, string> = {
  WORKSPACE_OWNER: '所有者',
  WORKSPACE_ADMIN: '管理员',
  MEMBER: '成员',
};
export function TeamDialog({
  workspaceId,
  workspaceRole,
  projectId,
  canManageProject,
  currentUserId,
  onClose,
  onChanged,
  onUnauthorized,
}: {
  workspaceId: string;
  workspaceRole: string;
  projectId?: string;
  canManageProject: boolean;
  currentUserId: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onUnauthorized: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [assigned, setAssigned] = useState<Member[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [invitation, setInvitation] = useState('');
  const [pending, setPending] = useState<{ scope: 'project' | 'workspace'; member: Member }>();
  const confirmation = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pending) {
      confirmation.current?.focus({ preventScroll: true });
      confirmation.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [pending]);
  const workspaceManager = workspaceRole !== 'MEMBER';
  const owner = workspaceRole === 'WORKSPACE_OWNER';
  function report(reason: unknown) {
    if (reason instanceof ApiError && reason.status === 401) onUnauthorized();
    setError(reason instanceof Error ? reason.message : '操作失败');
  }
  async function fetchLists() {
    const [workspaceMembers, projectMembers] = await Promise.all([
      api<Member[]>(
        workspaceManager ? `/workspaces/${workspaceId}/members` : `/projects/${projectId}/member-candidates`,
      ),
      projectId && canManageProject
        ? api<Member[]>(`/projects/${projectId}/members`)
        : Promise.resolve([] as Member[]),
    ]);
    return { workspaceMembers, projectMembers };
  }
  function applyLists(lists: { workspaceMembers: Member[]; projectMembers: Member[] }) {
    setMembers(lists.workspaceMembers);
    setAssigned(lists.projectMembers);
  }
  useEffect(() => {
    let active = true;
    void fetchLists()
      .then((lists) => {
        if (active) applyLists(lists);
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
  }, [workspaceId, projectId]);
  async function mutate(action: () => Promise<void>, success: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      setPending(undefined);
      setMessage(success);
      await onChanged();
      try {
        applyLists(await fetchLists());
      } catch {
        setError('操作已完成，但列表刷新失败。请关闭后重新打开团队协作。');
      }
    } catch (reason) {
      report(reason);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="团队协作"
      description="工作区身份决定管理范围，项目角色决定具体创作权限。"
      busy={busy}
      onClose={onClose}
    >
      <div className="dialog-body">
        {error && (
          <div role="alert" className="notice error">
            {error}
          </div>
        )}
        {message && (
          <div role="status" className="notice success">
            {message}
          </div>
        )}
        {workspaceManager && (
          <section className="team-section">
            <h3>邀请加入工作区</h3>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const body = Object.fromEntries(new FormData(event.currentTarget));
                void mutate(async () => {
                  const result = await api<{ token: string }>(
                    `/workspaces/${workspaceId}/invitations`,
                    'POST',
                    body,
                  );
                  setInvitation(result.token);
                }, '邀请已生成，48 小时内有效。');
              }}
            >
              <fieldset className="plain-fieldset" disabled={busy || loading}>
                <div className="form-row">
                  <label>
                    邀请邮箱
                    <input name="email" type="email" required data-autofocus />
                  </label>
                  <label>
                    工作区身份
                    <select name="role">
                      <option value="MEMBER">成员</option>
                      {owner && <option value="WORKSPACE_ADMIN">管理员</option>}
                    </select>
                  </label>
                  <button>生成邀请</button>
                </div>
              </fieldset>
            </form>
            {invitation && (
              <label>
                邀请令牌（仅显示本次）
                <input readOnly value={invitation} onFocus={(event) => event.target.select()} />
                <small className="field-hint">
                  通过可信方式发给受邀者，在登录页选择“收到邀请？加入工作区”。
                </small>
              </label>
            )}
          </section>
        )}
        <div className="section-heading">
          <h3>成员与权限</h3>
          <button
            className="text-button"
            disabled={busy || loading}
            onClick={() => {
              setLoading(true);
              setError('');
              void fetchLists()
                .then((lists) => {
                  applyLists(lists);
                  setMessage('成员列表已更新');
                })
                .catch(report)
                .finally(() => setLoading(false));
            }}
          >
            刷新成员
          </button>
        </div>
        {loading && (
          <p className="muted" role="status">
            正在读取成员…
          </p>
        )}
        {projectId && canManageProject && (
          <section className="team-section">
            <h3>当前项目成员</h3>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const data = Object.fromEntries(new FormData(event.currentTarget));
                const current = assigned.find((item) => item.id === data.userId);
                void mutate(async () => {
                  await api(`/projects/${projectId}/members`, 'POST', {
                    ...data,
                    expectedRole: current?.role,
                  });
                }, '项目角色已保存');
              }}
            >
              <fieldset className="plain-fieldset" disabled={busy || loading}>
                <div className="form-row">
                  <label>
                    项目成员
                    <select name="userId" required>
                      {members
                        .filter((item) => item.role === 'MEMBER')
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} · {item.email}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    项目角色
                    <select name="role">
                      {Object.entries(projectRoles).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button disabled={!members.some((item) => item.role === 'MEMBER')}>分配角色</button>
                </div>
              </fieldset>
            </form>
            <div className="member-list">
              {assigned.map((member) => (
                <article className="member-row" key={`${member.id}:${member.role}`}>
                  <div className="member-identity">
                    <strong>
                      {member.name}
                      {member.id === currentUserId && <small>（你）</small>}
                    </strong>
                    <span>{member.email}</span>
                  </div>
                  {member.workspaceRole !== 'MEMBER' ? (
                    <span className="badge">
                      工作区{workspaceRoles[member.workspaceRole || 'WORKSPACE_ADMIN']}
                    </span>
                  ) : (
                    <>
                      <form
                        className="member-role-form"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const role = new FormData(event.currentTarget).get('role');
                          void mutate(async () => {
                            await api(`/projects/${projectId}/members`, 'POST', {
                              userId: member.id,
                              role,
                              expectedRole: member.role,
                            });
                          }, '项目角色已保存');
                        }}
                      >
                        <select
                          name="role"
                          aria-label={`调整项目身份：${member.name}`}
                          defaultValue={member.role}
                          disabled={busy || loading}
                        >
                          {Object.entries(projectRoles).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                        <button disabled={busy || loading} aria-label={`保存项目身份：${member.name}`}>
                          保存
                        </button>
                      </form>
                      <button
                        className="danger-text"
                        disabled={busy || loading}
                        aria-label={`移出项目：${member.name}`}
                        onClick={() => setPending({ scope: 'project', member })}
                      >
                        移出项目
                      </button>
                    </>
                  )}
                </article>
              ))}
            </div>
            <p className="field-hint">
              工作区所有者和管理员拥有全部项目管理权限，不受项目角色降级或移出操作限制。
            </p>
          </section>
        )}
        {workspaceManager && (
          <section className="team-section">
            <h3>工作区成员</h3>
            <div className="member-list">
              {members.map((member) => (
                <article className="member-row" key={`${member.id}:${member.role}`}>
                  <div className="member-identity">
                    <strong>
                      {member.name}
                      {member.id === currentUserId && <small>（你）</small>}
                    </strong>
                    <span>{member.email}</span>
                  </div>
                  {member.role === 'WORKSPACE_OWNER' ? (
                    <span className="badge">所有者 · 受保护</span>
                  ) : (
                    <>
                      {owner ? (
                        <form
                          className="member-role-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const role = new FormData(event.currentTarget).get('role');
                            void mutate(async () => {
                              await api(`/workspaces/${workspaceId}/members/${member.id}`, 'PATCH', {
                                role,
                                expectedRole: member.role,
                              });
                            }, '工作区身份已保存');
                          }}
                        >
                          <select
                            name="role"
                            aria-label={`调整工作区身份：${member.name}`}
                            defaultValue={member.role}
                            disabled={busy || loading}
                          >
                            <option value="MEMBER">成员</option>
                            <option value="WORKSPACE_ADMIN">管理员</option>
                          </select>
                          <button disabled={busy || loading} aria-label={`保存工作区身份：${member.name}`}>
                            保存
                          </button>
                        </form>
                      ) : (
                        <span className="badge">{workspaceRoles[member.role]}</span>
                      )}
                      {(owner || member.role === 'MEMBER') && (
                        <button
                          className="danger-text"
                          disabled={busy || loading}
                          aria-label={`移出工作区：${member.name}`}
                          onClick={() => setPending({ scope: 'workspace', member })}
                        >
                          移出工作区
                        </button>
                      )}
                    </>
                  )}
                </article>
              ))}
            </div>
          </section>
        )}
        {pending && (
          <div
            ref={confirmation}
            tabIndex={-1}
            className="member-removal"
            role="group"
            aria-label="移除成员确认"
          >
            <h3>移除 {pending.member.name}？</h3>
            <p>
              {pending.scope === 'workspace'
                ? '将撤销此工作区及其全部项目的访问权，保留历史署名和其他工作区身份。'
                : '将撤销此项目的访问权，仍保留工作区身份和历史署名。'}
            </p>
            <div className="form-actions">
              <button disabled={busy} onClick={() => setPending(undefined)}>
                取消移除
              </button>
              <button
                className="danger"
                disabled={busy || loading}
                onClick={() =>
                  void mutate(async () => {
                    await api(
                      pending.scope === 'workspace'
                        ? `/workspaces/${workspaceId}/members/${pending.member.id}`
                        : `/projects/${projectId}/members/${pending.member.id}`,
                      'DELETE',
                      { expectedRole: pending.member.role },
                    );
                  }, '成员已移除')
                }
              >
                确认移除成员
              </button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
