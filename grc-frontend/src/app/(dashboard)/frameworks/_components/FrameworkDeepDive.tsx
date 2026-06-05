'use client';

// FrameworkDeepDive
// ─────────────────────────────────────────────────────────────────────────
// Per-framework drill-down panel on /frameworks. Lets the operator pick ONE
// active journey and see deep KPIs (readiness, completion, evidence
// coverage), status mix, per-domain progress, and the live gap analysis —
// without having to leave the dashboard for the journey detail page.

import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ResponsiveContainer, RadialBarChart, RadialBar, PolarAngleAxis,
  PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import {
  Target, ShieldCheck, FileBadge, Calendar, AlertTriangle,
  CheckCircle2, Clock, FileSearch, Layers, ListChecks, ChevronDown,
  ChevronRight, Sparkles, ArrowUpRight, FileText, Activity,
} from 'lucide-react';
import { certificationsApi } from '@/lib/api';
import type { CertificationJourney, ProgressSummary, GapAnalysis } from '@/types';

// ─── Helpers ────────────────────────────────────────────────────────────
const STATUS_COLOR: Record<string, string> = {
  verified: '#10b981',
  implemented: '#22c55e',
  in_progress: '#3b82f6',
  not_started: '#94a3b8',
  not_applicable: '#cbd5e1',
};

const STATUS_LABEL: Record<string, string> = {
  verified: 'Verified',
  implemented: 'Implemented',
  in_progress: 'In Progress',
  not_started: 'Not Started',
  not_applicable: 'Not Applicable',
};

function toneFor(pct: number): { ring: string; text: string; bgFrom: string } {
  if (pct >= 75) return { ring: '#10b981', text: 'text-emerald-700', bgFrom: 'from-emerald-50' };
  if (pct >= 50) return { ring: '#3b82f6', text: 'text-blue-700', bgFrom: 'from-blue-50' };
  if (pct >= 25) return { ring: '#f59e0b', text: 'text-amber-700', bgFrom: 'from-amber-50' };
  return { ring: '#f43f5e', text: 'text-rose-700', bgFrom: 'from-rose-50' };
}

function resolveName(j: CertificationJourney): string {
  return j.framework?.name || j.framework_name || j.name || 'Untitled framework';
}

