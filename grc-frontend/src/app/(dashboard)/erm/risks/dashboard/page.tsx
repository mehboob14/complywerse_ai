'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Layers,
  Users,
  AlertTriangle,
  Loader2,
  Upload,
  Plus,
  Activity,
  Database,
  ShieldCheck,
} from 'lucide-react';
import RiskViewSwitcher from '@/components/risks/RiskViewSwitcher';
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

// ---------------------------------------------------------------------------
// Status / source colour + label vocab — kept in sync with the rest of the
// app so a "mitigated" bar in this dashboard matches a "mitigated" pill in
// the risk list.
// ---------------------------------------------------------------------------
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
const SOURCE_COLORS = [
  '#6366f1', '#3b82f6', '#22c55e', '#f59e0b',
  '#a855f7', '#ec4899', '#14b8a6', '#ef4444', '#94a3b8',
];

// Severity band colours — match the dot-plot legend used elsewhere in ERM.
const SEVERITY_COLORS: Record<string, string> = {
  critical: '#dc2626',
  high: '#f97316',
  medium: '#eab308',
  low: '#10b981',
};
const SEVERITY_LABELS: Record<string, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export default function RiskRegisterDashboardPage() {
  // ---- Data queries ----
  const byRegisterQuery = useQuery({
    queryKey: ['erm', 'risks', 'dashboard', 'by-register'],
    queryFn: async () => (await ermApi.risks.getDashboardByRegister()).data,
  });
  const bySourceQuery = useQuery({
    queryKey: ['erm', 'risks', 'dashboard', 'by-source'],
    queryFn: async () => (await ermApi.risks.getDashboardBySource()).data,
  });

  // ---- Filters ----
  const [registerFilter, setRegisterFilter] = useState<string>('');   // '' = all
  const [sourceFilter, setSourceFilter] = useState<string>('');       // '' = all

  const isLoading = byRegisterQuery.isLoading || bySourceQuery.isLoading;
  const allRegisters = byRegisterQuery.data?.registers ?? [];
  const allSources = bySourceQuery.data?.sources ?? [];
  const totalRisks = byRegisterQuery.data?.total_risks ?? 0;

  // Apply filters: drop down to a single register / source if selected,
  // otherwise the full set. The KPI strip and aggregate charts read from
  // these filtered slices so the dashboard truly "drills in".
  const filteredRegisters = useMemo(
    () => (registerFilter ? allRegisters.filter((r) => r.register_type === registerFilter) : allRegisters),
    [allRegisters, registerFilter],
  );
  const filteredSources = useMemo(
    () => (sourceFilter ? allSources.filter((s) => s.source_type === sourceFilter) : allSources),
    [allSources, sourceFilter],
  );

  // ---- Aggregates on the filtered slice ----
  const totals = useMemo(() => {
    return filteredRegisters.reduce(
      (acc, r) => {
        acc.open += r.by_status.open || 0;
        acc.in_treatment += r.by_status.in_treatment || 0;
        acc.mitigated += r.by_status.mitigated || 0;
        acc.accepted += r.by_status.accepted || 0;
        acc.closed += r.by_status.closed || 0;
        acc.total += r.total || 0;
        acc.critical += r.by_score_range.critical || 0;
        acc.high += r.by_score_range.high || 0;
        acc.medium += r.by_score_range.medium || 0;
        acc.low += r.by_score_range.low || 0;
        r.top_owners.forEach((o) => acc.assignees.add(o.owner));
        return acc;
      },
      {
        open: 0, in_treatment: 0, mitigated: 0, accepted: 0, closed: 0,
        critical: 0, high: 0, medium: 0, low: 0, total: 0,
        assignees: new Set<string>(),
      },
    );
  }, [filteredRegisters]);

  // Severity donut data (aggregate of filtered registers).
  const severityDonut = [
    { name: 'Critical', key: 'critical', value: totals.critical },
    { name: 'High',     key: 'high',     value: totals.high },
    { name: 'Medium',   key: 'medium',   value: totals.medium },
    { name: 'Low',      key: 'low',      value: totals.low },
  ];

  // Stacked status mix across the filtered registers.
  const registerStackedData = filteredRegisters.map((r) => ({
    name: r.register_type,
    open: r.by_status.open,
    in_treatment: r.by_status.in_treatment,
    mitigated: r.by_status.mitigated,
    accepted: r.by_status.accepted,
    closed: r.by_status.closed,
  }));

  // Severity-by-register heatmap-style data: one row per register, with
  // critical/high/medium/low bars. Reads more like a heatmap than a chart
  // but keeps Recharts simple.
  const severityByRegisterData = filteredRegisters.map((r) => ({
    name: r.register_type,
    critical: r.by_score_range.critical,
    high:     r.by_score_range.high,
    medium:   r.by_score_range.medium,
    low:      r.by_score_range.low,
  }));

  const sourcePieData = filteredSources.map((s) => ({
    name: SOURCE_LABELS[s.source_type] || s.source_type,
    key: s.source_type,
    value: s.total,
  }));

  const hasFilters = !!(registerFilter || sourceFilter);
  const detailRegister = filteredRegisters.length === 1 && registerFilter ? filteredRegisters[0] : null;
  const detailSource = filteredSources.length === 1 && sourceFilter ? filteredSources[0] : null;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-12 text-gray-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        Loading risk register dashboard…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ============== Header ============== */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-start gap-3">
          {/* Same dropdown the register list uses, so users can flip
              between the two views from either side without hunting for
              a separate "view all risks" link. */}
          <RiskViewSwitcher active="dashboard" />
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-gray-900">Risk Register — Dashboard</h1>
            <p className="text-sm text-gray-500">
              Per-register breakdown, severity mix, provenance and assignee workload. Use the filters below to drill in.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/erm/risks/list?upload=1"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Upload size={16} />
            Import
          </Link>
          <Link
            href="/erm/risks/list?new=1"
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus size={16} />
            Add risk
          </Link>
        </div>
      </div>

      {/* ============== Filters ============== */}
      <div className="rounded-lg border border-gray-200 bg-white p-3 shadow-sm">
        <div className="grid gap-3 md:grid-cols-3">
          <FilterDropdown
            label="Register type"
            value={registerFilter}
            onChange={setRegisterFilter}
            options={[
              { value: '', label: `All registers (${allRegisters.length})` },
              ...allRegisters.map((r) => ({ value: r.register_type, label: `${r.register_type} · ${r.total}` })),
            ]}
            icon={<Layers className="h-4 w-4 text-slate-500" />}
          />
          <FilterDropdown
            label="Source type"
            value={sourceFilter}
            onChange={setSourceFilter}
            options={[
              { value: '', label: `All sources (${allSources.length})` },
              ...allSources.map((s) => ({
                value: s.source_type,
                label: `${SOURCE_LABELS[s.source_type] || s.source_type} · ${s.total}`,
              })),
            ]}
            icon={<Database className="h-4 w-4 text-slate-500" />}
          />
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => {
                setRegisterFilter('');
                setSourceFilter('');
              }}
              disabled={!hasFilters}
              className="ml-auto text-xs font-medium text-blue-600 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Reset filters
            </button>
          </div>
        </div>
      </div>

      {/* ============== KPI strip — reactive to filters ============== */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-7">
        <Kpi label={registerFilter ? 'In register' : 'All risks'} value={totals.total} accent="bg-gray-100 text-gray-700" emphasis />
        <Kpi label="Open" value={totals.open} accent="bg-blue-50 text-blue-700" />
        <Kpi label="In treatment" value={totals.in_treatment} accent="bg-amber-50 text-amber-700" />
        <Kpi label="Mitigated" value={totals.mitigated} accent="bg-emerald-50 text-emerald-700" />
        <Kpi label="Accepted" value={totals.accepted} accent="bg-purple-50 text-purple-700" />
        <Kpi label="Closed" value={totals.closed} accent="bg-gray-100 text-gray-700" />
        <Kpi label="Assignees" value={totals.assignees.size} accent="bg-indigo-50 text-indigo-700" />
      </div>

      {/* ============== Severity overview ============== */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section
          title="Risk severity mix"
          icon={<AlertTriangle className="h-4 w-4 text-rose-500" />}
        >
          {severityDonut.every((d) => d.value === 0) ? (
            <Empty hint="No risks scored yet." />
          ) : (
            <DonutWithCentre
              data={severityDonut}
              total={totals.critical + totals.high + totals.medium + totals.low}
            />
          )}
        </Section>

        <Section
          title={registerFilter ? `Severity in ${registerFilter}` : 'Severity by register'}
          icon={<Activity className="h-4 w-4 text-rose-500" />}
        >
          {severityByRegisterData.length === 0 || severityByRegisterData.every((d) => !d.critical && !d.high && !d.medium && !d.low) ? (
            <Empty hint="No scored risks in this view." />
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={severityByRegisterData} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 11 }} interval={0} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="critical" stackId="sev" fill={SEVERITY_COLORS.critical} name="Critical" />
                  <Bar dataKey="high"     stackId="sev" fill={SEVERITY_COLORS.high}     name="High" />
                  <Bar dataKey="medium"   stackId="sev" fill={SEVERITY_COLORS.medium}   name="Medium" />
                  <Bar dataKey="low"      stackId="sev" fill={SEVERITY_COLORS.low}      name="Low" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Section>
      </div>

      {/* ============== When ONE register is filtered — show its deep card ============== */}
      {detailRegister && (
        <Section
          title={`${detailRegister.register_type} — detail`}
          icon={<Layers className="h-4 w-4 text-blue-500" />}
        >
          <RegisterDetail register={detailRegister} />
        </Section>
      )}

      {/* ============== Stacked status by register (only when no register filter) ============== */}
      {!registerFilter && registerStackedData.length > 0 && (
        <Section
          title="Status mix by register type"
          icon={<Layers className="h-4 w-4 text-slate-500" />}
        >
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={registerStackedData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} angle={-15} textAnchor="end" height={60} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="open"         stackId="s" fill={STATUS_COLORS.open}         name={STATUS_LABELS.open} />
                <Bar dataKey="in_treatment" stackId="s" fill={STATUS_COLORS.in_treatment} name={STATUS_LABELS.in_treatment} />
                <Bar dataKey="mitigated"    stackId="s" fill={STATUS_COLORS.mitigated}    name={STATUS_LABELS.mitigated} />
                <Bar dataKey="accepted"     stackId="s" fill={STATUS_COLORS.accepted}     name={STATUS_LABELS.accepted} />
                <Bar dataKey="closed"       stackId="s" fill={STATUS_COLORS.closed}       name={STATUS_LABELS.closed} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Section>
      )}

      {/* ============== Per-register cards (when no register filter) ============== */}
      {!registerFilter && filteredRegisters.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-900">Register breakdown</h2>
          <div className="grid gap-3 lg:grid-cols-2">
            {filteredRegisters.map((r) => (
              <button
                key={r.register_type}
                type="button"
                onClick={() => setRegisterFilter(r.register_type)}
                className="text-left"
                title="Click to drill into this register"
              >
                <RegisterCard register={r} />
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ============== Source provenance ============== */}
      <Section
        title={sourceFilter ? `Source: ${SOURCE_LABELS[sourceFilter] || sourceFilter}` : 'Where do these risks come from?'}
        icon={<Database className="h-4 w-4 text-violet-500" />}
      >
        {sourcePieData.length === 0 ? (
          <Empty hint="No risks tagged with a source yet." />
        ) : detailSource ? (
          <SourceDetail source={detailSource} />
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
                    innerRadius={48}
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
              {filteredSources.map((s, i) => (
                <button
                  key={s.source_type}
                  type="button"
                  onClick={() => setSourceFilter(s.source_type)}
                  className="flex w-full items-center justify-between rounded-md border border-gray-200 px-3 py-2 text-sm hover:bg-slate-50"
                  title="Filter dashboard by this source"
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
                </button>
              ))}
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

type RegisterDatum = {
  register_type: string;
  total: number;
  by_status: { open: number; in_treatment: number; mitigated: number; accepted: number; closed: number };
  by_category: Record<string, number>;
  by_score_range: { critical: number; high: number; medium: number; low: number };
  top_owners: Array<{ owner: string; count: number }>;
  contributors: number;
  avg_residual_score: number;
};

type SourceDatum = {
  source_type: string;
  total: number;
  by_status: { open: number; in_treatment: number; mitigated: number; accepted: number; closed: number };
};

function Kpi({
  label,
  value,
  accent,
  emphasis,
}: {
  label: string;
  value: number;
  accent: string;
  emphasis?: boolean;
}) {
  return (
    <div className={`rounded-lg border ${emphasis ? 'border-blue-200 bg-blue-50/50' : 'border-gray-200 bg-white'} p-3 shadow-sm`}>
      <div className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${accent}`}>{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${emphasis ? 'text-blue-900' : 'text-gray-900'}`}>{value}</div>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <header className="mb-3 flex items-center gap-2">
        {icon}
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
      </header>
      {children}
    </div>
  );
}

function Empty({ hint }: { hint: string }) {
  return <div className="py-8 text-center text-sm text-gray-500">{hint}</div>;
}

function FilterDropdown({
  label,
  value,
  onChange,
  options,
  icon,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-slate-700">
        {icon}
        {label}
      </label>
      <select
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value || '__all__'} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// Donut chart with the total in the centre — much more readable for a small
// 4-slice severity view than a flat pie.
function DonutWithCentre({
  data,
  total,
}: {
  data: Array<{ name: string; key: string; value: number }>;
  total: number;
}) {
  return (
    <div className="relative h-64">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            outerRadius={92}
            innerRadius={56}
            paddingAngle={2}
          >
            {data.map((d) => (
              <Cell key={d.key} fill={SEVERITY_COLORS[d.key] || '#94a3b8'} />
            ))}
          </Pie>
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-2xl font-semibold text-gray-900">{total}</div>
        <div className="text-[10px] uppercase tracking-wide text-gray-500">total scored</div>
      </div>
    </div>
  );
}

function RegisterCard({ register: r }: { register: RegisterDatum }) {
  const ownerData = r.top_owners.map((o) => ({ name: o.owner, count: o.count }));

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:border-blue-300 transition-colors">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-base font-semibold text-gray-900">{r.register_type}</div>
          <div className="mt-0.5 text-xs text-gray-500">
            {r.total} risk{r.total === 1 ? '' : 's'} · avg residual {r.avg_residual_score}
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-md bg-purple-50 px-2 py-1 text-xs font-medium text-purple-700">
          <Users className="h-3 w-3" />
          {r.contributors}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-5 gap-1.5 text-center">
        <StatusPill label="Open"      value={r.by_status.open}         color="bg-blue-50 text-blue-700" />
        <StatusPill label="In treat." value={r.by_status.in_treatment} color="bg-amber-50 text-amber-700" />
        <StatusPill label="Mitigated" value={r.by_status.mitigated}    color="bg-emerald-50 text-emerald-700" />
        <StatusPill label="Accepted"  value={r.by_status.accepted}     color="bg-purple-50 text-purple-700" />
        <StatusPill label="Closed"    value={r.by_status.closed}       color="bg-gray-100 text-gray-700" />
      </div>

      {ownerData.length > 0 && (
        <div className="mt-4">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-500">
            Top assignees
          </div>
          <div className="h-28">
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

function RegisterDetail({ register: r }: { register: RegisterDatum }) {
  // Severity donut for this single register
  const severity = [
    { name: 'Critical', key: 'critical', value: r.by_score_range.critical },
    { name: 'High',     key: 'high',     value: r.by_score_range.high },
    { name: 'Medium',   key: 'medium',   value: r.by_score_range.medium },
    { name: 'Low',      key: 'low',      value: r.by_score_range.low },
  ];
  const severityTotal = severity.reduce((s, x) => s + x.value, 0);

  // Status mix as a single horizontal stacked bar with percentages.
  const statusEntries = [
    { key: 'open',         label: STATUS_LABELS.open,         value: r.by_status.open,         color: STATUS_COLORS.open },
    { key: 'in_treatment', label: STATUS_LABELS.in_treatment, value: r.by_status.in_treatment, color: STATUS_COLORS.in_treatment },
    { key: 'mitigated',    label: STATUS_LABELS.mitigated,    value: r.by_status.mitigated,    color: STATUS_COLORS.mitigated },
    { key: 'accepted',     label: STATUS_LABELS.accepted,     value: r.by_status.accepted,     color: STATUS_COLORS.accepted },
    { key: 'closed',       label: STATUS_LABELS.closed,       value: r.by_status.closed,       color: STATUS_COLORS.closed },
  ];
  const statusTotal = Math.max(1, statusEntries.reduce((s, x) => s + x.value, 0));

  // Category breakdown — sort descending
  const categoryData = Object.entries(r.by_category)
    .map(([k, v]) => ({ name: k, value: v }))
    .sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-4">
      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Total"           value={r.total}              accent="bg-gray-100 text-gray-700" />
        <Kpi label="Contributors"    value={r.contributors}       accent="bg-purple-50 text-purple-700" />
        <Kpi label="Avg residual"    value={r.avg_residual_score} accent="bg-blue-50 text-blue-700" />
        <Kpi label="Critical risks"  value={r.by_score_range.critical} accent="bg-rose-50 text-rose-700" />
      </div>

      {/* Status stacked bar — single visual, immediately readable */}
      <div>
        <div className="mb-1 flex items-center justify-between text-xs">
          <div className="font-medium text-gray-700">Status mix</div>
          <div className="text-gray-500">{statusTotal} total</div>
        </div>
        <div className="flex h-6 w-full overflow-hidden rounded-md border border-gray-200">
          {statusEntries.map((e) =>
            e.value > 0 ? (
              <div
                key={e.key}
                style={{ width: `${(e.value / statusTotal) * 100}%`, background: e.color }}
                title={`${e.label}: ${e.value}`}
                className="h-full"
              />
            ) : null,
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          {statusEntries.map((e) => (
            <div key={e.key} className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: e.color }} />
              <span className="text-gray-600">{e.label}</span>
              <span className="font-mono text-gray-500">{e.value}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Severity donut */}
        <div>
          <div className="mb-1 text-xs font-medium text-gray-700">Severity distribution</div>
          {severityTotal === 0 ? (
            <Empty hint="No scored risks in this register yet." />
          ) : (
            <DonutWithCentre data={severity} total={severityTotal} />
          )}
        </div>

        {/* Category bar */}
        <div>
          <div className="mb-1 text-xs font-medium text-gray-700">Categories</div>
          {categoryData.length === 0 ? (
            <Empty hint="No risk categories on file." />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryData} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#0ea5e9" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Top owners */}
      {r.top_owners.length > 0 && (
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-gray-700">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            Top assignees in this register
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={r.top_owners.map((o) => ({ name: o.owner, count: o.count }))}
                layout="vertical"
                margin={{ top: 4, right: 12, bottom: 4, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis dataKey="name" type="category" width={140} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#6366f1" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="pt-1 text-right">
        <Link
          href={`/erm/risks/list?register_type=${encodeURIComponent(r.register_type)}`}
          className="text-xs font-medium text-blue-600 hover:text-blue-700"
        >
          Open all {r.total} {r.register_type} risk{r.total === 1 ? '' : 's'} →
        </Link>
      </div>
    </div>
  );
}

function SourceDetail({ source: s }: { source: SourceDatum }) {
  const statusEntries = [
    { key: 'open',         label: STATUS_LABELS.open,         value: s.by_status.open,         color: STATUS_COLORS.open },
    { key: 'in_treatment', label: STATUS_LABELS.in_treatment, value: s.by_status.in_treatment, color: STATUS_COLORS.in_treatment },
    { key: 'mitigated',    label: STATUS_LABELS.mitigated,    value: s.by_status.mitigated,    color: STATUS_COLORS.mitigated },
    { key: 'accepted',     label: STATUS_LABELS.accepted,     value: s.by_status.accepted,     color: STATUS_COLORS.accepted },
    { key: 'closed',       label: STATUS_LABELS.closed,       value: s.by_status.closed,       color: STATUS_COLORS.closed },
  ];
  const statusTotal = Math.max(1, statusEntries.reduce((s, x) => s + x.value, 0));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Kpi label="Total in source" value={s.total} accent="bg-gray-100 text-gray-700" emphasis />
        <Kpi label="Active (open + in treat.)" value={s.by_status.open + s.by_status.in_treatment} accent="bg-amber-50 text-amber-700" />
        <Kpi label="Closed / accepted" value={s.by_status.closed + s.by_status.accepted} accent="bg-emerald-50 text-emerald-700" />
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-xs">
          <div className="font-medium text-gray-700">Status mix</div>
          <div className="text-gray-500">{statusTotal} total</div>
        </div>
        <div className="flex h-6 w-full overflow-hidden rounded-md border border-gray-200">
          {statusEntries.map((e) =>
            e.value > 0 ? (
              <div
                key={e.key}
                style={{ width: `${(e.value / statusTotal) * 100}%`, background: e.color }}
                title={`${e.label}: ${e.value}`}
                className="h-full"
              />
            ) : null,
          )}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
          {statusEntries.map((e) => (
            <div key={e.key} className="flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-sm" style={{ background: e.color }} />
              <span className="text-gray-600">{e.label}</span>
              <span className="font-mono text-gray-500">{e.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
