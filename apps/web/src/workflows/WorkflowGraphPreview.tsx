import { useMemo, useState } from 'react';
import { Background, Controls, MiniMap, Position, ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { isWorkflowLink, workflowDiagram, type WorkflowGraph } from './workflow-graph';
import './workflow-center.css';
type Bind = 'positive' | 'negative' | 'image' | 'output';
export default function WorkflowGraphPreview({
  graph,
  bindings,
  capability,
  onBind,
  disabled,
  theme,
}: {
  graph: WorkflowGraph;
  bindings: Record<string, string>;
  capability: string;
  disabled: boolean;
  theme: 'light' | 'dark';
  onBind: (role: Bind, node: string, input?: string) => void;
}) {
  const [selected, setSelected] = useState('');
  const [input, setInput] = useState('');
  const analysis = useMemo(() => {
    try {
      return { value: workflowDiagram(graph), error: '' };
    } catch (reason) {
      return { value: null, error: reason instanceof Error ? reason.message : '无法预览此图' };
    }
  }, [graph]);
  const model = analysis.value;
  const nodes = useMemo(
    () =>
      (model?.nodes ?? []).map((node) => ({
        id: node.id,
        ariaLabel: `${node.classType} 节点 ${node.id}`,
        position: node.position,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        width: 230,
        height: 90,
        measured: { width: 230, height: 90 },
        style: { width: 230, height: 90 },
        selected: node.id === selected,
        data: {
          label: (
            <span className="workflow-graph-card">
              <strong>{node.classType}</strong>
              <small>
                #{node.id} · {Object.keys(graph[node.id].inputs).length}个输入
              </small>
              <small>
                {[
                  ['positiveNode', '正向词'],
                  ['negativeNode', '负向词'],
                  ['imageNode', '首帧'],
                  ['outputNode', '输出'],
                ]
                  .filter(([key]) => bindings[key] === node.id)
                  .map(([, label]) => label)
                  .join(' · ')}
              </small>
            </span>
          ),
        },
      })),
    [model, selected, graph, bindings],
  );
  const edges = useMemo(
    () =>
      (model?.links ?? []).map((link) => ({
        id: link.id,
        source: link.source,
        target: link.target,
        label: `${link.output} → ${link.input}`,
        selectable: false,
      })),
    [model],
  );
  const current = Object.hasOwn(graph, selected) ? graph[selected] : undefined;
  const inputs = Object.entries(current?.inputs ?? {})
    .filter(([, value]) => !isWorkflowLink(value))
    .slice(0, 100);
  const text = current && Object.hasOwn(current.inputs, input) && typeof current.inputs[input] === 'string';
  return (
    <section className="workflow-graph-preview" aria-label="API工作流技术预览">
      <p className="field-hint">选择节点查看输入并设置映射。技术图保留导入时的节点和连线。</p>
      {analysis.error && (
        <p role="alert" className="notice error">
          {analysis.error}
        </p>
      )}
      {!!model?.warnings.length && (
        <div role="status" className="notice error">
          {model.warnings.map((warning, index) => (
            <p key={index}>{warning}</p>
          ))}
        </div>
      )}
      {model && (
        <>
          <p>
            {model.nodes.length}节点 · {model.links.length}连接
          </p>
          <label>
            选择工作流节点
            <select
              aria-label="选择工作流节点"
              value={current ? selected : ''}
              onChange={(event) => {
                setSelected(event.target.value);
                setInput('');
              }}
            >
              <option value="">从图上或列表选择节点</option>
              {model.nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.classType} · #{node.id}
                </option>
              ))}
            </select>
          </label>
          <div className="workflow-technical-surface">
            <ReactFlow
              key={model.nodes.map((node) => node.id).join('|')}
              nodes={nodes}
              edges={edges}
              nodesDraggable={false}
              nodesConnectable={false}
              edgesFocusable={false}
              deleteKeyCode={null}
              fitView
              minZoom={0.12}
              maxZoom={2}
              colorMode={theme}
              onNodeClick={(_, node) => {
                setSelected(node.id);
                setInput('');
              }}
            >
              <Background />
              <MiniMap />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
        </>
      )}
      {current && (
        <div className="workflow-node-inspector" aria-label="工作流节点映射">
          <h4>
            {current.class_type} · #{selected}
          </h4>
          <p className="field-hint">
            仅列字段名/类型，不展示可能含凭据或路径的常量。保存时由服务端核对真实节点能力。
          </p>
          <label>
            节点常量输入
            <select
              aria-label="节点常量输入"
              disabled={disabled}
              value={input}
              onChange={(event) => setInput(event.target.value)}
            >
              <option value="">选择输入字段</option>
              {inputs.map(([key, value]) => (
                <option key={key} value={key}>
                  {key} ·{' '}
                  {Array.isArray(value)
                    ? '数组'
                    : value === null
                      ? '空值'
                      : typeof value === 'object'
                        ? '对象'
                        : typeof value === 'string'
                          ? '文本'
                          : typeof value === 'number'
                            ? '数值'
                            : '开关'}
                </option>
              ))}
            </select>
          </label>
          <div className="workflow-map-actions">
            <button
              type="button"
              disabled={disabled || !text}
              onClick={() => onBind('positive', selected, input)}
            >
              设为正向文本
            </button>
            <button
              type="button"
              disabled={disabled || !text}
              onClick={() => onBind('negative', selected, input)}
            >
              设为负向文本
            </button>
            {capability === 'video.image_to_video' && (
              <button
                type="button"
                disabled={disabled || !text}
                onClick={() => onBind('image', selected, input)}
              >
                设为首帧图片
              </button>
            )}
            <button type="button" disabled={disabled} onClick={() => onBind('output', selected)}>
              设为输出节点
            </button>
          </div>
        </div>
      )}
      {model && !current && (
        <div className="workflow-node-inspector workflow-node-empty">
          <h4>节点映射</h4>
          <p className="field-hint">从图上选择节点，或用上方列表定位。</p>
        </div>
      )}
    </section>
  );
}
