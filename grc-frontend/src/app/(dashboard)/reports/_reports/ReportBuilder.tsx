'use client';

import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  AlertCircle, ArrowDownUp, Check, ChevronDown, Columns3, Download, FileSpreadsheet,
  FileText, FileType2, Filter, Layers, LayoutGrid, Link2, Loader2, Lock,
  Plus, Printer, Save, Search, Sigma, Users, X, Pencil,
} from 'lucide-react';
import type { ColType, ReportDataset, ReportSpec, SortSpec } from './types';
import { emptySpec } from './types';
import {
  asRows, compareRows, describeRules, isActiveCondition,
  rowMatchesRules, rowMatchesSearch,
} from './grid-utils';
import ReportDataTable from './ReportDataTable';
import FilterBuilder from './FilterBuilder';
import ColumnPicker from './ColumnPicker';
import { allLinkageColumns, enrichReportRows, fetchLinkageCatalog, linkageKeysForFields, linkagePresenceColumns, presenceTarget } from './linkages';
import { parseXmodKey, xmodKey } from './openCatalog';
import { exportCSV, exportExcelMulti, exportWord } from './exporters';
import { newSpecId, persistSpec, type SpecSource } from './savedReports';
import { stashPrintSpec } from './printPayload';

const typeHint = (t?: ColType) => (t === 'number' ? '#' : t === 'date' ? 'date' : t === 'badge' ? 'tag' : 'text');

function opLabel(op: string): string {
  const map: Record<string, string> = {
    contains: 'contains', notcontains: 'does not contain', eq: 'is', neq: 'is not',
    starts: 'starts with', empty: 'is empty', notempty: 'is not empty',
    gt: '>', gte: '≥', lt: '<', lte: '≤', between: 'between',
    linked: 'is linked to any', notlinked: 'is not linked to any',
  };
  return map[op] || op;
}

const seedSpec = (ds: string): ReportSpec => ({
  ...emptySpec(ds),
  visibleColumns: [],
  measures: [{ id: 'm0', key: '', agg: 'count' }],
  view: 'table',
});

