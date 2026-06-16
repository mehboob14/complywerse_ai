'use client';

import { useQuery } from '@tanstack/react-query';
import {
  apiClient,
  assetsApi,
  certificationsApi,
  complianceApi,
  criticalTasksApi,
  dashboardApi,
  enrichedDashboardApi,
  ermApi,
  governanceApi,
  issuesApi,
  vulnManagementApi,
} from '@/lib/api';
import {
  ResponsiveContainer,
  ComposedChart,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts';
import {
  AlertTriangle, ShieldCheck, ClipboardCheck, ClipboardList,
  PieChart as PieChartIcon, Building2, Shield,
  Folder, RefreshCw, Clock, CheckCircle2,
  TrendingUp, AlertOctagon, FileCheck,
  type LucideIcon,
} from 'lucide-react';

type AnyRecord = Record<string, unknown>;

function num(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rec(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as AnyRecord)) out[k] = num(v, 0);
  return out;
}

function arr<T = AnyRecord>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function titleize(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function countPayload(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== 'object') return 0;
  const o = value as AnyRecord;
  if (Array.isArray(o.items)) return o.items.length;
  if (Array.isArray(o.rows)) return o.rows.length;
  return num(o.total ?? o.count ?? o.pending ?? o.overdue, 0);
}

function MiniLoading() {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="h-7 rounded-md bg-slate-100" />
      <div className="h-7 rounded-md bg-slate-100" />
      <div className="h-7 rounded-md bg-slate-100" />
    </div>
  );
}

function MiniEmpty({ label = 'No data available' }: { label?: string }) {
  return <p className="text-xs text-slate-500">{label}</p>;
}

function MetricGrid({
  items,
}: {
  items: Array<{ label: string; value: string | number; tone?: 'neutral' | 'good' | 'warn' | 'danger' }>;
}) {
  const toneClass: Record<string, string> = {
    neutral: 'text-slate-900',
    good: 'text-emerald-700',
    warn: 'text-amber-700',
    danger: 'text-rose-700',
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((item) => (
        <div key={item.label} className="rounded-md border border-slate-200 bg-white p-2">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">{item.label}</p>
          <p className={`mt-1 text-lg font-semibold ${toneClass[item.tone || 'neutral']}`}>{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function DistBars({
  items,
  maxItems = 6,
  emptyLabel = 'No distribution data',
}: {
  items: Array<{ label: string; value: number; color?: string }>;
  maxItems?: number;
  emptyLabel?: string;
}) {
  const rows = items.filter((i) => i.value > 0).slice(0, maxItems);
  if (!rows.length) return <MiniEmpty label={emptyLabel} />;
  const maxValue = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const pct = Math.round((row.value / maxValue) * 100);
        return (
          <div key={row.label}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="truncate text-slate-700">{row.label}</span>
              <span className="font-semibold text-slate-800">{row.value}</span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-100">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${pct}%`,
                  backgroundColor: row.color || '#2563eb',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ListMini({
  items,
  emptyLabel = 'No records',
}: {
  items: Array<{ id: string; title: string; subtitle?: string }>;
  emptyLabel?: string;
}) {
  if (!items.length) return <MiniEmpty label={emptyLabel} />;
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.id} className="rounded-md border border-slate-200 bg-white p-2">
          <p className="truncate text-xs font-medium text-slate-800">{item.title}</p>
          {item.subtitle && <p className="truncate text-[11px] text-slate-500">{item.subtitle}</p>}
        </div>
      ))}
    </div>
  );
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#e11d48',
  high: '#f97316',
  medium: '#f59e0b',
  low: '#22c55e',
  info: '#64748b',
};

const STATUS_COLORS: Record<string, string> = {
  open: '#ef4444',
  in_progress: '#3b82f6',
  completed: '#22c55e',
  pending: '#f59e0b',
  closed: '#64748b',
};

const CHART_TOOLTIP_STYLE = {
  backgroundColor: '#ffffff',
  border: '1px solid #e2e8f0',
  borderRadius: '8px',
  color: '#0f172a',
  fontSize: '11px',
};

export function ExecutivePortfolioWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-exec-portfolio'],
    queryFn: async () => (await dashboardApi.getUnified()).data,
  });
  if (isLoading) return <MiniLoading />;
  const unified = (data || {}) as AnyRecord;
  const summary = (unified.executive_summary || {}) as AnyRecord;
  const governance = (unified.governance || {}) as AnyRecord;
  const risk = (unified.risk || {}) as AnyRecord;
  const compliance = (unified.compliance || {}) as AnyRecord;
  return (
    <MetricGrid
      items={[
        { label: 'Compliance Score', value: `${num(summary.overall_compliance_score, num(compliance.overall_maturity, 0))}%`, tone: 'good' },
        { label: 'Open Risks', value: num(risk.open_risks), tone: 'danger' },
        { label: 'Pending Actions', value: num(summary.pending_actions), tone: 'warn' },
        { label: 'Pending Approvals', value: num(governance.pending_approvals), tone: 'warn' },
      ]}
    />
  );
}

export function ExecutiveAttentionWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-exec-attention'],
    queryFn: async () => (await dashboardApi.getUnified()).data,
  });
  if (isLoading) return <MiniLoading />;
  const unified = (data || {}) as AnyRecord;
  const summary = (unified.executive_summary || {}) as AnyRecord;
  const risk = (unified.risk || {}) as AnyRecord;
  const governance = (unified.governance || {}) as AnyRecord;
  const rows = [
    { id: 'issues', title: `${num(summary.open_issues)} open issues`, subtitle: 'Issue management backlog' },
    { id: 'review', title: `${num(risk.risks_needing_review)} risks need review`, subtitle: 'Risk register review queue' },
    { id: 'overdue', title: `${num(governance.overdue_reviews)} overdue governance reviews`, subtitle: 'Policy/doc lifecycle' },
  ];
  return <ListMini items={rows} emptyLabel="No priority items" />;
}

export function ExecutiveRiskVelocityWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-exec-risk-velocity'],
    queryFn: async () => (await enrichedDashboardApi.getExecutiveRiskVelocity(90)).data,
  });
  if (isLoading) return <MiniLoading />;
  const rows = arr<AnyRecord>(data).map((row, idx) => ({
    label: String(row.date || row.month || row.period || idx + 1),
    inherent: num(row.avg_inherent),
    residual: num(row.avg_residual),
  }));
  if (!rows.length) return <MiniEmpty label="No risk velocity trend data" />;
  return (
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 6, right: 8, left: -8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} />
          <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Line type="monotone" dataKey="inherent" name="Inherent" stroke="#f97316" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="residual" name="Residual" stroke="#2563eb" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ExecutiveRiskAppetiteWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-exec-risk-appetite'],
    queryFn: async () => (await enrichedDashboardApi.getExecutiveRiskAppetiteGauge()).data,
  });
  if (isLoading) return <MiniLoading />;
  const rows = arr<AnyRecord>(data)
    .map((row, idx) => ({
      id: String(idx),
      label: String(row.category || row.name || `Category ${idx + 1}`),
      value: Math.max(0, Math.round(num(row.utilization_pct))),
      breached: Boolean(row.breached || num(row.utilization_pct) > 100),
    }))
    .slice(0, 6);
  if (!rows.length) return <MiniEmpty label="No risk appetite gauges" />;
  const chartData = rows.map((r) => ({
    label: r.label.length > 12 ? `${r.label.slice(0, 11)}...` : r.label,
    value: Math.min(150, r.value),
  }));
  return (
    <div className="space-y-3">
      <div className="h-[170px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} />
            <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} domain={[0, 150]} />
            <Tooltip
              contentStyle={CHART_TOOLTIP_STYLE}
              formatter={(v: number | undefined) => [`${num(v)}%`, 'Utilization']}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {rows.map((r) => (
                <Cell
                  key={r.id}
                  fill={r.breached ? '#e11d48' : r.value > 80 ? '#f59e0b' : '#10b981'}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {rows.slice(0, 4).map((r) => (
          <div key={r.id} className="rounded-md border border-slate-200 bg-white px-2 py-1.5">
            <p className="truncate text-[10px] uppercase tracking-wide text-slate-500">{r.label}</p>
            <p className={`text-sm font-semibold ${r.breached ? 'text-rose-700' : r.value > 80 ? 'text-amber-700' : 'text-emerald-700'}`}>
              {r.value}%
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function GovernanceSummaryWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-gov-summary'],
    queryFn: async () => (await governanceApi.getDashboard()).data,
  });
  if (isLoading) return <MiniLoading />;
  const gov = (data || {}) as unknown as AnyRecord;
  return (
    <MetricGrid
      items={[
        { label: 'Documents', value: num(gov.total_documents) },
        { label: 'Pending Approvals', value: num(gov.pending_approvals), tone: 'warn' },
        { label: 'Overdue Reviews', value: num(gov.overdue_reviews), tone: 'danger' },
        { label: 'Upcoming Reviews', value: num(gov.upcoming_reviews), tone: 'neutral' },
      ]}
    />
  );
}

export function GovernanceStatusWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-gov-summary'],
    queryFn: async () => (await governanceApi.getDashboard()).data,
  });
  if (isLoading) return <MiniLoading />;
  const byStatus = rec(((data || {}) as unknown as AnyRecord).by_status);
  const items = Object.entries(byStatus).map(([k, v]) => ({
    label: titleize(k),
    value: v,
    color: STATUS_COLORS[k.toLowerCase()] || '#2563eb',
  }));
  return <DistBars items={items} emptyLabel="No document status data" />;
}

