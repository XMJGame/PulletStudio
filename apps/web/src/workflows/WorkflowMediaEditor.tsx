import type {
  WorkflowMediaSchema,
  WorkflowMediaInput,
  WorkflowMediaOutput,
} from '../../../../packages/contracts/src/workflow';
import type { WorkflowGraph } from './workflow-graph';
import { StudioButton } from '../shared/ui/StudioUI';

const mediaLabels = { image: '图片', video: '视频', audio: '音频' };
const roleLabels = { reference: '参考素材', last_frame: '尾帧', source: '源素材', mask: '遮罩' };
const empty = (): WorkflowMediaSchema => ({ version: 'studio.workflow-media.v1', inputs: [], outputs: [] });
export function WorkflowMediaEditor({
  value,
  graph,
  change,
}: {
  value?: WorkflowMediaSchema;
  graph?: WorkflowGraph;
  change: (schema: WorkflowMediaSchema) => void;
}) {
  const schema = value ?? empty();
  function updateInput(id: string, patch: Partial<WorkflowMediaInput>) {
    change({
      ...schema,
      inputs: schema.inputs.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)),
    });
  }
  function updateOutput(id: string, patch: Partial<WorkflowMediaOutput>) {
    change({
      ...schema,
      outputs: schema.outputs.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)),
    });
  }
  function move(kind: 'inputs' | 'outputs', index: number, delta: number) {
    const rows = [...schema[kind]];
    [rows[index], rows[index + delta]] = [rows[index + delta], rows[index]];
    change({ ...schema, [kind]: rows });
  }
  const nodes = Object.entries(graph ?? {});
  return (
    <details className="workflow-media-editor" open={Boolean(schema.inputs.length || schema.outputs.length)}>
      <summary>扩展媒体声明</summary>
      <p className="field-hint">
        必填图片槽位可在自由生成和试跑中使用。可选媒体、视频、音频和扩展输出目前只支持配置。原首帧与主输出沿用上方绑定。
      </p>
      <div className="workflow-media-toolbar">
        <StudioButton
          disabled={schema.inputs.length >= 32}
          onClick={() =>
            change({
              ...schema,
              inputs: [
                ...schema.inputs,
                {
                  id: crypto.randomUUID(),
                  label: `参考素材 ${schema.inputs.length + 1}`,
                  mediaType: 'image',
                  role: 'reference',
                  node: '',
                  input: '',
                  required: true,
                  onMissing: 'error',
                },
              ],
            })
          }
        >
          添加媒体输入
        </StudioButton>
        <StudioButton
          disabled={schema.outputs.length >= 16}
          onClick={() =>
            change({
              ...schema,
              outputs: [
                ...schema.outputs,
                {
                  id: crypto.randomUUID(),
                  label: `预览结果 ${schema.outputs.length + 1}`,
                  mediaType: 'image',
                  role: 'preview',
                  node: '',
                  field: 'images',
                  multiple: false,
                },
              ],
            })
          }
        >
          添加媒体输出
        </StudioButton>
      </div>
      {schema.inputs.map((slot, index) => (
        <fieldset className="workflow-media-slot" key={slot.id}>
          <legend>媒体输入 {index + 1}</legend>
          <div className="v2-workflow-columns">
            <label>
              名称
              <input
                aria-label={`媒体输入${index + 1}名称`}
                required
                maxLength={120}
                value={slot.label}
                onChange={(e) => updateInput(slot.id, { label: e.target.value })}
              />
            </label>
            <label>
              媒体类型
              <select
                aria-label={`媒体输入${index + 1}类型`}
                value={slot.mediaType}
                onChange={(e) =>
                  updateInput(slot.id, {
                    mediaType: e.target.value as WorkflowMediaInput['mediaType'],
                    ...(e.target.value !== 'image' && ['last_frame', 'mask'].includes(slot.role)
                      ? { role: 'reference' }
                      : {}),
                  })
                }
              >
                {Object.entries(mediaLabels).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              用途
              <select
                aria-label={`媒体输入${index + 1}用途`}
                value={slot.role}
                onChange={(e) => updateInput(slot.id, { role: e.target.value as WorkflowMediaInput['role'] })}
              >
                {Object.entries(roleLabels)
                  .filter(([id]) => slot.mediaType === 'image' || !['last_frame', 'mask'].includes(id))
                  .map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              节点
              <select
                aria-label={`媒体输入${index + 1}节点`}
                required
                value={slot.node}
                onChange={(e) => updateInput(slot.id, { node: e.target.value, input: '' })}
              >
                <option value="">选择节点</option>
                {slot.node && !graph?.[slot.node] && <option value={slot.node}>所选节点不存在</option>}
                {nodes.map(([id, node]) => (
                  <option key={id} value={id}>
                    #{id} · {node.class_type}
                  </option>
                ))}
              </select>
            </label>
            <label>
              文件输入
              <select
                aria-label={`媒体输入${index + 1}字段`}
                required
                value={slot.input}
                onChange={(e) => updateInput(slot.id, { input: e.target.value })}
              >
                <option value="">选择文件输入</option>
                {slot.input && typeof graph?.[slot.node]?.inputs[slot.input] !== 'string' && (
                  <option value={slot.input}>所选输入不可用</option>
                )}
                {Object.entries(graph?.[slot.node]?.inputs ?? {})
                  .filter(([, raw]) => typeof raw === 'string')
                  .map(([id]) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              缺失处理
              <select
                aria-label={`媒体输入${index + 1}缺失处理`}
                value={slot.required ? 'required' : 'optional'}
                onChange={(e) =>
                  updateInput(slot.id, {
                    required: e.target.value === 'required',
                    onMissing: e.target.value === 'required' ? 'error' : 'empty',
                  })
                }
              >
                <option value="required">必填，缺失时报错</option>
                <option value="optional">可选，缺失时传空值</option>
              </select>
            </label>
          </div>
          <div className="workflow-media-toolbar">
            <StudioButton
              aria-label={`上移媒体输入${index + 1}`}
              disabled={index === 0}
              onClick={() => move('inputs', index, -1)}
            >
              上移
            </StudioButton>
            <StudioButton
              aria-label={`下移媒体输入${index + 1}`}
              disabled={index === schema.inputs.length - 1}
              onClick={() => move('inputs', index, 1)}
            >
              下移
            </StudioButton>
            <StudioButton
              aria-label={`移除媒体输入${index + 1}`}
              onClick={() =>
                change({ ...schema, inputs: schema.inputs.filter((item) => item.id !== slot.id) })
              }
            >
              移除
            </StudioButton>
          </div>
        </fieldset>
      ))}
      {schema.outputs.map((slot, index) => (
        <fieldset className="workflow-media-slot" key={slot.id}>
          <legend>媒体输出 {index + 1}</legend>
          <div className="v2-workflow-columns">
            <label>
              名称
              <input
                aria-label={`媒体输出${index + 1}名称`}
                required
                maxLength={120}
                value={slot.label}
                onChange={(e) => updateOutput(slot.id, { label: e.target.value })}
              />
            </label>
            <label>
              媒体类型
              <select
                aria-label={`媒体输出${index + 1}类型`}
                value={slot.mediaType}
                onChange={(e) =>
                  updateOutput(slot.id, { mediaType: e.target.value as WorkflowMediaOutput['mediaType'] })
                }
              >
                {Object.entries(mediaLabels).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              结果用途
              <select
                aria-label={`媒体输出${index + 1}用途`}
                value={slot.role}
                onChange={(e) =>
                  updateOutput(slot.id, { role: e.target.value as WorkflowMediaOutput['role'] })
                }
              >
                <option value="preview">预览</option>
                <option value="intermediate">中间结果</option>
              </select>
            </label>
            <label>
              节点
              <select
                aria-label={`媒体输出${index + 1}节点`}
                required
                value={slot.node}
                onChange={(e) => updateOutput(slot.id, { node: e.target.value })}
              >
                <option value="">选择节点</option>
                {slot.node && !graph?.[slot.node] && <option value={slot.node}>所选节点不存在</option>}
                {nodes.map(([id, node]) => (
                  <option key={id} value={id}>
                    #{id} · {node.class_type}
                  </option>
                ))}
              </select>
            </label>
            <label>
              历史输出字段
              <input
                aria-label={`媒体输出${index + 1}字段`}
                required
                maxLength={80}
                value={slot.field}
                onChange={(e) => updateOutput(slot.id, { field: e.target.value })}
              />
            </label>
            <label>
              结果数量
              <select
                aria-label={`媒体输出${index + 1}数量`}
                value={slot.multiple ? 'multiple' : 'single'}
                onChange={(e) => updateOutput(slot.id, { multiple: e.target.value === 'multiple' })}
              >
                <option value="single">单项</option>
                <option value="multiple">多项</option>
              </select>
            </label>
          </div>
          <div className="workflow-media-toolbar">
            <StudioButton
              aria-label={`上移媒体输出${index + 1}`}
              disabled={index === 0}
              onClick={() => move('outputs', index, -1)}
            >
              上移
            </StudioButton>
            <StudioButton
              aria-label={`下移媒体输出${index + 1}`}
              disabled={index === schema.outputs.length - 1}
              onClick={() => move('outputs', index, 1)}
            >
              下移
            </StudioButton>
            <StudioButton
              aria-label={`移除媒体输出${index + 1}`}
              onClick={() =>
                change({ ...schema, outputs: schema.outputs.filter((item) => item.id !== slot.id) })
              }
            >
              移除
            </StudioButton>
          </div>
        </fieldset>
      ))}
    </details>
  );
}
