'use client';

// An examiner's read-only copy of an approved report. No login: the link is the
// key, it expires, and the organisation that shared it sees every view.

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, Lock, Printer } from 'lucide-react';
import apiClient from '@/lib/api';
import ReportView, { fmtDay, type ReportContent } from '@/components/vendor-risk/ReportView';
import { kindOf, problemText } from '@/components/vendor-risk/supplier/portalProblem';

interface Shared {
  title: string; kind_label: string; generated_at: string | null; approved_at: string | null; expires_at: string;
  content_hash: string; content: ReportContent;
}

export default function ExaminerReportPage() {
  const { token } = useParams<{ token: string }>();
  const [report, setReport] = useState<Shared | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get(`/vendor-risk/tpra/examiner/${encodeURIComponent(token)}`)
      .then((res) => setReport(res.data as Shared))
      .catch((e) => setProblem(kindOf(e) === 'gone'
        ? 'This link is not valid. It may have expired or been withdrawn by the organisation that shared it.'
        : problemText(e, 'The report could not be loaded. Check your connection and try again.')));
  }, [token]);

  return (
    <main className="min-h-screen bg-ds-surface-subtle px-4 py-6 print:bg-ds-surface">
      <div className="mx-auto max-w-6xl space-y-4">
        {problem ? (
          <div role="alert" className="mx-auto mt-16 max-w-md rounded-xl border border-ds-border bg-ds-surface p-6 text-center">
            <Lock className="mx-auto mb-2 h-6 w-6 text-ds-fg-muted" />
            <p className="text-sm text-ds-fg-body">{problem}</p>
          </div>
        ) : !report ? (
          <p className="mt-16 flex items-center justify-center gap-2 text-sm text-ds-fg-muted"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ds-border bg-ds-surface px-3 py-2 text-xs text-ds-fg-muted print:border-0 print:px-0">
              <span>
                <Lock className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
                Shared read-only. {report.kind_label}, generated {fmtDay(report.generated_at)}, approved {fmtDay(report.approved_at)}.
                This link works until {fmtDay(report.expires_at)}.
              </span>
              <button type="button" onClick={() => window.print()}
                className="inline-flex items-center gap-1 rounded-md border border-ds-border-control px-2 py-1 font-medium text-ds-fg-body print:hidden">
                <Printer className="h-3.5 w-3.5" /> Print or save as PDF
              </button>
            </div>
            <ReportView content={report.content} />
          </>
        )}
      </div>
    </main>
  );
}