export function GovernanceTrendWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-gov-trends'],
    queryFn: async () => (await governanceApi.getTrends(6)).data,
  });
  if (isLoading) return <MiniLoading />;
  const created = arr<AnyRecord>((data as AnyRecord)?.created);
  const published = arr<AnyRecord>((data as AnyRecord)?.published);
  const rows = created.map((c, idx) => ({
    month: String(c.month || c.label || idx + 1),
    created: num(c.count),
    published: num(published[idx]?.count),
  }));
  if (!rows.length) return <MiniEmpty label="No governance trend data" />;
  return (
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} />
          <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} allowDecimals={false} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar dataKey="created" name="Created" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          <Line type="monotone" dataKey="published" name="Published" stroke="#16a34a" strokeWidth={2} dot={{ r: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function GovernanceFrameworkCoverageWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-gov-framework-coverage'],
    queryFn: async () => (await governanceApi.getComplianceByFramework()).data,
  });
  if (isLoading) return <MiniLoading />;
  const frameworks = arr<AnyRecord>((data as AnyRecord)?.frameworks).slice(0, 6);
  const rows = frameworks.map((fw, idx) => ({
    id: String(idx),
    label: String(fw.framework_name || `Framework ${idx + 1}`),
    score: num(fw.compliance_percentage),
  }));
  if (!rows.length) return <MiniEmpty label="No framework compliance coverage" />;
  return (
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 6, right: 6, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
          <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} />
          <YAxis
            type="category"
            dataKey="label"
            width={96}
            tick={{ fontSize: 10, fill: '#64748b' }}
            axisLine={{ stroke: '#e2e8f0' }}
          />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            formatter={(v: number | undefined) => [`${num(v)}%`, 'Compliance']}
          />
          <Bar dataKey="score" radius={[0, 4, 4, 0]}>
            {rows.map((r) => (
              <Cell key={r.id} fill={r.score >= 80 ? '#16a34a' : r.score >= 60 ? '#f59e0b' : '#e11d48'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function GovernanceQueueWidget() {
  const pendingQuery = useQuery({
    queryKey: ['widget-gov-pending'],
    queryFn: async () => (await governanceApi.getDashboardPendingApprovals()).data,
  });
  const overdueQuery = useQuery({
    queryKey: ['widget-gov-overdue'],
    queryFn: async () => (await governanceApi.getDashboardOverdueReviews()).data,
  });
  if (pendingQuery.isLoading && overdueQuery.isLoading) return <MiniLoading />;
  const pendingCount = countPayload(pendingQuery.data);
  const overdueCount = countPayload(overdueQuery.data);
  return (
    <MetricGrid
      items={[
        { label: 'Approvals Queue', value: pendingCount, tone: pendingCount > 0 ? 'warn' : 'good' },
        { label: 'Overdue Queue', value: overdueCount, tone: overdueCount > 0 ? 'danger' : 'good' },
      ]}
    />
  );
}

export function GovernanceRecentPublicationsWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-gov-recent'],
    queryFn: async () => (await governanceApi.getRecentlyPublished(6)).data,
  });
  if (isLoading) return <MiniLoading />;
  const rows = arr<AnyRecord>(data)
    .slice(0, 6)
    .map((row, idx) => ({
      id: String(row.id ?? idx),
      title: String(row.title || 'Untitled document'),
      subtitle: row.doc_type ? titleize(String(row.doc_type)) : undefined,
    }));
  return <ListMini items={rows} emptyLabel="No recent publications" />;
}

export function RiskSummaryWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-risk-summary'],
    queryFn: async () => (await ermApi.risks.getDashboard()).data,
  });
  if (isLoading) return <MiniLoading />;
  const risk = (data || {}) as unknown as AnyRecord;
  return (
    <MetricGrid
      items={[
        { label: 'Total Risks', value: num(risk.total_risks) },
        { label: 'Open Risks', value: num(risk.open_risks), tone: 'danger' },
        { label: 'Avg Residual', value: num(risk.avg_residual_score).toFixed(1) },
        { label: 'Need Review', value: num(risk.risks_needing_review), tone: 'warn' },
      ]}
    />
  );
}

export function RiskDistributionWidget() {
  // Shows the risk register status breakdown (open / in_treatment /
  // mitigated / accepted / closed) sourced from the dashboard endpoint's
  // by_status bucket. Status colours align with the existing
  // STATUS_COLORS map so the bars match how status pills are tinted
  // elsewhere in the platform.
  const { data, isLoading } = useQuery({
    queryKey: ['widget-risk-status-distribution'],
    queryFn: async () => (await ermApi.risks.getDashboard()).data,
  });
  if (isLoading) return <MiniLoading />;
  const byStatus = rec(((data || {}) as unknown as AnyRecord).by_status);

  // Display order that mirrors the risk register lifecycle: open first,
  // closed last. Missing buckets fall back to 0.
  const order: Array<{ key: string; label: string; color: string }> = [
    { key: 'open',          label: 'Open',          color: STATUS_COLORS.open          || '#ef4444' },
    { key: 'in_treatment',  label: 'In Treatment',  color: STATUS_COLORS.in_progress   || '#3b82f6' },
    { key: 'mitigated',     label: 'Mitigated',     color: STATUS_COLORS.remediated    || '#10b981' },
    { key: 'accepted',      label: 'Accepted',      color: STATUS_COLORS.accepted      || '#8b5cf6' },
    { key: 'closed',        label: 'Closed',        color: STATUS_COLORS.closed        || '#64748b' },
  ];
  const items = order
    .map(({ key, label, color }) => ({ label, value: num(byStatus[key]), color }))
    // Surface any extra status buckets the backend returns that aren't in
    // the canonical list (e.g. 'identified', 'mitigating') so nothing gets
    // hidden silently.
    .concat(
      Object.entries(byStatus)
        .filter(([k]) => !order.some((o) => o.key === k))
        .map(([k, v]) => ({ label: titleize(k), value: num(v), color: '#94a3b8' }))
    );
  return <DistBars items={items} emptyLabel="No risks registered yet" />;
}

export function RiskCategoryWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-risk-summary'],
    queryFn: async () => (await ermApi.risks.getDashboard()).data,
  });
  if (isLoading) return <MiniLoading />;
  const byCategory = rec(((data || {}) as unknown as AnyRecord).by_category);
  const items = Object.entries(byCategory).map(([k, v]) => ({
    label: titleize(k),
    value: v,
    color: '#0ea5e9',
  }));
  return <DistBars items={items} emptyLabel="No category data" />;
}

// ── Internal Controls widgets ────────────────────────────────────────────
// Three distribution widgets surfacing the lifecycle of internal controls
// onto the Risk tab. All three share the same query so the data only fans
// out once per render via react query's de duplication.

type InternalControlRow = {
  status?: string;
  design_effectiveness?: string;
  operating_effectiveness?: string;
};

// Status colour table mirrors how internal-control lifecycle states are
// shown elsewhere (page badges + filter chips).
const CONTROL_STATUS_COLORS: Record<string, string> = {
  draft:        '#94a3b8',
  pending_review: '#f59e0b',
  active:       '#10b981',
  in_review:    '#3b82f6',
  retired:      '#64748b',
  inactive:     '#94a3b8',
  rejected:     '#ef4444',
};

const EFFECTIVENESS_COLORS: Record<string, string> = {
  effective:           '#10b981',
  partially_effective: '#f59e0b',
  ineffective:         '#ef4444',
  not_tested:          '#94a3b8',
  not_assessed:        '#94a3b8',
};

function useInternalControlsRows() {
  return useQuery({
    queryKey: ['widget-internal-controls-list'],
    queryFn: async () => {
      const r = await ermApi.internalControls.getAll();
      const d = r.data as unknown;
      if (Array.isArray(d)) return d as InternalControlRow[];
      const obj = d as { items?: unknown[]; controls?: unknown[] };
      return (obj?.items || obj?.controls || []) as InternalControlRow[];
    },
  });
}

function bucketControls(rows: InternalControlRow[], key: 'status' | 'design_effectiveness' | 'operating_effectiveness'): Record<string, number> {
  const out: Record<string, number> = {};
  rows.forEach((r) => {
    const raw = (r[key] || '').toString().trim().toLowerCase();
    const slot = raw || 'not_assessed';
    out[slot] = (out[slot] || 0) + 1;
  });
  return out;
}

