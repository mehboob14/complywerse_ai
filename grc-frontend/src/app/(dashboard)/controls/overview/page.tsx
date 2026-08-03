'use client';

/**
 * Controls Overview — a full control-program DASHBOARD (no control list). It
 * rolls up, per framework: control coverage (verified / implemented), current
 * implementation status, evidence coverage, and assignment / owner distribution
 * across frameworks. The actual control browsing + inspection lives on the
 * `/controls` workbench.
 *
 * Data: `getFrameworkControlsSummary` (framework list + counts) +
 * `getFrameworkControlsStatusSummary(frameworkId?)` (per-framework and global
 * verified / with_evidence / by_status / control_status → owners). Each
 * framework card fetches its own scoped status summary in parallel.
 */

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { controlsApi } from '@/lib/api';
import { PageLoader } from '@/components/ui';
import {
  FileStack,
  Table2,
  ShieldCheck,
  Paperclip,
  Users,
  Layers,
  CheckCircle2,
  ArrowRight,
  User,
} from 'lucide-react';
import type {
  FrameworkSummary,
  FrameworkSummaryResponse,
  StatusSummary,
} from '../_shared/components';

// The 4-stage implementation pipeline, in order, with a colour per stage.
const STATUS_STAGES: { key: string; label: string; bar: string; text: string }[] = [
  { key: 'not_started', label: 'Not started', bar: 'bg-slate-300', text: 'text-slate-600' },
  { key: 'in_progress', label: 'In progress', bar: 'bg-amber-400', text: 'text-amber-700' },
  { key: 'implemented', label: 'Implemented', bar: 'bg-primary-500', text: 'text-primary-700' },
  { key: 'verified', label: 'Verified', bar: 'bg-emerald-500', text: 'text-emerald-700' },
];

const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : 0);

// Aggregate owners + assignment counts from a status summary's control_status map.
function ownerAgg(status?: Partial<StatusSummary>) {
  const cs = status?.control_status ?? {};
  const owners: Record<string, number> = {};
  let assigned = 0;
  let total = 0;
  Object.values(cs).forEach((c) => {
    total += 1;
    const name = c.assignee_name?.trim();
    if (name) {
      assigned += 1;
      owners[name] = (owners[name] || 0) + 1;
    }
  });
  const top = Object.entries(owners).sort((a, b) => b[1] - a[1]);
  return { owners: top, assigned, unassigned: total - assigned, total };
}

function KpiTile({ value, label, tone = 'text-slate-900', icon: Icon }: { value: React.ReactNode; label: string; tone?: string; icon: typeof ShieldCheck }) {
  return (
    <div className="cw-card flex items-center gap-3 rounded-xl p-3">
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-slate-50 text-slate-500">
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </span>
      <div className="min-w-0">
        <div className={`text-lg font-semibold ${tone}`}>{value}</div>
        <div className="truncate text-xs text-slate-500">{label}</div>
      </div>
    </div>
  );
}

// A stacked segment bar for the implementation status distribution.
function StatusBar({ byStatus, total }: { byStatus: Record<string, number>; total: number }) {
  if (total <= 0) return <div className="h-2 w-full rounded-full bg-slate-100" />;
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100">
      {STATUS_STAGES.map((s) => {
        const n = byStatus[s.key] ?? 0;
        if (n <= 0) return null;
        return <div key={s.key} className={s.bar} style={{ width: `${(n / total) * 100}%` }} title={`${s.label}: ${n}`} />;
      })}
    </div>
  );
}

function CoverageRow({ label, value, total, bar }: { label: string; value: number; total: number; bar: string }) {
  const p = pct(value, total);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-slate-500">{label}</span>
        <span className="font-medium text-slate-700">{value}/{total} · {p}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-slate-100">
        <div className={`h-1.5 rounded-full ${bar}`} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

function FrameworkDashboardCard({ framework }: { framework: FrameworkSummary }) {
  const { data: status, isLoading } = useQuery({
    queryKey: ['framework-controls-status-summary', framework.id],
    queryFn: async (): Promise<Partial<StatusSummary>> => {
      try {
        return ((await controlsApi.getFrameworkControlsStatusSummary(framework.id)).data ?? {}) as StatusSummary;
      } catch {
        return {};
      }
    },
  });

  const total = status?.total ?? framework.control_count ?? 0;
  const verified = status?.verified ?? 0;
  const withEvidence = status?.with_evidence ?? 0;
  const byStatus = status?.implementation?.by_status ?? {};
  const implemented = (byStatus['implemented'] ?? 0) + (byStatus['verified'] ?? 0);
  const { owners, assigned, unassigned } = ownerAgg(status);

  return (
    <Link
      href={`/controls?framework=${framework.id}`}
      className="cw-card group flex flex-col rounded-xl p-4 transition-colors hover:border-primary-300 hover:shadow-sm"
    >
      {/* Header — the whole card is clickable */}
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 group-hover:text-primary-700">
            <FileStack className="h-4 w-4 flex-shrink-0 text-slate-400" strokeWidth={1.75} />
            <span className="truncate">{framework.name}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500">
            {framework.control_count} controls{framework.framework_type ? ` · ${framework.framework_type}` : ''}{framework.version ? ` · ${framework.version}` : ''}
          </p>
        </div>
        <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 group-hover:border-primary-300 group-hover:text-primary-700">
          Open <ArrowRight className="h-3 w-3" />
        </span>
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center"><PageLoader size="sm" /></div>
      ) : (
        <div className="flex flex-1 flex-col gap-3">
          {/* Coverage bars */}
          <div className="space-y-2">
            <CoverageRow label="Implemented" value={implemented} total={total} bar="bg-primary-500" />
            <CoverageRow label="Verified" value={verified} total={total} bar="bg-emerald-500" />
            <CoverageRow label="Evidence coverage" value={withEvidence} total={total} bar="bg-cyan-500" />
          </div>

          {/* Status distribution */}
          <div>
            <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">Implementation status</div>
            <StatusBar byStatus={byStatus} total={total} />
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
              {STATUS_STAGES.map((s) => (
                <span key={s.key} className="inline-flex items-center gap-1 text-slate-500">
                  <span className={`h-2 w-2 rounded-full ${s.bar}`} /> {s.label} {byStatus[s.key] ?? 0}
                </span>
              ))}
            </div>
          </div>

          {/* Assignment / owners */}
          <div className="mt-auto border-t border-slate-100 pt-3">
            <div className="mb-1.5 flex items-center justify-between text-[11px]">
              <span className="inline-flex items-center gap-1 text-slate-500"><Users className="h-3.5 w-3.5" /> Assignments</span>
              <span className="font-medium text-slate-700">{assigned} assigned · {unassigned} unassigned</span>
            </div>
            {owners.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {owners.slice(0, 4).map(([name, count]) => (
                  <span key={name} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">
                    <User className="h-2.5 w-2.5" /> {name} <span className="text-slate-400">{count}</span>
                  </span>
                ))}
                {owners.length > 4 && <span className="text-[10px] text-slate-400">+{owners.length - 4} more</span>}
              </div>
            ) : (
              <p className="text-[10px] text-slate-400">No owners assigned yet.</p>
            )}
          </div>
        </div>
      )}
    </Link>
  );
}

