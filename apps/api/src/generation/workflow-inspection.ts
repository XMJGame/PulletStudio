import type { WorkflowInput } from './generation-contract';
import type { ExposedField } from './workflow-fields';
import {
  mediaInputMatchesMetadata,
  hasExtendedMedia,
  mediaExecutionReason,
  supportsReferenceMedia,
  mediaDisconnectTargets,
  optionalMediaInputMatchesMetadata,
} from './workflow-media';
const record = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};
function optionalMediaDeclaration(key: string, metadata: unknown) {
  const type = ['IMAGE', 'VIDEO', 'AUDIO'].find((type) =>
    optionalMediaInputMatchesMetadata(key, metadata, type),
  );
  return type ? [type] : undefined;
}
export function metadataOptions(definition: unknown): unknown[] | undefined {
  if (!Array.isArray(definition)) return undefined;
  const choices = Array.isArray(definition[0])
    ? definition[0]
    : definition[0] === 'COMBO'
      ? record(definition[1]).options
      : undefined;
  return Array.isArray(choices) &&
    choices.length > 0 &&
    choices.every((value) => ['string', 'number', 'boolean'].includes(typeof value))
    ? choices
    : undefined;
}
export function fieldMatchesMetadata(field: ExposedField, definition: unknown) {
  if (!Array.isArray(definition)) return false;
  const [type, raw] = definition,
    limits = record(raw);
  if (
    limits.image_upload === true ||
    limits.video_upload === true ||
    limits.audio_upload === true ||
    limits.file_upload === true
  )
    return false;
  if (field.type === 'text')
    return (
      type === 'STRING' && (typeof limits.max_length !== 'number' || field.maxLength <= limits.max_length)
    );
  if (field.type === 'boolean') return type === 'BOOLEAN';
  if (field.type === 'enum')
    return (
      type === 'STRING' ||
      Boolean(
        metadataOptions(definition) &&
        field.options.every((value) => metadataOptions(definition)!.includes(value)),
      )
    );
  return (
    ['INT', 'FLOAT'].includes(type) &&
    (type !== 'INT' || field.integer) &&
    (typeof limits.min !== 'number' || field.min >= limits.min) &&
    (typeof limits.max !== 'number' || field.max <= limits.max)
  );
}
type Issue = { input?: string; code: string; severity: 'error' | 'unknown' };
export type DependencyReport = {
  checkedAt: string;
  status: 'compatible' | 'incompatible' | 'unverified';
  nodes: {
    id: string;
    classType: string;
    status: 'compatible' | 'incompatible' | 'unverified';
    issues: Issue[];
  }[];
  note: string;
};
export async function inspectWorkflow(
  workflow: WorkflowInput,
  read: (type: string, signal: AbortSignal) => Promise<Record<string, any>>,
): Promise<DependencyReport> {
  const signal = AbortSignal.timeout(15000),
    definitions = new Map<string, Record<string, any> | null>();
  let bytes = 0;
  for (const type of new Set(Object.values(workflow.graph).map((node) => node.class_type))) {
    if (definitions.size >= 64 || bytes > 8 * 1024 * 1024 || signal.aborted) {
      definitions.set(type, null);
      continue;
    }
    try {
      const info = await read(type, signal);
      bytes += Buffer.byteLength(JSON.stringify(info));
      definitions.set(type, bytes > 8 * 1024 * 1024 ? null : info);
    } catch {
      definitions.set(type, null);
    }
  }
  const incoming = new Map(Object.keys(workflow.graph).map((id) => [id, 0])),
    outgoing = new Map(Object.keys(workflow.graph).map((id) => [id, [] as string[]]));
  for (const [id, node] of Object.entries(workflow.graph))
    for (const value of Object.values(node.inputs))
      if (
        Array.isArray(value) &&
        value.length === 2 &&
        typeof value[0] === 'string' &&
        typeof value[1] === 'number' &&
        Number.isInteger(value[1]) &&
        Object.hasOwn(workflow.graph, value[0])
      ) {
        incoming.set(id, incoming.get(id)! + 1);
        outgoing.get(value[0])!.push(id);
      }
  const ready = [...incoming.keys()].filter((id) => incoming.get(id) === 0),
    visited = new Set<string>();
  for (let index = 0; index < ready.length; index++) {
    const id = ready[index];
    visited.add(id);
    for (const target of outgoing.get(id)!) {
      incoming.set(target, incoming.get(target)! - 1);
      if (incoming.get(target) === 0) ready.push(target);
    }
  }
  const disconnectTargets = (workflow.mediaSchema?.inputs ?? [])
    .filter((slot) => slot.onMissing === 'disconnect')
    .flatMap((slot) =>
      mediaDisconnectTargets(workflow.graph, slot.node).map((target) => ({
        ...target,
        mediaType: slot.mediaType,
      })),
    );
  const nodes: DependencyReport['nodes'] = Object.entries(workflow.graph).map(([id, node]) => {
    const issues: Issue[] = [],
      info = definitions.get(node.class_type);
    let errors = false,
      unknown = false;
    const add = (code: string, input?: string, severity: Issue['severity'] = 'error') => {
      if (severity === 'error') errors = true;
      else unknown = true;
      if (issues.length < 20) issues.push({ code, input, severity });
    };
    if (!visited.has(id)) add('GRAPH_CYCLE');
    if (!info) add('NODE_UNVERIFIED', undefined, 'unknown');
    else if (!Object.keys(info).length) add('NODE_MISSING');
    else {
      const inputs = record(info.input),
        required = record(inputs.required),
        optional = record(inputs.optional);
      for (const field of workflow.fields ?? [])
        if (field.node === id && !fieldMatchesMetadata(field, required[field.input] ?? optional[field.input]))
          add('FIELD_SCHEMA_MISMATCH', field.input);
      for (const slot of workflow.mediaSchema?.inputs ?? [])
        if (
          slot.node === id &&
          !mediaInputMatchesMetadata(slot.mediaType, required[slot.input] ?? optional[slot.input])
        )
          add('MEDIA_SCHEMA_MISMATCH', slot.input);
      for (const slot of workflow.mediaSchema?.inputs ?? []) {
        if (
          slot.onMissing === 'disconnect' &&
          slot.node === id &&
          (info.output_node === true ||
            !Array.isArray(info.output) ||
            info.output[0] !== slot.mediaType.toUpperCase())
        )
          add('MEDIA_DISCONNECT_INVALID', slot.input);
      }
      for (const target of disconnectTargets)
        if (
          target.node === id &&
          !optionalMediaInputMatchesMetadata(target.input, info.input, target.mediaType)
        )
          add('MEDIA_DISCONNECT_INVALID', target.input);
      if (workflow.mediaSchema?.outputs.some((slot) => slot.node === id) && info.output_node !== true)
        add('MEDIA_OUTPUT_MISMATCH');
      for (const input of Object.keys(required))
        if (!Object.hasOwn(node.inputs, input)) add('REQUIRED_INPUT_MISSING', input);
      for (const [input, value] of Object.entries(node.inputs)) {
        const declaration = required[input] ?? optional[input] ?? optionalMediaDeclaration(input, info.input);
        if (!Array.isArray(declaration)) {
          add('INPUT_UNDECLARED', input, 'unknown');
          continue;
        }
        const [type, raw] = declaration,
          limits = record(raw);
        if (
          Array.isArray(value) &&
          value.length === 2 &&
          typeof value[0] === 'string' &&
          typeof value[1] === 'number' &&
          Number.isInteger(value[1])
        ) {
          const source = Object.hasOwn(workflow.graph, value[0]) ? workflow.graph[value[0]] : undefined;
          if (!source || Number(value[1]) < 0) {
            add('LINK_SOURCE_MISSING', input);
            continue;
          }
          const output = definitions.get(source.class_type)?.output;
          if (!Array.isArray(output)) {
            add('OUTPUT_TYPE_UNVERIFIED', input, 'unknown');
            continue;
          }
          if (!Object.hasOwn(output, value[1])) {
            add('OUTPUT_SLOT_MISSING', input);
            continue;
          }
          if (
            typeof type !== 'string' ||
            typeof output[value[1]] !== 'string' ||
            type.includes(',') ||
            output[value[1]].includes(',')
          )
            add('LINK_TYPE_UNVERIFIED', input, 'unknown');
          else if (type !== '*' && output[value[1]] !== '*' && type !== output[value[1]])
            add('LINK_TYPE_MISMATCH', input);
          continue;
        }
        if (
          (workflow.image?.node === id && workflow.image.input === input) ||
          limits.image_upload === true ||
          workflow.mediaSchema?.inputs.some((slot) => slot.node === id && slot.input === input)
        )
          continue; // Uploaded fixed media is validated separately, not a remote file-existence claim.
        const choices = metadataOptions(declaration);
        if (choices) {
          if (!choices.some((option) => JSON.stringify(option) === JSON.stringify(value)))
            add('OPTION_UNAVAILABLE', input);
        } else if (type === 'STRING') {
          if (typeof value !== 'string') add('VALUE_TYPE_MISMATCH', input);
        } else if (type === 'BOOLEAN') {
          if (typeof value !== 'boolean') add('VALUE_TYPE_MISMATCH', input);
        } else if (type === 'INT' || type === 'FLOAT') {
          if (
            typeof value !== 'number' ||
            !Number.isFinite(value) ||
            (type === 'INT' && !Number.isSafeInteger(value))
          )
            add('VALUE_TYPE_MISMATCH', input);
          else if (
            (typeof limits.min === 'number' && value < limits.min) ||
            (typeof limits.max === 'number' && value > limits.max)
          )
            add('VALUE_RANGE_MISMATCH', input);
        } else add('CUSTOM_INPUT_UNVERIFIED', input, 'unknown');
      }
    }
    return {
      id,
      classType: node.class_type,
      issues,
      status: errors ? 'incompatible' : unknown ? 'unverified' : 'compatible',
    };
  });
  return {
    checkedAt: new Date().toISOString(),
    nodes,
    status: nodes.some((node) => node.status === 'incompatible')
      ? 'incompatible'
      : nodes.some((node) => node.status === 'unverified')
        ? 'unverified'
        : 'compatible',
    note: `${hasExtendedMedia(workflow.mediaSchema) && !supportsReferenceMedia(workflow.mediaSchema) ? `${mediaExecutionReason} ` : ''}仅检查当前节点声明、输入类型/连接及枚举选项；不代表权重文件完整、显存充足或真实运行成功。上传媒体由正式媒体流程验证。`,
  };
}