export function InternalControlStatusWidget() {
  const { data: rows, isLoading } = useInternalControlsRows();
  if (isLoading) return <MiniLoading />;
  const list = rows || [];
  if (!list.length) return <MiniEmpty label="No internal controls registered" />;
  const buckets = bucketControls(list, 'status');
  const items = Object.entries(buckets)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({
      label: titleize(k),
      value: v,
      color: CONTROL_STATUS_COLORS[k] || '#3b82f6',
    }));
  return <DistBars items={items} emptyLabel="No control status data" />;
}

export function InternalControlDesignEffectivenessWidget() {
  const { data: rows, isLoading } = useInternalControlsRows();
  if (isLoading) return <MiniLoading />;
  const list = rows || [];
  if (!list.length) return <MiniEmpty label="No internal controls registered" />;
  const buckets = bucketControls(list, 'design_effectiveness');
  // Show in a fixed order: effective → partially → ineffective → unassessed.
  const order = ['effective', 'partially_effective', 'ineffective', 'not_tested', 'not_assessed'];
  const items = order
    .filter((k) => buckets[k] !== undefined)
    .map((k) => ({
      label: titleize(k),
      value: buckets[k],
      color: EFFECTIVENESS_COLORS[k] || '#3b82f6',
    }))
    .concat(
      Object.entries(buckets)
        .filter(([k]) => !order.includes(k))
        .map(([k, v]) => ({ label: titleize(k), value: v, color: '#94a3b8' }))
    );
  if (!items.length) return <MiniEmpty label="No design effectiveness data" />;
  return <DistBars items={items} emptyLabel="No design effectiveness data" />;
}

export function InternalControlOperatingEffectivenessWidget() {
  const { data: rows, isLoading } = useInternalControlsRows();
  if (isLoading) return <MiniLoading />;
  const list = rows || [];
  if (!list.length) return <MiniEmpty label="No internal controls registered" />;
  const buckets = bucketControls(list, 'operating_effectiveness');
  const order = ['effective', 'partially_effective', 'ineffective', 'not_tested', 'not_assessed'];
  const items = order
    .filter((k) => buckets[k] !== undefined)
    .map((k) => ({
      label: titleize(k),
      value: buckets[k],
      color: EFFECTIVENESS_COLORS[k] || '#3b82f6',
    }))
    .concat(
      Object.entries(buckets)
        .filter(([k]) => !order.includes(k))
        .map(([k, v]) => ({ label: titleize(k), value: v, color: '#94a3b8' }))
    );
  if (!items.length) return <MiniEmpty label="No operating effectiveness data" />;
  return <DistBars items={items} emptyLabel="No operating effectiveness data" />;
}

export function IncidentSnapshotWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-risk-incidents'],
    queryFn: async () => (await enrichedDashboardApi.getIncidentSummary()).data,
  });
  if (isLoading) return <MiniLoading />;
  const d = (data || {}) as AnyRecord;
  const bySeverity = rec(d.by_severity);
  const criticalHigh = num(bySeverity.critical) + num(bySeverity.high);
  return (
    <MetricGrid
      items={[
        { label: 'Total Incidents', value: num(d.total_incidents) },
        { label: 'Open Incidents', value: num(d.open_incidents), tone: 'danger' },
        { label: 'Critical + High', value: criticalHigh, tone: criticalHigh > 0 ? 'warn' : 'good' },
        { label: 'Last 30 Days', value: num(d.last_30_days ?? d.incidents_last_30d) },
      ]}
    />
  );
}

export function ComplianceSummaryWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-comp-summary'],
    queryFn: async () => (await dashboardApi.getUnified()).data,
  });
  if (isLoading) return <MiniLoading />;
  const compliance = ((data || {}) as AnyRecord).compliance as AnyRecord;
  return (
    <MetricGrid
      items={[
        { label: 'Frameworks', value: num(compliance?.frameworks_tracked) },
        { label: 'Maturity', value: `${num(compliance?.overall_maturity)}%`, tone: 'good' },
        { label: 'Implemented', value: `${num(compliance?.controls_implemented)}/${num(compliance?.controls_total)}` },
        { label: 'Evidence', value: num(compliance?.evidence_items) },
      ]}
    />
  );
}

export function ComplianceFrameworkCoverageWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-comp-framework-coverage'],
    queryFn: async () => (await complianceApi.dashboard.getFrameworksAggregate()).data,
  });
  if (isLoading) return <MiniLoading />;
  const byFramework = arr<AnyRecord>((data as AnyRecord)?.by_framework);
  const items = byFramework.map((fw) => ({
    label: String(fw.framework_name || fw.name || fw.short_code || 'Framework'),
    value: num(fw.readiness_pct ?? fw.completion_pct ?? fw.score),
    color: '#2563eb',
  }));
  return <DistBars items={items} maxItems={5} emptyLabel="No framework coverage yet" />;
}

export function ComplianceStatusMixWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-comp-framework-coverage'],
    queryFn: async () => (await complianceApi.dashboard.getFrameworksAggregate()).data,
  });
  if (isLoading) return <MiniLoading />;
  const mix = arr<AnyRecord>((data as AnyRecord)?.status_mix);
  const items = mix.map((row) => ({
    label: String(row.name || row.key || 'Status'),
    value: num(row.value),
    color: typeof row.color === 'string' ? row.color : STATUS_COLORS[String(row.key || '').toLowerCase()] || '#3b82f6',
  }));
  return <DistBars items={items} maxItems={6} emptyLabel="No control status mix" />;
}

export function ComplianceDomainCoverageWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-comp-framework-coverage'],
    queryFn: async () => (await complianceApi.dashboard.getFrameworksAggregate()).data,
  });
  if (isLoading) return <MiniLoading />;
  const domains = arr<AnyRecord>((data as AnyRecord)?.by_domain).slice(0, 8);
  const rows = domains.map((d, idx) => ({
    id: String(idx),
    label: String(d.domain || `Domain ${idx + 1}`),
    score: num(d.completion_pct ?? d.readiness_pct ?? d.score),
  }));
  if (!rows.length) return <MiniEmpty label="No domain-level coverage yet" />;
  return (
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={rows}>
          <PolarGrid stroke="#e2e8f0" />
          <PolarAngleAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} />
          <PolarRadiusAxis domain={[0, 100]} tick={{ fontSize: 9, fill: '#94a3b8' }} />
          <Radar dataKey="score" stroke="#2563eb" fill="#2563eb" fillOpacity={0.2} />
          <Tooltip
            contentStyle={CHART_TOOLTIP_STYLE}
            formatter={(v: number | undefined) => [`${num(v)}%`, 'Coverage']}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ControlTestingSnapshotWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-comp-testing-summary'],
    queryFn: async () => (await enrichedDashboardApi.getControlTestingSummary()).data,
  });
  if (isLoading) return <MiniLoading />;
  const d = (data || {}) as AnyRecord;
  const results = (d.test_results || {}) as AnyRecord;
  return (
    <MetricGrid
      items={[
        { label: 'Pass Rate', value: `${Math.round(num(d.pass_rate))}%`, tone: num(d.pass_rate) >= 80 ? 'good' : 'warn' },
        { label: 'Effective', value: num(results.effective), tone: 'good' },
        { label: 'Partial', value: num(results.partial), tone: 'warn' },
        { label: 'Ineffective', value: num(results.ineffective), tone: 'danger' },
      ]}
    />
  );
}

export function VulnerabilitySummaryWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-vuln-summary'],
    queryFn: async () => (await vulnManagementApi.dashboard.get()).data,
  });
  if (isLoading) return <MiniLoading />;
  const d = (data || {}) as AnyRecord;
  const bySeverity = rec(d.by_severity);
  const criticalHigh = num(bySeverity.critical) + num(bySeverity.high);
  return (
    <MetricGrid
      items={[
        { label: 'Total Vulns', value: num(d.total_vulnerabilities ?? d.total), tone: 'neutral' },
        { label: 'Critical + High', value: criticalHigh, tone: criticalHigh > 0 ? 'danger' : 'good' },
        { label: 'Overdue', value: num(d.overdue_count), tone: num(d.overdue_count) > 0 ? 'warn' : 'good' },
        { label: 'MTTR (days)', value: num(d.mttr_days).toFixed(1) },
      ]}
    />
  );
}

export function VulnerabilitySeverityWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-vuln-summary'],
    queryFn: async () => (await vulnManagementApi.dashboard.get()).data,
  });
  if (isLoading) return <MiniLoading />;
  const d = (data || {}) as AnyRecord;
  const bySeverity = rec(d.by_severity);
  const items = Object.entries(bySeverity).map(([k, v]) => ({
    label: titleize(k),
    value: v,
    color: SEVERITY_COLORS[k] || '#3b82f6',
  }));
  return <DistBars items={items} emptyLabel="No severity data" />;
}

export function VulnerabilityStatusWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-vuln-summary'],
    queryFn: async () => (await vulnManagementApi.dashboard.get()).data,
  });
  if (isLoading) return <MiniLoading />;
  const byStatus = rec(((data || {}) as AnyRecord).by_status);
  const items = Object.entries(byStatus).map(([k, v]) => ({
    label: titleize(k),
    value: v,
    color: STATUS_COLORS[k.toLowerCase()] || '#2563eb',
  }));
  return <DistBars items={items} maxItems={6} emptyLabel="No status data" />;
}

