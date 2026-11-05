import { useEffect, useLayoutEffect, useId, useRef, useState, KeyboardEvent } from 'react';
import { Workspace } from '../api';

const roleNames: Record<string, string> = {
  WORKSPACE_OWNER: '所有者',
  WORKSPACE_ADMIN: '管理员',
  MEMBER: '成员',
};
export function WorkspaceMenu({
  workspaces,
  value,
  disabled,
  canCreate,
  onChange,
  onCreate,
  onJoin,
}: {
  workspaces: Workspace[];
  value: string;
  disabled: boolean;
  canCreate: boolean;
  onChange: (value: string) => void;
  onCreate: () => void;
  onJoin: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const workspace = workspaces.find((item) => item.id === value);
  useLayoutEffect(() => {
    if (!open) return;
    ref.current
      ?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"], [role="menuitem"]')
      ?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
    };
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const items = [
      ...(ref.current?.querySelectorAll<HTMLButtonElement>('[role="menu"] button:not(:disabled)') || []),
    ];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const index =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[index]?.focus();
  }
  return (
    <div
      className="workspace-switcher"
      ref={ref}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <span className="workspace-caption">工作区</span>
      <button
        type="button"
        ref={trigger}
        className="workspace-trigger"
        aria-label={`切换工作区：${workspace?.name || '选择工作区'}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="workspace-avatar" aria-hidden="true">
          {workspace?.name.slice(0, 1) || 'P'}
        </span>
        <span className="workspace-trigger-copy">
          <strong>{workspace?.name || '选择工作区'}</strong>
          <small>{roleNames[workspace?.role || 'MEMBER']}</small>
        </span>
        <span className={`workspace-chevron ${open ? 'expanded' : ''}`} aria-hidden="true">
          ⌄
        </span>
      </button>
      {open && (
        <div id={menuId} role="menu" aria-label="工作区菜单" className="workspace-menu" onKeyDown={keyboard}>
          <div className="menu-caption">切换工作区</div>
          <div className="workspace-menu-list">
            {workspaces.map((item) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={item.id === value}
                key={item.id}
                onClick={() => {
                  onChange(item.id);
                  close();
                }}
              >
                <span className="workspace-avatar" aria-hidden="true">
                  {item.name.slice(0, 1)}
                </span>
                <span className="workspace-trigger-copy">
                  <strong>{item.name}</strong>
                  <small>{roleNames[item.role]}</small>
                </span>
                <span className="workspace-check" aria-hidden="true">
                  {item.id === value ? '✓' : ''}
                </span>
              </button>
            ))}
          </div>
          <div role="separator" className="menu-separator" />
          {canCreate && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                close();
                onCreate();
              }}
            >
              <span aria-hidden="true">＋</span>新建工作区
            </button>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              onJoin();
            }}
          >
            <span aria-hidden="true">↗</span>加入工作区
          </button>
        </div>
      )}
    </div>
  );
}
