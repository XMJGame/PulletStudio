import { z } from 'zod';
import { fail } from '../common/http';
const target = {
  id: z.uuid(),
  label: z.string().trim().min(1).max(120),
  node: z.string().regex(/^[\w:.-]{1,80}$/u),
  input: z.string().regex(/^[a-zA-Z][\w.-]{0,79}$/u),
};
const number = z.number().finite().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
export const exposedField = z.discriminatedUnion('type', [
  z.object({ ...target, type: z.literal('text'), maxLength: z.number().int().min(1).max(4000) }).strict(),
  z
    .object({
      ...target,
      type: z.literal('number'),
      min: number,
      max: number,
      step: z.number().finite().positive().max(Number.MAX_SAFE_INTEGER),
      integer: z.boolean(),
    })
    .strict(),
  z.object({ ...target, type: z.literal('boolean') }).strict(),
  z
    .object({
      ...target,
      type: z.literal('enum'),
      options: z.array(z.string().min(1).max(200)).min(2).max(50),
    })
    .strict(),
]);
export type ExposedField = z.infer<typeof exposedField>;
export const fieldValuesInput = z.record(z.uuid(), z.union([z.string().max(4000), number, z.boolean()]));
export type FieldValues = z.infer<typeof fieldValuesInput>;
export function fieldAccepts(field: ExposedField, value: unknown) {
  if (field.type === 'text') return typeof value === 'string' && value.length <= field.maxLength;
  if (field.type === 'boolean') return typeof value === 'boolean';
  if (field.type === 'enum') return typeof value === 'string' && field.options.includes(value);
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < field.min ||
    value > field.max ||
    (field.integer && !Number.isSafeInteger(value))
  )
    return false;
  const steps = (value - field.min) / field.step;
  return Math.abs(steps - Math.round(steps)) < 1e-7;
}
export function resolveFields(
  workflow: { fields?: ExposedField[]; graph: Record<string, { inputs: Record<string, unknown> }> },
  requested: FieldValues = {},
): FieldValues {
  const fields = workflow.fields ?? [],
    values: FieldValues = {};
  for (const id of Object.keys(requested))
    if (!fields.some((field) => field.id === id))
      fail(400, 'WORKFLOW_FIELD_INVALID', '此工作流未公开所选创作字段');
  for (const field of fields) {
    const value = Object.hasOwn(requested, field.id)
      ? requested[field.id]
      : workflow.graph[field.node]?.inputs[field.input];
    if (!fieldAccepts(field, value))
      fail(400, 'WORKFLOW_FIELD_INVALID', `${field.label}的类型、范围或选项不符合配置`);
    values[field.id] = value as string | number | boolean;
  }
  return values;
}
export function validateFieldTargets(
  fields: ExposedField[],
  graph: Record<string, { inputs: Record<string, unknown> }>,
  occupied: { node: string; input: string }[],
  issue: (text: string) => void,
) {
  const ids = new Set<string>();
  for (const field of fields) {
    if (ids.has(field.id)) issue('创作字段标识不能重复');
    ids.add(field.id);
    if (occupied.some((target) => target.node === field.node && target.input === field.input))
      issue('创作字段必须绑定独立输入');
    occupied.push(field);
    if (
      /(?:^|[_.-])(?:api[_-]?key|token|secret|password|authorization|(?:base[_-]?)?url|endpoint|host|address|(?:file[_-]?)?path|filename)(?:$|[_.-])/iu.test(
        field.input,
      ) ||
      /^(?:image|audio|video|file|media)$/iu.test(field.input)
    )
      issue('凭据、端点与文件路径不能公开为创作参数');
    if (
      !Object.hasOwn(graph, field.node) ||
      !Object.hasOwn(graph[field.node].inputs, field.input) ||
      !fieldAccepts(field, graph[field.node]?.inputs[field.input])
    )
      issue('创作字段须绑定符合合同的现有常量');
    if (
      field.type === 'number' &&
      (field.min > field.max ||
        (field.integer && ![field.min, field.max, field.step].every(Number.isSafeInteger)))
    )
      issue('数值字段范围/整数步长不合法');
    if (field.type === 'enum' && new Set(field.options).size !== field.options.length)
      issue('枚举选项不能重复');
  }
}
