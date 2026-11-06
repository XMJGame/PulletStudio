import { useEffect, useRef, useState } from 'react';
import { api, ApiError, CursorPage } from '../api';
import { Dialog } from '../components/Dialog';
import type { GenerationConfig } from '../workflows/workflow-types';
import { LibraryRevision, LibraryView, PromptDraft } from './prompt-library-types';
import { StudioButton } from '../shared/ui/StudioUI';
import { StudioLibraryNav, type LibraryPane } from '../shared/ui/StudioLibraryNav';
import './prompt-library.css';
type Body = {
  title: string;
  positivePrompt: string;
  negativePrompt: string;
  source: string;
  tags: string[];
  workflowId: string | null;
};
type Summary = { id: string; title: string; version: number; tags: string[]; preview: string };
type Listing = CursorPage<Summary> & { canEdit: boolean };
type History = { items: { version: number; title: string; createdAt: string }[]; nextCursor: number | null };
const bodyFrom = (value?: PromptDraft): Body => ({
  title: value?.title ?? '',
  positivePrompt: value?.positivePrompt ?? '',
  negativePrompt: value?.negativePrompt ?? '',
  source: value?.source ?? '',
  tags: value?.tags ?? [],
  workflowId: value?.workflowId ?? null,
});
export function PromptLibraryDialog({
  projectId,
  initialDraft,
  theme,
  onApply,
  onClose,
}: {
  projectId: string;
  initialDraft?: PromptDraft;
  theme: 'light' | 'dark';
  onApply?: (revision: LibraryRevision) => void | Promise<void>;
  onClose: () => void;
}) {
  const [list, setList] = useState<Listing>(),
    [selected, setSelected] = useState<LibraryView>(),
    [body, setBody] = useState<Body>(() => bodyFrom(initialDraft)),
    [history, setHistory] = useState<History>();
  const [pane, setPane] = useState<LibraryPane>(initialDraft ? 'detail' : 'list');
  const [q, setQ] = useState(''),
    [tag, setTag] = useState(''),
    [tagText, setTagText] = useState(initialDraft?.tags?.join(', ') ?? ''),
    [config, setConfig] = useState<GenerationConfig>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [conflict, setConflict] = useState(false),
    [savingAllowed, setSavingAllowed] = useState(false);
  const attempt = useRef({ body: '', key: '' }),
    baseline = useRef(JSON.stringify(bodyFrom(initialDraft)));
  const historical = !!selected && selected.revision.version !== selected.currentVersion;
  const path = `/projects/${projectId}/prompt-library`,
    query = `?q=${encodeURIComponent(q)}&tag=${encodeURIComponent(tag)}`;
  function edited() {
    return (
      JSON.stringify({
        ...body,
        tags: tagText
          .split(/[,，]/)
          .map((value) => value.trim())
          .filter(Boolean),
      }) !== baseline.current
    );
  }
  function discard() {
    return !edited() || window.confirm('当前提示词尚未保存，确认放弃本地修改？');
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '提示词操作失败');
      setConflict(reason instanceof ApiError && reason.code === 'VERSION_CONFLICT');
      if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) {
        setSavingAllowed(false);
        setList(undefined);
        setSelected(undefined);
        setHistory(undefined);
      }
    } finally {
      setBusy(false);
    }
  }
  async function loadList() {
    const value = await api<Listing>(path + query);
    setList(value);
    setSavingAllowed(value.canEdit);
  }
  function accept(value: LibraryView) {
    setPane('detail');
    setSelected(value);
    setBody(bodyFrom(value.revision));
    setTagText(value.revision.tags.join(', '));
    baseline.current = JSON.stringify(bodyFrom(value.revision));
    setHistory(undefined);
    setConflict(false);
    attempt.current = { body: '', key: '' };
  }
  useEffect(() => {
    let active = true;
    void api<GenerationConfig>(`/projects/${projectId}/generation-config`)
      .then((value) => {
        if (active) setConfig(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [projectId]);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      void api<Listing>(path + query)
        .then((value) => {
          if (active) {
            setList(value);
            setSavingAllowed(value.canEdit);
          }
        })
        .catch((reason) => {
          if (active) {
            setList(undefined);
            setSelected(undefined);
            setHistory(undefined);
            setSavingAllowed(false);
            setError(reason instanceof Error ? reason.message : '读取提示词库失败');
          }
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [path, query]);
  return (
    <Dialog
      title="项目提示词库"
      description="保存和复用完整提示词。项目内所有画布共用，修改创建新版本。"
      onClose={() => {
        if (!busy && discard()) onClose();
      }}
      busy={busy}
      className="studio-v2 v2-library prompt-library-dialog"
      theme={theme}
    >
      <StudioLibraryNav pane={pane} onChange={setPane} list="提示词列表" detail="提示词内容" />
      <div className="dialog-body">
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
        <div className="v2-library-layout" data-pane={pane}>
          <aside className="v2-library-list" aria-label="提示词列表">
            <div className="v2-library-heading">
              <h3>项目提示词</h3>
              <StudioButton variant="ghost" disabled={busy} onClick={() => void run(loadList)}>
                刷新列表
              </StudioButton>
            </div>
            <label>
              搜索提示词
              <input
                aria-label="搜索提示词"
                type="search"
                data-autofocus
                value={q}
                maxLength={80}
                onChange={(event) => setQ(event.target.value)}
                placeholder="标题、正文或来源"
              />
            </label>
            <label>
              筛选标签
              <input
                aria-label="筛选标签"
                value={tag}
                maxLength={40}
                onChange={(event) => setTag(event.target.value)}
                placeholder="输入完整标签"
              />
            </label>
            <div className="v2-library-tools">
              {savingAllowed && (
                <StudioButton
                  icon="plus"
                  variant="primary"
                  disabled={busy}
                  onClick={() => {
                    if (!discard()) return;
                    setSelected(undefined);
                    setBody(bodyFrom());
                    setTagText('');
                    baseline.current = JSON.stringify(bodyFrom());
                    setHistory(undefined);
                    setConflict(false);
                    attempt.current = { body: '', key: '' };
                    setError('');
                    setMessage('');
                    setPane('detail');
                  }}
                >
                  新建提示词
                </StudioButton>
              )}
            </div>
            {list?.items.length === 0 && <p className="muted">没有匹配的提示词。</p>}
            {list?.items.map((item) => (
              <button
                className="prompt-library-item"
                key={item.id}
                disabled={busy}
                aria-pressed={selected?.revision.entryId === item.id}
                onClick={() => {
                  if (discard())
                    void run(async () => accept(await api<LibraryView>(`/prompt-library/${item.id}`)));
                }}
              >
                <strong>
                  {item.title} · v{item.version}
                </strong>
                <small>{item.tags.join(' · ')}</small>
                <span>{item.preview}</span>
              </button>
            ))}
            {list?.nextCursor && (
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const more = await api<Listing>(`${path}${query}&cursor=${list.nextCursor}`);
                    setList({ ...more, items: [...list.items, ...more.items] });
                  })
                }
              >
                更多提示词
              </button>
            )}
          </aside>
          <section className="v2-library-detail" aria-label="提示词内容">
            {list ? (
              <>
                <div className="v2-library-heading">
                  <h3>{selected ? selected.revision.title : '新建提示词'}</h3>
                  {selected && (
                    <span className="v2-prompt-version">
                      v{selected.revision.version}
                      {historical ? ' · 历史版本（只读）' : ''}
                    </span>
                  )}
                </div>
                {selected && (
                  <div className="v2-library-tools v2-prompt-actions">
                    {onApply && (
                      <StudioButton
                        icon="check"
                        variant="primary"
                        disabled={busy || edited()}
                        onClick={() =>
                          void run(async () => {
                            const fresh = await api<LibraryView>(
                              `/prompt-library/${selected.revision.entryId}/revisions/${selected.revision.version}`,
                            );
                            await onApply(fresh.revision);
                          })
                        }
                      >
                        应用此版本
                      </StudioButton>
                    )}
                    <StudioButton
                      variant="ghost"
                      icon="clock"
                      disabled={busy}
                      onClick={() =>
                        void run(async () =>
                          setHistory(
                            await api<History>(`/prompt-library/${selected.revision.entryId}/revisions`),
                          ),
                        )
                      }
                    >
                      修订历史
                    </StudioButton>
                    {savingAllowed && (
                      <StudioButton
                        variant="ghost"
                        disabled={busy}
                        onClick={() => {
                          setSelected(undefined);
                          setHistory(undefined);
                          attempt.current = { body: '', key: '' };
                          setMessage('已转为新提示词草稿，保存后创建独立条目。');
                        }}
                      >
                        另存为新提示词
                      </StudioButton>
                    )}
                  </div>
                )}
                {history && (
                  <div aria-label="提示词历史" className="prompt-library-history">
                    {history.items.map((item) => (
                      <button
                        key={item.version}
                        disabled={busy}
                        onClick={() => {
                          if (discard())
                            void run(async () =>
                              accept(
                                await api<LibraryView>(
                                  `/prompt-library/${selected!.revision.entryId}/revisions/${item.version}`,
                                ),
                              ),
                            );
                        }}
                      >
                        查看 v{item.version} · {item.title}
                      </button>
                    ))}
                    {history.nextCursor && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const more = await api<History>(
                              `/prompt-library/${selected!.revision.entryId}/revisions?before=${history.nextCursor}`,
                            );
                            setHistory({ ...more, items: [...history.items, ...more.items] });
                          })
                        }
                      >
                        更多历史版本
                      </button>
                    )}
                  </div>
                )}
                {conflict && selected && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        if (window.confirm('载入最新版本会替换本地未保存输入，确认继续？'))
                          accept(await api<LibraryView>(`/prompt-library/${selected.revision.entryId}`));
                      })
                    }
                  >
                    载入最新提示词版本
                  </button>
                )}
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!savingAllowed || historical) return;
                    const input = {
                      ...body,
                      tags: tagText
                        .split(/[,，]/)
                        .map((value) => value.trim())
                        .filter(Boolean),
                      ...(selected ? { expectedVersion: selected.currentVersion } : {}),
                    };
                    const serialized = JSON.stringify(input);
                    if (attempt.current.body !== serialized)
                      attempt.current = { body: serialized, key: crypto.randomUUID() };
                    void run(async () => {
                      const value = await api<{ entryId: string; revision: LibraryRevision }>(
                        selected ? `/prompt-library/${selected.revision.entryId}/revisions` : path,
                        'POST',
                        input,
                        { 'Idempotency-Key': attempt.current.key },
                      );
                      accept({
                        currentVersion: value.revision.version,
                        canEdit: true,
                        revision: value.revision,
                      });
                      await loadList();
                      setMessage(`已保存为 v${value.revision.version}`);
                    });
                  }}
                >
                  <fieldset className="plain-fieldset" disabled={busy || !savingAllowed || historical}>
                    <label>
                      提示词标题
                      <input
                        aria-label="提示词标题"
                        value={body.title}
                        onChange={(event) => setBody({ ...body, title: event.target.value })}
                        required
                        maxLength={200}
                        data-autofocus
                      />
                    </label>
                    <label>
                      正向提示词
                      <textarea
                        aria-label="库正向提示词"
                        value={body.positivePrompt}
                        onChange={(event) => setBody({ ...body, positivePrompt: event.target.value })}
                        required
                        maxLength={16000}
                        rows={6}
                      />
                    </label>
                    <label>
                      负向提示词
                      <textarea
                        aria-label="库负向提示词"
                        value={body.negativePrompt}
                        onChange={(event) => setBody({ ...body, negativePrompt: event.target.value })}
                        maxLength={16000}
                        rows={2}
                      />
                    </label>
                    <details>
                      <summary>标签、来源和推荐工作流（可选）</summary>
                      <label>
                        标签
                        <input
                          aria-label="提示词标签"
                          value={tagText}
                          onChange={(event) => setTagText(event.target.value)}
                          placeholder="用逗号分隔，最多12个标签"
                          maxLength={500}
                        />
                      </label>
                      <label>
                        来源说明
                        <input
                          aria-label="库来源说明"
                          value={body.source}
                          onChange={(event) => setBody({ ...body, source: event.target.value })}
                          maxLength={300}
                        />
                      </label>
                      <label>
                        推荐工作流
                        <select
                          aria-label="推荐工作流"
                          value={body.workflowId ?? ''}
                          onChange={(event) => setBody({ ...body, workflowId: event.target.value || null })}
                        >
                          <option value="">不指定</option>
                          {body.workflowId &&
                            !config?.workflows.some((item) => item.id === body.workflowId) && (
                              <option value={body.workflowId}>已固定的历史工作流</option>
                            )}
                          {config?.workflows
                            .filter((item) => !item.archived)
                            .map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.name} · v{item.revision ?? 1}
                              </option>
                            ))}
                        </select>
                      </label>
                    </details>
                    <StudioButton
                      icon="check"
                      type="submit"
                      variant={onApply && selected ? 'default' : 'primary'}
                      disabled={!body.title.trim() || !body.positivePrompt.trim()}
                    >
                      {selected ? '保存为新版本' : '保存提示词'}
                    </StudioButton>
                  </fieldset>
                </form>
                <div className="v2-library-tools v2-prompt-actions">
                  <StudioButton
                    variant="ghost"
                    disabled={busy || !list || !body.positivePrompt.trim()}
                    onClick={() =>
                      void run(async () => {
                        if (!navigator.clipboard)
                          throw new Error('浏览器暂不能访问剪贴板，请选中正文手动复制');
                        await navigator.clipboard.writeText(body.positivePrompt);
                        setMessage('正向提示词已复制');
                      })
                    }
                  >
                    复制正向提示词
                  </StudioButton>
                  {body.negativePrompt && (
                    <StudioButton
                      variant="ghost"
                      disabled={busy || !list}
                      onClick={() =>
                        void run(async () => {
                          if (!navigator.clipboard)
                            throw new Error('浏览器暂不能访问剪贴板，请选中正文手动复制');
                          await navigator.clipboard.writeText(body.negativePrompt);
                          setMessage('负向提示词已复制');
                        })
                      }
                    >
                      复制负向提示词
                    </StudioButton>
                  )}
                </div>
              </>
            ) : (
              <p className="muted">正在读取提示词库，或当前项目已不可访问。</p>
            )}
          </section>
        </div>
      </div>
      <div className="dialog-footer">
        <StudioButton
          disabled={busy}
          onClick={() => {
            if (discard()) onClose();
          }}
        >
          关闭提示词库
        </StudioButton>
      </div>
    </Dialog>
  );
}
