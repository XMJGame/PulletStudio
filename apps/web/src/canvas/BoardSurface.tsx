import { createContext, useContext, memo, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  SelectionMode,
  NodeToolbar,
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
import { BoardMediaFrame, BoardVideoPreview } from './BoardMediaFrame';
import { referenceMediaLabels } from '../workflows/workflow-types';
import type { BoardNode } from '../../../../packages/contracts/src/board';
import { mediaFileAccept } from '../media-upload';
const InlineEditing = createContext<{ editable: boolean; update: (node: BoardNode) => void }>({
  editable: false,
  update: () => {},
});
const BoardCard = memo(function BoardCard({ data, selected }: NodeProps<CanvasNode>) {
  const { domain, value } = data;
  const editing = useContext(InlineEditing);
  const media = value?.media;
  const visual = media && ['image', 'video'].includes(media.mediaType);
  if (domain.type === 'group')
    return (
      <div className="creative-group-card">
        <strong>{domain.data.label}</strong>
        <small>{domain.data.collapsed ? '已折叠' : '创作分组'}</small>
      </div>
    );
  return (
    <article
      className={`creative-node creative-node-${domain.type} ${visual ? 'creative-node-media' : ''} ${value?.status === 'unavailable' ? 'unavailable' : ''}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        aria-label={`${value?.title ?? kindLabels[domain.type]} 输入`}
      />
      {visual && <BoardMediaFrame id={domain.id} title={value.title} media={media} />}
      {domain.type !== 'note' && domain.type !== 'brief' && (
        <span className="creative-node-kind">{kindLabels[value?.kind ?? domain.type] ?? '业务引用'}</span>
      )}
      <strong>
        {domain.type === 'reference' || domain.type === 'result'
          ? (value?.title ?? '正在读取引用…')
          : domain.type === 'note'
            ? '便签'
            : domain.type === 'brief'
              ? '文字'
              : kindLabels[domain.type]}
      </strong>
      {domain.type === 'reference' || domain.type === 'result' ? (
        <>
          {!visual && (
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
        <textarea
          className="creative-inline-text nodrag nowheel nopan"
          aria-label={selected ? '画布文字内容' : domain.type === 'note' ? '便签内容' : '创作说明内容'}
          placeholder={domain.type === 'note' ? '写下想法…' : '输入创作说明…'}
          readOnly={!editing.editable}
          maxLength={domain.type === 'note' ? 16000 : 4000}
          value={domain.data.text ?? ''}
          onChange={(event) =>
            editing.update({
              ...domain,
              data: {
                ...domain.data,
                text: event.target.value,
                ...(domain.data.prompt
                  ? { prompt: { ...domain.data.prompt, promptLibraryRevisionId: undefined } }
                  : {}),
              },
            })
          }
          onKeyDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.stopPropagation()}
        />
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
        media && (
          <Handle
            type="source"
            position={Position.Right}
            id={media.mediaType}
            style={{ top: '75%' }}
            aria-label={`${referenceMediaLabels[media.mediaType]} ${media.mediaType.toUpperCase()} 输出`}
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
          <Handle
            type="target"
            position={Position.Left}
            id="references"
            style={{ top: '75%', opacity: data.hasReferenceInputs ? 1 : 0 }}
            isConnectable={false}
            aria-label="参考素材输入连线"
          />
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
  onDropFiles,
  onPreviewStart,
  overlay,
  toolbar,
  onUpdate,
  onCreate,
}: {
  nodes: CanvasNode[];
  edges: Edge[];
  viewport: Viewport;
  editable: boolean;
  pan: boolean;
  theme: 'light' | 'dark';
  onDropResource: (position: { x: number; y: number }) => void;
  onDropFiles: (files: File[], position: { x: number; y: number }) => void;
  onPreviewStart: () => void;
  overlay?: React.ReactNode;
  toolbar?: { nodeId: string; content: ReactNode };
  onUpdate: (node: BoardNode) => void;
  onCreate: (type: 'note' | 'brief' | 'generation', at: { x: number; y: number }) => void;
  onNodesChange: OnNodesChange<CanvasNode>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  onViewportChange: (value: Viewport) => void;
}) {
  const [fileDrag, setFileDrag] = useState(false);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const contextFileInput = useRef<HTMLInputElement>(null);
  const toolbarNode = nodes.find((item) => item.id === toolbar?.nodeId);
  let toolbarX = toolbarNode?.position.x ?? 0;
  let toolbarY = toolbarNode?.position.y ?? 0;
  let parentId = toolbarNode?.parentId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = nodes.find((item) => item.id === parentId);
    toolbarX += parent?.position.x ?? 0;
    toolbarY += parent?.position.y ?? 0;
    parentId = parent?.parentId;
  }
  const toolbarLeft = viewport.x + toolbarX * viewport.zoom;
  const surfaceWidth = surfaceRef.current?.clientWidth ?? window.innerWidth;
  const [active, setActive] = useState<string>();
  const [menu, setMenu] = useState<{ x: number; y: number; at: { x: number; y: number } }>();
  const videoPreview = useMemo(
    () => ({
      active,
      setActive,
      onPlay: (id: string) => {
        setActive(id);
        onPreviewStart();
      },
    }),
    [active, onPreviewStart],
  );
  return (
    <div className="creative-stage">
      <div
        className="creative-surface"
        ref={surfaceRef}
        aria-label="正式画布工作区"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Escape') setMenu(undefined);
          if (
            editable &&
            event.target === event.currentTarget &&
            (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))
          ) {
            event.preventDefault();
            setMenu({
              x: 24,
              y: 24,
              at: { x: (24 - viewport.x) / viewport.zoom, y: (24 - viewport.y) / viewport.zoom },
            });
          }
        }}
        onDragEnter={(event) => {
          if (editable && event.dataTransfer.types.includes('Files')) setFileDrag(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFileDrag(false);
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            event.dataTransfer.dropEffect = editable ? 'copy' : 'none';
            return;
          }
          if (!editable || !event.dataTransfer.types.includes(boardResourceDrag)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(event) => {
          setFileDrag(false);
          if (event.dataTransfer.types.includes('Files')) {
            event.preventDefault();
            if (!editable) return;
            const rect = event.currentTarget.getBoundingClientRect();
            onDropFiles([...event.dataTransfer.files], {
              x: (event.clientX - rect.left - viewport.x) / viewport.zoom,
              y: (event.clientY - rect.top - viewport.y) / viewport.zoom,
            });
            return;
          }
          if (!editable || !event.dataTransfer.types.includes(boardResourceDrag)) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          onDropResource({
            x: (event.clientX - rect.left - viewport.x) / viewport.zoom,
            y: (event.clientY - rect.top - viewport.y) / viewport.zoom,
          });
        }}
      >
        <InlineEditing.Provider value={{ editable, update: onUpdate }}>
          <BoardVideoPreview.Provider value={videoPreview}>
            <ReactFlow<CanvasNode>
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              viewport={viewport}
              onViewportChange={onViewportChange}
              onPaneClick={() => setMenu(undefined)}
              onNodeClick={() => setMenu(undefined)}
              onMoveStart={() => setMenu(undefined)}
              onPaneContextMenu={(event) => {
                if (!editable) return;
                event.preventDefault();
                const rect = (event.target as Element).closest('.creative-surface')!.getBoundingClientRect();
                const x = event.clientX - rect.left,
                  y = event.clientY - rect.top;
                setMenu({
                  x: Math.max(0, Math.min(x, rect.width - 180)),
                  y: Math.max(0, Math.min(y, rect.height - 220)),
                  at: { x: (x - viewport.x) / viewport.zoom, y: (y - viewport.y) / viewport.zoom },
                });
              }}
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
                style: { stroke: 'var(--edge)', strokeWidth: 2 },
              }}
            >
              <Background gap={22} size={1} color="var(--dot)" />
              <MiniMap nodeColor="var(--mini-node)" maskColor="var(--ground)" pannable zoomable />
              <Controls showInteractive={false} />
              {toolbar && (
                <NodeToolbar
                  nodeId={toolbar.nodeId}
                  position={viewport.y + toolbarY * viewport.zoom < 72 ? Position.Bottom : Position.Top}
                  align={
                    toolbarLeft < 90
                      ? 'start'
                      : toolbarLeft + (toolbarNode?.width ?? 250) * viewport.zoom > surfaceWidth - 180
                        ? 'end'
                        : 'center'
                  }
                  isVisible
                >
                  <div className="creative-item-toolbar nodrag nopan" aria-label="节点工具条">
                    {toolbar.content}
                  </div>
                </NodeToolbar>
              )}
            </ReactFlow>
          </BoardVideoPreview.Provider>
        </InlineEditing.Provider>
        {menu && editable && (
          <div
            className="creative-create-menu"
            role="menu"
            aria-label="创建画布节点"
            style={{ left: menu.x, top: menu.y }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setMenu(undefined);
                event.currentTarget.closest<HTMLElement>('.creative-surface')?.focus();
              }
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
                const index = items.indexOf(document.activeElement as HTMLElement);
                items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
              }
            }}
          >
            {(
              [
                ['brief', '文字节点'],
                ['note', '便签节点'],
                ['generation', '生成节点'],
              ] as const
            ).map(([type, label], index) => (
              <button
                key={type}
                role="menuitem"
                autoFocus={index === 0}
                onClick={() => {
                  onCreate(type, menu.at);
                  setMenu(undefined);
                }}
              >
                {label}
              </button>
            ))}
            <button role="menuitem" onClick={() => contextFileInput.current?.click()}>
              导入素材
            </button>
            <input
              ref={contextFileInput}
              hidden
              type="file"
              accept={mediaFileAccept}
              multiple
              aria-label="在此处导入素材"
              onChange={(event) => {
                onDropFiles([...(event.target.files ?? [])], menu.at);
                setMenu(undefined);
              }}
            />
          </div>
        )}
        {fileDrag && <div className="v2-file-drop">松开，导入到画布</div>}
      </div>
      {overlay}
    </div>
  );
}
