'use client';

// One kept report, as it was generated (frozen). Print prints the report alone, so "Save as PDF" in the print dialog gives the pack for the committee papers. The head names the report and where it
// stands; a report that cannot be read says so with Retry, and one that does not exist says that, with the way back. The same ReportView draws the examiner's copy.
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, ErrorState, SkeletonLines, StatusPill } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { tpraApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { reportState } from '@/lib/statuses/vendorInsights';
import ReportView, { type ReportContent } from '@/components/vendor-risk/ReportView';
import { TPRM_QUERY_OPTS } from '../../_lib/tprmQuery';
import { stateOf, whoWhen, type KeptReport } from '../_reports/reportsModel';

interface Kept extends KeptReport { content: ReportContent }

// Print prints the report alone: everything else on the page is hidden, the report is laid at the top of the sheet
const PRINT_ONLY_REPORT = `@media print {
  body * { visibility: hidden; }
  #tprm-report, #tprm-report * { visibility: visible; }
  #tprm-report { position: absolute; left: 0; top: 0; width: 100%; }
}`;
const BACK = { href: '/vendor-risk/reports', label: 'Back to reports' };

export default function KeptReportPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({ queryKey: ['tprm-report', id], queryFn: async () => (await tpraApi.getReport(Number(id))).data as Kept, ...TPRM_QUERY_OPTS });
  const r = q.data;

  if (q.isLoading) return <div className="flex flex-col gap-[16px]"><PageHeader variant="page" title="Report" back={BACK} /><SkeletonLines lines={6} label="Loading the report" /></div>;
  if (q.isError || !r) {
    const gone = statusOf(q.error) === 404;
    return (
      <div className="flex flex-col gap-[16px]">
        <PageHeader variant="page" title="Report" back={BACK} />
        <ErrorState title={gone ? 'This report could not be found' : 'Couldn’t load this report'} message={gone ? 'It may have been discarded. Draft reports can be discarded; an approved report stays on record.' : errorMessage(q.error)} onRetry={!gone && canRetry(q.error) ? () => { void q.refetch(); } : undefined} />
      </div>
    );
  }
  const day = (v: string | null) => (v ? formatDate(v) : '');
  return (
    <div className="flex min-w-0 flex-col gap-[16px]">
      <style>{PRINT_ONLY_REPORT}</style>
      <PageHeader
        variant="page"
        title={r.title}
        back={BACK}
        chips={<><StatusPill size="sm" {...statusPill(reportState, stateOf(r))} />{r.share.active && <span className="text-ds-body text-ds-fg-muted">Shared until {day(r.share.expires_at)} · {r.share.views} {r.share.views === 1 ? 'view' : 'views'}</span>}</>}
        meta={`${r.kind_label} · ${whoWhen(r, day(r.generated_at), r.approved_at ? day(r.approved_at) : null)}`}
        actions={<Button leftIcon={<Printer aria-hidden />} onClick={() => window.print()}>Print or save as PDF</Button>}
      />
      <div id="tprm-report" className="min-w-0">
        {/* the head names the report on screen; on paper the report names itself */}
        <h1 className="m-0 mb-[8px] hidden break-words !text-ds-title !font-[600] !text-ds-fg print:block">{r.title}</h1>
        <ReportView content={r.content} heading="none" />
      </div>
    </div>
  );
}
