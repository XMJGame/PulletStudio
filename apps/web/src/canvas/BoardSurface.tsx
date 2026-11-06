import { memo, useEffect, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  SelectionMode,
  type NodeProps,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  type Edge,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { CanvasNode, kindLabels, statusLabels } from './board-types';
import { boardResourceDrag } from './BoardSources';
const BoardCard = memo(function BoardCard({ data }: NodeProps<CanvasNode>) {
  const { domain, value } = data;
  const [broken, setBroken] = useState(false);
  const poster = value?.media?.mediaType === 'image' ? value.media.contentUrl : value?.media?.posterUrl;
  useEffect(() => setBroken(false), [poster]);
  if (domain.type === 'group')
    return (
      <div className="creative-group-card">
        <strong>{domain.data.label}</strong>
        <small>{domain.data.collapsed ? '已折叠' : '创作分组'}</small>
      </div>
    );
  return (
    <article
      className={`creative-node ${poster && !broken ? 'creative-node-media' : ''} ${value?.status === 'unavailable' ? 'unavailable' : ''}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        aria-label={`${value?.title ?? kindLabels[domain.type]} 输入`}
      />
      <span className="creative-node-kind">{kindLabels[value?.kind ?? domain.type] ?? '业务引用'}</span>
      <strong>
        {domain.type === 'reference' || domain.type === 'result'
          ? (value?.title ?? '正在读取引用…')
          : kindLabels[domain.type]}
      </strong>
      {domain.type === 'reference' || domain.type === 'result' ? (
        <>
          {poster && !broken && (
            <img
              src={poster}
              alt={value?.title}
              draggable={false}
              loading="lazy"
              onError={() => setBroken(true)}
            />
          )}
          {broken && <p className="creative-resource-error">媒体无法读取，请检查文件或权限</p>}
          {!poster && (
            <p className="creative-node-summary">
              {value?.summary || (value?.status === 'unavailable' ? '资源已缺失或无权读取' : '固定业务引用')}
            </p>
          )}
          <footer>
            {value &&
              (domain.type === 'result' && value.status === 'draft'
                ? '尚未完成'
                : statusLabels[value.status])}
            {value?.version ? ` · v${value.version}` : ''}
          </footer>
        </>
      ) : domain.type === 'generation' ? (
        <p className="creative-note-text">选中后配置工作流和输入。</p>
      ) : (
        <p className="creative-note-text">{domain.data.text || '选择后在检查器填写创作内容'}</p>
      )}
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        aria-label={`${value?.title ?? kindLabels[domain.type]} 输出`}
      />
      {domain.type === 'note' && (
        <Handle
          type="source"
          position={Position.Right}
          id="text"
          style={{ top: '75%' }}
          aria-label="提示词 TEXT 输出"
        />
      )}
      {((domain.type === 'reference' && domain.data.ref?.kind === 'media') || domain.type === 'result') &&
        value?.media?.mediaType === 'image' && (
          <Handle
            type="source"
            position={Position.Right}
            id="image"
            style={{ top: '75%' }}
            aria-label="图片 IMAGE 输出"
          />
        )}
      {domain.type === 'generation' && (
        <>
          <Handle
            type="target"
            position={Position.Left}
            id="prompt"
            style={{ top: '65%' }}
            aria-label="提示词 TEXT 输入"
          />
          <span className="creative-port-label" style={{ top: '62%' }}>
            提示词 · TEXT
          </span>
          <Handle
            type="target"
            position={Position.Left}
            id="first_frame"
            style={{ top: '85%' }}
            aria-label="首帧 IMAGE 输入"
          />
          <span className="creative-port-label" style={{ top: '82%' }}>
            首帧 · IMAGE
          </span>
        </>
      )}
    </article>
  );
});
const nodeTypes = { boardNode: BoardCard };
export function BoardSurface({
  nodes,
  edges,
  viewport,
  editable,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onViewportChange,
  pan,
  theme,
  onDropResource,
  overlay,
}: {
  nodes: CanvasNode[];
  edges: Edge[];
  viewport: Viewport;
  editable: boolean;
  pan: boolean;
  theme: 'light' | 'dark';
  onDropResource: (position: { x: number; y: number }) => void;
  overlay?: React.ReactNode;
  onNodesChange: OnNodesChange<CanvasNode>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  onViewportChange: (value: Viewport) => void;
}) {
  return (
    <div className="creative-stage">
      <div
        className="creative-surface"
        aria-label="正式画布工作区"
        onDragOver={(event) => {
          if (!editable || !event.dataTransfer.types.includes(boardResourceDrag)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(event) => {
          if (!editable || !event.dataTransfer.types.includes(boardResourceDrag)) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onDropResource({
            x: (event.clientX - rect.left - viewport.x) / viewport.zoom,
            y: (event.clientY - rect.top - viewport.y) / viewport.zoom,
          });
        }}
      >
        <ReactFlow<CanvasNode>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          viewport={viewport}
          onViewportChange={onViewportChange}
          nodesDraggable={editable}
          nodesConnectable={editable}
          elementsSelectable
          nodesFocusable
          edgesFocusable
          deleteKeyCode={editable ? ['Delete', 'Backspace'] : null}
          selectionOnDrag={!pan}
          selectionMode={SelectionMode.Partial}
          panOnDrag={pan ? true : [1, 2]}
          panActivationKeyCode="Space"
          minZoom={0.15}
          maxZoom={2}
          multiSelectionKeyCode="Shift"
          onlyRenderVisibleElements
          colorMode={theme}
          defaultEdgeOptions={{
            style: { stroke: theme === 'light' ? '#738094' : '#a7aebd', strokeWidth: 2 },
          }}
        >
          <Background gap={22} size={1} color={theme === 'light' ? '#bcc7d8' : '#394454'} />
          <MiniMap nodeColor={theme === 'light' ? '#91a3bf' : '#7187a7'} pannable zoomable />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      {overlay}
    </div>
  );
}
