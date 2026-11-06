import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Connection, EdgeChange, NodeChange } from '@xyflow/react';
import type {
  BoardLayout,
  BoardListItem,
  BoardNode,
  BoardResolved,
  BoardSource,
  BoardView,
} from '../../../../packages/contracts/src/board';
import { api, ApiError, CursorPage } from '../api';
import { forgetBoard, lastBoard, rememberBoard } from './board-preferences';
import { Dialog } from '../components/Dialog';
import { GenerationDialog } from '../components/GenerationDialog';
import { PromptLibraryDialog } from '../prompts/PromptLibraryDialog';
import type { PromptDraft } from '../prompts/prompt-library-types';
import type { MediaVersion } from '../media-types';
import { BoardSurface } from './BoardSurface';
import { BoardExecutionPanel } from './BoardExecutionPanel';
import type { GenerationJob } from '../components/GenerationDialog';
import { BoardInspector } from './BoardInspector';
import { BoardSources } from './BoardSources';
import type { CanvasNode } from './board-types';
import './board.css';
type History = {
  items: { revision: number; title: string; createdAt: string; authorName: string }[];
  nextCursor: number | null;
};
const clone = <T,>(value: T): T => structuredClone(value);
const signature = (title: string, layout: BoardLayout) => JSON.stringify({ title, layout });
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const unavailable = { status: 'unavailable', title: '引用不可用' } as const;
export default function BoardWorkspace({
  projectId,
  projectTitle,
  userId,
  canEdit,
  onClose,
  onUnauthorized,
}: {
  projectId: string;
  projectTitle: string;
  userId: string;
  canEdit: boolean;
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const [boards, setBoards] = useState<BoardListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [base, setBase] = useState<BoardView>();
  const [layout, setLayout] = useState<BoardLayout>();
  const [title, setTitle] = useState('');
  const [resolved, setResolved] = useState<Record<string, BoardResolved>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [denied, setDenied] = useState(false);
  const [remote, setRemote] = useState<BoardView>();
  const [compare, setCompare] = useState<BoardView>();
  const [history, setHistory] = useState<History>();
  const [detail, setDetail] = useState<BoardResolved>();
  const [freeGeneration, setFreeGeneration] = useState(false);
  const [promptLibrary, setPromptLibrary] = useState<{ draft?: PromptDraft }>();
  const [newTitle, setNewTitle] = useState('创作探索');
  const [refresh, setRefresh] = useState(0);
  const [pan, setPan] = useState(false);
  const [leave, setLeave] = useState(false);
  const [leaveTarget, setLeaveTarget] = useState<'project' | 'boards'>('project');
  const [discard, setDiscard] = useState(false);
  const createAttempt = useRef({ body: '', key: '' });
  const saveAttempt = useRef({ body: '', key: '' });
  const epoch = useRef(0);
  const current = useRef({ base, layout, title });
  current.current = { base, layout, title };
  const dirty =
    !!base &&
    !!layout &&
    signature(title, base.canEdit ? layout : { ...layout, viewport: base.layout.viewport }) !==
      signature(base.title, base.layout);
  const editable = !!base?.canEdit && !busy && !denied;
  const listPath = `/projects/${projectId}/boards`;
  const report = useCallback(
    (reason: unknown) => {
      if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) {
        setResolved({});
        setDetail(undefined);

        setCompare(undefined);
        setHistory(undefined);
        if (reason.status === 401) onUnauthorized();
        // Per-reference missing resources are returned as placeholders, so an HTTP denial here concerns the board/project.
        if (reason.status === 403 || reason.status === 404) setDenied(true);
      }
      setError(reason instanceof Error ? reason.message : '操作失败，草稿已保留');
    },
    [onUnauthorized],
  );
  function accept(value: BoardView, keepSelection = false) {
    epoch.current++;
    setBase(value);
    setLayout(clone(value.layout));
    setTitle(value.title);
    setResolved(value.resolved);
    setSelected((previous) =>
      keepSelection ? previous.filter((id) => value.layout.nodes.some((node) => node.id === id)) : [],
    );
    setRemote(undefined);
    setDetail(undefined);

    setDenied(false);
    setHistory(undefined);
    setError('');
    saveAttempt.current = { body: '', key: '' };
    window.history.replaceState(null, '', `#canvas/${value.id}`);
    rememberBoard(userId, projectId, value.id);
    setBoards((previous) => [
      {
        id: value.id,
        title: value.title,
        unitId: value.unitId,
        revision: value.revision,
        createdAt: value.createdAt,
        updatedAt: value.createdAt,
      },
      ...previous.filter((item) => item.id !== value.id),
    ]);
  }
  async function load(id: string) {
    setBusy(true);
    setError('');
    try {
      const value = await api<BoardView>(`/boards/${id}`);
      if (value.projectId !== projectId) throw new Error('此画布属于其他项目，请先切换对应项目');
      accept(value);
    } catch (reason) {
      if (reason instanceof ApiError && [403, 404].includes(reason.status)) forgetBoard(userId, projectId);
      report(reason);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    let live = true;
    void api<CursorPage<BoardListItem>>(listPath)
      .then((value) => {
        if (live) {
          setBoards(value.items);
          setCursor(value.nextCursor);
        }
      })
      .catch((reason) => {
        if (live) report(reason);
      });
    const id = window.location.hash.match(/^#canvas\/([a-f0-9-]{36})$/i)?.[1] ?? lastBoard(userId, projectId);
    if (id) void load(id);
    return () => {
      live = false;
      epoch.current++;
    };
  }, [projectId, userId]);
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  async function refreshReferences() {
    const state = current.current;
    if (!state.base || !state.layout || denied) return;
    const ticket = epoch.current;
    try {
      const head = await api<BoardView>(`/boards/${state.base.id}`);
      const references = state.layout.nodes.flatMap((node) =>
        node.data.ref ? [{ nodeId: node.id, ref: node.data.ref }] : [],
      );
      const values = await api<Record<string, BoardResolved>>(
        `/projects/${projectId}/board-references/resolve`,
        'POST',
        { references },
      );
      if (ticket !== epoch.current) return;
      // Ignore an obsolete response if references changed while the request was in flight.
      setResolved((existing) =>
        Object.fromEntries(
          (current.current.layout?.nodes ?? [])
            .filter((node) => node.data.ref || node.type === 'result')
            .map((node) => {
              const old = state.layout!.nodes.find((item) => item.id === node.id);
              return [
                node.id,
                JSON.stringify(old?.data.ref) === JSON.stringify(node.data.ref)
                  ? node.type === 'result'
                    ? (head.resolved[node.id] ?? existing[node.id] ?? unavailable)
                    : (values[node.id] ?? unavailable)
                  : (existing[node.id] ?? unavailable),
              ];
            }),
        ),
      );
      setBase((previous) => (previous ? { ...previous, canEdit: head.canEdit } : previous));
      if (head.revision > state.base.revision) setRemote(head);
      // Close details when authorization or the pinned revision's state changed.
      setDetail(undefined);
      setCompare(undefined);
      setRefresh((value) => value + 1);
    } catch (reason) {
      if (ticket === epoch.current) report(reason);
    }
  }
  const refreshRef = useRef(refreshReferences);
  refreshRef.current = refreshReferences;
  useEffect(() => {
    if (!base?.id || denied) return;
    const timer = window.setInterval(() => void refreshRef.current(), 15000);
    const focus = () => void refreshRef.current();
    window.addEventListener('focus', focus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', focus);
    };
  }, [base?.id, denied]);
  async function save() {
    if (!base || !layout || !editable) return;
    const body = { title, expectedRevision: base.revision, layout };
    const serialized = JSON.stringify(body);
    if (saveAttempt.current.body !== serialized)
      saveAttempt.current = { body: serialized, key: crypto.randomUUID() };
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const value = await api<BoardView>(`/boards/${base.id}/revisions`, 'POST', body, {
        'Idempotency-Key': saveAttempt.current.key,
      });
      accept(value, true);
      setMessage(`已保存 v${value.revision}`);
      if (value.headRevision > value.revision) setRemote(await api<BoardView>(`/boards/${base.id}`));
    } catch (reason) {
      // A denied new reference must not erase an otherwise accessible local draft.
      if (reason instanceof ApiError && reason.code === 'BOARD_REFERENCE_UNAVAILABLE')
        setError(reason.message);
      else if (reason instanceof ApiError && reason.code === 'BOARD_VERSION_CONFLICT') {
        setError('版本冲突：草稿已保留。请比较最新修订，再选择载入或保留草稿更新基线。');
        try {
          setRemote(await api<BoardView>(`/boards/${base.id}`));
        } catch (failure) {
          report(failure);
        }
      } else report(reason);
    } finally {
      setBusy(false);
    }
  }
  function update(node: BoardNode) {
    if (editable)
      setLayout(
        (value) =>
          value && { ...value, nodes: value.nodes.map((item) => (item.id === node.id ? node : item)) },
      );
  }
  function remove(ids: string[]) {
    if (!editable) return;
    setLayout((value) => {
      if (!value) return value;
      const removed = new Set(ids);
      // Dissolve a removed group without losing its children or their world positions.
      const nodes = value.nodes
        .filter((node) => !removed.has(node.id))
        .map((node) => {
          const parent = value.nodes.find((item) => item.id === node.parentId && removed.has(item.id));
          return parent
            ? {
                ...node,
                parentId: undefined,
                position: {
                  x: clamp(node.position.x + parent.position.x, -50000, 50000),
                  y: clamp(node.position.y + parent.position.y, -50000, 50000),
                },
              }
            : node;
        });
      return {
        ...value,
        nodes,
        edges: value.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target)),
      };
    });
    setSelected((current) => current.filter((id) => !ids.includes(id)));
  }
  function add(type: BoardNode['type'], source?: BoardSource, noteData?: BoardNode['data']) {
    if (!editable || !layout) return;
    if (layout.nodes.length >= 100) {
      setError('每个画布最多100个节点，请创建另一画布。');
      return;
    }
    const id = crypto.randomUUID();
    const columns = Math.max(
      1,
      Math.floor(
        ((document.querySelector('.creative-surface')?.clientWidth ?? 800) - 60) /
          (280 * layout.viewport.zoom),
      ),
    );
    let position = {
      x: (30 - layout.viewport.x) / layout.viewport.zoom,
      y: (30 - layout.viewport.y) / layout.viewport.zoom,
    };
    // Choose a free grid cell in the current viewport rather than stacking new references.
    for (let index = 0; index <= layout.nodes.length; index++) {
      position = {
        x: clamp((30 - layout.viewport.x) / layout.viewport.zoom + (index % columns) * 280, -50000, 50000),
        y: clamp(
          (30 - layout.viewport.y) / layout.viewport.zoom + Math.floor(index / columns) * 310,
          -50000,
          50000,
        ),
      };
      if (
        !layout.nodes.some(
          (node) =>
            !node.parentId &&
            node.type !== 'group' &&
            Math.abs(node.position.x - position.x) < 260 &&
            Math.abs(node.position.y - position.y) < 290,
        )
      )
        break;
    }
    const node: BoardNode = {
      id,
      type,
      position,
      width: type === 'group' ? 700 : 250,
      height: type === 'group' ? 540 : 280,
      data: source
        ? { ref: source.ref }
        : type === 'group'
          ? { label: '创作分组', collapsed: false }
          : (noteData ?? (type === 'generation' ? { generation: {} } : { text: '' })),
    };
    setLayout({ ...layout, nodes: [...layout.nodes, node] });
    setSelected([id]);
    if (source) setResolved((value) => ({ ...value, [id]: source.value }));
    return true;
  }
  async function pinCandidate(media: MediaVersion) {
    if (!editable || !layout) throw new Error('当前画布不可编辑。');
    const existing = layout.nodes.find(
      (node) => node.data.ref?.kind === 'media' && node.data.ref.id === media.id,
    );
    if (existing) {
      setSelected([existing.id]);
      return;
    }
    const ref = { kind: 'media', id: media.id } as const;
    const nodeId = crypto.randomUUID();
    const values = await api<Record<string, BoardResolved>>(
      `/projects/${projectId}/board-references/resolve`,
      'POST',
      {
        references: [{ nodeId, ref }],
      },
    );
    const value = values[nodeId];
    if (!value || value.status === 'unavailable') throw new Error('此候选媒体目前不可引用。');
    if (!add('reference', { ref, value, ready: true })) throw new Error('此画布已达节点上限。');
  }
  const flowNodes = useMemo<CanvasNode[]>(() => {
    if (!layout) return [];
    return [...layout.nodes]
      .sort((a, b) => Number(b.type === 'group') - Number(a.type === 'group'))
      .map((node) => ({
        id: node.id,
        type: 'boardNode',
        position: node.position,
        parentId: node.parentId,
        hidden: !!node.parentId && !!layout.nodes.find((item) => item.id === node.parentId)?.data.collapsed,
        selected: selected.includes(node.id),
        width: node.width,
        height: node.type === 'group' && node.data.collapsed ? 120 : node.height,
        measured: {
          width: node.width,
          height: node.type === 'group' && node.data.collapsed ? 120 : node.height,
        },
        style: {
          width: node.width,
          height: node.type === 'group' && node.data.collapsed ? 120 : node.height,
        },
        zIndex: node.type === 'group' ? -1 : 1,
        data: { domain: node, value: resolved[node.id] },
      }));
  }, [layout, resolved, selected]);
  const flowEdges = useMemo(
    () =>
      (layout?.edges ?? []).map((edge) => ({
        ...edge,
        sourceHandle: edge.kind === 'input_binding' ? edge.sourcePort : 'out',
        targetHandle: edge.kind === 'input_binding' ? edge.targetPort : 'in',
        label: edge.kind === 'input_binding' ? (edge.targetPort === 'prompt' ? '提示词' : '首帧') : undefined,
        style: edge.kind === 'input_binding' ? { stroke: '#67bdcf', strokeWidth: 2 } : undefined,
        hidden: flowNodes.some((node) => node.hidden && [edge.source, edge.target].includes(node.id)),
      })),
    [layout?.edges, flowNodes],
  );
  function nodesChange(changes: NodeChange<CanvasNode>[]) {
    const selections = changes.filter((change) => change.type === 'select');
    if (selections.length)
      setSelected((value) => {
        const ids = new Set(value);
        for (const change of selections)
          if (change.type === 'select') {
            if (change.selected) ids.add(change.id);
            else ids.delete(change.id);
          }
        return [...ids];
      });
    if (!editable) return;
    const deleted = changes.filter((change) => change.type === 'remove').map((change) => change.id);
    if (deleted.length) remove(deleted);
    setLayout(
      (value) =>
        value && {
          ...value,
          nodes: value.nodes.map((node) => {
            const change = changes.find((item) => item.type === 'position' && item.id === node.id);
            return change?.type === 'position' && change.position
              ? {
                  ...node,
                  position: {
                    x: clamp(change.position.x, -50000, 50000),
                    y: clamp(change.position.y, -50000, 50000),
                  },
                }
              : node;
          }),
        },
    );
  }
  function edgesChange(changes: EdgeChange[]) {
    if (editable)
      setLayout(
        (value) =>
          value && {
            ...value,
            edges: value.edges.filter(
              (edge) => !changes.some((change) => change.type === 'remove' && change.id === edge.id),
            ),
          },
      );
  }
  function connect(connection: Connection) {
    if (!editable || !layout) return;
    if (['prompt', 'first_frame'].includes(connection.targetHandle ?? '')) {
      const target = layout.nodes.find((n) => n.id === connection.target),
        source = layout.nodes.find((n) => n.id === connection.source),
        port = connection.targetHandle as 'prompt' | 'first_frame';
      if (
        target?.type !== 'generation' ||
        source?.id === target.id ||
        (port === 'prompt'
          ? source?.type !== 'note' || connection.sourceHandle !== 'text'
          : !(
              (source?.type === 'result' || source?.data.ref?.kind === 'media') &&
              resolved[source.id]?.media?.mediaType === 'image' &&
              connection.sourceHandle === 'image'
            ))
      ) {
        setError('输入端口类型不匹配，请连接文本 TEXT 或图片 IMAGE 输出。');
        return;
      }
      if (
        layout.edges.some(
          (e) => e.kind === 'input_binding' && e.target === target.id && e.targetPort === port,
        )
      ) {
        setError('此输入已有来源，请先解除连接或在设置中替换。');
        return;
      }
      bindInput(target.id, port, source!.id);
      return;
    }
    if (['text', 'image'].includes(connection.sourceHandle ?? '')) {
      setError('具名输出只能连接匹配的生成输入端口。');
      return;
    }
    if (
      connection.source === connection.target ||
      layout.nodes.some(
        (node) => node.type === 'group' && [connection.source, connection.target].includes(node.id),
      ) ||
      layout.edges.some((edge) => edge.source === connection.source && edge.target === connection.target)
    ) {
      setError('不能重复连线、连接自身或连接分组。');
      return;
    }
    if (layout.edges.length >= 200) {
      setError('每个画布最多200条创作连线。');
      return;
    }
    setLayout({
      ...layout,
      edges: [
        ...layout.edges,
        { id: crypto.randomUUID(), source: connection.source, target: connection.target },
      ],
    });
  }
  const node = layout?.nodes.find((item) => item.id === selected[0]);
  function bindInput(target: string, port: 'prompt' | 'first_frame', source: string) {
    if (!editable || !layout) return;
    const edges = layout.edges.filter(
      (e) => !(e.kind === 'input_binding' && e.target === target && e.targetPort === port),
    );
    if (source && edges.length >= 200) {
      setError('每个画布最多200条连线。');
      return;
    }
    setError('');
    setLayout({
      ...layout,
      edges: source
        ? [
            ...edges,
            {
              id: crypto.randomUUID(),
              source,
              target,
              kind: 'input_binding',
              sourcePort: port === 'prompt' ? 'text' : 'image',
              targetPort: port,
            },
          ]
        : edges,
    });
  }
  function addResult(job: GenerationJob) {
    if (!editable || !layout) return;
    const existing = layout.nodes.find((n) => n.type === 'result' && n.data.jobId === job.id);
    if (existing) {
      setSelected([existing.id]);
      return;
    }
    if (layout.nodes.length >= 100) {
      setError('画布已达节点上限。');
      return;
    }
    const producer = layout.nodes.find((n) => n.id === job.boardExecution?.nodeId);
    setLayout({
      ...layout,
      nodes: [
        ...layout.nodes,
        {
          id: job.id,
          type: 'result',
          position: {
            x: clamp((producer?.position.x ?? 0) + 320, -50000, 50000),
            y: producer?.position.y ?? 0,
          },
          width: 250,
          height: 280,
          data: { jobId: job.id },
        },
      ],
    });
    setResolved((old) => ({
      ...old,
      [job.id]: {
        status: job.state === 'completed' ? 'current' : 'draft',
        title: '生成结果',
        summary: job.state,
      },
    }));
    setMessage('结果已加入画布草稿，请保存画布。');
  }
  function leaveBoard(target: 'project' | 'boards') {
    setLeave(false);
    if (target === 'project') {
      onClose();
      return;
    }
    epoch.current++;
    setBase(undefined);
    setLayout(undefined);
    setSelected([]);
    setResolved({});
    setDetail(undefined);
    setHistory(undefined);
    setCompare(undefined);
    setFreeGeneration(false);
    setRemote(undefined);
    setError('');
    setMessage('');
    window.history.replaceState(null, '', '#canvas');
    const ticket = epoch.current;
    void api<CursorPage<BoardListItem>>(listPath)
      .then((value) => {
        if (ticket === epoch.current) {
          setBoards(value.items);
          setCursor(value.nextCursor);
        }
      })
      .catch((reason) => {
        if (ticket === epoch.current) report(reason);
      });
  }
  function close(target: 'project' | 'boards' = 'project') {
    setLeaveTarget(target);
    if (dirty) setLeave(true);
    else leaveBoard(target);
  }
  return (
    <Dialog
      title="创作画布"
      description={`${projectTitle} · 画布共用项目资产 · 普通连线不执行生成`}
      busy={busy}
      onClose={() => close()}
      className="creative-board-dialog"
    >
      {denied ? (
        <div className="dialog-body">
          <p role="alert" className="notice error">
            画布或项目已不可访问，已隐藏资源详情。{error}
          </p>
          <button onClick={onClose}>返回工作台</button>
        </div>
      ) : !base || !layout ? (
        <div className="dialog-body creative-board-home">
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          <h3>项目画布</h3>
          <p>每张画布独立保存布局与历史，共用此项目的资产和媒体。</p>
          {canEdit && (
            <form
              className="creative-create"
              onSubmit={(event) => {
                event.preventDefault();
                void (async () => {
                  const body = { title: newTitle, unitId: null },
                    serialized = JSON.stringify(body);
                  if (createAttempt.current.body !== serialized)
                    createAttempt.current = { body: serialized, key: crypto.randomUUID() };
                  setBusy(true);
                  setError('');
                  try {
                    const value = await api<BoardView>(`/projects/${projectId}/boards`, 'POST', body, {
                      'Idempotency-Key': createAttempt.current.key,
                    });
                    accept(value);
                  } catch (reason) {
                    report(reason);
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              <label>
                画布名称
                <input
                  data-autofocus
                  aria-label="画布名称"
                  value={newTitle}
                  onChange={(event) => setNewTitle(event.target.value)}
                  required
                  maxLength={100}
                  disabled={busy}
                />
              </label>
              <button className="primary" disabled={busy || !newTitle.trim()}>
                创建画布
              </button>
            </form>
          )}
          <div className="creative-board-list">
            {boards.map((item) => (
              <button key={item.id} disabled={busy} onClick={() => void load(item.id)}>
                <strong>{item.title}</strong>
                <span>
                  v{item.revision} · {item.unitId ? '制作单元' : '项目'} ·{' '}
                  {new Date(item.updatedAt).toLocaleString()}
                </span>
              </button>
            ))}
          </div>
          {!boards.length && !busy && <p className="field-hint">尚无画布。</p>}
          {cursor && (
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const value = await api<CursorPage<BoardListItem>>(`${listPath}?cursor=${cursor}`);
                  setBoards((current) => [...current, ...value.items]);
                  setCursor(value.nextCursor);
                } catch (reason) {
                  report(reason);
                } finally {
                  setBusy(false);
                }
              }}
            >
              更多画布
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="creative-toolbar">
            <button disabled={busy} onClick={() => close('boards')}>
              切换 / 新建画布
            </button>
            <button disabled={busy} onClick={() => setFreeGeneration(true)}>
              {base.canEdit ? '自由生成' : '生成与结果'}
            </button>
            <button disabled={busy} onClick={() => setPromptLibrary({})}>
              提示词库
            </button>
            {editable && node?.type === 'note' && node.data.text?.trim() && (
              <button
                disabled={busy}
                onClick={() =>
                  setPromptLibrary({ draft: { positivePrompt: node.data.text ?? '', ...node.data.prompt } })
                }
              >
                将便签存入提示词库
              </button>
            )}
            <input
              aria-label="当前画布名称"
              value={title}
              disabled={!editable}
              maxLength={100}
              onChange={(event) => setTitle(event.target.value)}
            />
            <span role="status" className="creative-save-state">
              {busy
                ? '处理中…'
                : !base.canEdit
                  ? `只读 · v${base.revision}`
                  : dirty
                    ? `未保存 · 基于 v${base.revision}`
                    : `已保存 v${base.revision}`}
            </span>
            {base.canEdit && (
              <>
                <button onClick={() => add('note')} disabled={!editable}>
                  添加便签
                </button>
                <button onClick={() => add('brief')} disabled={!editable}>
                  创作说明
                </button>
                <button onClick={() => add('generation')} disabled={!editable}>
                  添加生成节点
                </button>
                <button onClick={() => add('group')} disabled={!editable}>
                  添加分组
                </button>
                <button
                  className="primary"
                  disabled={!editable || !dirty || !title.trim()}
                  onClick={() => void save()}
                >
                  保存画布
                </button>
              </>
            )}
            <button aria-pressed={pan} onClick={() => setPan((value) => !value)}>
              {pan ? '切换框选' : '切换平移'}
            </button>
            <button disabled={busy} onClick={() => void refreshReferences()}>
              刷新引用
            </button>
            <button
              disabled={busy}
              onClick={() => {
                void api<History>(`/boards/${base.id}/revisions`).then(setHistory).catch(report);
              }}
            >
              修订历史
            </button>
            <button disabled={busy} onClick={() => close()}>
              返回工作台
            </button>
          </div>
          {error && (
            <p role="alert" className="notice error creative-notice">
              {error}
            </p>
          )}
          {message && !dirty && (
            <p role="status" className="creative-notice">
              {message}
            </p>
          )}
          {!base.canEdit && dirty && (
            <p role="alert" className="notice error creative-notice">
              编辑权限已变化，本地草稿保留但不能保存。
            </p>
          )}
          {remote && (
            <div className="creative-conflict" role="alert">
              <strong>
                发现最新 v{remote.revision}，当前基于 v{base.revision}，草稿保持原样。
              </strong>
              <button onClick={() => setCompare(remote)}>比较最新修订</button>
              <button onClick={() => (dirty ? setDiscard(true) : accept(remote))}>载入最新修订</button>
              {base.canEdit && (
                <button
                  onClick={() => {
                    setBase(remote);
                    setRemote(undefined);
                    setError('');
                    saveAttempt.current = { body: '', key: '' };
                    setMessage('已明确更新基线，请检查保留的草稿后保存。');
                  }}
                >
                  保留草稿，更新基线
                </button>
              )}
            </div>
          )}
          <div className="creative-workspace">
            <BoardSources
              projectId={projectId}
              editable={editable}
              refresh={refresh}
              add={(source) => add('reference', source)}
              report={(reason) => {
                if (reason instanceof ApiError && [401, 403].includes(reason.status)) report(reason);
              }}
            />
            <BoardSurface
              nodes={flowNodes}
              edges={flowEdges}
              viewport={layout.viewport}
              editable={editable}
              pan={pan}
              onNodesChange={nodesChange}
              onEdgesChange={edgesChange}
              onConnect={connect}
              onViewportChange={(viewport) => {
                if (!busy)
                  setLayout(
                    (value) =>
                      value && {
                        ...value,
                        viewport: {
                          x: clamp(viewport.x, -100000, 100000),
                          y: clamp(viewport.y, -100000, 100000),
                          zoom: clamp(viewport.zoom, 0.15, 2),
                        },
                      },
                  );
              }}
            />
            <BoardInspector
              node={node}
              value={node && resolved[node.id]}
              nodes={layout.nodes}
              editable={editable}
              update={update}
              executionPanel={
                node?.type === 'generation' ? (
                  <BoardExecutionPanel
                    key={`${base.id}:${node.id}`}
                    board={base}
                    userId={userId}
                    node={node}
                    layout={layout}
                    resolved={resolved}
                    editable={editable}
                    dirty={dirty}
                    update={update}
                    bind={(port, source) => bindInput(node.id, port, source)}
                    onResult={addResult}
                    onOpenTasks={() => setFreeGeneration(true)}
                  />
                ) : undefined
              }
              remove={() => node && remove([node.id])}
              detail={detail}
              closeDetail={() => setDetail(undefined)}
              onDetail={() => {
                if (!node?.data.ref) return;
                void api<Record<string, BoardResolved>>(
                  `/projects/${projectId}/board-references/resolve`,
                  'POST',
                  { references: [{ nodeId: node.id, ref: node.data.ref }] },
                )
                  .then((values) => {
                    setResolved((current) => ({ ...current, ...values }));
                    if (values[node.id]?.status !== 'unavailable') setDetail(values[node.id]);
                  })
                  .catch(report);
              }}
            />
          </div>
          <div className="creative-help">
            Space 拖动平移 · Shift 多选 · Delete 移除所选节点/连线 · 普通连线为注释，具名输入连线用于生成 ·{' '}
            {layout.nodes.length}
            /100 节点 · {layout.edges.length}/200 连线
          </div>
        </>
      )}
      {freeGeneration && base && !denied && (
        <GenerationDialog
          creation={{
            projectId,
            boardId: base.id,
            initialDraft: { positivePrompt: node?.data.text ?? '', ...node?.data.prompt },
            onPin: editable ? pinCandidate : undefined,
          }}
          onClose={() => setFreeGeneration(false)}
        />
      )}
      {promptLibrary && base && !denied && (
        <PromptLibraryDialog
          projectId={projectId}
          initialDraft={promptLibrary.draft}
          onClose={() => setPromptLibrary(undefined)}
          onApply={
            editable
              ? (revision) => {
                  if (
                    !add('note', undefined, {
                      text: revision.positivePrompt,
                      prompt: {
                        negativePrompt: revision.negativePrompt,
                        source: revision.source,
                        promptLibraryRevisionId: revision.id,
                      },
                    })
                  )
                    throw new Error('无法插入提示词，请检查画布容量与编辑权限');
                  setPromptLibrary(undefined);
                  setMessage('已插入固定版本提示词，请保存画布。');
                }
              : undefined
          }
        />
      )}
      {leave && (
        <Dialog
          title="保留当前创作"
          description="当前有未保存修改，离开会丢弃本地草稿。"
          onClose={() => setLeave(false)}
        >
          <div className="dialog-footer">
            <button onClick={() => setLeave(false)}>继续编辑</button>
            <button onClick={() => leaveBoard(leaveTarget)}>丢弃草稿并离开</button>
          </div>
        </Dialog>
      )}
      {discard && remote && (
        <Dialog
          title="载入最新修订"
          description="这会丢弃当前未保存草稿，用服务器最新修订替换。"
          onClose={() => setDiscard(false)}
        >
          <div className="dialog-footer">
            <button onClick={() => setDiscard(false)}>继续保留草稿</button>
            <button
              onClick={() => {
                accept(remote);
                setDiscard(false);
              }}
            >
              确认载入最新
            </button>
          </div>
        </Dialog>
      )}
      {history && base && (
        <Dialog
          title="画布修订历史"
          description="修订不可变；查看历史不会替换当前草稿。"
          onClose={() => setHistory(undefined)}
        >
          <div className="dialog-body creative-history">
            {history.items.map((item) => (
              <button
                key={item.revision}
                onClick={() =>
                  void api<BoardView>(`/boards/${base.id}?revision=${item.revision}`)
                    .then(setCompare)
                    .catch(report)
                }
              >
                v{item.revision} · {item.title}
                <small>
                  {item.authorName} · {new Date(item.createdAt).toLocaleString()}
                </small>
              </button>
            ))}
            {history.nextCursor && (
              <button
                onClick={() =>
                  void api<History>(`/boards/${base.id}/revisions?before=${history.nextCursor}`)
                    .then((value) =>
                      setHistory((current) => ({
                        items: [...(current?.items ?? []), ...value.items],
                        nextCursor: value.nextCursor,
                      })),
                    )
                    .catch(report)
                }
              >
                更多历史
              </button>
            )}
          </div>
        </Dialog>
      )}
      {compare && layout && (
        <Dialog
          title={`查看画布修订 v${compare.revision}`}
          description="只读比较；当前草稿继续保留。"
          onClose={() => setCompare(undefined)}
          className="creative-compare-dialog"
        >
          <div className="dialog-body">
            <p>
              草稿：{title} · {layout.nodes.length}节点 / {layout.edges.length}连线
            </p>
            <p>
              所查修订：{compare.title} · {compare.layout.nodes.length}节点 / {compare.layout.edges.length}
              连线
            </p>
            <ul>
              {compare.layout.nodes.map((item) => (
                <li key={item.id}>
                  {item.type === 'reference'
                    ? (compare.resolved[item.id]?.title ?? '引用不可用')
                    : (item.data.label ?? item.data.text ?? '空便签')}{' '}
                  <small>
                    ({Math.round(item.position.x)}, {Math.round(item.position.y)})
                  </small>
                </li>
              ))}
            </ul>
          </div>
          <div className="dialog-footer">
            <button onClick={() => setCompare(undefined)}>回到保留的草稿</button>
          </div>
        </Dialog>
      )}
    </Dialog>
  );
}