export default function ControlsOverviewPage() {
  const { data: summaryData, isLoading } = useQuery({
    queryKey: ['framework-controls-summary'],
    queryFn: async () => (await controlsApi.getFrameworkControlsSummary()).data as FrameworkSummaryResponse,
  });

  // Global (all-frameworks) status summary — drives the KPI row + top owners.
  const { data: globalStatus } = useQuery({
    queryKey: ['framework-controls-status-summary', null],
    queryFn: async (): Promise<Partial<StatusSummary>> => {
      try {
        return ((await controlsApi.getFrameworkControlsStatusSummary()).data ?? {}) as StatusSummary;
      } catch {
        return {};
      }
    },
  });

  const frameworks = summaryData?.frameworks ?? [];
  const totalControls = summaryData?.total_controls ?? 0;
  const gTotal = globalStatus?.total ?? totalControls;
  const gVerified = globalStatus?.verified ?? 0;
  const gEvidence = globalStatus?.with_evidence ?? 0;
  const gByStatus = globalStatus?.implementation?.by_status ?? {};
  const gImplemented = (gByStatus['implemented'] ?? 0) + (gByStatus['verified'] ?? 0);
  const gOwners = ownerAgg(globalStatus);

  if (isLoading && !summaryData) {
    return (
      <div className="flex h-64 items-center justify-center">
        <PageLoader size="md" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Controls Overview</h1>
          <p className="text-slate-600">Coverage, status, evidence and ownership across your frameworks</p>
        </div>
        <Link
          href="/controls"
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          <Table2 className="h-4 w-4" strokeWidth={1.75} />
          Open Workbench
        </Link>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <KpiTile icon={Layers} value={summaryData?.total_frameworks ?? frameworks.length} label="Frameworks" />
        <KpiTile icon={FileStack} value={totalControls} label="Total controls" />
        <KpiTile icon={CheckCircle2} value={`${pct(gImplemented, gTotal)}%`} label="Implemented" tone="text-primary-600" />
        <KpiTile icon={ShieldCheck} value={`${pct(gVerified, gTotal)}%`} label="Verified" tone="text-emerald-600" />
        <KpiTile icon={Paperclip} value={`${pct(gEvidence, gTotal)}%`} label="Evidence coverage" tone="text-cyan-600" />
        <KpiTile icon={Users} value={`${pct(gOwners.assigned, gOwners.total || gTotal)}%`} label="Assigned" tone="text-amber-600" />
      </div>

      {/* Assignments across frameworks — global owner distribution */}
      {gOwners.owners.length > 0 && (
        <div className="cw-card rounded-xl p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Users className="h-4 w-4 text-slate-400" strokeWidth={1.75} /> Assignments across frameworks
            </h3>
            <span className="text-xs text-slate-500">{gOwners.assigned} assigned · {gOwners.unassigned} unassigned</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {gOwners.owners.slice(0, 12).map(([name, count]) => (
              <span key={name} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-700">
                <User className="h-3 w-3 text-slate-400" /> {name}
                <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-medium text-slate-500">{count}</span>
              </span>
            ))}
            {gOwners.owners.length > 12 && <span className="self-center text-xs text-slate-400">+{gOwners.owners.length - 12} more owners</span>}
          </div>
        </div>
      )}

      {/* Per-framework dashboard cards */}
      {frameworks.length === 0 ? (
        <div className="cw-card flex min-h-[16rem] flex-col items-center justify-center rounded-xl text-center">
          <Layers className="mb-3 h-10 w-10 text-slate-300" strokeWidth={1.5} />
          <p className="text-sm font-medium text-slate-700">No frameworks yet</p>
          <p className="mt-1 text-xs text-slate-500">Upload a regulatory framework to populate the controls dashboard.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {frameworks.map((fw) => (
            <FrameworkDashboardCard key={fw.id} framework={fw} />
          ))}
        </div>
      )}
    </div>
  );
}
