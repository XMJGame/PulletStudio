import { z } from 'zod';
import { fail } from '../common/http';
import {
  exposedField,
  fieldValuesInput,
  FieldValues,
  resolveFields,
  validateFieldTargets,
} from './workflow-fields';

const name = z.string().trim().min(1).max(120);
const nodeId = z.string().regex(/^[\w:.-]{1,80}$/u);
const slot = z.string().regex(/^[a-zA-Z][\w.-]{0,79}$/u);
const target = z.object({ node: nodeId, input: slot }).strict();
const parameter = z.discriminatedUnion('key', [
  target.extend({
    key: z.literal('aspectRatio'),
    options: z
      .array(z.object({ label: name, value: z.string().min(1).max(120) }).strict())
      .min(2)
      .max(20),
  }),
  target.extend({
    key: z.literal('durationSeconds'),
    min: z.number().positive().max(3600),
    max: z.number().positive().max(3600),
    step: z.number().positive().max(3600),
  }),
  target.extend({
    key: z.literal('seed'),
    min: z.number().int().nonnegative(),
    max: z.number().int().nonnegative(),
    step: z.literal(1),
  }),
]);
export const parameterValues = z
  .object({
    aspectRatio: z.string().min(1).max(120).optional(),
    durationSeconds: z.number().positive().max(3600).optional(),
    seed: z.number().int().nonnegative().optional(),
  })
  .strict();
export type ParameterValues = z.infer<typeof parameterValues>;
export type WorkflowParameter = z.infer<typeof parameter>;
export function parameterAccepts(binding: WorkflowParameter, value: unknown): boolean {
  if (binding.key === 'aspectRatio') return binding.options.some((option) => option.value === value);
  if (typeof value !== 'number' || !Number.isFinite(value) || value < binding.min || value > binding.max)
    return false;
  if (binding.key === 'seed') return Number.isSafeInteger(value);
  const steps = (value - binding.min) / binding.step;
  return Math.abs(steps - Math.round(steps)) < 1e-7;
}
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
    image: target.optional(),
    parameters: z.array(parameter).max(3).optional(),
    fields: z.array(exposedField).max(20).optional(),
    fieldSchemaVersion: z.literal('studio.workflow-fields.v1').optional(),
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
      const image = value.image;
      const inputs = image && value.graph[image.node]?.inputs;
      if (!image || !inputs || !Object.hasOwn(inputs, image.input) || typeof inputs[image.input] !== 'string')
        issue('图生视频须绑定现有的图片文件名输入');
      if (
        image &&
        [value.positive, value.negative].some(
          (binding) => binding?.node === image.node && binding.input === image.input,
        )
      )
        issue('首帧和提示词必须绑定不同输入');
    } else if (value.image) issue('此生成方式不支持首帧绑定');
    const occupied = [value.positive, value.negative, value.image].filter((item) => item !== undefined);
    const keysUsed = new Set<string>();
    for (const binding of value.parameters ?? []) {
      if (keysUsed.has(binding.key)) issue('同一参数只能绑定一次');
      keysUsed.add(binding.key);
      if (occupied.some((item) => item.node === binding.node && item.input === binding.input))
        issue('创作参数必须绑定独立输入');
      occupied.push(binding);
      if (binding.key !== 'aspectRatio' && binding.min > binding.max) issue('参数范围无效');
      if (
        binding.key === 'aspectRatio' &&
        new Set(binding.options.map((option) => option.value)).size !== binding.options.length
      )
        issue('画幅选项不能重复');
      const current = value.graph[binding.node]?.inputs[binding.input];
      if (!parameterAccepts(binding, current)) issue('参数须绑定符合选项或范围的现有常量');
      if (binding.key === 'durationSeconds' && value.capability === 'image.text_to_image')
        issue('图片工作流不支持视频时长');
    }
    validateFieldTargets(value.fields ?? [], value.graph, occupied, issue);
  });
export const createJobInput = z
  .object({
    workflowId: z.uuid(),
    promptId: z.uuid(),
    imageVersionId: z.uuid().optional(),
    parameterValues: parameterValues.optional(),
    fieldValues: fieldValuesInput.optional(),
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

export function resolveParameters(workflow: WorkflowInput, requested: ParameterValues = {}) {
  const resolved: ParameterValues = {};
  const bindings = workflow.parameters ?? [];
  for (const key of Object.keys(requested)) {
    if (!bindings.some((binding) => binding.key === key))
      fail(400, 'WORKFLOW_PARAMETER_INVALID', '此工作流未配置所选参数');
  }
  for (const binding of bindings) {
    const value = requested[binding.key] ?? workflow.graph[binding.node].inputs[binding.input];
    if (!parameterAccepts(binding, value))
      fail(400, 'WORKFLOW_PARAMETER_INVALID', '生成参数超出工作流的可用范围或选项');
    Object.assign(resolved, { [binding.key]: value });
  }
  return resolved;
}

export function renderWorkflow(
  workflow: WorkflowInput,
  positive: string,
  negative: string,
  parameters: ParameterValues = {},
  fields: FieldValues = {},
) {
  if (negative && !workflow.negative)
    fail(409, 'WORKFLOW_NEGATIVE_UNBOUND', '此提示词包含负向词，请选择配置了负向绑定的工作流');
  const graph = structuredClone(workflow.graph);
  graph[workflow.positive.node].inputs[workflow.positive.input] = positive;
  if (workflow.negative) graph[workflow.negative.node].inputs[workflow.negative.input] = negative;
  const resolved = resolveParameters(workflow, parameters);
  for (const binding of workflow.parameters ?? [])
    graph[binding.node].inputs[binding.input] = resolved[binding.key]!;
  const resolvedFields = resolveFields(workflow, fields);
  for (const field of workflow.fields ?? []) graph[field.node].inputs[field.input] = resolvedFields[field.id];
  if (Buffer.byteLength(JSON.stringify(graph)) > 512_000)
    fail(413, 'WORKFLOW_INPUT_LIMIT', '填入提示词后工作流过大');
  return graph;
}
