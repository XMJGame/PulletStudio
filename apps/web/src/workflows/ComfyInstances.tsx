import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Connection, GenerationConfig } from './workflow-types';
import { StudioButton } from '../shared/ui/StudioUI';

type PoolDraft = Pick<Connection, 'poolEnabled' | 'poolVersion' | 'maxRunning' | 'maxPending'>;
export function ComfyInstances({
  config,
  projectPath,
  busy,
  run,
  refreshConfig,
  setMessage,
  onDraftChange,
}: {
  config: GenerationConfig;
  projectPath: string;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
  refreshConfig: () => Promise<void>;
  setMessage: (value: string) => void;
  onDraftChange: (dirty: boolean) => void;
}) {
  const [connectionDirty, setConnectionDirty] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, PoolDraft>>({});
  const [checks, setChecks] = useState<Record<string, { version: number; reachable: boolean }>>({});
  const [checking, setChecking] = useState('');
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(
    () => onDraftChange(connectionDirty || Object.keys(drafts).length > 0),
    [connectionDirty, drafts, onDraftChange],
  );
  function change(item: Connection, values: Partial<PoolDraft>) {
    setDrafts((old) => ({ ...old, [item.id]: { ...(old[item.id] ?? item), ...values } }));
  }
  return (
    <section className="comfy-instances" aria-label="ComfyUI 实例管理">
      <div className="comfy-instance-list">
        <div className="v2-library-heading">
          <h3>已添加的实例</h3>
          <span className="field-hint">
            {config.connections.filter((item) => item.poolEnabled).length}/12 已加入自动调度
          </span>
        </div>
        <p className="field-hint">在这里管理连接与调度。工作流的输入、参数及输出在「工作流」中配置。</p>
        {!config.canConfigure && (
          <p className="notice">当前账号可浏览工作流，实例配置需要实例及工作区管理权限。</p>
        )}
        {!config.connections.length && config.canConfigure && (
          <p className="comfy-instance-empty">
            还没有 ComfyUI 实例。添加服务地址后可测试连接，无需先创建工作流。
          </p>
        )}
        {config.connections.map((item) => {
          const draft = drafts[item.id] ?? item;
          const check = checks[item.id]?.version === item.version ? checks[item.id] : undefined;
          return (
            <article className="panel comfy-instance-card" key={item.id} aria-label={`实例 ${item.name}`}>
              <header>
                <strong>{item.name}</strong>
                <span className="v2-workflow-status">{item.enabled ? '已启用' : '已停用'}</span>
              </header>
              {item.baseUrl && <p className="comfy-instance-address">{item.baseUrl}</p>}
              <p className="field-hint" aria-live="polite">
                {checking === item.id
                  ? '正在检测连接…'
                  : check
                    ? check.reachable
                      ? '连接正常 · 本次检测通过'
                      : '连接检测失败'
                    : '尚未检测连接'}
              </p>
              <p className="field-hint">
                {item.poolEnabled ? '参与自动调度' : '未加入自动调度'} · 运行阈值 {item.maxRunning} · 等待阈值{' '}
                {item.maxPending}
              </p>
              {config.canConfigure && (
                <>
                  <div className="v2-library-tools">
                    <StudioButton
                      disabled={busy || !item.enabled}
                      onClick={() =>
                        void run(async () => {
                          setChecking(item.id);
                          try {
                            await api(`/generation-connections/${item.id}/test`, 'POST', {});
                            setChecks((old) => ({
                              ...old,
                              [item.id]: { version: item.version, reachable: true },
                            }));
                            setMessage(`${item.name}：ComfyUI 可达。`);
                          } catch (error) {
                            setChecks((old) => ({
                              ...old,
                              [item.id]: { version: item.version, reachable: false },
                            }));
                            throw error;
                          } finally {
                            setChecking('');
                          }
                        })
                      }
                    >
                      测试连接
                    </StudioButton>
                    <StudioButton
                      variant="ghost"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await api(`/generation-connections/${item.id}`, 'PATCH', {
                            enabled: !item.enabled,
                            expectedVersion: item.version,
                          });
                          await refreshConfig();
                          setMessage(
                            `${item.name}：已${item.enabled ? '停用' : '启用'}，已有工作流和历史任务保留。`,
                          );
                        })
                      }
                    >
                      {item.enabled ? '停用' : '启用'}
                    </StudioButton>
                  </div>
                  <details className="comfy-instance-scheduling">
                    <summary>调度设置</summary>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const submitted = { ...draft };
                        void run(async () => {
                          await api(`/generation-connections/${item.id}/pool`, 'PATCH', {
                            expectedPoolVersion: submitted.poolVersion,
                            poolEnabled: submitted.poolEnabled,
                            maxRunning: submitted.maxRunning,
                            maxPending: submitted.maxPending,
                          });
                          await refreshConfig();
                          setDrafts((old) => {
                            const next = { ...old };
                            delete next[item.id];
                            return next;
                          });
                          setMessage('实例池设置已保存。');
                        });
                      }}
                    >
                      <fieldset className="plain-fieldset" disabled={busy}>
                        <label className="checkbox-label">
                          <input
                            type="checkbox"
                            checked={draft.poolEnabled}
                            onChange={(event) => change(item, { poolEnabled: event.target.checked })}
                          />
                          加入工作区实例池
                        </label>
                        <div className="dialog-field-row">
                          <label>
                            运行任务阈值
                            <input
                              type="number"
                              min={1}
                              max={16}
                              step={1}
                              required
                              value={draft.maxRunning}
                              onChange={(event) => change(item, { maxRunning: Number(event.target.value) })}
                            />
                          </label>
                          <label>
                            等待任务阈值
                            <input
                              type="number"
                              min={1}
                              max={64}
                              step={1}
                              required
                              value={draft.maxPending}
                              onChange={(event) => change(item, { maxPending: Number(event.target.value) })}
                            />
                          </label>
                        </div>
                        {drafts[item.id] && (
                          <p className="field-hint">调度设置尚未保存，切换 Tab 会保留输入。</p>
                        )}
                        <button>保存实例池设置</button>
                      </fieldset>
                    </form>
                  </details>
                </>
              )}
            </article>
          );
        })}
      </div>
      {config.canConfigure && (
        <section className="comfy-instance-create" aria-label="添加 ComfyUI 实例">
          <h3>添加实例</h3>
          <p className="field-hint">填写已有 ComfyUI 服务的地址。添加不会运行工作流或生成素材。</p>
          <form
            ref={formRef}
            onChangeCapture={() => setConnectionDirty(true)}
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void run(async () => {
                await api(`${projectPath}/generation-connections`, 'POST', {
                  name: data.get('name'),
                  baseUrl: data.get('baseUrl'),
                  token: data.get('token'),
                  trustedPrivate: data.has('trustedPrivate'),
                });
                formRef.current?.reset();
                setConnectionDirty(false);
                await refreshConfig();
                setMessage('已添加 ComfyUI 实例。可以测试连接或切换到「工作流」继续配置。');
              });
            }}
          >
            <fieldset className="plain-fieldset" disabled={busy}>
              <label>
                实例名称
                <input
                  name="name"
                  aria-label="实例名称"
                  required
                  maxLength={120}
                  placeholder="例如：创作工作站"
                />
              </label>
              <label>
                ComfyUI 地址
                <input
                  name="baseUrl"
                  aria-label="ComfyUI 地址"
                  type="url"
                  placeholder="http://192.168.x.x:8188"
                  required
                />
              </label>
              <label>
                Bearer 凭据（可选）
                <input name="token" type="password" autoComplete="off" />
              </label>
              <label className="checkbox-label">
                <input type="checkbox" name="trustedPrivate" />
                批准自部署 HTTP 或私有网络地址
              </label>
              <button className="primary">添加实例</button>
            </fieldset>
          </form>
        </section>
      )}
    </section>
  );
}
