import { z } from 'zod';
import { parameterValues } from '../generation/generation-contract';
import { fieldValuesInput } from '../generation/workflow-fields';
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
    .object({
      ...base,
      type: z.literal('generation'),
      data: z
        .object({
          generation: z
            .object({
              workflowId: z.uuid().optional(),
              creationTarget: z.enum(['image', 'video', 'audio']).optional(),
              parameterValues: parameterValues.optional(),
              fieldValues: fieldValuesInput.optional(),
            })
            .strict(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('result'),
      data: z.object({ jobId: z.uuid(), outputId: z.uuid().optional() }).strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('note'),
      data: z
        .object({
          text: z.string().max(16000),
          prompt: z
            .object({
              negativePrompt: z.string().max(16000).default(''),
              source: z.string().max(300).default(''),
              promptLibraryRevisionId: z.uuid().optional(),
            })
            .strict()
            .optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      type: z.literal('brief'),
      data: z
        .object({
          text: z.string().max(4000),
          prompt: z
            .object({
              negativePrompt: z.string().max(16000).default(''),
              source: z.string().max(300).default(''),
              promptLibraryRevisionId: z.uuid().optional(),
            })
            .strict()
            .optional(),
        })
        .strict(),
    })
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
    edges: z
      .array(
        z
          .object({
            id: z.uuid(),
            source: z.uuid(),
            target: z.uuid(),
            kind: z.enum(['annotation', 'input_binding']).optional(),
            sourcePort: z.enum(['text', 'image', 'video', 'audio']).optional(),
            targetPort: z
              .union([z.enum(['prompt', 'first_frame']), z.templateLiteral(['reference:', z.uuid()])])
              .optional(),
          })
          .strict(),
      )
      .max(200),
  })
  .strict()
  .superRefine((layout, ctx) => {
    const ids = new Map(layout.nodes.map((n) => [n.id, n]));
    const invalid = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (ids.size !== layout.nodes.length) invalid('节点标识不能重复');
    for (const n of layout.nodes)
      if (n.type === 'result' && n.id !== (n.data.outputId ?? n.data.jobId))
        invalid('结果节点使用任务或产物标识，不能重复加入同一结果');
    for (const n of layout.nodes)
      if (n.parentId && (n.type === 'group' || ids.get(n.parentId)?.type !== 'group'))
        invalid('分组须引用本画布的一级分组');
    const occupied = new Set<string>();
    const pairs = new Set<string>(),
      edgeIds = new Set<string>();
    for (const edge of layout.edges) {
      if (
        edge.source === edge.target ||
        !ids.has(edge.source) ||
        !ids.has(edge.target) ||
        ids.get(edge.source)?.type === 'group' ||
        ids.get(edge.target)?.type === 'group' ||
        pairs.has(`${edge.source}:${edge.target}:${edge.kind ?? 'annotation'}:${edge.targetPort ?? ''}`) ||
        edgeIds.has(edge.id)
      )
        invalid('连线端点或类型无效');
      if (edge.kind === 'input_binding') {
        const source = ids.get(edge.source),
          target = ids.get(edge.target),
          slot = `${edge.target}:${edge.targetPort}`;
        if (target?.type !== 'generation' || occupied.has(slot))
          invalid('生成节点的每个输入端口只能绑定一个来源');
        if (
          edge.targetPort === 'prompt'
            ? edge.sourcePort !== 'text' || !['note', 'brief'].includes(source?.type ?? '')
            : !edge.targetPort ||
              (edge.targetPort === 'first_frame'
                ? edge.sourcePort !== 'image'
                : !edge.sourcePort || edge.sourcePort === 'text') ||
              !(
                source?.type === 'result' ||
                (source?.type === 'reference' && source.data.ref.kind === 'media')
              )
        )
          invalid('输入连线端口类型不匹配');
        occupied.add(slot);
      } else if (edge.sourcePort || edge.targetPort) invalid('注释连线不能携带执行端口');
      pairs.add(`${edge.source}:${edge.target}:${edge.kind ?? 'annotation'}:${edge.targetPort ?? ''}`);
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
