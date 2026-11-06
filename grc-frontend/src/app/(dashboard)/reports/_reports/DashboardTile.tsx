'use client';

// One dashboard tile: resolve a saved report, load its rows, draw it.
//
// Every tile runs the same pipeline the builder does (reportData), so a number
// on a dashboard and the same number in the builder cannot disagree — which is
// the only property that makes a dashboard worth trusting.
//
// Failure states are explicit rather than blank. A tile whose report was
// deleted, or whose owner stopped sharing it, or that points at a module the
// viewer cannot open, all say so: a dashboard that quietly shows 0 for a
// missing report is worse than one that shows nothing.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ArrowUpRight, Loader2, Lock } from 'lucide-react';
import type { ChartKind, ColumnDef, ReportSpec, Row } from './types';
import { datasetByKey, DATASETS } from './datasets';
import { fetchLinkageCatalog } from './linkages';
import { getSpec } from './savedReports';
import { filterReportRows, loadReportRows, resolveReportColumns } from './reportData';
import { buildPivot, runAgg } from './pivot';
import PivotChart from './PivotChart';
import ReportDataTable from './ReportDataTable';
import { measureLabel } from './aggregate-utils';
import type { DashboardTile } from './dashboards';

const TABLE_ROWS = 6;

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-[10rem] flex-col items-center justify-center gap-1.5 px-4 text-center text-[11px] text-slate-400">
      {children}
    </div>
  );
}

export default function DashboardTileCard({
  tile,
  onDrill,
}: {
  tile: DashboardTile;
  /** Open the underlying report, optionally narrowed to one category. */
  onDrill: (reportId: string, drill?: { col: string; value: string }) => void;
}) {
  const { data: specResult, isLoading: specLoading } = useQuery({
    queryKey: ['dash-report', tile.reportId],
    queryFn: () => getSpec(tile.reportId),
    staleTime: 60_000,
  });
  const spec = specResult?.spec ?? null;
  const dataset = spec ? datasetByKey(spec.dataset) : undefined;

  const { data: catalogResult } = useQuery({
    queryKey: ['report-linkages', spec?.dataset, 'dashboard'],
    queryFn: () => fetchLinkageCatalog(spec!.dataset, DATASETS),
    enabled: !!dataset,
    staleTime: 300_000,
  });
  const catalog = catalogResult?.defs ?? [];

  const plan = useMemo(
    () => resolveReportColumns(spec ?? ({} as ReportSpec), dataset, catalog),
    [spec, dataset, catalog],
  );

  const { data, isLoading, error } = useQuery({
    queryKey: ['dash-rows', tile.reportId, spec?.dataset, plan.includes.join(','), JSON.stringify(spec?.rules), spec?.search],
    queryFn: () => loadReportRows(spec!, dataset!, plan),
    enabled: !!spec && !!dataset,
    staleTime: 60_000,
  });

  const rows: Row[] = useMemo(() => {
    if (!data || !spec) return [];
    return filterReportRows(
      plan.cols, data.rows, spec, !!dataset?.server,
      (k) => plan.lookupCols.find((c) => c.key === k),
    );
  }, [data, spec, plan, dataset]);

  const pivot = useMemo(() => {
    if (!spec || !rows.length) return null;
    const measures = spec.measures?.length
      ? spec.measures
      : [{ id: 'n', key: '', agg: 'count' as const }];
    const dims = spec.rows ?? [];
    if (!dims.length) return null;
    return buildPivot(plan.cols, rows, dims, spec.col ?? null, measures);
  }, [spec, rows, plan.cols]);

  const tableCols: ColumnDef[] = useMemo(
    () => (spec?.visibleColumns ?? [])
      .map((k) => plan.cols.find((c) => c.key === k))
      .filter((c): c is ColumnDef => !!c),
    [spec, plan.cols],
  );

  const title = tile.title || spec?.name || 'Untitled report';

  const drill = (category?: string) => {
    const dim = spec?.rows?.[0];
    onDrill(tile.reportId, category && dim ? { col: dim, value: category } : undefined);
  };

  const body = () => {
    if (specLoading || isLoading) {
      return <Shell><Loader2 className="h-4 w-4 animate-spin text-slate-300" /></Shell>;
    }
    if (!spec) {
      return (
        <Shell>
          <AlertCircle className="h-4 w-4 text-amber-400" />
          <span>This report no longer exists, or is no longer shared with you.</span>
        </Shell>
      );
    }
    if (!dataset) {
      return (
        <Shell>
          <Lock className="h-4 w-4 text-slate-300" />
          <span>You don&apos;t have access to the module this report reads.</span>
        </Shell>
      );
    }
    if (error) {
      return (
        <Shell>
          <AlertCircle className="h-4 w-4 text-rose-400" />
          <span>Could not load {dataset.label}.</span>
        </Shell>
      );
    }

    if (tile.render === 'kpi') {
      const m = spec.measures?.[tile.measureIdx ?? 0];
      let value: string;
      let caption: string;
      if (m) {
        // Aggregate over every matching row directly — a KPI has no breakdown,
        // so it must not depend on the pivot, which needs one.
        const col = m.key ? plan.cols.find((c) => c.key === m.key) : undefined;
        const n = runAgg(m.agg, col, rows);
        value = n == null ? '—' : Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1);
        caption = tile.caption || measureLabel(m, col?.label ?? '');
      } else {
        value = rows.length.toLocaleString();
        caption = tile.caption || `${dataset.label} matching this report`;
      }
      return (
        <div className="flex h-full min-h-[8rem] flex-col items-center justify-center px-4 text-center">
          <p className="text-4xl font-bold tabular-nums text-slate-900">{value}</p>
          <p className="mt-1.5 text-[11px] leading-snug text-slate-500">{caption}</p>
          {data?.truncated && (
            <p className="mt-1 text-[10px] text-amber-600">
              first {data.rows.length.toLocaleString()} of {data.total.toLocaleString()} rows
            </p>
          )}
        </div>
      );
    }

    if (tile.render === 'table') {
      if (!rows.length) return <Shell>No rows match this report.</Shell>;
      if (!tableCols.length) return <Shell>This report has no columns selected.</Shell>;
      return (
        <div className="min-h-0 flex-1 overflow-hidden">
          <ReportDataTable
            cols={tableCols}
            rows={rows.slice(0, TABLE_ROWS)}
            visibleKeys={tableCols.map((c) => c.key)}
            sorts={[]}
          />
        </div>
      );
    }

    if (!rows.length) return <Shell>No rows match this report.</Shell>;
    if (!pivot) {
      return (
        <Shell>
          <span>This chart needs a breakdown field.</span>
          <button type="button" onClick={() => drill()} className="font-medium text-primary-700 hover:underline">
            Open the report to set one
          </button>
        </Shell>
      );
    }
    return (
      <div className="min-h-0 flex-1 p-1">
        <PivotChart
          result={pivot}
          kind={tile.render as ChartKind}
          measureIdx={0}
          colDomain={pivot.hasCol ? pivot.colKeys : ['']}
          options={{ legend: true }}
          onSelect={(category) => drill(category)}
        />
      </div>
    );
  };

  return (
    <article className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <h3 className="truncate text-xs font-semibold text-slate-800" title={title}>{title}</h3>
        <button
          type="button"
          onClick={() => drill()}
          title="Open this report"
          className="shrink-0 rounded p-1 text-slate-300 hover:bg-slate-100 hover:text-primary-700"
        >
          <ArrowUpRight className="h-3.5 w-3.5" />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{body()}</div>
    </article>
  );
}
