'use client';


import { PageLoader } from '@/components/ui';
export const dynamic = 'force-dynamic';

import { useQuery } from '@tanstack/react-query';
import { vulnManagementApi } from '@/lib/api';
import {
  Loader2,
  RefreshCw,
  Shield,
  Users,
  Building2,
  AlertTriangle,
  TrendingUp,
  Download,
  FileText,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Legend,
  LineChart,
  Line,
  CartesianGrid,
} from 'recharts';
import { useState, useMemo } from 'react';

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface DashboardData {
  total_vulnerabilities: number;
  by_severity: Record<string, number>;
  by_status: Record<string, number>;
  sla_compliance: Record<string, { total: number; resolved: number; on_time: number; compliance_rate: number }>;
  overdue_count: number;
  mttr_days: number | null;
  aging_buckets: Record<string, number>;
  top_affected_assets?: Array<{ asset_id: number; asset_name: string; vulnerability_count: number }>;
  recent_activities?: Array<{ id: number; vuln_id: string; title: string; status: string; updated_at: string }>;
  by_assignee?: Record<string, number>;
  mitigation_coverage?: { with_mitigations: number; without_mitigations: number };
  by_department?: Record<string, number>;
}

interface DiscoveryTrend {
  date: string;
  discovered: number;
  resolved: number;
}

// â”€â”€â”€ Color Palettes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const SEV_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high:     '#f97316',
  medium:   '#eab308',
  low:      '#22c55e',
  info:     '#06b6d4',
};

const STATUS_COLORS: Record<string, string> = {
  open:        '#ef4444',
  in_progress: '#f97316',
  remediated:  '#22c55e',
  verified:    '#06b6d4',
  closed:      '#8b5cf6',
  accepted:    '#64748b',
};

const PALETTE = [
  '#6366f1', '#ec4899', '#f97316', '#eab308',
  '#22c55e', '#06b6d4', '#8b5cf6', '#f43f5e',
  '#14b8a6', '#a855f7', '#0ea5e9', '#84cc16',
];

const RESOLVED_STATUSES = ['remediated', 'verified', 'closed'];

// â”€â”€â”€ Mini Donut â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function MiniDonut({
  label, value, total, color,
}: {
  label: string; value: number; total: number; color: string;
}) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  const data = [{ value: pct }, { value: Math.max(0, 100 - pct) }];
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col items-center gap-2 hover:shadow-md transition-all">
      <div className="relative w-[76px] h-[76px]">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data} cx="50%" cy="50%"
              innerRadius={24} outerRadius={36}
              paddingAngle={2} dataKey="value"
              startAngle={90} endAngle={-270}
            >
              <Cell fill={color} />
              <Cell fill="#f1f5f9" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-sm font-bold" style={{ color }}>{pct}%</span>
        </div>
      </div>
      <p className="text-[11px] font-semibold text-gray-600 text-center leading-tight">{label}</p>
      <p className="text-lg font-bold text-gray-900">{value}</p>
    </div>
  );
}

// â”€â”€â”€ Tooltips â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const TrendTooltip = ({
  active, payload, label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }}>{p.name}: <strong>{p.value}</strong></p>
      ))}
    </div>
  );
};

const PieTip = ({
  active, payload,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload: { pct: number } }>;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg text-xs">
      <p className="font-semibold text-gray-700 capitalize">{payload[0].name}</p>
      <p className="text-gray-500">{payload[0].value} ({payload[0].payload.pct ?? 0}%)</p>
    </div>
  );
};

// â”€â”€â”€ Treemap cell renderer â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const TreeBlock = (props: Record<string, unknown>) => {
  const x = (props.x as number) ?? 0;
  const y = (props.y as number) ?? 0;
  const w = (props.width as number) ?? 0;
  const h = (props.height as number) ?? 0;
  const name = (props.name as string) ?? '';
  const fill = (props.fill as string) ?? '#94a3b8';
  if (w < 8 || h < 8) return null;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill={fill} stroke="#fff" strokeWidth={2} rx={4} />
      {w > 45 && h > 20 && (
        <text
          x={x + w / 2} y={y + h / 2}
          textAnchor="middle" dominantBaseline="middle"
          fill="#fff" fontSize={10} fontWeight={600}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {name.length > 14 ? name.slice(0, 13) + '...' : name}
        </text>
      )}
    </g>
  );
};

