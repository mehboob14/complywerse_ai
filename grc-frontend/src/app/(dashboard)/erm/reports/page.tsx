'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ermApi } from '@/lib/api';
import { Download, Loader2 } from 'lucide-react';
import { PageLoader } from '@/components/ui';
import { ErrorState } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { useReportedMutation } from '@/components/ui/ds/useReportedMutation';
import CommitteePacks from './CommitteePacks';

const TABS = [
  { key: 'packs', label: 'Committee packs' },
  { key: 'executive', label: 'Executive Report' },
  { key: 'board', label: 'Board Report' },
  { key: 'category', label: 'Category Report' },
  { key: 'audit', label: 'Audit Report' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

const CARD = 'rounded-xl border border-slate-200 bg-white p-4';
const score = (value: unknown) => (typeof value === 'number' ? value : '—');

function Tile({ label, value, tone = 'text-slate-900' }: { label: string; value: number; tone?: string }) {
  return (
    <div className={CARD}>
      <p className="text-sm text-slate-600">{label}</p>
      <p className={`text-3xl font-bold ${tone}`}>{value}</p>
    </div>
  );
}

export default function ReportsPage() {
  const [tab, setTab] = useState<TabKey>('packs');

  const executiveQ = useQuery({
    queryKey: ['erm-executive-dashboard'],
    queryFn: async () => (await ermApi.reports.getExecutiveDashboard()).data,
    enabled: tab === 'executive',
  });
  const boardQ = useQuery({
    queryKey: ['erm-board-summary'],
    queryFn: async () => (await ermApi.reports.getBoardSummary()).data,
    enabled: tab === 'board',
  });
  const categoryQ = useQuery({
    queryKey: ['erm-aggregated-view'],
    queryFn: async () => (await ermApi.reports.getAggregatedView('category')).data,
    enabled: tab === 'category',
  });
  const toleranceQ = useQuery({
    queryKey: ['erm-tolerance-breaches'],
    queryFn: async () => (await ermApi.reports.getToleranceBreaches()).data,
    enabled: tab === 'audit',
  });

  const exportMutation = useReportedMutation({
    mutationFn: async () => {
      const { data } = await ermApi.reports.getAuditExport();
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `erm-audit-export-${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      URL.revokeObjectURL(url);
    },
    success: 'Audit export downloaded',
    failure: "Couldn't download the audit export",
  });

  if (executiveQ.isLoading || boardQ.isLoading) {
    return <PageLoader className="h-64" />;
  }

  const executive = executiveQ.data;
  const board = boardQ.data;

  return (
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6">
      <div>
        <h2 className="text-lg sm:text-xl font-semibold text-slate-900">Reports & Committee Packs</h2>
        <p className="text-sm text-slate-600">Committee packs keep the numbers as they were when built; the other reports read the register live</p>
      </div>

      <div className="border-b border-slate-200">
        <nav className="-mb-px flex flex-wrap gap-x-6">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors ${
                tab === key
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'packs' && <CommitteePacks />}

      {tab === 'executive' && (executiveQ.isError || !executive ? (
        <ErrorState title="Couldn't load the executive report" message={errorMessage(executiveQ.error)} onRetry={() => { void executiveQ.refetch(); }} />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Tile label="Total Risks" value={executive.total_risks} />
            <Tile label="Critical Risks" value={executive.risks_by_score_band.critical ?? 0} tone="text-rose-600" />
            <Tile label="High Risks" value={executive.risks_by_score_band.high ?? 0} tone="text-orange-600" />
            <Tile label="Appetite Breaches" value={executive.appetite_breaches.length} tone="text-orange-600" />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className={CARD}>
              <h3 className="font-medium text-slate-900">Top Risks</h3>
              <div className="mt-4 space-y-3">
                {executive.top_risks.length === 0 && <p className="text-sm text-slate-500">No risks recorded</p>}
                {executive.top_risks.slice(0, 5).map((risk) => (
                  <div key={risk.id} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-slate-700">{risk.title}</span>
                    <span className="font-medium text-slate-900">{score(risk.score)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className={CARD}>
              <h3 className="font-medium text-slate-900">KRI Alerts</h3>
              <div className="mt-4 space-y-3">
                {executive.kri_alerts.length === 0 && <p className="text-sm text-slate-500">No KRI is amber or red</p>}
                {executive.kri_alerts.slice(0, 5).map((alert) => (
                  <div key={alert.kri_id} className="flex items-center justify-between gap-3">
                    <span className="text-sm text-slate-700">{alert.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${
                      alert.status === 'red' ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'
                    }`}>
                      {alert.value} ({alert.status})
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ))}

      {tab === 'board' && (boardQ.isError || !board ? (
        <ErrorState title="Couldn't load the board report" message={errorMessage(boardQ.error)} onRetry={() => { void boardQ.refetch(); }} />
      ) : (
        <div className="space-y-6">
          <div className={CARD}>
            <h3 className="font-medium text-slate-900">Risk Profile Summary</h3>
            <p className="text-sm text-slate-600">Period: {board.report_period}</p>
            <p className="mt-2 text-sm text-slate-700">{board.executive_summary}</p>

            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-sm text-slate-600">Total Risks</p>
                <p className="text-2xl font-bold text-slate-900">{board.risk_overview.total_risks}</p>
              </div>
              <div>
                <p className="text-sm text-slate-600">Open Risks</p>
                <p className="text-2xl font-bold text-amber-600">{board.risk_overview.by_status.open ?? 0}</p>
              </div>
              <div>
                <p className="text-sm text-slate-600">Open Incidents</p>
                <p className="text-2xl font-bold text-rose-600">{board.incidents_summary.open_incidents}</p>
              </div>
            </div>
          </div>

          <div className={CARD}>
            <h3 className="font-medium text-slate-900">Appetite by Category</h3>
            <div className="mt-4 space-y-3">
              {board.appetite_status.length === 0 && <p className="text-sm text-slate-500">No risks recorded</p>}
              {board.appetite_status.map((row) => (
                <div key={row.category ?? 'uncategorized'} className="flex flex-wrap items-center justify-between gap-3 text-sm">
                  <span className="font-medium capitalize text-slate-900">{row.category ?? 'Uncategorized'}</span>
                  <span className="text-slate-600">
                    {row.total_risks} risks · {row.breaching_appetite} over appetite · appetite {row.appetite_level}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className={CARD}>
            <h3 className="font-medium text-slate-900">Top Risks</h3>
            <div className="mt-4 space-y-3">
              {board.top_risks.length === 0 && <p className="text-sm text-slate-500">No risks recorded</p>}
              {board.top_risks.map((risk) => (
                <div key={risk.id}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-slate-700">{risk.title}</span>
                    <span className="font-medium text-slate-900">{score(risk.score)}</span>
                  </div>
                  {risk.treatment_plan && <p className="mt-1 text-xs text-slate-500">Treatment: {risk.treatment_plan}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}

      {tab === 'category' && (categoryQ.isError ? (
        <ErrorState title="Couldn't load the category report" message={errorMessage(categoryQ.error)} onRetry={() => { void categoryQ.refetch(); }} />
      ) : (
        <div className={CARD}>
          <h3 className="font-medium text-slate-900">Risk by Category</h3>
          <div className="mt-4 space-y-4">
            {categoryQ.isLoading && <p className="text-sm text-slate-500">Loading…</p>}
            {categoryQ.data?.length === 0 && <p className="text-sm text-slate-500">No risks recorded</p>}
            {categoryQ.data?.map((view) => (
              <div key={view.group_value} className="rounded-lg bg-white p-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium capitalize text-slate-900">{view.group_value}</span>
                  <span className="text-sm text-slate-600">{view.total_risks} risks</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-slate-600">Avg Inherent: </span>
                    <span className="text-slate-900">{view.avg_inherent_score.toFixed(1)}</span>
                  </div>
                  <div>
                    <span className="text-slate-600">Avg Residual: </span>
                    <span className="text-slate-900">{view.avg_residual_score.toFixed(1)}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {tab === 'audit' && (
        <div className="space-y-6">
          <div className={CARD}>
            <h3 className="font-medium text-slate-900">Risks Over Tolerance</h3>
            {toleranceQ.isError ? (
              <div className="mt-4"><ErrorState compact title="Couldn't load the risks over tolerance" message={errorMessage(toleranceQ.error)} onRetry={() => { void toleranceQ.refetch(); }} /></div>
            ) : toleranceQ.isLoading ? (
              <p className="mt-4 text-sm text-slate-500">Loading…</p>
            ) : toleranceQ.data && toleranceQ.data.breaches.length > 0 ? (
              <div className="mt-4 space-y-3">
                {toleranceQ.data.breaches.map((breach) => (
                  <div key={breach.risk_id} className="flex items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 p-3">
                    <div>
                      <p className="font-medium text-slate-900">{breach.risk_title}</p>
                      <p className="text-sm text-slate-600">{breach.category}</p>
                    </div>
                    <p className="whitespace-nowrap text-rose-600">{breach.current_score} against tolerance {breach.tolerance}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-600">No risk is over its tolerance</p>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => exportMutation.mutate()}
              disabled={exportMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-[#0a0a0a] hover:bg-primary-700"
            >
              {exportMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Download Audit Export (JSON)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
