import type { Edge, Node, Viewport } from '@xyflow/react';

export const kinds = ['image', 'text', 'generation', 'result', 'video', 'audio'] as const;
export type Kind = (typeof kinds)[number];
export const labels: Record<Kind, string> = {
  image: '参考图',
  text: '提示词',
  generation: '生成配置',
  result: '结果比较',
  video: '视频',
  audio: '声音',
};
export type LabData = { kind: Kind; title: string; text: string; variant: number; primary: number };
export type LabNode = Node<LabData, 'lab'>;
export type Board = { schema: 'pullet.canvas-lab.v1'; nodes: LabNode[]; edges: Edge[]; viewport: Viewport };
export const nodeWidth = 224,
  nodeHeight = 230;
export const initialViewport: Viewport = { x: 45, y: 44, zoom: 0.75 };
export function demoBoard(count: 30 | 50): Board {
  const nodes: LabNode[] = Array.from({ length: count }, (_, i) => {
    const kind = kinds[i % kinds.length],
      group = Math.floor(i / kinds.length);
    const positions = [
      { x: 0, y: 0 },
      { x: 0, y: 285 },
      { x: 320, y: 130 },
      { x: 640, y: 130 },
      { x: 960, y: 0 },
      { x: 960, y: 285 },
    ];
    return {
      id: `n${i + 1}`,
      type: 'lab',
      position: {
        x: positions[i % 6].x + (group % 2) * 1320,
        y: positions[i % 6].y + Math.floor(group / 2) * 680,
      },
      data: {
        kind,
        title: `${labels[kind]} ${group + 1}`,
        variant: group % 3,
        primary: 0,
        text:
          kind === 'text'
            ? '清晨，旅人走进海边小站。暖色侧光，镜头缓慢推进，保持服装与空间一致。'
            : kind === 'generation'
              ? '参考图 + 提示词 → 视觉方案\n16:9 · 3个演示变体'
              : '海边小站 · 视觉探索',
      },
    };
  });
  const edges: Edge[] = [];
  for (let i = 0; i + 3 < count; i += 6) {
    for (const [from, to] of [
      [i, i + 2],
      [i + 1, i + 2],
      [i + 2, i + 3],
    ]) {
      edges.push({
        id: `e${from}-${to}`,
        source: nodes[from].id,
        target: nodes[to].id,
        sourceHandle: 'out',
        targetHandle: 'in',
      });
    }
  }
  return { schema: 'pullet.canvas-lab.v1', nodes, edges, viewport: initialViewport };
}
export function connectionError(
  nodes: LabNode[],
  edges: Edge[],
  source: string,
  target: string,
): string | null {
  const from = nodes.find((node) => node.id === source),
    to = nodes.find((node) => node.id === target);
  if (!from || !to || source === target) return '不能连接自己或缺失节点';
  if (edges.some((edge) => edge.source === source && edge.target === target)) return '这条引用已经存在';
  const valid =
    (to.data.kind === 'generation' &&
      ['text', 'image', 'result', 'video', 'audio'].includes(from.data.kind)) ||
    (from.data.kind === 'generation' && to.data.kind === 'result');
  if (!valid) return '类型不匹配：参考或提示词接入生成配置，生成配置连接结果';
  const pending = [target],
    visited = new Set<string>();
  while (pending.length) {
    const id = pending.pop()!;
    if (id === source) return '执行依赖不能形成循环';
    if (visited.has(id)) continue;
    visited.add(id);
    pending.push(...edges.filter((edge) => edge.source === id).map((edge) => edge.target));
  }
  return null;
}
export function serialize(board: Board): string {
  return JSON.stringify({
    schema: board.schema,
    viewport: board.viewport,
    nodes: board.nodes.map((node) => ({
      id: node.id,
      type: 'lab',
      position: node.position,
      data: node.data,
    })),
    edges: board.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: 'out',
      targetHandle: 'in',
    })),
  });
}
export function parseBoard(raw: string): Board {
  if (raw.length > 200000) throw new Error('布局文件过大');
  const value = JSON.parse(raw);
  const finite = (n: unknown, min: number, max: number): n is number =>
    typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  const id = (s: unknown): s is string => typeof s === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(s);
  if (
    value?.schema !== 'pullet.canvas-lab.v1' ||
    !Array.isArray(value.nodes) ||
    value.nodes.length > 100 ||
    !Array.isArray(value.edges) ||
    value.edges.length > 200 ||
    !finite(value.viewport?.x, -100000, 100000) ||
    !finite(value.viewport?.y, -100000, 100000) ||
    !finite(value.viewport?.zoom, 0.15, 2)
  )
    throw new Error('布局版本或范围无效，当前编辑已保留');
  const nodes: LabNode[] = value.nodes.map((node: LabNode) => {
    const data = node?.data;
    if (
      !id(node?.id) ||
      !finite(node.position?.x, -50000, 50000) ||
      !finite(node.position?.y, -50000, 50000) ||
      !data ||
      !kinds.includes(data.kind) ||
      typeof data.title !== 'string' ||
      data.title.length > 100 ||
      typeof data.text !== 'string' ||
      data.text.length > 4000 ||
      !Number.isInteger(data.variant) ||
      data.variant < 0 ||
      data.variant > 2 ||
      !Number.isInteger(data.primary) ||
      data.primary < 0 ||
      data.primary > 2
    )
      throw new Error('节点内容无效，当前编辑已保留');
    return {
      id: node.id,
      type: 'lab',
      position: { x: node.position.x, y: node.position.y },
      data: {
        kind: data.kind,
        title: data.title,
        text: data.text,
        variant: data.variant,
        primary: data.primary,
      },
    };
  });
  if (new Set(nodes.map((node) => node.id)).size !== nodes.length) throw new Error('节点标识重复');
  const edges: Edge[] = [];
  for (const edge of value.edges as Edge[]) {
    if (
      !id(edge?.id) ||
      edges.some((other) => other.id === edge.id) ||
      connectionError(nodes, edges, edge.source, edge.target)
    )
      throw new Error('布局包含无效连线');
    edges.push({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: 'out',
      targetHandle: 'in',
    });
  }
  return {
    schema: value.schema,
    nodes,
    edges,
    viewport: { x: value.viewport.x, y: value.viewport.y, zoom: value.viewport.zoom },
  };
}

// Synthetic SVGs contain no upstream assets or user content.
export function thumbnail(variant = 0) {
  const palettes = [
    ['#deb383', '#15374b', '#617b85'],
    ['#bba6ba', '#25304b', '#6b718c'],
    ['#bfc3a1', '#283f3a', '#708274'],
  ];
  const [sky, sea, land] = palettes[variant % 3];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240"><defs><linearGradient id="s" x2="0" y2="1"><stop stop-color="${sky}"/><stop offset="1" stop-color="${sea}"/></linearGradient></defs><path fill="url(#s)" d="M0 0h400v240H0z"/><circle cx="300" cy="66" r="30" fill="#f4e5c4" opacity=".8"/><path d="M0 164L100 92l94 76 84-49 122 57v64H0z" fill="${land}"/><path d="M0 195h400v45H0z" fill="${sea}"/><path d="M44 180v-46h90v46z" fill="#e7d2ac"/><path d="M30 134l58-41 61 41z" fill="#263638"/><path d="M94 180v-29h17v29" fill="#283039"/><path d="M0 221h400" stroke="#d5cead" opacity=".3"/><circle cx="216" cy="167" r="6" fill="#17222c"/><path d="M211 173h10l4 28h-18z" fill="#17222c"/></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
