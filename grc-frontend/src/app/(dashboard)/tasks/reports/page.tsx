'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { criticalTasksApi } from '@/lib/api';
import {
  Target,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Users,
  Loader2,
  TrendingUp,
  Sparkles,
  X,
  Scale,
} from 'lucide-react';

interface TrendEntry {
  month: string;
  created: number;
  completed: number;
}

interface SourceCompletion {
  total: number;
  completed: number;
  rate: number;
}

interface ReportSummary {
  total: number;
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  by_source: Record<string, number>;
  by_category: Record<string, number>;
  overdue: number;
  overdue_aging: Record<string, number>;
  completion_rate: number;
  sla_compliance: number;
  owner_workload: Record<string, number>;
  completion_by_source: Record<string, SourceCompletion>;
  trend_data: TrendEntry[];
}

const PRIORITY_COLORS: Record<string, string> = {
  Critical: 'bg-rose-500',
  High: 'bg-orange-500',
  Medium: 'bg-amber-500',
  Low: 'bg-emerald-500',
};

const STATUS_BAR_COLORS: Record<string, string> = {
  Open: 'bg-slate-400',
  'In Progress': 'bg-amber-500',
  'Under Review': 'bg-primary-500',
  Completed: 'bg-emerald-500',
  Verified: 'bg-emerald-500',
  Reopened: 'bg-rose-500',
};

