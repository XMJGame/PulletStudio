import { useEffect, useRef, useState, type DragEvent } from 'react';
import {
  Background,
  MiniMap,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { StudioBrand, StudioButton, StudioIcon } from '../../shared/ui/StudioUI';
import { StudioCanvasNode, type StudioNode } from './StudioCanvasNodes';
import { StudioComposer } from './StudioComposer';
import type { RunState, StudioMedia, StudioRunInput, StudioScene } from './studio-canvas-types';
import './studio-canvas.css';

const nodeTypes = { studio: StudioCanvasNode };
const dragType = 'application/x-pullet-review-media';
const edgeStyle = { stroke: '#64927a', strokeWidth: 2 };
const refNode = (media: StudioMedia, x: number, y: number, id = media.id): StudioNode => ({
  id,
  type: 'studio',
  position: { x, y },
  data: { label: media.title, role: media.kind === 'video' ? '视频' : '参考图', media },
  style: { width: media.kind === 'video' ? 354 : 388 },
});
const makeEdge = (source: string, target: string, label?: string): Edge => ({
  id: `${source}-${target}`,
  source,
  target,
  label,
  style: edgeStyle,
});

export function StudioCanvas({
  projectTitle,
  scene,
  onBack,
  dark,
  toggleTheme,
  onRun,
  reviewMode,
  onBoardChange,
  boardTitles,
}: {
  projectTitle: string;
  scene: StudioScene;
  onBack: () => void;
  dark: boolean;
  toggleTheme: () => void;
  onRun: (input: StudioRunInput) => Promise<StudioMedia>;
  reviewMode: boolean;
  onBoardChange: (title: string) => void;
  boardTitles: string[];
}) {
  const seeded = !!scene.reference;
  const [library, setLibrary] = useState(() => seeded && window.innerWidth >= 1050);
  const [query, setQuery] = useState('');
  const [tool, setTool] = useState<'select' | 'pan'>('select');
  const [menu, setMenu] = useState(false);
  const [boards, setBoards] = useState(false);
  const [composing, setComposing] = useState(seeded);
  const [frame, setFrame] = useState<StudioMedia | undefined>(scene.reference);
  const [frameId, setFrameId] = useState<string | undefined>(scene.reference?.id);
  const [result, setResult] = useState<StudioMedia | undefined>(scene.savedResult);
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState<RunState>(scene.savedResult ? 'completed' : 'idle');
  const [active, setActive] = useState<StudioNode>();
  const [preview, setPreview] = useState<StudioMedia>();
  const [initialPrompt, setInitialPrompt] = useState(scene.prompt ?? '');
  const [composerVersion, setComposerVersion] = useState(0);
  const [viewport, setViewport] = useState<Viewport>({ x: 45, y: 45, zoom: 1 });
  const stage = useRef<HTMLDivElement>(null);
  const previewDialog = useRef<HTMLDialogElement>(null);
  const flow = useRef<ReactFlowInstance<StudioNode, Edge> | null>(null);
  const initialized = useRef(false);
  const [nodes, setNodes, onNodesChange] = useNodesState<StudioNode>([
    ...(scene.reference ? [refNode(scene.reference, 76, 64)] : []),
    ...(scene.mood ? [refNode(scene.mood, 110, 347)] : []),
    ...(seeded
      ? [
          {
            id: 'generate',
            type: 'studio' as const,
            position: { x: 553, y: 82 },
            data: { label: '生成片段', role: 'ComfyUI', state: status },
            style: { width: 226 },
          },
        ]
      : []),
    ...(scene.savedResult ? [refNode(scene.savedResult, 546, 215, 'output')] : []),
  ]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([
    ...(scene.reference ? [makeEdge(scene.reference.id, 'generate', '首帧')] : []),
    ...(scene.savedResult ? [makeEdge('generate', 'output')] : []),
  ]);
  useEffect(() => {
    const element = stage.current;
    if (!element || initialized.current) return;
    initialized.current = true;
    const width = element.clientWidth;
    const zoom = seeded ? Math.min(1.1, Math.max(0.42, (width - (library ? 300 : 52) - 60) / 910)) : 1;
    setViewport({ x: width < 600 ? 9 : 55, y: width < 600 ? 25 : 47, zoom });
  }, [library, seeded]);
  useEffect(() => {
    if (preview && !previewDialog.current?.open) previewDialog.current?.showModal();
  }, [preview]);
  const items = (result && saved ? [...scene.media, result] : scene.media).filter((item) =>
    item.title.toLowerCase().includes(query.trim().toLowerCase()),
  );
  function insert(item: StudioMedia, position?: { x: number; y: number }) {
    const id = crypto.randomUUID();
    const point =
      position ??
      flow.current?.screenToFlowPosition({ x: window.innerWidth * 0.39, y: window.innerHeight * 0.3 });
    const node = refNode(
      item,
      (point?.x ?? 84) + (!position ? nodes.length * 24 : 0),
      (point?.y ?? 70) + (!position ? nodes.length * 18 : 0),
      id,
    );
    setNodes((current) => [...current.map((n) => ({ ...n, selected: false })), { ...node, selected: true }]);
    setActive(node);
    if (window.innerWidth < 760) setLibrary(false);
  }
  function createGenerator(source?: StudioNode) {
    const image = source?.data.media;
    if (image?.kind === 'image') {
      setFrame(image);
      setFrameId(source?.id);
    }
    setNodes((current) =>
      current.some((n) => n.id === 'generate')
        ? current
        : [
            ...current,
            {
              id: 'generate',
              type: 'studio',
              position: {
                x: source ? source.position.x + 470 : 160,
                y: source ? source.position.y + 20 : 105,
              },
              data: { label: '生成片段', role: 'ComfyUI', state: status },
              style: { width: 226 },
            },
          ],
    );
    if (image?.kind === 'image' && source)
      setEdges((current) => [
        ...current.filter((e) => e.target !== 'generate'),
        makeEdge(source.id, 'generate', '首帧'),
      ]);
    setComposing(true);
    setMenu(false);
  }
  function onConnect(connection: Connection) {
    const source = nodes.find((n) => n.id === connection.source);
    if (connection.target === 'generate' && source?.data.media?.kind === 'image') {
      createGenerator(source);
      return;
    }
    if (connection.source !== connection.target)
      setEdges((current) => addEdge({ ...connection, style: edgeStyle }, current));
  }
  function addNote() {
    setNodes((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        type: 'studio',
        position: { x: 95 + current.length * 38, y: 110 + current.length * 22 },
        data: { label: '提示词', role: '创作笔记', prompt: scene.prompt ?? '在生成面板填写画面描述。' },
        style: { width: 238 },
      },
    ]);
    setMenu(false);
  }
  function drop(event: DragEvent) {
    if (!event.dataTransfer.types.includes(dragType)) return;
    event.preventDefault();
    const item = items.find((m) => m.id === event.dataTransfer.getData(dragType));
    if (item) insert(item, flow.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  }
  async function run(input: StudioRunInput) {
    setStatus('running');
    setNodes((current) =>
      current.map((n) => (n.id === 'generate' ? { ...n, data: { ...n.data, state: 'running' } } : n)),
    );
    try {
      const next = await onRun(input);
      setStatus('completed');
      setResult(next);
      setSaved(false);
      setNodes((current) => {
        const gen = current.find((n) => n.id === 'generate');
        return [
          ...current
            .filter((n) => n.id !== 'output')
            .map((n) =>
              n.id === 'generate' ? { ...n, data: { ...n.data, state: 'completed' as const } } : n,
            ),
          refNode(next, gen?.position.x ?? 546, (gen?.position.y ?? 82) + 133, 'output'),
        ];
      });
      setEdges((current) => [
        ...current.filter((e) => e.target !== 'output'),
        makeEdge('generate', 'output'),
      ]);
    } catch {
      setStatus('failed');
      setNodes((current) =>
        current.map((n) => (n.id === 'generate' ? { ...n, data: { ...n.data, state: 'failed' } } : n)),
      );
    }
  }
  function startAgain() {
    const position = { x: (active?.position.x ?? 300) + 130, y: (active?.position.y ?? 80) + 100 };
    const still = result && {
      ...result,
      id: `${result.id}-still`,
      kind: 'image' as const,
      title: '候选片段 · 封面帧',
    };
    if (!still) return;
    const source = refNode(still, position.x, position.y, crypto.randomUUID());
    setNodes((current) => [...current, source]);
    createGenerator(source);
    setInitialPrompt('延续这张画面的光线，镜头缓慢横移。');
    setComposerVersion((v) => v + 1);
  }
  const selectedMedia = active?.data.media;
  return (
    <div className="v2-canvas-shell">
      <header className="v2-canvas-top">
        <div className="v2-canvas-project">
          <StudioButton
            icon="arrow"
            variant="ghost"
            aria-label="返回项目"
            title="返回项目"
            onClick={onBack}
          />
          <StudioBrand compact />
          <div>
            <strong>{projectTitle}</strong>
            <button className="v2-board-switch" onClick={() => setBoards((v) => !v)} aria-expanded={boards}>
              {scene.title}
              <StudioIcon name="chevron" size={13} />
            </button>
          </div>
          {boards && (
            <div className="v2-board-menu">
              <strong>项目画布</strong>
              {boardTitles.map((title) => (
                <StudioButton
                  variant="ghost"
                  key={title}
                  aria-pressed={title === scene.title}
                  onClick={() => {
                    onBoardChange(title);
                    setBoards(false);
                  }}
                >
                  {title}
                </StudioButton>
              ))}
              <StudioButton
                icon="plus"
                variant="ghost"
                onClick={() => {
                  onBoardChange('新画布');
                  setBoards(false);
                }}
              >
                新建空画布
              </StudioButton>
            </div>
          )}
        </div>
        <div className="v2-canvas-actions">
          {reviewMode && <span className="v2-review-indicator">设计评审 · 模拟生成</span>}
          <StudioButton
            icon="layers"
            variant="ghost"
            aria-pressed={library}
            onClick={() => setLibrary((v) => !v)}
          >
            资源库
          </StudioButton>
          <StudioButton
            icon={dark ? 'sun' : 'moon'}
            variant="ghost"
            aria-label={dark ? '浅色画布' : '深色画布'}
            title={dark ? '浅色画布' : '深色画布'}
            onClick={toggleTheme}
          />
        </div>
      </header>
      <main
        className="v2-canvas-stage"
        ref={stage}
        aria-label="无限画布"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes(dragType)) event.preventDefault();
        }}
        onDrop={drop}
      >
        <ReactFlow<StudioNode, Edge>
          nodes={nodes.map((node) =>
            node.data.media?.kind === 'video'
              ? { ...node, data: { ...node.data, onPreview: setPreview } }
              : node,
          )}
          edges={edges}
          nodeTypes={nodeTypes}
          onInit={(instance) => {
            flow.current = instance;
          }}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          viewport={viewport}
          onViewportChange={setViewport}
          minZoom={0.2}
          maxZoom={2}
          onNodeClick={(_, n) => {
            setActive(n);
            if (n.id === 'generate') setComposing(true);
          }}
          onNodeDoubleClick={(_, n) => {
            if (n.data.media) setPreview(n.data.media);
          }}
          onPaneClick={() => {
            setActive(undefined);
            setMenu(false);
          }}
          panOnDrag={tool === 'pan'}
          selectionOnDrag={tool === 'select'}
          colorMode={dark ? 'dark' : 'light'}
        >
          <Background gap={22} size={1.2} color="var(--dot)" />
          <MiniMap nodeColor="var(--line)" maskColor={dark ? '#111a15a8' : '#f6f7f5a8'} pannable zoomable />
        </ReactFlow>
        <nav className="v2-canvas-tools" aria-label="画布工具">
          <StudioButton
            variant="ghost"
            icon="cursor"
            aria-label="选择"
            title="选择"
            aria-pressed={tool === 'select'}
            onClick={() => setTool('select')}
          />
          <StudioButton
            variant="ghost"
            icon="hand"
            aria-label="平移"
            title="平移"
            aria-pressed={tool === 'pan'}
            onClick={() => setTool('pan')}
          />
          <hr />
          <StudioButton
            variant="primary"
            icon="plus"
            aria-label="添加节点"
            title="添加节点"
            aria-expanded={menu}
            onClick={() => setMenu((v) => !v)}
          />
          <StudioButton
            variant="ghost"
            icon="spark"
            aria-label="打开创作面板"
            title="打开创作面板"
            onClick={() => createGenerator(active)}
          />
        </nav>
        {menu && (
          <div className="v2-node-menu">
            <strong>添加到画布</strong>
            <StudioButton
              icon="image"
              variant="ghost"
              onClick={() => {
                setLibrary(true);
                setMenu(false);
              }}
            >
              从资源库添加
            </StudioButton>
            <StudioButton icon="note" variant="ghost" onClick={addNote}>
              提示词卡片
            </StudioButton>
            <StudioButton icon="spark" variant="ghost" onClick={() => createGenerator(active)}>
              工作流生成
            </StudioButton>
            <StudioButton icon="close" variant="ghost" onClick={() => setMenu(false)}>
              关闭
            </StudioButton>
          </div>
        )}
        {!nodes.length && (
          <section className="v2-canvas-empty">
            <span className="v2-empty-symbol">
              <StudioIcon name="layers" size={34} />
              <i>
                <StudioIcon name="plus" size={16} />
              </i>
            </span>
            <h1>从第一帧开始</h1>
            <p>加一张参考图，或用提示词描述你的画面。</p>
            <div>
              <StudioButton icon="image" variant="primary" onClick={() => setLibrary(true)}>
                打开资源库
              </StudioButton>
              <StudioButton icon="spark" onClick={() => createGenerator()}>
                开始生成
              </StudioButton>
            </div>
            <small>资源可直接拖到画布 · 空格拖动平移</small>
          </section>
        )}
        {selectedMedia && (
          <div className="v2-selection-actions">
            <StudioButton variant="ghost" icon="fit" onClick={() => setPreview(selectedMedia)}>
              预览
            </StudioButton>
            {selectedMedia.kind === 'image' && (
              <StudioButton variant="ghost" icon="spark" onClick={() => createGenerator(active)}>
                以此图生成
              </StudioButton>
            )}
            {active?.id === 'output' && (
              <>
                <StudioButton icon="spark" variant="ghost" onClick={startAgain}>
                  复用封面帧
                </StudioButton>
                <StudioButton
                  icon={saved ? 'check' : 'plus'}
                  variant="ghost"
                  disabled={saved}
                  onClick={() => setSaved(true)}
                >
                  {saved ? '已入库' : '存入资源库'}
                </StudioButton>
              </>
            )}
          </div>
        )}
        {composing && (
          <div className={`v2-composer-position ${library ? 'v2-composer-with-library' : ''}`}>
            <StudioComposer
              key={composerVersion}
              frame={frame}
              initialPrompt={initialPrompt}
              state={status}
              onRun={(input) => void run(input)}
              onDismiss={() => setComposing(false)}
              onClearFrame={() => {
                setFrame(undefined);
                setEdges((current) => current.filter((e) => e.source !== frameId || e.target !== 'generate'));
                setFrameId(undefined);
              }}
              onChooseFrame={() => setLibrary(true)}
              onApplyPrompt={() => scene.prompt || '镜头缓缓推近，环境光保持自然。'}
              reviewMode={reviewMode}
            />
          </div>
        )}
        {library && (
          <aside className="v2-canvas-library" aria-label="画布资源库">
            <div className="v2-library-heading">
              <div>
                <h2>项目资源</h2>
                <small>选择或拖入画布</small>
              </div>
              <StudioButton
                icon="close"
                variant="ghost"
                aria-label="关闭资源库"
                title="关闭资源库"
                onClick={() => setLibrary(false)}
              />
            </div>
            <label className="v2-library-search">
              <StudioIcon name="search" size={16} />
              <input
                className="v2-input"
                aria-label="搜索资源"
                placeholder="搜索资源"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="v2-library-grid">
              {items.map((item) => (
                <button
                  className="v2-library-card"
                  key={item.id}
                  draggable
                  aria-label={`添加 ${item.title}`}
                  onDragStart={(event) => {
                    event.dataTransfer.setData(dragType, item.id);
                    event.dataTransfer.effectAllowed = 'copy';
                  }}
                  onClick={() => insert(item)}
                >
                  <div>
                    <img alt="" src={item.image} draggable={false} />
                    <span>
                      <StudioIcon name={item.kind === 'video' ? 'film' : 'image'} size={13} />
                    </span>
                  </div>
                  <strong>{item.title}</strong>
                </button>
              ))}
            </div>
            {!items.length && <p className="v2-caption">没有匹配的资源。</p>}
          </aside>
        )}
        <nav className="v2-canvas-zoom" aria-label="视图控制">
          <StudioButton
            icon="minus"
            variant="ghost"
            aria-label="缩小"
            title="缩小"
            onClick={() => void flow.current?.zoomOut()}
          />
          <button title="恢复 100%" onClick={() => void flow.current?.zoomTo(1)}>
            {Math.round(viewport.zoom * 100)}%
          </button>
          <StudioButton
            icon="plus"
            variant="ghost"
            aria-label="放大"
            title="放大"
            onClick={() => void flow.current?.zoomIn()}
          />
          <StudioButton
            icon="fit"
            variant="ghost"
            aria-label="适应内容"
            title="适应内容"
            onClick={() => void flow.current?.fitView({ padding: 0.27, maxZoom: 1.15 })}
          />
        </nav>
      </main>
      <dialog
        className="v2-preview"
        ref={previewDialog}
        aria-label="素材预览"
        onClose={() => setPreview(undefined)}
      >
        {preview && (
          <>
            <header>
              <strong>{preview.title}</strong>
              <StudioButton
                icon="close"
                variant="ghost"
                aria-label="关闭素材预览"
                onClick={() => previewDialog.current?.close()}
              />
            </header>
            {preview.video ? (
              <video src={preview.video} poster={preview.image} controls playsInline />
            ) : (
              <img src={preview.image} alt={preview.title} />
            )}
          </>
        )}
      </dialog>
    </div>
  );
}
