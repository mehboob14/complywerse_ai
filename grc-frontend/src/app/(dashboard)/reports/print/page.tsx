'use client';

export const dynamic = 'force-dynamic';

/**
 * Print / PDF view for a built report.
 *
 * Chrome-free layout for the browser's Print > Save as PDF. The spec arrives through printPayload (the new tab takes it once). The rows come from the SAME pipeline as the workspace, the library's
 * download and the dashboard tiles (reportData.ts), so the PDF is the report the person saw. When the rows are only part of the module the page says so, on the paper too.
 */

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { Button, ErrorState, Notice, SkeletonRows } from '@/components/ui/ds';
import { apiErrorText, safeDetail } from '@/lib/apiError';
import { formatCount, formatDateTime } from '@/lib/format';
import { DATASETS, datasetByKey } from '../_reports/datasets';
import { fetchLinkageCatalog } from '../_reports/linkages';
import { readPrintSpec } from '../_reports/printPayload';
import { describeRules } from '../_reports/grid-utils';
import { filterReportRows, loadReportRows, resolveReportColumns } from '../_reports/reportData';
import { coverage } from '../_reports/rowCoverage';
import { skippedFilterLines } from '../builder/_workspace/notices';
import ReportDataTable from '../_reports/ReportDataTable';
import type { ReportSpec } from '../_reports/types';
import PermissionGuard from '@/components/ui/PermissionGuard';
import { navPermissions } from '@/components/layout/navAccess';

// printed from the report workspace: its right, else the no-access page
export default function GuardedReportPrintPage() {
  return <PermissionGuard required={navPermissions('/reports/print')}><ReportPrintPage /></PermissionGuard>;
}

