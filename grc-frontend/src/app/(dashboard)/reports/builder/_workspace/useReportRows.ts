'use client';

// The data side of the workspace: which columns the report has (this module's, the linked modules', the calculated ones), which links must be enriched, the rows (the module's own list API or the server's
// query in pages of 500 up to 5,000, then the cross-module enrich), what the browser still owes after the server has filtered, the summary (server aggregate, else worked out here) and the key figures.
// It is the old builder's data code moved out of the component, with the same query keys and the same rules; what is new is that everything a person must be told comes OUT of it: how much of the register
// the rows are (`partial`), which filters the server could not apply, and that a server summary fell back to the browser. The words are notices.ts; the numbers are rowCoverage.ts.
import { useEffect, useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ColType, ColumnDef, FilterRules, ReportDataset, ReportSpec, Row, ServerAggregatePage, SkippedFilter, SortSpec } from '../../_reports/types';
import { asRows, compareRows, isActiveCondition, rowMatchesRules, rowMatchesSearch } from '../../_reports/grid-utils';
import { aggregateRows, canServerAggregate, isSummaryMode, measureColKey } from '../../_reports/aggregate-utils';
import { allLinkageColumns, enrichReportRows, fetchLinkageCatalog, linkageKeysForFields, linkagePresenceColumns, presenceTarget } from '../../_reports/linkages';
import { buildCalcColumns, type CalcColumnDef } from '../../_reports/calcColumns';
import { isClientSideFilter, isCountColumn } from '../../_reports/filter-utils';
import { aggregateServer, toServerMeasures } from '../../_reports/serverApi';
import { LINKAGE_OPS, fetchServerBuildRows, partitionServerFilters } from '../../_reports/reportData';
import { coverage, type Coverage } from '../../_reports/rowCoverage';
import { keyFacts, type Fact } from './builderModel';
import { AGGREGATE_FALLBACK, skippedFilterLines, summaryWarningLines } from './notices';

export interface SummaryTable { cols: ColumnDef[]; rows: Row[]; visibleKeys: string[]; sourceCount: number }

