'use client';

export const dynamic = 'force-dynamic';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  LifeBuoy, ClipboardList, CalendarClock, AlertTriangle, ShieldCheck,
  Activity, ArrowRight, Timer, Link2, Siren, ShieldAlert, ClipboardCheck,
} from 'lucide-react';
import { bcmApi } from '@/lib/api';
import { PageLoader } from '@/components/ui';
import {
  DrillStatusBadge, DRILL_TYPE_LABEL, fmtDate,
} from './_bcm-ui';

type Dashboard = {
  totals: { plans: number; active_plans: number; drills: number; overdue_drills: number; bia_records: number; open_findings: number };
  plans_by_status: Record<string, number>;
  drills_by_status: Record<string, number>;
  drill_coverage_pct: number;
  coverage_detail: { covered: number; active_plans: number };
  rto_pass_rate: number | null;
  rpo_pass_rate: number | null;
  results_scored: number;
  open_findings_by_severity: Record<string, number>;
  linkage?: { open_capas: number; total_capas: number; risks_linked: number; incident_invocations: number };
  recent_drills: any[];
  overdue_drills: any[];
};

const SEV_DOT: Record<string, string> = {
  critical: 'bg-rose-500', high: 'bg-orange-500', medium: 'bg-amber-500', low: 'bg-emerald-500',
};

function Kpi({ icon, label, value, tone = 'slate', sub }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone?: string; sub?: string }) {
  const toneCls: Record<string, string> = {
    slate: 'bg-slate-50 text-slate-600', rose: 'bg-rose-50 text-rose-600',
    emerald: 'bg-emerald-50 text-emerald-600', primary: 'bg-primary-50 text-primary-600',
    amber: 'bg-amber-50 text-amber-600',
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2">
        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${toneCls[tone] || toneCls.slate}`}>{icon}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{value}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

function LinkageCard({ href, icon, label, value, tone, sub, cta }: { href: string; icon: React.ReactNode; label: string; value: React.ReactNode; tone: string; sub: string; cta: string }) {
  const toneCls: Record<string, string> = {
    amber: 'bg-amber-50 text-amber-600', rose: 'bg-rose-50 text-rose-600', primary: 'bg-primary-50 text-primary-600',
  };
  return (
    <Link href={href} className="group rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-primary-300 hover:bg-slate-50">
      <div className="flex items-center justify-between">
        <span className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ${toneCls[tone] || toneCls.primary}`}>{icon}</span>
        <span className="inline-flex items-center gap-0.5 text-[11px] text-primary-600 opacity-0 transition-opacity group-hover:opacity-100">{cta} <ArrowRight className="h-3 w-3" /></span>
      </div>
      <div className="mt-2 text-2xl font-bold tabular-nums text-slate-900">{value}</div>
      <div className="text-[11px] font-medium text-slate-600">{label}</div>
      <div className="text-[11px] text-slate-400">{sub}</div>
    </Link>
  );
}

