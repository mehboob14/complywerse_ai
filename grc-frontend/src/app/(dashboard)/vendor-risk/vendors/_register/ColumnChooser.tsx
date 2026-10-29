'use client';

// The Register's column chooser: a button that says how many of the optional columns show, and a checklist of them. The vendor and
// its next action are always there, so they are not listed. The pick is kept by the page (this browser only).

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, SlidersHorizontal } from 'lucide-react';
import { BTN } from '../../_ui';
import { COLUMNS, columnCount, toggleColumn, type ColumnId } from '../../_lib/registerModel';

export default function ColumnChooser({ visible, onChange }: { visible: ColumnId[]; onChange: (next: ColumnId[]) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      root.current?.querySelector<HTMLElement>('button')?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const { shown, total } = columnCount(visible);
  return (
    <div ref={root} className="relative">
      <button type="button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={BTN}>
        <SlidersHorizontal aria-hidden className="h-4 w-4" strokeWidth={1.75} />
        Columns
        {shown < total && <span className="text-[12px] font-normal tabular-nums text-[#64707e]">{shown}/{total}</span>}
        <ChevronDown aria-hidden className="h-3.5 w-3.5 opacity-70" />
      </button>
      {open && (
        <div role="group" aria-label="Columns" className="absolute right-0 z-30 mt-1.5 w-60 rounded-xl border border-[#d5dbe1] bg-[#fff] p-1 shadow-elevated">
          {COLUMNS.filter((c) => !c.always).map((c) => {
            const on = visible.includes(c.id);
            return (
              <label key={c.id} className="relative flex min-h-9 cursor-pointer items-center rounded-md py-1.5 pl-8 pr-3 text-sm text-[#26323d] hover:bg-[#f3f6f8] has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-[#0f766e]">
                <input type="checkbox" checked={on} onChange={() => onChange(toggleColumn(visible, c.id))} className="sr-only" />
                <span aria-hidden className="absolute left-2.5 grid h-4 w-4 place-items-center">
                  {on && <Check className="h-4 w-4 text-[#0f766e]" strokeWidth={2.25} />}
                </span>
                <span className={on ? 'font-medium' : undefined}>{c.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
