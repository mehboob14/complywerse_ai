'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle, AlertTriangle, Check, Columns3, Download, FileSpreadsheet,
  FileText, FileType2, Filter, Link2, Loader2, Lock, Printer, Save, Search, Sigma, Users,
} from 'lucide-react';
import type { AggFn, ChartKind, ReportDataset, ReportSpec, SortSpec } from './types';
import { emptySpec } from './types';
import { asRows, compareRows, describeRules, isActiveCondition, rowMatchesRules, rowMatchesSearch } from './grid-utils';
import { AGG_LABEL, buildPivot, fieldDomain } from './pivot';
import PivotChart from './PivotChart';
import ChartViewStrip from './ChartViewStrip';
import ReportDataTable from './ReportDataTable';
import FilterBuilder from './FilterBuilder';
import ColumnPicker from './ColumnPicker';
import SelectedColumnList from './SelectedColumnList';
import { allLinkageColumns, enrichReportRows, fetchLinkageCatalog, linkageKeysForFields } from './linkages';
import { chartGroupCandidates, chartReadiness, defaultVisibleColumns, effectiveChartKind } from './builderUtils';
import { exportCSV, exportExcelMulti, exportWord } from './exporters';
import { newSpecId, persistSpec, type SpecSource } from './savedReports';
import { stashPrintSpec } from './printPayload';

const seedSpec = (ds: string): ReportSpec => ({ ...emptySpec(ds), measures: [{ id: 'm0', key: '', agg: 'count' }] });
const NUM_AGGS: AggFn[] = ['sum', 'avg', 'min', 'max', 'count'];

