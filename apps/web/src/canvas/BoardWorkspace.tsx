import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import { MediaDialog } from '../components/MediaDialog';
import { PromptLibraryDialog } from '../prompts/PromptLibraryDialog';
import type { PromptDraft } from '../prompts/prompt-library-types';
import type { MediaVersion } from '../media-types';
import { BoardSurface } from './BoardSurface';
import { BoardExecutionPanel } from './BoardExecutionPanel';
import type { GenerationJob } from '../components/GenerationDialog';
import { BoardInspector, BoardNodeLayout } from './BoardInspector';
import { BoardSources } from './BoardSources';
import type { CanvasNode } from './board-types';
import './board.css';
import { StudioBrand, StudioButton } from '../shared/ui/StudioUI';
import { EntityLibraryDialog } from '../components/EntityLibraryDialog';
import '../features/canvas/studio-live-board.css';
type History = {
  items: { revision: number; title: string; createdAt: string; authorName: string }[];
  nextCursor: number | null;
};
const clone = <T,>(value: T): T => structuredClone(value);
const signature = (title: string, layout: BoardLayout) => JSON.stringify({ title, layout });
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const overlaps = (item: BoardNode, position: BoardNode['position'], width: number, height: number) =>
  item.position.x < position.x + width + 16 &&
  item.position.x + item.width + 16 > position.x &&
  item.position.y < position.y + height + 16 &&
  item.position.y + item.height + 16 > position.y;
