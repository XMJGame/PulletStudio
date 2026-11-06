import { z } from 'zod';
import { fail } from '../common/http';
import type { WorkflowMediaSchema } from '../../../../packages/contracts/src/workflow';

const node = z.string().regex(/^[\w:.-]{1,80}$/u);
const input = z.string().regex(/^[a-zA-Z][\w.-]{0,79}$/u);
const base = {
  id: z.uuid(),
  label: z.string().trim().min(1).max(120),
  mediaType: z.enum(['image', 'video', 'audio']),
};
export const workflowMediaSchema = z
  .object({
    version: z.literal('studio.workflow-media.v1'),
    inputs: z
      .array(
        z
          .object({
            ...base,
            node,
            input,
            role: z.enum(['reference', 'last_frame', 'source', 'mask']),
            required: z.boolean(),
            onMissing: z.enum(['error', 'empty', 'disconnect']),
          })
          .strict(),
      )
      .max(32),
    outputs: z
      .array(
        z
          .object({
            ...base,
            node,
            field: input,
            role: z.enum(['preview', 'intermediate']),
            multiple: z.boolean(),
          })
          .strict(),
      )
      .max(16),
  })
  .strict();

type Target = { node: string; input: string };
type Graph = Record<string, { class_type: string; inputs: Record<string, unknown> }>;

export function imageDisconnectTargets(graph: Graph, source: string) {
  return Object.entries(graph).flatMap(([node, item]) =>
    Object.entries(item.inputs).flatMap(([input, value]) =>
      Array.isArray(value) && value.length === 2 && value[0] === source && Number.isInteger(value[1])
        ? [{ node, input, output: value[1] as number }]
        : [],
    ),
  );
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function optionalImageInputMatchesMetadata(key: string, metadata: unknown) {
  const { optional, required } = record(metadata);
  const available = record(optional);
  if (Object.hasOwn(record(required), key)) return false;
  const direct = available[key];
  if (Array.isArray(direct)) return direct[0] === 'IMAGE';
  const [group, member, extra] = key.split('.');
  if (!member || extra) return false;
  const declared = available[group];
  if (!Array.isArray(declared) || declared[0] !== 'COMFY_AUTOGROW_V3') return false;
  const template = record(record(declared[1]).template);
  if (template.min !== 0) return false;
  const inputs = record(template.input);
  const choices = [...Object.values(record(inputs.required)), ...Object.values(record(inputs.optional))];
  if (choices.length !== 1 || !Array.isArray(choices[0]) || choices[0][0] !== 'IMAGE') return false;
  if (Array.isArray(template.names)) return template.names.includes(member);
  if (typeof template.prefix !== 'string' || !member.startsWith(template.prefix)) return false;
  const suffix = member.slice(template.prefix.length);
  return (
    /^(?:0|[1-9]\d*)$/u.test(suffix) && typeof template.max === 'number' && Number(suffix) < template.max
  );
}

export function validateMediaTargets(
  schema: WorkflowMediaSchema | undefined,
  graph: Graph,
  occupied: Target[],
  primary: { node: string; field: string },
  fieldIds: string[],
  issue: (message: string) => void,
) {
  if (!schema) return;
  const ids = new Set(fieldIds);
  for (const slot of [...schema.inputs, ...schema.outputs]) {
    if (ids.has(slot.id)) issue('媒体声明与公开字段的标识不能重复');
    ids.add(slot.id);
  }
  for (const slot of schema.inputs) {
    if (occupied.some((target) => target.node === slot.node && target.input === slot.input))
      issue('媒体槽位必须绑定独立输入，不能覆盖首帧、提示词或参数');
    occupied.push(slot);
    if (
      !Object.hasOwn(graph, slot.node) ||
      !Object.hasOwn(graph[slot.node].inputs, slot.input) ||
      typeof graph[slot.node].inputs[slot.input] !== 'string'
    )
      issue('媒体槽位须绑定现有的文件名常量输入，不能替换连线');
    if (
      /(?:^|[_.-])(?:api[_-]?key|token|secret|password|authorization|(?:base[_-]?)?url|endpoint|host(?:name)?|address)(?:$|[_.-])/iu.test(
        slot.input,
      )
    )
      issue('媒体槽位不能绑定凭据或端点');
    if (slot.required !== (slot.onMissing === 'error')) issue('媒体是否必填须与缺失策略一致');
    if (slot.onMissing === 'disconnect') {
      const loader = Object.hasOwn(graph, slot.node) ? graph[slot.node] : undefined;
      const downstream = imageDisconnectTargets(graph, slot.node);
      if (
        slot.mediaType !== 'image' ||
        slot.role !== 'reference' ||
        slot.input !== 'image' ||
        loader?.class_type !== 'LoadImage' ||
        Object.keys(loader.inputs).length !== 1 ||
        primary.node === slot.node ||
        schema.outputs.some((item) => item.node === slot.node) ||
        !downstream.length ||
        downstream.some((target) => target.output !== 0) ||
        occupied.some((target) => target.node === slot.node && target.input !== slot.input) ||
        schema.inputs.some((item) => item.id !== slot.id && item.node === slot.node)
      )
        issue('可选参考图须使用专用 LoadImage，且所有下游连接须为可断开的图片输入');
    }
    if (['last_frame', 'mask'].includes(slot.role) && slot.mediaType !== 'image')
      issue('尾帧与遮罩用途需要图片');
  }
  const targets = new Set([`${primary.node}:${primary.field}`]);
  for (const slot of schema.outputs) {
    if (!Object.hasOwn(graph, slot.node)) issue('媒体输出节点不存在');
    const key = `${slot.node}:${slot.field}`;
    if (targets.has(key)) issue('媒体输出不能重复或覆盖原主输出');
    targets.add(key);
  }
}

export function mediaInputMatchesMetadata(mediaType: string, definition: unknown) {
  if (!Array.isArray(definition)) return false;
  const [type, raw] = definition;
  const flags = record(raw);
  const options = type === 'COMBO' ? flags.options : type;
  return (
    flags[`${mediaType}_upload`] === true &&
    (type === 'STRING' ||
      (Array.isArray(options) && options.every((item: unknown) => typeof item === 'string')))
  );
}
export function hasExtendedMedia(schema?: WorkflowMediaSchema) {
  return Boolean(schema?.inputs.length || schema?.outputs.length);
}
export const mediaExecutionReason = '此工作流包含未支持的可选媒体策略或扩展输出，当前执行尚未接通。';
export function supportsReferenceMedia(schema?: WorkflowMediaSchema) {
  return Boolean(
    schema?.inputs.length &&
    !schema.outputs.length &&
    schema.inputs.every(
      (slot) => slot.required || (slot.mediaType === 'image' && slot.onMissing === 'disconnect'),
    ),
  );
}
export function assertMediaExecutable(schema?: WorkflowMediaSchema, projectReferences = false) {
  if (!hasExtendedMedia(schema)) return;
  if (!supportsReferenceMedia(schema)) fail(409, 'WORKFLOW_MEDIA_UNSUPPORTED', mediaExecutionReason);
  if (!projectReferences) fail(409, 'WORKFLOW_MEDIA_UNSUPPORTED', '请在项目创作入口使用扩展参考素材工作流。');
}
export function publicMediaSchema(schema?: WorkflowMediaSchema) {
  return {
    inputs: (schema?.inputs ?? []).map(({ node: _node, input: _input, ...slot }) => slot),
    outputs: (schema?.outputs ?? []).map(({ node: _node, field: _field, ...slot }) => slot),
  };
}
