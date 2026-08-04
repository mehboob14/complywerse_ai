'use client';

/**
 * ReportGrid — interactive report table over a dataset. Phase 1: global search,
 * multi-column sort (shift-click), per-column filters (text / multi-select /
 * date range), show-hide / resize / pin-left, pagination, drill-down, CSV+Excel
 * export, saved views. Phase 2: relative-date filters, row grouping + aggregates,
 * and drag column reorder.
 */

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Search, SlidersHorizontal, Filter, Download, Bookmark, RefreshCw, Check,
  ArrowUp, ArrowDown, ChevronsUpDown, Pin, PinOff, ChevronLeft, ChevronRight,
  Loader2, AlertCircle, Trash2, FileSpreadsheet, FileText, Layers, GripVertical,
  Wand2, Server, FileType2,
} from 'lucide-react';
import type { ColumnDef, ReportDataset, ReportView, Row, SortSpec } from './types';
import { emptyView, REL_PRESETS } from './types';
import {
  aggregate, asRows, compareRows, describeRules, displayText, distinctValues, groupRows, isActiveCondition, rawValue,
  rowMatchesFilters, rowMatchesRules, rowMatchesSearch,
} from './grid-utils';
import { exportCSV, exportExcel, exportWord } from './exporters';
import { buildServerQuery, queryServer } from './serverApi';
import FilterBuilder from './FilterBuilder';

const VKEY = (k: string) => `grc-report-views:${k}`;
const loadViews = (k: string): Record<string, ReportView> => {
  try { return JSON.parse(localStorage.getItem(VKEY(k)) || '{}'); } catch { return {}; }
};
const saveViews = (k: string, v: Record<string, ReportView>) => {
  try { localStorage.setItem(VKEY(k), JSON.stringify(v)); } catch { /* quota */ }
};
const PAGE_SIZES = [25, 50, 100, 250, 0];

