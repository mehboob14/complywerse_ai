'use client';

/**
 * Report Builder — compose a report from any dataset: pick fields into Rows
 * (nested = tree levels), Columns (pivot across), and Values (aggregations),
 * filter it, then read it as a pivot table or a chart. Everything is live: the
 * preview re-runs on each change, so there is no "generate" step to wait on.
 */

import { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Calendar, Check, ChevronDown, ChevronUp, Download, FileSpreadsheet, FileText,
  Filter, Hash, Loader2, AlertCircle, PieChart as PieIcon, Save, Search, Sigma,
  Table2, Tag, Type, X, BarChart3, LineChart as LineIcon, ChevronsDownUp, ChevronsUpDown,
  Printer, FileType2, Users, Lock,
} from 'lucide-react';
import type { AggFn, ColType, ColumnDef, ReportDataset, ReportSpec } from './types';
import { emptySpec } from './types';
import { describeRules, isActiveCondition, rowMatchesRules, rowMatchesSearch } from './grid-utils';
import { AGG_LABEL, allNodeKeys, buildPivot, fieldDomain, flattenPivot } from './pivot';
import PivotTable from './PivotTable';
import PivotChart from './PivotChart';
import type { ChartKind } from './PivotChart';
import FilterBuilder from './FilterBuilder';
import { exportCSV, exportExcelMulti, exportWord } from './exporters';
import { newSpecId, persistSpec, type SpecSource } from './savedReports';
import { stashPrintSpec } from './printPayload';

const seedSpec = (ds: string): ReportSpec => ({ ...emptySpec(ds), measures: [{ id: 'm0', key: '', agg: 'count' }] });
const nextMid = (measures?: { id: string }[]): number =>
  Math.max(-1, ...(measures ?? []).map((m) => { const n = /^m(\d+)$/.exec(m.id); return n ? Number(n[1]) : -1; })) + 1;

const typeIcon = (t?: ColType) => (t === 'number' ? Hash : t === 'date' ? Calendar : t === 'badge' ? Tag : Type);
const NUM_AGGS: AggFn[] = ['sum', 'avg', 'min', 'max', 'count'];

