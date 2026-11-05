import { z } from 'zod';
export const boardReference = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('shot'), id: z.uuid(), version: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal('entity'), id: z.uuid(), revisionId: z.uuid() }).strict(),
  z.object({ kind: z.literal('media'), id: z.uuid() }).strict(),
]);
const base = {
  id: z.uuid(),
  position: z
    .object({ x: z.number().finite().min(-50000).max(50000), y: z.number().finite().min(-50000).max(50000) })
    .strict(),
  width: z.number().int().min(180).max(1600),
  height: z.number().int().min(120).max(1600),
  parentId: z.uuid().optional(),
};
const node = z.discriminatedUnion('type', [
  z
    .object({ ...base, type: z.literal('note'), data: z.object({ text: z.string().max(4000) }).strict() })
    .strict(),
  z
    .object({ ...base, type: z.literal('brief'), data: z.object({ text: z.string().max(4000) }).strict() })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('group'),
      data: z.object({ label: z.string().trim().min(1).max(100), collapsed: z.boolean() }).strict(),
    })
    .strict(),
  z
    .object({ ...base, type: z.literal('reference'), data: z.object({ ref: boardReference }).strict() })
    .strict(),
]);
export const boardLayout = z
  .object({
    schemaVersion: z.literal('studio.board.v1'),
    viewport: z
      .object({
        x: z.number().finite().min(-100000).max(100000),
        y: z.number().finite().min(-100000).max(100000),
        zoom: z.number().min(0.15).max(2),
      })
      .strict(),
    nodes: z.array(node).max(100),
    edges: z.array(z.object({ id: z.uuid(), source: z.uuid(), target: z.uuid() }).strict()).max(200),
  })
  .strict()
  .superRefine((layout, ctx) => {
    const ids = new Map(layout.nodes.map((n) => [n.id, n]));
    const invalid = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (ids.size !== layout.nodes.length) invalid('节点标识不能重复');
    for (const n of layout.nodes)
      if (n.parentId && (n.type === 'group' || ids.get(n.parentId)?.type !== 'group'))
        invalid('分组须引用本画布的一级分组');
    const pairs = new Set<string>(),
      edgeIds = new Set<string>();
    for (const edge of layout.edges) {
      if (
        edge.source === edge.target ||
        !ids.has(edge.source) ||
        !ids.has(edge.target) ||
        ids.get(edge.source)?.type === 'group' ||
        ids.get(edge.target)?.type === 'group' ||
        pairs.has(`${edge.source}:${edge.target}`) ||
        edgeIds.has(edge.id)
      )
        invalid('连线端点或类型无效');
      pairs.add(`${edge.source}:${edge.target}`);
      edgeIds.add(edge.id);
    }
    if (Buffer.byteLength(JSON.stringify(layout)) > 262144) invalid('画布布局超过256KiB，请拆分画布');
  });
export const createBoardInput = z
  .object({ title: z.string().trim().min(1).max(100), unitId: z.uuid().nullable().default(null) })
  .strict();
export const saveBoardInput = z
  .object({
    title: z.string().trim().min(1).max(100),
    expectedRevision: z.number().int().positive(),
    layout: boardLayout,
  })
  .strict();
export const emptyBoard = {
  schemaVersion: 'studio.board.v1' as const,
  viewport: { x: 40, y: 40, zoom: 0.85 },
  nodes: [],
  edges: [],
};
