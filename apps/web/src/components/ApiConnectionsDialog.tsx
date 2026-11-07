import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { StudioButton } from '../shared/ui/StudioUI';
import { Dialog } from './Dialog';
import './api-connections.css';

const presets = [
  {
    name: 'ModelScope',
    detail: '魔搭中国站 · 免费推理额度',
    baseUrl: 'https://api-inference.modelscope.cn/v1',
    model: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
    keyUrl: 'https://modelscope.cn/my/myaccesstoken',
  },
  {
    name: 'Agnes AI',
    detail: '国际站 · 文本模型限时试用',
    baseUrl: 'https://apihub.agnes-ai.com/v1',
    model: 'agnes-2.5-flash',
    keyUrl: 'https://wiki.agnes-ai.com/en/docs/quickstart',
  },
];
type Connection = {
  id: string;
  baseUrl: string;
  enabled: boolean;
  hasApiKey: boolean;
  version: number;
  profiles: { model: string }[];
};
type Connections = { encryptionReady: boolean; items: Connection[] };

export function ApiConnectionsDialog({
  workspaceId,
  canCreate,
  onClose,
}: {
  workspaceId: string;
  canCreate: boolean;
  onClose: () => void;
}) {
  const path = `/workspaces/${workspaceId}/text-connections`;
  const imagePath = `/workspaces/${workspaceId}/modelscope-generation`;
  const [data, setData] = useState<Connections>();
  const [image, setImage] = useState<{ configured: boolean; encryptionReady: boolean }>();
  const [imageKey, setImageKey] = useState('');
  const [keys, setKeys] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    api<Connections>(path).then(
      (result) => active && setData(result),
      (reason) => active && setError(reason.message || '无法加载 API 设置'),
    );
    return () => {
      active = false;
    };
  }, [path]);
  useEffect(() => {
    if (!canCreate) return;
    let active = true;
    void api<{ configured: boolean; encryptionReady: boolean }>(imagePath).then(
      (value) => active && setImage(value),
      (reason) => active && setError(reason.message || '无法加载 ModelScope 文生图设置'),
    );
    return () => {
      active = false;
    };
  }, [canCreate, imagePath]);

  async function save(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      setNotice(message);
      setData(await api<Connections>(path));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'API 设置未更新');
      if (reason instanceof ApiError && reason.status === 409) {
        const latest = await api<Connections>(path).catch(() => undefined);
        if (latest) setData(latest);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title="API 设置"
      description="快捷配置带免费额度或限时试用的文本模型。额度以平台账号为准。"
      className="api-connections"
      busy={busy}
      onClose={onClose}
    >
      <div className="dialog-body">
        <p className="field-hint">凭据按工作区加密保存。ModelScope 文生图在画布的「生成引擎」里使用。</p>
        {!data && !error && <p role="status">正在读取工作区连接…</p>}
        {data && !data.encryptionReady && (
          <p role="status">服务端需初始化 Provider 加密密钥后才能保存凭据。</p>
        )}
        {data && !canCreate && <p className="field-hint">新增平台连接需要实例管理员。</p>}
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {data && (
          <div className="api-connections-grid">
            {image && (
              <form
                className="api-connection-card"
                aria-label="ModelScope 文生图"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (busy || !image.encryptionReady || !imageKey.trim()) return;
                  void save(async () => {
                    await api(imagePath, 'POST', { token: imageKey.trim() });
                    setImage({ ...image, configured: true });
                    setImageKey('');
                  }, 'ModelScope 文生图凭据已保存');
                }}
              >
                <div className="api-connection-heading">
                  <strong>ModelScope 文生图</strong>
                  <span>{image.configured ? '凭据已保存' : '未配置'}</span>
                </div>
                <p>Qwen Image 2512 · 使用账号现有额度</p>
                <label>
                  文生图 API Key
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    maxLength={8192}
                    value={imageKey}
                    disabled={busy || !image.encryptionReady}
                    onChange={(event) => setImageKey(event.target.value)}
                  />
                </label>
                <StudioButton
                  type="submit"
                  variant="primary"
                  disabled={busy || !image.encryptionReady || !imageKey.trim()}
                >
                  保存文生图凭据
                </StudioButton>
              </form>
            )}
            {presets.map((preset) => {
              const connection = data.items.find(
                (item) =>
                  item.baseUrl.replace(/\/$/, '') === preset.baseUrl &&
                  item.profiles.some((profile) => profile.model === preset.model),
              );
              const key = keys[preset.name] ?? '';
              const editable = !busy && data.encryptionReady && (!!connection || canCreate);
              const patch = (target: Connection, changes: { apiKey: string } | { enabled: boolean }) =>
                api(`/text-connections/${target.id}`, 'PATCH', {
                  expectedVersion: target.version,
                  ...changes,
                });
              return (
                <form
                  key={preset.name}
                  className="api-connection-card"
                  aria-label={preset.name}
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!editable || !key.trim()) return;
                    const apiKey = key.trim();
                    void save(async () => {
                      if (connection) {
                        await patch(connection, { apiKey });
                      } else {
                        await api(path, 'POST', {
                          name: preset.name,
                          baseUrl: preset.baseUrl,
                          apiKey,
                          profile: { name: preset.model, model: preset.model, outputMode: 'prompt_json' },
                        });
                      }
                      setKeys((current) => ({ ...current, [preset.name]: '' }));
                    }, `${preset.name} 凭据已保存`);
                  }}
                >
                  <div className="api-connection-heading">
                    <strong>{preset.name}</strong>
                    <span>
                      {!connection
                        ? '未配置'
                        : !connection.enabled
                          ? '已停用'
                          : connection.hasApiKey
                            ? '凭据已保存'
                            : '缺少凭据'}
                    </span>
                  </div>
                  <p>{preset.detail}</p>
                  <p className="api-connection-model">
                    {connection?.profiles.map((profile) => profile.model).join(' · ') || preset.model}
                  </p>
                  <a href={preset.keyUrl} target="_blank" rel="noreferrer">
                    获取 {preset.name} 凭据 ↗
                  </a>
                  <label>
                    {preset.name} API Key
                    <input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={8192}
                      value={key}
                      disabled={!editable}
                      onChange={(event) => setKeys({ ...keys, [preset.name]: event.target.value })}
                    />
                  </label>
                  <div className="api-connection-actions">
                    <StudioButton type="submit" variant="primary" disabled={!editable || !key.trim()}>
                      保存凭据
                    </StudioButton>
                    {connection && (
                      <StudioButton
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          void save(
                            () => patch(connection, { enabled: !connection.enabled }),
                            `${preset.name} 已${connection.enabled ? '停用' : '启用'}`,
                          )
                        }
                      >
                        {connection.enabled ? '停用' : '启用'}
                      </StudioButton>
                    )}
                  </div>
                </form>
              );
            })}
          </div>
        )}
      </div>
    </Dialog>
  );
}