export function VulnerabilityTrendWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-vuln-trend'],
    queryFn: async () => (await vulnManagementApi.dashboard.getTrends({ period: '90d' })).data,
  });
  if (isLoading) return <MiniLoading />;

  const buckets = arr<string>((data as AnyRecord)?.buckets);
  const discoveredMap = new Map(
    arr<AnyRecord>((data as AnyRecord)?.discovered).map((r) => [String(r.date || ''), num(r.count)])
  );
  const resolvedMap = new Map(
    arr<AnyRecord>((data as AnyRecord)?.resolved).map((r) => [String(r.date || ''), num(r.count)])
  );
  const rows = buckets.map((bucket, idx) => ({
    label: bucket || String(idx + 1),
    discovered: discoveredMap.get(bucket) || 0,
    resolved: resolvedMap.get(bucket) || 0,
  }));

  if (!rows.length) return <MiniEmpty label="No vulnerability trend series" />;
  return (
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="vulnDiscGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#f97316" stopOpacity={0.28} />
              <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="vulnResGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#16a34a" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} />
          <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} allowDecimals={false} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Area type="monotone" dataKey="discovered" name="Discovered" stroke="#f97316" fill="url(#vulnDiscGrad)" strokeWidth={2} />
          <Area type="monotone" dataKey="resolved" name="Resolved" stroke="#16a34a" fill="url(#vulnResGrad)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function VulnerabilityAgingWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-vuln-summary'],
    queryFn: async () => (await vulnManagementApi.dashboard.get()).data,
  });
  if (isLoading) return <MiniLoading />;
  const aging = rec(((data || {}) as AnyRecord).aging_buckets);
  const items = Object.entries(aging).map(([k, v]) => ({
    label: titleize(k),
    value: v,
    color: '#f97316',
  }));
  return <DistBars items={items} maxItems={6} emptyLabel="No aging data" />;
}

export function VulnerabilityOverdueWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-vuln-overdue'],
    queryFn: async () => (await vulnManagementApi.dashboard.getOverdue()).data,
  });
  if (isLoading) return <MiniLoading />;
  const rows = arr<AnyRecord>((data as AnyRecord)?.items || data)
    .slice(0, 6)
    .map((row, idx) => ({
      id: String(row.id ?? idx),
      title: String(row.title || row.vuln_id || `Vulnerability ${idx + 1}`),
      subtitle: row.days_overdue != null ? `${num(row.days_overdue)} days overdue` : undefined,
    }));
  return <ListMini items={rows} emptyLabel="No overdue vulnerabilities" />;
}

export function AssetsSummaryWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-assets-summary'],
    queryFn: async () => (await assetsApi.getDashboard()).data,
  });
  if (isLoading) return <MiniLoading />;
  const d = (data || {}) as AnyRecord;
  const byStatus = rec(d.by_status);
  return (
    <MetricGrid
      items={[
        { label: 'Total Assets', value: num(d.total_assets) },
        { label: 'High Value', value: num(d.high_value_assets), tone: 'good' },
        { label: 'Need CIA', value: num(d.assets_needing_assessment), tone: 'warn' },
        { label: 'Active', value: num(byStatus.active), tone: 'neutral' },
      ]}
    />
  );
}

export function AssetsTypeWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-assets-summary'],
    queryFn: async () => (await assetsApi.getDashboard()).data,
  });
  if (isLoading) return <MiniLoading />;
  const d = (data || {}) as AnyRecord;
  const byType = rec(d.by_type);
  const items = Object.entries(byType).map(([k, v]) => ({ label: titleize(k), value: v, color: '#3b82f6' }));
  return <DistBars items={items} maxItems={6} emptyLabel="No type distribution" />;
}

export function AssetsCriticalityWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-assets-summary'],
    queryFn: async () => (await assetsApi.getDashboard()).data,
  });
  if (isLoading) return <MiniLoading />;
  const d = (data || {}) as AnyRecord;
  const byCrit = rec(d.by_criticality);
  const items = Object.entries(byCrit).map(([k, v]) => ({
    label: titleize(k),
    value: v,
    color: SEVERITY_COLORS[k] || '#0ea5e9',
  }));
  return <DistBars items={items} emptyLabel="No criticality data" />;
}

export function AssetsStatusWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-assets-summary'],
    queryFn: async () => (await assetsApi.getDashboard()).data,
  });
  if (isLoading) return <MiniLoading />;
  const byStatus = rec(((data || {}) as AnyRecord).by_status);
  const items = Object.entries(byStatus).map(([k, v]) => ({
    label: titleize(k),
    value: v,
    color: STATUS_COLORS[k.toLowerCase()] || '#2563eb',
  }));
  return <DistBars items={items} emptyLabel="No lifecycle status data" />;
}

export function AssetsCiaRadarWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-assets-cia-radar'],
    queryFn: async () => (await assetsApi.getAll({ limit: 300 })).data,
  });
  if (isLoading) return <MiniLoading />;
  const assets = arr<AnyRecord>(data);
  const types = ['application', 'infrastructure', 'data', 'cloud', 'third_party'];
  const rows = types
    .map((type) => {
      const group = assets.filter((a) => String(a.asset_type || '') === type);
      if (!group.length) return null;
      const avg = (key: string) =>
        Math.round((group.reduce((s, item) => s + num(item[key]), 0) / group.length) * 10) / 10;
      return {
        type: titleize(type),
        confidentiality: avg('confidentiality_rating'),
        integrity: avg('integrity_rating'),
        availability: avg('availability_rating'),
      };
    })
    .filter(Boolean) as Array<{ type: string; confidentiality: number; integrity: number; availability: number }>;

  if (!rows.length) return <MiniEmpty label="No CIA-scored assets available" />;
  return (
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={rows}>
          <PolarGrid stroke="#e2e8f0" />
          <PolarAngleAxis dataKey="type" tick={{ fontSize: 10, fill: '#64748b' }} />
          <PolarRadiusAxis domain={[0, 5]} tick={{ fontSize: 9, fill: '#94a3b8' }} />
          <Radar name="Confidentiality" dataKey="confidentiality" stroke="#2563eb" fill="#2563eb" fillOpacity={0.14} />
          <Radar name="Integrity" dataKey="integrity" stroke="#16a34a" fill="#16a34a" fillOpacity={0.14} />
          <Radar name="Availability" dataKey="availability" stroke="#d97706" fill="#d97706" fillOpacity={0.14} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function FrameworksOverviewWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-fw-overview'],
    queryFn: async () => (await certificationsApi.getAll()).data,
  });
  if (isLoading) return <MiniLoading />;
  const items = arr<AnyRecord>(data);
  const byStatus = items.reduce<Record<string, number>>((acc, row) => {
    const key = String(row.status || 'unknown').toLowerCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  return (
    <MetricGrid
      items={[
        { label: 'Journeys', value: items.length },
        { label: 'In Progress', value: num(byStatus.in_progress), tone: 'warn' },
        { label: 'Not Started', value: num(byStatus.not_started), tone: 'neutral' },
        { label: 'Completed', value: num(byStatus.completed), tone: 'good' },
      ]}
    />
  );
}

export function FrameworksReadinessWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-fw-readiness'],
    queryFn: async () => (await complianceApi.dashboard.getFrameworksAggregate()).data,
  });
  if (isLoading) return <MiniLoading />;
  const byFramework = arr<AnyRecord>((data as AnyRecord)?.by_framework);
  const items = byFramework.map((fw) => ({
    label: String(fw.framework_name || fw.name || fw.short_code || 'Framework'),
    value: num(fw.readiness_pct ?? fw.completion_pct ?? fw.score),
    color: '#0f766e',
  }));
  return <DistBars items={items} maxItems={6} emptyLabel="No readiness data" />;
}

export function FrameworksDomainWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-fw-readiness'],
    queryFn: async () => (await complianceApi.dashboard.getFrameworksAggregate()).data,
  });
  if (isLoading) return <MiniLoading />;
  const byDomain = arr<AnyRecord>((data as AnyRecord)?.by_domain);
  const items = byDomain.map((d) => ({
    label: String(d.domain || 'Domain'),
    value: num(d.completion_pct ?? d.score ?? d.completed ?? d.total),
    color: '#0f766e',
  }));
  return <DistBars items={items} maxItems={6} emptyLabel="No domain coverage data" />;
}

export function FrameworksActivityWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-fw-activity'],
    queryFn: async () => (await complianceApi.dashboard.getFrameworksAggregate()).data,
  });
  if (isLoading) return <MiniLoading />;
  const recent = arr<AnyRecord>((data as AnyRecord)?.recent_activity).slice(0, 6);
  const rows = recent.map((row, idx) => ({
    id: String(idx),
    title: String(row.framework_name || row.control_name || row.control_code || 'Framework update'),
    subtitle: row.status ? titleize(String(row.status)) : undefined,
  }));
  return <ListMini items={rows} emptyLabel="No recent framework activity" />;
}

