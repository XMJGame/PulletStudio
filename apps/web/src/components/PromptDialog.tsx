import { useEffect, useState } from 'react';
import { api, CursorPage } from '../api';
import { CardEditor, PromptArtifact, PromptProfile } from '../prompt-types';
import { Dialog } from './Dialog';
type History = CursorPage<{ id: string; createdAt: string; cardVersion: number }>;
export function PromptDialog({ shotId, onClose }: { shotId: string; onClose: () => void }) {
  const [context, setContext] = useState<CardEditor>();
  const [profiles, setProfiles] = useState<CursorPage<PromptProfile>>({ items: [], nextCursor: null });
  const [selected, setSelected] = useState('');
  const [result, setResult] = useState<PromptArtifact>();
  const [history, setHistory] = useState<History>({ items: [], nextCursor: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [profileForm, setProfileForm] = useState<'new' | 'revise'>();
  const current = profiles.items.find((item) => item.id === selected);
  function report(reason: unknown) {
    setError(reason instanceof Error ? reason.message : '操作失败');
  }
  useEffect(() => {
    let active = true;
    void api<CardEditor>(`/shots/${shotId}/card/editor`)
      .then(async (value) => {
        const [items, versions] = await Promise.all([
          api<CursorPage<PromptProfile>>(`/projects/${value.shot.projectId}/prompt-profiles`),
          api<History>(`/shots/${shotId}/prompts`),
        ]);
        if (active) {
          setContext(value);
          setProfiles(items);
          setHistory(versions);
        }
      })
      .catch((reason) => {
        if (active) report(reason);
      });
    return () => {
      active = false;
    };
  }, [shotId]);
  function compile(mode: 'preview' | 'commit') {
    if (!context) return;
    setBusy(true);
    setError('');
    setMessage('');
    void api<PromptArtifact>(`/shots/${shotId}/prompts/compile`, 'POST', {
      mode,
      expectedShotVersion: context.shot.version,
      expectedProjectVersion: context.project.version,
      profileRevisionId: selected || null,
    })
      .then(async (value) => {
        setResult(value);
        if (mode === 'commit') {
          setMessage('提示词快照已保存');
          setHistory(await api<History>(`/shots/${shotId}/prompts`));
        }
      })
      .catch(report)
      .finally(() => setBusy(false));
  }
  return (
    <Dialog
      title="镜头提示词"
      description="离线编译完整文本，不调用模型。保存后固定输入版本；实际模型与媒体能力仍需验证。"
      busy={busy}
      onClose={onClose}
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
        {!context ? (
          <p>正在读取…</p>
        ) : (
          <>
            <p className="field-hint">
              {context.shot.code} · 镜头 v{context.shot.version} · 项目设定 v{context.project.version}
            </p>
            {!context.card.available && (
              <p className="notice error">请先编辑并保存完整制作卡，再编译提示词。</p>
            )}
            <label>
              提示词 Profile
              <select
                aria-label="提示词 Profile"
                value={selected}
                disabled={busy}
                onChange={(event) => {
                  setSelected(event.target.value);
                  setResult(undefined);
                  setProfileForm(undefined);
                  setMessage('');
                }}
              >
                <option value="">中立手工交付 · 内置 v1</option>
                {profiles.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · v{item.version}
                  </option>
                ))}
              </select>
            </label>
            {profiles.nextCursor && (
              <button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void api<CursorPage<PromptProfile>>(
                    `/projects/${context.shot.projectId}/prompt-profiles?cursor=${profiles.nextCursor}`,
                  )
                    .then((value) =>
                      setProfiles((previous) => ({
                        items: [...previous.items, ...value.items],
                        nextCursor: value.nextCursor,
                      })),
                    )
                    .catch(report)
                    .finally(() => setBusy(false));
                }}
              >
                更多 Profile
              </button>
            )}
            {context.canManage && (
              <div className="review-actions">
                <button disabled={busy} onClick={() => setProfileForm('new')}>
                  新建提示词 Profile
                </button>
                {current && (
                  <button disabled={busy} onClick={() => setProfileForm('revise')}>
                    修订所选 Profile
                  </button>
                )}
              </div>
            )}
            {profileForm && (
              <form
                key={`${profileForm}:${current?.id}`}
                className="prompt-profile-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  const lines = (key: string) =>
                    String(data.get(key) || '')
                      .split(/\r?\n/)
                      .map((value) => value.trim())
                      .filter(Boolean);
                  const body = {
                    name: data.get('name'),
                    config: {
                      prefix: data.get('prefix'),
                      suffix: data.get('suffix'),
                      positiveRules: lines('positiveRules'),
                      negativeRules: lines('negativeRules'),
                      negativeMode: data.get('negativeMode'),
                    },
                    ...(profileForm === 'revise' ? { expectedVersion: current!.version } : {}),
                  };
                  setBusy(true);
                  setError('');
                  void api<PromptProfile>(
                    profileForm === 'revise'
                      ? `/prompt-profiles/${current!.id}/revisions`
                      : `/projects/${context.shot.projectId}/prompt-profiles`,
                    'POST',
                    body,
                  )
                    .then((value) => {
                      setProfiles((previous) => ({
                        ...previous,
                        items: [
                          ...previous.items.filter((item) => item.profileId !== value.profileId),
                          value,
                        ],
                      }));
                      setSelected(value.id);
                      setResult(undefined);
                      setProfileForm(undefined);
                      setMessage('Profile 修订已保存');
                    })
                    .catch(report)
                    .finally(() => setBusy(false));
                }}
              >
                <h3>{profileForm === 'new' ? '新建 Profile' : '追加 Profile 修订'}</h3>
                <fieldset className="plain-fieldset" disabled={busy}>
                  <label>
                    Profile 名称
                    <input
                      name="name"
                      maxLength={100}
                      required
                      defaultValue={profileForm === 'revise' ? current?.name : ''}
                    />
                  </label>
                  <label>
                    提示词前置说明
                    <textarea
                      name="prefix"
                      rows={2}
                      maxLength={4000}
                      defaultValue={profileForm === 'revise' ? current?.config.prefix : ''}
                    />
                  </label>
                  <label>
                    正向约束（每行一项）
                    <textarea
                      name="positiveRules"
                      rows={3}
                      maxLength={10000}
                      defaultValue={profileForm === 'revise' ? current?.config.positiveRules.join('\n') : ''}
                    />
                  </label>
                  <label>
                    禁止项（每行一项）
                    <textarea
                      name="negativeRules"
                      rows={3}
                      maxLength={10000}
                      defaultValue={profileForm === 'revise' ? current?.config.negativeRules.join('\n') : ''}
                    />
                  </label>
                  <label>
                    禁止项表达
                    <select
                      name="negativeMode"
                      defaultValue={profileForm === 'revise' ? current?.config.negativeMode : 'separate'}
                    >
                      <option value="separate">单独负面提示词</option>
                      <option value="inline">写入正向避开说明</option>
                    </select>
                  </label>
                  <label>
                    提示词后置说明
                    <textarea
                      name="suffix"
                      rows={2}
                      maxLength={4000}
                      defaultValue={profileForm === 'revise' ? current?.config.suffix : ''}
                    />
                  </label>
                  <button className="primary">保存 Profile 修订</button>
                  <button type="button" onClick={() => setProfileForm(undefined)}>
                    取消 Profile 编辑
                  </button>
                </fieldset>
              </form>
            )}
            <div className="review-actions">
              <button
                disabled={busy || !context.card.available || !!profileForm}
                onClick={() => compile('preview')}
              >
                预览完整提示词
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void api<CardEditor>(`/shots/${shotId}/card/editor`)
                    .then((value) => {
                      setContext(value);
                      setResult(undefined);
                      setMessage('已刷新镜头和项目基线，请重新预览');
                    })
                    .catch(report)
                    .finally(() => setBusy(false));
                }}
              >
                刷新编译基线
              </button>
            </div>
            {result && (
              <section className="prompt-result" aria-label="提示词结果">
                <p>
                  {result.id ? '已保存快照' : '尚未保存的预览'} · 卡 v{result.snapshot.card.version} ·{' '}
                  {result.snapshot.profile.name} v{result.snapshot.profile.version}
                </p>
                {result.freshness.stale && (
                  <p role="alert" className="notice error">
                    历史输入已有变化：{result.freshness.reasons.join('；')}
                    。快照原样保留，请刷新基线后重新编译。
                  </p>
                )}
                <label>
                  完整正向提示词
                  <textarea
                    aria-label="完整正向提示词"
                    readOnly
                    rows={10}
                    value={result.rendered.positivePrompt}
                  />
                </label>
                <label>
                  完整负面提示词
                  <textarea
                    aria-label="完整负面提示词"
                    readOnly
                    rows={3}
                    value={result.rendered.negativePrompt}
                  />
                </label>
                <button
                  disabled={busy}
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(
                        [
                          result.rendered.positivePrompt,
                          result.rendered.negativePrompt
                            ? `负面提示词：${result.rendered.negativePrompt}`
                            : '',
                        ]
                          .filter(Boolean)
                          .join('\n\n'),
                      )
                      .then(() => setMessage('完整提示词已复制'))
                      .catch(() => setError('复制失败，请从文本框选择并复制，内容已保留。'));
                  }}
                >
                  复制完整提示词
                </button>
                <ul className="field-hint">
                  {result.rendered.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </section>
            )}
            <h3>已保存提示词</h3>
            {!history.items.length && <p className="muted">尚无已保存快照。</p>}
            {history.items.map((item) => (
              <button
                key={item.id}
                disabled={busy}
                className="revision-item"
                onClick={() => {
                  setBusy(true);
                  void api<PromptArtifact>(`/shots/${shotId}/prompts/${item.id}`)
                    .then(setResult)
                    .catch(report)
                    .finally(() => setBusy(false));
                }}
              >
                查看提示词快照 · 卡 v{item.cardVersion} · {new Date(item.createdAt).toLocaleString()}
              </button>
            ))}
            {history.nextCursor && (
              <button
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void api<History>(`/shots/${shotId}/prompts?cursor=${history.nextCursor}`)
                    .then((value) =>
                      setHistory((previous) => ({
                        items: [...previous.items, ...value.items],
                        nextCursor: value.nextCursor,
                      })),
                    )
                    .catch(report)
                    .finally(() => setBusy(false));
                }}
              >
                更多提示词快照
              </button>
            )}
          </>
        )}
      </div>
      <div className="dialog-footer">
        <button disabled={busy} onClick={onClose}>
          关闭
        </button>
        <button
          className="primary"
          disabled={busy || !context?.canEdit || !result || !!result.id || !!profileForm}
          onClick={() => compile('commit')}
        >
          保存提示词快照
        </button>
      </div>
    </Dialog>
  );
}
