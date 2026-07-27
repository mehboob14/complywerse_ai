'use client';

import { useMemo, useRef } from 'react';
import Link from 'next/link';
import {
  ArrowDown, ArrowUp, ChevronsUpDown, GripVertical, Pin,
} from 'lucide-react';
import type { ColumnDef, Row, SortSpec } from './types';
import { cellAlign, cellDisplay } from './builderUtils';

/** Production flat table — resize, reorder, pin, sort, align. */
export default function ReportDataTable({
  cols,
  rows,
  visibleKeys,
  widths = {},
  onWidthsChange,
  align = {},
  pinned = [],
  onReorder,
  sorts = [],
  onSort,
  labelFor,
}: {
  cols: ColumnDef[];
  rows: Row[];
  visibleKeys: string[];
  widths?: Record<string, number>;
  onWidthsChange?: (w: Record<string, number>) => void;
  align?: Record<string, 'left' | 'right'>;
  pinned?: string[];
  onReorder?: (keys: string[]) => void;
  sorts?: SortSpec[];
  onSort?: (key: string, additive: boolean) => void;
  labelFor?: (key: string) => string;
}) {
  const dragKey = useRef<string | null>(null);
  const resizing = useRef<{ key: string; startX: number; startW: number } | null>(null);

  const colWidth = (c: ColumnDef) => widths[c.key] ?? c.width ?? 140;
  const isPinned = (key: string) => pinned.includes(key);

  const ordered = useMemo(() => {
    const shown = visibleKeys
      .map((k) => cols.find((c) => c.key === k))
      .filter((c): c is ColumnDef => !!c);
    const pin = pinned.map((k) => shown.find((c) => c.key === k)).filter((c): c is ColumnDef => !!c);
    const rest = shown.filter((c) => !pinned.includes(c.key));
    return [...pin, ...rest];
  }, [visibleKeys, cols, pinned]);

  const leftOf = (c: ColumnDef) => {
    let x = 0;
    for (const p of ordered) {
      if (p.key === c.key) return x;
      if (isPinned(p.key)) x += colWidth(p);
    }
    return 0;
  };

  const reorderCol = (from: string, to: string) => {
    if (!onReorder || from === to) return;
    const base = visibleKeys.slice();
    const fi = base.indexOf(from);
    const ti = base.indexOf(to);
    if (fi < 0 || ti < 0) return;
    base.splice(ti, 0, base.splice(fi, 1)[0]);
    onReorder(base);
  };

  const startResize = (e: React.MouseEvent, c: ColumnDef) => {
    if (!onWidthsChange) return;
    e.preventDefault();
    e.stopPropagation();
    resizing.current = { key: c.key, startX: e.clientX, startW: colWidth(c) };
    const move = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const w = Math.max(64, resizing.current.startW + (ev.clientX - resizing.current.startX));
      onWidthsChange({ ...widths, [resizing.current.key]: w });
    };
    const up = () => {
      resizing.current = null;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  const sortIcon = (key: string) => {
    const s = sorts.find((x) => x.key === key);
    if (!s) return <ChevronsUpDown className="h-3 w-3 opacity-40" />;
    return s.dir === 'asc'
      ? <ArrowUp className="h-3 w-3 text-primary-600" />
      : <ArrowDown className="h-3 w-3 text-primary-600" />;
  };

  if (!ordered.length) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
        Select at least one column in the builder panel.
      </div>
    );
  }

  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-max min-w-full table-fixed border-collapse text-sm">
        <thead className="sticky top-0 z-20 bg-slate-50 shadow-[0_1px_0_#e2e8f0]">
          <tr>
            {ordered.map((c) => {
              const pinnedCol = isPinned(c.key);
              const a = cellAlign(c, align);
              return (
                <th
                  key={c.key}
                  style={{
                    width: colWidth(c),
                    minWidth: colWidth(c),
                    maxWidth: colWidth(c),
                    ...(pinnedCol ? { position: 'sticky', left: leftOf(c), zIndex: 30 } : {}),
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragKey.current && dragKey.current !== c.key) reorderCol(dragKey.current, c.key);
                    dragKey.current = null;
                  }}
                  className={`group relative select-none border-b border-slate-200 px-0 py-0 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 ${pinnedCol ? 'bg-slate-50 shadow-[1px_0_0_0_#e2e8f0]' : ''}`}
                >
                  <div className="flex items-center gap-0.5 px-2 py-2.5">
                    {onReorder && (
                      <span
                        draggable
                        onDragStart={() => { dragKey.current = c.key; }}
                        className="cursor-grab text-slate-300 hover:text-slate-500"
                      >
                        <GripVertical className="h-3.5 w-3.5" />
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => onSort?.(c.key, e.shiftKey)}
                      className={`flex min-w-0 flex-1 items-center gap-1 truncate ${a === 'right' ? 'justify-end' : ''}`}
                      title={onSort ? 'Click to sort · Shift+click for multi-sort' : undefined}
                    >
                      <span className="truncate">{labelFor?.(c.key) ?? c.label}</span>
                      {onSort && sortIcon(c.key)}
                    </button>
                    {pinnedCol && <Pin className="h-3 w-3 shrink-0 text-primary-500" />}
                  </div>
                  {onWidthsChange && (
                    <span
                      onMouseDown={(e) => startResize(e, c)}
                      className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-primary-200/40"
                    />
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={ordered.length} className="px-3 py-10 text-center text-slate-400">
                No rows match your filters.
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={String(row.id ?? i)} className="border-t border-slate-100 hover:bg-slate-50/80">
                {ordered.map((c) => {
                  const text = cellDisplay(c, row);
                  const href = c.href?.(row);
                  const tone = c.badgeTone?.(c.accessor ? c.accessor(row) : row[c.key]);
                  const a = cellAlign(c, align);
                  const pinnedCol = isPinned(c.key);
                  return (
                    <td
                      key={c.key}
                      style={{
                        width: colWidth(c),
                        minWidth: colWidth(c),
                        maxWidth: colWidth(c),
                        ...(pinnedCol ? { position: 'sticky', left: leftOf(c), zIndex: 10, background: 'white' } : {}),
                      }}
                      className={`truncate px-3 py-2 text-slate-800 ${a === 'right' ? 'text-right tabular-nums' : ''}`}
                      title={text}
                    >
                      {c.type === 'badge' && tone ? (
                        <span className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}>
                          {text}
                        </span>
                      ) : href ? (
                        <Link href={href} className="text-primary-700 hover:underline">{text}</Link>
                      ) : (
                        text
                      )}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
      {rows.length > 0 && (
        <p className="border-t border-slate-100 px-3 py-2 text-[11px] text-slate-400">
          Showing {rows.length.toLocaleString()} row{rows.length === 1 ? '' : 's'}
          {onReorder && ' · Drag headers to reorder · Drag edge to resize'}
        </p>
      )}
    </div>
  );
}
