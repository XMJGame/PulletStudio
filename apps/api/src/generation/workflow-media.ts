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
            onMissing: z.enum(['error', 'empty']),
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
export function validateMediaTargets(
  schema: WorkflowMediaSchema | undefined,
  graph: Record<string, { inputs: Record<string, unknown> }>,
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
    if (slot.required !== (slot.onMissing === 'error')) issue('必填媒体缺失须报错，可选媒体缺失须传空值');
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
  if (
    definition[0] !== 'STRING' &&
    !(Array.isArray(definition[0]) && definition[0].every((item: unknown) => typeof item === 'string'))
  )
    return false;
  const flags = definition[1];
  return Boolean(
    flags && typeof flags === 'object' && !Array.isArray(flags) && flags[`${mediaType}_upload`] === true,
  );
}
export function hasExtendedMedia(schema?: WorkflowMediaSchema) {
  return Boolean(schema?.inputs.length || schema?.outputs.length);
}
export const mediaExecutionReason =
  '此工作流已声明扩展媒体输入或输出，当前执行尚未接通；请选择单首帧、单产物工作流。';
export function assertMediaExecutable(schema?: WorkflowMediaSchema) {
  if (hasExtendedMedia(schema)) fail(409, 'WORKFLOW_MEDIA_UNSUPPORTED', mediaExecutionReason);
}
export function publicMediaSchema(schema?: WorkflowMediaSchema) {
  return {
    inputs: (schema?.inputs ?? []).map(({ node: _node, input: _input, ...slot }) => slot),
    outputs: (schema?.outputs ?? []).map(({ node: _node, field: _field, ...slot }) => slot),
  };
}
