'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Coins,
  MessageSquare,
  RefreshCw,
  Sparkles,
  Zap,
} from 'lucide-react';
import { adminApi } from '@/lib/api';
import { PageLoader } from '@/components/ui';

type PeriodKey = '7d' | '30d' | '90d';

function periodRange(key: PeriodKey): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end);
  const days = key === '7d' ? 7 : key === '90d' ? 90 : 30;
  start.setDate(start.getDate() - days);
  return { start: start.toISOString(), end: end.toISOString() };
}

function fmtTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtUsd(n: number) {
  if (n < 0.01 && n > 0) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function fmtWhen(iso?: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatusPill({ status }: { status: string }) {
  const s = (status || '').toLowerCase();
  const ok = s === 'success' || s === 'completed';
  const bad = s === 'error' || s === 'failed';
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
        ok
          ? 'bg-emerald-50 text-emerald-700'
          : bad
            ? 'bg-rose-50 text-rose-700'
            : 'bg-slate-100 text-slate-600'
      }`}
    >
      {ok ? 'Succeeded' : bad ? 'Failed' : status || 'Unknown'}
    </span>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  if (value == null) {
    return (
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
        <p className="mt-1 text-sm text-slate-400">None recorded</p>
      </div>
    );
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <pre className="mt-1 max-h-72 overflow-auto rounded-md border border-slate-200 bg-slate-50 p-3 text-[12px] leading-relaxed text-slate-700 whitespace-pre-wrap break-words">
        {text}
      </pre>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: typeof Activity;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
          {hint && <p className="mt-1 text-[12px] text-slate-500">{hint}</p>}
        </div>
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-50 text-slate-500">
          <Icon size={18} />
        </span>
      </div>
    </div>
  );
}

export default function UsageMonitoringPage() {
  const [period, setPeriod] = useState<PeriodKey>('30d');
  const [view, setView] = useState<'overview' | 'detail'>('overview');
  const [expanded, setExpanded] = useState<string | null>(null);
  const range = useMemo(() => periodRange(period), [period]);

  const overviewQ = useQuery({
    queryKey: ['admin', 'ai-usage', 'overview', range.start, range.end],
    queryFn: async () => (await adminApi.getAiUsageOverview(range)).data,
  });

  const runsQ = useQuery({
    queryKey: ['admin', 'ai-usage', 'runs', range.start, range.end],
    queryFn: async () => (await adminApi.getAiUsageRuns({ ...range, limit: 50 })).data,
    enabled: view === 'detail',
  });

  const overview = overviewQ.data;
  const loading = overviewQ.isLoading;

  return (
    <div className="mx-auto max-w-6xl space-y-5 px-1 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Usage Monitoring</h1>
          <p className="mt-1 text-sm text-slate-500">
            Track how this organization uses AI — tokens, cost estimates, and where they were spent.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
            {([
              ['7d', 'Last 7 days'],
              ['30d', 'Last 30 days'],
              ['90d', 'Last 90 days'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setPeriod(key)}
                className={`rounded-md px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  period === key ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              overviewQ.refetch();
              if (view === 'detail') runsQ.refetch();
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-medium text-slate-600 hover:bg-slate-50"
          >
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
        <button
          type="button"
          onClick={() => setView('overview')}
          className={`rounded-md px-3 py-1.5 text-[12px] font-medium ${
            view === 'overview' ? 'bg-teal-50 text-teal-800' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          Simple overview
        </button>
        <button
          type="button"
          onClick={() => setView('detail')}
          className={`rounded-md px-3 py-1.5 text-[12px] font-medium ${
            view === 'detail' ? 'bg-teal-50 text-teal-800' : 'text-slate-600 hover:bg-slate-50'
          }`}
        >
          Detailed activity
        </button>
      </div>

      {loading && <PageLoader label="Loading usage…" />}

      {!loading && overview && !overview.configured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
          <div className="flex items-start gap-2">
            <AlertCircle size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold">LangSmith is not configured yet</p>
              <p className="mt-1 text-amber-800/90">
                {overview.message ||
                  'Add LANGSMITH_API_KEY on the backend to start collecting AI usage for this tenant.'}
              </p>
            </div>
          </div>
        </div>
      )}

      {!loading && overview && overview.configured && view === 'overview' && (
        <>
          {overview.plain_english && (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 leading-relaxed">
              <span className="mr-2 inline-flex items-center gap-1 rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-700">
                <Sparkles size={12} /> At a glance
              </span>
              {overview.plain_english}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="AI uses"
              value={String(overview.summary.total_runs)}
              hint={`${overview.summary.successful_runs} succeeded · ${overview.summary.failed_runs} failed`}
              icon={MessageSquare}
            />
            <StatCard
              label="Tokens used"
              value={fmtTokens(overview.summary.total_tokens)}
              hint={`${fmtTokens(overview.summary.prompt_tokens)} in · ${fmtTokens(overview.summary.completion_tokens)} out`}
              icon={Zap}
            />
            <StatCard
              label="Est. cost"
              value={fmtUsd(overview.summary.estimated_cost_usd)}
              hint="Approximate — based on model rates"
              icon={Coins}
            />
            <StatCard
              label="Avg. response time"
              value={
                overview.summary.avg_latency_ms != null
                  ? `${(overview.summary.avg_latency_ms / 1000).toFixed(1)}s`
                  : '—'
              }
              hint={overview.project ? `Project: ${overview.project}` : undefined}
              icon={Activity}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-slate-900">Where AI was used</h2>
              <p className="mt-0.5 text-[12px] text-slate-500">Features that consumed tokens in this period</p>
              <div className="mt-3 space-y-2">
                {(overview.by_feature || []).length === 0 && (
                  <p className="text-sm text-slate-400">No activity yet for this tenant.</p>
                )}
                {(overview.by_feature || []).map((row) => {
                  const max = Math.max(...overview.by_feature.map((r) => r.total_tokens), 1);
                  const pct = Math.round((row.total_tokens / max) * 100);
                  return (
                    <div key={row.feature}>
                      <div className="flex items-center justify-between text-[12px]">
                        <span className="font-medium text-slate-700">{row.feature}</span>
                        <span className="text-slate-500">
                          {row.runs} uses · {fmtTokens(row.total_tokens)} · {fmtUsd(row.estimated_cost_usd)}
                        </span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-teal-500/80" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-slate-900">Daily activity</h2>
              <p className="mt-0.5 text-[12px] text-slate-500">Token volume by day</p>
              <div className="mt-4 flex h-36 items-end gap-1">
                {(overview.by_day || []).length === 0 && (
                  <p className="self-center text-sm text-slate-400">No daily data yet.</p>
                )}
                {(overview.by_day || []).map((d) => {
                  const max = Math.max(...overview.by_day.map((x) => x.total_tokens), 1);
                  const h = Math.max(4, Math.round((d.total_tokens / max) * 100));
                  return (
                    <div key={d.date} className="flex flex-1 flex-col items-center gap-1" title={`${d.date}: ${fmtTokens(d.total_tokens)} tokens`}>
                      <div className="w-full rounded-t bg-teal-500/70" style={{ height: `${h}%` }} />
                      <span className="text-[9px] text-slate-400">{d.date.slice(5)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Recent activity</h2>
              <button
                type="button"
                onClick={() => setView('detail')}
                className="text-[12px] font-medium text-teal-700 hover:underline"
              >
                View full detail →
              </button>
            </div>
            <div className="mt-3 divide-y divide-slate-100">
              {(overview.recent || []).length === 0 && (
                <p className="py-4 text-sm text-slate-400">No recent AI runs for this tenant.</p>
              )}
              {(overview.recent || []).map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[13px]">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800 truncate">{r.feature}</p>
                    <p className="text-[11px] text-slate-400">{fmtWhen(r.started_at)}</p>
                  </div>
                  <div className="flex items-center gap-3 text-[12px] text-slate-600">
                    <StatusPill status={r.status} />
                    <span>{fmtTokens(r.total_tokens)} tokens</span>
                    <span>{fmtUsd(r.estimated_cost_usd)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {!loading && overview?.configured && view === 'detail' && (
        <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-900">End-to-end AI runs</h2>
            <p className="text-[12px] text-slate-500">
              Expand a row to inspect inputs, outputs, tokens, and metadata from LangSmith.
            </p>
          </div>

          {runsQ.isLoading && (
            <div className="p-6">
              <PageLoader label="Loading runs…" />
            </div>
          )}

          {runsQ.data && (runsQ.data.runs || []).length === 0 && (
            <p className="p-6 text-sm text-slate-400">No detailed runs found for this period.</p>
          )}

          <ul className="divide-y divide-slate-100">
            {(runsQ.data?.runs || []).map((run) => {
              const open = expanded === run.id;
              return (
                <li key={run.id}>
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : run.id)}
                    className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50/80"
                  >
                    <span className="mt-0.5 text-slate-400">
                      {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-semibold text-slate-900">{run.feature}</span>
                        <StatusPill status={run.status} />
                        <span className="text-[11px] text-slate-400 font-mono truncate">{run.name}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-slate-500">
                        <span>{fmtWhen(run.started_at)}</span>
                        <span>
                          In {fmtTokens(run.prompt_tokens)} · Out {fmtTokens(run.completion_tokens)} · Total{' '}
                          {fmtTokens(run.total_tokens)}
                        </span>
                        <span>{fmtUsd(run.estimated_cost_usd)}</span>
                        {run.latency_ms != null && <span>{(run.latency_ms / 1000).toFixed(1)}s</span>}
                      </div>
                    </div>
                  </button>
                  {open && (
                    <div className="space-y-4 border-t border-slate-100 bg-slate-50/50 px-4 py-4 sm:px-10">
                      {run.error && (
                        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-800">
                          {run.error}
                        </div>
                      )}
                      <div className="grid gap-4 lg:grid-cols-2">
                        <JsonBlock label="Input" value={run.inputs} />
                        <JsonBlock label="Output" value={run.outputs} />
                      </div>
                      {(run.tags?.length > 0 || Object.keys(run.metadata || {}).length > 0) && (
                        <div className="grid gap-4 sm:grid-cols-2 text-[12px]">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Tags</p>
                            <p className="mt-1 text-slate-600">{(run.tags || []).join(', ') || '—'}</p>
                          </div>
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Metadata</p>
                            <pre className="mt-1 text-slate-600 whitespace-pre-wrap">
                              {JSON.stringify(run.metadata || {}, null, 2)}
                            </pre>
                          </div>
                        </div>
                      )}
                      <p className="text-[11px] text-slate-400 font-mono">Run ID: {run.id}</p>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
