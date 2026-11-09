import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import './library-organization.css';
const minimum = 240;
const defaultWidth = 300;
const maximum = () => Math.max(minimum, Math.min(560, window.innerWidth - 420));
const bounded = (width: number) => Math.max(minimum, Math.min(maximum(), width));
export function ResizableLibrary({ userId, children }: { userId: string; children: ReactNode }) {
  const key = `pullet.library.width.${userId}`;
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(key));
      return bounded(saved >= minimum && saved <= 560 ? saved : defaultWidth);
    } catch {
      return bounded(defaultWidth);
    }
  });
  const drag = useRef<{ x: number; width: number } | undefined>(undefined);
  useEffect(() => {
    const resize = () => setWidth((value) => bounded(value));
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  function change(value: number) {
    const next = Math.round(bounded(value));
    setWidth(next);
    try {
      localStorage.setItem(key, String(next));
    } catch {
      /* Width is an optional local preference. */
    }
  }
  return (
    <div className="v2-library-container" style={{ '--library-width': `${width}px` } as CSSProperties}>
      <div
        className="v2-library-resizer"
        role="separator"
        aria-label="调整资源库宽度"
        aria-orientation="vertical"
        aria-valuemin={minimum}
        aria-valuemax={maximum()}
        aria-valuenow={width}
        tabIndex={0}
        title="拖动调整宽度，双击恢复默认"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          drag.current = { x: event.clientX, width };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current) change(drag.current.width + drag.current.x - event.clientX);
        }}
        onPointerUp={(event) => {
          drag.current = undefined;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onLostPointerCapture={() => {
          drag.current = undefined;
        }}
        onDoubleClick={() => change(defaultWidth)}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 32 : 16;
          if (event.key === 'ArrowLeft') change(width + step);
          else if (event.key === 'ArrowRight') change(width - step);
          else if (event.key === 'Home') change(minimum);
          else if (event.key === 'End') change(maximum());
          else return;
          event.preventDefault();
          event.stopPropagation();
        }}
      />
      {children}
    </div>
  );
}