// â”€â”€â”€ Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Period selector for the trend section. Sent as `period` query param to
// the backend; the server resolves the implied bucket size (day/week/month).
type TrendPeriod = '60d' | '90d' | 'quarter' | '180d' | '365d';
const PERIOD_LABEL: Record<TrendPeriod, string> = {
  '60d': '60 days',
  '90d': '90 days',
  'quarter': 'Quarter',
  '180d': '2 quarters',
  '365d': '1 year',
};

interface TrendBucket { date: string; count: number }
interface TrendsResponse {
  period: string;
  bucket: 'day' | 'week' | 'month';
  buckets: string[];
  discovered: TrendBucket[];
  resolved: TrendBucket[];
  net_open_delta: TrendBucket[];
  status_changes: TrendBucket[];
  summary: {
    period_days: number;
    bucket: string;
    start: string;
    end: string;
    total_discovered: number;
    total_resolved: number;
    net_change: number;
    total_status_changes: number;
    mttr_days_within_window: number | null;
    fixed_vs_new_ratio: number | null;
    task_progress: { total: number; by_status: Record<string, number> };
  };
}

export default function VulnerabilityDashboardPage() {
  const [selectedSeverity, setSelectedSeverity] = useState<string | null>(null);
  const [trendPeriod, setTrendPeriod] = useState<TrendPeriod>('90d');
  const [reportDownloading, setReportDownloading] = useState(false);

  const { data: dashboard, isLoading, refetch } = useQuery({
    queryKey: ['vuln-dashboard'],
    queryFn: async () => {
      const res = await vulnManagementApi.dashboard.get();
      return res.data as DashboardData;
    },
    refetchInterval: 60000,
  });

  const { data: trends } = useQuery({
    queryKey: ['vuln-trends', trendPeriod],
    queryFn: async () => {
      const res = await vulnManagementApi.dashboard.getTrends({ period: trendPeriod });
      return res.data as TrendsResponse;
    },
    refetchInterval: 120000,
  });

  const handleDownloadReport = async () => {
    setReportDownloading(true);
    try {
      const res = await vulnManagementApi.dashboard.downloadReport({ period: trendPeriod, fmt: 'pdf' });
      // Honour whatever media type the server actually sent (it falls back
      // to text/plain when reportlab isn't available on the deployment).
      const headers = res.headers as Record<string, string> | undefined;
      const contentType = (headers?.['content-type'] || 'application/pdf').toString();
      const isPdf = contentType.includes('pdf');
      const blob = new Blob([res.data as BlobPart], { type: isPdf ? 'application/pdf' : 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vulnerability-report-${trendPeriod}.${isPdf ? 'pdf' : 'txt'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download vulnerability report', err);
    } finally {
      setReportDownloading(false);
    }
  };

  const { data: trendData } = useQuery({
    queryKey: ['vuln-discovery-trend'],
    queryFn: async () => {
      const res = await vulnManagementApi.dashboard.getDiscoveryTrend(12);
      return res.data as DiscoveryTrend[];
    },
    refetchInterval: 60000,
  });

  // â”€â”€ Derived values â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const total        = dashboard?.total_vulnerabilities ?? 0;
  const bySev        = dashboard?.by_severity ?? {};
  const byStat       = dashboard?.by_status ?? {};
  const agingBuck    = dashboard?.aging_buckets ?? {};
  const byAssignee   = dashboard?.by_assignee ?? {};
  const mitCov       = dashboard?.mitigation_coverage ?? { with_mitigations: 0, without_mitigations: 0 };
  const byDept       = dashboard?.by_department ?? {};
  const overdueCount = dashboard?.overdue_count ?? 0;
  const mttr         = dashboard?.mttr_days;

  const resolvedCount = RESOLVED_STATUSES.reduce((s, k) => s + (byStat[k] ?? 0), 0);
  const openCount     = (byStat['open'] ?? 0) + (byStat['in_progress'] ?? 0);

  const slaPercent = useMemo(() => {
    const sla = dashboard?.sla_compliance;
    if (!sla) return 0;
    const vals = Object.values(sla);
    if (!vals.length) return 0;
    // compliance_rate is already 0-100; just average across severity buckets
    const avg = vals.reduce((s, v) => s + (v.compliance_rate ?? 0), 0) / vals.length;
    return Math.min(100, Math.max(0, Math.round(avg)));
  }, [dashboard]);

  const slaColor = slaPercent >= 80 ? '#22c55e' : slaPercent >= 60 ? '#eab308' : '#ef4444';

  // Severity donut data
  const severityData = Object.entries(bySev)
    .filter(([, v]) => v > 0)
    .sort((a, b) =>
      ['critical', 'high', 'medium', 'low', 'info'].indexOf(a[0]) -
      ['critical', 'high', 'medium', 'low', 'info'].indexOf(b[0])
    )
    .map(([k, v]) => ({
      name: k, value: v,
      pct: total > 0 ? Math.round((v / total) * 100) : 0,
      fill: SEV_COLORS[k] ?? '#94a3b8',
    }));

  // Status donut data
  const statusData = Object.entries(byStat)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({
      name: k.replace(/_/g, ' '), value: v,
      pct: total > 0 ? Math.round((v / total) * 100) : 0,
      fill: STATUS_COLORS[k] ?? '#94a3b8',
    }));

  // Aging bars
  const agingData = Object.entries(agingBuck).map(([k, v]) => ({
    name: k, value: v,
    fill: k.startsWith('90') ? '#ef4444' : k.startsWith('31') ? '#f97316' : k.startsWith('8') ? '#eab308' : '#22c55e',
  }));

  // Assignee donut
  const assigneeData = Object.entries(byAssignee)
    .sort((a, b) => b[1] - a[1]).slice(0, 10)
    .map(([name, count], i) => ({ name, value: count, fill: PALETTE[i % PALETTE.length] }));

  // Mitigation donut
  const mitData = [
    { name: 'With mitigations',    value: mitCov.with_mitigations,    pct: total > 0 ? Math.round((mitCov.with_mitigations / total) * 100) : 0, fill: '#22c55e' },
    { name: 'Without mitigations', value: mitCov.without_mitigations, pct: total > 0 ? Math.round((mitCov.without_mitigations / total) * 100) : 0, fill: '#ef4444' },
  ].filter((d) => d.value > 0);

  // Dept bar
  const deptData = Object.entries(byDept)
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([name, count], i) => ({
      name: name.length > 16 ? name.slice(0, 15) + '...' : name,
      count, fill: PALETTE[i % PALETTE.length],
    }));

  // Gauge data
  const gaugeData = [{ name: 'SLA', value: slaPercent, fill: slaColor }];

  // Treemap: flat severity Ã— status breakdown
  const treemapData = useMemo(() => {
    const items: { name: string; size: number; fill: string }[] = [];
    for (const [sev, sevCount] of Object.entries(bySev)) {
      if (!sevCount) continue;
      for (const [stat, statCount] of Object.entries(byStat)) {
        if (!statCount) continue;
        const size = Math.max(1, Math.round((sevCount * statCount) / Math.max(1, total)));
        items.push({ name: `${sev} - ${stat.replace(/_/g, ' ')}`, size, fill: SEV_COLORS[sev] ?? '#94a3b8' });
      }
    }
    return items;
  }, [bySev, byStat, total]);

  // â”€â”€ Loading â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (isLoading) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <PageLoader size="md" />
      </div>
    );
  }

  // â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  return (
    <div className="space-y-4 sm:space-y-5 px-1 sm:px-2 pt-1">

      {/* -- Header -- */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900">Security Overview</h2>
          <p className="text-xs text-gray-500">Real-time vulnerability posture across your organisation</p>
        </div>
        <button
          onClick={() => refetch()}
          className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-3 border-l-4 border-l-blue-500">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Total</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{total}</p>
          <p className="text-xs text-gray-400 mt-1">vulnerabilities tracked</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-3 border-l-4 border-l-red-500">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Critical / High</p>
          <p className="text-2xl font-bold text-red-600 mt-1">
            {(bySev['critical'] ?? 0) + (bySev['high'] ?? 0)}
          </p>
          <p className="text-xs text-gray-400 mt-1">immediate attention</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-3 border-l-4 border-l-amber-500">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">MTTR</p>
          <p className="text-2xl font-bold text-amber-600 mt-1">{mttr != null ? `${mttr}d` : '-'}</p>
          <p className="text-xs text-gray-400 mt-1">mean time to remediate</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-3 border-l-4" style={{ borderLeftColor: slaColor }}>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">SLA Compliance</p>
          <p className="text-2xl font-bold mt-1" style={{ color: slaColor }}>{slaPercent}%</p>
          <p className="text-xs text-gray-400 mt-1">{overdueCount} overdue</p>
        </div>
      </div>

      {/* Trends & Reports — fixed-vs-new, status-change velocity, and a
          downloadable PDF/text report covering the same window. */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <TrendingUp size={14} className="text-blue-600" />
              Trends &amp; Historical Breakdown
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">
              Vulnerabilities discovered, resolved, and status changes over the selected window.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs">
              {(['60d', '90d', 'quarter', '180d', '365d'] as TrendPeriod[]).map((p) => (
                <button
                  key={p}
                  onClick={() => setTrendPeriod(p)}
                  className={`px-3 py-1.5 transition-colors ${
                    trendPeriod === p ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {PERIOD_LABEL[p]}
                </button>
              ))}
            </div>
            <button
              onClick={handleDownloadReport}
              disabled={reportDownloading}
              className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:bg-gray-400"
              title="Download a status report covering the selected window"
            >
              {reportDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Download Report
            </button>
          </div>
        </div>

        {/* Trend summary cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">New</p>
            <p className="text-lg font-bold text-rose-600">{trends?.summary?.total_discovered ?? 0}</p>
          </div>
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">Fixed</p>
            <p className="text-lg font-bold text-emerald-600">{trends?.summary?.total_resolved ?? 0}</p>
          </div>
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">Net change</p>
            <p
              className={`text-lg font-bold ${
                (trends?.summary?.net_change ?? 0) > 0 ? 'text-rose-600' : 'text-emerald-600'
              }`}
            >
              {trends?.summary?.net_change != null
                ? `${trends.summary.net_change > 0 ? '+' : ''}${trends.summary.net_change}`
                : '0'}
            </p>
          </div>
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">MTTR (in window)</p>
            <p className="text-lg font-bold text-amber-600">
              {trends?.summary?.mttr_days_within_window != null
                ? `${trends.summary.mttr_days_within_window}d`
                : '-'}
            </p>
          </div>
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-2">
            <p className="text-[10px] uppercase tracking-wide text-gray-500">Status changes</p>
            <p className="text-lg font-bold text-indigo-600">{trends?.summary?.total_status_changes ?? 0}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Discovered vs Resolved (grouped bars) */}
          <div className="rounded-lg border border-gray-100 p-2">
            <p className="text-xs font-medium text-gray-600 mb-1">Discovered vs Resolved</p>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={(trends?.buckets ?? []).map((d, i) => ({
                  date: d,
                  Discovered: trends?.discovered?.[i]?.count ?? 0,
                  Resolved: trends?.resolved?.[i]?.count ?? 0,
                }))}
                margin={{ top: 4, right: 8, bottom: 0, left: -10 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => (typeof v === 'string' ? v.slice(5) : v)}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="Discovered" fill="#ef4444" />
                <Bar dataKey="Resolved" fill="#22c55e" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Status-change velocity (line) */}
          <div className="rounded-lg border border-gray-100 p-2">
            <p className="text-xs font-medium text-gray-600 mb-1">Status change activity</p>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart
                data={(trends?.status_changes ?? []).map((p) => ({ date: p.date, count: p.count }))}
                margin={{ top: 4, right: 8, bottom: 0, left: -10 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => (typeof v === 'string' ? v.slice(5) : v)}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Task progress strip */}
        {trends?.summary?.task_progress?.total ? (
          <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-2 text-xs text-gray-600">
            <span className="font-semibold text-gray-700">Linked task progress:</span>{' '}
            {Object.entries(trends.summary.task_progress.by_status || {})
              .map(([k, v]) => `${k}: ${v}`)
              .join(' · ')}{' '}
            <span className="text-gray-500">(total {trends.summary.task_progress.total})</span>
          </div>
        ) : null}
      </div>

      {/* -- Severity Exposure Radar -- */}
      {(() => {
        const sevOrder = ['critical','high','medium','low','info'] as const;
        const activeRatio  = total > 0 ? ((byStat['open'] ?? 0) + (byStat['in_progress'] ?? 0)) / total : 0;
        const resolvedRatio = total > 0 ? RESOLVED_STATUSES.reduce((s, k) => s + (byStat[k] ?? 0), 0) / total : 0;
        const radarData = sevOrder
          .filter((s) => (bySev[s] ?? 0) > 0)
          .map((sev) => {
            const count = bySev[sev] ?? 0;
            return {
              subject: sev.charAt(0).toUpperCase() + sev.slice(1),
              active:   Math.round(count * activeRatio),
              resolved: Math.round(count * resolvedRatio),
              total:    count,
            };
          });
        return (
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-start justify-between mb-1">
              <div>
                <h3 className="text-sm font-semibold text-gray-700">Severity Exposure Radar</h3>
                <p className="text-xs text-gray-400 mt-0.5">Active vs resolved vulnerabilities across all severity levels</p>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: '#ef4444' }} />Active</span>
                <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full inline-block" style={{ backgroundColor: '#22c55e' }} />Resolved</span>
              </div>
            </div>
            {radarData.length < 2 ? (
              <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Need data across at least 2 severity levels</div>
            ) : (
              <div className="flex items-center gap-6">
                <ResponsiveContainer width="60%" height={280}>
                  <RadarChart data={radarData} margin={{ top: 10, right: 24, bottom: 10, left: 24 }}>
                    <PolarGrid stroke="#d1d5db" strokeWidth={1.5} />
                    <PolarAngleAxis dataKey="subject" tick={false} />
                    <PolarRadiusAxis tick={false} axisLine={false} />
                    <Radar name="Active" dataKey="active"
                      stroke="#ef4444" fill="#ef4444" fillOpacity={0.65} strokeWidth={2.5} dot={{ r: 3, fill: '#ef4444' }} />
                    <Radar name="Resolved" dataKey="resolved"
                      stroke="#22c55e" fill="#22c55e" fillOpacity={0.45} strokeWidth={2.5} dot={{ r: 3, fill: '#22c55e' }} />
                    <Tooltip formatter={(v: number, name: string) => [v, name]} />
                  </RadarChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2.5 min-w-0">
                  {radarData.map((d) => {
                    const sev = d.subject.toLowerCase();
                    const color = SEV_COLORS[sev] ?? '#94a3b8';
                    const actPct  = d.total > 0 ? Math.round((d.active  / d.total) * 100) : 0;
                    const resPct  = d.total > 0 ? Math.round((d.resolved / d.total) * 100) : 0;
                    return (
                      <div key={d.subject}>
                        <div className="flex items-center justify-between text-xs mb-0.5">
                          <span className="font-semibold capitalize flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                            {d.subject}
                          </span>
                          <span className="text-gray-500">{d.total} total &nbsp;·&nbsp;
                            <span style={{ color }}>{d.active} active</span> &nbsp;·&nbsp;
                            <span className="text-emerald-600">{d.resolved} resolved</span>
                          </span>
                        </div>
                        <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden flex">
                          <div className="h-full" style={{ width: `${actPct}%`, backgroundColor: color }} />
                          <div className="h-full bg-emerald-400" style={{ width: `${resPct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Metric Breakdown (stacked progress bars) */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Metric Breakdown</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p className="text-xs font-medium text-gray-500 mb-3">By Severity</p>
            <div className="space-y-2.5">
              {(['critical','high','medium','low','info'] as const).map((sev) => {
                const val = bySev[sev] ?? 0;
                const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                if (!val) return null;
                return (
                  <div key={sev}>
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="capitalize font-medium text-gray-700 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: SEV_COLORS[sev] }} />
                        {sev}
                      </span>
                      <span className="text-gray-700 font-semibold">{val} <span className="text-gray-400 font-normal">({pct}%)</span></span>
                    </div>
                    <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: SEV_COLORS[sev] }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 mb-3">By Status &amp; Coverage</p>
            <div className="space-y-2.5">
              {([
                { label: 'Open',         color: '#ef4444', value: byStat['open'] ?? 0 },
                { label: 'In Progress',  color: '#f97316', value: byStat['in_progress'] ?? 0 },
                { label: 'Remediated',   color: '#22c55e', value: resolvedCount },
                { label: 'Mitigated',    color: '#8b5cf6', value: mitCov.with_mitigations },
              ] as { label: string; color: string; value: number }[]).map((item) => {
                const pct = total > 0 ? Math.round((item.value / total) * 100) : 0;
                return (
                  <div key={item.label}>
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span className="font-medium text-gray-700 flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: item.color }} />
                        {item.label}
                      </span>
                      <span className="text-gray-700 font-semibold">{item.value} <span className="text-gray-400 font-normal">({pct}%)</span></span>
                    </div>
                    <div className="h-3 rounded-full bg-gray-100 overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: item.color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

        {/* SLA Speedometer */}
        <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-col">
          <div className="flex items-center gap-2 mb-4">
            <Shield size={15} className="text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-700">SLA Compliance Gauge</h3>
          </div>
          <div className="flex flex-col items-center justify-center flex-1">
            {(() => {
              const cx = 100, cy = 100, r = 76;
              const toXY = (deg: number, rad: number) => ({
                x: cx + rad * Math.cos((deg * Math.PI) / 180),
                y: cy - rad * Math.sin((deg * Math.PI) / 180),
              });
              const valDeg = 180 - slaPercent * 1.8;
              const trackStart = toXY(180, r);
              const trackEnd   = toXY(0, r);
              const progEnd    = toXY(valDeg, r);
              const needleTip  = toXY(valDeg, r - 14);
              const nb1        = toXY(valDeg + 90, 8);
              const nb2        = toXY(valDeg - 90, 8);
              const largeArc   = slaPercent > 50 ? 1 : 0;
              return (
                <svg viewBox="0 0 200 108" className="w-full max-w-[200px]">
                  <path d={`M ${trackStart.x.toFixed(1)} ${trackStart.y.toFixed(1)} A ${r} ${r} 0 0 1 ${trackEnd.x.toFixed(1)} ${trackEnd.y.toFixed(1)}`}
                    fill="none" stroke="#e2e8f0" strokeWidth="14" strokeLinecap="round" />
                  {slaPercent > 0 && (
                    <path d={`M ${trackStart.x.toFixed(1)} ${trackStart.y.toFixed(1)} A ${r} ${r} 0 ${largeArc} 1 ${progEnd.x.toFixed(1)} ${progEnd.y.toFixed(1)}`}
                      fill="none" stroke={slaColor} strokeWidth="14" strokeLinecap="round" />
                  )}
                  <polygon
                    points={`${needleTip.x.toFixed(1)},${needleTip.y.toFixed(1)} ${nb1.x.toFixed(1)},${nb1.y.toFixed(1)} ${nb2.x.toFixed(1)},${nb2.y.toFixed(1)}`}
                    fill="#374151" />
                  <circle cx={cx} cy={cy} r={6} fill="#374151" />
                  <circle cx={cx} cy={cy} r={3} fill="#ffffff" />
                  <text x="16" y="106" fontSize="10" fill="#94a3b8">0%</text>
                  <text x="164" y="106" fontSize="10" fill="#94a3b8">100%</text>
                </svg>
              );
            })()}
            <div className="flex flex-col items-center mt-2">
              <span className="text-3xl font-bold leading-tight" style={{ color: slaColor }}>{slaPercent}%</span>
              <span className="text-xs text-gray-500 font-medium mt-0.5">overall SLA rate</span>
              {overdueCount > 0 && (
                <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-600">
                  {overdueCount} overdue
                </span>
              )}
            </div>
          </div>
          <div className="mt-4 space-y-2 border-t border-gray-100 pt-4">
            {Object.entries(dashboard?.sla_compliance ?? {}).slice(0, 4).map(([sev, data]) => (
              <div key={sev} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: SEV_COLORS[sev] ?? '#94a3b8' }} />
                  <span className="capitalize text-gray-600">{sev}</span>
                </div>
                <span className="font-semibold text-gray-700">{Math.min(100, Math.round(data.compliance_rate ?? 0))}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Severity Donut */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={15} className="text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-700">Severity Distribution</h3>
          </div>
          {severityData.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">No data yet</div>
          ) : (
            <div className="flex items-center gap-5">
              <div className="relative w-[130px] h-[130px] flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={severityData} cx="50%" cy="50%"
                      innerRadius={36} outerRadius={60} paddingAngle={3} dataKey="value"
                      onClick={(e) => setSelectedSeverity(e.name === selectedSeverity ? null : e.name)}
                    >
                      {severityData.map((d, i) => (
                        <Cell key={i} fill={d.fill} opacity={selectedSeverity && selectedSeverity !== d.name ? 0.3 : 1} className="cursor-pointer" />
                      ))}
                    </Pie>
                    <Tooltip content={<PieTip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xl font-bold text-gray-900">{total}</span>
                  <span className="text-[10px] text-gray-400">total</span>
                </div>
              </div>
              <div className="flex flex-col gap-2 flex-1 min-w-0">
                {severityData.map((d) => (
                  <button
                    key={d.name}
                    onClick={() => setSelectedSeverity(d.name === selectedSeverity ? null : d.name)}
                    className={`flex items-center justify-between text-xs rounded px-2 py-1 transition-colors ${
                      selectedSeverity === d.name ? 'bg-blue-50 ring-1 ring-blue-400' : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.fill }} />
                      <span className="text-gray-700 capitalize">{d.name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="font-bold text-gray-800">{d.value}</span>
                      <span className="text-gray-400">({d.pct}%)</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Status Donut */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={15} className="text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-700">Status Breakdown</h3>
          </div>
          {statusData.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">No data yet</div>
          ) : (
            <div className="flex items-center gap-5">
              <div className="relative w-[130px] h-[130px] flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusData} cx="50%" cy="50%" innerRadius={36} outerRadius={60} paddingAngle={3} dataKey="value">
                      {statusData.map((d, i) => (<Cell key={i} fill={d.fill} />))}
                    </Pie>
                    <Tooltip content={<PieTip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xl font-bold text-gray-900">{openCount}</span>
                  <span className="text-[10px] text-gray-400">open</span>
                </div>
              </div>
              <div className="flex flex-col gap-2 flex-1 min-w-0">
                {statusData.map((d) => (
                  <div key={d.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: d.fill }} />
                      <span className="text-gray-700 capitalize">{d.name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="font-bold text-gray-800">{d.value}</span>
                      <span className="text-gray-400">({d.pct}%)</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Discovery Trend: hidden */}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

      {/* By Assignee */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <Users size={15} className="text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-700">By Assignee</h3>
          </div>
          {assigneeData.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">No assignments yet</div>
          ) : (
            <div className="flex items-center gap-4">
              <div className="relative w-[110px] h-[110px] flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={assigneeData} cx="50%" cy="50%" innerRadius={28} outerRadius={50} paddingAngle={2} dataKey="value">
                      {assigneeData.map((d, i) => (<Cell key={i} fill={d.fill} />))}
                    </Pie>
                    <Tooltip formatter={(v: number) => [v, 'vulns']} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-sm font-bold text-gray-800">{assigneeData.reduce((s, d) => s + d.value, 0)}</span>
                  <span className="text-[9px] text-gray-400">assigned</span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5 flex-1 min-w-0 max-h-[120px] overflow-y-auto">
                {assigneeData.map((d) => (
                  <div key={d.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: d.fill }} />
                      <span className="text-gray-600 truncate">{d.name}</span>
                    </div>
                    <span className="font-semibold text-gray-800 ml-2 flex-shrink-0">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Mitigation Coverage */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <Shield size={15} className="text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-700">Mitigation Coverage</h3>
          </div>
          {mitData.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">No mitigation data</div>
          ) : (
            <div className="flex flex-col items-center gap-4">
              <div className="relative w-[130px] h-[130px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={mitData} cx="50%" cy="50%" innerRadius={36} outerRadius={60} paddingAngle={4} dataKey="value">
                      {mitData.map((d, i) => (<Cell key={i} fill={d.fill} />))}
                    </Pie>
                    <Tooltip content={<PieTip />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-lg font-bold text-gray-900">
                    {total > 0 ? Math.round((mitCov.with_mitigations / total) * 100) : 0}%
                  </span>
                  <span className="text-[10px] text-gray-400">covered</span>
                </div>
              </div>
              <div className="w-full space-y-2">
                {mitData.map((d) => (
                  <div key={d.name} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.fill }} />
                      <span className="text-gray-600">{d.name}</span>
                    </div>
                    <span className="font-semibold text-gray-800">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* By Department */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-4">
            <Building2 size={15} className="text-gray-500" />
            <h3 className="text-sm font-semibold text-gray-700">By Department</h3>
          </div>
          {deptData.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-400 text-sm">No department data</div>
          ) : (
            <ResponsiveContainer width="100%" height={Math.min(220, Math.max(100, deptData.length * 30))}>
              <BarChart data={deptData} layout="vertical" margin={{ left: 4, right: 28, top: 2, bottom: 2 }}>
                <XAxis type="number" hide tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={104} tick={{ fontSize: 10, fill: '#6b7280' }} />
                <Tooltip formatter={(v: number) => [v, 'Vulnerabilities']} cursor={{ fill: 'rgba(0,0,0,0.03)' }} />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {deptData.map((d, i) => (<Cell key={i} fill={d.fill} />))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* â”€â”€ Aging Analysis + Remediation Progress â”€â”€ */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

        {/* Aging */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Vulnerability Age Distribution</h3>
          {agingData.every((d) => d.value === 0) ? (
            <div className="flex items-center justify-center h-44 text-gray-400 text-sm">No aging data</div>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={agingData} layout="vertical">
                <XAxis type="number" tick={{ fill: '#9ca3af', fontSize: 11 }} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#9ca3af', fontSize: 11 }} width={90} />
                <Tooltip formatter={(v: number) => [v, 'Vulnerabilities']} />
                <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                  {agingData.map((d, i) => (<Cell key={i} fill={d.fill} />))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Remediation Progress */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-4">Remediation Progress</h3>
          {statusData.length === 0 ? (
            <div className="flex items-center justify-center h-44 text-gray-400 text-sm">No status data</div>
          ) : (
            <div className="space-y-4">
              {statusData.map((s) => (
                <div key={s.name} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-gray-700 capitalize">{s.name}</span>
                    <span className="font-bold text-gray-800">
                      {s.value} <span className="font-normal text-gray-400">({s.pct}%)</span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700" style={{ width: `${s.pct}%`, backgroundColor: s.fill }} />
                  </div>
                </div>
              ))}
              <div className="pt-3 border-t border-gray-100 flex items-center justify-between text-sm">
                <span className="text-gray-500">Resolution rate</span>
                <span className="font-bold text-green-600">{total > 0 ? Math.round((resolvedCount / total) * 100) : 0}%</span>
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}
