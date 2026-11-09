import { useMemo, useRef, useState } from 'react';
import { Background, Controls, MiniMap, Position, ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { isWorkflowLink, workflowDiagram, type WorkflowGraph } from './workflow-graph';
import './workflow-center.css';
import { canExposeInput } from './workflow-draft';
import type { WorkflowMediaType } from '../../../../packages/contracts/src/workflow';
type Bind = 'positive' | 'negative' | 'image' | 'output';
export default function WorkflowGraphPreview({
  graph,
  bindings,
  capability,
  onBind,
  disabled,
  theme,
  onExpose,
  onMedia,
  mappedTargets = [],
}: {
  graph: WorkflowGraph;
  bindings: Record<string, string>;
  capability: string;
  disabled: boolean;
  theme: 'light' | 'dark';
  onBind: (role: Bind, node: string, input?: string) => void;
  onExpose?: (node: string, input: string) => void;
  onMedia?: (node: string, input: string, type: WorkflowMediaType) => void;
  mappedTargets?: { node: string; label: string; input?: string }[];
}) {
  const [selected, setSelected] = useState('');
  const [input, setInput] = useState('');
  const [mediaType, setMediaType] = useState<WorkflowMediaType>('image');
  const focusNode = useRef<(id: string) => void>(() => {});
  const mappings = useMemo(
    () =>
      [
        ...[
          ['positive', '正向词'],
          ['negative', '负向词'],
          ...(capability === 'video.image_to_video' ? [['image', '首帧']] : []),
          ['output', '主输出'],
        ]
          .filter(([key]) => bindings[key + 'Node'])
          .map(([key, label]) => ({
            node: bindings[key + 'Node'],
            input: bindings[key + (key === 'output' ? 'Field' : 'Input')],
            label,
          })),
        ...mappedTargets,
      ].filter((item) => item.node),
    [bindings, capability, mappedTargets],
  );
  function choose(id: string, focus = true) {
    setSelected(id);
    setInput('');
    if (focus) focusNode.current(id);
  }
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
        height: 108,
        measured: { width: 230, height: 108 },
        className: mappings.some((item) => item.node === node.id) ? 'workflow-node-mapped' : undefined,
        style: { width: 230, height: 108 },
        selected: node.id === selected,
        data: {
          label: (
            <span className="workflow-graph-card">
              <strong>{node.classType}</strong>
              <small>
                #{node.id} · {Object.keys(graph[node.id].inputs).length}个输入
              </small>
              {mappings.some((item) => item.node === node.id) ? (
                <span
                  className="workflow-mapping-badge"
                  title={mappings
                    .filter((item) => item.node === node.id)
                    .map((item) => `${item.label} → ${item.input ?? ''}`)
                    .join('\n')}
                >
                  已映射 {mappings.filter((item) => item.node === node.id).length} 项
                </span>
              ) : (
                <small className="workflow-node-unmapped">未映射</small>
              )}
              <small className="workflow-node-mapping-labels">
                {mappings
                  .filter((item) => item.node === node.id)
                  .map((item) => item.label)
                  .join(' · ')}
              </small>
            </span>
          ),
        },
      })),
    [model, selected, graph, mappings],
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
            {model.nodes.length} 节点 · {model.links.length} 连接 ·{' '}
            {new Set(mappings.map((item) => item.node)).size} 个节点已映射
          </p>
          <details className="workflow-mapping-index">
            <summary>映射清单 · {mappings.length} 项（点击定位）</summary>
            <div>
              {mappings.map((item, index) => (
                <button
                  key={`${item.node}:${item.input}:${index}`}
                  type="button"
                  disabled={!Object.hasOwn(graph, item.node)}
                  onClick={() => choose(item.node)}
                >
                  <strong>{item.label}</strong>
                  <span>
                    #{item.node}
                    {item.input ? ` · ${item.input}` : ''}
                  </span>
                </button>
              ))}
            </div>
          </details>
          <label>
            选择工作流节点
            <select
              aria-label="选择工作流节点"
              value={current ? selected : ''}
              onChange={(event) => {
                choose(event.target.value);
              }}
            >
              <option value="">从图上或列表选择节点</option>
              {model.nodes.map((node) => (
                <option key={node.id} value={node.id}>
                  {node.classType} · #{node.id}
                  {mappings.some((item) => item.node === node.id) ? ' · 已映射' : ''}
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
              onInit={(flow) => {
                focusNode.current = (id) => {
                  void flow.fitView({ nodes: [{ id }], maxZoom: 1.1, padding: 0.5, duration: 200 });
                };
              }}
              onNodeClick={(_, node) => {
                choose(node.id, false);
              }}
            >
              <Background color="var(--dot)" />
              <MiniMap nodeColor="var(--mini-node)" maskColor="var(--ground)" />
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
          <div className="workflow-current-mappings" aria-label="当前节点已映射">
            {mappings.filter((item) => item.node === selected).length ? (
              mappings
                .filter((item) => item.node === selected)
                .map((item, index) => (
                  <p key={index}>
                    <strong>{item.label}</strong>
                    <span>{item.input ?? '输出节点'}</span>
                  </p>
                ))
            ) : (
              <p className="field-hint">此节点尚未映射。</p>
            )}
          </div>
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
          {onExpose && (
            <button
              type="button"
              disabled={disabled || !input || !canExposeInput(input, current.inputs[input])}
              onClick={() => onExpose(selected, input)}
            >
              公开为创作参数
            </button>
          )}
          {onMedia && (
            <div className="workflow-map-actions">
              <label>
                素材类型
                <select
                  aria-label="节点映射素材类型"
                  value={mediaType}
                  onChange={(event) => setMediaType(event.target.value as WorkflowMediaType)}
                  disabled={disabled}
                >
                  <option value="image">图片</option>
                  <option value="video">视频</option>
                  <option value="audio">音频</option>
                </select>
              </label>
              <button
                type="button"
                disabled={disabled || !text}
                onClick={() => onMedia(selected, input, mediaType)}
              >
                添加媒体映射
              </button>
            </div>
          )}
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
