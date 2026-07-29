'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  AlertCircle, ArrowDownUp, Bookmark, Check, ChevronDown, Columns3, Copy, Download,
  FileSpreadsheet, FileText, FileType2, Filter, FolderOpen, LayoutGrid, Loader2,
  Lock, Plus, Printer, Save, Search, Sigma, Trash2, Users, X, Pencil,
} from 'lucide-react';
import type { ColType, ColumnDef, FilterRules, ReportDataset, ReportSpec, Row, ServerQuery, SortSpec } from './types';
import { emptySpec } from './types';
import {
  asRows, compareRows, describeRules, isActiveCondition,
  rowMatchesRules, rowMatchesSearch,
} from './grid-utils';
import {
  aggregateRows, canServerAggregate, isSummaryMode, measureColKey, measureLabel,
} from './aggregate-utils';
import ReportDataTable from './ReportDataTable';
import FilterBuilder from './FilterBuilder';
import ColumnPicker from './ColumnPicker';
import SummarizePanel from './SummarizePanel';
import { allLinkageColumns, enrichReportRows, fetchLinkageCatalog, linkageKeysForFields, linkagePresenceColumns, presenceTarget } from './linkages';
import { parseXmodKey, xmodKey } from './openCatalog';
import { exportCSV, exportExcelMulti, exportWord } from './exporters';
import { duplicateSpec, listSpecs, newSpecId, persistSpec, removeSpec, type SpecSource } from './savedReports';
import { stashPrintSpec } from './printPayload';
import { aggregateServer, queryServer, toServerMeasures } from './serverApi';
import { datasetByKey } from './datasets';

const LINKAGE_OPS = new Set(['linked', 'notlinked']);
const SERVER_BUILD_PAGE = 500;
const SERVER_BUILD_CAP = 5000;

/** Fetch all server pages for Build mode (filters/search applied in SQL).
 *  Linkage ops are excluded — they need post-enrich client evaluation. */
async function fetchServerBuildRows(
  datasetKey: string,
  rules: FilterRules,
  search: string,
  sorts: SortSpec[],
): Promise<Row[]> {
  const filters = rules.conditions
    .filter(isActiveCondition)
    .filter((c) => !LINKAGE_OPS.has(c.op))
    .map((c) => ({ col: c.col, op: c.op, value: c.value }));
  const out: Row[] = [];
  let skip = 0;
  while (skip < SERVER_BUILD_CAP) {
    const body: ServerQuery = {
      dataset: datasetKey,
      skip,
      limit: SERVER_BUILD_PAGE,
      search: search.trim() || undefined,
      sorts: (sorts || []).map((s) => ({ key: s.key, dir: s.dir })),
      filters,
      logic: rules.logic,
    };
    const page = await queryServer(body);
    out.push(...asRows(page.rows));
    if (out.length >= page.total || page.rows.length < SERVER_BUILD_PAGE) break;
    skip += SERVER_BUILD_PAGE;
  }
  return out;
}

const typeHint = (t?: ColType) => (t === 'number' ? '#' : t === 'date' ? 'date' : t === 'badge' ? 'tag' : 'text');

function opLabel(op: string): string {
  const map: Record<string, string> = {
    contains: 'contains', notcontains: 'does not contain', eq: 'is', neq: 'is not',
    starts: 'starts with', empty: 'is empty', notempty: 'is not empty',
    gt: 'greater than', gte: 'greater or equal', lt: 'less than', lte: 'less or equal',
    on: 'on', before: 'before', after: 'after',
    linked: 'is linked to any', notlinked: 'is not linked to any',
  };
  return map[op] || op;
}