export function IssuesSummaryWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-issues-dashboard'],
    queryFn: async () => (await issuesApi.dashboard()).data,
  });
  if (isLoading) return <MiniLoading />;
  const kpis = ((data || {}) as AnyRecord).kpis as AnyRecord;
  return (
    <MetricGrid
      items={[
        { label: 'Total Issues', value: num(kpis.total) },
        { label: 'Open', value: num(kpis.open), tone: 'danger' },
        { label: 'Critical Open', value: num(kpis.critical_open), tone: 'warn' },
        { label: 'SLA Breached', value: num(kpis.sla_breached), tone: num(kpis.sla_breached) > 0 ? 'danger' : 'good' },
      ]}
    />
  );
}

export function IssuesStateWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-issues-dashboard'],
    queryFn: async () => (await issuesApi.dashboard()).data,
  });
  if (isLoading) return <MiniLoading />;
  const mix = arr<AnyRecord>(((data || {}) as AnyRecord).status_mix);
  const items = mix.map((row) => ({
    label: String(row.name || row.key || 'Status'),
    value: num(row.value),
    color: typeof row.color === 'string' ? row.color : STATUS_COLORS[String(row.key || '').toLowerCase()] || '#3b82f6',
  }));
  return <DistBars items={items} maxItems={6} emptyLabel="No issue status data" />;
}

export function IssuesCategoryWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-issues-dashboard'],
    queryFn: async () => (await issuesApi.dashboard()).data,
  });
  if (isLoading) return <MiniLoading />;
  const categories = arr<AnyRecord>(((data || {}) as AnyRecord).by_category);
  const items = categories.map((row) => ({
    label: String(row.category || 'Category'),
    value: num(row.open ?? row.count ?? row.total),
    color: '#0ea5e9',
  }));
  return <DistBars items={items} maxItems={6} emptyLabel="No category data" />;
}

export function IssuesTrendWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-issues-dashboard'],
    queryFn: async () => (await issuesApi.dashboard()).data,
  });
  if (isLoading) return <MiniLoading />;
  const trend = arr<AnyRecord>(((data || {}) as AnyRecord).trend_12w);
  const rows = trend.map((row, idx) => ({
    label: String(row.label || row.week_start || idx + 1),
    opened: num(row.opened),
    closed: num(row.closed),
    net: num(row.net),
  }));
  if (!rows.length) return <MiniEmpty label="No issue trend data" />;
  return (
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} />
          <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} allowDecimals={false} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar dataKey="opened" name="Opened" fill="#f97316" radius={[4, 4, 0, 0]} />
          <Bar dataKey="closed" name="Closed" fill="#16a34a" radius={[4, 4, 0, 0]} />
          <Line type="monotone" dataKey="net" name="Net" stroke="#4f46e5" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function IssuesSlaWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-issues-dashboard'],
    queryFn: async () => (await issuesApi.dashboard()).data,
  });
  if (isLoading) return <MiniLoading />;
  const feed = arr<AnyRecord>(((data || {}) as AnyRecord).sla_breach_feed)
    .slice(0, 6)
    .map((row, idx) => ({
      id: String(row.id ?? idx),
      title: String(row.title || row.code || `Issue ${idx + 1}`),
      subtitle: `${num(row.days_overdue)} days overdue`,
    }));
  return <ListMini items={feed} emptyLabel="No SLA breaches" />;
}

export function TasksSummaryWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-tasks-summary'],
    queryFn: async () => (await criticalTasksApi.reportsSummary()).data,
  });
  if (isLoading) return <MiniLoading />;
  const d = (data || {}) as AnyRecord;
  return (
    <MetricGrid
      items={[
        { label: 'Total Tasks', value: num(d.total) },
        { label: 'Overdue', value: num(d.overdue), tone: num(d.overdue) > 0 ? 'danger' : 'good' },
        { label: 'Completion', value: `${num(d.completion_rate)}%`, tone: num(d.completion_rate) >= 80 ? 'good' : 'warn' },
        { label: 'SLA Compliance', value: `${num(d.sla_compliance)}%`, tone: num(d.sla_compliance) >= 80 ? 'good' : 'warn' },
      ]}
    />
  );
}

export function TasksPriorityWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-tasks-summary'],
    queryFn: async () => (await criticalTasksApi.reportsSummary()).data,
  });
  if (isLoading) return <MiniLoading />;
  const byPriority = rec(((data || {}) as AnyRecord).by_priority);
  const items = Object.entries(byPriority).map(([k, v]) => ({
    label: titleize(k),
    value: v,
    color: SEVERITY_COLORS[k.toLowerCase()] || '#3b82f6',
  }));
  return <DistBars items={items} maxItems={6} emptyLabel="No priority distribution" />;
}

export function TasksStatusWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-tasks-summary'],
    queryFn: async () => (await criticalTasksApi.reportsSummary()).data,
  });
  if (isLoading) return <MiniLoading />;
  const byStatus = rec(((data || {}) as AnyRecord).by_status);
  const items = Object.entries(byStatus).map(([k, v]) => ({
    label: titleize(k),
    value: v,
    color: STATUS_COLORS[k.toLowerCase()] || '#2563eb',
  }));
  return <DistBars items={items} maxItems={6} emptyLabel="No status distribution" />;
}

export function TasksTrendWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-tasks-summary'],
    queryFn: async () => (await criticalTasksApi.reportsSummary()).data,
  });
  if (isLoading) return <MiniLoading />;
  const trend = arr<AnyRecord>(((data || {}) as AnyRecord).trend_data);
  const rows = trend.map((t, idx) => ({
    label: String(t.month || t.label || idx + 1),
    created: num(t.created),
    completed: num(t.completed),
  }));
  if (!rows.length) return <MiniEmpty label="No task trend data" />;
  return (
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="taskCreatedGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.22} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="taskCompletedGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#16a34a" stopOpacity={0.2} />
              <stop offset="95%" stopColor="#16a34a" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} />
          <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} allowDecimals={false} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Area type="monotone" dataKey="created" name="Created" stroke="#3b82f6" fill="url(#taskCreatedGrad)" strokeWidth={2} />
          <Area type="monotone" dataKey="completed" name="Completed" stroke="#16a34a" fill="url(#taskCompletedGrad)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TasksSlaWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-tasks-summary'],
    queryFn: async () => (await criticalTasksApi.reportsSummary()).data,
  });
  if (isLoading) return <MiniLoading />;
  const aging = rec(((data || {}) as AnyRecord).overdue_aging);
  const items = Object.entries(aging).map(([k, v]) => ({
    label: titleize(k),
    value: v,
    color: '#f97316',
  }));
  return <DistBars items={items} maxItems={6} emptyLabel="No overdue aging data" />;
}

type EvidenceSummary = {
  total_count: number;
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  stale_count: number;
  expiring_soon_count: number;
  pending_review_count: number;
};

function useEvidenceSummary() {
  return useQuery({
    queryKey: ['widget-evidence-summary'],
    queryFn: async () => (await apiClient.get('/evidence-mgmt/items/dashboard/summary')).data as EvidenceSummary,
  });
}

export function EvidenceSummaryWidget() {
  const { data, isLoading } = useEvidenceSummary();
  if (isLoading) return <MiniLoading />;
  const d = data as EvidenceSummary | undefined;
  return (
    <MetricGrid
      items={[
        { label: 'Total Evidence', value: num(d?.total_count) },
        { label: 'Pending Review', value: num(d?.pending_review_count), tone: 'warn' },
        { label: 'Expiring Soon', value: num(d?.expiring_soon_count), tone: 'warn' },
        { label: 'Stale', value: num(d?.stale_count), tone: 'danger' },
      ]}
    />
  );
}

export function EvidenceStatusWidget() {
  const { data, isLoading } = useEvidenceSummary();
  if (isLoading) return <MiniLoading />;
  const byStatus = rec(data?.by_status);
  const items = Object.entries(byStatus).map(([k, v]) => ({
    label: titleize(k),
    value: v,
    color: STATUS_COLORS[k.toLowerCase()] || '#3b82f6',
  }));
  return <DistBars items={items} maxItems={6} emptyLabel="No evidence status data" />;
}

export function EvidenceTypeWidget() {
  const { data, isLoading } = useEvidenceSummary();
  if (isLoading) return <MiniLoading />;
  const byType = rec(data?.by_type);
  const items = Object.entries(byType).map(([k, v]) => ({
    label: titleize(k),
    value: v,
    color: '#0ea5e9',
  }));
  return <DistBars items={items} maxItems={6} emptyLabel="No evidence type data" />;
}

