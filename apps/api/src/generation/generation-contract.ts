import { z } from 'zod';
import { fail } from '../common/http';

const name = z.string().trim().min(1).max(120);
const nodeId = z.string().regex(/^[\w:.-]{1,80}$/u);
const slot = z.string().regex(/^[a-zA-Z][\w-]{0,79}$/u);
const target = z.object({ node: nodeId, input: slot }).strict();
export const connectionInput = z
  .object({
    name,
    baseUrl: z.string().trim().min(1).max(1000),
    trustedPrivate: z.boolean(),
    token: z
      .string()
      .trim()
      .max(4096)
      .regex(/^[\x21-\x7e]*$/u)
      .default(''),
  })
  .strict();
export const connectionUpdate = z
  .object({ enabled: z.boolean(), expectedVersion: z.number().int().positive() })
  .strict();
export const workflowInput = z
  .object({
    name,
    connectionId: z.uuid(),
    capability: z.enum(['image.text_to_image', 'video.text_to_video', 'video.image_to_video']),
    graph: z.record(
      nodeId,
      z
        .object({
          class_type: z
            .string()
            .min(1)
            .max(120)
            .refine((value) => value !== '.' && value !== '..' && !/[\\/%?#\x00-\x1f\x7f]/u.test(value)),
          inputs: z.record(z.string().min(1).max(120), z.json()),
          _meta: z.json().optional(),
        })
        .strict(),
    ),
    positive: target,
    negative: target.optional(),
    image: z
      .object({ node: nodeId, input: z.literal('image') })
      .strict()
      .optional(),
    output: z.object({ node: nodeId, field: slot }).strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    const keys = Object.keys(value.graph);
    if (!keys.length || keys.length > 200 || Buffer.byteLength(JSON.stringify(value.graph)) > 160_000)
      issue('工作流须包含 1–200 个 API 节点，最多 160KB');
    for (const binding of [value.positive, value.negative]) {
      if (!binding) continue;
      const inputs = value.graph[binding.node]?.inputs;
      if (!inputs || !Object.hasOwn(inputs, binding.input) || typeof inputs[binding.input] !== 'string')
        issue('提示词绑定须指向现有的文本输入');
    }
    if (value.positive.node === value.negative?.node && value.positive.input === value.negative.input)
      issue('正向和负向提示词必须绑定不同输入');
    if (!Object.hasOwn(value.graph, value.output.node)) issue('输出节点不存在');
    if (value.capability === 'video.image_to_video') {
      const node = value.image && value.graph[value.image.node];
      if (node?.class_type !== 'LoadImage' || typeof node.inputs.image !== 'string')
        issue('图生视频须绑定 LoadImage 的 image 输入');
      if (
        value.image &&
        [value.positive, value.negative].some(
          (binding) => binding?.node === value.image?.node && binding?.input === 'image',
        )
      )
        issue('首帧和提示词必须绑定不同输入');
    } else if (value.image) issue('此生成方式不支持首帧绑定');
  });
export const createJobInput = z
  .object({
    workflowId: z.uuid(),
    promptId: z.uuid(),
    imageVersionId: z.uuid().optional(),
    confirmed: z.literal(true),
  })
  .strict();
export const reconcileInput = z.object({ remoteId: z.uuid().optional() }).strict();
export type WorkflowInput = z.infer<typeof workflowInput>;
export type CreateJobInput = z.infer<typeof createJobInput>;
export const referenceImageLimit = 16 * 1024 * 1024;
export const referenceImageExtensions: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
export const resultDescriptor = z.object({
  filename: z
    .string()
    .min(1)
    .max(160)
    .refine(
      (v) =>
        v === v.trim() &&
        !/[\\/:%<>"|?*\x00-\x1f\x7f]/u.test(v) &&
        /\.(png|jpe?g|webp|mp4|webm|mov)$/iu.test(v),
    ),
  subfolder: z
    .string()
    .max(500)
    .transform((value) => value.replaceAll('\\', '/'))
    .refine(
      (v) =>
        !v ||
        v
          .split('/')
          .every(
            (part) =>
              part.length > 0 &&
              part.trim() === part &&
              !part.endsWith('.') &&
              !/[:%<>"|?*\x00-\x1f\x7f]/u.test(part),
          ),
    )
    .default(''),
  type: z.literal('output'),
});
export type ResultDescriptor = z.infer<typeof resultDescriptor>;

export function renderWorkflow(workflow: WorkflowInput, positive: string, negative: string) {
  if (negative && !workflow.negative)
    fail(409, 'WORKFLOW_NEGATIVE_UNBOUND', '此提示词包含负向词，请选择配置了负向绑定的工作流');
  const graph = structuredClone(workflow.graph);
  graph[workflow.positive.node].inputs[workflow.positive.input] = positive;
  if (workflow.negative) graph[workflow.negative.node].inputs[workflow.negative.input] = negative;
  if (Buffer.byteLength(JSON.stringify(graph)) > 512_000)
    fail(413, 'WORKFLOW_INPUT_LIMIT', '填入提示词后工作流过大');
  return graph;
}
