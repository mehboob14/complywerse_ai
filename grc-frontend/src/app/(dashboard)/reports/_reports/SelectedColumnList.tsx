'use client';

import { useRef } from 'react';
import { AlignLeft, AlignRight, ChevronDown, ChevronUp, GripVertical, Pin, PinOff, X } from 'lucide-react';
import type { ColumnDef } from './types';
import { cellAlign } from './builderUtils';

/** Reorderable list of selected columns with align + pin controls. */
export default function SelectedColumnList({
  cols,
  visibleKeys,
  align,
  pinned,
  onReorder,
  onRemove,
  onAlign,
  onPin,
}: {
  cols: ColumnDef[];
  visibleKeys: string[];
  align: Record<string, 'left' | 'right'>;
  pinned: string[];
  onReorder: (keys: string[]) => void;
  onRemove: (key: string) => void;
  onAlign: (key: string, align: 'left' | 'right') => void;
  onPin: (key: string) => void;
}) {
  const dragKey = useRef<string | null>(null);

  const reorder = (from: string, to: string) => {
    const base = visibleKeys.slice();
    const fi = base.indexOf(from);
    const ti = base.indexOf(to);
    if (fi < 0 || ti < 0 || fi === ti) return;
    base.splice(ti, 0, base.splice(fi, 1)[0]);
    onReorder(base);
  };

  const move = (key: string, dir: -1 | 1) => {
    const i = visibleKeys.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= visibleKeys.length) return;
    const base = visibleKeys.slice();
    [base[i], base[j]] = [base[j], base[i]];
    onReorder(base);
  };

  if (!visibleKeys.length) {
    return <p className="text-[10px] text-slate-400">No columns selected yet.</p>;
  }

  return (
    <div className="max-h-[160px] space-y-1 overflow-auto">
      {visibleKeys.map((key, idx) => {
        const col = cols.find((c) => c.key === key);
        if (!col) return null;
        const a = cellAlign(col, align);
        const isPinned = pinned.includes(key);
        return (
          <div
            key={key}
            draggable
            onDragStart={() => { dragKey.current = key; }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (dragKey.current && dragKey.current !== key) reorder(dragKey.current, key);
              dragKey.current = null;
            }}
            className={`flex items-center gap-1 rounded-md border px-1.5 py-1 ${isPinned ? 'border-primary-200 bg-primary-50/50' : 'border-slate-200 bg-white'}`}
          >
            <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-slate-300" />
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-700" title={col.label}>
              {col.label}
              {col.linkageKey && <span className="ml-1 text-[9px] text-primary-500">linked</span>}
            </span>
            <button type="button" onClick={() => onAlign(key, a === 'left' ? 'right' : 'left')} title={`Align ${a === 'left' ? 'right' : 'left'}`}
              className="rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              {a === 'right' ? <AlignRight className="h-3 w-3" /> : <AlignLeft className="h-3 w-3" />}
            </button>
            <button type="button" onClick={() => onPin(key)} title={isPinned ? 'Unpin' : 'Pin left'}
              className={`rounded p-0.5 ${isPinned ? 'text-primary-600' : 'text-slate-400 hover:bg-slate-100'}`}>
              {isPinned ? <Pin className="h-3 w-3" /> : <PinOff className="h-3 w-3" />}
            </button>
            <button type="button" onClick={() => move(key, -1)} disabled={idx === 0} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30">
              <ChevronUp className="h-3 w-3" />
            </button>
            <button type="button" onClick={() => move(key, 1)} disabled={idx === visibleKeys.length - 1} className="rounded p-0.5 text-slate-400 hover:bg-slate-100 disabled:opacity-30">
              <ChevronDown className="h-3 w-3" />
            </button>
            <button type="button" onClick={() => onRemove(key)} className="rounded p-0.5 text-slate-300 hover:bg-rose-50 hover:text-rose-600">
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
