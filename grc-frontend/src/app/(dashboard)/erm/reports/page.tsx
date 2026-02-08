'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ermApi } from '@/lib/api';
import { ReportType } from '@/types';
import {
  FileText,
  Loader2,
  Download,
  TrendingUp,
  TrendingDown,
  ArrowRight,
} from 'lucide-react';

export default function ReportsPage() {
  const [selectedReportType, setSelectedReportType] = useState<ReportType>('executive');
  const queryClient = useQueryClient();

  const { data: executiveDashboard, isLoading: loadingExec } = useQuery({
    queryKey: ['erm-executive-dashboard'],
    queryFn: async () => {
      const response = await ermApi.reports.getExecutiveDashboard();
      return response.data;
    },
  });

  const { data: boardSummary, isLoading: loadingBoard } = useQuery({
    queryKey: ['erm-board-summary'],
    queryFn: async () => {
      const response = await ermApi.reports.getBoardSummary();
      return response.data;
    },
  });

  const { data: aggregatedView } = useQuery({
    queryKey: ['erm-aggregated-view'],
    queryFn: async () => {
      const response = await ermApi.reports.getAggregatedView('category');
      return response.data;
    },
  });

  const { data: appetiteBreaches } = useQuery({
    queryKey: ['erm-appetite-breaches'],
    queryFn: async () => {
      const response = await ermApi.reports.getAppetiteBreaches();
      return response.data;
    },
  });

  const { data: trends } = useQuery({
    queryKey: ['erm-risk-trends'],
    queryFn: async () => {
      const response = await ermApi.reports.getRiskTrends(90);
      return response.data;
    },
  });

  const generateMutation = useMutation({
    mutationFn: (data: { name: string; report_type: ReportType }) =>
      ermApi.reports.generate(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['erm-reports'] });
    },
  });

  const isLoading = loadingExec || loadingBoard;

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Reports & Analytics</h2>
        <p className="text-sm text-slate-400">Generate risk reports and view analytics</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['executive', 'board', 'department', 'audit'] as ReportType[]).map((type) => (
          <button
            key={type}
            onClick={() => setSelectedReportType(type)}
            className={`rounded-lg px-4 py-2 text-sm capitalize ${
              selectedReportType === type
                ? 'bg-primary-600 text-white'
                : 'bg-slate-200 text-slate-600 hover:bg-slate-600'
            }`}
          >
            {type} Report
          </button>
        ))}
      </div>

      {selectedReportType === 'executive' && executiveDashboard && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-400">Total Risks</p>
              <p className="text-3xl font-bold text-slate-800">{executiveDashboard.summary?.total_risks || 0}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-400">Critical Risks</p>
              <p className="text-3xl font-bold text-red-400">{executiveDashboard.summary?.critical_risks || 0}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-400">Avg Risk Score</p>
              <p className="text-3xl font-bold text-slate-800">{executiveDashboard.summary?.avg_risk_score?.toFixed(1) || 0}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <p className="text-sm text-slate-400">Appetite Breaches</p>
              <p className="text-3xl font-bold text-orange-400">{executiveDashboard.summary?.risks_exceeding_appetite || 0}</p>
            </div>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="font-medium text-slate-800">Top Risks</h3>
              <div className="mt-4 space-y-3">
                {executiveDashboard.top_risks?.slice(0, 5).map((risk) => (
                  <div key={risk.id} className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">{risk.title}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-800">{risk.score}</span>
                      {risk.trend === 'up' ? (
                        <TrendingUp className="h-4 w-4 text-red-400" />
                      ) : risk.trend === 'down' ? (
                        <TrendingDown className="h-4 w-4 text-green-400" />
                      ) : null}
                    </div>
                  </div>
                )) || <p className="text-sm text-slate-500">No risks available</p>}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="font-medium text-slate-800">KRI Alerts</h3>
              <div className="mt-4 space-y-3">
                {executiveDashboard.kri_alerts?.slice(0, 5).map((alert) => (
                  <div key={alert.id} className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">{alert.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${
                      alert.status === 'red' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
                    }`}>
                      {alert.value} ({alert.status})
                    </span>
                  </div>
                )) || <p className="text-sm text-slate-500">No alerts</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedReportType === 'board' && boardSummary && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="font-medium text-slate-800">Risk Profile Summary</h3>
            <p className="text-sm text-slate-400">Period: {boardSummary.period || 'Current Quarter'}</p>
            
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-sm text-slate-400">Total Risks</p>
                <p className="text-2xl font-bold text-slate-800">{boardSummary.risk_profile_summary?.total_risks || 0}</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">New Risks</p>
                <p className="text-2xl font-bold text-yellow-400">{boardSummary.risk_profile_summary?.new_risks || 0}</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">Closed Risks</p>
                <p className="text-2xl font-bold text-green-400">{boardSummary.risk_profile_summary?.closed_risks || 0}</p>
              </div>
            </div>
          </div>

          {boardSummary.key_risk_changes && boardSummary.key_risk_changes.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h3 className="font-medium text-slate-800">Key Risk Changes</h3>
              <div className="mt-4 space-y-3">
                {boardSummary.key_risk_changes.map((change) => (
                  <div key={change.risk_id} className="flex items-center justify-between">
                    <span className="text-sm text-slate-600">{change.title}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500">{change.previous_score}</span>
                      <ArrowRight className="h-4 w-4 text-slate-500" />
                      <span className={change.change > 0 ? 'text-red-400' : 'text-green-400'}>
                        {change.current_score}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {selectedReportType === 'department' && aggregatedView && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="font-medium text-slate-800">Risk by Category</h3>
            <div className="mt-4 space-y-4">
              {aggregatedView.map((view) => (
                <div key={view.category} className="rounded-lg bg-slate-50 p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium capitalize text-slate-800">{view.category}</span>
                    <span className="text-sm text-slate-400">{view.total_count} risks</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-slate-400">Avg Inherent: </span>
                      <span className="text-slate-800">{view.avg_inherent_score?.toFixed(1) || 0}</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Avg Residual: </span>
                      <span className="text-slate-800">{view.avg_residual_score?.toFixed(1) || 0}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {selectedReportType === 'audit' && (
        <div className="space-y-6">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="font-medium text-slate-800">Appetite Breaches</h3>
            {appetiteBreaches && appetiteBreaches.length > 0 ? (
              <div className="mt-4 space-y-3">
                {appetiteBreaches.map((breach) => (
                  <div key={breach.risk_id} className="flex items-center justify-between rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                    <div>
                      <p className="font-medium text-slate-800">{breach.risk_title}</p>
                      <p className="text-sm text-slate-400">{breach.category}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-red-400">+{breach.breach_percentage.toFixed(0)}% over appetite</p>
                      <p className="text-xs text-slate-500">{breach.days_in_breach} days in breach</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 text-sm text-slate-400">No appetite breaches detected</p>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => generateMutation.mutate({ name: `Audit Export ${new Date().toISOString().split('T')[0]}`, report_type: 'audit' })}
              disabled={generateMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-500"
            >
              {generateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Export Audit Report
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
