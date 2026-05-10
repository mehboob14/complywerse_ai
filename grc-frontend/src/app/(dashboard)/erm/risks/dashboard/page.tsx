'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Layers,
  Users,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  Legend,
  CartesianGrid,
} from 'recharts';
import { ermApi } from '@/lib/api';

// Canonical risk statuses — must mirror RiskStatus in src/types/index.ts
const STATUS_COLORS: Record<string, string> = {
  open: '#3b82f6',
  in_treatment: '#f59e0b',
  mitigated: '#22c55e',
  accepted: '#a855f7',
  closed: '#6b7280',
};
const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_treatment: 'In treatment',
  mitigated: 'Mitigated',
  accepted: 'Accepted',
  closed: 'Closed',
};

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Manual entry',
  register_import: 'Register import',
  assessment: 'Risk assessment',
  incident: 'Incident',
  rcsa: 'RCSA finding',
  framework_gap: 'Framework gap',
  ubl_import: 'UBL register',
  nca_import: 'NCA register',
  unknown: 'Unspecified',
};

const SOURCE_COLORS = ['#6366f1', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#ef4444', '#94a3b8'];

export default function RiskRegisterDashboardPage() {
  const byRegisterQuery = useQuery({
    queryKey: ['erm', 'risks', 'dashboard', 'by-register'],
    queryFn: async () => (await ermApi.risks.getDashboardByRegister()).data,
  });
  const bySourceQuery = useQuery({
    queryKey: ['erm', 'risks', 'dashboard', 'by-source'],
    queryFn: async () => (await ermApi.risks.getDashboardBySource()).data,
  });

  const isLoading = byRegisterQuery.isLoading || bySourceQuery.isLoading;
  const registers = byRegisterQuery.data?.registers ?? [];
  const sources = bySourceQuery.data?.sources ?? [];
  const totalRisks = byRegisterQuery.data?.total_risks ?? 0;

  // Aggregate totals across all registers for the top KPI strip
  const totals = registers.reduce(
    (acc, r) => {
      acc.open += r.by_status.open || 0;
      acc.in_treatment += r.by_status.in_treatment || 0;
      acc.mitigated += r.by_status.mitigated || 0;
      acc.accepted += r.by_status.accepted || 0;
      acc.closed += r.by_status.closed || 0;
      r.top_owners.forEach((o) => acc.assignees.add(o.owner));
      return acc;
    },
    {
      open: 0,
      in_treatment: 0,
      mitigated: 0,
      accepted: 0,
      closed: 0,
      assignees: new Set<string>(),
    }
  );

  const sourcePieData = sources.map((s) => ({
    name: SOURCE_LABELS[s.source_type] || s.source_type,
    value: s.total,
  }));

  const registerStackedData = registers.map((r) => ({
    name: r.register_type,
    open: r.by_status.open,
    in_treatment: r.by_status.in_treatment,
    mitigated: r.by_status.mitigated,
    accepted: r.by_status.accepted,
    closed: r.by_status.closed,
  }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/erm/risks"
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Risk Register
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-gray-900">Risk Register Dashboard</h1>
          <p className="text-sm text-gray-500">
            Per-register-type breakdown, status mix, assignee workload and provenance.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-12 text-gray-500">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading dashboards…
        </div>
      ) : (
        <>
          {/* KPI strip */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-7">
            <KpiCard label="Total risks" value={totalRisks} accent="bg-gray-100 text-gray-700" />
            <KpiCard label="Open" value={totals.open} accent="bg-blue-50 text-blue-700" />
            <KpiCard label="In treatment" value={totals.in_treatment} accent="bg-amber-50 text-amber-700" />
            <KpiCard label="Mitigated" value={totals.mitigated} accent="bg-emerald-50 text-emerald-700" />
            <KpiCard label="Accepted" value={totals.accepted} accent="bg-purple-50 text-purple-700" />
            <KpiCard label="Closed" value={totals.closed} accent="bg-gray-100 text-gray-700" />
            <KpiCard label="Assignees" value={totals.assignees.size} accent="bg-indigo-50 text-indigo-700" />
          </div>

          {/* Stacked status by register */}
          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <header className="mb-3 flex items-center gap-2">
              <Layers className="h-4 w-4 text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-900">Status mix by register type</h2>
            </header>
            {registerStackedData.length === 0 ? (
              <EmptyHint />
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={registerStackedData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} angle={-15} textAnchor="end" height={60} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="open" stackId="s" fill={STATUS_COLORS.open} name={STATUS_LABELS.open} />
                    <Bar dataKey="in_treatment" stackId="s" fill={STATUS_COLORS.in_treatment} name={STATUS_LABELS.in_treatment} />
                    <Bar dataKey="mitigated" stackId="s" fill={STATUS_COLORS.mitigated} name={STATUS_LABELS.mitigated} />
                    <Bar dataKey="accepted" stackId="s" fill={STATUS_COLORS.accepted} name={STATUS_LABELS.accepted} />
                    <Bar dataKey="closed" stackId="s" fill={STATUS_COLORS.closed} name={STATUS_LABELS.closed} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </section>

          {/* Per-register cards */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-900">Register breakdown</h2>
            {registers.length === 0 ? (
              <EmptyHint />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {registers.map((r) => (
                  <RegisterCard key={r.register_type} register={r} />
                ))}
              </div>
            )}
          </section>

          {/* Source pie */}
          <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
            <header className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-gray-500" />
              <h2 className="text-sm font-semibold text-gray-900">
                Where do these risks come from?
              </h2>
            </header>
            {sourcePieData.length === 0 ? (
              <EmptyHint />
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={sourcePieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={88}
                        label={(entry) => `${entry.name} (${entry.value})`}
                      >
                        {sourcePieData.map((_, i) => (
                          <Cell key={i} fill={SOURCE_COLORS[i % SOURCE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-2">
                  {sources.map((s, i) => (
                    <div
                      key={s.source_type}
                      className="flex items-center justify-between rounded-md border border-gray-200 px-3 py-2 text-sm"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 rounded-full"
                          style={{ background: SOURCE_COLORS[i % SOURCE_COLORS.length] }}
                        />
                        <span className="font-medium text-gray-800">
                          {SOURCE_LABELS[s.source_type] || s.source_type}
                        </span>
                      </div>
                      <span className="font-mono text-xs text-gray-600">{s.total}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
      <div className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${accent}`}>
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold text-gray-900">{value}</div>
    </div>
  );
}

function RegisterCard({
  register: r,
}: {
  register: {
    register_type: string;
    total: number;
    by_status: { open: number; in_treatment: number; mitigated: number; accepted: number; closed: number };
    by_category: Record<string, number>;
    by_score_range: { critical: number; high: number; medium: number; low: number };
    top_owners: Array<{ owner: string; count: number }>;
    contributors: number;
    avg_residual_score: number;
  };
}) {
  const ownerData = r.top_owners.map((o) => ({ name: o.owner, count: o.count }));
  const filteredHref = `/erm/risks?register_type=${encodeURIComponent(r.register_type)}`;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <Link
            href={filteredHref}
            className="text-base font-semibold text-gray-900 hover:text-blue-600"
          >
            {r.register_type}
          </Link>
          <div className="mt-0.5 text-xs text-gray-500">
            {r.total} risk{r.total === 1 ? '' : 's'} · avg residual {r.avg_residual_score}
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-md bg-purple-50 px-2 py-1 text-xs font-medium text-purple-700">
          <Users className="h-3 w-3" />
          {r.contributors} contributor{r.contributors === 1 ? '' : 's'}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-5 gap-1.5 text-center">
        <StatusPill label="Open" value={r.by_status.open} color="bg-blue-50 text-blue-700" />
        <StatusPill label="In treat." value={r.by_status.in_treatment} color="bg-amber-50 text-amber-700" />
        <StatusPill label="Mitigated" value={r.by_status.mitigated} color="bg-emerald-50 text-emerald-700" />
        <StatusPill label="Accepted" value={r.by_status.accepted} color="bg-purple-50 text-purple-700" />
        <StatusPill label="Closed" value={r.by_status.closed} color="bg-gray-100 text-gray-700" />
      </div>

      {ownerData.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
            Top assignees
          </div>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={ownerData} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#6366f1" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusPill({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`rounded-md px-2 py-1.5 text-xs ${color}`}>
      <div className="font-semibold">{value}</div>
      <div className="opacity-80">{label}</div>
    </div>
  );
}

function EmptyHint() {
  return (
    <div className="py-8 text-center text-sm text-gray-500">No risks recorded yet.</div>
  );
}
