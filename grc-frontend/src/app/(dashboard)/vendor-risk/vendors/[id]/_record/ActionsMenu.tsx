'use client';

// The "Actions" menu in a record's header: a button that opens a short list, drawn on top of the page (a portal, fixed to the button,
// so no card or scroller clips it). Arrow keys move, Escape and a click outside close it and hand focus back. A separator and a red
// item mark the one destructive step. Explicit hex: the platform CSS repaints slate and white utilities (PITFALLS 100).
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import { BTN } from '../../../_ui';

export interface MenuItem {
  key: string;
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  /** the destructive step: red, and set off by a line above it */
  danger?: boolean;
  hidden?: boolean;
}

const WIDTH = 240;

export default function ActionsMenu({ label = 'Actions', items }: { label?: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const shown = items.filter((i) => !i.hidden);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent) => {
      if (!trigger.current?.contains(e.target as Node) && !menu.current?.contains(e.target as Node)) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', away);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', away);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const toggle = () => {
    if (open) { setOpen(false); return; }
    const r = trigger.current?.getBoundingClientRect();
    if (r) setAt({ top: r.bottom + 4, left: Math.max(8, Math.min(r.right - WIDTH, window.innerWidth - WIDTH - 8)) });
    setOpen(true);
  };

  const onKey = (e: KeyboardEvent) => {
    const els = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const now = els.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); setOpen(false); trigger.current?.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); els[(now + 1) % els.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); els[(now - 1 + els.length) % els.length]?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  };

  if (shown.length === 0) return null;
  return (
    <>
      <button ref={trigger} type="button" onClick={toggle} aria-haspopup="menu" aria-expanded={open} className={BTN}>
        {label}
        <ChevronDown aria-hidden className="h-4 w-4" strokeWidth={2} />
      </button>
      {open && at && typeof document !== 'undefined' && createPortal(
        <div
          ref={menu}
          role="menu"
          aria-label={label}
          onKeyDown={onKey}
          style={{ top: at.top, left: at.left, width: WIDTH }}
          className="fixed z-[70] overflow-hidden rounded-lg border border-[#d5dbe1] bg-[#fff] py-1 shadow-elevated"
        >
          {shown.map((item, i) => {
            const Icon = item.icon;
            return (
              <div key={item.key}>
                {item.danger && i > 0 && <div role="separator" className="my-1 border-t border-[#e1e6eb]" />}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setOpen(false); item.onSelect(); }}
                  className={clsx(
                    'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm focus-visible:outline-none',
                    item.danger ? 'text-[#b42318] hover:bg-[#fef3f2] focus-visible:bg-[#fef3f2]' : 'text-[#26323d] hover:bg-[#f3f6f8] focus-visible:bg-[#f3f6f8]',
                  )}
                >
                  {Icon && <Icon aria-hidden className="h-4 w-4 shrink-0" strokeWidth={1.75} />}
                  {item.label}
                </button>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}
