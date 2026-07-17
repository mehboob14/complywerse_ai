'use client';

export const dynamic = 'force-dynamic';

/**
 * Executive PDF view for a built report.
 *
 * Follows the app's existing print idiom (see assets/criticality-assessments/…/print):
 * a chrome-free layout the browser's native Print → Save as PDF lifts cleanly.
 * This beats a JS PDF library here — output is real vector text (selectable,
 * searchable, crisp) at zero dependency cost, and it reuses the very components
 * the screen renders, so the PDF can't drift from the app.
 *
 * Layout: summary page (title, provenance, KPI totals, chart) → page break →
 * the full data table, fully expanded, with the header row repeated per page.
 *
 * The spec arrives via localStorage (printPayload) because this opens in a new tab.
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Printer } from 'lucide-react';
import { datasetByKey } from '../_reports/datasets';
import { readPrintSpec } from '../_reports/printPayload';
import { AGG_LABEL, allNodeKeys, buildPivot, fieldDomain, fmtAgg } from '../_reports/pivot';
import { describeRules, rowMatchesRules, rowMatchesSearch } from '../_reports/grid-utils';
import PivotTable from '../_reports/PivotTable';
import PivotChart from '../_reports/PivotChart';
import type { ChartKind } from '../_reports/PivotChart';
import type { ReportSpec, Row } from '../_reports/types';

export default function ReportPrintPage() {
  const [spec, setSpec] = useState<ReportSpec | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => { setSpec(readPrintSpec()); setReady(true); }, []);

  const dataset = spec ? datasetByKey(spec.dataset) : undefined;
  const { data: rows = [], isLoading, error } = useQuery<Row[]>({
    queryKey: ['report', dataset?.key],
    queryFn: dataset!.fetch,
    enabled: !!dataset,
    staleTime: 30_000,
  });

  const cols = dataset?.columns ?? [];
  const labelFor = (key: string) => cols.find((c) => c.key === key)?.label ?? 'rows';

  const filteredRows = useMemo(
    () => (spec ? rows.filter((r) => rowMatchesSearch(cols, r, spec.search) && rowMatchesRules(cols, r, spec.rules)) : []),
    [rows, cols, spec],
  );
  const result = useMemo(
    () => buildPivot(cols, filteredRows, spec?.rows ?? [], spec?.col ?? null, spec?.measures ?? []),
    [cols, filteredRows, spec],
  );
  const colDomain = useMemo(() => fieldDomain(cols.find((c) => c.key === spec?.col), rows), [cols, spec, rows]);
  const rowDomain = useMemo(() => fieldDomain(cols.find((c) => c.key === spec?.rows[0]), rows), [cols, spec, rows]);
  const expanded = useMemo(() => new Set(allNodeKeys(result.nodes)), [result]);

  const hasChart = !!spec && spec.view !== 'table' && result.nodes.length > 0 && result.measures.length > 0;

  // Print once the data — and the chart's SVG — have actually rendered. Never
  // auto-print an errored (empty) report.
  useEffect(() => {
    if (!spec || !dataset || isLoading || error) return;
    const t = window.setTimeout(() => window.print(), 900);
    return () => window.clearTimeout(t);
  }, [spec, dataset, isLoading, error]);

  if (!ready || (dataset && isLoading)) {
    return <div className="flex items-center justify-center p-12 text-slate-500"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  }
  if (!spec || !dataset) {
    return (
      <div className="p-8">
        <p className="text-sm text-slate-600">No report to print. Open a report in <span className="font-medium">Reports → Build</span> and choose <span className="font-medium">Export → PDF</span>.</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-8">
        <p className="text-sm text-rose-700">Could not load {dataset.label} data for this report. Nothing was printed — reopen the report and try again.</p>
      </div>
    );
  }

  const generated = new Date().toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' });
  const title = spec.name.trim() || `${dataset.label} report`;

  const facts: { label: string; value: string }[] = [
    { label: 'Dataset', value: `${dataset.module} · ${dataset.label}` },
    { label: 'Rows', value: `${filteredRows.length.toLocaleString()}${filteredRows.length !== rows.length ? ` of ${rows.length.toLocaleString()}` : ''}` },
    { label: 'Grouped by', value: spec.rows.length ? spec.rows.map(labelFor).join(' › ') : '—' },
    { label: 'Pivoted by', value: spec.col ? labelFor(spec.col) : '—' },
    { label: 'Filters', value: describeRules(cols, spec.rules) },
    ...(spec.search.trim() ? [{ label: 'Search', value: `“${spec.search.trim()}”` }] : []),
  ];

  return (
    <article className="rpt-doc mx-auto max-w-5xl bg-white p-6 text-slate-900 sm:p-8 print:max-w-none print:p-0">
      <style jsx global>{`
        @media print {
          @page { margin: 16mm 12mm 14mm; }
          body { background: #fff !important; }
          /* Dashboard chrome lives outside this page — hide it. The report's own
             summary is a <div> (not <header>), so this never hides the title. */
          aside, header, nav { display: none !important; }
          .rpt-noprint { display: none !important; }
          /* The dashboard shell is height:100vh + overflow:hidden; if it isn't
             reset, Chrome clips paged content to a single page. Let it flow. */
          html, body { height: auto !important; overflow: visible !important; }
          .cw-dashboard, .cw-dashboard > div, .cw-dashboard main { height: auto !important; overflow: visible !important; }
          /* The interactive table is a scrolling, sticky viewport widget; on paper
             it must simply flow, or later rows would be clipped away. */
          .rpt-doc .overflow-auto { overflow: visible !important; }
          .rpt-doc thead, .rpt-doc tfoot, .rpt-doc td, .rpt-doc th { position: static !important; }
          .rpt-doc table { width: 100% !important; }
          .rpt-doc thead { display: table-header-group; }  /* repeat header each page */
          .rpt-doc tfoot { display: table-row-group; }     /* totals sit after the last row, not on every page */
          .rpt-doc tr { break-inside: avoid; }
          .rpt-break { break-before: page; }
          .rpt-runfoot { position: fixed; bottom: 0; left: 0; right: 0; }
        }
      `}</style>

      {/* On-screen only — lets an operator re-trigger a dismissed dialog. */}
      <div className="rpt-noprint mb-6 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-xs text-slate-500">Print dialog didn’t open? Use the button. Enable “Headers and footers” in the dialog for page numbers.</p>
        <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-600">
          <Printer className="h-3.5 w-3.5" /> Print / Save as PDF
        </button>
      </div>

      {/* ── Summary ─────────────────────────────────────────────────── */}
      {/* A <div>, not <header>: the global print rule hides all <header> elements
          (dashboard chrome), which would otherwise erase this title block. */}
      <div className="rpt-titleblock border-b-2 border-primary-500 pb-4">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary-700">{dataset.module}</p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
          </div>
          <p className="shrink-0 text-[11px] text-slate-500">{generated}</p>
        </div>
      </div>

      <section className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1.5">
        {facts.map((f) => (
          <div key={f.label} className="flex gap-2 text-[11px] leading-snug">
            <span className="w-20 shrink-0 font-semibold text-slate-500">{f.label}</span>
            <span className="min-w-0 flex-1 text-slate-700">{f.value}</span>
          </div>
        ))}
      </section>

      {/* KPI totals — the headline numbers, before any detail. */}
      {result.measures.length > 0 && (
        <section className="mt-5 flex flex-wrap gap-3">
          {result.measures.map((m, i) => (
            <div key={m.id} className="min-w-[150px] flex-1 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                {m.agg === 'count' ? 'Count' : `${AGG_LABEL[m.agg]} ${labelFor(m.key)}`}
              </p>
              <p className="mt-0.5 text-2xl font-bold text-slate-900">{fmtAgg(result.grand.totals[i] ?? null, m.agg) || '—'}</p>
            </div>
          ))}
        </section>
      )}

      {hasChart && (
        <section className="mt-5">
          <div className="h-[300px] w-full rounded-xl border border-slate-200 p-3">
            <PivotChart result={result} kind={spec.view as ChartKind} animate={false}
              measureIdx={Math.min(spec.measureIdx, Math.max(0, result.measures.length - 1))}
              colDomain={colDomain} rowDomain={rowDomain}
              options={{ legend: spec.showLegend !== false, labels: !!spec.showLabels }} />
          </div>
        </section>
      )}

      {/* ── Detail table ────────────────────────────────────────────── */}
      <section className={`mt-6 ${hasChart ? 'rpt-break' : ''}`}>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Detail</h2>
        <PivotTable result={result} expanded={expanded} onToggle={() => {}} labelFor={labelFor} />
      </section>

      <footer className="rpt-runfoot mt-6 border-t border-slate-200 pt-2 text-[10px] text-slate-400">
        {title} · {dataset.label} · generated {generated}
      </footer>
    </article>
  );
}