const seedSpec = (ds: string): ReportSpec => ({
  ...emptySpec(ds),
  visibleColumns: [],
  measures: [],
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
  onLoadSpec,
}: {
  dataset: ReportDataset | null;
  datasets?: ReportDataset[];
  groupedDatasets?: [string, ReportDataset[]][];
  recentDatasets?: ReportDataset[];
  onDatasetChange?: (key: string, seedColumns?: string[]) => void;
  initialSpec?: ReportSpec | null;
  onSavedChange?: () => void;
  /** Parent loads a saved report into the workspace (dataset + full builder state). */
  onLoadSpec?: (spec: ReportSpec) => void;
}) {
  const dsKey = dataset?.key ?? '';
  const initial = initialSpec ?? seedSpec(dsKey || '_blank');
  const [spec, setSpec] = useState<ReportSpec>(() => ({
    ...initial,
    view: 'table',
    description: initial.description ?? '',
    visibleColumns: Array.isArray(initial.visibleColumns) ? initial.visibleColumns : [],
    columnWidths: initial.columnWidths ?? {},
    columnAlign: initial.columnAlign ?? {},
    pinnedColumns: initial.pinnedColumns ?? [],
    sorts: initial.sorts ?? [],
    rows: initial.rows ?? [],
    measures: Array.isArray(initial.measures) ? initial.measures : [],
  }));
  const [draftRules, setDraftRules] = useState(initial.rules);
  const [draftSearch, setDraftSearch] = useState(initial.search);
  const [fieldQ, setFieldQ] = useState('');
  const [datasetQ, setDatasetQ] = useState('');
  const [panel, setPanel] = useState<'filters' | 'columns' | 'dataset' | 'add-data' | 'summarize' | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryQ, setLibraryQ] = useState('');
  const [savedSpecs, setSavedSpecs] = useState<ReportSpec[]>([]);
  const [librarySource, setLibrarySource] = useState<SpecSource>('server');
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryBusyId, setLibraryBusyId] = useState<string | null>(null);
  const [saveDialog, setSaveDialog] = useState<'save' | 'save-as' | null>(null);
  const [saveName, setSaveName] = useState('');
  const [saveDescription, setSaveDescription] = useState('');
  const [saveShared, setSaveShared] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [savedSource, setSavedSource] = useState<SpecSource>('server');
  const [exporting, setExporting] = useState(false);
  const [menu, setMenu] = useState(false);
  const [showTotals, setShowTotals] = useState(true);
  /** If server /aggregate rejects measures (computed columns, etc.), fall back to client. */
  const [forceClientAgg, setForceClientAgg] = useState(false);
  /** Module currently shown in the Add data modal (right pane). */
  const [addDataModule, setAddDataModule] = useState<string | null>(null);
  /** Draft multi-select: datasetKey → field keys. Modal stays open until Apply. */
  const [draftPicks, setDraftPicks] = useState<Record<string, string[]>>({});

  useEffect(() => {
    const next = initialSpec ?? seedSpec(dsKey || '_blank');
    setSpec({
      ...next,
      view: 'table',
      description: next.description ?? '',
      visibleColumns: Array.isArray(next.visibleColumns) ? next.visibleColumns : [],
      columnWidths: next.columnWidths ?? {},
      columnAlign: next.columnAlign ?? {},
      pinnedColumns: next.pinnedColumns ?? [],
      sorts: next.sorts ?? [],
      rows: next.rows ?? [],
      measures: Array.isArray(next.measures) ? next.measures : [],
    });
    setDraftRules(next.rules);
    setDraftSearch(next.search);
  }, [dsKey, initialSpec]);

  const patch = (p: Partial<ReportSpec>) => setSpec((s) => ({ ...s, ...p }));

  const refreshLibrary = useCallback(async () => {
    setLibraryLoading(true);
    try {
      const r = await listSpecs();
      setSavedSpecs(r.specs);
      setLibrarySource(r.source);
    } catch {
      setSavedSpecs([]);
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (libraryOpen) void refreshLibrary();
  }, [libraryOpen, refreshLibrary]);

  const filteredLibrary = useMemo(() => {
    const needle = libraryQ.trim().toLowerCase();
    if (!needle) return savedSpecs;
    return savedSpecs.filter((s) => {
      const ds = datasetByKey(s.dataset);
      const hay = `${s.name} ${s.description ?? ''} ${s.dataset} ${ds?.label ?? ''} ${ds?.module ?? ''}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [savedSpecs, libraryQ]);

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
  const dimensions = spec.rows ?? [];
  const summaryMode = isSummaryMode(spec.measures);
  /** Visual row grouping in detail mode only (first dimension). */
  const groupByKey = !summaryMode ? (dimensions[0] ?? null) : null;

  const linkageColDefs = useMemo(() => allLinkageColumns(linkageCatalog), [linkageCatalog]);
  const linkagePresenceCols = useMemo(() => linkagePresenceColumns(linkageCatalog), [linkageCatalog]);
  const allCols = useMemo(
    () => (dataset ? [...dataset.columns, ...linkageColDefs] : []),
    [dataset, linkageColDefs],
  );
  /** Full column catalog for labels / stale filter+summarize fields (not offered as new picks). */
  const lookupCols = useMemo(() => {
    const seen = new Set<string>();
    const out: ColumnDef[] = [];
    for (const c of [...allCols, ...linkagePresenceCols]) {
      if (seen.has(c.key)) continue;
      seen.add(c.key);
      out.push(c);
    }
    return out;
  }, [allCols, linkagePresenceCols]);
  // Filter / Summarize pickers only offer columns the user selected (visible set).
  const selectedCols = useMemo(
    () => visibleKeys
      .map((k) => lookupCols.find((c) => c.key === k))
      .filter((c): c is ColumnDef => !!c),
    [visibleKeys, lookupCols],
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
      ...dimensions,
    ]);
    return Array.from(keys);
  }, [visibleKeys, spec.rules.conditions, draftRules.conditions, spec.measures, dimensions]);

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
  const serverMode = !!dataset?.server;
  // Server SQL already applied search + non-linkage rules; queryKey must refetch on Apply.
  const serverRulesKey = serverMode ? JSON.stringify(spec.rules) : '';
  const serverSearchKey = serverMode ? spec.search : '';

  const hasLinkageFilters = useMemo(
    () => spec.rules.conditions.some((c) => LINKAGE_OPS.has(c.op) && isActiveCondition(c)),
    [spec.rules],
  );

  const measuresKey = JSON.stringify(spec.measures);
  const dimsKey = JSON.stringify(dimensions);

  const serverAggEligible = useMemo(() => {
    if (!serverMode || !summaryMode || !dataset || hasLinkageFilters || forceClientAgg) return false;
    const allow = new Set(
      dataset.columns
        .map((c) => c.key)
        .filter((k) => !k.startsWith('xmod_') && !k.startsWith('link_')),
    );
    return canServerAggregate(dimensions, spec.measures, allow);
  }, [serverMode, summaryMode, dataset, hasLinkageFilters, forceClientAgg, dimensions, spec.measures]);

  useEffect(() => { setForceClientAgg(false); }, [dsKey, measuresKey, dimsKey]);

  const { data: rawRows = [], isLoading, isFetched, error, refetch, isFetching } = useQuery({
    queryKey: ['report', dsKey, includesKey, serverMode, serverRulesKey, serverSearchKey, serverAggEligible],
    queryFn: async () => {
      if (!dataset) return [];
      // When server aggregate handles the whole result, skip shipping detail rows.
      if (serverAggEligible) return [];
      const base = dataset.server
        ? await fetchServerBuildRows(dataset.key, spec.rules, spec.search, spec.sorts ?? [])
        : asRows(await dataset.fetch());
      if (!includes.length) return base;
      return enrichReportRows(dataset.key, base, includes, projectFields);
    },
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    enabled: !!dataset && !serverAggEligible,
  });

  const { data: serverAgg, isLoading: serverAggLoading, error: serverAggError, refetch: refetchAgg } = useQuery({
    queryKey: ['report-agg', dsKey, serverRulesKey, serverSearchKey, measuresKey, dimsKey],
    queryFn: async () => {
      if (!dataset) return null;
      const filters = spec.rules.conditions
        .filter(isActiveCondition)
        .filter((c) => !LINKAGE_OPS.has(c.op))
        .map((c) => ({ col: c.col, op: c.op, value: c.value }));
      try {
        return await aggregateServer({
          dataset: dataset.key,
          search: spec.search.trim() || undefined,
          sorts: (spec.sorts || []).map((s) => ({ key: s.key, dir: s.dir })),
          filters,
          logic: spec.rules.logic,
          group_by: dimensions,
          measures: toServerMeasures(spec.measures),
        });
      } catch {
        setForceClientAgg(true);
        return null;
      }
    },
    staleTime: 30_000,
    enabled: !!dataset && serverAggEligible,
  });

  const rows = asRows(rawRows);
  const showInitialLoad = !!dataset && (
    (serverAggEligible ? serverAggLoading : (isLoading && !isFetched && rows.length === 0))
  );

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

  const openSaveDialog = (mode: 'save' | 'save-as') => {
    if (!dataset) return;
    const defaultName = spec.name.trim() || `${dataset.label} report`;
    setSaveName(mode === 'save-as' && spec.name.trim() ? `${spec.name.trim()} (copy)` : defaultName);
    setSaveDescription(spec.description ?? '');
    setSaveShared(mode === 'save-as' ? false : !!spec.shared);
    setSaveDialog(mode);
  };

  const commitSave = async () => {
    if (!dataset || !saveDialog) return;
    const name = saveName.trim();
    if (!name) return;
    setSaving(true);
    try {
      const isFork = spec.mine === false || saveDialog === 'save-as';
      const s: ReportSpec = {
        ...spec,
        view: 'table',
        visibleColumns: visibleKeys,
        includes,
        dataset: dataset.key,
        id: (spec.id && !isFork) ? spec.id : newSpecId(),
        name,
        description: saveDescription.trim(),
        shared: saveShared,
        mine: true,
        updatedAt: new Date().toISOString(),
      };
      setSpec(s);
      setSavedSource(await persistSpec(s));
      setSavedAt(true);
      setTimeout(() => setSavedAt(false), 2200);
      setSaveDialog(null);
      onSavedChange?.();
      void refreshLibrary();
    } finally {
      setSaving(false);
    }
  };

  /** Quick update when the report already has an id and name (no dialog). */
  const doQuickSave = async () => {
    if (!dataset) return;
    if (!spec.id || !spec.name.trim() || spec.mine === false) {
      openSaveDialog('save');
      return;
    }
    setSaving(true);
    try {
      const s: ReportSpec = {
        ...spec,
        view: 'table',
        visibleColumns: visibleKeys,
        includes,
        dataset: dataset.key,
        mine: true,
        updatedAt: new Date().toISOString(),
      };
      setSpec(s);
      setSavedSource(await persistSpec(s));
      setSavedAt(true);
      setTimeout(() => setSavedAt(false), 2200);
      onSavedChange?.();
      void refreshLibrary();
    } finally {
      setSaving(false);
    }
  };

  const loadFromLibrary = (s: ReportSpec) => {
    setLibraryOpen(false);
    setLibraryQ('');
    if (onLoadSpec) {
      onLoadSpec(s);
      return;
    }
    // Fallback when parent doesn't wire load — apply in-place if same dataset.
    setSpec({
      ...s,
      view: 'table',
      description: s.description ?? '',
      visibleColumns: Array.isArray(s.visibleColumns) ? s.visibleColumns : [],
      columnWidths: s.columnWidths ?? {},
      columnAlign: s.columnAlign ?? {},
      pinnedColumns: s.pinnedColumns ?? [],
      sorts: s.sorts ?? [],
      rows: s.rows ?? [],
      measures: Array.isArray(s.measures) ? s.measures : [],
    });
    setDraftRules(s.rules);
    setDraftSearch(s.search);
    if (s.dataset && s.dataset !== dataset?.key) {
      onDatasetChange?.(s.dataset, s.visibleColumns);
    }
  };

  const deleteFromLibrary = async (id: string) => {
    setLibraryBusyId(id);
    try {
      await removeSpec(id);
      await refreshLibrary();
      onSavedChange?.();
    } finally {
      setLibraryBusyId(null);
    }
  };

  const duplicateFromLibrary = async (s: ReportSpec) => {
    setLibraryBusyId(s.id);
    try {
      await duplicateSpec(s);
      await refreshLibrary();
      onSavedChange?.();
    } finally {
      setLibraryBusyId(null);
    }
  };

  const filteredRows = useMemo(() => {
    // Server mode already applied search + non-linkage filters in SQL; only
    // re-evaluate linkage presence ops client-side after enrich. Client mode
    // applies the full rule set locally.
    const linkageOnly: FilterRules = {
      logic: spec.rules.logic,
      conditions: spec.rules.conditions.filter((c) => LINKAGE_OPS.has(c.op)),
    };
    const matched = rows.filter((r) => {
      if (serverMode) {
        return rowMatchesRules(cols, r, linkageOnly);
      }
      return rowMatchesSearch(cols, r, spec.search) && rowMatchesRules(cols, r, spec.rules);
    });
    if (!spec.sorts?.length) return matched;
    return [...matched].sort((a, b) => compareRows(cols, a, b, spec.sorts as SortSpec[]));
  }, [rows, cols, spec.search, spec.rules, spec.sorts, serverMode]);

  const clientAggregate = useMemo(() => {
    if (!summaryMode || serverAggEligible) return null;
    return aggregateRows(cols, filteredRows, dimensions, spec.measures);
  }, [summaryMode, serverAggEligible, cols, filteredRows, dimensions, spec.measures]);

  const summaryTable = useMemo(() => {
    if (!summaryMode) return null;
    if (serverAggEligible && serverAgg) {
      const aggCols: typeof cols = (serverAgg.columns || []).map((c) => ({
        key: c.key,
        label: c.label,
        type: (c.type === 'number' ? 'number' : c.type === 'badge' ? 'badge' : c.type === 'date' ? 'date' : 'text') as ColType,
        align: c.type === 'number' ? 'right' as const : undefined,
        width: c.type === 'number' ? 120 : 160,
        format: c.key.endsWith('_pct')
          ? (v: unknown) => (v == null || v === '' ? '' : `${Number(v).toFixed(1)}%`)
          : undefined,
      }));
      return {
        cols: aggCols,
        rows: asRows(serverAgg.rows),
        visibleKeys: aggCols.map((c) => c.key),
        sourceCount: serverAgg.total,
      };
    }
    if (clientAggregate) {
      return {
        cols: clientAggregate.cols,
        rows: clientAggregate.rows,
        visibleKeys: clientAggregate.cols.map((c) => c.key),
        sourceCount: clientAggregate.sourceCount,
      };
    }
    return null;
  }, [summaryMode, serverAggEligible, serverAgg, clientAggregate]);

  const displayCols = summaryTable?.cols ?? cols;
  const displayRows = summaryTable?.rows ?? filteredRows;
  const displayVisibleKeys = summaryTable?.visibleKeys ?? visibleKeys;

  const ruleCount = spec.rules.conditions.filter(isActiveCondition).length;
  const activeConditions = spec.rules.conditions.filter(isActiveCondition);

  // ── KPI stat cards — computed after filteredRows is available ────────────
  const kpiStats = useMemo(() => {
    if (!dataset) return null;
    if (summaryMode && summaryTable) {
      const stats: { label: string; value: string | number; tone?: 'red' | 'amber' | 'green' | 'slate' }[] = [
        { label: 'Summary groups', value: summaryTable.rows.length.toLocaleString(), tone: 'slate' },
      ];
      if (!serverAggEligible) {
        stats.unshift({
          label: 'Source rows',
          value: summaryTable.sourceCount.toLocaleString(),
          tone: 'slate',
        });
      }
      // Surface first measure grand total from client aggregate when available.
      if (clientAggregate && spec.measures[0]) {
        const mk = measureColKey(spec.measures[0]);
        const g = clientAggregate.grand[mk];
        if (g != null) {
          stats.push({
            label: clientAggregate.cols.find((c) => c.key === mk)?.label ?? 'Total',
            value: typeof g === 'number' ? (Number.isInteger(g) ? g.toLocaleString() : g.toFixed(1)) : String(g),
            tone: 'green',
          });
        }
      }
      return stats.slice(0, 4);
    }
    if (rows.length === 0) return null;
    const total = rows.length;
    const filtered = filteredRows.length;
    const stats: { label: string; value: string | number; tone?: 'red' | 'amber' | 'green' | 'slate' }[] = [
      { label: 'Total rows', value: total.toLocaleString(), tone: 'slate' },
      { label: 'Matching filters', value: filtered.toLocaleString(), tone: filtered < total ? 'amber' : 'slate' },
    ];

    if (dataset.key === 'risks') {
      const high = rows.filter((r) => Number(r.residual_score) >= 15).length;
      const open = rows.filter((r) => String(r.closure_status ?? '').toLowerCase() === 'open').length;
      if (high > 0) stats.push({ label: 'High residual (≥15)', value: high, tone: 'red' });
      if (open > 0) stats.push({ label: 'Open risks', value: open, tone: 'amber' });
    } else if (dataset.key === 'controls' || dataset.key === 'internal_controls') {
      const noOwner = rows.filter((r) => !r.control_owner && !r.owner_name).length;
      if (noOwner > 0) stats.push({ label: 'No owner', value: noOwner, tone: 'red' });
    } else if (dataset.key === 'evidence') {
      const stale = rows.filter((r) => String(r.is_stale ?? '').toLowerCase() === 'yes' || r.is_stale === true).length;
      const unlinked = rows.filter((r) => Number(r.control_mappings_count ?? 0) === 0).length;
      if (stale > 0) stats.push({ label: 'Stale', value: stale, tone: 'red' });
      if (unlinked > 0) stats.push({ label: 'Unlinked', value: unlinked, tone: 'amber' });
    } else if (dataset.key === 'issues') {
      const sla = rows.filter((r) => String(r.sla_breached ?? '').toLowerCase() === 'yes' || r.sla_breached === true).length;
      const unassigned = rows.filter((r) => !r.assignee && !r.assignee_name).length;
      if (sla > 0) stats.push({ label: 'SLA breached', value: sla, tone: 'red' });
      if (unassigned > 0) stats.push({ label: 'Unassigned', value: unassigned, tone: 'amber' });
    } else if (dataset.key === 'tasks') {
      const overdue = rows.filter((r) => r.due_date && new Date(String(r.due_date)) < new Date() && String(r.status ?? '').toLowerCase() !== 'done').length;
      if (overdue > 0) stats.push({ label: 'Overdue', value: overdue, tone: 'red' });
    } else if (dataset.key === 'vulnerabilities') {
      const kev = rows.filter((r) => String(r.kev_flag ?? '').toLowerCase() === 'yes' || r.kev_flag === true).length;
      const crit = rows.filter((r) => /(crit|high)/i.test(String(r.severity ?? ''))).length;
      if (kev > 0) stats.push({ label: 'KEV flagged', value: kev, tone: 'red' });
      if (crit > 0) stats.push({ label: 'Critical/High', value: crit, tone: 'red' });
    } else if (dataset.key === 'vendors') {
      const highRisk = rows.filter((r) => /(crit|high)/i.test(String(r.tier ?? r.risk_rating ?? ''))).length;
      if (highRisk > 0) stats.push({ label: 'High-risk', value: highRisk, tone: 'red' });
    } else if (dataset.key === 'regulatory_changes') {
      const unaddressed = rows.filter((r) => Number(r.task_count ?? 0) === 0 && Number(r.gap_count ?? 0) === 0).length;
      if (unaddressed > 0) stats.push({ label: 'Unaddressed', value: unaddressed, tone: 'amber' });
    } else if (dataset.key === 'exceptions') {
      const expiring = rows.filter((r) => {
        if (!r.expires_at) return false;
        const exp = new Date(String(r.expires_at));
        const in30 = new Date(); in30.setDate(in30.getDate() + 30);
        return exp <= in30 && exp >= new Date();
      }).length;
      if (expiring > 0) stats.push({ label: 'Expiring soon', value: expiring, tone: 'amber' });
    }

    return stats.slice(0, 4);
  }, [dataset, rows, filteredRows, summaryMode, summaryTable, serverAggEligible, clientAggregate, spec.measures]);

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

  const factLines = () => [
    { label: 'Dataset', value: dataset ? `${dataset.module} · ${dataset.label}` : '—' },
    { label: 'Generated', value: new Date().toLocaleString() },
    {
      label: 'Rows',
      value: summaryMode
        ? `${displayRows.length.toLocaleString()} summary group${displayRows.length === 1 ? '' : 's'}`
        : `${filteredRows.length.toLocaleString()}${filteredRows.length !== rows.length ? ` of ${rows.length.toLocaleString()}` : ''}`,
    },
    {
      label: 'Columns',
      value: summaryMode
        ? displayVisibleKeys.map((k) => displayCols.find((c) => c.key === k)?.label ?? k).join(', ') || '(none)'
        : visibleKeys.map(labelFor).join(', ') || '(none — empty report)',
    },
    ...(summaryMode
      ? [{
          label: 'Summary',
          value: [
            dimensions.length ? `grouped by ${dimensions.map(labelFor).join(' › ')}` : 'overall total',
            spec.measures.map((m) => measureLabel(m, m.key ? labelFor(m.key) : '')).join(', '),
          ].filter(Boolean).join(' · '),
        }]
      : []),
    { label: 'Filters', value: describeRules(cols, spec.rules) },
    ...(includes.length
      ? [{ label: 'Cross-module links', value: includes.map((k) => linkageCatalog.find((l) => l.key === k)?.label ?? k).join(', ') }]
      : []),
    ...(spec.search.trim() ? [{ label: 'Search', value: `“${spec.search.trim()}”` }] : []),
  ];
  const exportCols = (summaryMode ? displayVisibleKeys : visibleKeys)
    .map((k) => displayCols.find((c) => c.key === k))
    .filter(Boolean) as typeof cols;

  const doExport = async (kind: 'pdf' | 'excel' | 'csv' | 'word') => {
    if (!dataset) return;
    setMenu(false);
    const name = spec.name.trim() || dataset.label;
    const exportRows = displayRows;
    if (kind === 'pdf') {
      stashPrintSpec({
        ...spec,
        name,
        visibleColumns: summaryMode ? displayVisibleKeys : visibleKeys,
        includes,
        view: 'table',
        dataset: dataset.key,
      });
      window.open('/reports/print', '_blank', 'noopener');
      return;
    }
    if (kind === 'csv') {
      exportCSV(name, exportCols, exportRows);
      return;
    }
    if (kind === 'excel') {
      exportExcelMulti(name, [
        { name: 'Report', cols: exportCols, rows: exportRows },
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
        exportRows,
      );
    } finally {
      setExporting(false);
    }
  };

  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && sessionStorage.getItem('grc.reports.openColumns') === '1') {
        sessionStorage.removeItem('grc.reports.openColumns');
        if (dataset) setPanel('columns');
      }
    } catch { /* ignore */ }
  }, [dataset]);

  const loadError = error || serverAggError;
  const busyFetching = serverAggEligible ? serverAggLoading : isFetching;
  const doRefetch = () => { if (serverAggEligible) void refetchAgg(); else void refetch(); };
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
  if (loadError && (serverAggEligible ? !serverAgg : rows.length === 0)) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-rose-700">
        <AlertCircle className="h-6 w-6" />
        <p className="text-sm">Could not load {dataset?.label || 'data'}.</p>
        <button
          type="button"
          onClick={doRefetch}
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
          {spec.description ? (
            <p className="mt-0.5 max-w-xl truncate text-[11px] text-slate-500">{spec.description}</p>
          ) : null}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
            <span className="font-medium text-slate-600">
              {dataset ? `${dataset.module} · ${dataset.label}` : 'No module selected'}
            </span>
            <span>·</span>
            <span>{summaryMode ? `${displayRows.length.toLocaleString()} groups` : `${visibleKeys.length} columns`}</span>
            <span>·</span>
            <span>
              {summaryMode
                ? (serverAggEligible ? 'Server aggregate' : `${filteredRows.length.toLocaleString()} source rows`)
                : `${filteredRows.length.toLocaleString()}${filteredRows.length !== rows.length ? ` of ${rows.length.toLocaleString()}` : ''} rows`}
            </span>
            {busyFetching && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1 text-slate-400">
                  <Loader2 className="h-3 w-3 animate-spin" /> {serverAggEligible ? 'Aggregating…' : 'Enriching…'}
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
            onClick={() => openSaveDialog('save-as')}
            disabled={!dataset}
            title="Save as a new custom report"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
          >
            <Copy className="h-3.5 w-3.5" /> Save as
          </button>
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
            onClick={doQuickSave}
            disabled={!dataset || saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] shadow-sm hover:bg-primary-600 disabled:opacity-40"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : savedAt ? (
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

        <div className="relative">
          <ToolbarBtn
            active={libraryOpen}
            onClick={() => { setPanel(null); setLibraryOpen((o) => !o); }}
            icon={<Bookmark className="h-3.5 w-3.5" />}
          >
            My reports
            <ChevronDown className={`h-3 w-3 text-slate-400 transition-transform ${libraryOpen ? 'rotate-180' : ''}`} />
          </ToolbarBtn>
          {libraryOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setLibraryOpen(false)} />
              <div className="absolute left-0 top-full z-40 mt-1 flex max-h-[min(70vh,420px)] w-96 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
                <div className="border-b border-slate-100 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Custom reports</p>
                      <p className="mt-0.5 text-[11px] text-slate-500">
                        Load a report you saved — filters, columns, and sort included.
                      </p>
                    </div>
                    <Link
                      href="/reports/saved"
                      className="shrink-0 text-[11px] font-semibold text-primary-700 hover:underline"
                      onClick={() => setLibraryOpen(false)}
                    >
                      Manage
                    </Link>
                  </div>
                  <div className="relative mt-2">
                    <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-slate-400" />
                    <input
                      value={libraryQ}
                      onChange={(e) => setLibraryQ(e.target.value)}
                      placeholder="Search your reports…"
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-2 text-xs focus:border-primary-500 focus:bg-white focus:outline-none"
                    />
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                  {libraryLoading ? (
                    <div className="flex items-center justify-center gap-2 px-3 py-8 text-xs text-slate-400">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                    </div>
                  ) : filteredLibrary.length === 0 ? (
                    <div className="px-3 py-8 text-center">
                      <FolderOpen className="mx-auto h-7 w-7 text-slate-300" />
                      <p className="mt-2 text-sm font-medium text-slate-700">
                        {savedSpecs.length === 0 ? 'No custom reports yet' : 'No matches'}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Customize filters and columns, then click Save report.
                      </p>
                    </div>
                  ) : (
                    <ul>
                      {filteredLibrary.map((s) => {
                        const ds = datasetByKey(s.dataset);
                        const busy = libraryBusyId === s.id;
                        const active = s.id && s.id === spec.id;
                        return (
                          <li key={s.id} className="group mb-0.5">
                            <div
                              className={`flex items-start gap-1 rounded-xl px-2 py-2 ${
                                active ? 'bg-primary-50' : 'hover:bg-slate-50'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => loadFromLibrary(s)}
                                className="min-w-0 flex-1 text-left focus:outline-none"
                              >
                                <p className="truncate text-sm font-medium text-slate-800">
                                  {s.name || 'Untitled report'}
                                  {s.shared && <Users className="ml-1 inline h-3 w-3 text-slate-400" />}
                                </p>
                                <p className="mt-0.5 truncate text-[11px] text-slate-500">
                                  {ds?.label ?? s.dataset}
                                  {s.description ? ` · ${s.description}` : ''}
                                </p>
                              </button>
                              <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
                                {busy ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
                                ) : (
                                  <>
                                    <button
                                      type="button"
                                      title="Duplicate"
                                      onClick={() => duplicateFromLibrary(s)}
                                      className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700"
                                    >
                                      <Copy className="h-3.5 w-3.5" />
                                    </button>
                                    {s.mine !== false && (
                                      <button
                                        type="button"
                                        title="Delete"
                                        onClick={() => deleteFromLibrary(s.id)}
                                        className="rounded p-1 text-slate-400 hover:bg-white hover:text-rose-600"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                {librarySource === 'local' && savedSpecs.length > 0 && (
                  <p className="border-t border-slate-100 px-3 py-1.5 text-[10px] text-amber-600">
                    Stored on this device only — server unreachable.
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        <ToolbarBtn
          active={panel === 'columns' || panel === 'add-data' || visibleKeys.length > 0}
          onClick={() => (dataset ? setPanel((p) => (p === 'columns' ? null : 'columns')) : openAddData())}
          icon={<Columns3 className="h-3.5 w-3.5" />}
        >
          {visibleKeys.length || 0} columns
        </ToolbarBtn>

        <ToolbarBtn
          active={panel === 'summarize' || summaryMode}
          onClick={() => dataset && setPanel((p) => (p === 'summarize' ? null : 'summarize'))}
          icon={<Sigma className="h-3.5 w-3.5" />}
        >
          {summaryMode
            ? `Summarize · ${spec.measures.length}`
            : 'Summarize'}
        </ToolbarBtn>

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
            {(summaryMode ? displayVisibleKeys : visibleKeys).map((k) => (
              <optgroup key={k} label={summaryMode ? (displayCols.find((c) => c.key === k)?.label ?? k) : labelFor(k)}>
                <option value={`${k}:asc`}>{(summaryMode ? displayCols.find((c) => c.key === k)?.label : labelFor(k)) ?? k} ↑</option>
                <option value={`${k}:desc`}>{(summaryMode ? displayCols.find((c) => c.key === k)?.label : labelFor(k)) ?? k} ↓</option>
              </optgroup>
            ))}
          </select>
        </div>

        {!summaryMode && (
          <ToolbarBtn
            active={showTotals}
            onClick={() => setShowTotals((t) => !t)}
            icon={<Sigma className="h-3.5 w-3.5" />}
          >
            Totals {showTotals ? 'on' : 'off'}
          </ToolbarBtn>
        )}

        <span className="ml-auto text-[11px] tabular-nums text-slate-400">
          {summaryMode
            ? `${displayRows.length.toLocaleString()} group${displayRows.length === 1 ? '' : 's'}`
            : `${filteredRows.length.toLocaleString()}${filteredRows.length !== rows.length ? ` of ${rows.length.toLocaleString()}` : ''} rows`}
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
        {summaryMode && (
          <span className="inline-flex items-center gap-1 rounded-full border border-primary-200 bg-primary-50 px-2 py-0.5 text-[11px] font-medium text-primary-800">
            Summary
            {dimensions.length > 0 ? ` by ${dimensions.map(labelFor).join(' › ')}` : ' · overall total'}
            {' · '}
            {spec.measures.map((m) => measureLabel(m, m.key ? labelFor(m.key) : '')).join(', ')}
            <button
              type="button"
              onClick={() => patch({ rows: [], measures: [] })}
              className="rounded-full p-0.5 text-primary-600 hover:bg-primary-100 hover:text-rose-600"
              aria-label="Clear summary"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        )}
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
              <div className="min-w-0 pr-2">
                <p className="text-sm font-semibold text-slate-800">Filter results</p>
                <p className="mt-0.5 text-[10px] leading-snug text-slate-500">
                  Show only the rows that match your rules. These run before any summary totals.
                </p>
              </div>
              <button type="button" onClick={() => setPanel(null)} className="shrink-0 rounded p-1 text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            {!dataset ? (
              <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs text-slate-500">
                Select a dataset first to enable filters.
              </p>
            ) : (
              <>
                {serverMode && (
                  <p className="mb-2 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-[10px] leading-snug text-sky-800">
                    Click Apply filters to update results. Rules about linked records are checked after related data is loaded.
                  </p>
                )}
                <input
                  value={draftSearch}
                  onChange={(e) => setDraftSearch(e.target.value)}
                  placeholder={serverMode ? 'Search dataset…' : 'Search columns…'}
                  className="mb-2 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs focus:border-primary-500 focus:outline-none"
                />
                <FilterBuilder
                  staged
                  dirty={filtersDirty}
                  cols={selectedCols}
                  lookupCols={lookupCols}
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

      {panel === 'summarize' && dataset && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setPanel(null)} />
          <SummarizePanel
            cols={selectedCols}
            lookupCols={lookupCols}
            dimensions={dimensions}
            measures={spec.measures}
            onDimensionsChange={(keys) => patch({ rows: keys })}
            onMeasuresChange={(measures) => patch({ measures })}
            onClose={() => setPanel(null)}
            onClear={() => patch({ rows: [], measures: [] })}
          />
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

      {kpiStats && kpiStats.length > 0 && (summaryMode || visibleKeys.length > 0) && (
        <div className="flex shrink-0 flex-wrap gap-2 border-b border-slate-100 px-4 py-2.5">
          {kpiStats.map((stat) => (
            <div
              key={stat.label}
              className={`flex min-w-[90px] flex-col items-start rounded-xl border px-3 py-2 ${
                stat.tone === 'red'
                  ? 'border-rose-200 bg-rose-50'
                  : stat.tone === 'amber'
                    ? 'border-amber-200 bg-amber-50'
                    : stat.tone === 'green'
                      ? 'border-emerald-200 bg-emerald-50'
                      : 'border-slate-200 bg-slate-50'
              }`}
            >
              <span className={`text-xl font-bold tabular-nums leading-none ${
                stat.tone === 'red' ? 'text-rose-700' :
                stat.tone === 'amber' ? 'text-amber-700' :
                stat.tone === 'green' ? 'text-emerald-700' : 'text-slate-700'
              }`}>
                {stat.value}
              </span>
              <span className="mt-1 text-[10px] font-medium leading-tight text-slate-500">{stat.label}</span>
            </div>
          ))}
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col p-3 pt-2">
        {summaryMode && !summaryTable && (serverAggLoading || isLoading || isFetching) ? (
          <div className="flex flex-1 items-center justify-center text-slate-400">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : summaryMode && summaryTable ? (
          <ReportDataTable
            cols={displayCols}
            rows={displayRows}
            visibleKeys={displayVisibleKeys}
            widths={spec.columnWidths ?? {}}
            align={spec.columnAlign ?? {}}
            pinned={[]}
            sorts={spec.sorts ?? []}
            labelFor={(k) => displayCols.find((c) => c.key === k)?.label ?? k}
            onWidthsChange={(w) => patch({ columnWidths: w })}
            onSort={toggleSort}
            groupByKey={null}
            showTotals={false}
            totalInDataset={summaryTable.sourceCount}
          />
        ) : summaryMode && !summaryTable ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-6 text-center">
            <Sigma className="h-9 w-9 text-slate-300" />
            <h2 className="mt-3 text-base font-semibold text-slate-800">No summary yet</h2>
            <p className="mt-1 max-w-md text-sm text-slate-500">
              Check each calculation: Add up and Average need a numeric column, and Count unique / Lowest / Highest need a column selected.
            </p>
            <button
              type="button"
              onClick={() => setPanel('summarize')}
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
            >
              <Sigma className="h-3.5 w-3.5" />
              Edit summary
            </button>
          </div>
        ) : visibleKeys.length === 0 ? (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-6 text-center">
            <Columns3 className="h-9 w-9 text-slate-300" />
            <h2 className="mt-3 text-base font-semibold text-slate-800">Empty report</h2>
            <p className="mt-1 max-w-md text-sm text-slate-500">
              Add columns for a detail table, or open Summarize to turn the list into counts, averages, and other totals.
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={openAddData}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
              >
                <Plus className="h-3.5 w-3.5" />
                Add data
                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
              </button>
              {dataset && (
                <button
                  type="button"
                  onClick={() => setPanel('summarize')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  <Sigma className="h-3.5 w-3.5" />
                  Summarize
                </button>
              )}
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

      {saveDialog && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => !saving && setSaveDialog(null)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-sm font-semibold text-slate-900">
              {saveDialog === 'save-as' ? 'Save as new custom report' : 'Save custom report'}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Stores your dataset, columns, filters, sort, and summary settings so you can reopen it anytime.
            </p>
            <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Name
            </label>
            <input
              autoFocus
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitSave();
                if (e.key === 'Escape' && !saving) setSaveDialog(null);
              }}
              placeholder="e.g. Evidences not linked to risks or controls"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
            />
            <label className="mt-3 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Description <span className="font-normal normal-case text-slate-400">(optional)</span>
            </label>
            <textarea
              value={saveDescription}
              onChange={(e) => setSaveDescription(e.target.value)}
              rows={2}
              placeholder="What does this report show?"
              className="mt-1 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
            />
            <label className="mt-3 flex items-center gap-2 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={saveShared}
                onChange={(e) => setSaveShared(e.target.checked)}
                className="rounded border-slate-300"
              />
              Share with everyone in this tenant
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setSaveDialog(null)}
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving || !saveName.trim()}
                onClick={() => void commitSave()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-600 disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save
              </button>
            </div>
          </div>
        </div>
      )}
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
