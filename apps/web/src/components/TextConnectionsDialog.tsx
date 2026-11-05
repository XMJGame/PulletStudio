import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { TextConnection, TextConnectionList } from '../analysis-types';
import { Dialog } from './Dialog';

function ProfileFields() {
  return (
    <>
      <div className="dialog-field-row">
        <label>
          模型配置名称
          <input name="profileName" required maxLength={100} placeholder="例如：分镜分析模型" />
        </label>
        <label>
          模型名称
          <input name="model" required maxLength={200} placeholder="填写服务商提供的模型名称" />
        </label>
      </div>
      <div className="dialog-field-row">
        <label>
          结构化输出模式
          <select name="outputMode" defaultValue="json_schema">
            <option value="json_schema">JSON Schema</option>
            <option value="json_object">JSON Object</option>
            <option value="prompt_json">仅提示词约束 JSON</option>
          </select>
        </label>
        <label>
          输出上限参数
          <select name="tokenParameter">
            <option value="max_tokens">max_tokens</option>
            <option value="max_completion_tokens">max_completion_tokens</option>
          </select>
        </label>
      </div>
      <div className="dialog-field-row">
        <label>
          最大输出 Tokens
          <input type="number" name="maxOutputTokens" required defaultValue={4096} min={256} max={16384} />
        </label>
        <label>
          请求超时（秒）
          <input type="number" name="timeoutSeconds" required defaultValue={120} min={10} max={300} />
        </label>
      </div>
    </>
  );
}
function profileData(data: Record<string, FormDataEntryValue>) {
  return {
    name: String(data.profileName),
    model: String(data.model),
    outputMode: String(data.outputMode),
    tokenParameter: String(data.tokenParameter),
    maxOutputTokens: Number(data.maxOutputTokens),
    timeoutSeconds: Number(data.timeoutSeconds),
  };
}
export function TextConnectionsDialog({
  workspaceId,
  canManage,
  instanceAdmin,
  onClose,
  onUnauthorized,
  onChanged,
}: {
  workspaceId: string;
  canManage: boolean;
  instanceAdmin: boolean;
  onClose: () => void;
  onUnauthorized: () => void;
  onChanged: () => void;
}) {
  const [connections, setConnections] = useState<TextConnectionList>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [adding, setAdding] = useState(false);
  const [modelFor, setModelFor] = useState<string>();
  const [rotating, setRotating] = useState<TextConnection>();
  const path = `/workspaces/${workspaceId}/text-connections`;
  function report(reason: unknown) {
    if (reason instanceof ApiError && reason.status === 401) onUnauthorized();
    setError(reason instanceof Error ? reason.message : '操作失败');
  }
  async function refresh() {
    setConnections(await api<TextConnectionList>(path));
  }
  useEffect(() => {
    let active = true;
    void api<TextConnectionList>(path)
      .then((value) => {
        if (active) setConnections(value);
      })
      .catch((reason) => {
        if (active) report(reason);
      });
    return () => {
      active = false;
    };
  }, [workspaceId]);
  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
      setAdding(false);
      setModelFor(undefined);
      setRotating(undefined);
      setMessage(success);
      onChanged();
      try {
        await refresh();
      } catch {
        setError('操作已完成，但列表刷新失败，请关闭后重新打开。');
      }
    } catch (reason) {
      report(reason);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="文本模型连接"
      description="配置兼容接口与模型。保存连接不会发送剧本或调用付费模型。"
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
        {connections && !connections.encryptionReady && (
          <p className="notice error">本机尚未准备 Provider 加密密钥，请管理员完成初始化后再保存 API Key。</p>
        )}
        {!connections && <p role="status">正在读取连接…</p>}
        {connections?.items.map((connection) => (
          <article className="text-connection" key={connection.id}>
            <div className="section-heading">
              <strong>{connection.name}</strong>
              <span className="badge">{connection.enabled ? '启用' : '停用'}</span>
            </div>
            <p className="field-hint">{connection.baseUrl}</p>
            <p className="field-hint">
              {connection.trustedPrivate ? '已批准自部署 / 私有端点' : '公网 HTTPS 端点'} ·{' '}
              {connection.hasApiKey ? '已加密保存凭据' : '无 API Key'}
            </p>
            {connection.profiles.map((model) => (
              <p className="model-row" key={model.id}>
                {model.name} · {model.model}
                <small>
                  {model.outputMode} · {model.maxOutputTokens} tokens
                </small>
              </p>
            ))}
            {canManage && (
              <div className="form-actions">
                <button disabled={busy || adding} onClick={() => setModelFor(connection.id)}>
                  添加文本模型
                </button>
                <button disabled={busy || adding} onClick={() => setRotating(connection)}>
                  更新连接凭据
                </button>
                <button
                  disabled={busy || adding}
                  onClick={() =>
                    void run(
                      async () => {
                        await api(`/text-connections/${connection.id}`, 'PATCH', {
                          expectedVersion: connection.version,
                          enabled: !connection.enabled,
                        });
                      },
                      connection.enabled ? '连接已停用，历史草案保留。' : '连接已启用',
                    )
                  }
                >
                  {connection.enabled ? '停用连接' : '启用连接'}
                </button>
              </div>
            )}
          </article>
        ))}
        {canManage && instanceAdmin && !adding && (
          <button
            disabled={busy}
            onClick={() => {
              setAdding(true);
              setModelFor(undefined);
              setRotating(undefined);
            }}
          >
            新增文本连接
          </button>
        )}
        {canManage && !instanceAdmin && (
          <p className="field-hint">
            新端点需由已加入本工作区的实例管理员批准。可为现有连接添加模型或更新凭据。
          </p>
        )}
        {adding && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = Object.fromEntries(new FormData(event.currentTarget));
              void run(async () => {
                await api(path, 'POST', {
                  name: data.connectionName,
                  baseUrl: data.baseUrl,
                  apiKey: data.apiKey || '',
                  trustedPrivate: data.trustedPrivate === 'on',
                  profile: profileData(data),
                });
              }, '文本连接已保存');
            }}
          >
            <fieldset className="plain-fieldset" disabled={busy}>
              <h3>新增连接及首个模型</h3>
              <label>
                连接名称
                <input name="connectionName" required maxLength={100} />
              </label>
              <label>
                API 基础地址
                <input
                  name="baseUrl"
                  type="url"
                  required
                  maxLength={1000}
                  placeholder="https://你的服务地址/v1"
                />
              </label>
              <label>
                API Key
                <input
                  name="apiKey"
                  type="password"
                  maxLength={8192}
                  autoComplete="off"
                  placeholder="无鉴权的自部署服务可留空"
                />
              </label>
              <label className="checkbox-label">
                <input name="trustedPrivate" type="checkbox" />
                批准访问此自部署端点（允许本机 / 内网及 HTTP）
              </label>
              <p className="field-hint">请只批准你管理的服务。结构化输出模式和上限参数须与所选模型兼容。</p>
              <ProfileFields />
              <div className="form-actions">
                <button type="button" onClick={() => setAdding(false)}>
                  取消新增
                </button>
                <button className="primary">保存文本连接</button>
              </div>
            </fieldset>
          </form>
        )}
        {modelFor && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = Object.fromEntries(new FormData(event.currentTarget));
              void run(async () => {
                await api(`/text-connections/${modelFor}/models`, 'POST', profileData(data));
              }, '文本模型配置已添加');
            }}
          >
            <fieldset className="plain-fieldset" disabled={busy}>
              <h3>为连接添加模型配置</h3>
              <ProfileFields />
              <div className="form-actions">
                <button type="button" onClick={() => setModelFor(undefined)}>
                  取消添加
                </button>
                <button className="primary">保存文本模型</button>
              </div>
            </fieldset>
          </form>
        )}
        {rotating && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void run(async () => {
                await api(`/text-connections/${rotating.id}`, 'PATCH', {
                  expectedVersion: rotating.version,
                  apiKey: String(data.get('apiKey') || ''),
                });
              }, '凭据已更新，旧凭据不会回显');
            }}
          >
            <fieldset className="plain-fieldset" disabled={busy}>
              <label>
                新 API Key
                <input
                  name="apiKey"
                  type="password"
                  maxLength={8192}
                  autoComplete="off"
                  placeholder="留空会移除连接凭据"
                />
              </label>
              <div className="form-actions">
                <button type="button" onClick={() => setRotating(undefined)}>
                  取消更新
                </button>
                <button className="primary">保存新凭据</button>
              </div>
            </fieldset>
          </form>
        )}
      </div>
    </Dialog>
  );
}