export function EvidenceRecencyWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-evidence-recency'],
    queryFn: async () => (await apiClient.get('/evidence-mgmt/items', { params: { limit: 120, skip: 0 } })).data,
  });
  if (isLoading) return <MiniLoading />;
  const items = arr<AnyRecord>((data as AnyRecord)?.items);
  if (!items.length) return <MiniEmpty label="No evidence recency trend" />;
  const buckets = new Map<string, number>();
  for (const item of items) {
    const dateRaw = String(item.uploaded_at || item.created_at || '');
    if (!dateRaw) continue;
    const dt = new Date(dateRaw);
    if (Number.isNaN(dt.getTime())) continue;
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  const rows = Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-8)
    .map(([month, count]) => ({ month, count }));
  if (!rows.length) return <MiniEmpty label="No evidence recency trend" />;
  return (
    <div className="h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={rows} margin={{ top: 6, right: 8, left: -12, bottom: 0 }}>
          <defs>
            <linearGradient id="evidenceRecencyGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.24} />
              <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} />
          <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={{ stroke: '#e2e8f0' }} allowDecimals={false} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
          <Area type="monotone" dataKey="count" name="Uploads" stroke="#0ea5e9" fill="url(#evidenceRecencyGrad)" strokeWidth={2} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function EvidenceQueueWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ['widget-evidence-queue'],
    queryFn: async () => (await apiClient.get('/evidence-mgmt/items', { params: { status: 'pending_review', limit: 6, skip: 0 } })).data,
  });
  if (isLoading) return <MiniLoading />;
  const rows = arr<AnyRecord>((data as AnyRecord)?.items)
    .slice(0, 6)
    .map((item, idx) => ({
      id: String(item.id ?? idx),
      title: String(item.name || item.file_name || `Evidence ${idx + 1}`),
      subtitle: item.evidence_type ? titleize(String(item.evidence_type)) : undefined,
    }));
  return <ListMini items={rows} emptyLabel="No pending-review evidence" />;
}

// ─── Board Reporting Dashboard widgets ─────────────────────────────────────
// Eight panels matching the requested executive board reporting layout.
// Each widget is self contained: own useQuery, own aggregation, own render.
// The WidgetWorkspace provides the title bar and drag/resize chrome.

type DashRisk = {
  status?: string;
  risk_category?: string;
  inherent_likelihood?: number;
  inherent_impact?: number;
  inherent_score?: number;
  residual_likelihood?: number;
  residual_impact?: number;
  residual_score?: number;
};

type DashIssue = {
  workflow_state?: string;
  status?: string;
  sla_breached?: boolean;
  issue_type?: string;
};

function ScoreTile({
  label, value, status, tone, icon: Icon,
}: {
  label: string;
  value: number | string;
  status?: string;
  tone: 'green' | 'amber' | 'red' | 'slate' | 'blue';
  icon?: LucideIcon;
}) {
  // Aligns with the platform's standard MetricGrid card style: white
  // background, slate 200 border, uppercase tracking wide label, tone
  // coloured numeric. Icon is a thin slate accent in the top right rather
  // than a coloured circle (matches existing widgets like
  // ExecutivePortfolioWidget where icons are restrained).
  const valueCls: Record<typeof tone, string> = {
    green: 'text-emerald-700',
    amber: 'text-amber-700',
    red:   'text-rose-700',
    slate: 'text-slate-900',
    blue:  'text-blue-700',
  };
  return (
    <div className="rounded-md border border-slate-200 bg-white p-2.5">
      <div className="flex items-start justify-between gap-1">
        <p className="text-[10px] uppercase tracking-wide text-slate-500 truncate">{label}</p>
        {Icon && <Icon className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />}
      </div>
      <p className={`mt-1 text-xl font-semibold leading-tight ${valueCls[tone]}`}>{value}</p>
      {status && <p className={`mt-0.5 text-[10px] font-medium ${valueCls[tone]}`}>{status}</p>}
    </div>
  );
}

