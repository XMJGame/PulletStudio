import type { ExposedField, AvailableField } from '../../../../packages/contracts/src/workflow';
import type { WorkflowGraph } from './workflow-graph';
import type { WorkflowParameter, AvailableParameter } from '../components/GenerationParameters';

// UI suggestions only. The server remains responsible for node metadata and binding validation.
export function canExposeInput(input: string, value: unknown) {
  return (
    ['string', 'number', 'boolean'].includes(typeof value) &&
    !/(?:^|[_.-])(?:api[_-]?key|token|secret|password|authorization|(?:base[_-]?)?url|endpoint|host|address|(?:file[_-]?)?path|filename)(?:$|[_.-])/iu.test(
      input,
    ) &&
    !/^(?:image|audio|video|file|media)$/iu.test(input)
  );
}

export function suggestField(id: string, node: string, input: string, value: unknown): ExposedField {
  if (!canExposeInput(input, value))
    throw new Error('此输入不能公开为创作参数，请使用媒体映射或保留为内部设置。');
  const target = { id, node, input, label: input };
  if (typeof value === 'boolean') return { ...target, type: 'boolean' };
  if (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER)
    return {
      ...target,
      type: 'number',
      min: value,
      max: Math.max(100, value),
      step: Number.isInteger(value) ? 1 : 0.01,
      integer: Number.isInteger(value),
    };
  if (typeof value === 'string' && value.length <= 4000) return { ...target, type: 'text', maxLength: 4000 };
  throw new Error('输入默认值超出创作参数支持范围。');
}

export function previewFields(fields: ExposedField[], graph: WorkflowGraph): AvailableField[] {
  return fields.map((field) => {
    const raw = graph[field.node]?.inputs[field.input];
    if (!canExposeInput(field.input, raw))
      throw new Error(`${field.label || '创作参数'}须绑定可公开的常量输入。`);
    const valid =
      field.type === 'text'
        ? typeof raw === 'string' && raw.length <= field.maxLength
        : field.type === 'boolean'
          ? typeof raw === 'boolean'
          : field.type === 'enum'
            ? typeof raw === 'string' && field.options.includes(raw)
            : typeof raw === 'number' &&
              Number.isFinite(raw) &&
              raw >= field.min &&
              raw <= field.max &&
              (!field.integer || Number.isSafeInteger(raw)) &&
              field.step > 0 &&
              Math.abs((raw - field.min) / field.step - Math.round((raw - field.min) / field.step)) < 1e-7;
    if (!valid) throw new Error(`${field.label || '创作参数'}的默认值与类型、范围或选项不匹配。`);
    return { ...field, defaultValue: raw as string | number | boolean };
  });
}

export function previewParameters(
  parameters: WorkflowParameter[],
  graph: WorkflowGraph,
): AvailableParameter[] {
  return parameters.map((parameter) => {
    const value = graph[parameter.node]?.inputs[parameter.input];
    const valid =
      parameter.key === 'aspectRatio'
        ? typeof value === 'string' && parameter.options.some((option) => option.value === value)
        : typeof value === 'number' &&
          Number.isFinite(value) &&
          value >= parameter.min &&
          value <= parameter.max &&
          parameter.step > 0 &&
          (parameter.key !== 'seed' || Number.isSafeInteger(value)) &&
          Math.abs(
            (value - parameter.min) / parameter.step - Math.round((value - parameter.min) / parameter.step),
          ) < 1e-7;
    if (!valid) throw new Error('画幅、时长或随机种子的默认值与映射配置不匹配，请核对节点、范围及选项。');
    return { ...parameter, defaultValue: value as string | number };
  });
}
