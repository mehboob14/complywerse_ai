'use client';

import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import {
  Shield,
  FileText,
  AlertTriangle,
  Server,
  Bug,
  Briefcase,
  ShieldCheck,
  CheckCircle2,
  Clock,
  XCircle,
  TrendingUp,
} from 'lucide-react';
import {
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
  ResponsiveContainer,
} from 'recharts';
import { SECTION_ROOT, TabLoader, TabError } from './shared';

interface OverviewResponse {
  framework: { id: number; name: string; version?: string; short_code?: string; upload_status?: string };
  journey: { id: number; name?: string; status?: string; progress?: number } | null;
  controls: { total: number; in_scope: number; out_of_scope: number; pending_applicability: number; untouched: number };
  implementation: Record<string, number>;
  evidence: { total: number; pending: number; approved: number; rejected: number };
  documents: { total: number };
  risks: { total: number };
  assets: { in_scope: number };
  vulnerabilities: { open_on_in_scope_assets: number };
  vendors: { active: number };
  exceptions: { controls_marked_not_applicable: number; policy_exceptions_active: number };
}

interface Props {
  frameworkId: string;
  onJumpTab?: (tab: string) => void;
}

/**
 * Radial gauge — single percentage shown as a 270° arc with the value
 * stamped in the centre. Drawn with recharts' RadialBarChart so the
 * arc tweens on data updates and uses theme-aware colours.
 */
function Gauge({ value, label, sublabel, color }: { value: number; label: string; sublabel?: string; color: string }) {
  const safe = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div className="relative flex flex-col items-center">
      <div className="relative h-36 w-36">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            innerRadius="78%"
            outerRadius="100%"
            startAngle={225}
            endAngle={-45}
            data={[{ value: safe, fill: color }]}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
            <RadialBar background={{ fill: '#f1f5f9' }} dataKey="value" cornerRadius={12} />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-bold text-slate-900 tabular-nums leading-none">{Math.round(safe)}<span className="text-base text-slate-500">%</span></span>
          {sublabel && <span className="mt-1 text-[10px] text-slate-500 uppercase tracking-wide">{sublabel}</span>}
        </div>
      </div>
      <p className="mt-1.5 text-xs font-medium text-slate-700 text-center">{label}</p>
    </div>
  );
}

/**
 * Horizontal stacked bar — segments scaled by share, with an inline
 * legend underneath. The 'untouched' bucket is intentionally rendered
 * in light slate so the eye sees it as "unreviewed yet" rather than
 * something to act on.
 */