export default function ReportBuilder({ dataset, initialSpec, onSavedChange }: {
  dataset: ReportDataset;
  initialSpec?: ReportSpec | null;
  onSavedChange?: () => void;
}) {
  const initial = initialSpec ?? seedSpec(dataset.key);
  const [spec, setSpec] = useState<ReportSpec>(() => ({
    ...initial,
    visibleColumns: initial.visibleColumns?.length ? initial.visibleColumns : [],
    columnWidths: initial.columnWidths ?? {},
    columnAlign: initial.columnAlign ?? {},
    pinnedColumns: initial.pinnedColumns ?? [],
    sorts: initial.sorts ?? [],
  }));
  const [draftRules, setDraftRules] = useState(initial.rules);
  const [draftSearch, setDraftSearch] = useState(initial.search);
  const [fieldQ, setFieldQ] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [menu, setMenu] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [savedSource, setSavedSource] = useState<SpecSource>('server');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const next = initialSpec ?? seedSpec(dataset.key);
    setSpec({
      ...next,
      visibleColumns: next.visibleColumns?.length ? next.visibleColumns : [],
      columnWidths: next.columnWidths ?? {},
      columnAlign: next.columnAlign ?? {},
      pinnedColumns: next.pinnedColumns ?? [],
      sorts: next.sorts ?? [],
    });
    setDraftRules(next.rules);
    setDraftSearch(next.search);
  }, [dataset.key, initialSpec]);

  const patch = (p: Partial<ReportSpec>) => setSpec((s) => ({ ...s, ...p }));

  const { data: linkageCatalog = [] } = useQuery({
    queryKey: ['report-linkages', dataset.key],
    queryFn: () => fetchLinkageCatalog(dataset.key),
    staleTime: 60_000,
  });

  const visibleKeys = useMemo(
    () => (spec.visibleColumns?.length ? spec.visibleColumns : defaultVisibleColumns(dataset.columns)),
    [spec.visibleColumns, dataset.columns],
  );
  const groupBy = spec.rows[0] ?? null;
  const splitBy = spec.col;

  const linkageColDefs = useMemo(() => allLinkageColumns(linkageCatalog), [linkageCatalog]);
  const allCols = useMemo(() => [...dataset.columns, ...linkageColDefs], [dataset.columns, linkageColDefs]);
  const labelFor = (key: string) => allCols.find((c) => c.key === key)?.label ?? key;

  const appliedFieldKeys = useMemo(() => {
    const keys = new Set<string>([
      ...visibleKeys,
      ...spec.rules.conditions.map((c) => c.col),
      ...(groupBy ? [groupBy] : []),
      ...(splitBy ? [splitBy] : []),
      ...spec.measures.map((m) => m.key).filter(Boolean),
    ]);
    return Array.from(keys);
  }, [visibleKeys, spec.rules.conditions, groupBy, splitBy, spec.measures]);
  const includes = useMemo(
    () => linkageKeysForFields(appliedFieldKeys, linkageCatalog),
    [appliedFieldKeys, linkageCatalog],
  );

  const { data: rawRows = [], isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['report', dataset.key, includes.join(',')],
    queryFn: async () => {
      const base = asRows(await dataset.fetch());
      if (!includes.length) return base;
      return enrichReportRows(dataset.key, base, includes);
    },
    staleTime: 30_000,
  });
  const rows = asRows(rawRows);

  const cols = useMemo(() => {
    const inc = new Set(includes);
    return [...dataset.columns, ...linkageColDefs.filter((c) => c.linkageKey && inc.has(c.linkageKey))];
  }, [dataset.columns, linkageColDefs, includes]);

  const filtersDirty = useMemo(
    () => JSON.stringify(draftRules) !== JSON.stringify(spec.rules) || draftSearch !== spec.search,
    [draftRules, spec.rules, draftSearch, spec.search],
  );
  const applyFilters = () => patch({ rules: draftRules, search: draftSearch });
  const resetFilters = () => {
    const empty = { logic: 'AND' as const, conditions: [] };
    setDraftRules(empty);
    setDraftSearch('');
    patch({ rules: empty, search: '' });
  };

  const filteredRows = useMemo(() => {
    const matched = rows.filter((r) => rowMatchesSearch(cols, r, spec.search) && rowMatchesRules(cols, r, spec.rules));
    if (!spec.sorts?.length) return matched;
    return [...matched].sort((a, b) => compareRows(cols, a, b, spec.sorts as SortSpec[]));
  }, [rows, cols, spec.search, spec.rules, spec.sorts]);

  const result = useMemo(
    () => buildPivot(cols, filteredRows, spec.rows, spec.col, spec.measures),
    [cols, filteredRows, spec.rows, spec.col, spec.measures],
  );
  const colDomain = useMemo(() => fieldDomain(cols.find((c) => c.key === spec.col), rows), [cols, spec.col, rows]);
  const rowDomain = useMemo(() => fieldDomain(cols.find((c) => c.key === groupBy), rows), [cols, groupBy, rows]);
  const chartKind = useMemo(
    () => effectiveChartKind(spec.view as ChartKind, result.nodes.length, cols.find((c) => c.key === groupBy)),
    [spec.view, result.nodes.length, cols, groupBy],
  );
  const readiness = useMemo(() => chartReadiness(spec, cols, filteredRows), [spec, cols, filteredRows]);
  const chartOk = spec.view === 'table' || readiness.ok;

  const ruleCount = spec.rules.conditions.filter(isActiveCondition).length;
  const draftRuleCount = draftRules.conditions.filter(isActiveCondition).length;
  const groupCandidates = useMemo(() => chartGroupCandidates(cols), [cols]);
  const splitCandidates = useMemo(
    () => cols.filter((c) => c.key !== groupBy && c.type !== 'number'),
    [cols, groupBy],
  );

  const setGroupBy = (key: string | null) => patch({ rows: key ? [key] : [], col: key && spec.col === key ? null : spec.col });
  const setSplitBy = (key: string | null) => { if (key !== groupBy) patch({ col: key }); };
  const setPrimaryMeasure = (key: string, agg: AggFn) => patch({ measures: [{ id: spec.measures[0]?.id ?? 'm0', key, agg }], measureIdx: 0 });

  const toggleSort = (key: string, additive: boolean) => {
    patch({
      sorts: (() => {
        const cur = spec.sorts ?? [];
        const ex = cur.find((s) => s.key === key);
        if (!additive) {
          if (!ex) return [{ key, dir: 'asc' as const }];
          if (ex.dir === 'asc') return [{ key, dir: 'desc' as const }];
          return [];
        }
        if (!ex) return [...cur, { key, dir: 'asc' as const }];
        if (ex.dir === 'asc') return cur.map((s) => (s.key === key ? { ...s, dir: 'desc' as const } : s));
        return cur.filter((s) => s.key !== key);
      })(),
    });
  };

  const doSave = async () => {
    const isFork = spec.mine === false;
    const s: ReportSpec = {
      ...spec,
      visibleColumns: visibleKeys,
      includes,
      id: (spec.id && !isFork) ? spec.id : newSpecId(),
      name: isFork ? `${spec.name} (copy)` : (spec.name.trim() || `${dataset.label} report`),
      shared: isFork ? false : spec.shared,
      mine: true,
    };
    setSpec(s);
    setSavedSource(await persistSpec(s));
    setSavedAt(true);
    setTimeout(() => setSavedAt(false), 2200);
    onSavedChange?.();
  };

  const factLines = () => [
    { label: 'Dataset', value: `${dataset.module} · ${dataset.label}` },
    { label: 'Generated', value: new Date().toLocaleString() },
    { label: 'Rows', value: `${filteredRows.length.toLocaleString()}${filteredRows.length !== rows.length ? ` of ${rows.length.toLocaleString()}` : ''}` },
    { label: 'Columns', value: visibleKeys.map(labelFor).join(', ') || '—' },
    { label: 'Grouped by', value: groupBy ? labelFor(groupBy) : '—' },
    { label: 'Split by', value: splitBy ? labelFor(splitBy) : '—' },
    { label: 'Values', value: spec.measures.map((m) => (m.agg === 'count' && !m.key ? 'Count' : `${AGG_LABEL[m.agg]} ${labelFor(m.key)}`)).join(', ') || '—' },
    { label: 'Filters', value: describeRules(cols, spec.rules) },
    ...(includes.length ? [{ label: 'Cross-module links', value: includes.map((k) => linkageCatalog.find((l) => l.key === k)?.label ?? k).join(', ') }] : []),
    ...(spec.search.trim() ? [{ label: 'Search', value: `“${spec.search.trim()}”` }] : []),
  ];
  const exportCols = visibleKeys.map((k) => cols.find((c) => c.key === k)).filter(Boolean) as typeof cols;

  const doExport = async (kind: 'pdf' | 'excel' | 'csv' | 'word') => {
    setMenu(false);
    const name = spec.name.trim() || dataset.label;
    if (kind === 'pdf') {
      stashPrintSpec({ ...spec, name, visibleColumns: visibleKeys, includes });
      window.open('/reports/print', '_blank', 'noopener');
      return;
    }
    if (kind === 'csv') { exportCSV(name, exportCols, filteredRows); return; }
    if (kind === 'excel') {
      exportExcelMulti(name, [
        { name: 'Report', cols: exportCols, rows: filteredRows },
        { name: 'Definition', aoa: [['Field', 'Value'], ...factLines().map((f) => [f.label, f.value])] },
      ]);
      return;
    }
    setExporting(true);
    try {
      await exportWord(name, { title: name, subtitle: `${dataset.module} · ${dataset.label}`, facts: factLines() }, exportCols, filteredRows);
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

  const primaryMeasure = spec.measures[0] ?? { id: 'm0', key: '', agg: 'count' as AggFn };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 gap-3 overflow-hidden">
      <aside className="flex w-[280px] shrink-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="shrink-0 border-b border-slate-100 bg-slate-50/80 px-3 py-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Build report</p>
          <p className="truncate text-xs text-slate-600">{dataset.label}</p>
        </div>
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
          <BuilderSection step={1} title="Columns" count={visibleKeys.length} hint="Add base and linkage columns, then arrange layout">
            <div className="mb-2 flex gap-1">
              <button type="button" onClick={() => patch({ visibleColumns: allCols.map((c) => c.key) })} className="rounded px-2 py-0.5 text-[10px] font-medium text-slate-500 hover:bg-slate-100">All</button>
              <button type="button" onClick={() => patch({ visibleColumns: defaultVisibleColumns(dataset.columns), pinnedColumns: [], columnWidths: {}, columnAlign: {} })} className="rounded px-2 py-0.5 text-[10px] font-medium text-slate-500 hover:bg-slate-100">Reset</button>
            </div>
            <ColumnPicker
              baseColumns={dataset.columns}
              linkageCatalog={linkageCatalog}
              linkageColumns={linkageColDefs}
              visibleKeys={visibleKeys}
              onChange={(keys) => patch({ visibleColumns: keys })}
              fieldQ={fieldQ}
              onFieldQChange={setFieldQ}
            />
            <div className="mt-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Selected order</p>
              <SelectedColumnList
                cols={allCols}
                visibleKeys={visibleKeys}
                align={spec.columnAlign ?? {}}
                pinned={spec.pinnedColumns ?? []}
                onReorder={(keys) => patch({ visibleColumns: keys })}
                onRemove={(key) => patch({ visibleColumns: visibleKeys.filter((k) => k !== key), pinnedColumns: (spec.pinnedColumns ?? []).filter((k) => k !== key) })}
                onAlign={(key, align) => patch({ columnAlign: { ...(spec.columnAlign ?? {}), [key]: align } })}
                onPin={(key) => patch({ pinnedColumns: (spec.pinnedColumns ?? []).includes(key) ? (spec.pinnedColumns ?? []).filter((k) => k !== key) : [...(spec.pinnedColumns ?? []), key] })}
              />
            </div>
          </BuilderSection>

          <BuilderSection step={2} title="Filters" count={ruleCount + (spec.search.trim() ? 1 : 0)} hint="Multiple filters with apply and reset">
            <button type="button" onClick={() => setShowFilters((s) => !s)} className={`mb-1.5 flex w-full items-center gap-1.5 rounded-md border px-2.5 py-2 text-xs font-medium ${ruleCount || showFilters ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
              <Filter className="h-3.5 w-3.5" />
              {draftRuleCount ? `${draftRuleCount} draft rule${draftRuleCount > 1 ? 's' : ''}` : 'Add filter rules'}
            </button>
            {showFilters && (
              <>
                <div className="relative mb-2">
                  <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                  <input value={draftSearch} onChange={(e) => setDraftSearch(e.target.value)} placeholder="Search all columns…" className="w-full rounded-lg border border-slate-200 py-1.5 pl-8 pr-2 text-xs focus:border-primary-500 focus:outline-none" />
                </div>
                <FilterBuilder compact staged dirty={filtersDirty} cols={cols} rows={rows} rules={draftRules} onChange={setDraftRules} onApply={applyFilters} onReset={resetFilters} onClose={() => setShowFilters(false)} />
              </>
            )}
          </BuilderSection>

          {spec.view !== 'table' && (
            <BuilderSection step={3} title="Chart setup" hint="How to aggregate for charts">
              <label className="mb-2 block">
                <span className="mb-1 block text-[10px] font-medium text-slate-500">Group by *</span>
                <select value={groupBy ?? ''} onChange={(e) => setGroupBy(e.target.value || null)} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs focus:border-primary-500 focus:outline-none">
                  <option value="">Select field…</option>
                  {groupCandidates.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </label>
              <label className="mb-2 block">
                <span className="mb-1 block text-[10px] font-medium text-slate-500">Split by (optional)</span>
                <select value={splitBy ?? ''} onChange={(e) => setSplitBy(e.target.value || null)} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs focus:border-primary-500 focus:outline-none">
                  <option value="">None — single series</option>
                  {splitCandidates.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] font-medium text-slate-500">Value</span>
                <div className="flex gap-1">
                  <select value={primaryMeasure.key} onChange={(e) => setPrimaryMeasure(e.target.value, primaryMeasure.agg)} className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs focus:border-primary-500 focus:outline-none">
                    <option value="">Count of rows</option>
                    {cols.filter((c) => c.type === 'number').map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                  {primaryMeasure.key && (
                    <select value={primaryMeasure.agg} onChange={(e) => setPrimaryMeasure(primaryMeasure.key, e.target.value as AggFn)} className="w-16 rounded-lg border border-slate-200 bg-white px-1 py-1.5 text-xs">
                      {NUM_AGGS.map((a) => <option key={a} value={a}>{AGG_LABEL[a]}</option>)}
                    </select>
                  )}
                </div>
              </label>
            </BuilderSection>
          )}
        </div>
      </aside>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
          <input value={spec.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Untitled report" className="min-w-0 flex-1 basis-[8rem] rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-base font-semibold text-slate-900 placeholder:font-normal placeholder:text-slate-400 hover:border-slate-200 focus:border-primary-500 focus:bg-white focus:outline-none" />
          <div className="relative">
            <button type="button" onClick={() => setMenu((m) => !m)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Export
            </button>
            {menu && (
              <div className="absolute right-0 top-full z-40 mt-1 w-56 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                <button type="button" onClick={() => doExport('pdf')} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50"><Printer className="h-4 w-4 text-rose-600" /> PDF</button>
                <button type="button" onClick={() => doExport('excel')} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50"><FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Excel</button>
                <button type="button" onClick={() => doExport('word')} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50"><FileType2 className="h-4 w-4 text-sky-700" /> Word</button>
                <button type="button" onClick={() => doExport('csv')} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50"><FileText className="h-4 w-4 text-slate-500" /> CSV</button>
              </div>
            )}
          </div>
          <button type="button" onClick={() => patch({ shared: !spec.shared })} className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${spec.shared ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}>
            {spec.shared ? <Users className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />} {spec.shared ? 'Shared' : 'Private'}
          </button>
          <button type="button" onClick={doSave} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-600">
            {savedAt ? <><Check className="h-3.5 w-3.5" strokeWidth={3} /> Saved ({savedSource})</> : <><Save className="h-3.5 w-3.5" /> Save</>}
          </button>
        </div>

        <div className="mb-1.5 flex shrink-0 flex-wrap items-center gap-3 text-xs text-slate-500">
          <span className="inline-flex items-center gap-1"><Columns3 className="h-3.5 w-3.5" /> {visibleKeys.length} columns</span>
          <span className="inline-flex items-center gap-1"><Sigma className="h-3.5 w-3.5" /> {filteredRows.length.toLocaleString()} rows</span>
          {ruleCount > 0 && <span className="inline-flex items-center gap-1"><Filter className="h-3.5 w-3.5" /> {ruleCount} filter{ruleCount > 1 ? 's' : ''}</span>}
          {includes.length > 0 && <span className="inline-flex items-center gap-1"><Link2 className="h-3.5 w-3.5" /> {includes.length} link{includes.length > 1 ? 's' : ''}</span>}
          {isFetching && <span className="inline-flex items-center gap-1 text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Enriching linked columns…</span>}
        </div>

        <div className="mb-2 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
          <ChartViewStrip
            view={spec.view}
            onChange={(v) => {
              patch({ view: v });
              if (v !== 'table' && !groupBy) {
                const first = chartGroupCandidates(cols)[0];
                if (first) patch({ view: v, rows: [first.key], col: null });
              }
            }}
          />
        </div>

        {!chartOk && spec.view !== 'table' && (
          <div className="mb-2 flex shrink-0 gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="min-w-0">
              <p className="font-medium">Chart needs a clearer setup</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {readiness.issues.map((issue) => <li key={issue}>{issue}</li>)}
              </ul>
              {readiness.suggestion && <p className="mt-1.5 text-amber-800">{readiness.suggestion}</p>}
            </div>
          </div>
        )}

        {spec.view === 'table' ? (
          <ReportDataTable
            cols={cols}
            rows={filteredRows}
            visibleKeys={visibleKeys}
            widths={spec.columnWidths ?? {}}
            align={spec.columnAlign ?? {}}
            pinned={spec.pinnedColumns ?? []}
            sorts={spec.sorts ?? []}
            labelFor={labelFor}
            onWidthsChange={(w) => patch({ columnWidths: w })}
            onReorder={(keys) => patch({ visibleColumns: keys })}
            onSort={toggleSort}
          />
        ) : chartOk ? (
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-slate-200 bg-white p-3">
            <PivotChart result={result} kind={chartKind} measureIdx={0} colDomain={colDomain} rowDomain={rowDomain} options={{ legend: spec.showLegend !== false, labels: !!spec.showLabels }} />
          </div>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
            Fix chart setup in the left panel, or switch to Table view.
          </div>
        )}
      </section>
    </div>
  );
}

function BuilderSection({ step, title, count, hint, children }: {
  step: number;
  title: string;
  count?: number;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="border-b border-slate-100 p-3 last:border-0">
      <div className="mb-2 flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">{step}</span>
        <span className="text-xs font-semibold text-slate-800">{title}</span>
        {count != null && count > 0 && (
          <span className="ml-auto rounded-full bg-primary-100 px-1.5 py-0.5 text-[10px] font-semibold text-primary-800">{count}</span>
        )}
      </div>
      {hint && <p className="mb-2 text-[10px] leading-snug text-slate-400">{hint}</p>}
      {children}
    </div>
  );
}
