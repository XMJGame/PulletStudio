import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Board,
  connectionError,
  demoBoard,
  Kind,
  labels,
  parseBoard,
  serialize,
  thumbnail,
  nodeWidth,
  nodeHeight,
} from './model';
import { DomEngine } from './DomEngine';
import './style.css';

const FlowEngine = lazy(() => import('./FlowEngine').then((module) => ({ default: module.FlowEngine })));
const storageKey = 'pullet:canvas-lab:layout:v1';
function initial() {
  try {
    const saved = localStorage.getItem(storageKey);
    return { board: saved ? parseBoard(saved) : demoBoard(30), error: '' };
  } catch {
    return { board: demoBoard(30), error: '本机布局无法恢复，已打开演示样例；原保存内容没有覆盖。' };
  }
}
type Report = {
  engine: string;
  nodes: number;
  visibleCards: number;
  viewport: string;
  samples: number;
  activeSamples: number;
  frameP95Ms: number;
  maxFrameMs: number;
  longTasks: number | null;
  interactionEvents: number;
  browser: string;
  measuredAt: string;
};
function CanvasLab() {
  const [start] = useState(initial);
  const [board, setBoard] = useState<Board>(start.board);
  const [engine, setEngine] = useState<'flow' | 'dom'>('flow');
  const [tool, setTool] = useState<'select' | 'pan'>('select');
  const [selected, setSelected] = useState<string[]>([]);
  const [pendingPort, setPendingPort] = useState<string>();
  const [notice, setNotice] = useState('');
  const [error, setError] = useState(start.error);
  const [preview, setPreview] = useState<{ url: string; name: string; kind: Kind }>();
  const [reports, setReports] = useState<Report[]>([]);
  const [measuring, setMeasuring] = useState(false);
  const measuringRef = useRef(false),
    stage = useRef<HTMLDivElement>(null);
  const node = board.nodes.find((node) => node.id === selected[0]);
  const onSelect = useCallback(
    (ids: string[]) => setSelected((old) => (old.join('|') === ids.join('|') ? old : ids)),
    [],
  );
  useEffect(() => {
    setPreview(undefined);
  }, [node?.id, engine]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  function changeData(patch: Partial<Board['nodes'][number]['data']>) {
    if (!node) return;
    setError('');
    setNotice('节点内容已更新，尚未保存本机布局。');
    setBoard((old) => ({
      ...old,
      nodes: old.nodes.map((item) =>
        item.id === node.id ? { ...item, data: { ...item.data, ...patch } } : item,
      ),
    }));
  }
  const connect = useCallback(
    (source: string, target: string) => {
      const reason = connectionError(board.nodes, board.edges, source, target);
      setPendingPort(undefined);
      if (reason) {
        setNotice('');
        setError(reason);
        return;
      }
      setError('');
      setNotice('引用已连接；尚未执行生成任务。');
      setBoard((old) => ({
        ...old,
        edges: [
          ...old.edges,
          { id: crypto.randomUUID(), source, target, sourceHandle: 'out', targetHandle: 'in' },
        ],
      }));
    },
    [board.nodes, board.edges],
  );
  const port = useCallback(
    (id: string, side: 'in' | 'out') => {
      if (side === 'out') {
        setPendingPort(id);
        setError('');
        setNotice('请选择目标节点的输入端口。');
      } else if (pendingPort) connect(pendingPort, id);
      else setNotice('先选择来源节点的输出端口，再选择输入端口。');
    },
    [connect, pendingPort],
  );
  function remove() {
    if (!selected.length) return;
    setBoard((old) => ({
      ...old,
      nodes: old.nodes.filter((node) => !selected.includes(node.id)),
      edges: old.edges.filter((edge) => !selected.includes(edge.source) && !selected.includes(edge.target)),
    }));
    setSelected([]);
    setPendingPort(undefined);
    setNotice('已移除实验节点，正式项目不受影响。');
  }
  function loadSample(count: 30 | 50) {
    setBoard(demoBoard(count));
    setSelected([]);
    setPreview(undefined);
    setPendingPort(undefined);
    setError('');
    setNotice(`已载入${count}个演示节点，未覆盖本机保存。`);
  }
  function restore(raw?: string) {
    try {
      const value = raw ?? localStorage.getItem(storageKey);
      if (!value) throw new Error('还没有保存的本机布局');
      const next = parseBoard(value);
      setBoard(next);
      setSelected([]);
      setPendingPort(undefined);
      setPreview(undefined);
      setError('');
      setNotice('布局已恢复；本地试听文件需重新选择。');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '恢复失败，当前编辑已保留');
    }
  }
  async function measure() {
    if (measuringRef.current) return;
    measuringRef.current = true;
    setMeasuring(true);
    setNotice('正在观察4秒，请拖动节点、平移或缩放。');
    const frames: number[] = [],
      activeFrames: number[] = [],
      counts = { events: 0, tasks: 0, lastEvent: 0 };
    const record = () => {
      counts.events++;
      counts.lastEvent = performance.now();
    };
    const element = stage.current!;
    element.addEventListener('pointermove', record);
    element.addEventListener('wheel', record);
    let observer: PerformanceObserver | undefined;
    try {
      observer = new PerformanceObserver((list) => {
        counts.tasks += list.getEntries().length;
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch {
      observer = undefined;
    }
    const began = performance.now();
    let previous = began;
    await new Promise<void>((resolve) => {
      const frame = (now: number) => {
        frames.push(now - previous);
        if (now - counts.lastEvent < 150) activeFrames.push(now - previous);
        previous = now;
        if (now - began < 4000) requestAnimationFrame(frame);
        else resolve();
      };
      requestAnimationFrame(frame);
    });
    observer?.disconnect();
    element.removeEventListener('pointermove', record);
    element.removeEventListener('wheel', record);
    const sorted = [...activeFrames].sort((a, b) => a - b);
    const report: Report = {
      engine,
      nodes: board.nodes.length,
      visibleCards: element.querySelectorAll('.lab-card').length,
      viewport: `${element.clientWidth}×${element.clientHeight}`,
      samples: frames.length,
      activeSamples: activeFrames.length,
      frameP95Ms: Number((sorted[Math.ceil(sorted.length * 0.95) - 1] ?? 0).toFixed(2)),
      maxFrameMs: activeFrames.length ? Number(Math.max(...activeFrames).toFixed(2)) : 0,
      longTasks: observer ? counts.tasks : null,
      interactionEvents: counts.events,
      browser: navigator.userAgent,
      measuredAt: new Date().toISOString(),
    };
    setReports((old) => [...old, report]);
    measuringRef.current = false;
    setMeasuring(false);
    setNotice(
      counts.events < 10 || activeFrames.length < 30
        ? '观察完成；交互不足，本次不能用于性能结论。'
        : '交互观察完成，结果在下方性能记录。',
    );
  }
  const props = { board, setBoard, onSelect, connect, port, tool };
  return (
    <main
      className="canvas-lab"
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable]')) return;
        if (event.key === 'Escape') {
          setPendingPort(undefined);
          setSelected([]);
          setBoard((old) => ({ ...old, nodes: old.nodes.map((node) => ({ ...node, selected: false })) }));
        }
        if ((event.key === 'Delete' || event.key === 'Backspace') && engine === 'dom') {
          event.preventDefault();
          remove();
        }
      }}
    >
      <header className="lab-header">
        <div className="lab-brand">
          <span>P</span>
          <div>
            <strong>PULLET STUDIO</strong>
            <small>CREATIVE CANVAS</small>
          </div>
        </div>
        <div className="lab-title">
          <h1>
            创作画布 <span>交互原型</span>
          </h1>
          <p>从参考与文字，到可比较的视觉方案。</p>
        </div>
        <a href="/">返回生产工作台 ↗</a>
      </header>
      <div className="lab-notice">
        演示样例 · 尚未连接项目资产和模型。编辑只保存在本机实验布局，本地文件不上传。
      </div>
      <nav className="lab-toolbar" aria-label="画布工具">
        <div className="lab-segment">
          <button aria-pressed={tool === 'select'} onClick={() => setTool('select')}>
            ↖ 选择
          </button>
          <button aria-pressed={tool === 'pan'} onClick={() => setTool('pan')}>
            ✥ 平移
          </button>
        </div>
        <div className="lab-samples">
          <span>节点</span>
          <button onClick={() => loadSample(30)} disabled={measuring}>
            30节点样例
          </button>
          <button onClick={() => loadSample(50)} disabled={measuring}>
            50节点样例
          </button>
        </div>
        <button
          onClick={() => {
            const id = crypto.randomUUID();
            setBoard((old) => ({
              ...old,
              nodes: [
                ...old.nodes.map((node) => ({ ...node, selected: false })),
                {
                  id,
                  selected: true,
                  type: 'lab',
                  position: {
                    x: (100 - old.viewport.x) / old.viewport.zoom,
                    y: (100 - old.viewport.y) / old.viewport.zoom,
                  },
                  data: { kind: 'text', title: '新的提示词', text: '', variant: 0, primary: 0 },
                },
              ],
            }));
            onSelect([id]);
          }}
          disabled={board.nodes.length >= 100}
        >
          ＋ 提示词
        </button>
        <div className="lab-toolbar-end">
          <button
            onClick={() => {
              try {
                localStorage.setItem(storageKey, serialize(board));
                setError('');
                setNotice('已保存本机实验布局；没有写入项目。');
              } catch {
                setError('本机存储不可用，当前编辑仍保留。');
              }
            }}
          >
            保存本机布局
          </button>
          <button onClick={() => restore()}>恢复布局</button>
        </div>
      </nav>
      <div className="lab-feedback" aria-live="polite">
        {error ? (
          <span role="alert">{error}</span>
        ) : (
          notice || '滚轮缩放 · 空格/中键平移 · Shift多选 · 空白处拖动框选 · 输出→输入可连线'
        )}
      </div>
      <div className="lab-workspace">
        <section
          className="lab-stage"
          ref={stage}
          aria-label="创作画布工作区"
          data-engine={engine}
          data-zoom={board.viewport.zoom}
          data-x={board.viewport.x}
          data-y={board.viewport.y}
        >
          <Suspense fallback={<p className="lab-loading">正在打开画布…</p>}>
            {engine === 'flow' ? <FlowEngine {...props} /> : <DomEngine {...props} />}
          </Suspense>
          <div className="lab-stage-info">
            {board.nodes.length} 节点 <span>·</span> {board.edges.length} 条引用
          </div>
          <div className="lab-view-controls">
            <button
              onClick={() => {
                if (!board.nodes.length || !stage.current) return;
                const minX = Math.min(...board.nodes.map((node) => node.position.x)),
                  minY = Math.min(...board.nodes.map((node) => node.position.y));
                const width = Math.max(...board.nodes.map((node) => node.position.x + nodeWidth)) - minX,
                  height = Math.max(...board.nodes.map((node) => node.position.y + nodeHeight)) - minY;
                const zoom = Math.max(
                  0.15,
                  Math.min(
                    1,
                    (stage.current.clientWidth - 80) / width,
                    (stage.current.clientHeight - 100) / height,
                  ),
                );
                setBoard((old) => ({
                  ...old,
                  viewport: {
                    x: (stage.current!.clientWidth - width * zoom) / 2 - minX * zoom,
                    y: (stage.current!.clientHeight - height * zoom) / 2 - minY * zoom,
                    zoom,
                  },
                }));
              }}
            >
              查看全图
            </button>
            <button
              aria-label="缩小画布"
              onClick={() =>
                setBoard((old) => ({
                  ...old,
                  viewport: { ...old.viewport, zoom: Math.max(0.15, old.viewport.zoom / 1.2) },
                }))
              }
            >
              −
            </button>
            <output>{Math.round(board.viewport.zoom * 100)}%</output>
            <button
              aria-label="放大画布"
              onClick={() =>
                setBoard((old) => ({
                  ...old,
                  viewport: { ...old.viewport, zoom: Math.min(2, old.viewport.zoom * 1.2) },
                }))
              }
            >
              ＋
            </button>
            <button onClick={() => setBoard((old) => ({ ...old, viewport: { x: 45, y: 44, zoom: 0.75 } }))}>
              回到起点
            </button>
          </div>
        </section>
        <aside className="lab-inspector" aria-label="节点检查器">
          <div className="lab-inspector-heading">
            <h2>{node ? labels[node.data.kind] : '创作检查器'}</h2>
            <span>{selected.length ? `选中 ${selected.length}` : '选择一个节点'}</span>
          </div>
          {node ? (
            <>
              <label>
                节点名称
                <input
                  maxLength={100}
                  value={node.data.title}
                  onChange={(event) => changeData({ title: event.target.value })}
                />
              </label>
              <label>
                {node.data.kind === 'text' ? '提示词内容' : '创作备注'}
                <textarea
                  maxLength={4000}
                  rows={5}
                  value={node.data.text}
                  onChange={(event) => changeData({ text: event.target.value })}
                />
              </label>
              {node.data.kind === 'generation' && (
                <div className="lab-input-summary">
                  <h3>输入来源</h3>
                  {board.edges
                    .filter((edge) => edge.target === node.id)
                    .map((edge) => (
                      <p key={edge.id}>{board.nodes.find((item) => item.id === edge.source)?.data.title}</p>
                    ))}
                  <p className="lab-muted">仅展示编排。正式版本会核对工作流能力、固定提示词和批准参考。</p>
                </div>
              )}
              {node.data.kind === 'result' && (
                <div className="lab-compare">
                  <h3>并排比较 · 合成示意</h3>
                  {[0, 1, 2].map((index) => (
                    <button
                      key={index}
                      aria-label={`${node.data.primary === index ? '✓ 主方案' : '设为主方案'} ${index + 1}`}
                      aria-pressed={node.data.primary === index}
                      onClick={() => changeData({ primary: index })}
                    >
                      <img src={thumbnail(index)} alt={`方案 ${index + 1}`} />
                      <span>
                        {node.data.primary === index ? '✓ 主方案' : '设为主方案'} {index + 1}
                      </span>
                    </button>
                  ))}
                  <p className="lab-muted">本地比较标记，不代表已批准或选片。</p>
                </div>
              )}
              {['video', 'audio', 'image'].includes(node.data.kind) && (
                <div className="lab-local-media">
                  <label>
                    本地预览文件
                    <input
                      aria-label="本地预览文件"
                      type="file"
                      accept={
                        node.data.kind === 'video'
                          ? 'video/mp4,video/webm,video/quicktime'
                          : node.data.kind === 'audio'
                            ? 'audio/*'
                            : 'image/png,image/jpeg,image/webp'
                      }
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (!file) return;
                        if (
                          file.size > 128 * 1024 * 1024 ||
                          !(node.data.kind === 'image'
                            ? /^image\/(png|jpeg|webp)$/.test(file.type)
                            : file.type.startsWith(node.data.kind + '/'))
                        ) {
                          setError('请选择匹配类型且不超过128MiB的本地文件。');
                          return;
                        }
                        setError('');
                        setPreview({ url: URL.createObjectURL(file), name: file.name, kind: node.data.kind });
                      }}
                    />
                  </label>
                  {preview && (
                    <>
                      <p>{preview.name}</p>
                      {preview.kind === 'video' ? (
                        <video
                          src={preview.url}
                          controls
                          preload="metadata"
                          onError={() => setError('浏览器不能播放此文件，请检查编码。')}
                        />
                      ) : preview.kind === 'audio' ? (
                        <audio src={preview.url} controls preload="metadata" />
                      ) : (
                        <img src={preview.url} alt="本地参考预览" />
                      )}
                    </>
                  )}
                  <p className="lab-muted">
                    仅当前浏览器试听。离开此节点即释放，不上传、不写入布局或正式素材库。
                  </p>
                </div>
              )}
              <h3>引用连线</h3>
              {board.edges
                .filter((edge) => edge.source === node.id || edge.target === node.id)
                .map((edge) => (
                  <div className="lab-edge-row" key={edge.id}>
                    <span>
                      {board.nodes.find((item) => item.id === edge.source)?.data.title} →{' '}
                      {board.nodes.find((item) => item.id === edge.target)?.data.title}
                    </span>
                    <button
                      aria-label={`断开 ${edge.id}`}
                      onClick={() =>
                        setBoard((old) => ({
                          ...old,
                          edges: old.edges.filter((item) => item.id !== edge.id),
                        }))
                      }
                    >
                      断开
                    </button>
                  </div>
                ))}
              <button className="lab-danger" onClick={remove}>
                移除选中节点
              </button>
            </>
          ) : (
            <div className="lab-empty">
              <div>◇</div>
              <p>
                先摆好参考，
                <br />
                再展开你的创作思路。
              </p>
              <small>
                选择节点查看输入、备注与方案。
                <br />
                连接只表达关系，不执行生成。
              </small>
            </div>
          )}
          <details className="lab-experiment">
            <summary>原型对比与布局文件</summary>
            <label>
              画布底座
              <select
                aria-label="画布底座"
                value={engine}
                disabled={measuring}
                onChange={(event) => {
                  setEngine(event.target.value as 'flow' | 'dom');
                  setPendingPort(undefined);
                }}
              >
                <option value="flow">React Flow</option>
                <option value="dom">DOM受控对照</option>
              </select>
            </label>
            <p className="lab-muted">
              两底座共享相同节点/连线/视口。对照版没有小地图或完整连接拖拽；点击端口连接可用于共同验收。
            </p>
            <button disabled={measuring} onClick={() => void measure()}>
              {measuring ? '观察中，请操作画布…' : '观察4秒交互性能'}
            </button>
            {reports.map((report, index) => (
              <pre key={index} data-testid="performance-report">
                {JSON.stringify(report, null, 2)}
              </pre>
            ))}
            <button
              onClick={() => {
                const url = URL.createObjectURL(new Blob([serialize(board)], { type: 'application/json' }));
                const a = document.createElement('a');
                a.href = url;
                a.download = 'pullet-canvas-lab.json';
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }}
            >
              导出实验布局JSON
            </button>
            <label>
              导入实验布局
              <input
                type="file"
                accept="application/json,.json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  if (file.size > 200000) {
                    setError('布局文件过大，当前编辑已保留');
                    return;
                  }
                  void file
                    .text()
                    .then(restore)
                    .catch(() => setError('文件无法读取，当前编辑已保留'));
                }}
              />
            </label>
            <p className="lab-muted">
              布局只包含示例节点、便签、位置与连线；不保存本地媒体。正式团队画布将使用后端版本与权限。
            </p>
            <a href="https://github.com/basketikun/infinite-canvas" target="_blank" rel="noreferrer">
              交互参考：infinite-canvas ↗
            </a>
            <a href="/canvas-third-party-notices.txt" target="_blank" rel="noreferrer">
              画布依赖许可说明 ↗
            </a>
          </details>
        </aside>
      </div>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<CanvasLab />);
