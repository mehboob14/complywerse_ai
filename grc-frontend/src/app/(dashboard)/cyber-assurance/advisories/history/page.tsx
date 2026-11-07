'use client';

// Match history as its own full page (not a popup). Lists every saved match run;
// open one to see its full report inline, or download it.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { advisoriesApi } from '@/cyber-assurance/lib/api';
import { MatchHistory, MatchReport, MatchReportData } from '../_components/ui';

export default function MatchHistoryPage() {
  const router = useRouter();
  const [report, setReport] = useState<MatchReportData | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [title, setTitle] = useState('Match report');

  const openSession = async (id: number) => {
    try {
      const res = await advisoriesApi.getMatchSession(id);
      setReport(res.data.report as MatchReportData);
      setSessionId(id);
      setTitle(res.data.label || `Match #${id}`);
    } catch { /* ignore */ }
  };

  const downloadReport = async (fmt: 'csv' | 'json') => {
    if (sessionId === null) return;
    try {
      const res = await advisoriesApi.downloadMatchSession(sessionId, fmt);
      const url = URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url; a.download = `match-session-${sessionId}.${fmt}`; a.click();
      URL.revokeObjectURL(url);
    } catch { /* ignore */ }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-3">
      <button onClick={() => router.push('/cyber-assurance/advisories')}
        className="flex items-center gap-1.5 text-sm cw-text-muted hover:cw-text-default">
        <ArrowLeft size={16} /> Advisories
      </button>
      <div className="cw-card p-3">
        {report ? (
          <MatchReport report={report} title={title} onBack={() => setReport(null)}
            onDownload={sessionId !== null ? downloadReport : undefined} />
        ) : (
          <MatchHistory onOpen={openSession} onBack={() => router.push('/cyber-assurance/advisories')} />
        )}
      </div>
    </div>
  );
}
