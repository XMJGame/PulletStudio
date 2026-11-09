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
import type { BoardInputPort, BoardNode } from '../../../../packages/contracts/src/board';
import { generationStates } from '../components/GenerationDialog';
import { StudioIcon } from '../shared/ui/StudioUI';
import { mediaFileAccept } from '../media-upload';
import { creationActions, type CanvasCreation } from './creation-actions';
const InlineEditing = createContext<{
  editable: boolean;
  update: (node: BoardNode) => void;
  disconnect: (id: string, port: BoardInputPort) => void;
  connectingType?: string;
}>({
  editable: false,
  update: () => {},
  disconnect: () => {},
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
        <small>
          {data.childCount ?? 0} 项{domain.data.collapsed ? ' · 已折叠' : ''}
        </small>
        {data.hasResultOutputs && (
          <Handle
            type="source"
            position={Position.Right}
            id="out"
            isConnectable={editing.editable}
            aria-label={`${domain.data.label} 产物输出`}
            title="连接后选择组内具体产物"
          />
        )}
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
        isConnectable={editing.editable}
        aria-label={`${value?.title ?? kindLabels[domain.type]} 输入`}
        title={domain.type === 'generation' ? '连接文字、图片、视频或音频，自动识别用途' : '创作连线'}
        className={
          domain.type === 'generation' &&
          editing.connectingType &&
          data.generationCard?.accepts.includes(editing.connectingType)
            ? 'creative-compatible-port'
            : undefined
        }
      />
      {visual && <BoardMediaFrame id={domain.id} title={value.title} media={media} />}
      {domain.type !== 'note' && domain.type !== 'brief' && domain.type !== 'generation' && (
        <span className="creative-node-kind">{kindLabels[value?.kind ?? domain.type] ?? '业务引用'}</span>
      )}
      <strong>
        {domain.type === 'reference' || domain.type === 'result'
          ? (value?.title ?? '正在读取引用…')
          : domain.type === 'note'
            ? '便签'
            : domain.type === 'brief'
              ? '文字'
              : domain.type === 'generation'
                ? (data.generationCard?.name ?? '生成')
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
        <>
          <span className="creative-generation-state">
            {data.generationCard?.latestState
              ? `最近任务 · ${generationStates[data.generationCard.latestState] ?? data.generationCard.latestState}`
              : '准备创作'}
          </span>
          <div className="creative-generation-references nodrag nowheel nopan">
            {data.generationCard?.references.map((ref) => (
              <div className="creative-generation-reference nodrag nopan" key={ref.port} title={ref.title}>
                {ref.poster && !ref.unavailable ? (
                  <img src={ref.poster} alt="" loading="lazy" />
                ) : (
                  <StudioIcon name="folder" size={16} />
                )}
                <span>
                  <small>{ref.label}</small>
                  <span>{ref.unavailable ? '素材不可用' : ref.title}</span>
                </span>
                {editing.editable && (
                  <button
                    aria-label={`断开${ref.label}`}
                    title={`断开${ref.label}`}
                    onClick={() => editing.disconnect(domain.id, ref.port)}
                  >
                    <StudioIcon name="close" size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <p className="creative-generation-prompt">
            {data.generationCard?.prompt || '选中节点，写下你想创作的内容…'}
          </p>
        </>
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
        isConnectable={editing.editable}
        aria-label={`${value?.title ?? kindLabels[domain.type]} 输出`}
      />
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
  onDisconnect,
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
  onDisconnect: (target: string, port: BoardInputPort, source: string) => void;
  onCreate: (type: CanvasCreation, at: { x: number; y: number }) => void;
  onNodesChange: OnNodesChange<CanvasNode>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  onViewportChange: (value: Viewport) => void;
}) {
  const [fileDrag, setFileDrag] = useState(false);
  const [connectingType, setConnectingType] = useState<string>();
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
        <InlineEditing.Provider
          value={{
            editable,
            update: onUpdate,
            disconnect: (id, port) => onDisconnect(id, port, ''),
            connectingType,
          }}
        >
          <BoardVideoPreview.Provider value={videoPreview}>
            <ReactFlow<CanvasNode>
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onConnectStart={(_, params) => {
                if (params.handleType === 'source') {
                  const source = nodes.find((node) => node.id === params.nodeId);
                  setConnectingType(
                    ['note', 'brief'].includes(source?.data.domain.type ?? '')
                      ? 'text'
                      : source?.data.value?.media?.mediaType,
                  );
                }
              }}
              onConnectEnd={() => setConnectingType(undefined)}
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
            {creationActions.map(({ kind, label }, index) => (
              <button
                key={kind}
                role="menuitem"
                autoFocus={index === 0}
                onClick={() => {
                  onCreate(kind, menu.at);
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
