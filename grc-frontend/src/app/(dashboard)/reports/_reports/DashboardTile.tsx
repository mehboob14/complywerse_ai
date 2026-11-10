'use client';

// One dashboard tile: take its report, load the rows, draw it.
//
// Every tile runs the same pipeline the builder does (reportData), so a number on a dashboard and the same number in the builder cannot disagree — which is the only property that makes a
// dashboard worth trusting. The report arrives from the page (one list for the whole dashboard, not a request per tile), and two tiles that need the same rows share ONE load
// (dashboardModel.rowsKey). A tile that cannot draw says WHY, in words, and it is never a zero: the report is not available to this person, the module is not theirs, the data failed (with
// Retry). A tile that drew only part of the register says so under its number.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, ArrowUpRight, Lock, RotateCw } from 'lucide-react';
import { Button, IconButton, SkeletonLines, Table, TBody, Td, Th, THead, Tr } from '@/components/ui/ds';
import { EMPTY, formatCount } from '@/lib/format';
import type { ChartKind, ColumnDef, ReportSpec, Row } from './types';
import { datasetByKey, DATASETS } from './datasets';
import { fetchLinkageCatalog } from './linkages';
import { filterReportRows, loadReportRows, resolveReportColumns } from './reportData';
import { coverage } from './rowCoverage';
import { buildPivot, runAgg } from './pivot';
import PivotChart from './PivotChart';
import { displayText } from './grid-utils';
import { measureLabel } from './aggregate-utils';
import type { DashboardTile } from './dashboards';
import { TILE_WORDS, measureChoice, rowsKey, tileProblem } from '../_library/dashboards/dashboardModel';

const TABLE_ROWS = 6;

function Say({ icon, children, action }: { icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div role="status" className="flex h-full min-h-[10rem] flex-col items-center justify-center gap-[8px] px-[16px] py-[12px] text-center text-ds-body text-ds-fg-muted">
      {icon}
      <span className="max-w-[28ch]">{children}</span>
      {action}
    </div>
  );
}