const unavailable = { status: 'unavailable', title: '引用不可用' } as const;
export default function BoardWorkspace({
  projectId,
  projectTitle,
  projectMessage,
  userId,
  canEdit,
  onClose,
  onUnauthorized,
  theme,
  onToggleTheme,
  onWorkflows,
  projectActions,
}: {
  projectId: string;
  projectTitle: string;
  projectMessage?: string;
  userId: string;
  canEdit: boolean;
  onClose: () => void;
  onUnauthorized: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onWorkflows: () => void;
  projectActions?: ReactNode;
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
  const [promptLibrary, setPromptLibrary] = useState<{ draft?: PromptDraft; target?: string }>();
  const [showSources, setShowSources] = useState(() => window.innerWidth > 760);
  const [mediaLibrary, setMediaLibrary] = useState(false);
  const [entityLibrary, setEntityLibrary] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  useEffect(() => {
    const compact = window.matchMedia('(max-width: 760px)');
    const collapse = (event: MediaQueryListEvent) => {
      if (event.matches) setShowSources(false);
    };
    compact.addEventListener('change', collapse);
    return () => compact.removeEventListener('change', collapse);
  }, []);
  const draggedResource = useRef<BoardSource>(undefined);
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
    const requested = window.location.hash.match(/^#canvas\/([a-f0-9-]{36})$/i)?.[1];
    const remembered = lastBoard(userId, projectId);
    void (async () => {
      try {
        const value = await api<CursorPage<BoardListItem>>(listPath);
        if (!live) return;
        setBoards(value.items);
        setCursor(value.nextCursor);
        const choices = [
          ...new Set([requested, remembered, value.items[0]?.id].filter((id): id is string => Boolean(id))),
        ];
        for (const id of choices) {
          try {
            const board = await api<BoardView>(`/boards/${id}`);
            if (!live) return;
            if (board.projectId === projectId) {
              accept(board);
              return;
            }
          } catch (reason) {
            if (!(reason instanceof ApiError && [403, 404].includes(reason.status))) throw reason;
          }
          if (live && id === remembered) forgetBoard(userId, projectId);
        }
        if (live && (requested || remembered)) window.history.replaceState(null, '', '#canvas');
      } catch (reason) {
        if (live) report(reason);
      } finally {
        if (live) setInitialLoading(false);
      }
    })();
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
      if (value.headRevision > value.revision) {
        setRemote(await api<BoardView>(`/boards/${base.id}`));
        return;
      }
      return value.revision;
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
  function add(
    type: BoardNode['type'],
    source?: BoardSource,
    noteData?: BoardNode['data'],
    at?: BoardNode['position'],
    firstFrame?: BoardNode,
  ) {
    if (!editable || !layout) return;
    if (layout.nodes.length >= 100) {
      setError('每个画布最多100个节点，请创建另一画布。');
      return;
    }
    const id = crypto.randomUUID();
    const media = source?.value.media;
    const ratio =
      media?.metadata.width && media.metadata.height ? media.metadata.width / media.metadata.height : 1;
    const width = type === 'group' ? 700 : media ? Math.round(clamp(265 * Math.sqrt(ratio), 200, 420)) : 250;
    const height =
      type === 'group' ? 540 : media ? Math.round(clamp(265 / Math.sqrt(ratio) + 64, 185, 470)) : 280;
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
          (node) => !node.parentId && node.type !== 'group' && overlaps(node, position, width, height),
        )
      )
        break;
    }
    if (firstFrame && layout.edges.length >= 200) {
      setError('每个画布最多200条连线。');
      return;
    }
    if (!at && firstFrame && !firstFrame.parentId) {
      position = {
        x: clamp(firstFrame.position.x + firstFrame.width + 48, -50000, 50000),
        y: firstFrame.position.y,
      };
      const neighbors = layout.nodes.filter((item) => !item.parentId);
      for (let index = 0; index < neighbors.length; index++) {
        if (!neighbors.some((item) => overlaps(item, position, width, height))) break;
        position.y = clamp(position.y + height + 22, -50000, 50000);
      }
    }
    const node: BoardNode = {
      id,
      type,
      position: at ? { x: clamp(at.x, -50000, 50000), y: clamp(at.y, -50000, 50000) } : position,
      width,
      height,
      data: source
        ? { ref: source.ref }
        : type === 'group'
          ? { label: '创作分组', collapsed: false }
          : (noteData ?? (type === 'generation' ? { generation: {} } : { text: '' })),
    };
    setLayout({
      ...layout,
      nodes: [...layout.nodes, node],
      edges: firstFrame
        ? [
            ...layout.edges,
            {
              id: crypto.randomUUID(),
              source: firstFrame.id,
              target: id,
              kind: 'input_binding',
              sourcePort: 'image',
              targetPort: 'first_frame',
            },
          ]
        : layout.edges,
    });
    setSelected([id]);
    if (source) setResolved((value) => ({ ...value, [id]: source.value }));
    return true;
  }
  function setNodePrompt(target: string, draft: PromptDraft, replace = false) {
    if (!editable || !layout) return false;
    const generation = layout.nodes.find((item) => item.id === target && item.type === 'generation');
    if (!generation) return false;
    const binding = layout.edges.find(
      (edge) => edge.kind === 'input_binding' && edge.target === target && edge.targetPort === 'prompt',
    );
    const data = {
      text: draft.positivePrompt,
      prompt: {
        negativePrompt: draft.negativePrompt ?? '',
        source: draft.source ?? '',
        promptLibraryRevisionId: draft.promptLibraryRevisionId,
      },
    };
    const existing = layout.nodes.find((item) => item.id === binding?.source);
    if (
      existing &&
      !replace &&
      layout.edges.filter((edge) => edge.kind === 'input_binding' && edge.source === existing.id).length === 1
    ) {
      update({ ...existing, data });
      return true;
    }
    if (layout.nodes.length >= 100 || (!binding && layout.edges.length >= 200)) {
      setError('画布容量已满，请移除不需要的节点或连线。');
      return false;
    }
    const id = crypto.randomUUID();
    const position = {
      x: clamp(generation.position.x - 274, -50000, 50000),
      y: clamp(generation.position.y - 220, -50000, 50000),
    };
    const siblings = layout.nodes.filter((item) => item.parentId === generation.parentId);
    if (
      position.y * layout.viewport.zoom + layout.viewport.y < 12 ||
      siblings.some((item) => overlaps(item, position, 250, 200))
    ) {
      position.x = generation.position.x;
      position.y = clamp(generation.position.y + generation.height + 26, -50000, 50000);
      for (
        let index = 0;
        index < siblings.length && siblings.some((item) => overlaps(item, position, 250, 200));
        index++
      ) {
        position.y = clamp(position.y + 224, -50000, 50000);
      }
    }
    setLayout({
      ...layout,
      nodes: [
        ...layout.nodes,
        {
          id,
          type: 'note',
          position,
          parentId: generation.parentId,
          width: 250,
          height: 200,
          data,
        },
      ],
      edges: [
        ...layout.edges.filter((edge) => edge.id !== binding?.id),
        {
          id: crypto.randomUUID(),
          source: id,
          target,
          kind: 'input_binding',
          sourcePort: 'text',
          targetPort: 'prompt',
        },
      ],
    });
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
      description={projectTitle}
      busy={busy}
      onClose={() => close()}
      className={`creative-board-dialog creative-theme-${theme} studio-v2 studio-live-board`}
      hideHeader
      theme={theme}
    >
      <header className="v2-live-top">
        <div className="v2-live-path">
          <StudioButton
            variant="ghost"
            icon="arrow"
            aria-label="返回工作台"
            title="返回工作台"
            disabled={busy}
            onClick={() => close()}
          />
          <StudioBrand compact />
          <strong title={projectTitle}>{projectTitle}</strong>
          {base && !denied && (
            <>
              <StudioButton
                variant="ghost"
                icon="chevron"
                aria-label="切换 / 新建画布"
                title="切换 / 新建画布"
                disabled={busy}
                onClick={() => close('boards')}
              />
              <input
                aria-label="当前画布名称"
                value={title}
                disabled={!editable}
                maxLength={100}
                onChange={(event) => setTitle(event.target.value)}
              />
            </>
          )}
        </div>
        {!denied && (
          <div className="v2-live-actions">
            {base && (
              <span role="status" className="creative-save-state">
                {busy
                  ? '处理中…'
                  : !base.canEdit
                    ? `只读 · v${base.revision}`
                    : dirty
                      ? `未保存 · 基于 v${base.revision}`
                      : `已保存 v${base.revision}`}
              </span>
            )}
            {base && (
              <StudioButton
                icon="layers"
                variant="ghost"
                aria-label="资源库"
                title="资源库"
                aria-pressed={showSources}
                onClick={() => setShowSources((value) => !value)}
              />
            )}
            <StudioButton
              icon="book"
              variant="ghost"
              aria-label={base ? '提示词库' : '打开提示词库'}
              title="提示词库"
              onClick={() => setPromptLibrary({})}
            />
            <StudioButton
              icon="spark"
              variant="ghost"
              aria-label={
                base ? (base.canEdit ? '自由生成' : '生成与结果') : canEdit ? '开始生成' : '查看生成结果'
              }
              title="生成与结果"
              onClick={() => setFreeGeneration(true)}
            />
            <StudioButton
              icon={theme === 'light' ? 'moon' : 'sun'}
              variant="ghost"
              aria-label={theme === 'light' ? '深色画布' : '浅色画布'}
              title={theme === 'light' ? '深色画布' : '浅色画布'}
              onClick={onToggleTheme}
            />
            {base?.canEdit && (
              <StudioButton
                variant="primary"
                className="v2-live-save"
                disabled={!editable || !dirty || !title.trim()}
                onClick={() => void save()}
              >
                保存画布
              </StudioButton>
            )}
            <details
              className="creative-toolbar-menu v2-live-menu"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
              }}
              onClick={(event) => {
                if (event.target instanceof Element && event.target.closest('button'))
                  event.currentTarget.open = false;
              }}
            >
              <summary>更多操作</summary>
              <div>
                <StudioButton variant="ghost" onClick={onWorkflows}>
                  工作流中心
                </StudioButton>
                <StudioButton variant="ghost" onClick={() => setMediaLibrary(true)}>
                  打开素材库
                </StudioButton>
                <StudioButton variant="ghost" onClick={() => setEntityLibrary(true)}>
                  角色与场景
                </StudioButton>
                {projectActions}
                {base && (
                  <>
                    {editable && (
                      <>
                        <StudioButton variant="ghost" onClick={() => add('brief')}>
                          创作说明
                        </StudioButton>
                        <StudioButton variant="ghost" onClick={() => add('group')}>
                          添加分组
                        </StudioButton>
                        {node?.type === 'note' && node.data.text?.trim() && (
                          <StudioButton
                            variant="ghost"
                            onClick={() =>
                              setPromptLibrary({
                                draft: { positivePrompt: node.data.text ?? '', ...node.data.prompt },
                              })
                            }
                          >
                            将便签存入提示词库
                          </StudioButton>
                        )}
                      </>
                    )}
                    <StudioButton variant="ghost" onClick={() => void refreshReferences()}>
                      刷新引用
                    </StudioButton>
                    <StudioButton
                      variant="ghost"
                      onClick={() =>
                        void api<History>(`/boards/${base.id}/revisions`).then(setHistory).catch(report)
                      }
                    >
                      修订历史
                    </StudioButton>
                  </>
                )}
              </div>
            </details>
          </div>
        )}
      </header>
      {projectMessage && !denied && (
        <p className="creative-notice" role="status">
          {projectMessage}
        </p>
      )}
      {denied ? (
        <div className="dialog-body">
          <p role="alert" className="notice error">
            画布或项目已不可访问，已隐藏资源详情。{error}
          </p>
        </div>
      ) : !base || !layout ? (
        <div className="dialog-body creative-board-home v2-live-board-home">
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          {initialLoading ? (
            <p role="status">正在读取项目画布…</p>
          ) : (
            <>
              <span className="v2-live-empty-mark">
                <StudioBrand compact />
              </span>
              <h3>{boards.length ? '项目画布' : '从第一帧开始'}</h3>
              <p>
                {boards.length
                  ? '继续已有画布，或开启一个新探索。'
                  : '创建画布，就可以加入素材、写提示词和生成。'}
              </p>
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
              {!boards.length && !busy && !canEdit && <p className="field-hint">项目还没有可查看的画布。</p>}
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
            </>
          )}
        </div>
      ) : (
        <>
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
          <div className={`creative-workspace ${showSources ? 'creative-workspace-library' : ''}`}>
            {showSources && (
              <BoardSources
                projectId={projectId}
                editable={editable}
                refresh={refresh}
                add={(source) => {
                  if (add('reference', source) && window.matchMedia('(max-width: 760px)').matches)
                    setShowSources(false);
                }}
                onDragSource={(source) => {
                  draggedResource.current = source;
                }}
                onImport={() => setMediaLibrary(true)}
                onClose={() => setShowSources(false)}
                report={(reason) => {
                  if (reason instanceof ApiError && [401, 403].includes(reason.status)) report(reason);
                }}
              />
            )}
            <nav className="v2-live-tools" aria-label="画布工具">
              <StudioButton
                variant="ghost"
                icon="cursor"
                aria-label="选择"
                title="选择"
                aria-pressed={!pan}
                onClick={() => setPan(false)}
              />
              <StudioButton
                variant="ghost"
                icon="hand"
                aria-label="平移"
                title="平移"
                aria-pressed={pan}
                onClick={() => setPan(true)}
              />
              {base.canEdit && (
                <>
                  <hr />
                  <StudioButton
                    variant="ghost"
                    icon="note"
                    aria-label="添加便签"
                    title="添加便签"
                    disabled={!editable}
                    onClick={() => add('note')}
                  />
                  <StudioButton
                    variant="primary"
                    icon="spark"
                    aria-label="添加生成节点"
                    title="添加生成节点"
                    disabled={!editable}
                    onClick={() => add('generation')}
                  />
                </>
              )}
            </nav>
            <BoardSurface
              nodes={flowNodes}
              edges={flowEdges}
              viewport={layout.viewport}
              editable={editable}
              pan={pan}
              theme={theme}
              onDropResource={(position) => {
                const source = draggedResource.current;
                draggedResource.current = undefined;
                if (source?.ready) add('reference', source, undefined, position);
              }}
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
              overlay={
                node ? (
                  <div
                    className={`creative-context ${node.type === 'generation' ? 'creative-context-composer' : ''}`}
                  >
                    {node.type === 'generation' ? (
                      <BoardExecutionPanel
                        key={`${base.id}:${node.id}`}
                        board={base}
                        userId={userId}
                        node={node}
                        layout={layout}
                        resolved={resolved}
                        editable={editable}
                        dirty={dirty}
                        save={title.trim() ? save : undefined}
                        onPromptChange={(draft) => setNodePrompt(node.id, draft)}
                        onPromptLibrary={(draft) => setPromptLibrary({ target: node.id, draft })}
                        onSavedToLibrary={() => setRefresh((value) => value + 1)}
                        update={update}
                        bind={(port, source) => bindInput(node.id, port, source)}
                        onResult={addResult}
                        onOpenTasks={() => setFreeGeneration(true)}
                        onDismiss={() => setSelected([])}
                      >
                        <BoardNodeLayout
                          node={node}
                          nodes={layout.nodes}
                          editable={editable}
                          update={update}
                          remove={() => remove([node.id])}
                        />
                      </BoardExecutionPanel>
                    ) : (
                      <BoardInspector
                        node={node}
                        value={node && resolved[node.id]}
                        nodes={layout.nodes}
                        editable={editable}
                        update={update}
                        onDismiss={() => setSelected([])}
                        onUseImage={
                          editable &&
                          (node.type === 'result' || node.data.ref?.kind === 'media') &&
                          resolved[node.id]?.media?.mediaType === 'image'
                            ? () => add('generation', undefined, undefined, undefined, node)
                            : undefined
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
                    )}
                  </div>
                ) : layout.nodes.length ? undefined : (
                  <div className="creative-empty">
                    <span className="creative-kicker">PULLET STUDIO</span>
                    <h3>把想法放到画布上</h3>
                    <p>从一张参考图开始，或添加生成节点直接写提示词。</p>
                    {editable && (
                      <button className="primary" onClick={() => setShowSources(true)}>
                        浏览项目资源
                      </button>
                    )}
                  </div>
                )
              }
            />
          </div>
          <div className="creative-help">
            Space 拖动平移 · Shift 多选 · Delete 移除所选节点/连线 · 普通连线为注释，具名输入连线用于生成 ·{' '}
            {layout.nodes.length}
            /100 节点 · {layout.edges.length}/200 连线
          </div>
        </>
      )}
      {freeGeneration && !denied && (
        <GenerationDialog
          creation={{
            projectId,
            boardId: base?.id,
            initialDraft: { positivePrompt: node?.data.text ?? '', ...node?.data.prompt },
            onPin: editable ? pinCandidate : undefined,
          }}
          onClose={() => setFreeGeneration(false)}
        />
      )}
      {mediaLibrary && !denied && (
        <MediaDialog
          projectId={projectId}
          onClose={() => {
            setMediaLibrary(false);
            setRefresh((value) => value + 1);
          }}
          onAddToCanvas={
            editable
              ? async (media) => {
                  await pinCandidate(media);
                  setMediaLibrary(false);
                  setRefresh((value) => value + 1);
                }
              : undefined
          }
        />
      )}
      {entityLibrary && !denied && (
        <EntityLibraryDialog
          projectId={projectId}
          onClose={() => {
            setEntityLibrary(false);
            setRefresh((value) => value + 1);
          }}
        />
      )}
      {promptLibrary && !denied && (
        <PromptLibraryDialog
          projectId={projectId}
          initialDraft={promptLibrary.draft}
          onClose={() => setPromptLibrary(undefined)}
          onApply={
            editable
              ? (revision) => {
                  if (
                    !(promptLibrary.target
                      ? setNodePrompt(
                          promptLibrary.target,
                          {
                            positivePrompt: revision.positivePrompt,
                            negativePrompt: revision.negativePrompt,
                            source: revision.source,
                            promptLibraryRevisionId: revision.id,
                          },
                          true,
                        )
                      : add('note', undefined, {
                          text: revision.positivePrompt,
                          prompt: {
                            negativePrompt: revision.negativePrompt,
                            source: revision.source,
                            promptLibraryRevisionId: revision.id,
                          },
                        }))
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
