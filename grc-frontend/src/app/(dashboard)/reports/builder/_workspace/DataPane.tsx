'use client';

// The rows of the report, beside its definition: how they are shown (Table, Cards, Chart), the conditions that narrow them (each one removable), what a person must know about the data (it is only part of
// the register; the server could not apply a filter; a summary was worked out here), the key figures, and the rows. Every state is drawn: loading, a load that failed (with Retry), no columns yet,
// no summary yet, no rows. The data comes from useReportRows; nothing here fetches.
import { useMemo } from 'react';
import { BarChart3, RotateCw, Sigma, X } from 'lucide-react';
import { Button, Checkbox, EmptyState, ErrorState, Notice, SegmentedControl, Select, SkeletonRows, StatTile, type StatTone } from '@/components/ui/ds';
import { apiErrorText, safeDetail } from '@/lib/apiError';
import type { ChartKind, ReportBodyView, ReportDataset, ReportSpec } from '../../_reports/types';
import { isActiveCondition } from '../../_reports/grid-utils';
import { measureLabel } from '../../_reports/aggregate-utils';
import ReportDataTable from '../../_reports/ReportDataTable';
import DashboardView from '../../_reports/DashboardView';
import PivotChart, { CHART_GROUPS, CHART_TYPES } from '../../_reports/PivotChart';
import { buildPivot } from '../../_reports/pivot';
import { toggleSort, conditionText, withoutCondition } from './builderModel';
import type { ReportRows } from './useReportRows';

type View = 'table' | 'dashboard' | 'chart';
const TONE: Record<string, StatTone> = { default: 'default', success: 'success', warning: 'warning', danger: 'danger' };
const CHIP = 'inline-flex min-h-ds-control-sm items-center gap-[2px] rounded-full border border-ds-border-strong bg-ds-primary-soft pl-[10px] text-ds-label text-ds-primary-text';