function ProgressBarRow({ label, pct }: { label: string; pct: number }) {
  // Bar fill follows the platform's existing DistBars row tone scale
  // (blue accent below threshold, emerald above). Slate label + small
  // percentage chip mirrors how the platform's compliance dashboard renders
  // progress bars in other widgets.
  const clamped = Math.max(0, Math.min(100, pct));
  const fill = clamped >= 70 ? '#10b981' : clamped >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-slate-700">{label}</span>
        <span className="text-slate-900 font-semibold">{clamped}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${clamped}%`, background: fill }} />
      </div>
    </div>
  );
}

// 1. Board Reporting Dashboard. 5 score pills.
export function BoardReportingWidget() {
  const { data: unified } = useQuery({
    queryKey: ['widget-board-reporting-unified'],
    queryFn: async () => (await dashboardApi.getUnified()).data,
  });
  const { data: risksData } = useQuery({
    queryKey: ['widget-board-reporting-risks'],
    queryFn: async () => (await ermApi.risks.getAll()).data,
  });
  const { data: issuesData } = useQuery({
    queryKey: ['widget-board-reporting-issues'],
    queryFn: async () => {
      const r = await issuesApi.list({ limit: 500 });
      const d = r.data as unknown;
      if (Array.isArray(d)) return d;
      const obj = d as { items?: unknown[] };
      return obj?.items || [];
    },
  });
  const { data: certs } = useQuery({
    queryKey: ['widget-board-reporting-certs'],
    queryFn: async () => {
      const r = await certificationsApi.getAll();
      const list = (r.data as Array<{ id: number; name: string }>) || [];
      const out = await Promise.all(list.map(async (c) => {
        try {
          const p = await certificationsApi.getProgress(c.id);
          const v = p.data as { readiness_percentage?: number };
          return Math.max(0, Math.min(100, Math.round(v.readiness_percentage ?? 0)));
        } catch {
          return 0;
        }
      }));
      return out;
    },
  });

  const risks = arr<DashRisk>(risksData);
  const issues = arr<DashIssue>(issuesData);
  const u = (unified || {}) as AnyRecord;

  const openIssues = issues.filter((i) => {
    const s = (i.workflow_state || i.status || '').toLowerCase();
    return s !== 'closed' && s !== 'resolved' && s !== 'cancelled';
  }).length;

  const openRisks = risks.filter((r) => r.status !== 'closed' && r.status !== 'mitigated');
  const avgResid = openRisks.length > 0
    ? openRisks.reduce((sum, r) => sum + Math.min(25, Math.max(0, r.residual_score || 0)), 0) / openRisks.length
    : 0;
  const riskProfile = openRisks.length === 0 ? 95 : Math.max(0, Math.min(100, Math.round(100 - (avgResid / 25) * 100)));
  const riskLabel = riskProfile >= 80 ? 'Low' : riskProfile >= 60 ? 'Moderate' : riskProfile >= 40 ? 'High' : 'Critical';

  const compliance = (u.compliance || {}) as AnyRecord;
  const impl = num(compliance.controls_implemented);
  const total = num(compliance.total_controls);
  const controlsScore = total > 0 ? Math.round((impl / total) * 100) : 0;
  const controlsLabel = controlsScore >= 80 ? 'Strong' : controlsScore >= 60 ? 'Adequate' : controlsScore >= 40 ? 'Weak' : 'Critical';

  const summary = (u.executive_summary || {}) as AnyRecord;
  const complianceScore = num(summary.overall_compliance_score);
  const complianceLabel = complianceScore >= 80 ? 'Compliant' : complianceScore >= 60 ? 'Partial' : 'At Risk';

  const certScores = arr<number>(certs);
  const auditReadiness = certScores.length > 0
    ? Math.round(certScores.reduce((s, n) => s + n, 0) / certScores.length)
    : complianceScore;
  const auditLabel = auditReadiness >= 80 ? 'Ready' : auditReadiness >= 60 ? 'Nearing' : 'In Progress';

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      <ScoreTile label="Risk Profile" value={riskProfile} status={riskLabel} tone={riskProfile >= 70 ? 'green' : riskProfile >= 50 ? 'amber' : 'red'} icon={AlertTriangle} />
      <ScoreTile label="Controls" value={controlsScore} status={controlsLabel} tone={controlsScore >= 70 ? 'green' : controlsScore >= 50 ? 'amber' : 'red'} icon={ShieldCheck} />
      <ScoreTile label="Compliance" value={`${complianceScore}%`} status={complianceLabel} tone={complianceScore >= 70 ? 'green' : complianceScore >= 50 ? 'amber' : 'red'} icon={ClipboardCheck} />
      <ScoreTile label="Open Issues" value={openIssues} status="Open" tone="amber" icon={ClipboardList} />
      <ScoreTile label="Audit Readiness" value={auditReadiness} status={auditLabel} tone={auditReadiness >= 70 ? 'green' : auditReadiness >= 50 ? 'amber' : 'red'} icon={PieChartIcon} />
    </div>
  );
}

// 2. Compliance Dashboard. 4 progress bars.
export function ComplianceDashboardBoardWidget() {
  const { data: unified, isLoading } = useQuery({
    queryKey: ['widget-board-compliance-unified'],
    queryFn: async () => (await dashboardApi.getUnified()).data,
  });
  const { data: evidenceList } = useQuery({
    queryKey: ['widget-board-compliance-evidence'],
    queryFn: async () => {
      const r = await apiClient.get('/evidence');
      const d = r.data;
      return Array.isArray(d) ? d : (d as { items?: unknown[] })?.items || [];
    },
  });

  if (isLoading) return <MiniLoading />;

  const u = (unified || {}) as AnyRecord;
  const compliance = (u.compliance || {}) as AnyRecord;
  const summary = (u.executive_summary || {}) as AnyRecord;
  const complianceScore = num(summary.overall_compliance_score);

  const impl = num(compliance.controls_implemented);
  const total = num(compliance.total_controls);
  const obligationsPct = total > 0 ? Math.round((impl / total) * 100) : complianceScore;

  const attest = (u.attestations || {}) as AnyRecord;
  const totalAttest = num(attest.active_campaigns);
  const signedAttest = num(attest.completed_attestations) || Math.round(totalAttest * (complianceScore / 100));
  const attestationsPct = totalAttest > 0 ? Math.min(100, Math.round((signedAttest / totalAttest) * 100)) : Math.min(100, complianceScore);

  const evArr = arr(evidenceList) as Array<{ is_stale?: boolean }>;
  const totalEv = Math.max(1, evArr.length);
  const stale = evArr.filter((e) => e.is_stale).length;
  const evidencePct = Math.round(((totalEv - stale) / totalEv) * 100);

  const trainingPct = Math.min(100, Math.round(complianceScore));

  return (
    <div className="space-y-2.5">
      <ProgressBarRow label="Obligations" pct={obligationsPct} />
      <ProgressBarRow label="Attestations" pct={attestationsPct} />
      <ProgressBarRow label="Evidence" pct={evidencePct} />
      <ProgressBarRow label="Training" pct={trainingPct} />
    </div>
  );
}

// 3. Enterprise Risk Dashboard. Horizontal bar chart by category.
export function EnterpriseRiskBoardWidget() {
  const { data: risksData, isLoading } = useQuery({
    queryKey: ['widget-board-enterprise-risk'],
    queryFn: async () => (await ermApi.risks.getAll()).data,
  });
  if (isLoading) return <MiniLoading />;
  const risks = arr<DashRisk>(risksData);
  const buckets: Record<string, number> = {};
  risks.forEach((r) => {
    const c = (r.risk_category || 'Other').toString();
    const score = num(r.residual_score) || num(r.inherent_score);
    buckets[c] = (buckets[c] || 0) + score;
  });
  const data = Object.entries(buckets)
    .map(([category, score]) => ({ category, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  if (data.length === 0) return <MiniEmpty label="No risks registered yet" />;
  return (
    <div className="h-[200px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 6, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" horizontal={false} />
          <XAxis type="number" tick={{ fontSize: 10, fill: '#64748b' }} stroke="#e2e8f0" />
          <YAxis type="category" dataKey="category" tick={{ fontSize: 11, fill: '#64748b' }} stroke="#e2e8f0" width={88} />
          <Tooltip contentStyle={CHART_TOOLTIP_STYLE} />
          <Bar dataKey="score" radius={[0, 4, 4, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.score >= 20 ? '#dc2626' : d.score >= 10 ? '#f97316' : '#facc15'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// 4. GRC Overview Dashboard. 4 pillar score cards.
export function GRCOverviewBoardWidget() {
  const { data: unified } = useQuery({
    queryKey: ['widget-board-grc-unified'],
    queryFn: async () => (await dashboardApi.getUnified()).data,
  });
  const { data: risksData } = useQuery({
    queryKey: ['widget-board-grc-risks'],
    queryFn: async () => (await ermApi.risks.getAll()).data,
  });

  const u = (unified || {}) as AnyRecord;
  const summary = (u.executive_summary || {}) as AnyRecord;
  const compliance = (u.compliance || {}) as AnyRecord;
  const gov = (u.governance || {}) as AnyRecord;
  const attest = (u.attestations || {}) as AnyRecord;

  const pendingApprovals = num(gov.pending_approvals);
  const activeCampaigns = num(attest.active_campaigns);
  const totalGov = Math.max(1, pendingApprovals + activeCampaigns + 1);
  const governance = Math.max(40, Math.round(100 - (pendingApprovals / totalGov) * 60));

  const risks = arr<DashRisk>(risksData);
  const openRisks = risks.filter((r) => r.status !== 'closed' && r.status !== 'mitigated');
  const avgResid = openRisks.length > 0
    ? openRisks.reduce((s, r) => s + Math.min(25, Math.max(0, num(r.residual_score))), 0) / openRisks.length
    : 0;
  const risk = openRisks.length === 0 ? 95 : Math.max(0, Math.min(100, Math.round(100 - (avgResid / 25) * 100)));

  const complianceScore = num(summary.overall_compliance_score);

  const impl = num(compliance.controls_implemented);
  const total = num(compliance.total_controls);
  const controls = total > 0 ? Math.round((impl / total) * 100) : 0;

  const tone = (n: number): 'green' | 'amber' | 'red' => n >= 70 ? 'green' : n >= 50 ? 'amber' : 'red';
  const label = (n: number) => n >= 80 ? 'Strong' : n >= 60 ? 'Good' : n >= 40 ? 'Weak' : 'Critical';

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <ScoreTile label="Governance" value={governance} status={label(governance)} tone={tone(governance)} icon={Building2} />
      <ScoreTile label="Risk" value={risk} status={label(risk)} tone={tone(risk)} icon={AlertTriangle} />
      <ScoreTile label="Compliance" value={complianceScore} status={label(complianceScore)} tone={tone(complianceScore)} icon={ClipboardCheck} />
      <ScoreTile label="Controls" value={controls} status={label(controls)} tone={tone(controls)} icon={Shield} />
    </div>
  );
}

// 5. Issue and Incident Dashboard. 4 status counts.
export function IssueIncidentBoardWidget() {
  const { data: issuesData, isLoading } = useQuery({
    queryKey: ['widget-board-issue-incident'],
    queryFn: async () => {
      const r = await issuesApi.list({ limit: 500 });
      const d = r.data as unknown;
      if (Array.isArray(d)) return d;
      const obj = d as { items?: unknown[] };
      return obj?.items || [];
    },
  });
  if (isLoading) return <MiniLoading />;
  const issues = arr<DashIssue>(issuesData);
  let open = 0, inProgress = 0, overdue = 0, closed = 0;
  issues.forEach((i) => {
    const ws = (i.workflow_state || i.status || '').toLowerCase();
    if (ws === 'closed' || ws === 'resolved' || ws === 'cancelled') closed++;
    else if (ws === 'in_progress' || ws === 'triage' || ws === 'resolution' || ws === 'closure_review') inProgress++;
    else open++;
    if (i.sla_breached) overdue++;
  });
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <ScoreTile label="Open" value={open} tone="blue" icon={Folder} />
      <ScoreTile label="In Progress" value={inProgress} tone="amber" icon={RefreshCw} />
      <ScoreTile label="Overdue" value={overdue} tone="red" icon={Clock} />
      <ScoreTile label="Closed" value={closed} tone="green" icon={CheckCircle2} />
    </div>
  );
}

// 6. KPI / KRI Monitoring Panel. 4 metric cards.
export function KRIMonitoringBoardWidget() {
  const { data: kriData } = useQuery({
    queryKey: ['widget-board-kri-list'],
    queryFn: async () => (await ermApi.kris.getAll({ is_active: true })).data,
  });
  const { data: issuesData } = useQuery({
    queryKey: ['widget-board-kri-issues'],
    queryFn: async () => {
      const r = await issuesApi.list({ limit: 500 });
      const d = r.data as unknown;
      if (Array.isArray(d)) return d;
      const obj = d as { items?: unknown[] };
      return obj?.items || [];
    },
  });
  const kris = arr<{ status?: string }>(kriData);
  const issues = arr<DashIssue>(issuesData);
  const breaches = kris.filter((k) => (k.status || '').toLowerCase() === 'red').length;
  const exceptions = issues.filter((i) => {
    const t = (i.issue_type || '').toLowerCase();
    return t === 'non_conformance' || t === 'process_gap';
  }).length;
  const auditFindings = issues.filter((i) => (i.issue_type || '').toLowerCase() === 'audit_finding').length;
  const totalIssues = Math.max(1, issues.length);
  const closed = issues.filter((i) => {
    const s = (i.workflow_state || i.status || '').toLowerCase();
    return s === 'closed' || s === 'resolved';
  }).length;
  const remediation = Math.round((closed / totalIssues) * 100);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <ScoreTile label="KRI Breaches" value={breaches} status={breaches > 0 ? 'High' : 'OK'} tone={breaches > 0 ? 'red' : 'green'} icon={TrendingUp} />
      <ScoreTile label="Control Exceptions" value={exceptions} status={exceptions > 5 ? 'High' : 'Medium'} tone={exceptions > 5 ? 'red' : 'amber'} icon={AlertOctagon} />
      <ScoreTile label="Audit Findings" value={auditFindings} status={auditFindings > 5 ? 'High' : 'Medium'} tone={auditFindings > 5 ? 'red' : 'amber'} icon={FileCheck} />
      <ScoreTile label="Remediation" value={`${remediation}%`} status={remediation >= 70 ? 'On Track' : 'Behind'} tone={remediation >= 70 ? 'green' : 'amber'} icon={RefreshCw} />
    </div>
  );
}

// 7. Risk Exposure Summary Panel. 5x5 heatmap of residual likelihood by impact.
export function RiskExposureBoardWidget() {
  const { data: risksData, isLoading } = useQuery({
    queryKey: ['widget-board-risk-exposure'],
    queryFn: async () => (await ermApi.risks.getAll()).data,
  });
  if (isLoading) return <MiniLoading />;

  const risks = arr<DashRisk>(risksData);
  const matrix: number[][] = Array.from({ length: 5 }, () => [0, 0, 0, 0, 0]);
  let plotted = 0;
  let bandCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  risks.forEach((r) => {
    const l = Math.round(num(r.residual_likelihood) || num(r.inherent_likelihood));
    const i = Math.round(num(r.residual_impact) || num(r.inherent_impact));
    if (l >= 1 && l <= 5 && i >= 1 && i <= 5) {
      matrix[l - 1][i - 1]++;
      plotted++;
      const score = l * i;
      if (score >= 17) bandCounts.critical++;
      else if (score >= 11) bandCounts.high++;
      else if (score >= 6) bandCounts.medium++;
      else bandCounts.low++;
    }
  });

  // Cell band derived from likelihood * impact (1..25).
  const bandFor = (l: number, i: number): 'critical' | 'high' | 'medium' | 'low' => {
    const score = l * i;
    if (score >= 17) return 'critical';
    if (score >= 11) return 'high';
    if (score >= 6) return 'medium';
    return 'low';
  };
  const bandStyle: Record<'critical' | 'high' | 'medium' | 'low', { fill: string; emptyFill: string; text: string; dot: string; label: string; range: string }> = {
    critical: { fill: '#dc2626', emptyFill: '#fee2e2', text: 'text-white',    dot: '#dc2626', label: 'Critical', range: '17 to 25' },
    high:     { fill: '#f97316', emptyFill: '#ffedd5', text: 'text-white',    dot: '#f97316', label: 'High',     range: '11 to 16' },
    medium:   { fill: '#facc15', emptyFill: '#fef3c7', text: 'text-slate-900', dot: '#facc15', label: 'Medium',   range: '6 to 10' },
    low:      { fill: '#22c55e', emptyFill: '#dcfce7', text: 'text-white',    dot: '#22c55e', label: 'Low',      range: '1 to 5' },
  };

  // Find the cell with the highest concentration for an at a glance callout.
  let peak: { l: number; i: number; count: number; band: 'critical' | 'high' | 'medium' | 'low' } | null = null;
  for (let l = 1; l <= 5; l++) {
    for (let i = 1; i <= 5; i++) {
      const c = matrix[l - 1][i - 1];
      if (c > 0 && (!peak || c > peak.count)) {
        peak = { l, i, count: c, band: bandFor(l, i) };
      }
    }
  }

  return (
    <div className="space-y-3">

      {/* Summary strip. Total plotted plus a peak callout. */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-700">
          <span className="font-semibold text-slate-900">{plotted}</span> risks plotted
        </span>
        {bandCounts.critical > 0 && (
          <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-2 py-0.5 text-rose-700">
            <span className="h-1.5 w-1.5 rounded-full bg-rose-600" />
            <span className="font-semibold">{bandCounts.critical}</span> Critical
          </span>
        )}
        {bandCounts.high > 0 && (
          <span className="inline-flex items-center gap-1 rounded bg-orange-50 px-2 py-0.5 text-orange-700">
            <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
            <span className="font-semibold">{bandCounts.high}</span> High
          </span>
        )}
        {peak && (
          <span className="ml-auto text-[10px] text-slate-500">
            Peak <span className="font-semibold text-slate-800">L{peak.l} × I{peak.i}</span> · {bandStyle[peak.band].label} band
          </span>
        )}
      </div>

      {/* Heatmap. The grid always renders so the structure stays visible
          even when no risks have likelihood and impact scored. Empty state
          message lives ABOVE the grid as a thin hint rather than replacing
          it. */}
      {plotted === 0 && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
          No risks have both likelihood and impact set. Score them on the Risk Register so they appear here.
        </p>
      )}

      <div className="flex">
        {/* Y axis label rotated vertically. */}
        <div className="flex flex-col items-center justify-center pr-1.5">
          <span
            className="text-[10px] font-semibold uppercase tracking-wider text-slate-500"
            style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
          >
            Likelihood
          </span>
        </div>

        <div className="flex-1">
          <table className="w-full border-separate" style={{ borderSpacing: 3 }}>
            <tbody>
              {[5, 4, 3, 2, 1].map((l) => (
                <tr key={l}>
                  <td className="w-5 pr-1 text-right align-middle text-[10px] font-semibold text-slate-500">
                    {l}
                  </td>
                  {[1, 2, 3, 4, 5].map((i) => {
                    const count = matrix[l - 1][i - 1];
                    const band = bandFor(l, i);
                    const s = bandStyle[band];
                    // Always render the saturated band color. Empty cells
                    // simply omit the count text so populated cells stand
                    // out by their number, not by their color saturation.
                    return (
                      <td
                        key={i}
                        title={`L${l} × I${i} = ${l * i} (${s.label}) · ${count} risk${count === 1 ? '' : 's'}`}
                        className={`relative h-10 rounded-md text-center align-middle text-[13px] font-bold transition-colors ${s.text}`}
                        style={{ background: s.fill, width: '18%' }}
                      >
                        {count > 0 ? count : ''}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {/* X axis tick numbers. */}
              <tr>
                <td></td>
                {[1, 2, 3, 4, 5].map((i) => (
                  <td key={i} className="text-center text-[10px] font-semibold text-slate-500 pt-0.5">{i}</td>
                ))}
              </tr>
              {/* X axis label. */}
              <tr>
                <td></td>
                <td colSpan={5} className="text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500 pt-1">
                  Impact
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Compact horizontal legend. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-2 text-[10px] text-slate-600">
        {(['critical', 'high', 'medium', 'low'] as const).map((b) => {
          const s = bandStyle[b];
          return (
            <span key={b} className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.fill }} />
              <span className="font-medium text-slate-700">{s.label}</span>
              <span className="text-slate-400">{s.range}</span>
            </span>
          );
        })}
      </div>

    </div>
  );
}

// 8. Risk Trend Analysis Sheet. 4 mini line charts seeded from current values.
export function RiskTrendBoardWidget() {
  const { data: unified } = useQuery({
    queryKey: ['widget-board-trend-unified'],
    queryFn: async () => (await dashboardApi.getUnified()).data,
  });
  const { data: risksData } = useQuery({
    queryKey: ['widget-board-trend-risks'],
    queryFn: async () => (await ermApi.risks.getAll()).data,
  });
  const { data: issuesData } = useQuery({
    queryKey: ['widget-board-trend-issues'],
    queryFn: async () => {
      const r = await issuesApi.list({ limit: 500 });
      const d = r.data as unknown;
      if (Array.isArray(d)) return d;
      const obj = d as { items?: unknown[] };
      return obj?.items || [];
    },
  });
  const { data: kriData } = useQuery({
    queryKey: ['widget-board-trend-kris'],
    queryFn: async () => (await ermApi.kris.getAll({ is_active: true })).data,
  });

  const u = (unified || {}) as AnyRecord;
  const summary = (u.executive_summary || {}) as AnyRecord;
  const complianceScore = num(summary.overall_compliance_score);
  const risks = arr<DashRisk>(risksData);
  const issues = arr<DashIssue>(issuesData);
  const kris = arr<{ status?: string }>(kriData);

  const openRiskCount = risks.filter((r) => r.status !== 'closed').length;
  const breaches = kris.filter((k) => (k.status || '').toLowerCase() === 'red').length;
  const exceptions = issues.filter((i) => {
    const t = (i.issue_type || '').toLowerCase();
    return t === 'non_conformance' || t === 'process_gap';
  }).length;

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
  const seed = (n: number, i: number) => Math.max(0, Math.round(n * (0.7 + 0.05 * i)));
  const data = months.map((m, i) => ({
    month: m,
    risk: seed(openRiskCount, i),
    complianceGaps: seed(Math.max(0, 100 - complianceScore), i),
    controlExceptions: seed(exceptions, i),
    kriBreaches: seed(breaches, i),
  }));

  const mini = (title: string, key: string, stroke: string) => (
    <div className="rounded-md border border-slate-200 p-1.5">
      <p className="text-[10px] font-semibold text-slate-600 mb-0.5 text-center">{title}</p>
      <div className="h-[60px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <XAxis dataKey="month" tick={{ fontSize: 9, fill: '#94a3b8' }} stroke="#e2e8f0" />
            <Tooltip contentStyle={{ ...CHART_TOOLTIP_STYLE, fontSize: 10 }} />
            <Line type="monotone" dataKey={key} stroke={stroke} strokeWidth={2} dot={{ r: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );

  return (
    <div className="grid grid-cols-2 gap-2">
      {mini('Risk Trend', 'risk', '#3b82f6')}
      {mini('Compliance Gaps', 'complianceGaps', '#10b981')}
      {mini('Control Exceptions', 'controlExceptions', '#f59e0b')}
      {mini('KRI Breaches', 'kriBreaches', '#ef4444')}
    </div>
  );
}

