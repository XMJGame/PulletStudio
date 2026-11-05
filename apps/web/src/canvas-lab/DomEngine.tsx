import { useEffect, useRef, useState } from 'react';
import { EngineProps } from './engine-types';
import { nodeHeight, nodeWidth } from './model';
import { NodeCard } from './NodeCard';

type Gesture = {
  mode: 'pan' | 'drag' | 'box';
  x: number;
  y: number;
  viewport: { x: number; y: number; zoom: number };
  positions: Map<string, { x: number; y: number }>;
  selected: string[];
};
export function DomEngine({ board, setBoard, onSelect, port, tool }: EngineProps) {
  const root = useRef<HTMLDivElement>(null),
    gesture = useRef<Gesture | null>(null),
    space = useRef(false);
  const [size, setSize] = useState({ width: 1000, height: 700 });
  const [box, setBox] = useState<{ x: number; y: number; width: number; height: number }>();
  useEffect(() => {
    const element = root.current!;
    const observer = new ResizeObserver((entries) =>
      setSize({ width: entries[0].contentRect.width, height: entries[0].contentRect.height }),
    );
    observer.observe(element);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect(),
        x = event.clientX - rect.left,
        y = event.clientY - rect.top;
      setBoard((old) => {
        const before = old.viewport,
          zoom = Math.max(0.15, Math.min(2, before.zoom * Math.exp(-event.deltaY * 0.0015)));
        return {
          ...old,
          viewport: {
            x: x - ((x - before.x) / before.zoom) * zoom,
            y: y - ((y - before.y) / before.zoom) * zoom,
            zoom,
          },
        };
      });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    const clear = () => {
      space.current = false;
      gesture.current = null;
      setBox(undefined);
    };
    window.addEventListener('blur', clear);
    return () => {
      observer.disconnect();
      element.removeEventListener('wheel', wheel);
      window.removeEventListener('blur', clear);
    };
  }, [setBoard]);
  const visible = board.nodes.filter((node) => {
    const x = node.position.x * board.viewport.zoom + board.viewport.x,
      y = node.position.y * board.viewport.zoom + board.viewport.y;
    return (
      x + nodeWidth * board.viewport.zoom >= 0 &&
      y + nodeHeight * board.viewport.zoom >= 0 &&
      x <= size.width &&
      y <= size.height
    );
  });
  return (
    <div
      className={`lab-dom tool-${tool}`}
      ref={root}
      tabIndex={0}
      role="application"
      aria-label="DOM对照画布"
      style={{
        backgroundSize: `${26 * board.viewport.zoom}px ${26 * board.viewport.zoom}px`,
        backgroundPosition: `${board.viewport.x}px ${board.viewport.y}px`,
      }}
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).closest('button')) return;
        if (event.code === 'Space') {
          event.preventDefault();
          space.current = true;
        }
      }}
      onKeyUp={(event) => {
        if (event.code === 'Space') space.current = false;
      }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest('button')) return;
        const rect = event.currentTarget.getBoundingClientRect(),
          element = (event.target as HTMLElement).closest<HTMLElement>('[data-node-id]');
        const pan = tool === 'pan' || space.current || event.button === 1 || event.button === 2;
        const selected = element
          ? event.shiftKey
            ? [
                ...new Set([
                  ...board.nodes.filter((node) => node.selected).map((node) => node.id),
                  element.dataset.nodeId!,
                ]),
              ]
            : board.nodes.find((node) => node.id === element.dataset.nodeId)?.selected
              ? board.nodes.filter((node) => node.selected).map((node) => node.id)
              : [element.dataset.nodeId!]
          : event.shiftKey
            ? board.nodes.filter((node) => node.selected).map((node) => node.id)
            : [];
        if (!pan) {
          setBoard((old) => ({
            ...old,
            nodes: old.nodes.map((node) => ({ ...node, selected: selected.includes(node.id) })),
          }));
          onSelect(selected);
        }
        gesture.current = {
          mode: pan ? 'pan' : element ? 'drag' : 'box',
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          viewport: board.viewport,
          selected,
          positions: new Map(
            board.nodes.filter((node) => selected.includes(node.id)).map((node) => [node.id, node.position]),
          ),
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus();
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        const state = gesture.current;
        if (!state) return;
        const rect = event.currentTarget.getBoundingClientRect(),
          x = event.clientX - rect.left,
          y = event.clientY - rect.top;
        const dx = x - state.x,
          dy = y - state.y;
        if (state.mode === 'pan')
          setBoard((old) => ({
            ...old,
            viewport: { ...state.viewport, x: state.viewport.x + dx, y: state.viewport.y + dy },
          }));
        if (state.mode === 'drag')
          setBoard((old) => ({
            ...old,
            nodes: old.nodes.map((node) => {
              const start = state.positions.get(node.id);
              return start
                ? {
                    ...node,
                    position: {
                      x: Math.max(-50000, Math.min(50000, start.x + dx / state.viewport.zoom)),
                      y: Math.max(-50000, Math.min(50000, start.y + dy / state.viewport.zoom)),
                    },
                  }
                : node;
            }),
          }));
        if (state.mode === 'box') {
          const area = {
            x: Math.min(state.x, x),
            y: Math.min(state.y, y),
            width: Math.abs(dx),
            height: Math.abs(dy),
          };
          setBox(area);
          const selected = board.nodes
            .filter((node) => {
              const nx = node.position.x * state.viewport.zoom + state.viewport.x,
                ny = node.position.y * state.viewport.zoom + state.viewport.y;
              return (
                state.selected.includes(node.id) ||
                (nx <= area.x + area.width &&
                  nx + nodeWidth * state.viewport.zoom >= area.x &&
                  ny <= area.y + area.height &&
                  ny + nodeHeight * state.viewport.zoom >= area.y)
              );
            })
            .map((node) => node.id);
          setBoard((old) => ({
            ...old,
            nodes: old.nodes.map((node) => ({ ...node, selected: selected.includes(node.id) })),
          }));
          onSelect(selected);
        }
      }}
      onPointerUp={(event) => {
        gesture.current = null;
        setBox(undefined);
        if (event.currentTarget.hasPointerCapture(event.pointerId))
          event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={() => {
        gesture.current = null;
        setBox(undefined);
      }}
    >
      <div
        className="lab-dom-world"
        style={{
          transform: `translate(${board.viewport.x}px, ${board.viewport.y}px) scale(${board.viewport.zoom})`,
        }}
      >
        <svg className="lab-dom-edges" width="1" height="1" aria-label="画布连线">
          {board.edges.map((edge) => {
            const from = board.nodes.find((node) => node.id === edge.source),
              to = board.nodes.find((node) => node.id === edge.target);
            if (!from || !to) return null;
            const x1 = from.position.x + nodeWidth,
              y1 = from.position.y + nodeHeight / 2,
              x2 = to.position.x,
              y2 = to.position.y + nodeHeight / 2;
            return (
              <path
                key={edge.id}
                d={`M${x1},${y1} C${x1 + 100},${y1} ${x2 - 100},${y2} ${x2},${y2}`}
                fill="none"
                stroke="#b69a6e"
                strokeWidth="2"
              />
            );
          })}
        </svg>
        {visible.map((node) => (
          <div
            className={`lab-dom-node ${node.selected ? 'selected' : ''}`}
            key={node.id}
            data-node-id={node.id}
            style={{ left: node.position.x, top: node.position.y }}
            role="button"
            tabIndex={0}
            aria-label={`选择 ${node.data.title}`}
            onKeyDown={(event) => {
              if ((event.target as HTMLElement).tagName === 'BUTTON') return;
              if (event.key === 'Enter') {
                onSelect([node.id]);
                setBoard((old) => ({
                  ...old,
                  nodes: old.nodes.map((item) => ({ ...item, selected: item.id === node.id })),
                }));
              }
              const delta: Record<string, [number, number]> = {
                ArrowLeft: [-10, 0],
                ArrowRight: [10, 0],
                ArrowUp: [0, -10],
                ArrowDown: [0, 10],
              };
              if (delta[event.key]) {
                event.preventDefault();
                event.stopPropagation();
                const [x, y] = delta[event.key];
                setBoard((old) => ({
                  ...old,
                  nodes: old.nodes.map((item) =>
                    item.id === node.id
                      ? { ...item, position: { x: item.position.x + x, y: item.position.y + y } }
                      : item,
                  ),
                }));
              }
            }}
          >
            <button
              className="lab-port in"
              aria-label={`${node.data.title} 输入`}
              onClick={() => port(node.id, 'in')}
            />
            <NodeCard data={node.data} />
            <button
              className="lab-port out"
              aria-label={`${node.data.title} 输出`}
              onClick={() => port(node.id, 'out')}
            />
          </div>
        ))}
      </div>
      {box && (
        <div
          className="lab-selection-box"
          style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
        />
      )}
    </div>
  );
}
