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
import { api, ApiError, CursorPage, ProductionUnit } from '../api';
import { Dialog } from '../components/Dialog';
import { GenerationDialog } from '../components/GenerationDialog';
import type { MediaVersion } from '../media-types';
import { BoardSurface } from './BoardSurface';
import { BoardInspector } from './BoardInspector';
import { BoardSources } from './BoardSources';
import { ShotTakeCompareDialog } from './ShotTakeCompareDialog';
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
  unit,
  canEdit,
  onClose,
  onUnauthorized,
}: {
  projectId: string;
  projectTitle: string;
  unit?: ProductionUnit;
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
  const [shotTool, setShotTool] = useState<{
    type: 'generation' | 'candidates';
    id: string;
    version: number;
    title: string;
  }>();
  const [freeGeneration, setFreeGeneration] = useState(false);
  const [newTitle, setNewTitle] = useState('创作探索');
  const [refresh, setRefresh] = useState(0);
  const [pan, setPan] = useState(false);
  const [leave, setLeave] = useState(false);
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
  const listPath = `/projects/${projectId}/boards${unit ? `?unitId=${unit.id}` : ''}`;
  const report = useCallback(
    (reason: unknown) => {
      if (reason instanceof ApiError && [401, 403, 404].includes(reason.status)) {
        setResolved({});
        setDetail(undefined);
        setShotTool(undefined);
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
    setShotTool(undefined);
    setDenied(false);
    setHistory(undefined);
    setError('');
    saveAttempt.current = { body: '', key: '' };
    window.history.replaceState(null, '', `#canvas/${value.id}`);
  }
  async function load(id: string) {
    setBusy(true);
    setError('');
    try {
      const value = await api<BoardView>(`/boards/${id}`);
      if (value.projectId !== projectId) throw new Error('此画布属于其他项目，请先切换对应项目');
      accept(value);
    } catch (reason) {
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
    const id = window.location.hash.match(/^#canvas\/([a-f0-9-]{36})$/i)?.[1];
    if (id) void load(id);
    return () => {
      live = false;
      epoch.current++;
    };
  }, [projectId, unit?.id]);
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
            .filter((node) => node.data.ref)
            .map((node) => {
              const old = state.layout!.nodes.find((item) => item.id === node.id);
              return [
                node.id,
                JSON.stringify(old?.data.ref) === JSON.stringify(node.data.ref)
                  ? (values[node.id] ?? unavailable)
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
  function add(type: BoardNode['type'], source?: BoardSource) {
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
          : { text: '' },
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
        sourceHandle: 'out',
        targetHandle: 'in',
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
  const shotRef = node?.data.ref?.kind === 'shot' ? node.data.ref : undefined;
  const shotValue = shotRef && node ? resolved[node.id] : undefined;
  function openShotTool(type: 'generation' | 'candidates') {
    if (shotRef && shotValue && shotValue.status !== 'unavailable') {
      setShotTool({ type, id: shotRef.id, version: shotRef.version, title: shotValue.title });
    }
  }
  async function updateShotReference() {
    if (!node || !shotRef || !shotValue?.currentVersion || !editable) return;
    const ref = { ...shotRef, version: shotValue.currentVersion };
    setBusy(true);
    setError('');
    try {
      const values = await api<Record<string, BoardResolved>>(
        `/projects/${projectId}/board-references/resolve`,
        'POST',
        {
          references: [{ nodeId: node.id, ref }],
        },
      );
      if (values[node.id]?.status !== 'current') {
        setError('当前制作卡不可引用或已再次更新，请刷新后重试。');
        return;
      }
      update({ ...node, data: { ref } });
      setResolved((previous) => ({ ...previous, ...values }));
      setMessage(`已引用制作卡 v${ref.version}，请保存画布。`);
    } catch (failure) {
      report(failure);
    } finally {
      setBusy(false);
    }
  }
  const canvasImages = useMemo(() => {
    const images = new Map<string, { id: string; fileName: string; version: number }>();
    for (const node of layout?.nodes ?? []) {
      const value = resolved[node.id];
      if (
        node.data.ref?.kind !== 'media' ||
        value?.status === 'unavailable' ||
        !value?.version ||
        value.media?.mediaType !== 'image'
      )
        continue;
      images.set(value.media.id, {
        id: value.media.id,
        fileName: value.media.fileName,
        version: value.version,
      });
    }
    return [...images.values()];
  }, [layout?.nodes, resolved]);
  function close() {
    if (dirty) setLeave(true);
    else onClose();
  }
  return (
    <Dialog
      title="创作画布"
      description={`${projectTitle}${base?.unitTitle ? ` / ${base.unitTitle}` : unit ? ` / ${unit.title}` : ''} · 正式项目资源 · 创作连线不修改业务数据`}
      busy={busy}
      onClose={close}
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
          <h3>{unit ? '制作单元画布' : '项目画布'}</h3>
          <p>用便签和固定业务版本整理创作思路。正式镜头、资产和媒体继续由生产工作台管理。</p>
          {canEdit && (
            <form
              className="creative-create"
              onSubmit={(event) => {
                event.preventDefault();
                void (async () => {
                  const body = { title: newTitle, unitId: unit?.id ?? null },
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
                  const value = await api<CursorPage<BoardListItem>>(
                    `${listPath}${unit ? '&' : '?'}cursor=${cursor}`,
                  );
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
            <button disabled={busy} onClick={() => setFreeGeneration(true)}>
              {base.canEdit ? '自由生成' : '生成与结果'}
            </button>
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
            <button disabled={busy} onClick={close}>
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
              remove={() => node && remove([node.id])}
              detail={detail}
              closeDetail={() => setDetail(undefined)}
              shotActions={
                shotValue &&
                shotValue.status !== 'unavailable' && (
                  <div className="creative-shot-actions">
                    {editable && shotValue.status === 'stale' && (
                      <button disabled={busy} onClick={() => void updateShotReference()}>
                        引用当前制作卡
                      </button>
                    )}
                    <button disabled={busy} onClick={() => openShotTool('generation')}>
                      {editable && shotValue.status === 'current' ? '生成镜头素材' : '查看生成任务'}
                    </button>
                    <button disabled={busy} onClick={() => openShotTool('candidates')}>
                      比较镜头候选
                    </button>
                  </div>
                )
              }
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
            Space 拖动平移 · Shift 多选 · Delete 移除所选节点/连线 · 连线仅作创作引用 · {layout.nodes.length}
            /100 节点 · {layout.edges.length}/200 连线
          </div>
        </>
      )}
      {freeGeneration && base && !denied && (
        <GenerationDialog
          creation={{
            projectId,
            boardId: base.id,
            initialPrompt: node?.data.text,
            onPin: editable ? pinCandidate : undefined,
          }}
          onClose={() => setFreeGeneration(false)}
        />
      )}
      {shotTool?.type === 'generation' && (
        <GenerationDialog
          key={shotTool.id}
          shotId={shotTool.id}
          canvas={{
            shotVersion: shotTool.version,
            title: shotTool.title,
            canEdit: editable,
            images: canvasImages,
          }}
          onClose={() => setShotTool(undefined)}
        />
      )}
      {shotTool?.type === 'candidates' && (
        <ShotTakeCompareDialog
          key={shotTool.id}
          shotId={shotTool.id}
          title={shotTool.title}
          onPin={editable ? pinCandidate : undefined}
          onClose={() => setShotTool(undefined)}
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
            <button onClick={onClose}>丢弃草稿并离开</button>
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