function StackedBar({ segments, totalLabel }: { segments: Array<{ label: string; value: number; color: string }>; totalLabel: string }) {
  const total = segments.reduce((acc, s) => acc + s.value, 0);
  if (total === 0) {
    return (
      <div className="rounded-lg bg-slate-50 border border-slate-200 p-4 text-center text-xs text-slate-500">
        No data yet
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex h-8 w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
        {segments.map((s) => {
          const pct = (s.value / total) * 100;
          if (pct === 0) return null;
          return (
            <div
              key={s.label}
              className="relative flex items-center justify-center text-[10px] font-semibold text-white transition-all"
              style={{ width: `${pct}%`, backgroundColor: s.color }}
              title={`${s.label}: ${s.value} (${pct.toFixed(0)}%)`}
            >
              {pct >= 8 && s.value}
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-600">
        <span className="text-slate-500">{totalLabel}: <span className="font-semibold text-slate-900">{total}</span></span>
        {segments.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: s.color }} />
            {s.label}
            <span className="font-semibold text-slate-900">{s.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Module tile — themed card with an icon, a primary number, a tiny
 * trend-style accent line, and an optional secondary stat. Clickable
 * when `onClick` is provided so the auditor can jump straight to that
 * tab from the overview.
 */
function ModuleTile({
  icon: Icon,
  label,
  value,
  secondary,
  tone,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  secondary?: string;
  tone: 'rose' | 'amber' | 'emerald' | 'primary' | 'slate';
  onClick?: () => void;
}) {
  const tones: Record<string, { bg: string; border: string; iconBg: string; iconColor: string; accent: string }> = {
    rose:    { bg: 'bg-rose-50',    border: 'border-rose-200',    iconBg: 'bg-rose-100',    iconColor: 'text-rose-700',    accent: 'bg-rose-500' },
    amber:   { bg: 'bg-amber-50',   border: 'border-amber-200',   iconBg: 'bg-amber-100',   iconColor: 'text-amber-700',   accent: 'bg-amber-500' },
    emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200', iconBg: 'bg-emerald-100', iconColor: 'text-emerald-700', accent: 'bg-emerald-500' },
    primary: { bg: 'bg-primary-50', border: 'border-primary-200', iconBg: 'bg-primary-100', iconColor: 'text-primary-700', accent: 'bg-primary-500' },
    slate:   { bg: 'bg-slate-50',   border: 'border-slate-200',   iconBg: 'bg-slate-100',   iconColor: 'text-slate-700',   accent: 'bg-slate-400' },
  };
  const t = tones[tone];
  const Wrapper: any = onClick ? 'button' : 'div';
  return (
    <Wrapper
      onClick={onClick}
      className={`relative overflow-hidden rounded-xl border ${t.border} ${t.bg} p-4 text-left transition-all ${onClick ? 'hover:shadow-md hover:-translate-y-0.5 cursor-pointer' : ''}`}
    >
      <div className={`absolute left-0 top-0 h-1 w-full ${t.accent}`} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-600">{label}</p>
          <p className="mt-1.5 text-2xl font-bold text-slate-900 tabular-nums">{value}</p>
          {secondary && <p className="text-[11px] text-slate-500 mt-0.5">{secondary}</p>}
        </div>
        <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${t.iconBg}`}>
          <Icon className={`h-4 w-4 ${t.iconColor}`} />
        </div>
      </div>
    </Wrapper>
  );
}

export default function OverviewTab({ frameworkId, onJumpTab }: Props) {
  const { data, isLoading, error } = useQuery<OverviewResponse>({
    queryKey: ['auditor-overview', frameworkId],
    queryFn: async () => {
      const res = await apiClient.get(`${SECTION_ROOT}/${frameworkId}/overview`);
      return res.data;
    },
  });

  if (isLoading) return <TabLoader />;
  if (error || !data) return <TabError />;

  const coveragePct = data.controls.total > 0
    ? (data.controls.in_scope / data.controls.total) * 100
    : 0;
  const evidenceApprovalPct = data.evidence.total > 0
    ? (data.evidence.approved / data.evidence.total) * 100
    : 0;

  const implTotal = Object.values(data.implementation).reduce((a, b) => a + b, 0);
  const implCompleted = (data.implementation.completed || 0) + (data.implementation.verified || 0);
  const implPct = implTotal > 0 ? (implCompleted / implTotal) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* HERO — three gauges side by side. This is the page's anchor:
          one glance answers "how much of this framework is signed off?". */}
      <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap mb-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{data.framework.short_code || 'Framework'} audit posture</p>
            <h2 className="mt-0.5 text-lg font-semibold text-slate-900">{data.framework.name}</h2>
            {data.framework.version && <p className="text-xs text-slate-500">v{data.framework.version}</p>}
          </div>
          {data.journey && (
            <div className="rounded-lg border border-slate-200 bg-white px-4 py-2">
              <p className="text-[10px] uppercase tracking-wide text-slate-500">Journey</p>
              <p className="text-sm font-semibold text-slate-900">{(data.journey.status || '—').replace(/_/g, ' ')}</p>
              {typeof data.journey.progress === 'number' && (
                <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
                  <TrendingUp className="h-3 w-3" />
                  {Math.round(data.journey.progress)}% complete
                </div>
              )}
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 place-items-center">
          <Gauge value={coveragePct} label="Scope coverage" sublabel={`${data.controls.in_scope} / ${data.controls.total}`} color="#10b981" />
          <Gauge value={evidenceApprovalPct} label="Evidence approval rate" sublabel={`${data.evidence.approved} / ${data.evidence.total}`} color="#1ed4b0" />
          <Gauge value={implPct} label="Implementation complete" sublabel={`${implCompleted} / ${implTotal}`} color="#17b898" />
        </div>
      </div>

      {/* CONTROLS — full-width stacked bar. The shape of this bar tells the
          auditor immediately where the framework stands: mostly green = good,
          a big slate slice = lots of unreviewed clauses, etc. */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Controls scope breakdown</p>
            <p className="text-xs text-slate-500">Where every clause sits in the applicability workflow</p>
          </div>
          {onJumpTab && (
            <button
              onClick={() => onJumpTab('controls')}
              className="text-xs text-primary-700 hover:underline font-medium"
            >
              Open controls →
            </button>
          )}
        </div>
        <StackedBar
          totalLabel="Controls"
          segments={[
            { label: 'In scope',  value: data.controls.in_scope,             color: '#10b981' },
            { label: 'Out of scope', value: data.controls.out_of_scope,       color: '#94a3b8' },
            { label: 'Pending review', value: data.controls.pending_applicability, color: '#f59e0b' },
            { label: 'Untouched', value: data.controls.untouched,             color: '#e2e8f0' },
          ]}
        />
      </div>

      {/* EVIDENCE — three horizontal bars stacked vertically. We render the
          pending bar with a soft pulsing border so the auditor's eye is
          drawn to outstanding review work. */}
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Evidence review pipeline</p>
            <p className="text-xs text-slate-500">{data.evidence.total} total — {data.evidence.pending} waiting on you</p>
          </div>
          {onJumpTab && (
            <button
              onClick={() => onJumpTab('evidence')}
              className="text-xs text-primary-700 hover:underline font-medium"
            >
              Open evidence →
            </button>
          )}
        </div>
        <div className="space-y-2.5">
          {[
            { label: 'Pending review',    value: data.evidence.pending,  color: 'bg-amber-500',    text: 'text-amber-900',   bg: 'bg-amber-50',   pulse: data.evidence.pending > 0 },
            { label: 'Approved',           value: data.evidence.approved, color: 'bg-emerald-500',  text: 'text-emerald-900', bg: 'bg-emerald-50', pulse: false },
            { label: 'Rejected — needs rework', value: data.evidence.rejected, color: 'bg-rose-500', text: 'text-rose-900',    bg: 'bg-rose-50',    pulse: false },
          ].map((row) => {
            const pct = data.evidence.total > 0 ? (row.value / data.evidence.total) * 100 : 0;
            return (
              <div key={row.label} className="flex items-center gap-3">
                <span className={`w-44 flex-shrink-0 text-xs font-medium ${row.text} ${row.pulse ? 'animate-pulse' : ''}`}>{row.label}</span>
                <div className={`relative h-6 flex-1 rounded ${row.bg} overflow-hidden border border-slate-100`}>
                  <div
                    className={`h-full ${row.color} transition-all`}
                    style={{ width: `${Math.max(pct, row.value > 0 ? 2 : 0)}%` }}
                  />
                  <span className="absolute inset-0 flex items-center justify-end pr-2 text-[11px] font-semibold text-slate-900 tabular-nums">
                    {row.value}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* MODULE TILES — visual count tiles for the rest of the modules.
          Each one is a clickable jump to its tab so the overview doubles
          as a navigator. */}
      <div>
        <p className="text-sm font-semibold text-slate-900 mb-2">Linked artifacts</p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          <ModuleTile icon={FileText}       label="Documents"        value={data.documents.total}                              tone="primary" onClick={onJumpTab ? () => onJumpTab('documents') : undefined} />
          <ModuleTile icon={AlertTriangle}  label="Risks"            value={data.risks.total}                                  tone="amber"   onClick={onJumpTab ? () => onJumpTab('risks') : undefined} />
          <ModuleTile icon={Server}         label="In-scope assets"  value={data.assets.in_scope}                              tone="primary" onClick={onJumpTab ? () => onJumpTab('assets') : undefined} />
          <ModuleTile icon={Bug}            label="Open vulns"       value={data.vulnerabilities.open_on_in_scope_assets}      secondary="on in-scope assets" tone="rose"  onClick={onJumpTab ? () => onJumpTab('vulnerabilities') : undefined} />
          <ModuleTile icon={Briefcase}      label="Active vendors"   value={data.vendors.active}                               tone="slate"   onClick={onJumpTab ? () => onJumpTab('vendors') : undefined} />
          <ModuleTile icon={ShieldCheck}    label="Exceptions"       value={data.exceptions.controls_marked_not_applicable + data.exceptions.policy_exceptions_active} secondary={`${data.exceptions.controls_marked_not_applicable} N/A + ${data.exceptions.policy_exceptions_active} policy`} tone="slate"   onClick={onJumpTab ? () => onJumpTab('exceptions') : undefined} />
        </div>
      </div>

      {/* IMPLEMENTATION CHIPS — kept as soft chips beneath the tiles so the
          implementation-status detail is reachable without crowding the
          main visual story above. */}
      {implTotal > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Implementation status</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(data.implementation).map(([status, count]) => {
              const isDone = status === 'completed' || status === 'verified';
              const isWip = status === 'in_progress';
              return (
                <span
                  key={status}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
                    isDone ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : isWip ? 'bg-primary-50 text-primary-700 border border-primary-200'
                    : 'bg-slate-100 text-slate-700 border border-slate-200'
                  }`}
                >
                  {isDone && <CheckCircle2 className="h-3 w-3" />}
                  {isWip && <Clock className="h-3 w-3" />}
                  {!isDone && !isWip && <XCircle className="h-3 w-3 opacity-60" />}
                  {status.replace(/_/g, ' ')}
                  <span className="font-semibold tabular-nums">{count}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