export default function ReportBuilder({
  dataset, initialSpec, onSavedChange,
}: {
  dataset: ReportDataset;
  initialSpec?: ReportSpec | null;
  onSavedChange?: () => void;
}) {
  // The builder aggregates across the whole set, so it always reads the full
  // dataset (server mode paginates, which can't answer "sum over everything").
  const { data: rows = [], isLoading, error, refetch } = useQuery({
    queryKey: ['report', dataset.key], queryFn: dataset.fetch, staleTime: 30_000,
  });

  const [spec, setSpec] = useState<ReportSpec>(initialSpec ?? seedSpec(dataset.key));
  const [fieldQ, setFieldQ] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [savedAt, setSavedAt] = useState(false);
  const [savedSource, setSavedSource] = useState<SpecSource>('server');
  const [menu, setMenu] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Seed the measure-id counter past any ids already in the spec (templates and
  // saved reports contain m0/m1…), so a newly added value can't collide with one.
  const mid = useRef(nextMid((initialSpec ?? seedSpec(dataset.key)).measures));

  const cols = dataset.columns;
  const patch = (p: Partial<ReportSpec>) => setSpec((s) => ({ ...s, ...p }));
  const labelFor = (key: string) => cols.find((c) => c.key === key)?.label ?? 'rows';

  const filteredRows = useMemo(
    () => rows.filter((r) => rowMatchesSearch(cols, r, spec.search) && rowMatchesRules(cols, r, spec.rules)),
    [rows, cols, spec.search, spec.rules],
  );
  const result = useMemo(
    () => buildPivot(cols, filteredRows, spec.rows, spec.col, spec.measures),
    [cols, filteredRows, spec.rows, spec.col, spec.measures],
  );
  // Colour domains come from the UNFILTERED rows so a filter never repaints series.
  const colDomain = useMemo(() => fieldDomain(cols.find((c) => c.key === spec.col), rows), [cols, spec.col, rows]);
  const rowDomain = useMemo(() => fieldDomain(cols.find((c) => c.key === spec.rows[0]), rows), [cols, spec.rows, rows]);

  const shownFields = cols.filter((c) => c.label.toLowerCase().includes(fieldQ.trim().toLowerCase()));
  const ruleCount = spec.rules.conditions.filter(isActiveCondition).length;
  const removeMeasure = (id: string) => setSpec((s) => {
    const measures = s.measures.filter((x) => x.id !== id);
    return { ...s, measures, measureIdx: Math.min(s.measureIdx, Math.max(0, measures.length - 1)) };
  });

  // ── Field → well ─────────────────────────────────────────────────────────
  const addRow = (k: string) => !spec.rows.includes(k) && patch({ rows: [...spec.rows, k] });
  const addCol = (k: string) => patch({ col: spec.col === k ? null : k });
  const addValue = (c: ColumnDef) =>
    patch({ measures: [...spec.measures, { id: `m${mid.current++}`, key: c.key, agg: c.type === 'number' ? 'sum' : 'count' }] });
  const moveRow = (i: number, d: -1 | 1) => {
    const next = [...spec.rows];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    patch({ rows: next });
  };

  const toggleNode = (k: string) => setExpanded((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const expandAll = () => setExpanded(new Set(allNodeKeys(result.nodes)));
  const collapseAll = () => setExpanded(new Set());

  const doSave = async () => {
    // Fork a teammate's shared report under a NEW id, so my copy never shares a
    // slug with theirs (which would collide as a duplicate React key + overwrite).
    const isFork = spec.mine === false;
    const s: ReportSpec = {
      ...spec,
      id: (spec.id && !isFork) ? spec.id : newSpecId(),
      name: isFork ? `${spec.name} (copy)` : (spec.name.trim() || `${dataset.label} report`),
      shared: isFork ? false : spec.shared,   // my fork starts private
      mine: true,
    };
    setSpec(s);
    setSavedSource(await persistSpec(s));
    setSavedAt(true);
    setTimeout(() => setSavedAt(false), 2200);
    onSavedChange?.();
  };

  /** Provenance — every export carries the slice that produced its numbers. */
  const factLines = () => [
    { label: 'Dataset', value: `${dataset.module} · ${dataset.label}` },
    { label: 'Generated', value: new Date().toLocaleString() },
    { label: 'Rows', value: `${filteredRows.length.toLocaleString()}${filteredRows.length !== rows.length ? ` of ${rows.length.toLocaleString()}` : ''}` },
    { label: 'Grouped by', value: spec.rows.length ? spec.rows.map(labelFor).join(' › ') : '—' },
    { label: 'Pivoted by', value: spec.col ? labelFor(spec.col) : '—' },
    { label: 'Values', value: spec.measures.map((m) => (m.agg === 'count' ? 'Count' : `${AGG_LABEL[m.agg]} ${labelFor(m.key)}`)).join(', ') || '—' },
    { label: 'Filters', value: describeRules(cols, spec.rules) },
    ...(spec.search.trim() ? [{ label: 'Search', value: `“${spec.search.trim()}”` }] : []),
  ];

  const doExport = async (kind: 'pdf' | 'excel' | 'csv' | 'word') => {
    setMenu(false);
    const name = spec.name.trim() || dataset.label;

    // PDF goes through the print route (real vector text, no extra dependency).
    if (kind === 'pdf') {
      stashPrintSpec({ ...spec, name });
      window.open('/reports/print', '_blank', 'noopener');
      return;
    }

    const { cols: outCols, rows: outRows } = flattenPivot(result, labelFor);
    if (kind === 'csv') { exportCSV(name, outCols, outRows); return; }
    if (kind === 'excel') {
      exportExcelMulti(name, [
        { name: 'Report', cols: outCols, rows: outRows },
        { name: 'Definition', aoa: [['Field', 'Value'], ...factLines().map((f) => [f.label, f.value])] },
      ]);
      return;
    }
    setExporting(true);
    try {
      await exportWord(name, { title: name, subtitle: `${dataset.module} · ${dataset.label}`, facts: factLines() }, outCols, outRows);
    } finally { setExporting(false); }
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

  const seg = (active: boolean) => `inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium ${active ? 'bg-primary-500 text-[#0a0a0a]' : 'text-slate-600 hover:bg-slate-50'}`;

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      {/* ── Config panel ─────────────────────────────────────────────── */}
      <aside className="flex w-[286px] flex-shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 p-2.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
            <input value={fieldQ} onChange={(e) => setFieldQ(e.target.value)} placeholder="Search fields…"
              className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-2 text-xs focus:border-primary-500 focus:outline-none" />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {/* Fields */}
          <Section title="Fields" count={shownFields.length}>
            {shownFields.map((c) => {
              const Icon = typeIcon(c.type);
              const inRows = spec.rows.includes(c.key);
              const isCol = spec.col === c.key;
              return (
                <div key={c.key} className="group flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-slate-50">
                  <Icon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate text-xs text-slate-700">{c.label}</span>
                  <div className="flex shrink-0 items-center gap-0.5 text-slate-300 transition-colors group-hover:text-slate-500">
                    <MiniBtn label="Row" title={`Group rows by ${c.label}`} active={inRows} onClick={() => addRow(c.key)} />
                    <MiniBtn label="Col" title={`Pivot ${c.label} across columns`} active={isCol} onClick={() => addCol(c.key)} />
                    <MiniBtn label="Σ" title={`Aggregate ${c.label}`} onClick={() => addValue(c)} />
                  </div>
                </div>
              );
            })}
            {!shownFields.length && <p className="px-2 py-3 text-center text-[11px] text-slate-400">No fields match.</p>}
          </Section>

          {/* Rows */}
          <Section title="Rows" count={spec.rows.length} hint="Nest fields to build a drill-down tree">
            {!spec.rows.length && <Empty>Add a field to group rows</Empty>}
            {spec.rows.map((k, i) => (
              <WellItem key={k} icon={typeIcon(cols.find((c) => c.key === k)?.type)} label={labelFor(k)} onRemove={() => patch({ rows: spec.rows.filter((x) => x !== k) })}>
                {spec.rows.length > 1 && (
                  <>
                    <IconBtn title="Move up" disabled={i === 0} onClick={() => moveRow(i, -1)}><ChevronUp className="h-3 w-3" /></IconBtn>
                    <IconBtn title="Move down" disabled={i === spec.rows.length - 1} onClick={() => moveRow(i, 1)}><ChevronDown className="h-3 w-3" /></IconBtn>
                  </>
                )}
              </WellItem>
            ))}
          </Section>

          {/* Columns */}
          <Section title="Columns" count={spec.col ? 1 : 0} hint="One field, pivoted across the top">
            {!spec.col ? <Empty>Add a field to pivot across</Empty> : (
              <WellItem icon={typeIcon(cols.find((c) => c.key === spec.col)?.type)} label={labelFor(spec.col)} onRemove={() => patch({ col: null })} />
            )}
          </Section>

          {/* Values */}
          <Section title="Values" count={spec.measures.length} hint="What gets counted or totalled">
            {!spec.measures.length && <Empty>Add a value to see numbers</Empty>}
            {spec.measures.map((m) => {
              const col = cols.find((c) => c.key === m.key);
              const numeric = col?.type === 'number';
              return (
                <WellItem key={m.id} icon={typeIcon(col?.type)} label={m.key ? labelFor(m.key) : 'Count of rows'}
                  onRemove={() => removeMeasure(m.id)}>
                  {m.key !== '' && (
                    <select value={m.agg} onChange={(e) => patch({ measures: spec.measures.map((x) => (x.id === m.id ? { ...x, agg: e.target.value as AggFn } : x)) })}
                      className="rounded border border-slate-200 bg-white px-1 py-0.5 text-[10px] font-medium text-slate-600 focus:border-primary-500 focus:outline-none">
                      {(numeric ? NUM_AGGS : (['count'] as AggFn[])).map((a) => <option key={a} value={a}>{AGG_LABEL[a]}</option>)}
                    </select>
                  )}
                </WellItem>
              );
            })}
          </Section>

          {/* Filters */}
          <Section title="Filters" count={ruleCount}>
            <button onClick={() => setShowFilters((s) => !s)}
              className={`mb-1.5 flex w-full items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium ${ruleCount || showFilters ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              <Filter className="h-3.5 w-3.5" /> {ruleCount ? `${ruleCount} condition${ruleCount > 1 ? 's' : ''}` : 'Add filters'}
            </button>
            {showFilters && (
              <FilterBuilder compact cols={cols} rows={rows} rules={spec.rules} onChange={(rules) => patch({ rules })} onClose={() => setShowFilters(false)} />
            )}
          </Section>
        </div>
      </aside>

      {/* ── Preview ──────────────────────────────────────────────────── */}
      <section className="flex min-h-0 flex-1 flex-col">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <input value={spec.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Untitled report"
            className="min-w-[140px] flex-1 rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-base font-semibold text-slate-900 placeholder:font-normal placeholder:text-slate-400 hover:border-slate-200 focus:border-primary-500 focus:bg-white focus:outline-none" />

          <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white">
            <button onClick={() => patch({ view: 'table' })} className={seg(spec.view === 'table')} title="Table"><Table2 className="h-3.5 w-3.5" /> Table</button>
            <button onClick={() => patch({ view: 'bar' })} className={seg(spec.view === 'bar')} title="Bar chart"><BarChart3 className="h-3.5 w-3.5" /></button>
            <button onClick={() => patch({ view: 'line' })} className={seg(spec.view === 'line')} title="Line chart"><LineIcon className="h-3.5 w-3.5" /></button>
            <button onClick={() => patch({ view: 'pie' })} className={seg(spec.view === 'pie')} title="Pie chart"><PieIcon className="h-3.5 w-3.5" /></button>
          </div>

          {/* One measure per chart — two scales on one axis would invent a correlation. */}
          {spec.view !== 'table' && spec.measures.length > 1 && (
            <select value={spec.measureIdx} onChange={(e) => patch({ measureIdx: Number(e.target.value) })}
              className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-600 focus:border-primary-500 focus:outline-none">
              {spec.measures.map((m, i) => <option key={m.id} value={i}>{m.agg === 'count' ? 'Count' : `${AGG_LABEL[m.agg]} ${labelFor(m.key)}`}</option>)}
            </select>
          )}

          {spec.view === 'table' && spec.rows.length > 1 && (
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white">
              <button onClick={expandAll} title="Expand all" className="px-2 py-1.5 text-slate-500 hover:bg-slate-50"><ChevronsUpDown className="h-3.5 w-3.5" /></button>
              <button onClick={collapseAll} title="Collapse all" className="px-2 py-1.5 text-slate-500 hover:bg-slate-50"><ChevronsDownUp className="h-3.5 w-3.5" /></button>
            </div>
          )}

          <div className="relative">
            <button onClick={() => setMenu((m) => !m)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Export
            </button>
            {menu && (
              <div className="absolute right-0 top-full z-40 mt-1 w-60 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                <p className="px-2 pb-1 pt-1 text-[11px] text-slate-400">Exports the pivot as shown, with the filters that produced it.</p>
                <button onClick={() => doExport('pdf')} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"><Printer className="h-4 w-4 text-rose-600" /> PDF <span className="ml-auto text-[10px] text-slate-400">summary + chart</span></button>
                <button onClick={() => doExport('excel')} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"><FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Excel <span className="ml-auto text-[10px] text-slate-400">2 sheets</span></button>
                <button onClick={() => doExport('word')} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"><FileType2 className="h-4 w-4 text-sky-700" /> Word (.docx)</button>
                <button onClick={() => doExport('csv')} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"><FileText className="h-4 w-4 text-slate-500" /> CSV (.csv)</button>
              </div>
            )}
          </div>

          <button
            onClick={() => patch({ shared: !spec.shared })}
            title={spec.shared ? 'Shared — everyone in your tenant can open this report' : 'Private to you. Click to share with your tenant.'}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${spec.shared ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
          >
            {spec.shared ? <Users className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />} {spec.shared ? 'Shared' : 'Private'}
          </button>

          <button onClick={doSave} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-600">
            {savedAt
              ? <><Check className="h-3.5 w-3.5" strokeWidth={3} /> {savedSource === 'local' ? 'Saved locally' : 'Saved'}</>
              : <><Save className="h-3.5 w-3.5" /> Save</>}
          </button>
        </div>

        {/* A teammate's shared report is theirs — editing it here forks your own copy. */}
        {spec.id && spec.mine === false && (
          <p className="-mt-1 mb-2 text-[11px] text-slate-400">Shared by a teammate — saving keeps their copy untouched and stores your own.</p>
        )}

        <div className="mb-2 flex items-center gap-2 text-xs text-slate-400">
          <Sigma className="h-3.5 w-3.5" />
          <span>{filteredRows.length.toLocaleString()}{filteredRows.length !== rows.length ? ` of ${rows.length.toLocaleString()}` : ''} rows{spec.rows.length ? ` · ${result.nodes.length} groups` : ''}</span>
        </div>

        {spec.view === 'table'
          ? <PivotTable result={result} expanded={expanded} onToggle={toggleNode} labelFor={labelFor} />
          : <div className="min-h-0 flex-1 rounded-xl border border-slate-200 bg-white p-3">
              <PivotChart result={result} kind={spec.view as ChartKind} measureIdx={Math.min(spec.measureIdx, Math.max(0, spec.measures.length - 1))} colDomain={colDomain} rowDomain={rowDomain} />
            </div>}
      </section>
    </div>
  );
}

/* ── Small pieces ──────────────────────────────────────────────────────── */
function Section({ title, count, hint, children }: { title: string; count?: number; hint?: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-slate-100 p-2.5 last:border-0">
      <div className="flex items-baseline justify-between px-1 pb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{title}</span>
        {count != null && count > 0 && <span className="text-[10px] font-medium tabular-nums text-slate-400">{count}</span>}
      </div>
      {hint && <p className="px-1 pb-1.5 text-[10px] leading-snug text-slate-400">{hint}</p>}
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-dashed border-slate-200 px-2 py-2 text-center text-[11px] text-slate-400">{children}</div>;
}

function MiniBtn({ label, title, active, onClick }: { label: string; title: string; active?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} title={title}
      className={`rounded px-1 py-0.5 text-[10px] font-semibold leading-none ${active ? 'bg-primary-100 text-primary-700' : 'hover:bg-slate-200 hover:text-slate-700'}`}>
      {label}
    </button>
  );
}

function IconBtn({ title, disabled, onClick, children }: { title: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={title} disabled={disabled} onClick={onClick}
      className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent">
      {children}
    </button>
  );
}

function WellItem({ icon: Icon, label, onRemove, children }: { icon: React.ElementType; label: string; onRemove: () => void; children?: React.ReactNode }) {
  return (
    <div className="mb-1 flex items-center gap-1.5 rounded-md border border-primary-200 bg-primary-50/60 px-1.5 py-1 last:mb-0">
      <Icon className="h-3.5 w-3.5 shrink-0 text-primary-600" />
      <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700">{label}</span>
      {children}
      <button onClick={onRemove} aria-label={`Remove ${label}`} className="rounded p-0.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"><X className="h-3 w-3" /></button>
    </div>
  );
}
