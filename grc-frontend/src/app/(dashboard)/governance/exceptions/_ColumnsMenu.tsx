'use client';

// The Columns tool: an icon button that opens a small panel of tick boxes, one per column that may be hidden (the title and the actions always show).
// The panel is portaled and fixed, so no scroller clips it; Escape, a press elsewhere, a scroll or a resize closes it, and focus goes into it when it
// opens and back to the button when it closes. (The kit's register drops columns by window width by itself; this is the person's own choice on top
// of that, as the page always had. A column chooser is a kit gap: promote it when a second register needs one.)
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Columns3 } from 'lucide-react';
import { Checkbox, IconButton } from '@/components/ui/ds';

export function ColumnsMenu({ columns, hidden, onToggle }: { columns: { key: string; header: string }[]; hidden: string[]; onToggle: (key: string) => void }) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const open = at !== null;

  useEffect(() => {
    if (!open) return undefined;
    const away = () => setAt(null);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!button.current?.contains(target) && !panel.current?.contains(target)) away();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setAt(null); button.current?.focus(); } };
    const onScroll = (e: Event) => { if (!panel.current?.contains(e.target as Node)) away(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', away);
    };
  }, [open]);

  // the panel is at the end of the page for the keyboard, so focus moves into it when it opens
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>('input')?.focus({ preventScroll: true });
  }, [open]);

  const toggle = () => {
    if (open) { setAt(null); return; }
    const r = button.current?.getBoundingClientRect();
    if (r) setAt({ left: Math.max(8, Math.min(r.right - 224, window.innerWidth - 232)), top: r.bottom + 6 });
  };

  return (
    <>
      <IconButton ref={button} label="Columns" variant="secondary" aria-haspopup="dialog" aria-expanded={open} onClick={toggle}><Columns3 aria-hidden /></IconButton>
      {at && createPortal(
        <div
          ref={panel}
          role="dialog"
          aria-label="Columns"
          style={{ left: at.left, top: at.top }}
          className="fixed z-[70] w-[224px] rounded-ds-card border border-ds-border bg-ds-surface p-[8px] shadow-ds-pop"
        >
          <p className="px-[8px] pb-1 text-ds-label text-ds-fg-muted">Columns</p>
          {columns.map((c) => (
            <Checkbox key={c.key} label={c.header} className="w-full px-[8px]" checked={!hidden.includes(c.key)} onChange={() => onToggle(c.key)} />
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