export default function ReportGrid({ dataset }: { dataset: ReportDataset }) {
  const server = !!dataset.server;

  const [view, setView] = useState<ReportView>(emptyView());
  const [page, setPage] = useState(0);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [menu, setMenu] = useState<'cols' | 'views' | 'export' | null>(null);
  const [savedViews, setSavedViews] = useState<Record<string, ReportView>>({});
  const [viewName, setViewName] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [showBuilder, setShowBuilder] = useState(false);
  const [exporting, setExporting] = useState(false);
  const menuWrap = useRef<HTMLDivElement>(null);
  const dragKey = useRef<string | null>(null);
  // Virtual scrolling refs/state (windowed rows for large non-grouped bodies).
  const scrollRef = useRef<HTMLDivElement>(null);
  const firstRowRef = useRef<HTMLTableRowElement>(null);
  const scrollTick = useRef(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(600);
  const [rowH, setRowH] = useState(41);

  // ── Data — client mode fetches the whole dataset (filter/sort/page in the
  // browser); server mode fetches one page from /reporting/query. ────────────
  const serverSize = view.pageSize === 0 ? 100 : view.pageSize;
  const clientQ = useQuery({
    queryKey: ['report', dataset.key], queryFn: dataset.fetch, staleTime: 30_000, enabled: !server,
  });
  const serverQ = useQuery({
    queryKey: ['report-srv', dataset.key, debouncedSearch, JSON.stringify(view.sorts), JSON.stringify(view.rules), page, serverSize],
    queryFn: () => queryServer(buildServerQuery(dataset.key, view, debouncedSearch, page, serverSize)),
    enabled: server, staleTime: 15_000, placeholderData: (prev) => prev,
  });
  const rows: Row[] = asRows(server ? serverQ.data?.rows : clientQ.data);
  const serverTotal = serverQ.data?.total ?? 0;
  const isLoading = server ? serverQ.isLoading : clientQ.isLoading;
  const error = server ? serverQ.error : clientQ.error;
  const isFetching = server ? serverQ.isFetching : clientQ.isFetching;
  const refetch = server ? serverQ.refetch : clientQ.refetch;

  // Debounce search into the server query key (client mode filters live).
  useEffect(() => {
    if (!server) return;
    const t = setTimeout(() => setDebouncedSearch(view.search), 300);
    return () => clearTimeout(t);
  }, [server, view.search]);

  useEffect(() => { setView(emptyView()); setPage(0); setDebouncedSearch(''); setCollapsed(new Set()); setShowBuilder(false); setSavedViews(loadViews(dataset.key)); }, [dataset.key]);
  useEffect(() => {
    const el = scrollRef.current; if (!el) return;
    setViewH(el.clientHeight);
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, [dataset.key]);
  useLayoutEffect(() => {
    const h = firstRowRef.current?.offsetHeight;
    if (h && Math.abs(h - rowH) > 1) setRowH(h);
  });
  useEffect(() => {
    if (!menu) return;
    const h = (e: MouseEvent) => { if (menuWrap.current && !menuWrap.current.contains(e.target as Node)) setMenu(null); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menu]);

  const cols = dataset.columns;
  const width = (c: ColumnDef) => view.widths[c.key] ?? c.width ?? 140;
  const isPinned = (c: ColumnDef) => view.pinned.includes(c.key);

  const orderedCols = useMemo(() => {
    const base = view.order.length ? view.order : cols.map((c) => c.key);
    const full = [...base, ...cols.filter((c) => !base.includes(c.key)).map((c) => c.key)];
    const visible = full.map((k) => cols.find((c) => c.key === k)).filter(Boolean).filter((c) => !view.hidden.includes((c as ColumnDef).key)) as ColumnDef[];
    const pin = view.pinned.map((k) => visible.find((c) => c.key === k)).filter(Boolean) as ColumnDef[];
    const rest = visible.filter((c) => !view.pinned.includes(c.key));
    return [...pin, ...rest];
  }, [cols, view.order, view.hidden, view.pinned]);
  const pinnedCols = orderedCols.filter((c) => isPinned(c));
  const leftOf = (c: ColumnDef) => { let x = 0; for (const p of pinnedCols) { if (p.key === c.key) return x; x += width(p); } return 0; };

  // In server mode the page arrives already filtered/sorted/paginated.
  const filtered = useMemo(
    () => (server ? rows : rows.filter((r) => rowMatchesSearch(cols, r, view.search) && rowMatchesFilters(cols, r, view.filters) && rowMatchesRules(cols, r, view.rules))),
    [server, rows, cols, view.search, view.filters, view.rules],
  );
  const sorted = useMemo(
    () => (server ? rows : view.sorts.length ? [...filtered].sort((a, b) => compareRows(cols, a, b, view.sorts)) : filtered),
    [server, rows, filtered, view.sorts, cols],
  );
  const groupCol = !server && view.groupBy ? cols.find((c) => c.key === view.groupBy) || null : null;
  const groups = useMemo(() => (groupCol ? groupRows(groupCol, sorted) : null), [groupCol, sorted]);
  const aggCols = orderedCols.filter((c) => c.agg);

  const total = server ? serverTotal : sorted.length;
  const size = view.pageSize;
  const pageCount = server
    ? Math.max(1, Math.ceil(total / serverSize))
    : size === 0 ? 1 : Math.max(1, Math.ceil(total / size));
  const clampedPage = Math.min(page, pageCount - 1);
  const pageRows = server ? rows : size === 0 ? sorted : sorted.slice(clampedPage * size, clampedPage * size + size);
  useEffect(() => { setPage(0); }, [view.search, view.filters, view.sorts, view.pageSize, view.groupBy, view.rules]);
  // When the visible rows change (filter/sort/search/group/page/dataset), jump the
  // virtual list back to the top — otherwise a shrunken result set leaves the
  // window scrolled past the new end and renders blank until the browser clamps.
  useEffect(() => {
    setScrollTop(0);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [dataset.key, clampedPage, view.search, view.filters, view.sorts, view.groupBy, view.rules, view.pageSize]);
  // Keep the page in range when a server result shrinks the total.
  useEffect(() => { if (server && serverTotal > 0 && page > pageCount - 1) setPage(pageCount - 1); }, [server, serverTotal, pageCount, page]);

  // Virtual window over the current (non-grouped) page.
  const virtual = !groups && pageRows.length > 80;
  const vStart = virtual ? Math.max(0, Math.floor(scrollTop / rowH) - 8) : 0;
  const vEnd = virtual ? Math.min(pageRows.length, Math.ceil((scrollTop + viewH) / rowH) + 8) : pageRows.length;
  const windowRows = virtual ? pageRows.slice(vStart, vEnd) : pageRows;
  const topPad = virtual ? vStart * rowH : 0;
  const botPad = virtual ? (pageRows.length - vEnd) * rowH : 0;
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const st = e.currentTarget.scrollTop;
    if (!scrollTick.current) { scrollTick.current = true; requestAnimationFrame(() => { setScrollTop(st); scrollTick.current = false; }); }
  };

  // ── mutators ──────────────────────────────────────────────────────
  const patch = (p: Partial<ReportView>) => setView((v) => ({ ...v, ...p }));
  const setFilter = (key: string, f: ReportView['filters'][string] | null) =>
    setView((v) => {
      const filters = { ...v.filters };
      if (!f || (!f.text && !(f.values && f.values.length) && !f.from && !f.to && !f.rel)) delete filters[key];
      else filters[key] = f;
      return { ...v, filters };
    });
  const toggleSort = (key: string, additive: boolean) =>
    setView((v) => {
      const ex = v.sorts.find((s) => s.key === key);
      let sorts: SortSpec[];
      if (additive) {
        if (!ex) sorts = [...v.sorts, { key, dir: 'asc' as const }];
        else if (ex.dir === 'asc') sorts = v.sorts.map((s) => (s.key === key ? { ...s, dir: 'desc' as const } : s));
        else sorts = v.sorts.filter((s) => s.key !== key);
      } else if (!ex) sorts = [{ key, dir: 'asc' as const }];
      else if (ex.dir === 'asc') sorts = [{ key, dir: 'desc' as const }];
      else sorts = [];
      return { ...v, sorts };
    });
  const toggleHidden = (key: string) => setView((v) => ({ ...v, hidden: v.hidden.includes(key) ? v.hidden.filter((k) => k !== key) : [...v.hidden, key] }));
  const togglePin = (key: string) => setView((v) => ({ ...v, pinned: v.pinned.includes(key) ? v.pinned.filter((k) => k !== key) : [...v.pinned, key] }));
  const toggleGroup = (k: string) => setCollapsed((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  const reorderCol = (from: string, to: string) =>
    setView((v) => {
      const base = (v.order.length ? v.order : cols.map((c) => c.key)).slice();
      for (const c of cols) if (!base.includes(c.key)) base.push(c.key);
      const fi = base.indexOf(from); const ti = base.indexOf(to);
      if (fi < 0 || ti < 0 || fi === ti) return v;
      base.splice(ti, 0, base.splice(fi, 1)[0]);
      return { ...v, order: base };
    });

  const resizing = useRef<{ key: string; startX: number; startW: number } | null>(null);
  const startResize = (e: React.MouseEvent, c: ColumnDef) => {
    e.preventDefault(); e.stopPropagation();
    resizing.current = { key: c.key, startX: e.clientX, startW: width(c) };
    const move = (ev: MouseEvent) => {
      if (!resizing.current) return;
      const w = Math.max(64, resizing.current.startW + (ev.clientX - resizing.current.startX));
      setView((v) => ({ ...v, widths: { ...v.widths, [resizing.current!.key]: w } }));
    };
    const up = () => { resizing.current = null; document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  };

  const commitViews = (next: Record<string, ReportView>) => { setSavedViews(next); saveViews(dataset.key, next); };
  const saveCurrent = () => { const name = viewName.trim(); if (!name) return; commitViews({ ...savedViews, [name]: { ...view, name } }); setViewName(''); setMenu(null); };
  const applyView = (v: ReportView) => { setView({ ...emptyView(), ...v }); setMenu(null); };
  const removeView = (name: string) => { const n = { ...savedViews }; delete n[name]; commitViews(n); };

  const activeFilterCount = Object.keys(view.filters).length;
  const ruleCount = view.rules.conditions.filter(isActiveCondition).length;
  const pageSizeOptions = server ? PAGE_SIZES.filter((n) => n !== 0) : PAGE_SIZES;

  // Plain-English summary of the per-column quick filters (client mode), so the
  // export's provenance reflects them, not just the advanced builder.
  const colFilterSummary = Object.entries(view.filters).map(([key, f]) => {
    const col = cols.find((c) => c.key === key); if (!col || !f) return '';
    if (f.values && f.values.length) return `${col.label} in [${f.values.join(', ')}]`;
    if (f.text) return `${col.label} contains “${f.text}”`;
    if (f.rel) return `${col.label} ${f.rel}`;
    if (f.from || f.to) return `${col.label} ${f.from ?? '…'}–${f.to ?? '…'}`;
    return '';
  }).filter(Boolean).join('; ');

  // Export: client mode ships all filtered rows; server mode fetches a capped page.
  const runExport = async (kind: 'excel' | 'csv' | 'word') => {
    setMenu(null);
    setExporting(true);
    try {
      const data = server
        ? (await queryServer(buildServerQuery(dataset.key, view, debouncedSearch, 0, 500))).rows
        : sorted;
      if (kind === 'word') {
        await exportWord(dataset.label, {
          title: dataset.label,
          subtitle: `${dataset.module} · ${dataset.description ?? ''}`.trim(),
          facts: [
            { label: 'Generated', value: new Date().toLocaleString() },
            { label: 'Rows', value: data.length.toLocaleString() },
            { label: 'Filters', value: describeRules(cols, view.rules) },
            ...(colFilterSummary ? [{ label: 'Column filters', value: colFilterSummary }] : []),
            ...(view.search.trim() ? [{ label: 'Search', value: `“${view.search.trim()}”` }] : []),
          ],
        }, orderedCols, data);
      } else {
        (kind === 'excel' ? exportExcel : exportCSV)(dataset.label, orderedCols, data);
      }
    } catch { /* leave the user where they are — no partial file */ }
    finally { setExporting(false); }
  };

  if (isLoading) return <div className="flex h-96 items-center justify-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (error) {
    return (
      <div className="flex h-96 flex-col items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 text-rose-700">
        <AlertCircle className="h-6 w-6" /><p className="text-sm">Could not load {dataset.label}.</p>
        <button onClick={() => refetch()} className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-rose-100">Retry</button>
      </div>
    );
  }

  const iconBtn = 'inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50';

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 pb-2">
        <div className="relative min-w-0 flex-1 basis-[12rem] sm:max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input value={view.search} onChange={(e) => patch({ search: e.target.value })} placeholder={`Search ${dataset.label.toLowerCase()}…`} className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm focus:border-primary-500 focus:outline-none" />
        </div>

        {!server && (
          <button onClick={() => setShowFilters((s) => !s)} className={`${iconBtn} ${showFilters || activeFilterCount ? 'border-primary-300 bg-primary-50 text-primary-700' : ''}`}>
            <Filter className="h-3.5 w-3.5" /> Filters{activeFilterCount ? ` · ${activeFilterCount}` : ''}
          </button>
        )}

        <button onClick={() => setShowBuilder((s) => !s)} className={`${iconBtn} ${showBuilder || ruleCount ? 'border-primary-300 bg-primary-50 text-primary-700' : ''}`}>
          <Wand2 className="h-3.5 w-3.5" /> Advanced{ruleCount ? ` · ${ruleCount}` : ''}
        </button>

        {!server && (
          <div className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs ${view.groupBy ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-slate-200 bg-white text-slate-600'}`}>
            <Layers className="h-3.5 w-3.5" />
            <select value={view.groupBy || ''} onChange={(e) => patch({ groupBy: e.target.value || null })} className="bg-transparent text-xs font-medium focus:outline-none">
              <option value="">No grouping</option>
              {cols.filter((c) => c.type !== 'number').map((c) => <option key={c.key} value={c.key}>Group: {c.label}</option>)}
            </select>
          </div>
        )}

        {server && (
          <span title="Filter / sort / paginate run in the database — the browser holds one page at a time." className="inline-flex items-center gap-1.5 rounded-lg border border-primary-200 bg-primary-50 px-2.5 py-1.5 text-xs font-medium text-primary-700">
            <Server className="h-3.5 w-3.5" /> Server mode
          </span>
        )}

        <div className="relative" ref={menu ? menuWrap : undefined}>
          <div className="flex items-center gap-2">
            <button onClick={() => setMenu(menu === 'cols' ? null : 'cols')} className={iconBtn}><SlidersHorizontal className="h-3.5 w-3.5" /> Columns</button>
            <button onClick={() => setMenu(menu === 'views' ? null : 'views')} className={iconBtn}><Bookmark className="h-3.5 w-3.5" /> Views</button>
            <button onClick={() => setMenu(menu === 'export' ? null : 'export')} className={iconBtn}>{exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Export</button>
          </div>

          {menu === 'cols' && (
            <div className="absolute right-0 top-full z-40 mt-1 max-h-[60vh] w-72 overflow-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
              <div className="flex items-center justify-between px-1 pb-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Columns</span>
                <button onClick={() => patch({ hidden: [], pinned: [], widths: {}, order: [] })} className="text-[11px] font-medium text-slate-400 hover:text-primary-700">Reset</button>
              </div>
              {cols.map((c) => (
                <div key={c.key} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-slate-50">
                  <button onClick={() => toggleHidden(c.key)} className={`flex h-4 w-4 items-center justify-center rounded border ${!view.hidden.includes(c.key) ? 'border-primary-500 bg-primary-500 text-[#0a0a0a]' : 'border-slate-300'}`}>
                    {!view.hidden.includes(c.key) && <Check className="h-3 w-3" strokeWidth={3} />}
                  </button>
                  <span className="flex-1 truncate text-sm text-slate-700">{c.label}</span>
                  <button onClick={() => togglePin(c.key)} title={isPinned(c) ? 'Unpin' : 'Pin left'} className={`rounded p-1 ${isPinned(c) ? 'text-primary-600' : 'text-slate-300 hover:text-slate-600'}`}>
                    {isPinned(c) ? <Pin className="h-3.5 w-3.5" /> : <PinOff className="h-3.5 w-3.5" />}
                  </button>
                </div>
              ))}
            </div>
          )}

          {menu === 'views' && (
            <div className="absolute right-0 top-full z-40 mt-1 w-72 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
              <div className="flex gap-1.5 pb-2">
                <input value={viewName} onChange={(e) => setViewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveCurrent()} placeholder="Save current as…" className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-xs focus:border-primary-500 focus:outline-none" />
                <button onClick={saveCurrent} disabled={!viewName.trim()} className="rounded-md bg-primary-500 px-2.5 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-600 disabled:opacity-50">Save</button>
              </div>
              {Object.keys(savedViews).length === 0 ? <p className="px-1 py-2 text-center text-[11px] text-slate-400">No saved views yet.</p> : (
                Object.entries(savedViews).map(([name, v]) => (
                  <div key={name} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-slate-50">
                    <button onClick={() => applyView(v)} className="flex-1 truncate text-left text-sm text-slate-700">{name}</button>
                    <button onClick={() => removeView(name)} className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                ))
              )}
            </div>
          )}

          {menu === 'export' && (
            <div className="absolute right-0 top-full z-40 mt-1 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
              <p className="px-2 pb-1 pt-1 text-[11px] text-slate-400">{server ? `Exports up to 500 matching rows (server mode).` : `Exports all ${total.toLocaleString()} filtered rows.`}</p>
              <button onClick={() => runExport('excel')} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"><FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Excel (.xlsx)</button>
              <button onClick={() => runExport('word')} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"><FileType2 className="h-4 w-4 text-sky-700" /> Word (.docx)</button>
              <button onClick={() => runExport('csv')} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"><FileText className="h-4 w-4 text-slate-500" /> CSV (.csv)</button>
            </div>
          )}
        </div>

        <button onClick={() => refetch()} className={iconBtn} title="Refresh"><RefreshCw className={`h-3.5 w-3.5 ${isFetching ? 'animate-spin' : ''}`} /></button>
        <span className="ml-auto text-xs text-slate-400">{total.toLocaleString()}{filtered.length !== rows.length ? ` of ${rows.length.toLocaleString()}` : ''} rows{groups ? ` · ${groups.length} groups` : ''}</span>
      </div>

      {/* ── Advanced AND/OR filter builder (shared with the Report Builder) ── */}
      {showBuilder && (
        <div className="mb-2 max-h-40 shrink-0 overflow-y-auto overflow-x-hidden">
          <FilterBuilder cols={cols} rows={rows} rules={view.rules} onChange={(rules) => patch({ rules })} onClose={() => setShowBuilder(false)} />
        </div>
      )}

      {/* Client-mode scale guardrail — this dataset holds every row in the browser. */}
      {!server && rows.length > 10000 && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>Showing all {rows.length.toLocaleString()} rows in the browser — large sets may feel slow. Narrow with filters, or use Export for the full data.</span>
        </div>
      )}

      {/* ── Table ───────────────────────────────────────────────────── */}
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 min-w-0 flex-1 overflow-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-max min-w-full table-fixed border-collapse text-sm">
          <thead className="sticky top-0 z-20">
            <tr>
              {orderedCols.map((c) => {
                const s = view.sorts.find((x) => x.key === c.key);
                const sIdx = view.sorts.findIndex((x) => x.key === c.key);
                const pinned = isPinned(c);
                return (
                  <th
                    key={c.key}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => { e.preventDefault(); if (dragKey.current && dragKey.current !== c.key) reorderCol(dragKey.current, c.key); dragKey.current = null; }}
                    style={{ width: width(c), minWidth: width(c), maxWidth: width(c), ...(pinned ? { position: 'sticky', left: leftOf(c), zIndex: 30 } : {}) }}
                    className={`group relative select-none border-b border-slate-200 bg-slate-50 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 ${pinned ? 'shadow-[1px_0_0_0_#e2e8f0]' : ''}`}
                  >
                    <div draggable onDragStart={() => { dragKey.current = c.key; }} className="flex items-center gap-1">
                      <GripVertical className="h-3 w-3 cursor-grab text-slate-300 opacity-0 group-hover:opacity-100" />
                      <button onClick={(e) => toggleSort(c.key, e.shiftKey)} className="flex min-w-0 flex-1 items-center gap-1 text-left">
                        <span className="truncate">{c.label}</span>
                        {s ? (s.dir === 'asc' ? <ArrowUp className="h-3 w-3 text-primary-600" /> : <ArrowDown className="h-3 w-3 text-primary-600" />) : <ChevronsUpDown className="h-3 w-3 text-slate-300 group-hover:text-slate-400" />}
                        {view.sorts.length > 1 && sIdx >= 0 && <span className="text-[9px] text-primary-500">{sIdx + 1}</span>}
                      </button>
                    </div>
                    <span onMouseDown={(e) => startResize(e, c)} className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize" />
                  </th>
                );
              })}
            </tr>
            {!server && showFilters && (
              <tr>
                {orderedCols.map((c) => (
                  <th key={c.key} style={{ ...(isPinned(c) ? { position: 'sticky', left: leftOf(c), zIndex: 25 } : {}) }} className="border-b border-slate-200 bg-white p-1 align-top">
                    <FilterCell col={c} rows={rows} value={view.filters[c.key]} onChange={(f) => setFilter(c.key, f)} />
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {groups ? (
              groups.length === 0 ? (
                <tr><td colSpan={orderedCols.length} className="px-4 py-14 text-center text-sm text-slate-400">No rows match your filters.</td></tr>
              ) : groups.map((g) => {
                const open = !collapsed.has(g.key);
                return (
                  <Fragment key={g.key}>
                    <tr className="border-b border-slate-200 bg-slate-50/90">
                      <td colSpan={orderedCols.length} className="sticky left-0 px-3 py-2">
                        <button onClick={() => toggleGroup(g.key)} className="flex items-center gap-2 text-left">
                          <ChevronRight className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
                          <span className="text-sm font-semibold text-slate-800">{groupCol!.label}: {g.key}</span>
                          <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">{g.rows.length}</span>
                          {aggCols.map((c) => <span key={c.key} className="text-[11px] text-slate-400">· {c.label} {c.agg}: <span className="font-medium text-slate-600">{aggregate(c, g.rows)}</span></span>)}
                        </button>
                      </td>
                    </tr>
                    {open && g.rows.map((r, ri) => (
                      <tr key={ri} className="border-b border-slate-100 hover:bg-slate-50/60">
                        {orderedCols.map((c) => <Cell key={c.key} col={c} row={r} width={width(c)} pinnedLeft={isPinned(c) ? leftOf(c) : null} />)}
                      </tr>
                    ))}
                  </Fragment>
                );
              })
            ) : pageRows.length === 0 ? (
              <tr><td colSpan={orderedCols.length} className="px-4 py-14 text-center text-sm text-slate-400">No rows match your filters.</td></tr>
            ) : (
              <>
                {topPad > 0 && <tr aria-hidden style={{ height: topPad }}><td colSpan={orderedCols.length} className="p-0" /></tr>}
                {windowRows.map((r, ri) => (
                  <tr key={vStart + ri} ref={ri === 0 ? firstRowRef : undefined} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                    {orderedCols.map((c) => <Cell key={c.key} col={c} row={r} width={width(c)} pinnedLeft={isPinned(c) ? leftOf(c) : null} />)}
                  </tr>
                ))}
                {botPad > 0 && <tr aria-hidden style={{ height: botPad }}><td colSpan={orderedCols.length} className="p-0" /></tr>}
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Footer / pagination ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3 text-xs text-slate-500">
        {groups ? (
          <span>{groups.length} groups · {total.toLocaleString()} rows</span>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span>Rows per page</span>
              <select value={size} onChange={(e) => patch({ pageSize: Number(e.target.value) })} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs focus:border-primary-500 focus:outline-none">
                {pageSizeOptions.map((n) => <option key={n} value={n}>{n === 0 ? 'All' : n}</option>)}
              </select>
            </div>
            {size !== 0 && (
              <div className="flex items-center gap-3">
                <span>{total === 0 ? 0 : clampedPage * size + 1}–{Math.min(total, (clampedPage + 1) * size)} of {total.toLocaleString()}</span>
                <div className="flex items-center gap-1">
                  <button disabled={clampedPage === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="rounded-md border border-slate-200 p-1 disabled:opacity-40 hover:enabled:bg-slate-50"><ChevronLeft className="h-4 w-4" /></button>
                  <span className="tabular-nums">Page {clampedPage + 1} / {pageCount}</span>
                  <button disabled={clampedPage >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} className="rounded-md border border-slate-200 p-1 disabled:opacity-40 hover:enabled:bg-slate-50"><ChevronRight className="h-4 w-4" /></button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ── Cell ──────────────────────────────────────────────────────────── */
function Cell({ col, row, width, pinnedLeft }: { col: ColumnDef; row: Row; width: number; pinnedLeft: number | null }) {
  const text = displayText(col, row);
  const href = col.href ? col.href(row) : null;
  const align = col.align === 'right' ? 'text-right' : 'text-left';
  const style = { width, minWidth: width, maxWidth: width, ...(pinnedLeft != null ? { position: 'sticky' as const, left: pinnedLeft, zIndex: 10 } : {}) };
  let inner: React.ReactNode;
  if (col.type === 'badge' && text) {
    inner = <span className={`inline-flex max-w-full items-center truncate rounded-full border px-2 py-0.5 text-[11px] font-medium ${col.badgeTone ? col.badgeTone(rawValue(col, row)) : 'border-slate-200 bg-slate-100 text-slate-600'}`}>{text}</span>;
  } else if (href && text) {
    inner = <Link href={href} className="truncate font-medium text-primary-700 hover:underline">{text}</Link>;
  } else {
    inner = <span className="truncate text-slate-700">{text || <span className="text-slate-300">—</span>}</span>;
  }
  return (
    <td style={style} className={`border-r border-slate-100 px-3 py-2 last:border-r-0 ${align} ${pinnedLeft != null ? 'bg-white shadow-[1px_0_0_0_#f1f5f9]' : ''}`}>
      <div className={`flex ${col.align === 'right' ? 'justify-end' : ''} min-w-0`}>{inner}</div>
    </td>
  );
}

/* ── Filter cell ───────────────────────────────────────────────────── */
function FilterCell({ col, rows, value, onChange }: {
  col: ColumnDef; rows: Row[]; value: ReportView['filters'][string] | undefined;
  onChange: (f: ReportView['filters'][string] | null) => void;
}) {
  const cls = 'w-full rounded-md border border-slate-200 px-1.5 py-1 text-[11px] focus:border-primary-500 focus:outline-none';
  if (col.type === 'date') {
    return (
      <div className="flex flex-col gap-1">
        <select value={value?.rel || ''} onChange={(e) => onChange(e.target.value ? { rel: e.target.value } : null)} className={cls}>
          <option value="">Any date</option>
          {REL_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        {!value?.rel && (
          <>
            <input type="date" value={value?.from || ''} onChange={(e) => onChange({ ...value, from: e.target.value })} className={cls} />
            <input type="date" value={value?.to || ''} onChange={(e) => onChange({ ...value, to: e.target.value })} className={cls} />
          </>
        )}
      </div>
    );
  }
  if (col.type === 'badge') {
    const opts = distinctValues(col, rows);
    return (
      <select multiple value={value?.values || []} onChange={(e) => onChange({ values: Array.from(e.target.selectedOptions).map((o) => o.value) })} className={`${cls} h-16`}>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  return <input value={value?.text || ''} onChange={(e) => onChange({ text: e.target.value })} placeholder="Filter…" className={cls} />;
}
