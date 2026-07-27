'use client';

/**
 * Refined per-row actions: a single ⋯ trigger that opens a portaled dropdown
 * (fixed-positioned to the trigger, so it is never clipped by the table's
 * horizontal scroll / overflow). Click-outside + Escape + scroll close it.
 * Charter: white surface, hairline border, shadow-elevated, single-teal hover,
 * rose for destructive.
 */
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';

export interface RowAction {
  key: string;
  label: string;
  icon: React.ElementType;
  onClick: () => void;
  variant?: 'default' | 'danger';
  hidden?: boolean;
}

export function RowActionsMenu({ actions }: { actions: RowAction[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const visible = actions.filter((a) => !a.hidden);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const toggle = () => {
    if (open) { setOpen(false); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const MENU_W = 180;
      const left = Math.max(8, Math.min(r.right - MENU_W, window.innerWidth - MENU_W - 8));
      const spaceBelow = window.innerHeight - r.bottom;
      const top = spaceBelow < 200 ? r.top - 4 - Math.min(220, visible.length * 40) : r.bottom + 4;
      setPos({ top, left });
    }
    setOpen(true);
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        className={`rounded-md p-1.5 transition-colors ${open ? 'bg-slate-100 text-slate-700' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700'}`}
        title="Actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
      </button>
      {open && pos && typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            onClick={(e) => e.stopPropagation()}
            style={{ top: pos.top, left: pos.left }}
            className="fixed z-[70] w-[180px] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-elevated"
            role="menu"
          >
            {visible.map((a) => {
              const Icon = a.icon;
              return (
                <button
                  key={a.key}
                  role="menuitem"
                  onClick={() => { setOpen(false); a.onClick(); }}
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${a.variant === 'danger' ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-700 hover:bg-slate-50'}`}
                >
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                  {a.label}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}

export default RowActionsMenu;