export default function BcmDashboardPage() {
  const { data, isLoading, error } = useQuery<Dashboard>({
    queryKey: ['bcm-dashboard'],
    queryFn: async () => (await bcmApi.dashboard()).data,
    refetchInterval: 60_000,
  });

  if (isLoading) return <PageLoader className="h-64" />;
  if (error || !data) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-rose-600">
        <AlertTriangle className="mb-2 h-8 w-8" />
        <p className="text-sm">Failed to load the BCM dashboard.</p>
      </div>
    );
  }

  const t = data.totals;
  // Defensive default — the `linkage` block is a newer dashboard field; if the
  // backend hasn't been restarted yet, fall back to zeros instead of crashing.
  const linkage = data.linkage ?? { open_capas: 0, total_capas: 0, risks_linked: 0, incident_invocations: 0 };
  const passRate = (v: number | null) => (v == null ? '—' : `${v}%`);

  return (
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
            <LifeBuoy className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Business Continuity</h1>
            <p className="text-xs text-slate-500">Plans, drills and continuity testing at a glance.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/bcm/plans" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <ClipboardList size={16} /> Plans
          </Link>
          <Link href="/bcm/drills" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <CalendarClock size={16} /> Drills
          </Link>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={<ClipboardList size={16} />} tone="primary" label="Active Plans" value={t.active_plans} sub={`${t.plans} total`} />
        <Kpi icon={<Activity size={16} />} tone="emerald" label="Drill Coverage" value={`${data.drill_coverage_pct}%`} sub={`${data.coverage_detail.covered}/${data.coverage_detail.active_plans} tested · 12 mo`} />
        <Kpi icon={<CalendarClock size={16} />} tone={t.overdue_drills ? 'rose' : 'slate'} label="Overdue Drills" value={t.overdue_drills} sub={`${t.drills} drills total`} />
        <Kpi icon={<AlertTriangle size={16} />} tone={t.open_findings ? 'amber' : 'slate'} label="Open Findings" value={t.open_findings} sub={`${t.bia_records} BIA processes`} />
      </div>

      {/* Cross-module linkage — BCM is the orchestration layer, not a silo */}
      <div>
        <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <Link2 className="h-3.5 w-3.5" /> Cross-module linkage
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <LinkageCard href="/issues" icon={<ClipboardCheck size={16} />} tone="amber" label="Open CAPAs" value={linkage.open_capas} sub={`${linkage.total_capas} raised from findings`} cta="Issues / CAPA" />
          <LinkageCard href="/erm/risks" icon={<ShieldAlert size={16} />} tone="rose" label="Risks Linked" value={linkage.risks_linked} sub="from BIA processes & findings" cta="Risk register" />
          <LinkageCard href="/bcm/drills" icon={<Siren size={16} />} tone="primary" label="Incident Invocations" value={linkage.incident_invocations} sub="real BCP activations" cta="View drills" />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* RTO/RPO pass rates */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <ShieldCheck className="h-4 w-4 text-primary-500" /> Recovery objective pass rate
          </h3>
          {data.results_scored === 0 ? (
            <p className="text-xs text-slate-500">No drills with recorded results yet.</p>
          ) : (
            <div className="space-y-3">
              {[{ label: 'RTO met', v: data.rto_pass_rate }, { label: 'RPO met', v: data.rpo_pass_rate }].map((row) => (
                <div key={row.label}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-slate-600">{row.label}</span>
                    <span className="font-semibold tabular-nums text-slate-900">{passRate(row.v)}</span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${(row.v ?? 0) >= 80 ? 'bg-emerald-500' : (row.v ?? 0) >= 50 ? 'bg-amber-500' : 'bg-rose-500'}`}
                      style={{ width: `${row.v ?? 0}%` }}
                    />
                  </div>
                </div>
              ))}
              <p className="pt-1 text-[11px] text-slate-400">Across {data.results_scored} drill result{data.results_scored === 1 ? '' : 's'}.</p>
            </div>
          )}
        </div>

        {/* Open findings by severity */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <AlertTriangle className="h-4 w-4 text-amber-500" /> Open findings by severity
          </h3>
          <div className="grid grid-cols-4 gap-2">
            {(['critical', 'high', 'medium', 'low'] as const).map((sev) => (
              <div key={sev} className="rounded-lg border border-slate-200 p-2 text-center">
                <div className="mx-auto mb-1 flex items-center justify-center gap-1">
                  <span className={`h-2 w-2 rounded-full ${SEV_DOT[sev]}`} />
                  <span className="text-[10px] font-semibold uppercase text-slate-500">{sev}</span>
                </div>
                <div className="text-lg font-bold tabular-nums text-slate-900">{data.open_findings_by_severity[sev] ?? 0}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Plans by status */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800">
            <ClipboardList className="h-4 w-4 text-primary-500" /> Plans by status
          </h3>
          <div className="space-y-1.5">
            {['draft', 'under_review', 'approved', 'retired'].map((s) => (
              <div key={s} className="flex items-center justify-between text-xs">
                <span className="capitalize text-slate-600">{s.replace('_', ' ')}</span>
                <span className="font-semibold tabular-nums text-slate-900">{data.plans_by_status[s] ?? 0}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Overdue + recent drills */}
      <div className="grid gap-4 lg:grid-cols-2">
        <DrillList title="Overdue drills" icon={<Timer className="h-4 w-4 text-rose-500" />} drills={data.overdue_drills} empty="No overdue drills — nice." />
        <DrillList title="Recent activity" icon={<Activity className="h-4 w-4 text-primary-500" />} drills={data.recent_drills} empty="No drills yet." />
      </div>
    </div>
  );
}

function DrillList({ title, icon, drills, empty }: { title: string; icon: React.ReactNode; drills: any[]; empty: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2.5">
        {icon}<h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      </div>
      {(!drills || drills.length === 0) ? (
        <p className="px-4 py-6 text-center text-xs text-slate-400">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {drills.map((d) => (
            <li key={d.id}>
              <Link href={`/bcm/drills/${d.id}`} className="flex items-center justify-between gap-2 px-4 py-2.5 hover:bg-slate-50">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-800">{d.title}</div>
                  <div className="text-[11px] text-slate-400">
                    {DRILL_TYPE_LABEL[d.drill_type] || d.drill_type} · {d.plan_title || '—'} · {fmtDate(d.scheduled_date)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <DrillStatusBadge status={d.effective_status} />
                  <ArrowRight className="h-4 w-4 text-slate-300" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
