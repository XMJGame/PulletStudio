import { useEffect, useState } from 'react';
import { api, ApiError, CursorPage } from '../api';
import { Entity, EntityKind, entityLabels, attributeLabels, roleLabels } from '../entity-types';
import { MediaAsset, MediaVersion } from '../media-types';
import { Dialog } from './Dialog';
type Draft = {
  name: string;
  description: string;
  attributes: Record<string, string>;
  media: { role: string; mediaVersionId: string; fileName?: string; version?: number; mediaType?: string }[];
};
const empty = (): Draft => ({ name: '', description: '', attributes: {}, media: [] });
type History = { items: { id: string; version: number; name: string }[]; nextCursor: number | null };
type Impacts = {
  items: { id: string; code: string; cardVersion: number; entityVersion: number; current: boolean }[];
  nextCursor: string | null;
};
export function EntityLibraryDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [kind, setKind] = useState<EntityKind>('character'),
    [list, setList] = useState<CursorPage<Entity>>({ items: [], nextCursor: null });
  const [current, setCurrent] = useState<Entity>(),
    [draft, setDraft] = useState<Draft>(empty),
    [history, setHistory] = useState<History>({ items: [], nextCursor: null });
  const [impacts, setImpacts] = useState<Impacts>({ items: [], nextCursor: null });
  const [media, setMedia] = useState<CursorPage<MediaAsset>>({ items: [], nextCursor: null }),
    [versions, setVersions] = useState<{ items: MediaVersion[]; nextCursor: number | null }>({
      items: [],
      nextCursor: null,
    });
  const [mediaAsset, setMediaAsset] = useState(''),
    [mediaVersion, setMediaVersion] = useState(''),
    [role, setRole] = useState('front');
  const [canEdit, setCanEdit] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [conflict, setConflict] = useState(false),
    [message, setMessage] = useState(''),
    [key, setKey] = useState(() => crypto.randomUUID());
  const historical = !!current && current.revision.version !== current.currentVersion;
  function report(reason: unknown) {
    setError(reason instanceof Error ? reason.message : '资产操作失败');
    setConflict(reason instanceof ApiError && reason.status === 409);
  }
  function edit(next: Draft) {
    setDraft(next);
    setKey(crypto.randomUUID());
    setMessage('');
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (reason) {
      report(reason);
    } finally {
      setBusy(false);
    }
  }
  function show(value: Entity) {
    setCurrent(value);
    setDraft({ ...value.revision, media: value.revision.media });
    setKey(crypto.randomUUID());
    setConflict(false);
    setMessage('');
  }
  async function select(value: Entity) {
    show(value);
    if (value.revision.version === value.currentVersion)
      setList((previous) => ({
        ...previous,
        items: previous.items.map((item) => (item.id === value.id ? value : item)),
      }));
    const [h, i] = await Promise.all([
      api<History>(`/entities/${value.id}/revisions`),
      api<Impacts>(`/entities/${value.id}/impacted-shots`),
    ]);
    setHistory(h);
    setImpacts(i);
  }
  useEffect(() => {
    let active = true;
    setCurrent(undefined);
    setDraft(empty());
    setHistory({ items: [], nextCursor: null });
    setImpacts({ items: [], nextCursor: null });
    setError('');
    setMessage('');
    setMediaAsset('');
    setMediaVersion('');
    setVersions({ items: [], nextCursor: null });
    setRole(kind === 'voice' ? 'voice_sample' : kind === 'environment' ? 'overview' : 'front');
    setKey(crypto.randomUUID());
    void Promise.all([
      api<CursorPage<Entity>>(`/projects/${projectId}/entities?kind=${kind}`),
      api<{ canEdit: boolean }>(`/projects/${projectId}/access`),
      api<CursorPage<MediaAsset>>(`/projects/${projectId}/media-assets`),
    ])
      .then(([l, a, m]) => {
        if (active) {
          setList(l);
          setCanEdit(a.canEdit);
          setMedia(m);
        }
      })
      .catch((reason) => {
        if (active) report(reason);
      });
    return () => {
      active = false;
    };
  }, [projectId, kind]);
  async function chooseMedia(id: string) {
    setMediaAsset(id);
    setMediaVersion('');
    setVersions({ items: [], nextCursor: null });
    if (id) {
      const value = await api<{ items: MediaVersion[]; nextCursor: number | null }>(
        `/media-assets/${id}/versions`,
      );
      setVersions(value);
      setMediaVersion(
        value.items.find((item) => item.mediaType === (kind === 'voice' ? 'audio' : 'image'))?.id ?? '',
      );
    }
  }
  const allowedRoles =
    kind === 'voice'
      ? ['voice_sample']
      : kind === 'environment'
        ? ['overview', 'floorplan', 'detail', 'reference']
        : ['front', 'side', 'back', 'closeup', 'detail', 'reference'];
  return (
    <Dialog
      title="资产库"
      description="管理人物、场景、道具和声音设定。每次保存追加草稿版本；已有镜头引用保持原版本。"
      busy={busy}
      onClose={onClose}
    >
      <div className="dialog-body">
        {error && (
          <p role="alert" className="notice error">
            {error}；输入已保留。
          </p>
        )}
        {message && (
          <p role="status" className="notice success">
            {message}
          </p>
        )}
        <div className="review-actions" aria-label="资产类型">
          {Object.entries(entityLabels).map(([id, label]) => (
            <button
              key={id}
              disabled={busy}
              aria-pressed={kind === id}
              onClick={() => setKind(id as EntityKind)}
            >
              {label}
            </button>
          ))}
        </div>
        <section aria-label="资产列表">
          <h3>{entityLabels[kind]}资产</h3>
          {!list.items.length && <p className="muted">还没有{entityLabels[kind]}设定。</p>}
          <div className="entity-list">
            {list.items.map((value) => (
              <button key={value.id} disabled={busy} onClick={() => void run(() => select(value))}>
                {value.revision.name} · v{value.currentVersion} · 草稿
              </button>
            ))}
          </div>
          {list.nextCursor && (
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const next = await api<CursorPage<Entity>>(
                    `/projects/${projectId}/entities?kind=${kind}&cursor=${list.nextCursor}`,
                  );
                  setList({ ...next, items: [...list.items, ...next.items] });
                })
              }
            >
              更多资产
            </button>
          )}
          {canEdit && (
            <button
              disabled={busy}
              onClick={() => {
                setCurrent(undefined);
                edit(empty());
                setHistory({ items: [], nextCursor: null });
                setImpacts({ items: [], nextCursor: null });
                setError('');
                setConflict(false);
              }}
            >
              新建{entityLabels[kind]}
            </button>
          )}
        </section>
        <form
          id="entity-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const payload = {
                name: draft.name,
                description: draft.description,
                attributes: draft.attributes,
                media: draft.media.map(({ role, mediaVersionId }) => ({ role, mediaVersionId })),
              };
              const value = await api<Entity>(
                current ? `/entities/${current.id}/revisions` : `/projects/${projectId}/entities`,
                'POST',
                current
                  ? { expectedVersion: current.currentVersion, body: payload }
                  : { kind, body: payload },
                { 'Idempotency-Key': key },
              );
              await select(value);
              setList(await api(`/projects/${projectId}/entities?kind=${kind}`));
              setMessage(`已保存「${value.revision.name}」v${value.revision.version}，已有镜头引用未改变`);
            });
          }}
        >
          <fieldset className="plain-fieldset" disabled={busy || !canEdit || historical}>
            <h3>{current ? `${draft.name} · v${current.revision.version}` : `新建${entityLabels[kind]}`}</h3>
            {historical && <p className="notice">正在查看历史版本；编辑请载入最新资产。</p>}
            <label>
              资产名称
              <input
                aria-label="资产名称"
                value={draft.name}
                required
                maxLength={200}
                onChange={(e) => edit({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              资产描述
              <textarea
                aria-label="资产描述"
                rows={3}
                maxLength={8000}
                value={draft.description}
                onChange={(e) => edit({ ...draft, description: e.target.value })}
              />
            </label>
            {Object.entries(attributeLabels[kind]).map(([id, label]) => (
              <label key={id}>
                {label}
                <textarea
                  aria-label={label}
                  rows={2}
                  maxLength={id === 'language' ? 80 : id === 'scale' ? 200 : 4000}
                  value={draft.attributes[id] ?? ''}
                  onChange={(e) =>
                    edit({ ...draft, attributes: { ...draft.attributes, [id]: e.target.value } })
                  }
                />
              </label>
            ))}
            {kind === 'voice' && (
              <>
                <label>
                  声音授权状态
                  <select
                    aria-label="声音授权状态"
                    value={draft.attributes.consentStatus ?? 'unknown'}
                    onChange={(e) =>
                      edit({ ...draft, attributes: { ...draft.attributes, consentStatus: e.target.value } })
                    }
                  >
                    <option value="unknown">待核对</option>
                    <option value="owned">自行创作并持有权利</option>
                    <option value="licensed">已获许可</option>
                    <option value="consented">已获本人同意</option>
                  </select>
                </label>
                <p className="field-hint">
                  样本仅上传者、项目管理者或审核者可播放/下载；历史引用也受保护。此处不发送到外部模型，授权未知时不得用于生成。
                </p>
              </>
            )}
            <h3>固定媒体参考</h3>
            {draft.media.map((ref, index) => (
              <div className="entity-reference" key={ref.role + ref.mediaVersionId}>
                {ref.mediaType === 'image' && (
                  <img
                    loading="lazy"
                    src={`/api/v1/media-versions/${ref.mediaVersionId}/poster`}
                    alt={`${roleLabels[ref.role]}参考图`}
                  />
                )}
                <span>
                  {roleLabels[ref.role]} · {ref.fileName ?? '已选媒体'}
                  {ref.version ? ` · v${ref.version}` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => edit({ ...draft, media: draft.media.filter((_, i) => i !== index) })}
                >
                  移除此参考
                </button>
              </div>
            ))}
            <label>
              参考素材
              <select
                aria-label="参考素材"
                value={mediaAsset}
                onChange={(e) => void run(() => chooseMedia(e.target.value))}
              >
                <option value="">从项目素材中选择</option>
                {media.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {media.nextCursor && (
              <button
                type="button"
                onClick={() =>
                  void run(async () => {
                    const more = await api<CursorPage<MediaAsset>>(
                      `/projects/${projectId}/media-assets?cursor=${media.nextCursor}`,
                    );
                    setMedia({ ...more, items: [...media.items, ...more.items] });
                  })
                }
              >
                更多参考素材
              </button>
            )}
            <div className="dialog-field-row">
              <label>
                参考版本
                <select
                  aria-label="参考版本"
                  value={mediaVersion}
                  onChange={(e) => setMediaVersion(e.target.value)}
                >
                  <option value="">选择固定版本</option>
                  {versions.items
                    .filter((v) => v.mediaType === (kind === 'voice' ? 'audio' : 'image'))
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.fileName} · v{v.version}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                参考位置
                <select aria-label="参考位置" value={role} onChange={(e) => setRole(e.target.value)}>
                  {allowedRoles.map((id) => (
                    <option key={id} value={id}>
                      {roleLabels[id]}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {versions.nextCursor && (
              <button
                type="button"
                onClick={() =>
                  void run(async () => {
                    const more = await api<typeof versions>(
                      `/media-assets/${mediaAsset}/versions?before=${versions.nextCursor}`,
                    );
                    setVersions({ ...more, items: [...versions.items, ...more.items] });
                  })
                }
              >
                更早参考版本
              </button>
            )}
            <button
              type="button"
              disabled={!mediaVersion || draft.media.length >= 10}
              onClick={() => {
                const value = versions.items.find((v) => v.id === mediaVersion);
                if (!value) return;
                if (draft.media.some((ref) => ref.mediaVersionId === value.id && ref.role === role)) {
                  setError('此媒体参考已添加');
                  return;
                }
                edit({
                  ...draft,
                  media: [
                    ...draft.media,
                    {
                      mediaVersionId: value.id,
                      role,
                      fileName: value.fileName,
                      version: value.version,
                      mediaType: value.mediaType,
                    },
                  ],
                });
              }}
            >
              添加媒体参考
            </button>
            <p className="field-hint">
              每个版本最多10项。需先在“项目素材”导入文件；新增媒体版本不会替换此处固定引用。
            </p>
          </fieldset>
        </form>
        {current && (
          <>
            <h3>资产版本历史</h3>
            <div className="review-actions">
              {history.items.map((item) => (
                <button
                  disabled={busy}
                  key={item.id}
                  onClick={() =>
                    void run(async () =>
                      show(await api<Entity>(`/entities/${current.id}/revisions/${item.version}`)),
                    )
                  }
                >
                  查看资产 v{item.version}
                </button>
              ))}
            </div>
            {history.nextCursor && (
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const more = await api<History>(
                      `/entities/${current.id}/revisions?before=${history.nextCursor}`,
                    );
                    setHistory({ ...more, items: [...history.items, ...more.items] });
                  })
                }
              >
                更早资产版本
              </button>
            )}
            <h3>引用此资产的镜头</h3>
            {!impacts.items.length && <p className="muted">尚无镜头引用。</p>}
            {impacts.items.map((item) => (
              <p key={item.id}>
                {item.code} · 制作卡 v{item.cardVersion} · 资产 v{item.entityVersion} ·{' '}
                {item.current ? '当前卡引用' : '历史卡引用'}
              </p>
            ))}
            {impacts.nextCursor && (
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const more = await api<Impacts>(
                      `/entities/${current.id}/impacted-shots?cursor=${impacts.nextCursor}`,
                    );
                    setImpacts({ ...more, items: [...impacts.items, ...more.items] });
                  })
                }
              >
                更多引用镜头
              </button>
            )}
          </>
        )}
      </div>
      <div className="dialog-footer">
        {current && (conflict || historical) && (
          <button
            disabled={busy}
            onClick={() => void run(async () => select(await api<Entity>(`/entities/${current.id}`)))}
          >
            载入最新资产
          </button>
        )}
        <button disabled={busy} onClick={onClose}>
          关闭
        </button>
        {canEdit && (
          <button className="primary" form="entity-form" disabled={busy || historical}>
            保存资产版本
          </button>
        )}
      </div>
    </Dialog>
  );
}