export function useReportRows({ dataset, datasets, spec, draftRules }: { dataset: ReportDataset | null; datasets: ReportDataset[]; spec: ReportSpec; draftRules: FilterRules }) {
  const dsKey = dataset?.key ?? '';

  // ── the link catalog ──
  const { data: linkageResult } = useQuery({
    queryKey: ['report-linkages', dsKey, datasets.map((d) => d.key).join(',')],
    queryFn: () => fetchLinkageCatalog(dsKey, datasets.length ? datasets : (dataset ? [dataset] : [])),
    staleTime: 60_000,
    enabled: !!dataset,
  });
  const linkageCatalog = linkageResult?.defs ?? [];
  const linkageDegraded = linkageResult?.degraded ?? false;

  const visibleKeys = useMemo(() => spec.visibleColumns ?? [], [spec.visibleColumns]);
  const dimensions = spec.rows ?? [];
  const summaryMode = isSummaryMode(spec.measures);
  /** Visual row grouping in detail mode only (first dimension). */
  const groupByKey = !summaryMode ? (dimensions[0] ?? null) : null;

  // ── the columns ──
  const linkageColDefs = useMemo(() => allLinkageColumns(linkageCatalog), [linkageCatalog]);
  const linkagePresenceCols = useMemo(() => linkagePresenceColumns(linkageCatalog), [linkageCatalog]);
  /** Source fields a calculated column may reference. Deliberately excludes other calculated columns: no cycles, no evaluation order. */
  const sourceCols = useMemo(() => (dataset ? [...dataset.columns, ...linkageColDefs] : []), [dataset, linkageColDefs]);
  const calcDefs = useMemo(() => (spec.calcColumns ?? []) as CalcColumnDef[], [spec.calcColumns]);
  const calcCols = useMemo(() => buildCalcColumns(calcDefs, (k) => sourceCols.find((c) => c.key === k)), [calcDefs, sourceCols]);
  const allCols = useMemo(() => (dataset ? [...sourceCols, ...calcCols] : []), [dataset, sourceCols, calcCols]);
  /** Full catalog for labels / stale filter and summary fields (not offered as new picks). */
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
  /** Filterable set = every real column plus the "(not) linked to any X" checks, so orphan hunting is reachable without first adding a column. */
  const filterCols = useMemo(() => [...allCols, ...linkagePresenceCols], [allCols, linkagePresenceCols]);
  /** Summarize pickers only offer columns the person selected. */
  const selectedCols = useMemo(() => visibleKeys.map((k) => lookupCols.find((c) => c.key === k)).filter((c): c is ColumnDef => !!c), [visibleKeys, lookupCols]);
  const labelFor = (key: string) => allCols.find((c) => c.key === key)?.label ?? lookupCols.find((c) => c.key === key)?.label ?? key;

  // ── which links to enrich ──
  const appliedFieldKeys = useMemo(() => Array.from(new Set<string>([
    ...visibleKeys,
    ...spec.rules.conditions.map((c) => c.col),
    ...draftRules.conditions.map((c) => c.col),
    ...spec.measures.map((m) => m.key).filter(Boolean),
    ...dimensions,
    // a calculation reads its operands, which may live in another module: they must be enriched even though the operand is not a visible column
    ...calcDefs.flatMap((d) => [d.a, d.b].filter((k): k is string => !!k)),
  ])), [visibleKeys, spec.rules.conditions, draftRules.conditions, spec.measures, dimensions, calcDefs]);

  const includes = useMemo(() => {
    const base = linkageKeysForFields(appliedFieldKeys, linkageCatalog);
    const presence = appliedFieldKeys.map(presenceTarget).filter((t): t is string => !!t);   // a "(not) linked to any X" filter must enrich X so its count is present
    return Array.from(new Set([...base, ...presence]));
  }, [appliedFieldKeys, linkageCatalog]);
  const projectFields = useMemo(() => appliedFieldKeys.filter((k) => k.startsWith('xmod_')), [appliedFieldKeys]);
  const includesKey = includes.join(',');

  // ── how the rows are read ──
  const serverMode = !!dataset?.server;
  const serverRulesKey = serverMode ? JSON.stringify(spec.rules) : '';
  const serverSearchKey = serverMode ? spec.search : '';
  const hasLinkageFilters = useMemo(() => spec.rules.conditions.some((c) => LINKAGE_OPS.has(c.op) && isActiveCondition(c)), [spec.rules]);
  const hasClientSideFilters = useMemo(
    () => spec.rules.conditions.some((c) => isActiveCondition(c) && isClientSideFilter(c.col, c.op, (k) => lookupCols.find((x) => x.key === k))),
    [spec.rules, lookupCols],
  );
  /** Count filters force the module list API (the SQL serialisation has no link counts). */
  const needsListCounts = useMemo(() => spec.rules.conditions.some((c) => isActiveCondition(c) && isCountColumn(lookupCols.find((x) => x.key === c.col))), [spec.rules, lookupCols]);
  const measuresKey = JSON.stringify(spec.measures);
  const dimsKey = JSON.stringify(dimensions);

  /** If the server /aggregate cannot take the measures, the summary is worked out here from the rows (and the person is told). */
  const [forceClientAgg, setForceClientAgg] = useState(false);
  useEffect(() => { setForceClientAgg(false); }, [dsKey, measuresKey, dimsKey]);

  const serverAggEligible = useMemo(() => {
    if (!serverMode || !summaryMode || !dataset || hasLinkageFilters || hasClientSideFilters || forceClientAgg) return false;
    const allow = new Set(dataset.columns.map((c) => c.key).filter((k) => !k.startsWith('xmod_') && !k.startsWith('link_')));
    return canServerAggregate(dimensions, spec.measures, allow);
  }, [serverMode, summaryMode, dataset, hasLinkageFilters, hasClientSideFilters, forceClientAgg, dimensions, spec.measures]);

  const loaded = useQuery({
    queryKey: ['report', dsKey, includesKey, serverMode, serverRulesKey, serverSearchKey, serverAggEligible, needsListCounts],
    queryFn: async (): Promise<{ rows: Row[]; total: number; skipped: SkippedFilter[]; fromServer: boolean }> => {
      if (!dataset || serverAggEligible) return { rows: [], total: 0, skipped: [], fromServer: false };      // a server aggregate needs no detail rows
      const resolve = (k: string) => lookupCols.find((c) => c.key === k);
      let base: Row[];
      let total: number;
      let skipped: SkippedFilter[] = [];
      let fromServer = false;
      if (dataset.server && !needsListCounts) {
        const page = await fetchServerBuildRows(dataset.key, spec.rules, spec.search, spec.sorts ?? [], resolve);
        base = page.rows;
        total = page.total;
        skipped = page.skipped;
        fromServer = true;
      } else {
        base = asRows(await dataset.fetch());
        total = base.length;
      }
      const rows = includes.length ? await enrichReportRows(dataset.key, base, includes, projectFields) : base;
      return { rows, total, skipped, fromServer };
    },
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    enabled: !!dataset && !serverAggEligible,
  });

  const agg = useQuery({
    queryKey: ['report-agg', dsKey, serverRulesKey, serverSearchKey, measuresKey, dimsKey],
    queryFn: async (): Promise<ServerAggregatePage | null> => {
      if (!dataset) return null;
      const resolve = (k: string) => lookupCols.find((c) => c.key === k);
      const { serverFilters } = partitionServerFilters(spec.rules, resolve);
      try {
        return await aggregateServer({
          dataset: dataset.key,
          search: spec.search.trim() || undefined,
          sorts: (spec.sorts || []).map((s) => ({ key: s.key, dir: s.dir })),
          filters: serverFilters,
          logic: spec.rules.logic,
          group_by: dimensions,
          measures: toServerMeasures(spec.measures),
        });
      } catch {
        setForceClientAgg(true);                                          // the summary is then calculated from the rows, and the person is told
        return null;
      }
    },
    staleTime: 30_000,
    enabled: !!dataset && serverAggEligible,
  });
  const serverAgg = agg.data;

  const rows = useMemo(() => asRows(loaded.data?.rows ?? []), [loaded.data]);
  const showInitialLoad = !!dataset && (serverAggEligible ? agg.isLoading : (loaded.isLoading && !loaded.isFetched && rows.length === 0));

  /** Fields that evaluate off a row: the module's, the enriched links, the presence checks, the calculations. */
  const cols = useMemo(() => {
    if (!dataset) return [];
    const inc = new Set(includes);
    return [
      ...dataset.columns,
      ...linkageColDefs.filter((c) => c.linkageKey && inc.has(c.linkageKey)),
      ...linkagePresenceCols.filter((c) => c.linkageKey && inc.has(c.linkageKey)),
      ...calcCols,
    ];
  }, [dataset, linkageColDefs, linkagePresenceCols, includes, calcCols]);

  // ── what the browser still owes after the server has filtered ──
  const filteredRows = useMemo(() => {
    const resolve = (k: string) => cols.find((x) => x.key === k) || lookupCols.find((x) => x.key === k);
    const { clientRules, allClient } = partitionServerFilters(spec.rules, resolve);
    const matched = rows.filter((r) => {
      if (serverMode && !needsListCounts) return rowMatchesRules(cols, r, allClient ? spec.rules : clientRules);
      return rowMatchesSearch(cols, r, spec.search) && rowMatchesRules(cols, r, spec.rules);
    });
    if (!spec.sorts?.length) return matched;
    return [...matched].sort((a, b) => compareRows(cols, a, b, spec.sorts as SortSpec[]));
  }, [rows, cols, lookupCols, spec.search, spec.rules, spec.sorts, serverMode, needsListCounts]);

  // ── the summary ──
  const clientAggregate = useMemo(() => (!summaryMode || serverAggEligible ? null : aggregateRows(cols, filteredRows, dimensions, spec.measures)), [summaryMode, serverAggEligible, cols, filteredRows, dimensions, spec.measures]);
  const summaryTable = useMemo<SummaryTable | null>(() => {
    if (!summaryMode) return null;
    if (serverAggEligible && serverAgg) {
      const aggCols: ColumnDef[] = (serverAgg.columns || []).map((c) => ({
        key: c.key,
        label: c.label,
        type: (c.type === 'number' ? 'number' : c.type === 'badge' ? 'badge' : c.type === 'date' ? 'date' : 'text') as ColType,
        align: c.type === 'number' ? 'right' as const : undefined,
        width: c.type === 'number' ? 120 : 160,
        format: c.key.endsWith('_pct') ? (v: unknown) => (v == null || v === '' ? '' : `${Number(v).toFixed(1)}%`) : undefined,
      }));
      return { cols: aggCols, rows: asRows(serverAgg.rows), visibleKeys: aggCols.map((c) => c.key), sourceCount: serverAgg.total };
    }
    if (clientAggregate) return { cols: clientAggregate.cols, rows: clientAggregate.rows, visibleKeys: clientAggregate.cols.map((c) => c.key), sourceCount: clientAggregate.sourceCount };
    return null;
  }, [summaryMode, serverAggEligible, serverAgg, clientAggregate]);

  const displayCols = summaryTable?.cols ?? cols;
  const displayRows = summaryTable?.rows ?? filteredRows;
  const displayVisibleKeys = summaryTable?.visibleKeys ?? visibleKeys;

  // ── the key figures ──
  const facts: Fact[] = useMemo(() => {
    if (!dataset) return [];
    let grand: { label: string; value: unknown } | null = null;
    if (summaryMode && clientAggregate && spec.measures[0]) {
      const mk = measureColKey(spec.measures[0]);
      grand = { label: clientAggregate.cols.find((c) => c.key === mk)?.label ?? 'Total', value: clientAggregate.grand[mk] };
    }
    if (summaryMode && !summaryTable) return [];
    return keyFacts({
      datasetKey: dataset.key,
      rows,
      matching: filteredRows,
      summary: summaryMode && summaryTable ? { groups: summaryTable.rows.length, sourceRows: serverAggEligible ? null : summaryTable.sourceCount, grand } : null,
    });
  }, [dataset, rows, filteredRows, summaryMode, summaryTable, serverAggEligible, clientAggregate, spec.measures]);

  // ── what a person must be told about the data ──
  const readInfo = loaded.data;
  const partial: Coverage = useMemo(
    () => (!dataset || serverAggEligible || !readInfo
      ? { partial: false, text: '', short: '' }
      : coverage({ serverMode: readInfo.fromServer, loaded: readInfo.rows.length, total: readInfo.total })),
    [dataset, serverAggEligible, readInfo],
  );
  const skippedLines = useMemo(() => {
    const labelOf = (k: string) => lookupCols.find((c) => c.key === k)?.label ?? k;
    return serverAggEligible ? summaryWarningLines(serverAgg?.warnings, labelOf) : skippedFilterLines(readInfo?.skipped, labelOf);
  }, [serverAggEligible, serverAgg, readInfo, lookupCols]);
  const fallbackLine = summaryMode && forceClientAgg ? AGGREGATE_FALLBACK : null;

  const countGapCols = useMemo(() => (dataset?.columns || []).filter((c) => isCountColumn(c)), [dataset]);
  const loadError = (loaded.error || agg.error) as Error | null;
  const busy = serverAggEligible ? agg.isLoading : loaded.isFetching;
  const refetch = () => { if (serverAggEligible) void agg.refetch(); else void loaded.refetch(); };

  return {
    // columns
    linkageCatalog, linkageDegraded, linkageColDefs, linkagePresenceCols, sourceCols, calcDefs, allCols, cols, lookupCols, filterCols, selectedCols, labelFor, countGapCols,
    // reading
    includes, serverMode, serverAggEligible, rows, filteredRows, showInitialLoad, loading: loaded.isLoading || loaded.isFetching, busy, loadError, refetch, hasRows: rows.length > 0,
    // summary
    summaryMode, dimensions, groupByKey, summaryTable, clientAggregate, displayCols, displayRows, displayVisibleKeys, visibleKeys,
    // told
    facts, partial, skippedLines, fallbackLine,
  };
}

export type ReportRows = ReturnType<typeof useReportRows>;
