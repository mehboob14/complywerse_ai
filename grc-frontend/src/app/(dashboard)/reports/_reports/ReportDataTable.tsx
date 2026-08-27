'use client';

import { Fragment, useMemo, useRef } from 'react';
import Link from 'next/link';
import {
  ArrowDown, ArrowUp, ChevronsUpDown, GripVertical, Pin,
} from 'lucide-react';
import type { ColumnDef, Row, SortSpec } from './types';
import { cellAlign, cellDisplay } from './builderUtils';
import { aggregate, groupRows, numericValue, rawValue } from './grid-utils';

/** A cell value that is really a list — an array, or the server's "; "-joined
 *  multi-value string (linkage / cross-module fields only) — split into atomic
 *  parts. Returns null for a genuine single value so plain text is untouched. */
function toValueList(c: ColumnDef, raw: unknown, text: string): string[] | null {
  if (Array.isArray(raw)) {
    const items = raw.map((x) => String(x).trim()).filter(Boolean);
    return items.length ? items : null;
  }
  const multiField = c.key.includes('_names') || !!c.linkageModule;
  const s = typeof raw === 'string' ? raw : text;
  if (multiField && typeof s === 'string' && s.includes('; ')) {
    return s.split(';').map((x) => x.trim()).filter(Boolean);
  }
  return null;
}