export default function ReportBuilder({
  dataset,
  datasets,
  groupedDatasets,
  recentDatasets,
  onDatasetChange,
  initialSpec,
  onSavedChange,
}: {
  dataset: ReportDataset | null;
  datasets?: ReportDataset[];
  groupedDatasets?: [string, ReportDataset[]][];
  recentDatasets?: ReportDataset[];
  onDatasetChange?: (key: string, seedColumns?: string[]) => void;
  initialSpec?: ReportSpec | null;
  onSavedChange?: () => void;
}) {
  const dsKey = dataset?.key ?? '';
  const initial = initialSpec ?? seedSpec(dsKey || '_blank');
  const [spec, setSpec] = useState<ReportSpec>(() => ({
    ...initial,
    view: 'table',
    visibleColumns: Array.isArray(initial.visibleColumns) ? initial.visibleColumns : [],
    columnWidths: initial.columnWidths ?? {},
    columnAlign: initial.columnAlign ?? {},
    pinnedColumns: initial.pinnedColumns ?? [],
    sorts: initial.sorts ?? [],
    rows: initial.rows ?? [],
  }));
  const [draftRules, setDraftRules] = useState(initial.rules);
  const [draftSearch, setDraftSearch] = useState(initial.search);
  const [fieldQ, setFieldQ] = useState('');
  const [datasetQ, setDatasetQ] = useState('');
  const [panel, setPanel] = useState<'filters' | 'columns' | 'dataset' | 'add-data' | null>(null);
  const [savedAt, setSavedAt] = useState(false);
  const [savedSource, setSavedSource] = useState<SpecSource>('server');
  const [exporting, setExporting] = useState(false);
  const [menu, setMenu] = useState(false);
  const [showTotals, setShowTotals] = useState(true);
  /** Module currently shown in the Add data modal (right pane). */
  const [addDataModule, setAddDataModule] = useState<string | null>(null);
  /** Draft multi-select: datasetKey → field keys. Modal stays open until Apply. */
  const [draftPicks, setDraftPicks] = useState<Record<string, string[]>>({});

  useEffect(() => {
    const next = initialSpec ?? seedSpec(dsKey || '_blank');
    setSpec({
      ...next,
      view: 'table',
      visibleColumns: Array.isArray(next.visibleColumns) ? next.visibleColumns : [],
      columnWidths: next.columnWidths ?? {},
      columnAlign: next.columnAlign ?? {},
      pinnedColumns: next.pinnedColumns ?? [],
      sorts: next.sorts ?? [],
      rows: next.rows ?? [],
    });
    setDraftRules(next.rules);
    setDraftSearch(next.search);
  }, [dsKey, initialSpec]);

  const patch = (p: Partial<ReportSpec>) => setSpec((s) => ({ ...s, ...p }));

  const picksFromVisible = (): Record<string, string[]> => {
    const picks: Record<string, string[]> = {};
    for (const k of spec.visibleColumns ?? []) {
      const x = parseXmodKey(k);
      if (x) {
        picks[x.dataset] = [...(picks[x.dataset] || []), x.field];
        continue;
      }
      if (dataset?.columns.some((c) => c.key === k)) {
        picks[dataset.key] = [...(picks[dataset.key] || []), k];
      }
    }
    return picks;
  };

  const { data: linkageCatalog = [] } = useQuery({
    queryKey: ['report-linkages', dsKey, (datasets ?? []).map((d) => d.key).join(',')],
    queryFn: () => fetchLinkageCatalog(dsKey, datasets ?? (dataset ? [dataset] : [])),
    staleTime: 60_000,
    enabled: !!dataset,
  });

  const visibleKeys = useMemo(() => spec.visibleColumns ?? [], [spec.visibleColumns]);
  const groupByKey = spec.rows[0] ?? null;

  const linkageColDefs = useMemo(() => allLinkageColumns(linkageCatalog), [linkageCatalog]);
  const linkagePresenceCols = useMemo(() => linkagePresenceColumns(linkageCatalog), [linkageCatalog]);
  const allCols = useMemo(
    () => (dataset ? [...dataset.columns, ...linkageColDefs] : []),
    [dataset, linkageColDefs],
  );
  // Filters over the columns the user selected, plus first-class linkage-presence
  // predicates ("(not) linked to any <module>") for every module with a real edge —
  // so orphan filters are reachable without first adding a count column.
  const filterCols = useMemo(
    () => [
      ...visibleKeys.map((k) => allCols.find((c) => c.key === k)).filter((c): c is NonNullable<typeof c> => !!c),
      ...linkagePresenceCols,
    ],
    [visibleKeys, allCols, linkagePresenceCols],
  );
  const labelFor = (key: string) => {
    const col = allCols.find((c) => c.key === key);
    if (!col) return key;
    if (col.linkageModule) return `${col.linkageModule} · ${col.label}`;
    return col.label;
  };

  const appliedFieldKeys = useMemo(() => {
    const keys = new Set<string>([
      ...visibleKeys,
      ...spec.rules.conditions.map((c) => c.col),
      ...draftRules.conditions.map((c) => c.col),
      ...spec.measures.map((m) => m.key).filter(Boolean),
      ...(groupByKey ? [groupByKey] : []),
    ]);
    return Array.from(keys);
  }, [visibleKeys, spec.rules.conditions, draftRules.conditions, spec.measures, groupByKey]);

  const includes = useMemo(() => {
    const base = linkageKeysForFields(appliedFieldKeys, linkageCatalog);
    // A "(not) linked to any X" filter must enrich X so its link count is present.
    const presence = appliedFieldKeys
      .map(presenceTarget)
      .filter((t): t is string => !!t);
    return Array.from(new Set([...base, ...presence]));
  }, [appliedFieldKeys, linkageCatalog]);

  // Project only the cross-module fields actually referenced (link counts are set
  // for every included target regardless), so a presence-only filter stays cheap.
  const projectFields = useMemo(
    () => appliedFieldKeys.filter((k) => k.startsWith('xmod_')),
    [appliedFieldKeys],
  );

  const includesKey = includes.join(',');

  const { data: rawRows = [], isLoading, isFetched, error, refetch, isFetching } = useQuery({
    queryKey: ['report', dsKey, includesKey],
    queryFn: async () => {
      if (!dataset) return [];
      const base = asRows(await dataset.fetch());
      if (!includes.length) return base;
      return enrichReportRows(dataset.key, base, includes, projectFields);
    },
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    enabled: !!dataset,
  });
  const rows = asRows(rawRows);
  const showInitialLoad = !!dataset && isLoading && !isFetched && rows.length === 0;

  const cols = useMemo(() => {
    if (!dataset) return [];
    const inc = new Set(includes);
    return [
      ...dataset.columns,
      ...linkageColDefs.filter((c) => c.linkageKey && inc.has(c.linkageKey)),
      // Presence pseudo-columns for enriched targets so active "(not) linked"
      // conditions resolve during row evaluation (and read cleanly in exports).
      ...linkagePresenceCols.filter((c) => c.linkageKey && inc.has(c.linkageKey)),
    ];
  }, [dataset, linkageColDefs, linkagePresenceCols, includes]);

  const filtersDirty = useMemo(
    () => JSON.stringify(draftRules) !== JSON.stringify(spec.rules) || draftSearch !== spec.search,
    [draftRules, spec.rules, draftSearch, spec.search],
  );
  const applyFilters = () => {
    patch({ rules: draftRules, search: draftSearch });
    setPanel(null);
  };
  const resetFilters = () => {
    const empty = { logic: 'AND' as const, conditions: [] };
    setDraftRules(empty);
    setDraftSearch('');
    patch({ rules: empty, search: '' });
  };

  const filteredRows = useMemo(() => {
    const matched = rows.filter(
      (r) => rowMatchesSearch(cols, r, spec.search) && rowMatchesRules(cols, r, spec.rules),
    );
    if (!spec.sorts?.length) return matched;
    return [...matched].sort((a, b) => compareRows(cols, a, b, spec.sorts as SortSpec[]));
  }, [rows, cols, spec.search, spec.rules, spec.sorts]);

  const ruleCount = spec.rules.conditions.filter(isActiveCondition).length;
  const activeConditions = spec.rules.conditions.filter(isActiveCondition);

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

  const removeCondition = (id: string) => {
    const next = {
      ...spec.rules,
      conditions: spec.rules.conditions.filter((c) => c.id !== id),
    };
    setDraftRules(next);
    patch({ rules: next });
  };

  const doSave = async () => {
    if (!dataset) return;
    const isFork = spec.mine === false;
    const s: ReportSpec = {
      ...spec,
      view: 'table',
      visibleColumns: visibleKeys,
      includes,
      dataset: dataset.key,
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
    { label: 'Dataset', value: dataset ? `${dataset.module} · ${dataset.label}` : '—' },
    { label: 'Generated', value: new Date().toLocaleString() },
    {
      label: 'Rows',
      value: `${filteredRows.length.toLocaleString()}${filteredRows.length !== rows.length ? ` of ${rows.length.toLocaleString()}` : ''}`,
    },
    { label: 'Columns', value: visibleKeys.map(labelFor).join(', ') || '(none — empty report)' },
    { label: 'Filters', value: describeRules(cols, spec.rules) },
    ...(includes.length
      ? [{ label: 'Cross-module links', value: includes.map((k) => linkageCatalog.find((l) => l.key === k)?.label ?? k).join(', ') }]
      : []),
    ...(spec.search.trim() ? [{ label: 'Search', value: `“${spec.search.trim()}”` }] : []),
  ];
  const exportCols = visibleKeys.map((k) => cols.find((c) => c.key === k)).filter(Boolean) as typeof cols;

  const doExport = async (kind: 'pdf' | 'excel' | 'csv' | 'word') => {
    if (!dataset) return;
    setMenu(false);
    const name = spec.name.trim() || dataset.label;
    if (kind === 'pdf') {
      stashPrintSpec({ ...spec, name, visibleColumns: visibleKeys, includes, view: 'table', dataset: dataset.key });
      window.open('/reports/print', '_blank', 'noopener');
      return;
    }
    if (kind === 'csv') {
      exportCSV(name, exportCols, filteredRows);
      return;
    }
    if (kind === 'excel') {
      exportExcelMulti(name, [
        { name: 'Report', cols: exportCols, rows: filteredRows },
        { name: 'Definition', aoa: [['Field', 'Value'], ...factLines().map((f) => [f.label, f.value])] },
      ]);
      return;
    }
    setExporting(true);
    try {
      await exportWord(
        name,
        { title: name, subtitle: `${dataset.module} · ${dataset.label}`, facts: factLines() },
        exportCols,
        filteredRows,
      );
    } finally {
      setExporting(false);
    }
  };

  const groupOptions = useMemo(() => {
    if (!dataset) return [];
    const keys = new Set([...dataset.columns.map((c) => c.key), ...visibleKeys]);
    return allCols.filter((c) => keys.has(c.key) && (c.type === 'badge' || c.type === 'text'));
  }, [allCols, dataset, visibleKeys]);

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && sessionStorage.getItem('grc.reports.openColumns') === '1') {
        sessionStorage.removeItem('grc.reports.openColumns');
        if (dataset) setPanel('columns');
      }
    } catch { /* ignore */ }
  }, [dataset]);

  const openAddData = () => {
    const picks = picksFromVisible();
    setDraftPicks(picks);
    const first = Object.keys(picks)[0] || (datasets ?? [])[0]?.key || null;
    setAddDataModule(first);
    setFieldQ('');
    setPanel('add-data');
  };

  const toggleDraftPick = (moduleKey: string, colKey: string) => {
    setDraftPicks((prev) => {
      const cur = new Set(prev[moduleKey] || []);
      if (cur.has(colKey)) cur.delete(colKey);
      else cur.add(colKey);
      const next = { ...prev, [moduleKey]: Array.from(cur) };
      if (next[moduleKey].length === 0) delete next[moduleKey];
      return next;
    });
  };

  const draftPickCount = useMemo(
    () => Object.values(draftPicks).reduce((n, cols) => n + cols.length, 0),
    [draftPicks],
  );

  const applyAddData = () => {
    const entries = Object.entries(draftPicks).filter(([, cols]) => cols.length > 0);
    if (!entries.length) {
      setPanel(null);
      return;
    }

    if (!dataset) {
      // Prefer the module the user is browsing, else the one with the most picks.
      const preferred = addDataModule && draftPicks[addDataModule]?.length
        ? addDataModule
        : entries.sort((a, b) => b[1].length - a[1].length)[0][0];
      const baseCols = draftPicks[preferred] || [];
      const visible: string[] = [...baseCols];
      for (const [modKey, cols] of entries) {
        if (modKey === preferred) continue;
        for (const c of cols) visible.push(xmodKey(modKey, c));
      }
      onDatasetChange?.(preferred, visible);
      setPanel(null);
      return;
    }

    // Existing base — keep it; map other modules to xmod_* linkage keys.
    const visible: string[] = [];
    for (const [modKey, cols] of entries) {
      if (modKey === dataset.key) {
        visible.push(...cols);
      } else {
        for (const c of cols) visible.push(xmodKey(modKey, c));
      }
    }
    patch({ visibleColumns: visible });
    setPanel(null);
  };

  const dq = datasetQ.trim().toLowerCase();
  const filteredGrouped = useMemo(() => {
    const source = groupedDatasets ?? [];
    if (!dq) return source;
    return source
      .map(([mod, list]) => [
        mod,
        list.filter(
          (d) =>
            d.label.toLowerCase().includes(dq) ||
            d.module.toLowerCase().includes(dq) ||
            (d.description || '').toLowerCase().includes(dq),
        ),
      ] as [string, ReportDataset[]])
      .filter(([, list]) => list.length > 0);
  }, [groupedDatasets, dq]);

  const filteredRecent = useMemo(() => {
    const source = recentDatasets ?? [];
    if (!dq) return source;
    return source.filter(
      (d) => d.label.toLowerCase().includes(dq) || d.module.toLowerCase().includes(dq),
    );
  }, [recentDatasets, dq]);

  if (showInitialLoad) {
    return (
      <div className="flex flex-1 items-center justify-center text-slate-400">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (error && rows.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-rose-700">
        <AlertCircle className="h-6 w-6" />
        <p className="text-sm">Could not load {dataset?.label || 'data'}.</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="rounded-md border border-rose-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-rose-100"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="relative max-w-xl">
            <Pencil className="pointer-events-none absolute left-0 top-2.5 h-3.5 w-3.5 text-slate-300" />
            <input
              value={spec.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="Untitled report"
              className="w-full border-0 bg-transparent py-1 pl-5 text-lg font-semibold tracking-tight text-slate-900 placeholder:font-normal placeholder:text-slate-400 focus:outline-none"
            />
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
            <span className="font-medium text-slate-600">
              {dataset ? `${dataset.module} · ${dataset.label}` : 'No module selected'}
            </span>
            <span>·</span>
            <span>{visibleKeys.length} columns</span>
            <span>·</span>
            <span>
              {filteredRows.length.toLocaleString()}
              {filteredRows.length !== rows.length ? ` of ${rows.length.toLocaleString()}` : ''} rows
            </span>
            {isFetching && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1 text-slate-400">
                  <Loader2 className="h-3 w-3 animate-spin" /> Enriching…
                </span>
              </>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenu((m) => !m)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Export
            </button>
            {menu && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setMenu(false)} />
                <div className="absolute right-0 top-full z-40 mt-1 w-52 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">
                  <button type="button" onClick={() => doExport('pdf')} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50">
                    <Printer className="h-4 w-4 text-rose-600" /> PDF
                  </button>
                  <button type="button" onClick={() => doExport('excel')} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50">
                    <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Excel
                  </button>
                  <button type="button" onClick={() => doExport('word')} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50">
                    <FileType2 className="h-4 w-4 text-sky-700" /> Word
                  </button>
                  <button type="button" onClick={() => doExport('csv')} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50">
                    <FileText className="h-4 w-4 text-slate-500" /> CSV
                  </button>
                </div>
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => patch({ shared: !spec.shared })}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
              spec.shared
                ? 'border-primary-300 bg-primary-50 text-primary-700'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {spec.shared ? <Users className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
            {spec.shared ? 'Shared' : 'Private'}
          </button>
          <button
            type="button"
            onClick={doSave}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] shadow-sm hover:bg-primary-600"
          >
            {savedAt ? (
              <>
                <Check className="h-3.5 w-3.5" strokeWidth={3} /> Saved{savedSource === 'local' ? ' locally' : ''}
              </>
            ) : (
              <>
                <Save className="h-3.5 w-3.5" /> Save report
              </>
            )}
          </button>
        </div>
      </header>

      <div className="relative flex shrink-0 flex-wrap items-center gap-1.5 border-b border-slate-100 px-3 py-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => setPanel((p) => (p === 'dataset' ? null : 'dataset'))}
            aria-haspopup="listbox"
            aria-expanded={panel === 'dataset'}
            className={`inline-flex max-w-[14rem] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
              panel === 'dataset'
                ? 'border-primary-300 bg-primary-50 text-primary-800'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="min-w-0 truncate">{dataset?.label || 'Select dataset'}</span>
            <ChevronDown
              className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${
                panel === 'dataset' ? 'rotate-180 text-primary-700' : ''
              }`}
            />
          </button>
          {panel === 'dataset' && onDatasetChange && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setPanel(null)} />
              <div className="absolute left-0 top-full z-40 mt-1 flex max-h-[min(70vh,480px)] w-80 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                <div className="border-b border-slate-100 p-2.5">
                  <p className="mb-2 text-sm font-semibold text-slate-800">Choose dataset</p>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                    <input
                      value={datasetQ}
                      onChange={(e) => setDatasetQ(e.target.value)}
                      placeholder="Find a dataset"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2 text-xs focus:border-primary-500 focus:bg-white focus:outline-none"
                      autoFocus
                    />
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-2">
                  {!dq && filteredRecent.length > 0 && (
                    <div className="mb-3">
                      <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Recent</p>
                      {filteredRecent.map((d) => (
                        <button
                          key={`recent-${d.key}`}
                          type="button"
                          onClick={() => {
                            onDatasetChange(d.key);
                            setPanel(null);
                            setDatasetQ('');
                          }}
                          className={`mb-0.5 block w-full truncate rounded-lg px-2.5 py-2 text-left text-sm ${
                            d.key === dataset?.key
                              ? 'bg-primary-50 font-semibold text-primary-800'
                              : 'text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    All modules ({(datasets ?? []).length})
                  </p>
                  {filteredGrouped.map(([mod, list]) => (
                    <div key={mod} className="mb-2">
                      <p className="px-2 text-[10px] font-medium text-slate-400">{mod}</p>
                      {list.map((d) => (
                        <button
                          key={d.key}
                          type="button"
                          onClick={() => {
                            onDatasetChange(d.key);
                            setPanel(null);
                            setDatasetQ('');
                          }}
                          className={`mb-0.5 block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-sm ${
                            d.key === dataset?.key
                              ? 'bg-primary-50 font-semibold text-primary-800'
                              : 'text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  ))}
                  {filteredGrouped.length === 0 && (
                    <p className="px-2 py-4 text-center text-xs text-slate-400">No datasets match.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <ToolbarBtn
          active={panel === 'filters' || ruleCount > 0}
          onClick={() => setPanel((p) => (p === 'filters' ? null : 'filters'))}
          icon={<Filter className="h-3.5 w-3.5" />}
        >
          Filter{ruleCount ? ` (${ruleCount})` : ''}
        </ToolbarBtn>

        <ToolbarBtn
          active={panel === 'columns' || panel === 'add-data' || visibleKeys.length > 0}
          onClick={() => (dataset ? setPanel((p) => (p === 'columns' ? null : 'columns')) : openAddData())}
          icon={<Columns3 className="h-3.5 w-3.5" />}
        >
          {visibleKeys.length || 0} columns
        </ToolbarBtn>

        <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600">
          <Layers className="h-3.5 w-3.5 text-slate-400" />
          <select
            value={groupByKey || ''}
            onChange={(e) => patch({ rows: e.target.value ? [e.target.value] : [] })}
            className="max-w-[9rem] bg-transparent text-xs font-medium focus:outline-none"
          >
            <option value="">Group: none</option>
            {groupOptions.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
        </div>

        <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600">
          <ArrowDownUp className="h-3.5 w-3.5 text-slate-400" />
          <select
            value={spec.sorts?.[0] ? `${spec.sorts[0].key}:${spec.sorts[0].dir}` : ''}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return patch({ sorts: [] });
              const [key, dir] = v.split(':');
              patch({ sorts: [{ key, dir: dir as 'asc' | 'desc' }] });
            }}
            className="max-w-[10rem] bg-transparent text-xs font-medium focus:outline-none"
          >
            <option value="">Sort: none</option>
            {visibleKeys.map((k) => (
              <optgroup key={k} label={labelFor(k)}>
                <option value={`${k}:asc`}>{labelFor(k)} ↑</option>
                <option value={`${k}:desc`}>{labelFor(k)} ↓</option>
              </optgroup>
            ))}
          </select>
        </div>

        <ToolbarBtn
          active={showTotals}
          onClick={() => setShowTotals((t) => !t)}
          icon={<Sigma className="h-3.5 w-3.5" />}
        >
          Totals {showTotals ? 'on' : 'off'}
        </ToolbarBtn>

        <span className="ml-auto text-[11px] tabular-nums text-slate-400">
          {filteredRows.length.toLocaleString()}
          {filteredRows.length !== rows.length ? ` of ${rows.length.toLocaleString()}` : ''} rows
        </span>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1.5 px-3 py-2">
        {activeConditions.map((c) => {
          const col = cols.find((x) => x.key === c.col) || allCols.find((x) => x.key === c.col);
          const noValueOp = ['empty', 'notempty', 'linked', 'notlinked'].includes(c.op);
          return (
            <Chip key={c.id} onRemove={() => removeCondition(c.id)}>
              {col?.label || c.col} {opLabel(c.op)}
              {!noValueOp && c.value ? ` ${c.value}` : ''}
            </Chip>
          );
        })}
        {spec.search.trim() && (
          <Chip onRemove={() => { setDraftSearch(''); patch({ search: '' }); }}>
            Search “{spec.search.trim()}”
          </Chip>
        )}
        {visibleKeys.map((k) => (
          <span
            key={k}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-700"
          >
            {labelFor(k)}
            <button
              type="button"
              onClick={() => patch({ visibleColumns: visibleKeys.filter((x) => x !== k) })}
              className="rounded-full p-0.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
              aria-label={`Remove ${labelFor(k)}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <button
          type="button"
          onClick={openAddData}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:border-primary-400 hover:text-primary-700"
        >
          <Plus className="h-3 w-3" /> Add data
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>

      {panel === 'filters' && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setPanel(null)} />
          <div className="absolute left-3 top-[7.25rem] z-40 w-[min(100%-1.5rem,28rem)] rounded-2xl border border-slate-200 bg-white p-3 shadow-2xl">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-800">Filters</p>
              <button type="button" onClick={() => setPanel(null)} className="rounded p-1 text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            {filterCols.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
                Add data columns first — filters only apply to columns you’ve selected.
              </p>
            ) : (
              <>
                <input
                  value={draftSearch}
                  onChange={(e) => setDraftSearch(e.target.value)}
                  placeholder="Search selected columns…"
                  className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs focus:border-primary-500 focus:outline-none"
                />
                <FilterBuilder
                  staged
                  dirty={filtersDirty}
                  cols={filterCols}
                  rows={rows}
                  rules={draftRules}
                  onChange={setDraftRules}
                  onApply={applyFilters}
                  onReset={resetFilters}
                  onClose={() => setPanel(null)}
                />
              </>
            )}
          </div>
        </>
      )}

      {panel === 'add-data' && (
        <>
          <div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px]" onClick={() => setPanel(null)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <div
              className="pointer-events-auto flex h-[min(82vh,720px)] w-[min(960px,96vw)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
                <div>
                  <p className="text-base font-semibold text-slate-900">Add data</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Select any fields from any module. Multi-select stays open until you apply.
                  </p>
                </div>
                <button type="button" onClick={() => setPanel(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="shrink-0 border-b border-slate-100 px-5 py-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                  <input
                    value={fieldQ}
                    onChange={(e) => setFieldQ(e.target.value)}
                    placeholder="Search modules or fields…"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-3 text-sm focus:border-primary-500 focus:bg-white focus:outline-none"
                    autoFocus
                  />
                </div>
              </div>

              <div className="flex min-h-0 flex-1">
                {/* Module rail */}
                <aside className="flex w-[260px] shrink-0 flex-col border-r border-slate-100 bg-slate-50/60">
                  <p className="px-4 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    Modules ({(datasets ?? []).length})
                  </p>
                  <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                    {(groupedDatasets ?? []).map(([mod, list]) => {
                      const q = fieldQ.trim().toLowerCase();
                      const modules = list.filter(
                        (d) =>
                          !q ||
                          d.label.toLowerCase().includes(q) ||
                          d.module.toLowerCase().includes(q) ||
                          d.columns.some((c) => c.label.toLowerCase().includes(q)),
                      );
                      if (!modules.length) return null;
                      return (
                        <div key={mod} className="mb-2">
                          <p className="px-2 py-1 text-[10px] font-medium text-slate-400">{mod}</p>
                          {modules.map((d) => {
                            const n = draftPicks[d.key]?.length || 0;
                            const active = addDataModule === d.key;
                            return (
                              <button
                                key={d.key}
                                type="button"
                                onClick={() => setAddDataModule(d.key)}
                                className={`mb-0.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                                  active
                                    ? 'bg-white font-semibold text-primary-800 shadow-sm ring-1 ring-primary-200'
                                    : 'text-slate-700 hover:bg-white/80'
                                }`}
                              >
                                <span className="min-w-0 flex-1 truncate">{d.label}</span>
                                {n > 0 && (
                                  <span className="rounded-full bg-primary-500 px-1.5 py-0.5 text-[10px] font-bold text-[#0a0a0a]">
                                    {n}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </aside>

                {/* Fields pane */}
                <div className="flex min-w-0 flex-1 flex-col">
                  {(() => {
                    const activeDs = (datasets ?? []).find((d) => d.key === addDataModule) || null;
                    const q = fieldQ.trim().toLowerCase();
                    const fields = activeDs
                      ? activeDs.columns.filter((c) => !q || c.label.toLowerCase().includes(q) || activeDs.label.toLowerCase().includes(q))
                      : [];
                    const selectedInModule = new Set(draftPicks[activeDs?.key || ''] || []);
                    return (
                      <>
                        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-800">
                              {activeDs?.label || 'Choose a module'}
                            </p>
                            {activeDs && (
                              <p className="text-[11px] text-slate-500">
                                {activeDs.module} · {activeDs.columns.length} fields
                                {selectedInModule.size > 0 ? ` · ${selectedInModule.size} selected` : ''}
                              </p>
                            )}
                          </div>
                          {activeDs && fields.length > 0 && (
                            <button
                              type="button"
                              onClick={() => {
                                const allKeys = fields.map((c) => c.key);
                                const allOn = allKeys.every((k) => selectedInModule.has(k));
                                setDraftPicks((prev) => {
                                  const next = { ...prev };
                                  if (allOn) {
                                    const remain = (prev[activeDs.key] || []).filter((k) => !allKeys.includes(k));
                                    if (remain.length) next[activeDs.key] = remain;
                                    else delete next[activeDs.key];
                                  } else {
                                    next[activeDs.key] = Array.from(new Set([...(prev[activeDs.key] || []), ...allKeys]));
                                  }
                                  return next;
                                });
                              }}
                              className="shrink-0 text-[11px] font-semibold text-primary-700 hover:underline"
                            >
                              {fields.every((c) => selectedInModule.has(c.key)) ? 'Deselect all' : 'Select all'}
                            </button>
                          )}
                        </div>
                        <div className="min-h-0 flex-1 overflow-y-auto p-3">
                          {!activeDs ? (
                            <p className="px-2 py-10 text-center text-sm text-slate-400">
                              Pick a module on the left to browse its fields.
                            </p>
                          ) : fields.length === 0 ? (
                            <p className="px-2 py-10 text-center text-sm text-slate-400">No fields match your search.</p>
                          ) : (
                            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                              {fields.map((c) => {
                                const checked = selectedInModule.has(c.key);
                                return (
                                  <label
                                    key={c.key}
                                    className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                                      checked
                                        ? 'bg-primary-50 text-primary-900 ring-1 ring-inset ring-primary-200'
                                        : 'text-slate-700 hover:bg-slate-50'
                                    }`}
                                  >
                                    <span
                                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                                        checked ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300 bg-white'
                                      }`}
                                    >
                                      {checked && <Check className="h-3 w-3" strokeWidth={3} />}
                                    </span>
                                    <input
                                      type="checkbox"
                                      className="sr-only"
                                      checked={checked}
                                      onChange={() => toggleDraftPick(activeDs.key, c.key)}
                                    />
                                    <span className="min-w-0 flex-1 truncate font-medium">{c.label}</span>
                                    <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] capitalize text-slate-500">
                                      {typeHint(c.type)}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>

              <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/80 px-5 py-3">
                <div className="min-w-0 flex-1">
                  {draftPickCount === 0 ? (
                    <p className="text-xs text-slate-500">Nothing selected yet</p>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-semibold text-slate-700">{draftPickCount} selected</span>
                      {Object.entries(draftPicks)
                        .filter(([, cols]) => cols.length)
                        .map(([modKey, cols]) => {
                          const d = (datasets ?? []).find((x) => x.key === modKey);
                          return (
                            <span
                              key={modKey}
                              className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600"
                            >
                              {d?.label || modKey} · {cols.length}
                            </span>
                          );
                        })}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setDraftPicks({})}
                  disabled={draftPickCount === 0}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-rose-600 disabled:opacity-40"
                >
                  Clear
                </button>
                <button
                  type="button"
                  onClick={() => setPanel(null)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={applyAddData}
                  disabled={draftPickCount === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-4 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-600 disabled:opacity-40"
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  Add {draftPickCount || ''} field{draftPickCount === 1 ? '' : 's'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {panel === 'columns' && dataset && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setPanel(null)} />
          <div className="absolute left-3 top-[7.25rem] z-40 flex max-h-[min(72vh,560px)] w-[min(100%-1.5rem,28rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-3 py-2.5">
              <p className="text-sm font-semibold text-slate-800">
                Columns ({visibleKeys.length} selected)
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => patch({ visibleColumns: [] })}
                  className="text-[11px] font-medium text-slate-400 hover:text-rose-600"
                >
                  Clear
                </button>
                <button type="button" onClick={() => setPanel(null)} className="rounded p-1 text-slate-400 hover:text-slate-600">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden p-2.5">
              <ColumnPicker
                compact
                defaultScope="all"
                baseColumns={dataset.columns}
                linkageCatalog={linkageCatalog}
                linkageColumns={linkageColDefs}
                visibleKeys={visibleKeys}
                onChange={(keys) => patch({ visibleColumns: keys })}
                fieldQ={fieldQ}
                onFieldQChange={setFieldQ}
                rows={rows}
              />
            </div>
            {includes.length > 0 && (
              <p className="shrink-0 border-t border-amber-100 bg-amber-50/80 px-3 py-2 text-[10px] text-amber-800">
                Linked fields pull related rows from other modules. Empty values mean no link for that record.
              </p>
            )}
          </div>
        </>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col p-3 pt-2">
        {visibleKeys.length === 0 ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-6 text-center">
            <Columns3 className="h-9 w-9 text-slate-300" />
            <h2 className="mt-3 text-base font-semibold text-slate-800">Empty report</h2>
            <p className="mt-1 max-w-md text-sm text-slate-500">
              Add data from any module — nothing is selected until you choose.
            </p>
            <div className="mt-4">
              <button
                type="button"
                onClick={openAddData}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                <Plus className="h-3.5 w-3.5" />
                Add data
                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
              </button>
            </div>
          </div>
        ) : (
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
            groupByKey={groupByKey}
            showTotals={showTotals}
            totalInDataset={rows.length}
          />
        )}
      </div>
    </div>
  );
}

function ToolbarBtn({
  children,
  onClick,
  active,
  icon,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'border-primary-300 bg-primary-50 text-primary-800'
          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function Chip({ children, onRemove }: { children: React.ReactNode; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary-200 bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-800">
      {children}
      <button type="button" onClick={onRemove} className="rounded-full p-0.5 hover:bg-primary-100" aria-label="Remove">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