export default function TaskReportsPage() {
  const [escalationPredictions, setEscalationPredictions] = useState<Record<string, unknown> | null>(null);
  const [workloadSuggestions, setWorkloadSuggestions] = useState<Record<string, unknown> | null>(null);
  const [aiLoading, setAiLoading] = useState<string | null>(null);

  const { data: report, isLoading } = useQuery<ReportSummary>({
    queryKey: ['task-reports'],
    queryFn: async () => {
      const res = await criticalTasksApi.reportsSummary();
      return res.data;
    },
  });

  const handlePredictEscalations = async () => {
    setAiLoading('escalations');
    try {
      const res = await criticalTasksApi.aiPredictEscalations();
      setEscalationPredictions(res.data);
    } catch {
      /* handled */
    }
    setAiLoading(null);
  };

  const handleBalanceWorkload = async () => {
    setAiLoading('workload');
    try {
      const res = await criticalTasksApi.aiBalanceWorkload();
      setWorkloadSuggestions(res.data);
    } catch {
      /* handled */
    }
    setAiLoading(null);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  if (!report) {
    return <div className="text-center py-20 text-[var(--color-muted)]">No report data available</div>;
  }

  const maxTrend = Math.max(
    ...report.trend_data.map(t => Math.max(t.created, t.completed)),
    1
  );

  const activeCount = report.total - (report.by_status?.Completed || 0) - (report.by_status?.Verified || 0);

  return (
    <div className="space-y-4 sm:space-y-6 text-[var(--color-text)]">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900 tracking-tight">Task Reports</h1>
          <p className="mt-1 text-sm text-slate-600">
            Analytics and insights for critical task management
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handlePredictEscalations}
            disabled={aiLoading === 'escalations'}
            className="flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm font-medium text-primary-700 hover:bg-primary-100 transition-colors disabled:opacity-50"
          >
            {aiLoading === 'escalations' ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />}
            Predict Escalations
          </button>
          <button
            onClick={handleBalanceWorkload}
            disabled={aiLoading === 'workload'}
            className="flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-3 py-2 text-sm font-medium text-primary-700 hover:bg-primary-100 transition-colors disabled:opacity-50"
          >
            {aiLoading === 'workload' ? <Loader2 className="animate-spin" size={14} /> : <Scale size={14} />}
            Balance Workload
          </button>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-4">
        <div className="cw-card p-4">
          <div className="flex items-center gap-2 text-[var(--color-muted)] mb-2">
            <Target size={16} />
            <span className="text-xs font-medium uppercase tracking-wider">Total Tasks</span>
          </div>
          <div className="text-2xl font-semibold text-[var(--color-text)]">{report.total}</div>
        </div>
        <div className="cw-card p-4 border-rose-200 bg-rose-50">
          <div className="flex items-center gap-2 text-rose-600 mb-2">
            <AlertTriangle size={16} />
            <span className="text-xs font-medium uppercase tracking-wider">Overdue</span>
          </div>
          <div className="text-2xl font-semibold text-rose-600">{report.overdue}</div>
        </div>
        <div className="cw-card p-4 border-emerald-200 bg-emerald-50">
          <div className="flex items-center gap-2 text-emerald-600 mb-2">
            <CheckCircle2 size={16} />
            <span className="text-xs font-medium uppercase tracking-wider">Completion</span>
          </div>
          <div className="text-2xl font-semibold text-emerald-600">{report.completion_rate}%</div>
        </div>
        <div className="cw-card p-4 border-primary-200 bg-primary-50">
          <div className="flex items-center gap-2 text-primary-700 mb-2">
            <Clock size={16} />
            <span className="text-xs font-medium uppercase tracking-wider">SLA Compliance</span>
          </div>
          <div className="text-2xl font-semibold text-primary-700">{report.sla_compliance}%</div>
        </div>
        <div className="cw-card p-4 border-amber-200 bg-amber-50">
          <div className="flex items-center gap-2 text-amber-600 mb-2">
            <TrendingUp size={16} />
            <span className="text-xs font-medium uppercase tracking-wider">Active</span>
          </div>
          <div className="text-2xl font-semibold text-amber-600">{activeCount}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="cw-card p-6">
          <h2 className="text-sm font-semibold text-[var(--color-text)] mb-4">Tasks by Status</h2>
          <div className="space-y-3">
            {Object.entries(report.by_status || {}).map(([status, count]) => (
              <div key={status}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-[var(--color-text)]">{status}</span>
                  <span className="text-[var(--color-muted)]">{count}</span>
                </div>
                <div className="h-2 rounded-full bg-[var(--color-subtle)] overflow-hidden">
                  <div
                    className={`h-full rounded-full ${STATUS_BAR_COLORS[status] || 'bg-slate-500'}`}
                    style={{ width: `${report.total > 0 ? (count / report.total * 100) : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="cw-card p-6">
          <h2 className="text-sm font-semibold text-[var(--color-text)] mb-4">Tasks by Priority</h2>
          <div className="space-y-3">
            {Object.entries(report.by_priority || {}).map(([priority, count]) => (
              <div key={priority}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-[var(--color-text)]">{priority}</span>
                  <span className="text-[var(--color-muted)]">{count}</span>
                </div>
                <div className="h-2 rounded-full bg-[var(--color-subtle)] overflow-hidden">
                  <div
                    className={`h-full rounded-full ${PRIORITY_COLORS[priority] || 'bg-slate-500'}`}
                    style={{ width: `${report.total > 0 ? (count / report.total * 100) : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="cw-card p-6">
          <h2 className="text-sm font-semibold text-[var(--color-text)] mb-4">Completion Rates by Source</h2>
          {Object.keys(report.completion_by_source || {}).length === 0 ? (
            <p className="text-sm text-[var(--color-muted)] text-center py-4">No data yet</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(report.completion_by_source || {}).map(([source, data]) => (
                <div key={source}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-[var(--color-text)]">{source}</span>
                    <span className="text-[var(--color-muted)]">{data.completed}/{data.total} ({data.rate}%)</span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--color-subtle)] overflow-hidden">
                    <div className="h-full rounded-full bg-primary-500" style={{ width: `${data.rate}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="cw-card p-6">
          <h2 className="text-sm font-semibold text-[var(--color-text)] mb-4">Overdue Aging Analysis</h2>
          {report.overdue === 0 ? (
            <div className="text-center py-4">
              <CheckCircle2 size={24} className="mx-auto text-emerald-600 mb-2" />
              <p className="text-sm text-emerald-600">No overdue tasks</p>
            </div>
          ) : (
            <div className="space-y-3">
              {Object.entries(report.overdue_aging || {}).map(([range, count]) => (
                <div key={range}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-[var(--color-text)]">{range}</span>
                    <span className="text-[var(--color-muted)]">{count}</span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--color-subtle)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-rose-500"
                      style={{ width: `${report.overdue > 0 ? (count / report.overdue * 100) : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="cw-card p-6">
        <h2 className="text-sm font-semibold text-[var(--color-text)] mb-4">Created vs Completed Trend (12 months)</h2>
        {report.trend_data?.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)] text-center py-4">No trend data</p>
        ) : (
          <div className="flex items-end gap-1 h-40">
            {report.trend_data.map((t, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex gap-0.5 items-end justify-center" style={{ height: '120px' }}>
                  <div
                    className="w-2 bg-primary-500 rounded-t"
                    style={{ height: `${maxTrend > 0 ? (t.created / maxTrend * 100) : 0}%`, minHeight: t.created > 0 ? '4px' : '0' }}
                    title={`Created: ${t.created}`}
                  />
                  <div
                    className="w-2 bg-emerald-500 rounded-t"
                    style={{ height: `${maxTrend > 0 ? (t.completed / maxTrend * 100) : 0}%`, minHeight: t.completed > 0 ? '4px' : '0' }}
                    title={`Completed: ${t.completed}`}
                  />
                </div>
                <span className="text-[9px] text-[var(--color-muted)] truncate w-full text-center">{t.month.split(' ')[0]}</span>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-center gap-6 mt-3 text-xs text-[var(--color-muted)]">
          <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-primary-500" /> Created</div>
          <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Completed</div>
        </div>
      </div>

      <div className="cw-card p-6">
        <h2 className="text-sm font-semibold text-[var(--color-text)] mb-4 flex items-center gap-2">
          <Users size={16} /> Owner Workload Distribution
        </h2>
        {Object.keys(report.owner_workload || {}).length === 0 ? (
          <p className="text-sm text-[var(--color-muted)] text-center py-4">No active task assignments</p>
        ) : (
          <div className="space-y-3">
            {Object.entries(report.owner_workload || {})
              .sort(([, a], [, b]) => b - a)
              .map(([name, count]) => {
                const max = Math.max(...Object.values(report.owner_workload).map(Number));
                return (
                  <div key={name}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-[var(--color-text)]">{name}</span>
                      <span className="text-[var(--color-muted)]">{count} active task{count !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="h-2 rounded-full bg-[var(--color-subtle)] overflow-hidden">
                      <div className="h-full rounded-full bg-primary-500" style={{ width: `${max > 0 ? (count / max * 100) : 0}%` }} />
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      <div className="cw-card p-6">
        <h2 className="text-sm font-semibold text-[var(--color-text)] mb-4">Tasks by Category</h2>
        {Object.keys(report.by_category || {}).length === 0 ? (
          <p className="text-sm text-[var(--color-muted)] text-center py-4">No data</p>
        ) : (
          <div className="grid grid-cols-5 gap-4">
            {Object.entries(report.by_category || {}).map(([cat, count]) => (
              <div key={cat} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-center">
                <div className="text-lg font-semibold text-[var(--color-text)]">{count}</div>
                <div className="text-xs text-[var(--color-muted)]">{cat}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {escalationPredictions && (
        <div className="rounded-xl border border-primary-200 bg-primary-50 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-primary-700 flex items-center gap-2">
              <Sparkles size={16} /> AI Escalation Predictions
            </h2>
            <button onClick={() => setEscalationPredictions(null)} className="text-[var(--color-muted)] hover:text-[var(--color-text)]"><X size={16} /></button>
          </div>
          {(escalationPredictions.predictions as Record<string, unknown>[])?.length === 0 ? (
            <p className="text-sm text-emerald-600 text-center py-4">No escalation risks detected.</p>
          ) : (
            <div className="space-y-3">
              {(escalationPredictions.predictions as Record<string, unknown>[])?.map((p: Record<string, unknown>, i: number) => (
                <div key={i} className="rounded-lg border border-[var(--color-border)] bg-white p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-[var(--color-text)]">{p.title as string}</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        (p.risk_score as number) >= 80 ? 'bg-rose-50 text-rose-700' :
                        (p.risk_score as number) >= 50 ? 'bg-amber-50 text-amber-700' :
                        'bg-emerald-50 text-emerald-700'
                      }`}>Risk: {p.risk_score as number}%</span>
                      <span className="text-xs text-[var(--color-muted)]">{p.confidence as number}% confidence</span>
                    </div>
                  </div>
                  {(p.predicted_breach_date as string) && (
                    <p className="text-xs text-rose-600 mb-2">Predicted breach: {new Date(p.predicted_breach_date as string).toLocaleDateString()}</p>
                  )}
                  {(p.risk_factors as string[])?.length > 0 && (
                    <div className="mb-2">
                      <span className="text-xs text-[var(--color-muted)]">Risk factors: </span>
                      <span className="text-xs text-[var(--color-muted)]">{(p.risk_factors as string[]).join(', ')}</span>
                    </div>
                  )}
                  {(p.recommended_actions as string[])?.length > 0 && (
                    <div>
                      <span className="text-xs text-[var(--color-muted)]">Actions: </span>
                      {(p.recommended_actions as string[]).map((a: string, j: number) => (
                        <span key={j} className="text-xs text-emerald-600">{j > 0 ? ' · ' : ''}{a}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {workloadSuggestions && (
        <div className="rounded-xl border border-primary-200 bg-primary-50 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-primary-700 flex items-center gap-2">
              <Scale size={16} /> AI Workload Rebalancing
            </h2>
            <button onClick={() => setWorkloadSuggestions(null)} className="text-[var(--color-muted)] hover:text-[var(--color-text)]"><X size={16} /></button>
          </div>
          {(workloadSuggestions.summary as string) && (
            <p className="text-sm text-[var(--color-text)] mb-4">{workloadSuggestions.summary as string}</p>
          )}
          {(workloadSuggestions.current_workload as Record<string, unknown>) && (
            <div className="mb-4">
              <h3 className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wider mb-2">Current Workload</h3>
              <div className="flex flex-wrap gap-2">
                {Object.entries(workloadSuggestions.current_workload as Record<string, unknown>).map(([name, val]) => {
                  const count = typeof val === 'number' ? val : (val as Record<string, unknown>)?.task_count ?? JSON.stringify(val);
                  const level = typeof val === 'object' && val !== null ? (val as Record<string, unknown>)?.load_level : null;
                  return (
                    <span key={name} className="text-xs bg-white border border-[var(--color-border)] rounded-lg px-2 py-1 text-[var(--color-muted)]">
                      {name}: <span className="font-medium text-[var(--color-text)]">{String(count)}</span>{level ? ` (${String(level)})` : ''}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
          {(workloadSuggestions.suggestions as Record<string, unknown>[])?.length === 0 ? (
            <p className="text-sm text-emerald-600 text-center py-2">Workload is well-balanced.</p>
          ) : (
            <div className="space-y-2">
              {(workloadSuggestions.suggestions as Record<string, unknown>[])?.map((s: Record<string, unknown>, i: number) => (
                <div key={i} className="rounded-lg border border-[var(--color-border)] bg-white p-3 flex items-center gap-3">
                  <span className="text-xs text-[var(--color-muted)] shrink-0">#{s.task_id as number}</span>
                  <span className="text-sm text-[var(--color-text)] flex-1">{s.task_title as string}</span>
                  <span className="text-xs text-rose-600">{s.current_owner as string}</span>
                  <span className="text-[var(--color-muted)]">→</span>
                  <span className="text-xs text-emerald-600">{s.suggested_owner as string}</span>
                  <span className="text-xs text-[var(--color-muted)] max-w-[200px] truncate">{s.reason as string}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center justify-end gap-3 mt-4 pt-4 border-t border-[var(--color-border)]">
            <button onClick={() => setWorkloadSuggestions(null)} className="cw-btn-secondary px-4 py-2 text-sm">
              Discard
            </button>
            {(workloadSuggestions.suggestions as Record<string, unknown>[])?.length > 0 && (
              <button
                onClick={async () => {
                  const suggestions = workloadSuggestions.suggestions as Record<string, unknown>[];
                  for (const s of suggestions) {
                    if (s.task_id && s.suggested_owner_id) {
                      try {
                        await criticalTasksApi.update(s.task_id as number, { assigned_owner_id: s.suggested_owner_id as number });
                      } catch {
                        /* skip failed updates */
                      }
                    }
                  }
                  setWorkloadSuggestions(null);
                }}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-[#0a0a0a] hover:bg-primary-700 transition-colors"
              >
                Apply Reassignments
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
