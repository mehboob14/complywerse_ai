'use client';

// One kept report, as it was generated. Print prints the report alone, so
// "Save as PDF" in the print dialog gives the pack for the committee papers.

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Printer } from 'lucide-react';
import { tpraApi } from '@/lib/api';
import ReportView, { fmtDay, type ReportContent } from '@/components/vendor-risk/ReportView';
import { TPRM_QUERY_OPTS } from '../../_lib/tprmQuery';

interface Kept {
  id: number; kind_label: string; generated_at: string | null; generated_by: string | null; approved_at: string | null;
  approved_by: string | null; content_hash: string; content: ReportContent;
  share: { active: boolean; expires_at: string | null; views: number; last_viewed_at: string | null };
}

const PRINT_ONLY_REPORT = `@media print {
  body * { visibility: hidden; }
  #tprm-report, #tprm-report * { visibility: visible; }
  #tprm-report { position: absolute; left: 0; top: 0; width: 100%; }
}`;

export default function KeptReportPage() {
  const { id } = useParams<{ id: string }>();
  const { data: r, isLoading, error } = useQuery({
    queryKey: ['tprm-report', id],
    queryFn: async () => (await tpraApi.getReport(Number(id))).data as Kept,
    ...TPRM_QUERY_OPTS,
  });

  if (isLoading) return <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>;
  if (error || !r) return <p role="alert" className="text-sm text-red-600">This report could not be found.</p>;

  return (
    <div className="space-y-4">
      <style>{PRINT_ONLY_REPORT}</style>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/vendor-risk/reports" className="inline-flex items-center gap-1 text-xs text-primary-700 hover:underline">
          <ArrowLeft className="h-3.5 w-3.5" /> All reports
        </Link>
        <button type="button" onClick={() => window.print()}
          className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-xs font-medium text-slate-700">
          <Printer className="h-3.5 w-3.5" /> Print or save as PDF
        </button>
      </div>
      <div id="tprm-report" className="space-y-3">
        <p className="text-[11px] text-gray-500">
          {r.kind_label} · generated {fmtDay(r.generated_at)}{r.generated_by ? ` by ${r.generated_by}` : ''} ·{' '}
          {r.approved_at ? `approved ${fmtDay(r.approved_at)}${r.approved_by ? ` by ${r.approved_by}` : ''}` : 'draft, not approved'}
          {' '}· fingerprint <span className="font-mono">{r.content_hash.slice(0, 12)}</span>
          {r.share.active && <> · shared with an examiner until {fmtDay(r.share.expires_at)}, {r.share.views} view{r.share.views === 1 ? '' : 's'}</>}
        </p>
        <ReportView content={r.content} />
      </div>
    </div>
  );
}
