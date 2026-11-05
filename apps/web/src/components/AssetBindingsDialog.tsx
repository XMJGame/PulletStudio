import { useEffect, useState } from 'react';
import { api, ApiError, CursorPage } from '../api';
import { CardEditor } from '../prompt-types';
import { Entity, EntityReference, EntityRevision, entityLabels } from '../entity-types';
import { Dialog } from './Dialog';
export function AssetBindingsDialog({
  shotId,
  onClose,
  onSaved,
}: {
  shotId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [context, setContext] = useState<CardEditor>(),
    [entities, setEntities] = useState<CursorPage<Entity>>({ items: [], nextCursor: null }),
    [references, setReferences] = useState<(EntityReference & { detail: EntityRevision })[]>([]);
  const [chosen, setChosen] = useState(''),
    [revisions, setRevisions] = useState<{
      items: { id: string; version: number }[];
      nextCursor: number | null;
    }>({ items: [], nextCursor: null }),
    [revisionId, setRevisionId] = useState(''),
    [purpose, setPurpose] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [conflict, setConflict] = useState(false),
    [message, setMessage] = useState('');
  function report(reason: unknown) {
    setError(reason instanceof Error ? reason.message : '资产引用操作失败');
    setConflict(reason instanceof ApiError && reason.status === 409);
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
  function show(value: CardEditor) {
    setContext(value);
    setReferences(
      (value.card.assetReferences ?? []).map((detail) => ({
        revisionId: detail.id,
        purpose: detail.purpose ?? '',
        detail,
      })),
    );
    setConflict(false);
  }
  useEffect(() => {
    let active = true;
    void api<CardEditor>(`/shots/${shotId}/asset-bindings`)
      .then(async (value) => {
        const page = await api<CursorPage<Entity>>(`/projects/${value.shot.projectId}/entities`);
        if (active) {
          show(value);
          setEntities(page);
        }
      })
      .catch((reason) => {
        if (active) report(reason);
      });
    return () => {
      active = false;
    };
  }, [shotId]);
  return (
    <Dialog
      title="镜头资产引用"
      description="选择明确的资产版本。保存会追加制作卡版本，不会更新旧卡或自动更换候选素材。"
      busy={busy}
      onClose={onClose}
    >
      <div className="dialog-body">
        {error && (
          <p role="alert" className="notice error">
            {error}；引用选择已保留。
          </p>
        )}
        {message && (
          <p role="status" className="notice success">
            {message}
          </p>
        )}
        {!context ? (
          <p>正在读取镜头引用…</p>
        ) : (
          <>
            {!context.card.available && <p className="notice">请先保存完整制作卡，再添加资产引用。</p>}
            <p className="field-hint">
              {context.shot.code} · 制作卡 v{context.shot.version} · {references.length}/20 个固定引用
            </p>
            <section aria-label="已选资产引用">
              {references.map((ref, index) => (
                <article className="entity-reference" key={ref.revisionId}>
                  <div>
                    <strong>
                      {entityLabels[ref.detail.kind]}：{ref.detail.name} · v{ref.detail.version}
                    </strong>
                    <p>{ref.purpose || '未补充用途'} · 草稿，尚未批准</p>
                    <p className="field-hint">{ref.detail.description}</p>
                  </div>
                  {context.canEdit && (
                    <button
                      disabled={busy}
                      onClick={() => setReferences(references.filter((_, i) => i !== index))}
                    >
                      移除此资产引用
                    </button>
                  )}
                </article>
              ))}
              {context.card.assetWarnings?.map((warning) => (
                <p className="notice" key={warning}>
                  {warning}
                </p>
              ))}
            </section>
            {context.canEdit && (
              <fieldset className="plain-fieldset" disabled={busy || !context.card.available}>
                <label>
                  引用资产
                  <select
                    aria-label="引用资产"
                    value={chosen}
                    onChange={(e) => {
                      const id = e.target.value;
                      setChosen(id);
                      setRevisionId('');
                      setRevisions({ items: [], nextCursor: null });
                      if (id)
                        void run(async () => {
                          const h = await api<typeof revisions>(`/entities/${id}/revisions`);
                          setRevisions(h);
                          setRevisionId(h.items[0]?.id ?? '');
                        });
                    }}
                  >
                    <option value="">选择项目资产</option>
                    {entities.items.map((entity) => (
                      <option key={entity.id} value={entity.id}>
                        {entityLabels[entity.kind]} · {entity.revision.name}
                      </option>
                    ))}
                  </select>
                </label>
                {entities.nextCursor && (
                  <button
                    onClick={() =>
                      void run(async () => {
                        const more = await api<CursorPage<Entity>>(
                          `/projects/${context.shot.projectId}/entities?cursor=${entities.nextCursor}`,
                        );
                        setEntities({ ...more, items: [...entities.items, ...more.items] });
                      })
                    }
                  >
                    更多可引用资产
                  </button>
                )}
                <label>
                  引用修订
                  <select
                    aria-label="引用修订"
                    value={revisionId}
                    onChange={(e) => setRevisionId(e.target.value)}
                  >
                    <option value="">选择固定修订</option>
                    {revisions.items.map((ref) => (
                      <option key={ref.id} value={ref.id}>
                        v{ref.version} · 草稿
                      </option>
                    ))}
                  </select>
                </label>
                {revisions.nextCursor && (
                  <button
                    onClick={() =>
                      void run(async () => {
                        const more = await api<typeof revisions>(
                          `/entities/${chosen}/revisions?before=${revisions.nextCursor}`,
                        );
                        setRevisions({ ...more, items: [...revisions.items, ...more.items] });
                      })
                    }
                  >
                    更早可引用修订
                  </button>
                )}
                <label>
                  镜头中的用途
                  <textarea
                    aria-label="镜头中的用途"
                    rows={2}
                    value={purpose}
                    maxLength={1000}
                    onChange={(e) => setPurpose(e.target.value)}
                    placeholder="例如人物在画面左侧，穿当前服装"
                  />
                </label>
                <button
                  disabled={!revisionId || references.length >= 20}
                  onClick={() =>
                    void run(async () => {
                      const version = revisions.items.find((ref) => ref.id === revisionId)?.version;
                      if (!version) return;
                      const value = await api<Entity>(`/entities/${chosen}/revisions/${version}`);
                      if (references.some((ref) => ref.detail.entityId === value.id))
                        throw new Error('此资产已在引用中，请先移除旧引用再选择其他修订');
                      setReferences([...references, { revisionId, purpose, detail: value.revision }]);
                      setPurpose('');
                    })
                  }
                >
                  加入引用列表
                </button>
                <p className="field-hint">
                  没有可选项时，先在项目“资产库”创建设定。资产为草稿，后续仍需正式审批。
                </p>
              </fieldset>
            )}
          </>
        )}
      </div>
      <div className="dialog-footer">
        {conflict && (
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => show(await api<CardEditor>(`/shots/${shotId}/asset-bindings`)))
            }
          >
            载入最新引用
          </button>
        )}
        <button disabled={busy} onClick={onClose}>
          关闭
        </button>
        {context?.canEdit && (
          <button
            className="primary"
            disabled={busy || !context.card.available}
            onClick={() =>
              void run(async () => {
                const value = await api<CardEditor>(`/shots/${shotId}/asset-bindings`, 'POST', {
                  expectedShotCardVersion: context.shot.version,
                  bindings: references.map(({ revisionId, purpose }) => ({ revisionId, purpose })),
                });
                show(value);
                setMessage('固定资产引用已保存为新制作卡版本');
                onSaved();
              })
            }
          >
            保存镜头资产引用
          </button>
        )}
      </div>
    </Dialog>
  );
}
