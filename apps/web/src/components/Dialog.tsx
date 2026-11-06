import { ReactNode, useContext, useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { StudioTheme } from '../shared/ui/StudioTheme';
import '../shared/styles/studio-dialog.css';

export function Dialog({
  title,
  description,
  busy = false,
  onClose,
  children,
  className = '',
  hideHeader = false,
  theme,
}: {
  title: string;
  description: string;
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  hideHeader?: boolean;
  theme?: 'light' | 'dark';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const appTheme = useContext(StudioTheme);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previousFocus = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = 'hidden';
    [...dialog.querySelectorAll<HTMLElement>('[data-autofocus]')]
      .find((element) => element.getClientRects().length > 0 && !element.matches(':disabled'))
      ?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className={`studio-dialog studio-v2 studio-modal ${className}`.trim()}
      data-theme={theme ?? appTheme}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'button, input, select, textarea, a[href], [tabindex]',
          ),
        ].filter(
          (item) => item.tabIndex >= 0 && !item.matches(':disabled') && item.getClientRects().length > 0,
        );
        const first = controls[0];
        const last = controls.at(-1);
        if (
          event.shiftKey &&
          (document.activeElement === first || document.activeElement === event.currentTarget)
        ) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget || busy) return;
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        )
          onClose();
      }}
    >
      {hideHeader ? (
        <div className="v2-sr">
          <h2 id={titleId}>{title}</h2>
          <p id={descriptionId}>{description}</p>
        </div>
      ) : (
        <div className="dialog-header">
          <div>
            <h2 id={titleId}>{title}</h2>
            <p id={descriptionId}>{description}</p>
          </div>
          <button
            type="button"
            className="dialog-close"
            aria-label="关闭对话框"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </div>
      )}
      {children}
    </dialog>,
    document.body,
  );
}
