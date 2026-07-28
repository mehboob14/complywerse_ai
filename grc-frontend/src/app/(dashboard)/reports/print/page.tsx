'use client';

export const dynamic = 'force-dynamic';

/**
 * Print / PDF view for a built report.
 *
 * Chrome-free layout for browser Print → Save as PDF. Spec arrives via
 * localStorage (printPayload) because this opens in a new tab.
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Printer } from 'lucide-react';
import { DATASETS, datasetByKey } from '../_reports/datasets';
import { enrichReportRows, fetchLinkageCatalog, linkageColumns } from '../_reports/linkages';
import { readPrintSpec } from '../_reports/printPayload';
import { asRows, describeRules, rowMatchesRules, rowMatchesSearch } from '../_reports/grid-utils';
import ReportDataTable from '../_reports/ReportDataTable';
import type { ReportSpec, Row } from '../_reports/types';

export default function ReportPrintPage() {
  const [spec, setSpec] = useState<ReportSpec | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => { setSpec(readPrintSpec()); setReady(true); }, []);

  const dataset = spec ? datasetByKey(spec.dataset) : undefined;
  const includes = useMemo(() => spec?.includes ?? [], [spec?.includes]);
  const project = useMemo(() => spec?.visibleColumns ?? [], [spec?.visibleColumns]);
  const { data: linkageCatalog = [] } = useQuery({
    queryKey: ['report-linkages', dataset?.key, 'print'],
    queryFn: () => fetchLinkageCatalog(dataset!.key, DATASETS),
    enabled: !!dataset,
    staleTime: 60_000,
  });
  const { data: rawRows = [], isLoading, error } = useQuery<Row[]>({
    queryKey: ['report', dataset?.key, includes.join(','), project.join(',')],
    queryFn: async () => {
      const base = asRows(await dataset!.fetch());
      if (!includes.length) return base;
      return enrichReportRows(dataset!.key, base, includes, project);
    },
    enabled: !!dataset,
    staleTime: 30_000,
  });
  const rows = asRows(rawRows);

  const cols = useMemo(
    () => (dataset ? [...dataset.columns, ...linkageColumns(linkageCatalog, includes)] : []),
    [dataset, linkageCatalog, includes],
  );
  const labelFor = (key: string) => {
    const col = cols.find((c) => c.key === key);
    if (!col) return key;
    if (col.linkageModule) return `${col.linkageModule} · ${col.label}`;
    return col.label;
  };
  const visibleKeys = useMemo(() => spec?.visibleColumns ?? [], [spec?.visibleColumns]);

  const filteredRows = useMemo(
    () => (spec ? rows.filter((r) => rowMatchesSearch(cols, r, spec.search) && rowMatchesRules(cols, r, spec.rules)) : []),
    [rows, cols, spec],
  );

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
        <p className="text-sm text-slate-600">No report to print. Open a report in <span className="font-medium">Reports</span> and choose <span className="font-medium">Export → PDF</span>.</p>
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
    { label: 'Columns', value: visibleKeys.length ? visibleKeys.map(labelFor).join(', ') : '(none — empty report)' },
    { label: 'Filters', value: describeRules(cols, spec.rules) },
    ...(includes.length
      ? [{ label: 'Links', value: includes.map((k) => linkageCatalog.find((l) => l.key === k)?.label ?? k).join(', ') }]
      : []),
    ...(spec.search.trim() ? [{ label: 'Search', value: `“${spec.search.trim()}”` }] : []),
  ];

  return (
    <article className="rpt-doc mx-auto max-w-5xl bg-white p-6 text-slate-900 sm:p-8 print:max-w-none print:p-0">
      <style jsx global>{`
        @media print {
          @page { margin: 16mm 12mm 14mm; }
          body { background: #fff !important; }
          aside, header, nav { display: none !important; }
          .rpt-noprint { display: none !important; }
          html, body { height: auto !important; overflow: visible !important; }
          .cw-dashboard, .cw-dashboard > div, .cw-dashboard main { height: auto !important; overflow: visible !important; }
          .rpt-doc .overflow-auto { overflow: visible !important; }
          .rpt-doc thead, .rpt-doc tfoot, .rpt-doc td, .rpt-doc th { position: static !important; }
          .rpt-doc table { width: 100% !important; }
          .rpt-doc thead { display: table-header-group; }
          .rpt-doc tfoot { display: table-row-group; }
          .rpt-doc tr { break-inside: avoid; }
          .rpt-runfoot { position: fixed; bottom: 0; left: 0; right: 0; }
        }
      `}</style>

      <div className="rpt-noprint mb-6 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-xs text-slate-500">Print dialog didn’t open? Use the button. Enable “Headers and footers” in the dialog for page numbers.</p>
        <button onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-600">
          <Printer className="h-3.5 w-3.5" /> Print / Save as PDF
        </button>
      </div>

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

      <section className="mt-6">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">Detail</h2>
        {visibleKeys.length === 0 ? (
          <p className="text-sm text-slate-500">This report has no columns selected.</p>
        ) : (
          <ReportDataTable rows={filteredRows} cols={cols} visibleKeys={visibleKeys} labelFor={labelFor} />
        )}
      </section>

      <footer className="rpt-runfoot mt-6 border-t border-slate-200 pt-2 text-[10px] text-slate-400">
        {title} · {dataset.label} · generated {generated}
      </footer>
    </article>
  );
}