function daysFromNow(iso?: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

// ─── Mini Gauge ─────────────────────────────────────────────────────────
function MiniGauge({
  label, pct, icon: Icon, sublabel,
}: { label: string; pct: number; icon: React.ComponentType<{ className?: string }>; sublabel?: string }) {
  const t = toneFor(pct);
  return (
    <div className={`relative rounded-xl border border-slate-200 bg-gradient-to-br ${t.bgFrom} to-white p-3 shadow-sm`}>
      <div className="flex items-center gap-2 mb-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-slate-200">
          <Icon className="h-3.5 w-3.5 text-slate-700" />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 truncate">{label}</p>
          {sublabel && <p className="text-[10px] text-slate-500 truncate">{sublabel}</p>}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative h-[88px] w-[88px] shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart
              innerRadius="74%"
              outerRadius="100%"
              data={[{ value: pct, fill: t.ring }]}
              startAngle={90}
              endAngle={-270}
            >
              <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
              <RadialBar dataKey="value" cornerRadius={8} fill={t.ring} background={{ fill: '#f1f5f9' }} />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className={`text-xl font-bold tabular-nums ${t.text}`}>{Math.round(pct)}%</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── KPI tile ───────────────────────────────────────────────────────────
function KpiTile({
  label, value, icon: Icon, tone = 'slate', hint,
}: {
  label: string; value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  tone?: 'slate' | 'emerald' | 'blue' | 'amber' | 'rose' | 'indigo';
  hint?: string;
}) {
  const toneMap = {
    slate: { iconBg: 'bg-slate-50', iconText: 'text-slate-600', ring: 'ring-slate-100' },
    emerald: { iconBg: 'bg-emerald-50', iconText: 'text-emerald-600', ring: 'ring-emerald-100' },
    blue: { iconBg: 'bg-blue-50', iconText: 'text-blue-600', ring: 'ring-blue-100' },
    amber: { iconBg: 'bg-amber-50', iconText: 'text-amber-600', ring: 'ring-amber-100' },
    rose: { iconBg: 'bg-rose-50', iconText: 'text-rose-600', ring: 'ring-rose-100' },
    indigo: { iconBg: 'bg-indigo-50', iconText: 'text-indigo-600', ring: 'ring-indigo-100' },
  }[tone];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm">
      <div className="flex items-center gap-2">
        <div className={`flex h-7 w-7 items-center justify-center rounded-lg ${toneMap.iconBg} ring-1 ${toneMap.ring}`}>
          <Icon className={`h-3.5 w-3.5 ${toneMap.iconText}`} />
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500 truncate">{label}</p>
          <p className="text-base font-bold text-slate-900 tabular-nums leading-tight">{value}</p>
        </div>
      </div>
      {hint && <p className="mt-1 text-[10px] text-slate-500 truncate">{hint}</p>}
    </div>
  );
}

// ─── Framework picker dropdown ─────────────────────────────────────────
function JourneyPicker({
  journeys, selectedId, onSelect,
}: { journeys: CertificationJourney[]; selectedId: number | null; onSelect: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const selected = journeys.find((j) => j.id === selectedId);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-journey-picker]')) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="relative" data-journey-picker>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 min-w-[260px]"
      >
        <ShieldCheck className="h-4 w-4 text-blue-600 shrink-0" />
        <span className="truncate flex-1 text-left">
          {selected ? resolveName(selected) : 'Select framework…'}
        </span>
        {selected?.framework?.short_code && (
          <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-px text-[10px] font-medium text-slate-600 shrink-0">
            {selected.framework.short_code}
          </span>
        )}
        <ChevronDown className={`h-4 w-4 text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-[320px] rounded-xl border border-slate-200 bg-white p-1 shadow-lg max-h-[360px] overflow-y-auto">
          {journeys.length === 0 ? (
            <p className="p-3 text-xs text-slate-500">No active journeys.</p>
          ) : (
            journeys.map((j) => {
              const isActive = j.id === selectedId;
              const code = j.framework?.short_code || '';
              return (
                <button
                  key={j.id}
                  onClick={() => { onSelect(j.id); setOpen(false); }}
                  className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors ${
                    isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <ShieldCheck className={`h-3.5 w-3.5 shrink-0 ${isActive ? 'text-blue-600' : 'text-slate-400'}`} />
                  <span className="flex-1 text-xs font-medium truncate">{resolveName(j)}</span>
                  {code && (
                    <span className="rounded border border-slate-200 bg-white px-1.5 py-px text-[10px] font-medium text-slate-500 shrink-0">
                      {code}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main ───────────────────────────────────────────────────────────────
export function FrameworkDeepDive({ journeys }: { journeys: CertificationJourney[] }) {
  // Filter to journeys that have actually started — finished/cancelled
  // journeys can still be inspected but we default the picker to an active
  // one so the operator lands on something live.
  const activeJourneys = useMemo(
    () => journeys.filter((j) => j.status === 'in_progress' || j.status === 'not_started'),
    [journeys],
  );
  const pickable = activeJourneys.length > 0 ? activeJourneys : journeys;

  const [selectedId, setSelectedId] = useState<number | null>(pickable[0]?.id ?? null);

  // Keep the selection valid if the journeys list changes (e.g. a journey
  // completes mid-session). Re-pick the first available when ours drops out.
  useEffect(() => {
    if (selectedId && !pickable.find((j) => j.id === selectedId)) {
      setSelectedId(pickable[0]?.id ?? null);
    } else if (!selectedId && pickable.length > 0) {
      setSelectedId(pickable[0].id);
    }
  }, [pickable, selectedId]);

  const selected = pickable.find((j) => j.id === selectedId) || null;

  const { data: progress, isLoading: progressLoading } = useQuery({
    queryKey: ['certification-progress', selectedId],
    queryFn: async () => {
      const r = await certificationsApi.getProgress(selectedId as number);
      return r.data as ProgressSummary;
    },
    enabled: !!selectedId,
    staleTime: 30_000,
  });

  const { data: gaps } = useQuery({
    queryKey: ['certification-gaps', selectedId],
    queryFn: async () => {
      const r = await certificationsApi.getGaps(selectedId as number);
      return r.data as GapAnalysis;
    },
    enabled: !!selectedId,
    staleTime: 30_000,
  });

  // Empty state — page-level. If there are zero journeys we hide entirely
  // since the existing ComplianceDashboard already shows the start-a-journey
  // empty state.
  if (journeys.length === 0) return null;

  const dueDays = daysFromNow(selected?.target_date as string | undefined);
  const isOverdue = dueDays !== null && dueDays < 0;
  const isUrgent = dueDays !== null && dueDays >= 0 && dueDays <= 30;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Header strip */}
      <div className="border-b border-slate-200 bg-gradient-to-br from-slate-50 to-white px-4 py-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 ring-1 ring-blue-100">
              <FileSearch className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-900">Framework Deep-Dive</h2>
              <p className="text-[11px] text-slate-500">Pick a journey to inspect its KPIs, status mix, domains and gaps.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <JourneyPicker journeys={pickable} selectedId={selectedId} onSelect={setSelectedId} />
            {selected && (
              <Link
                href={`/frameworks/${selected.id}`}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm transition-colors hover:border-blue-300 hover:text-blue-700"
              >
                Open full detail
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            )}
          </div>
        </div>

        {/* Sub-header chips for the selected journey */}
        {selected && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-medium ${
              selected.status === 'in_progress'
                ? 'border-blue-200 bg-blue-50 text-blue-700'
                : selected.status === 'not_started'
                  ? 'border-slate-200 bg-slate-50 text-slate-600'
                  : selected.status === 'completed'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-slate-200 bg-slate-50 text-slate-600'
            }`}>
              <Activity className="h-3 w-3" />
              {(selected.status || 'in_progress').replace(/_/g, ' ')}
            </span>
            {isOverdue && (
              <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 font-medium text-rose-700">
                <Calendar className="h-3 w-3" />
                Overdue by {Math.abs(dueDays as number)}d
              </span>
            )}
            {isUrgent && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                <Calendar className="h-3 w-3" />
                Due in {dueDays}d
              </span>
            )}
            {selected.target_date && !isOverdue && !isUrgent && (
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium text-slate-600">
                <Calendar className="h-3 w-3" />
                Target {new Date(selected.target_date).toLocaleDateString()}
              </span>
            )}
            {selected.started_at && (
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 font-medium text-slate-600">
                <Clock className="h-3 w-3" />
                Started {new Date(selected.started_at).toLocaleDateString()}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Body */}
      {!selected ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Sparkles className="mb-2 h-7 w-7 text-slate-300" />
          <p className="text-xs text-slate-500">Pick a framework above to load its KPIs.</p>
        </div>
      ) : progressLoading || !progress ? (
        <div className="grid gap-3 p-4 md:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-[180px] animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : (
        <div className="space-y-4 p-4">
          {/* Hero gauges row */}
          <div className="grid gap-3 sm:grid-cols-3">
            <MiniGauge
              label="Readiness"
              pct={progress.readiness_percentage}
              icon={Target}
              sublabel="Verified + evidenced"
            />
            <MiniGauge
              label="Completion"
              pct={progress.completion_percentage}
              icon={CheckCircle2}
              sublabel={`${progress.implemented_count + progress.verified_count}/${progress.total_controls} done`}
            />
            <MiniGauge
              label="Evidence Coverage"
              pct={progress.evidence_coverage_percentage}
              icon={FileBadge}
              sublabel={`${progress.with_evidence_count} of ${progress.total_controls}`}
            />
          </div>

          {/* KPI tile row */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            <KpiTile
              label="Total"
              value={progress.total_controls}
              icon={ListChecks}
              tone="slate"
            />
            <KpiTile
              label="Verified"
              value={progress.verified_count}
              icon={ShieldCheck}
              tone="emerald"
            />
            <KpiTile
              label="Implemented"
              value={progress.implemented_count}
              icon={CheckCircle2}
              tone="emerald"
            />
            <KpiTile
              label="In Progress"
              value={progress.in_progress_count}
              icon={Clock}
              tone="blue"
            />
            <KpiTile
              label="Not Started"
              value={progress.not_started_count}
              icon={Target}
              tone="slate"
            />
            <KpiTile
              label="N/A"
              value={progress.not_applicable_count}
              icon={Layers}
              tone="slate"
            />
            <KpiTile
              label="Approved Evidence"
              value={progress.approved_evidence_controls}
              icon={FileBadge}
              tone="indigo"
              hint={`${progress.fully_evidenced_count} fully evidenced`}
            />
          </div>

          {/* Charts row — Status donut + Domain bars */}
          <div className="grid gap-3 lg:grid-cols-2">
            <StatusDonutPanel progress={progress} />
            <DomainBarPanel progress={progress} />
          </div>

          {/* Gap insights — 3 columns */}
          <GapInsightsPanel gaps={gaps} journeyId={selected.id} />
        </div>
      )}
    </section>
  );
}

// ─── Status donut panel (per-journey) ─────────────────────────────────
function StatusDonutPanel({ progress }: { progress: ProgressSummary }) {
  const data = useMemo(() => {
    const buckets = [
      { key: 'verified', value: progress.verified_count },
      // implemented_count typically already includes verified — display the
      // non-verified portion so the donut totals match total_controls.
      { key: 'implemented', value: Math.max(0, progress.implemented_count - progress.verified_count) },
      { key: 'in_progress', value: progress.in_progress_count },
      { key: 'not_started', value: progress.not_started_count },
      { key: 'not_applicable', value: progress.not_applicable_count },
    ];
    return buckets
      .filter((b) => b.value > 0)
      .map((b) => ({ ...b, name: STATUS_LABEL[b.key], color: STATUS_COLOR[b.key] }));
  }, [progress]);

  const total = data.reduce((s, b) => s + b.value, 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 ring-1 ring-blue-100">
          <Layers className="h-3.5 w-3.5 text-blue-600" />
        </div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
          Control Status Mix
        </h3>
      </div>
      {total === 0 ? (
        <div className="flex h-[180px] items-center justify-center text-xs text-slate-400">
          No control data yet
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[160px_1fr] items-center">
          <div className="relative h-[180px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  stroke="#fff"
                  strokeWidth={2}
                >
                  {data.map((entry) => (
                    <Cell key={entry.key} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                  formatter={((value: number, name: string) => [`${value}`, name]) as never}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className="text-2xl font-bold text-slate-900 tabular-nums">{total}</span>
              <span className="text-[9px] font-medium uppercase tracking-wider text-slate-500">Controls</span>
            </div>
          </div>
          <div className="space-y-1.5">
            {data.map((s) => {
              const pct = total > 0 ? (s.value / total) * 100 : 0;
              return (
                <div key={s.key}>
                  <div className="flex items-center justify-between gap-2 text-[11px]">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="h-2 w-2 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
                      <span className="font-medium text-slate-700 truncate">{s.name}</span>
                    </div>
                    <span className="text-slate-500 shrink-0 tabular-nums">
                      <span className="font-semibold text-slate-800">{s.value}</span>
                      <span className="ml-1 text-slate-400">{pct.toFixed(0)}%</span>
                    </span>
                  </div>
                  <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: s.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Domain bar panel (per-journey) ───────────────────────────────────
function DomainBarPanel({ progress }: { progress: ProgressSummary }) {
  const data = useMemo(() => {
    return (progress.by_domain || [])
      .map((d) => {
        const pct = d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0;
        return {
          domain: d.domain_name,
          completed: d.completed,
          in_progress: d.in_progress,
          not_started: d.not_started,
          total: d.total,
          pct,
        };
      })
      .sort((a, b) => b.pct - a.pct)
      .slice(0, 8);
  }, [progress.by_domain]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 ring-1 ring-amber-100">
            <Activity className="h-3.5 w-3.5 text-amber-600" />
          </div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
            Progress by Domain
          </h3>
        </div>
        <span className="text-[10px] text-slate-500">{data.length} domains</span>
      </div>
      {data.length === 0 ? (
        <div className="flex h-[180px] items-center justify-center text-xs text-slate-400">
          No domain data
        </div>
      ) : (
        <div style={{ width: '100%', height: Math.max(180, data.length * 28) }}>
          <ResponsiveContainer>
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 4, right: 24, bottom: 4, left: 4 }}
              barCategoryGap={6}
            >
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
              <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: '#64748b' }} tickFormatter={(v) => `${v}%`} />
              <YAxis
                type="category"
                dataKey="domain"
                tick={{ fontSize: 10, fill: '#475569' }}
                width={110}
              />
              <Tooltip
                contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                formatter={((value: number, _name: string, item: { payload: { completed: number; total: number; pct: number } }) => {
                  return [`${item.payload.completed}/${item.payload.total} (${item.payload.pct}%)`, 'Completed'];
                }) as never}
              />
              <Bar dataKey="pct" radius={[0, 4, 4, 0]}>
                {data.map((d) => {
                  const t = toneFor(d.pct);
                  return <Cell key={d.domain} fill={t.ring} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ─── Gap insights panel (per-journey) ─────────────────────────────────
function GapInsightsPanel({ gaps, journeyId }: { gaps: GapAnalysis | undefined; journeyId: number }) {
  const cells: Array<{
    key: keyof GapAnalysis;
    title: string;
    icon: React.ComponentType<{ className?: string }>;
    tone: 'rose' | 'amber' | 'blue';
    emptyText: string;
  }> = [
    { key: 'not_implemented', title: 'Not Implemented', icon: AlertTriangle, tone: 'rose', emptyText: 'All controls are at least in progress.' },
    { key: 'missing_evidence', title: 'Missing Evidence', icon: FileText, tone: 'amber', emptyText: 'Every control has evidence.' },
    { key: 'pending_verification', title: 'Pending Verification', icon: Clock, tone: 'blue', emptyText: 'Nothing waiting on verification.' },
  ];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-50 ring-1 ring-rose-100">
          <AlertTriangle className="h-3.5 w-3.5 text-rose-600" />
        </div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-700">
          Gap Insights
        </h3>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {cells.map((cell) => {
          const items = (gaps?.[cell.key] || []) as Array<{ control_id: number; control_code: string; control_name: string }>;
          const Icon = cell.icon;
          const toneClasses = {
            rose: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
            amber: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
            blue: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
          }[cell.tone];
          return (
            <div key={cell.key} className={`rounded-lg border ${toneClasses.border} ${toneClasses.bg} p-3`}>
              <div className="mb-2 flex items-center justify-between">
                <div className={`flex items-center gap-1.5 text-[11px] font-semibold ${toneClasses.text}`}>
                  <Icon className="h-3.5 w-3.5" />
                  {cell.title}
                </div>
                <span className={`rounded-full bg-white/70 px-1.5 py-0.5 text-[10px] font-bold ${toneClasses.text}`}>
                  {items.length}
                </span>
              </div>
              {items.length === 0 ? (
                <p className="text-[11px] text-slate-500">{cell.emptyText}</p>
              ) : (
                <ul className="space-y-1 max-h-[140px] overflow-y-auto pr-1">
                  {items.slice(0, 8).map((item) => (
                    <li key={item.control_id}>
                      <Link
                        href={`/frameworks/${journeyId}?control=${item.control_id}`}
                        className="flex items-start gap-1.5 rounded p-1 -mx-1 text-[11px] text-slate-700 hover:bg-white"
                      >
                        <span className="font-mono text-[10px] text-slate-500 shrink-0">{item.control_code}</span>
                        <span className="truncate">{item.control_name}</span>
                        <ChevronRight className="ml-auto h-3 w-3 text-slate-400 shrink-0" />
                      </Link>
                    </li>
                  ))}
                  {items.length > 8 && (
                    <li>
                      <Link
                        href={`/frameworks/${journeyId}`}
                        className={`block text-[11px] font-medium ${toneClasses.text} hover:underline pl-1`}
                      >
                        +{items.length - 8} more →
                      </Link>
                    </li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
