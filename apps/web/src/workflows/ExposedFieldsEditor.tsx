import type { ExposedField, FieldSpec } from '../../../../packages/contracts/src/workflow';
import type { WorkflowGraph } from './workflow-graph';
import { isWorkflowLink } from './workflow-graph';
export function ExposedFieldsEditor({
  fields,
  graph,
  change,
}: {
  fields: ExposedField[];
  graph?: WorkflowGraph;
  change: (fields: ExposedField[]) => void;
}) {
  function update(index: number, patch: Partial<ExposedField>) {
    change(
      fields.map((field, position) =>
        position === index ? ({ ...field, ...patch } as ExposedField) : field,
      ),
    );
  }
  function type(index: number, value: FieldSpec['type']) {
    const field = fields[index],
      raw = graph?.[field.node]?.inputs[field.input];
    const common = { id: field.id, label: field.label, node: field.node, input: field.input };
    const spec: FieldSpec =
      value === 'number'
        ? {
            type: value,
            integer: Number.isInteger(raw),
            min: 0,
            max: Math.max(100, Number(raw) || 0),
            step: 1,
          }
        : value === 'enum'
          ? { type: value, options: typeof raw === 'string' ? [raw, ''] : ['', ''] }
          : value === 'boolean'
            ? { type: value }
            : { type: value, maxLength: 4000 };
    change(fields.map((item, position) => (position === index ? { ...common, ...spec } : item)));
  }
  return (
    <details className="exposed-fields">
      <summary>公开创作参数（{fields.length}/20）</summary>
      <p className="field-hint">
        管理员选择现有常量并声明类型/范围，创作者只填写命名后的参数。默认值取自图，保存时核对节点声明；不公开凭据、地址或路径。
      </p>
      {fields.map((field, index) => (
        <fieldset className="workflow-field-editor" key={field.id}>
          <legend>创作参数 {index + 1}</legend>
          <label>
            参数名称
            <input
              aria-label={`参数${index + 1}名称`}
              required
              maxLength={120}
              value={field.label}
              onChange={(event) => update(index, { label: event.target.value })}
            />
          </label>
          <div className="dialog-field-row">
            <label>
              来源节点
              <select
                aria-label={`参数${index + 1}节点`}
                required
                value={field.node}
                onChange={(event) => update(index, { node: event.target.value, input: '' })}
              >
                <option value="">选择节点</option>
                {Object.entries(graph ?? {}).map(([id, node]) => (
                  <option key={id} value={id}>
                    #{id} · {node.class_type}
                  </option>
                ))}
              </select>
            </label>
            <label>
              常量输入
              <select
                aria-label={`参数${index + 1}输入`}
                required
                value={field.input}
                onChange={(event) => update(index, { input: event.target.value })}
              >
                <option value="">选择输入</option>
                {Object.entries(graph?.[field.node]?.inputs ?? {})
                  .filter(
                    ([, value]) =>
                      !isWorkflowLink(value) && ['string', 'number', 'boolean'].includes(typeof value),
                  )
                  .map(([key]) => (
                    <option key={key} value={key}>
                      {key}
                    </option>
                  ))}
              </select>
            </label>
          </div>
          <label>
            字段类型
            <select
              aria-label={`参数${index + 1}类型`}
              value={field.type}
              onChange={(event) => type(index, event.target.value as FieldSpec['type'])}
            >
              <option value="text">文本</option>
              <option value="number">数值</option>
              <option value="boolean">开关</option>
              <option value="enum">枚举选项</option>
            </select>
          </label>
          {field.type === 'text' && (
            <label>
              最多字符数
              <input
                aria-label={`参数${index + 1}字符上限`}
                type="number"
                required
                min={1}
                max={4000}
                value={field.maxLength}
                onChange={(event) => update(index, { maxLength: Number(event.target.value) })}
              />
            </label>
          )}
          {field.type === 'number' && (
            <>
              <div className="dialog-field-row">
                {(['min', 'max', 'step'] as const).map((key, position) => (
                  <label key={key}>
                    {['最小值', '最大值', '步长'][position]}
                    <input
                      aria-label={`参数${index + 1}${['最小值', '最大值', '步长'][position]}`}
                      type="number"
                      required
                      step="any"
                      value={field[key]}
                      onChange={(event) => update(index, { [key]: Number(event.target.value) })}
                    />
                  </label>
                ))}
              </div>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={field.integer}
                  onChange={(event) => update(index, { integer: event.target.checked })}
                />
                仅整数
              </label>
            </>
          )}
          {field.type === 'enum' && (
            <label>
              可选实际值（每行一个）
              <textarea
                aria-label={`参数${index + 1}选项`}
                rows={3}
                required
                value={field.options.join('\n')}
                onChange={(event) => update(index, { options: event.target.value.split('\n') })}
              />
            </label>
          )}
          <button type="button" onClick={() => change(fields.filter((_, position) => position !== index))}>
            移除参数 {index + 1}
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        disabled={fields.length >= 20}
        onClick={() =>
          change([
            ...fields,
            { id: crypto.randomUUID(), label: '', node: '', input: '', type: 'text', maxLength: 4000 },
          ])
        }
      >
        添加创作参数
      </button>
    </details>
  );
}
