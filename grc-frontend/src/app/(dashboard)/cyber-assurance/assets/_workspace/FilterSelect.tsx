'use client';

/**
 * Branded dropdown for the inventory filter bar — replaces the native <select>
 * so the option list can be styled (the active option renders blue/white/bold,
 * matching the table header). Popup is portaled to <body> (fixed-positioned to
 * the trigger) so the table's horizontal scroll / overflow never clips it, and
 * so the dashboard zoom wrapper doesn't shrink the list. Click-outside + Escape
 * + scroll close it. Classes (.fsel*) live in inventory-redesign.css, global so
 * the portaled popup picks them up.
 */
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

export interface SelOption { value: string; label: string; }

export function FilterSelect({ value, onChange, options, title, minWidth = 160 }: {
  value: string;
  onChange: (v: string) => void;
  options: SelOption[];
  title?: string;
  minWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value) || options[0];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      if (menuRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const close = () => setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const toggle = () => {
    if (open) { setOpen(false); return; }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const width = Math.max(r.width, minWidth);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      const estH = Math.min(320, options.length * 36 + 8);
      const spaceBelow = window.innerHeight - r.bottom;
      const top = spaceBelow < estH + 8 ? Math.max(8, r.top - 4 - estH) : r.bottom + 4;
      setPos({ top, left, width });
    }
    setOpen(true);
  };

  return (
    <>
      <button ref={btnRef} type="button" title={title}
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        className={'fsel' + (open ? ' open' : '')} aria-haspopup="listbox" aria-expanded={open}>
        <span className="fsel-lbl">{current?.label}</span>
        <ChevronDown size={15} className="fsel-chev" strokeWidth={2} />
      </button>
      {open && pos && typeof document !== 'undefined' && createPortal(
        <div ref={menuRef} role="listbox" onClick={(e) => e.stopPropagation()}
          style={{ top: pos.top, left: pos.left, width: pos.width }} className="fsel-pop">
          {options.map((o) => (
            <button key={o.value} type="button" role="option" aria-selected={o.value === value}
              onClick={() => { setOpen(false); onChange(o.value); }}
              className={'fsel-opt' + (o.value === value ? ' on' : '')}>
              <span className="fsel-opt-lbl">{o.label}</span>
              {o.value === value && <Check size={15} strokeWidth={2.5} />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

export default FilterSelect;