function ReportPrintPage() {
  const [spec, setSpec] = useState<ReportSpec | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => { setSpec(readPrintSpec()); setReady(true); }, []);

  const dataset = spec ? datasetByKey(spec.dataset) : undefined;
  const { data: linkageResult } = useQuery({
    queryKey: ['report-linkages', dataset?.key, 'print'],
    queryFn: () => fetchLinkageCatalog(dataset!.key, DATASETS),
    enabled: !!dataset,
    staleTime: 60_000,
  });
  const linkageCatalog = linkageResult?.defs ?? [];

  const plan = useMemo(() => resolveReportColumns(spec ?? ({} as ReportSpec), dataset, linkageCatalog), [spec, dataset, linkageCatalog]);
  const includes = plan.includes;
  const cols = plan.cols;

  const { data: loaded, isLoading, error, refetch } = useQuery({
    queryKey: ['report-print', dataset?.key, includes.join(','), JSON.stringify(spec?.rules), spec?.search],
    queryFn: () => loadReportRows(spec!, dataset!, plan),
    enabled: !!dataset && !!spec,
    staleTime: 30_000,
  });
  const rows = loaded?.rows ?? [];

  const labelFor = (key: string) => {
    const col = cols.find((c) => c.key === key);
    if (!col) return key;
    return col.linkageModule ? `${col.linkageModule} · ${col.label}` : col.label;
  };
  const visibleKeys = useMemo(() => spec?.visibleColumns ?? [], [spec?.visibleColumns]);
  const filteredRows = useMemo(
    () => (spec ? filterReportRows(cols, rows, spec, !!dataset?.server, (k) => plan.lookupCols.find((c) => c.key === k)) : []),
    [rows, cols, spec, dataset, plan.lookupCols],
  );
  const note = dataset && loaded ? coverage({ serverMode: !!dataset.server, loaded: rows.length, total: loaded.total }) : null;
  const skipped = skippedFilterLines(loaded?.skipped, (k) => plan.lookupCols.find((c) => c.key === k)?.label ?? k);

  // the print dialog opens by itself once the rows are in (the button below is there if it does not)
  useEffect(() => {
    if (!spec || !dataset || isLoading || error) return;
    const t = window.setTimeout(() => window.print(), 900);
    return () => window.clearTimeout(t);
  }, [spec, dataset, isLoading, error]);

  if (!ready || (dataset && isLoading)) return <SkeletonRows rows={8} columns={5} label="Preparing the report for printing" />;
  if (!spec || !dataset) {
    return (
      <div className="p-[24px]">
        <p className="m-0 text-ds-body text-ds-fg-body">There is no report to print. Open a report in Reports and choose Download, then PDF.</p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="p-[24px]">
        <ErrorState title={`${dataset.label} could not be loaded`} message={safeDetail(apiErrorText(error, '')) || 'Nothing was printed. Try again.'} onRetry={() => void refetch()} />
      </div>
    );
  }

  const generated = formatDateTime(new Date());
  const title = spec.name.trim() || `${dataset.label} report`;
  const facts: { label: string; value: string }[] = [
    { label: 'Module', value: `${dataset.module} · ${dataset.label}` },
    { label: 'Rows', value: `${formatCount(filteredRows.length)}${filteredRows.length !== rows.length ? ` of ${formatCount(rows.length)}` : ''}${note?.partial ? `, ${note.short}` : ''}` },
    { label: 'Columns', value: visibleKeys.length ? visibleKeys.map(labelFor).join(', ') : '(none)' },
    { label: 'Filters', value: describeRules(cols, spec.rules) },
    ...(includes.length ? [{ label: 'Links', value: includes.map((k) => linkageCatalog.find((l) => l.key === k)?.label ?? k).join(', ') }] : []),
    ...(spec.search.trim() ? [{ label: 'Search', value: `“${spec.search.trim()}”` }] : []),
  ];

  return (
    <article className="rpt-doc mx-auto max-w-[1100px] bg-ds-surface p-[24px] text-ds-fg print:max-w-none print:p-0">
      <style jsx global>{`
        @media print {
          @page { margin: 16mm 12mm 14mm; }
          body { background: #fff !important; }
          aside, header, nav { display: none !important; }
          .rpt-noprint { display: none !important; }
          html, body { height: auto !important; overflow: visible !important; }
          .cw-dashboard, .cw-dashboard > div, .cw-dashboard main { height: auto !important; overflow: visible !important; }
          .rpt-doc .overflow-auto { overflow: visible !important; max-height: none !important; }
          .rpt-doc thead, .rpt-doc tfoot, .rpt-doc td, .rpt-doc th { position: static !important; }
          .rpt-doc table { width: 100% !important; }
          .rpt-doc thead { display: table-header-group; }
          .rpt-doc tfoot { display: table-row-group; }
          .rpt-doc tr { break-inside: avoid; }
          .rpt-runfoot { position: fixed; bottom: 0; left: 0; right: 0; }
        }
      `}</style>

      <div className="rpt-noprint mb-[24px] flex flex-wrap items-center justify-between gap-[12px] rounded-ds-card border border-ds-border bg-ds-surface-subtle px-[16px] py-[12px]">
        <p className="m-0 min-w-0 flex-1 text-ds-body text-ds-fg-muted">The print dialog opens by itself. If it did not, use the button. Turn on “Headers and footers” in the dialog for page numbers.</p>
        <Button variant="primary" leftIcon={<Printer aria-hidden />} onClick={() => window.print()}>Print or save as PDF</Button>
      </div>

      {note?.partial && <Notice className="mb-[16px]" tone="warning" title="This report shows only part of the module">{note.text}</Notice>}
      {skipped.length > 0 && (
        <Notice className="mb-[16px]" tone="warning" title="Some conditions were not applied">
          <ul className="m-0 list-disc pl-[16px]">{skipped.map((l, i) => <li key={i}>{l}</li>)}</ul>
        </Notice>
      )}

      <div className="rpt-titleblock border-b-2 border-ds-primary pb-[16px]">
        <div className="flex items-baseline justify-between gap-[16px]">
          <div className="min-w-0">
            <p className="m-0 text-[12px] font-[600] tracking-[0.06em] text-ds-primary-text">{dataset.module}</p>
            <h1 className="m-0 mt-[2px] !text-[24px] !font-[600] !leading-[32px] !text-ds-fg [overflow-wrap:anywhere]">{title}</h1>
          </div>
          <p className="m-0 shrink-0 text-[12px] text-ds-fg-muted">{generated}</p>
        </div>
      </div>

      <section className="mt-[16px] grid grid-cols-1 gap-x-[32px] gap-y-[6px] sm:grid-cols-2">
        {facts.map((f) => (
          <div key={f.label} className="flex gap-[8px] text-[12px] leading-[18px]">
            <span className="w-[72px] shrink-0 font-[600] text-ds-fg-muted">{f.label}</span>
            <span className="min-w-0 flex-1 text-ds-fg-body [overflow-wrap:anywhere]">{f.value}</span>
          </div>
        ))}
      </section>

      <section className="mt-[24px]">
        <h2 className="m-0 mb-[8px] !text-[12px] !font-[600] !leading-[18px] !text-ds-fg-muted">Detail</h2>
        {visibleKeys.length === 0 ? (
          <p className="m-0 text-ds-body text-ds-fg-muted">This report has no columns selected.</p>
        ) : (
          <ReportDataTable rows={filteredRows} cols={cols} visibleKeys={visibleKeys} labelFor={labelFor} paged={false} />
        )}
      </section>

      <footer className="rpt-runfoot mt-[24px] border-t border-ds-border pt-[8px] text-[12px] text-ds-fg-muted">
        {title} · {dataset.label} · generated {generated}
      </footer>
    </article>
  );
}
