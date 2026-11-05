import { createContext, memo, useCallback, useContext } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  applyNodeChanges,
  applyEdgeChanges,
  type NodeProps,
  type OnNodesChange,
  type OnEdgesChange,
  type OnConnect,
  SelectionMode,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { NodeCard } from './NodeCard';
import { LabNode } from './model';
import { EngineProps } from './engine-types';

const PortContext = createContext<EngineProps['port']>(() => undefined);
const FlowNode = memo(function FlowNode({ id, data }: NodeProps<LabNode>) {
  const port = useContext(PortContext);
  return (
    <>
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        role="button"
        tabIndex={0}
        aria-label={`${data.title} 输入`}
        onClick={() => port(id, 'in')}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.stopPropagation();
            port(id, 'in');
          }
        }}
      />
      <NodeCard data={data} />
      <Handle
        type="source"
        position={Position.Right}
        id="out"
        role="button"
        tabIndex={0}
        aria-label={`${data.title} 输出`}
        onClick={() => port(id, 'out')}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.stopPropagation();
            port(id, 'out');
          }
        }}
      />
    </>
  );
});
const nodeTypes = { lab: FlowNode };
export function FlowEngine({ board, setBoard, onSelect, connect, port, tool }: EngineProps) {
  const nodesChange: OnNodesChange<LabNode> = useCallback(
    (changes) =>
      setBoard((old) => ({
        ...old,
        nodes: applyNodeChanges(changes, old.nodes),
        edges: old.edges.filter(
          (edge) =>
            !changes.some(
              (change) =>
                change.type === 'remove' && (change.id === edge.source || change.id === edge.target),
            ),
        ),
      })),
    [setBoard],
  );
  const edgesChange: OnEdgesChange = useCallback(
    (changes) => setBoard((old) => ({ ...old, edges: applyEdgeChanges(changes, old.edges) })),
    [setBoard],
  );
  const onConnect: OnConnect = useCallback(
    (connection) => connect(connection.source, connection.target),
    [connect],
  );
  return (
    <PortContext.Provider value={port}>
      <ReactFlow<LabNode>
        nodes={board.nodes}
        edges={board.edges}
        nodeTypes={nodeTypes}
        onNodesChange={nodesChange}
        onEdgesChange={edgesChange}
        onConnect={onConnect}
        connectOnClick={false}
        onSelectionChange={({ nodes }) => onSelect(nodes.map((node) => node.id))}
        viewport={board.viewport}
        onViewportChange={(viewport) => setBoard((old) => ({ ...old, viewport }))}
        colorMode="dark"
        minZoom={0.15}
        maxZoom={2}
        selectionOnDrag={tool === 'select'}
        panOnDrag={tool === 'pan' ? true : [1, 2]}
        panActivationKeyCode="Space"
        selectionMode={SelectionMode.Partial}
        multiSelectionKeyCode="Shift"
        deleteKeyCode={['Backspace', 'Delete']}
        onlyRenderVisibleElements
        nodesFocusable
        edgesFocusable
        defaultEdgeOptions={{ style: { stroke: '#b69a6e', strokeWidth: 2 }, interactionWidth: 20 }}
        aria-label="React Flow创作画布"
      >
        <Background gap={26} size={1} color="#353b42" />
        <MiniMap nodeColor="#967f5e" pannable zoomable />
        <Controls showInteractive={false} />
      </ReactFlow>
    </PortContext.Provider>
  );
}