/** Production flat table — resize, reorder, pin, sort, group, totals. */
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
  groupByKey = null,
  showTotals = false,
  totalInDataset,
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
  groupByKey?: string | null;
  showTotals?: boolean;
  totalInDataset?: number;
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

  // Header field name (clean — no module prefix). When two visible columns share
  // the same name (a cross-module combine), the source module is shown as a small
  // eyebrow ABOVE only those colliding headers — nothing ambiguous, no "(Module)"
  // suffix cluttering every header.
  const headerLabel = (c: ColumnDef) => labelFor?.(c.key) ?? c.label;
  const labelCounts = new Map<string, number>();
  for (const c of ordered) {
    const l = headerLabel(c);
    labelCounts.set(l, (labelCounts.get(l) ?? 0) + 1);
  }

  const groupCol = groupByKey ? cols.find((c) => c.key === groupByKey) ?? null : null;
  const groups = useMemo(
    () => (groupCol ? groupRows(groupCol, rows) : null),
    [groupCol, rows],
  );

  const maxByCol = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of ordered) {
      if (c.type !== 'number') continue;
      let max = 0;
      for (const r of rows) {
        const n = numericValue(c, r);
        if (n != null) max = Math.max(max, Math.abs(n));
      }
      m.set(c.key, max || 1);
    }
    return m;
  }, [ordered, rows]);

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

  const renderCell = (c: ColumnDef, row: Row) => {
    const text = cellDisplay(c, row);
    const href = c.href?.(row);
    const raw = c.accessor ? c.accessor(row) : rawValue(c, row);
    const tone = c.badgeTone?.(raw);
    const a = cellAlign(c, align);

    if (c.type === 'badge') {
      return (
        <span
          className={`inline-block max-w-full truncate rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            tone || 'border-slate-200 bg-slate-50 text-slate-700'
          }`}
        >
          {text || '—'}
        </span>
      );
    }

    if (c.type === 'number') {
      const n = numericValue(c, row);
      const max = maxByCol.get(c.key) || 1;
      const pct = n == null ? 0 : Math.min(100, (Math.abs(n) / max) * 100);
      const barTone =
        pct >= 75 ? 'bg-rose-400' : pct >= 45 ? 'bg-amber-400' : pct >= 20 ? 'bg-primary-400' : 'bg-emerald-400';
      return (
        <div className={`flex min-w-0 items-center gap-2 ${a === 'right' ? 'justify-end' : ''}`}>
          <span className="tabular-nums text-slate-800">{text}</span>
          {n != null && (
            <span className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-slate-100">
              <span className={`block h-full rounded-full ${barTone}`} style={{ width: `${pct}%` }} />
            </span>
          )}
        </div>
      );
    }

    // Atomic display: a multi-value cell (array or "; "-joined linkage list)
    // becomes one chip per value instead of a single mashed string.
    const list = toValueList(c, raw, text);
    if (list && list.length > 1) {
      return (
        <div className="flex flex-wrap gap-1">
          {list.map((v, i) => (
            <span
              key={i}
              title={v}
              className={`inline-block max-w-[180px] truncate rounded-full border px-2 py-0.5 text-[11px] ${
                /^\+\d+/.test(v)
                  ? 'border-slate-200 bg-slate-100 text-slate-500'
                  : 'border-slate-200 bg-slate-50 text-slate-700'
              }`}
            >
              {v}
            </span>
          ))}
        </div>
      );
    }

    if (href) {
      // Open the record in a new tab so the built report stays intact — closing
      // the tab (or switching back) returns you to Reports with the report as-is.
      return (
        <Link
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title="Open in a new tab"
          className="font-medium text-primary-700 hover:underline"
        >
          {text}
        </Link>
      );
    }
    return text;
  };

  const renderRow = (row: Row, i: number) => (
    <tr key={String(row.id ?? i)} className="border-t border-slate-100 hover:bg-slate-50/80">
      {ordered.map((c) => {
        const text = cellDisplay(c, row);
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
            className={`truncate px-3 py-2 text-slate-800 ${a === 'right' ? 'text-right' : ''}`}
            title={text}
          >
            {renderCell(c, row)}
          </td>
        );
      })}
    </tr>
  );

  const numericCols = ordered.filter((c) => c.type === 'number');

  const groupSummary = (groupRowsList: Row[]) => {
    if (!numericCols.length) return `${groupRowsList.length} row${groupRowsList.length === 1 ? '' : 's'}`;
    const parts = numericCols.slice(0, 3).map((c) => {
      const mode = c.agg === 'avg' ? 'avg' : 'Σ';
      const colForAgg = { ...c, agg: c.agg ?? 'sum' as const };
      return `${mode} ${c.label.toLowerCase()} ${aggregate(colForAgg, groupRowsList)}`;
    });
    return parts.join(' · ');
  };

  if (!ordered.length) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
        Select at least one column in the field browser.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-max min-w-full table-fixed border-collapse text-sm">
          <thead className="sticky top-0 z-20 bg-slate-50 shadow-[0_1px_0_#e2e8f0]">
            <tr>
              {ordered.map((c) => {
                const pinnedCol = isPinned(c.key);
                const a = cellAlign(c, align);
                const sorted = sorts.find((s) => s.key === c.key);
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
                    className={`group relative select-none border-b border-slate-200 px-0 py-0 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 ${
                      pinnedCol ? 'bg-slate-50 shadow-[1px_0_0_0_#e2e8f0]' : ''
                    }`}
                  >
                    <div className="flex items-center gap-0.5 px-2 py-2.5">
                      {onReorder && (
                        <span
                          draggable
                          onDragStart={() => {
                            dragKey.current = c.key;
                          }}
                          className="cursor-grab text-slate-300 hover:text-slate-500"
                        >
                          <GripVertical className="h-3.5 w-3.5" />
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => onSort?.(c.key, e.shiftKey)}
                        className={`flex min-w-0 flex-1 items-center gap-1 ${a === 'right' ? 'justify-end' : ''}`}
                        title={onSort ? 'Click to sort · Shift+click for multi-sort' : undefined}
                      >
                        <span className={`flex min-w-0 flex-col leading-tight ${a === 'right' ? 'items-end' : ''}`}>
                          {c.linkageModule && (labelCounts.get(headerLabel(c)) ?? 0) > 1 && (
                            <span
                              className="truncate text-[9px] font-semibold uppercase tracking-wide text-slate-400"
                              title={c.linkageModule}
                            >
                              {c.linkageModule}
                            </span>
                          )}
                          <span className="truncate">{headerLabel(c)}</span>
                        </span>
                        {onSort && sortIcon(c.key)}
                      </button>
                      {pinnedCol && <Pin className="h-3 w-3 shrink-0 text-primary-500" />}
                      {sorted && (
                        <span className="rounded bg-primary-100 px-1 text-[9px] font-bold text-primary-800">
                          {sorted.dir === 'asc' ? '↑' : '↓'}
                        </span>
                      )}
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
            ) : groups ? (
              groups.map((g) => (
                <Fragment key={`g-${g.key}`}>
                  <tr className="border-t border-slate-200 bg-slate-50/90">
                    <td colSpan={ordered.length} className="px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-800 ring-1 ring-slate-200">
                            {g.key}
                          </span>
                          <span className="text-[11px] text-slate-500">
                            {g.rows.length} {groupCol?.label?.toLowerCase() || 'items'}
                          </span>
                        </div>
                        <span className="text-[11px] tabular-nums text-slate-500">{groupSummary(g.rows)}</span>
                      </div>
                    </td>
                  </tr>
                  {g.rows.map((row, i) => renderRow(row, i))}
                </Fragment>
              ))
            ) : (
              rows.map((row, i) => renderRow(row, i))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-slate-200 bg-slate-50/80 px-3 py-2 text-[11px] text-slate-500">
        <span>
          {rows.length.toLocaleString()} row{rows.length === 1 ? '' : 's'} match
          {totalInDataset != null && totalInDataset !== rows.length
            ? ` · ${totalInDataset.toLocaleString()} in dataset`
            : ''}
          {groups ? ` · ${groups.length} groups` : ''}
        </span>
        {showTotals && numericCols.length > 0 && rows.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 font-medium text-slate-700">
            {numericCols.slice(0, 4).map((c) => {
              const colForAgg = { ...c, agg: c.agg ?? 'sum' as const };
              const avgCol = { ...c, agg: 'avg' as const };
              return (
                <span key={c.key} className="tabular-nums">
                  Σ {c.label} {aggregate(colForAgg, rows)}
                  {c.agg === 'avg' || /residual|score|rating/i.test(c.label) ? (
                    <span className="ml-2 text-slate-500">avg {aggregate(avgCol, rows)}</span>
                  ) : null}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
