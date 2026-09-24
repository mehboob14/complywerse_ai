'use client';

// An examiner's read-only copy of an approved report. No login: the link is the
// key, it expires, and the organisation that shared it sees every view.

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, Lock, Printer } from 'lucide-react';
import apiClient from '@/lib/api';
import ReportView, { fmtDay, type ReportContent } from '@/components/vendor-risk/ReportView';

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
      .catch((e) => setProblem(e?.response?.status === 429
        ? 'Too many requests. Try again in a few minutes.'
        : 'This link is not valid. It may have expired or been withdrawn by the organisation that shared it.'));
  }, [token]);

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 print:bg-white">
      <div className="mx-auto max-w-6xl space-y-4">
        {problem ? (
          <div role="alert" className="mx-auto mt-16 max-w-md rounded-xl border border-gray-200 bg-white p-6 text-center">
            <Lock className="mx-auto mb-2 h-6 w-6 text-gray-400" />
            <p className="text-sm text-slate-700">{problem}</p>
          </div>
        ) : !report ? (
          <p className="mt-16 flex items-center justify-center gap-2 text-sm text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 print:border-0 print:px-0">
              <span>
                <Lock className="mr-1 inline h-3.5 w-3.5 align-text-bottom" />
                Shared read-only. {report.kind_label}, generated {fmtDay(report.generated_at)}, approved {fmtDay(report.approved_at)}.
                This link works until {fmtDay(report.expires_at)}. Fingerprint <span className="font-mono">{report.content_hash.slice(0, 12)}</span>.
              </span>
              <button type="button" onClick={() => window.print()}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1 font-medium text-slate-700 print:hidden">
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