export default function DashboardTileCard({
  tile,
  spec,
  loadingSpecs,
  specsFailed = false,
  onRetrySpecs,
  moduleOpen,
  onDrill,
}: {
  tile: DashboardTile;
  /** the tile's report from the dashboard's one list; null when the person cannot see it */
  spec: ReportSpec | null;
  /** the list of reports is still on its way */
  loadingSpecs: boolean;
  /** the list of reports could not be read, so a missing report is not known to be missing */
  specsFailed?: boolean;
  onRetrySpecs?: () => void;
  /** whether the person may open a module (the dataset key) */
  moduleOpen: (datasetKey: string) => boolean;
  /** Open the underlying report, optionally narrowed to one category. */
  onDrill: (reportId: string, drill?: { col: string; value: string }) => void;
}) {
  const dataset = spec ? datasetByKey(spec.dataset) : undefined;
  const open = !!dataset && moduleOpen(dataset.key);

  const catalogQuery = useQuery({
    queryKey: ['report-linkages', spec?.dataset, 'dashboard'],
    queryFn: () => fetchLinkageCatalog(spec!.dataset, DATASETS),
    enabled: !!spec && open,
    staleTime: 300_000,
  });
  const catalog = catalogQuery.data?.defs ?? [];

  const plan = useMemo(
    () => resolveReportColumns(spec ?? ({} as ReportSpec), dataset, catalog),
    [spec, dataset, catalog],
  );

  const rowsQuery = useQuery({
    queryKey: rowsKey({
      dataset: spec?.dataset ?? '', serverMode: !!dataset?.server, includes: plan.includes, fields: plan.projectFields,
      rules: spec?.rules, search: spec?.search ?? '', sorts: spec?.sorts,
    }) as unknown[],
    queryFn: () => loadReportRows(spec!, dataset!, plan),
    enabled: !!spec && !!dataset && open && catalogQuery.isFetched,
    staleTime: 60_000,
  });
  const data = rowsQuery.data;

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

  const title = (tile.title || '').trim() || spec?.name || 'Untitled report';
  const loading = loadingSpecs || (open && !!spec && (catalogQuery.isPending || rowsQuery.isPending));
  const listFailed = !spec && specsFailed;
  const problem = tileProblem({ loading, hasReport: !!spec || listFailed, moduleKnown: !!dataset || listFailed, moduleOpen: open || listFailed, failed: rowsQuery.isError || listFailed });
  const partial = data ? coverage({ serverMode: !!dataset?.server, loaded: data.rows.length, total: data.total }) : null;

  const drill = (category?: string) => {
    const dim = spec?.rows?.[0];
    onDrill(tile.reportId, category && dim ? { col: dim, value: category } : undefined);
  };

  const note = partial?.partial ? <p className="m-0 px-[12px] pb-[8px] text-center text-ds-label text-ds-warning">{`Part of the data: ${partial.short}`}</p> : null;

  const body = () => {
    if (problem === 'loading') {
      return <SkeletonLines lines={2} label={`Loading ${title}`} className="flex h-full min-h-[10rem] flex-col justify-center p-[16px]" />;
    }
    if (problem === 'missing') return <Say icon={<AlertCircle aria-hidden className="h-[16px] w-[16px] text-ds-warning" />}>{TILE_WORDS.missing}</Say>;
    if (problem === 'no_module') return <Say icon={<Lock aria-hidden className="h-[16px] w-[16px]" />}>{TILE_WORDS.no_module}</Say>;
    if (problem === 'error') {
      return (
        <Say
          icon={<AlertCircle aria-hidden className="h-[16px] w-[16px] text-ds-danger" />}
          action={<Button size="sm" leftIcon={<RotateCw aria-hidden />} onClick={() => { if (listFailed) onRetrySpecs?.(); else void rowsQuery.refetch(); }}>Retry</Button>}
        >
          {TILE_WORDS.error}
        </Say>
      );
    }
    if (!spec || !dataset) return null;

    if (tile.render === 'kpi') {
      const idx = measureChoice(tile.measureIdx, spec.measures?.length ?? 0);
      const m = idx >= 0 ? spec.measures[idx] : undefined;
      let value: string;
      let caption: string;
      if (m) {
        // Aggregate over every matching row directly — a KPI has no breakdown, so it must not depend on the pivot, which needs one.
        const col = m.key ? plan.cols.find((c) => c.key === m.key) : undefined;
        const n = runAgg(m.agg, col, rows);
        value = n == null ? EMPTY : Number.isInteger(n) ? formatCount(n) : n.toFixed(1);
        caption = tile.caption || measureLabel(m, col?.label ?? '');
      } else {
        value = formatCount(rows.length);
        caption = tile.caption || `${dataset.label} matching this report`;
      }
      return (
        <div className="flex h-full min-h-[8rem] flex-col items-center justify-center px-[16px] text-center">
          <p className="m-0 text-[32px] font-[600] leading-[1.1] tabular-nums text-ds-fg">{value}</p>
          <p className="m-0 mt-[6px] text-ds-body text-ds-fg-muted">{caption}</p>
          {note}
        </div>
      );
    }

    if (tile.render === 'table') {
      if (!rows.length) return <Say icon={null}>No rows match this report.</Say>;
      if (!tableCols.length) return <Say icon={null}>This report has no columns yet.</Say>;
      return (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-hidden">
            <Table caption={`${title}: the first ${Math.min(rows.length, TABLE_ROWS)} rows`}>
              <THead><Tr>{tableCols.map((c) => <Th key={c.key} align={c.type === 'number' ? 'right' : 'left'}>{c.label}</Th>)}</Tr></THead>
              <TBody>
                {rows.slice(0, TABLE_ROWS).map((r, i) => (
                  <Tr key={i}>{tableCols.map((c) => <Td key={c.key} align={c.type === 'number' ? 'right' : 'left'}>{displayText(c, r) || EMPTY}</Td>)}</Tr>
                ))}
              </TBody>
            </Table>
          </div>
          {note}
        </div>
      );
    }

    if (!rows.length) return <Say icon={null}>No rows match this report.</Say>;
    if (!pivot) {
      return (
        <Say icon={null} action={<Button size="sm" onClick={() => drill()}>Open the report to set one</Button>}>
          This chart needs a breakdown field.
        </Say>
      );
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 p-[4px]">
          <PivotChart
            result={pivot}
            kind={tile.render as ChartKind}
            measureIdx={0}
            colDomain={pivot.hasCol ? pivot.colKeys : ['']}
            options={{ legend: true }}
            onSelect={(category) => drill(category)}
          />
        </div>
        {note}
      </div>
    );
  };

  return (
    <article aria-label={title} className="flex h-full min-w-0 flex-col overflow-hidden rounded-ds-card border border-ds-border bg-ds-surface">
      <header className="flex shrink-0 items-center justify-between gap-[8px] border-b border-ds-border px-[12px] py-[4px]">
        <h3 className="m-0 min-w-0 truncate !text-ds-body !font-[600] !text-ds-fg" title={title}>{title}</h3>
        {spec && open && (
          <IconButton label={`Open the report “${title}”`} onClick={() => drill()}><ArrowUpRight aria-hidden /></IconButton>
        )}
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{body()}</div>
    </article>
  );
}
