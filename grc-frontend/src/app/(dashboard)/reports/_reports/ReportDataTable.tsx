'use client';

// The rows of a report as a table: sort (click a header, Shift for a second column), resize, reorder by drag, pin to the left, group, totals. New in the workspace: it is PAGED (a register of 5,000 rows is
// no longer drawn as 5,000 rows), the numbers in the footer still describe every matching row, a partial load says so in the footer, and the whole table is the kit's (tokens, 12px text, sort buttons that
// are real buttons with a target a finger can hit). The print view draws the same table with `paged={false}`.
import { Fragment, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { ArrowDown, ArrowUp, ChevronsUpDown, GripVertical, Pin } from 'lucide-react';
import { Pager, StatusPill } from '@/components/ui/ds';
import { formatCount } from '@/lib/format';
import type { ColumnDef, Row, SortSpec } from './types';
import { cellAlign, cellDisplay } from './builderUtils';
import { aggregate, groupRows, numericValue, rawValue } from './grid-utils';
import { cellTone } from './cellTone';

/** A cell value that is really a list — an array, or the server's "; "-joined multi-value string (linkage / cross-module fields only) — split into atomic parts. Null for a genuine single value. */
function toValueList(c: ColumnDef, raw: unknown, text: string): string[] | null {
  if (Array.isArray(raw)) {
    const items = raw.map((x) => String(x).trim()).filter(Boolean);
    return items.length ? items : null;
  }
  const multiField = c.key.includes('_names') || !!c.linkageModule;
  const s = typeof raw === 'string' ? raw : text;
  if (multiField && typeof s === 'string' && s.includes('; ')) return s.split(';').map((x) => x.trim()).filter(Boolean);
  return null;
}

const PAGE_SIZES = [25, 50, 100, 250] as const;
const TH = 'group relative select-none border-b border-ds-border bg-ds-surface-subtle p-0 text-left align-middle !text-ds-label !text-ds-fg-muted';
const TD = 'truncate border-t border-ds-border px-[12px] py-[8px] align-middle !text-ds-body !text-ds-fg-body';

export default function ReportDataTable({
  cols, rows, visibleKeys, widths = {}, onWidthsChange, align = {}, pinned = [], onReorder, sorts = [], onSort, labelFor, groupByKey = null, showTotals = false, totalInDataset, paged = true, loadNote,
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
  /** false for print: every row, no pager */
  paged?: boolean;
  /** what the footer says when the rows are only part of the register ("first 5,000 of 5,310 rows") */
  loadNote?: string;
}) {
  const dragKey = useRef<string | null>(null);
  const resizing = useRef<{ key: string; startX: number; startW: number } | null>(null);
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState<number>(100);

  const colWidth = (c: ColumnDef) => widths[c.key] ?? c.width ?? 140;
  const isPinned = (key: string) => pinned.includes(key);

  const ordered = useMemo(() => {
    const shown = visibleKeys.map((k) => cols.find((c) => c.key === k)).filter((c): c is ColumnDef => !!c);
    const pin = pinned.map((k) => shown.find((c) => c.key === k)).filter((c): c is ColumnDef => !!c);
    return [...pin, ...shown.filter((c) => !pinned.includes(c.key))];
  }, [visibleKeys, cols, pinned]);

  // When two visible columns share a name (a cross-module combine), the source module is shown as a small line above only those headers.
  const headerLabel = (c: ColumnDef) => labelFor?.(c.key) ?? c.label;
  const labelCounts = new Map<string, number>();
  for (const c of ordered) labelCounts.set(headerLabel(c), (labelCounts.get(headerLabel(c)) ?? 0) + 1);

  const groupCol = groupByKey ? cols.find((c) => c.key === groupByKey) ?? null : null;
  const groups = useMemo(() => (groupCol ? groupRows(groupCol, rows) : null), [groupCol, rows]);
  // the order the rows are drawn in: grouped rows are gathered, so a page of them is a run of whole groups (the last may continue on the next page)
  const flat = useMemo(() => (groups ? groups.flatMap((g) => g.rows) : rows), [groups, rows]);

  const maxByCol = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of ordered) {
      if (c.type !== 'number' || c.key === 'id' || /^id$/i.test(c.label)) continue;
      let max = 0;
      for (const r of rows) {
        const n = numericValue(c, r);
        if (n != null) max = Math.max(max, Math.abs(n));
      }
      m.set(c.key, max || 1);
    }
    return m;
  }, [ordered, rows]);

  // back to the first page when what is listed changes
  const viewKey = `${rows.length}|${sorts.map((s) => `${s.key}${s.dir}`).join(',')}|${groupByKey ?? ''}|${pageSize}|${visibleKeys.length}`;
  const [seen, setSeen] = useState(viewKey);
  if (seen !== viewKey) { setSeen(viewKey); setPageNo(1); }
  const pages = paged ? Math.max(1, Math.ceil(flat.length / pageSize)) : 1;
  const page = Math.min(Math.max(1, pageNo), pages);
  const shownRows = useMemo(() => (paged ? flat.slice((page - 1) * pageSize, page * pageSize) : flat), [paged, flat, page, pageSize]);
  const shownGroups = useMemo(() => (groupCol && groups ? groupRows(groupCol, shownRows) : null), [groupCol, groups, shownRows]);
  const groupTotals = useMemo(() => new Map((groups ?? []).map((g) => [g.key, g.rows])), [groups]);

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
      onWidthsChange({ ...widths, [resizing.current.key]: Math.max(64, resizing.current.startW + (ev.clientX - resizing.current.startX)) });
    };
    const up = () => {
      resizing.current = null;
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  };

  const renderCell = (c: ColumnDef, row: Row) => {
    const text = cellDisplay(c, row);
    const href = c.href?.(row);
    const raw = c.accessor ? c.accessor(row) : rawValue(c, row);
    const a = cellAlign(c, align);

    if (c.type === 'badge') return <StatusPill size="sm" tone={cellTone(c.badgeTone?.(raw))} label={text || '—'} />;

    if (c.type === 'number') {
      const n = numericValue(c, row);
      const pct = n == null ? 0 : Math.min(100, (Math.abs(n) / (maxByCol.get(c.key) || 1)) * 100);
      const bar = pct >= 75 ? 'bg-ds-danger' : pct >= 45 ? 'bg-ds-warning' : pct >= 20 ? 'bg-ds-primary' : 'bg-ds-success';
      return (
        <div className={clsx('flex min-w-0 items-center gap-[8px]', a === 'right' && 'justify-end')}>
          <span className="tabular-nums text-ds-fg">{text}</span>
          {n != null && maxByCol.has(c.key) && <span aria-hidden className="h-[6px] w-[48px] shrink-0 overflow-hidden rounded-full bg-ds-border"><span className={clsx('block h-full rounded-full', bar)} style={{ width: `${pct}%` }} /></span>}
        </div>
      );
    }

    // a multi-value cell (array or "; "-joined linkage list) becomes one chip per value instead of one mashed string
    const list = toValueList(c, raw, text);
    if (list && list.length > 1) {
      return (
        <div className="flex flex-wrap gap-[4px]">
          {list.map((v, i) => <span key={i} title={v} className="inline-block max-w-[180px] truncate rounded-full border border-ds-border bg-ds-surface-subtle px-[8px] py-[1px] text-ds-label text-ds-fg-body">{v}</span>)}
        </div>
      );
    }

    // the record opens in a NEW tab so the report being built stays as it is
    if (href) {
      return (
        <Link href={href} target="_blank" rel="noopener noreferrer" title="Open in a new tab" className="inline-flex min-h-ds-control-sm items-center text-ds-primary-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">
          {text}<span className="sr-only"> (opens in a new tab)</span>
        </Link>
      );
    }
    return text;
  };

  const renderRow = (row: Row, i: number) => (
    <tr key={`${String(row.id ?? '')}:${(page - 1) * pageSize + i}`} className="hover:bg-ds-surface-hover">
      {ordered.map((c) => {
        const text = cellDisplay(c, row);
        const pinnedCol = isPinned(c.key);
        return (
          <td
            key={c.key}
            style={{ width: colWidth(c), minWidth: colWidth(c), maxWidth: colWidth(c), ...(pinnedCol ? { position: 'sticky', left: leftOf(c), zIndex: 1, background: 'var(--ds-surface)' } : {}) }}
            className={`${TD} ${cellAlign(c, align) === 'right' ? 'text-right' : ''}`}
            title={text}
          >
            {renderCell(c, row)}
          </td>
        );
      })}
    </tr>
  );

  // an identifier is a number but not a quantity: no bar under it and no total of it
  const isId = (c: ColumnDef) => c.key === 'id' || /^id$/i.test(c.label);
  const numericCols = ordered.filter((c) => c.type === 'number' && !isId(c));
  const groupSummary = (list: Row[]) => {
    if (!numericCols.length) return `${list.length} ${list.length === 1 ? 'row' : 'rows'}`;
    return numericCols.slice(0, 3).map((c) => `${c.agg === 'avg' ? 'Average' : 'Total'} ${c.label.toLowerCase()} ${aggregate({ ...c, agg: c.agg ?? 'sum' }, list)}`).join(' · ');
  };

  if (!ordered.length) {
    return <div className="flex h-[192px] items-center justify-center rounded-ds-card border border-dashed border-ds-border-strong bg-ds-surface-subtle px-[16px] text-center text-ds-body text-ds-fg-muted">Add at least one column to see the rows.</div>;
  }

  const matchLine = `${formatCount(rows.length)} ${rows.length === 1 ? 'row matches' : 'rows match'}${totalInDataset != null && totalInDataset !== rows.length ? `, ${formatCount(totalInDataset)} in the module` : ''}${groups ? `, ${groups.length} groups` : ''}`;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface">
      <div className={clsx('min-h-0 flex-1 overflow-auto', paged && 'max-h-[max(240px,calc(100dvh-380px))]')}>
        <table className="w-max min-w-full table-fixed !border-separate border-spacing-0 text-left">
          <thead className="sticky top-0 z-[2]">
            <tr>
              {ordered.map((c) => {
                const pinnedCol = isPinned(c.key);
                const a = cellAlign(c, align);
                const sorted = sorts.find((s) => s.key === c.key);
                const Icon = !sorted ? ChevronsUpDown : sorted.dir === 'asc' ? ArrowUp : ArrowDown;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={sorted ? (sorted.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    style={{ width: colWidth(c), minWidth: colWidth(c), maxWidth: colWidth(c), ...(pinnedCol ? { position: 'sticky', left: leftOf(c), zIndex: 3 } : {}) }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (dragKey.current && dragKey.current !== c.key) reorderCol(dragKey.current, c.key);
                      dragKey.current = null;
                    }}
                    className={TH}
                  >
                    <div className="flex items-center gap-[2px] px-[8px]">
                      {onReorder && <span aria-hidden draggable onDragStart={() => { dragKey.current = c.key; }} className="cursor-grab text-ds-fg-muted"><GripVertical className="h-[14px] w-[14px]" /></span>}
                      <button
                        type="button"
                        onClick={(e) => onSort?.(c.key, e.shiftKey)}
                        disabled={!onSort}
                        title={onSort ? 'Sort by this column. Hold Shift to sort by several.' : undefined}
                        className={clsx('flex min-h-ds-control min-w-0 flex-1 items-center gap-[4px] rounded-ds-control px-[4px] text-ds-label font-[600] focus-visible:outline-none focus-visible:shadow-[inset_0_0_0_2px_var(--ds-focus)]', a === 'right' && 'justify-end', sorted ? 'text-ds-fg' : 'text-ds-fg-muted')}
                      >
                        <span className={clsx('flex min-w-0 flex-col', a === 'right' && 'items-end')}>
                          {c.linkageModule && (labelCounts.get(headerLabel(c)) ?? 0) > 1 && <span className="truncate text-ds-label font-normal text-ds-fg-muted">{c.linkageModule}</span>}
                          <span className="truncate">{headerLabel(c)}</span>
                        </span>
                        {onSort && <Icon aria-hidden className={clsx('h-[14px] w-[14px] shrink-0', !sorted && 'opacity-60')} />}
                      </button>
                      {pinnedCol && <Pin aria-label="Pinned" className="h-[14px] w-[14px] shrink-0 text-ds-primary-text" />}
                    </div>
                    {onWidthsChange && <span aria-hidden onMouseDown={(e) => startResize(e, c)} className="absolute right-0 top-0 z-[1] h-full w-[6px] cursor-col-resize hover:bg-ds-primary-soft" />}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={ordered.length} className="px-[12px] py-[40px] text-center !text-ds-body !text-ds-fg-muted">No rows match the filters.</td></tr>
            ) : shownGroups ? (
              shownGroups.map((g) => {
                const whole = groupTotals.get(g.key) ?? g.rows;
                return (
                  <Fragment key={`g-${g.key}`}>
                    <tr>
                      <td colSpan={ordered.length} className="border-t border-ds-border bg-ds-surface-subtle px-[12px] py-[8px] !text-ds-label !text-ds-fg-body">
                        <div className="flex flex-wrap items-center justify-between gap-[8px]">
                          <span className="font-[600] text-ds-fg">{g.key} <span className="font-normal text-ds-fg-muted">{whole.length} {groupCol?.label?.toLowerCase() || 'items'}{whole.length > g.rows.length ? `, ${g.rows.length} on this page` : ''}</span></span>
                          <span className="tabular-nums text-ds-fg-muted">{groupSummary(whole)}</span>
                        </div>
                      </td>
                    </tr>
                    {g.rows.map((row, i) => renderRow(row, i))}
                  </Fragment>
                );
              })
            ) : (
              shownRows.map((row, i) => renderRow(row, i))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex shrink-0 flex-col gap-[8px] border-t border-ds-border bg-ds-surface-subtle px-[12px] py-[8px]">
        <div className="flex flex-wrap items-center justify-between gap-x-[16px] gap-y-[4px] text-ds-label text-ds-fg-muted">
          <span>{matchLine}{loadNote ? `. Read: ${loadNote}` : ''}</span>
          {showTotals && numericCols.length > 0 && rows.length > 0 && (
            <span className="flex flex-wrap items-center gap-x-[16px] gap-y-[2px] tabular-nums text-ds-fg-body">
              {numericCols.slice(0, 4).map((c) => (
                // a column that is averaged says "Average" once; the others are totals, and a score also gets its average (a total of scores means little)
                <span key={c.key}>
                  {c.agg === 'avg' ? `Average ${c.label.toLowerCase()} ${aggregate({ ...c, agg: 'avg' }, rows)}` : `Total ${c.label.toLowerCase()} ${aggregate({ ...c, agg: c.agg ?? 'sum' }, rows)}`}
                  {c.agg !== 'avg' && /residual|score|rating/i.test(c.label) ? <span className="ml-[6px] text-ds-fg-muted">average {aggregate({ ...c, agg: 'avg' }, rows)}</span> : null}
                </span>
              ))}
            </span>
          )}
        </div>
        {paged && rows.length > PAGE_SIZES[0] && (
          <Pager page={page} pageSize={pageSize} total={flat.length} onPage={setPageNo} onPageSize={setPageSize} pageSizes={PAGE_SIZES} noun={{ one: 'row', other: 'rows' }} />
        )}
      </div>
    </div>
  );
}