export function DataPane({
  dataset, spec, patch, data, showTotals, onShowTotals, onAddFields, onEditFilters, onEditSummary, onRules,
}: {
  dataset: ReportDataset;
  spec: ReportSpec;
  patch: (p: Partial<ReportSpec>) => void;
  data: ReportRows;
  showTotals: boolean;
  onShowTotals: (v: boolean) => void;
  onAddFields: () => void;
  onEditFilters: () => void;
  onEditSummary: () => void;
  /** the rules or the search changed from a chip: the workspace updates its draft too */
  onRules: (next: { rules?: ReportSpec['rules']; search?: string }) => void;
}) {
  const view: ReportBodyView = spec.view ?? 'table';
  const chartMode = view !== 'table' && view !== 'dashboard';
  const shown: View = chartMode ? 'chart' : view === 'dashboard' ? 'dashboard' : 'table';
  const { summaryMode, summaryTable } = data;
  const active = spec.rules.conditions.filter(isActiveCondition);
  const resolve = (k: string) => data.cols.find((x) => x.key === k) || data.filterCols.find((x) => x.key === k);

  const chartPivot = useMemo(
    () => (chartMode ? buildPivot(data.cols, data.filteredRows, data.dimensions, spec.col, spec.measures) : null),
    [chartMode, data.cols, data.filteredRows, data.dimensions, spec.col, spec.measures],
  );
  const chartColDomain = useMemo(() => (chartPivot?.hasCol ? chartPivot.colKeys : ['']), [chartPivot]);
  const chartKind = (chartMode ? view : 'bar') as ChartKind;

  const failedNoData = !!data.loadError && (data.serverAggEligible ? !summaryTable : data.rows.length === 0);
  if (data.showInitialLoad) return <SkeletonRows rows={8} columns={5} label="Loading the rows" />;
  if (failedNoData) {
    return <ErrorState title={`${dataset.label} could not be loaded`} message={safeDetail(apiErrorText(data.loadError, '')) || undefined} onRetry={data.refetch} />;
  }

  const setShown = (v: View) => patch({ view: v === 'chart' ? (chartMode ? view : 'bar') : v });
  const loadNote = data.partial.partial ? data.partial.short : undefined;
  const tableLabel = (k: string) => (summaryMode && summaryTable ? summaryTable.cols.find((c) => c.key === k)?.label ?? k : data.labelFor(k));

  const body = (() => {
    if ((view === 'dashboard' || chartMode) && data.loading && data.filteredRows.length === 0) return <SkeletonRows rows={6} columns={4} label="Loading the rows" />;
    if (view === 'dashboard') {
      return (
        <DashboardView
          cols={summaryMode && summaryTable ? data.displayCols : data.cols}
          rows={summaryMode && summaryTable ? data.displayRows : data.filteredRows}
          visibleKeys={summaryMode && summaryTable ? data.displayVisibleKeys : data.visibleKeys}
          labelFor={tableLabel}
          totalRows={data.rows.length}
          showLegend={spec.showLegend !== false}
          onOpenColumns={onAddFields}
        />
      );
    }
    if (chartMode && !summaryMode) {
      return (
        <EmptyState
          kind="firstUse"
          icon={BarChart3}
          title="A chart needs a summary"
          description="Choose what to count or total, and what to break it down by. Or switch to Cards, which charts every column you have added with no setup."
          action={<div className="flex flex-wrap justify-center gap-[8px]"><Button variant="primary" leftIcon={<Sigma aria-hidden />} onClick={onEditSummary}>Set up the summary</Button><Button onClick={() => setShown('dashboard')}>Use Cards instead</Button></div>}
        />
      );
    }
    if (chartMode && chartPivot) {
      return (
        <div className="h-[420px] rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
          <PivotChart result={chartPivot} kind={chartKind} measureIdx={Math.min(spec.measureIdx ?? 0, Math.max(0, spec.measures.length - 1))} colDomain={chartColDomain} options={{ legend: spec.showLegend !== false, labels: !!spec.showLabels }} />
        </div>
      );
    }
    if (summaryMode && !summaryTable) {
      if (data.loading || data.busy) return <SkeletonRows rows={6} columns={4} label="Working out the summary" />;
      return (
        <EmptyState
          kind="firstUse"
          icon={Sigma}
          title="No summary yet"
          description="Check each calculation: Total and Average need a number column, and Count unique, Lowest and Highest need a column chosen."
          action={<Button variant="primary" onClick={onEditSummary}>Edit the summary</Button>}
        />
      );
    }
    if (summaryMode && summaryTable) {
      return (
        <ReportDataTable
          cols={data.displayCols}
          rows={data.displayRows}
          visibleKeys={data.displayVisibleKeys}
          widths={spec.columnWidths ?? {}}
          align={spec.columnAlign ?? {}}
          pinned={[]}
          sorts={spec.sorts ?? []}
          labelFor={tableLabel}
          onWidthsChange={(w) => patch({ columnWidths: w })}
          onSort={(key, additive) => patch({ sorts: toggleSort(spec.sorts ?? [], key, additive) })}
          groupByKey={null}
          showTotals={false}
          totalInDataset={summaryTable.sourceCount}
          loadNote={loadNote}
        />
      );
    }
    if (data.visibleKeys.length === 0) {
      return (
        <EmptyState
          kind="firstUse"
          title={`Add fields from ${dataset.label}`}
          description="Choose the columns, optionally filter, then download."
          action={<div className="flex flex-wrap justify-center gap-[8px]"><Button variant="primary" onClick={onAddFields}>Add fields</Button><Button leftIcon={<Sigma aria-hidden />} onClick={onEditSummary}>Summarize instead</Button></div>}
        />
      );
    }
    return (
      <ReportDataTable
        cols={data.cols}
        rows={data.filteredRows}
        visibleKeys={data.visibleKeys}
        widths={spec.columnWidths ?? {}}
        align={spec.columnAlign ?? {}}
        pinned={spec.pinnedColumns ?? []}
        sorts={spec.sorts ?? []}
        labelFor={data.labelFor}
        onWidthsChange={(w) => patch({ columnWidths: w })}
        onReorder={(keys) => patch({ visibleColumns: keys })}
        onSort={(key, additive) => patch({ sorts: toggleSort(spec.sorts ?? [], key, additive) })}
        groupByKey={data.groupByKey}
        showTotals={showTotals}
        totalInDataset={data.rows.length}
        loadNote={loadNote}
      />
    );
  })();

  return (
    <div className="flex min-w-0 flex-col gap-[12px]">
      <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px]">
        <SegmentedControl<View> label="How to show the rows" name="report-view" options={[{ value: 'table', label: 'Table' }, { value: 'dashboard', label: 'Cards' }, { value: 'chart', label: 'Chart' }]} value={shown} onChange={setShown} />
        {chartMode && (
          <Select aria-label="Chart type" className="w-[180px]" value={chartKind} onChange={(e) => patch({ view: e.target.value as ChartKind })}>
            {CHART_GROUPS.map((g) => <optgroup key={g} label={g}>{CHART_TYPES.filter((c) => c.group === g).map((c) => <option key={c.kind} value={c.kind}>{c.label}</option>)}</optgroup>)}
          </Select>
        )}
        {shown === 'table' && !summaryMode && <Checkbox label="Show totals" checked={showTotals} onChange={(e) => onShowTotals(e.target.checked)} />}
        {data.busy && <span role="status" className="text-ds-label text-ds-fg-muted">{data.serverAggEligible ? 'Summarising…' : 'Updating the rows…'}</span>}
      </div>
      {chartMode && <p className="m-0 text-ds-label text-ds-fg-muted">{CHART_TYPES.find((c) => c.kind === chartKind)?.blurb}. {CHART_TYPES.find((c) => c.kind === chartKind)?.tip}</p>}

      {(active.length > 0 || spec.search.trim() || summaryMode) && (
        <ul aria-label="What narrows this report" className="m-0 flex list-none flex-wrap items-center gap-[6px] p-0">
          {active.map((c) => (
            <li key={c.id} className={CHIP}>
              <button type="button" onClick={onEditFilters} title="Edit the filters" className="min-h-ds-control-sm rounded-full py-[2px] text-left focus-visible:outline-none focus-visible:shadow-ds-ring [overflow-wrap:anywhere]">{conditionText(c, resolve(c.col))}</button>
              <button type="button" aria-label={`Remove the filter ${conditionText(c, resolve(c.col))}`} onClick={() => onRules({ rules: withoutCondition(spec.rules, c.id) })} className="inline-flex aspect-square h-ds-control-sm items-center justify-center rounded-full hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring"><X aria-hidden className="h-[14px] w-[14px]" /></button>
            </li>
          ))}
          {spec.search.trim() && (
            <li className={CHIP}>
              <span className="py-[2px]">Search “{spec.search.trim()}”</span>
              <button type="button" aria-label="Remove the search" onClick={() => onRules({ search: '' })} className="inline-flex aspect-square h-ds-control-sm items-center justify-center rounded-full hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring"><X aria-hidden className="h-[14px] w-[14px]" /></button>
            </li>
          )}
          {summaryMode && (
            <li className={CHIP}>
              <button type="button" onClick={onEditSummary} title="Edit the summary" className="min-h-ds-control-sm rounded-full py-[2px] text-left focus-visible:outline-none focus-visible:shadow-ds-ring [overflow-wrap:anywhere]">
                Summary{data.dimensions.length > 0 ? ` by ${data.dimensions.map(data.labelFor).join(' › ')}` : ', overall'}: {spec.measures.map((m) => measureLabel(m, m.key ? data.labelFor(m.key) : '')).join(', ')}
              </button>
              <button type="button" aria-label="Clear the summary" onClick={() => patch({ rows: [], measures: [] })} className="inline-flex aspect-square h-ds-control-sm items-center justify-center rounded-full hover:bg-ds-surface-hover focus-visible:outline-none focus-visible:shadow-ds-ring"><X aria-hidden className="h-[14px] w-[14px]" /></button>
            </li>
          )}
        </ul>
      )}

      {data.partial.partial && (
        <Notice tone="warning" title="This report shows only part of the module" action={<Button size="sm" onClick={onEditFilters}>Narrow with a filter</Button>}>
          {data.partial.text} The totals, the charts and the files describe these rows only.
        </Notice>
      )}
      {data.skippedLines.length > 0 && (
        <Notice tone="warning" title="Some conditions were not applied">
          <ul className="m-0 list-disc pl-[16px]">{data.skippedLines.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </Notice>
      )}
      {data.fallbackLine && <Notice tone="info">{data.fallbackLine}</Notice>}
      {data.loadError && !failedNoData && (
        <Notice tone="danger" title="The rows could not be refreshed" action={<Button size="sm" leftIcon={<RotateCw aria-hidden />} onClick={data.refetch}>Retry</Button>}>
          What is shown is from the last time they loaded.
        </Notice>
      )}

      {data.facts.length > 0 && (data.summaryMode || data.visibleKeys.length > 0) && (
        <div className="grid grid-cols-2 gap-[8px] sm:grid-cols-4">
          {data.facts.map((f) => <StatTile key={f.label} label={f.label} value={f.value} tone={TONE[f.tone]} />)}
        </div>
      )}

      {body}
    </div>
  );
}
