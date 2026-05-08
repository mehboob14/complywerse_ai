'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { integrationsApi } from '@/lib/api';
import {
  BarChart3,
  Loader2,
  Shield,
  AlertTriangle,
  Server,
  Clock,
  TrendingUp,
  Target,
  RefreshCw,
  ChevronRight,
} from 'lucide-react';
import Link from 'next/link';
import { IdentityProvidersCard } from '@/components/integrations/IdentityProvidersCard';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
} from 'recharts';

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#dc2626',
  high: '#ea580c',
  medium: '#ca8a04',
  low: '#2563eb',
  info: '#64748b',
};

const PIE_COLORS = ['#dc2626', '#ea580c', '#ca8a04', '#2563eb', '#64748b'];

export default function IntegrationsDashboardPage() {
  const [connectionFilter, setConnectionFilter] = useState<number | undefined>();

  const { data: overview, isLoading: loadingOverview, isError: overviewError } = useQuery({
    queryKey: ['integrations-overview', connectionFilter],
    queryFn: () => integrationsApi.analyticsOverview({ connection_id: connectionFilter }),
  });

  const { data: trends, isLoading: loadingTrends } = useQuery({
    queryKey: ['integrations-trends', connectionFilter],
    queryFn: () => integrationsApi.analyticsTrends({ days: 30, connection_id: connectionFilter }),
  });

  const { data: mttr } = useQuery({
    queryKey: ['integrations-mttr', connectionFilter],
    queryFn: () => integrationsApi.analyticsMTTR({ connection_id: connectionFilter }),
  });

  const { data: slaCompliance } = useQuery({
    queryKey: ['integrations-sla', connectionFilter],
    queryFn: () => integrationsApi.analyticsSLACompliance({ connection_id: connectionFilter }),
  });

  const { data: topAssets } = useQuery({
    queryKey: ['integrations-top-assets', connectionFilter],
    queryFn: () => integrationsApi.analyticsTopAssets({ limit: 10, connection_id: connectionFilter }),
  });

  const { data: coverage } = useQuery({
    queryKey: ['integrations-coverage', connectionFilter],
    queryFn: () => integrationsApi.analyticsScannerCoverage({ connection_id: connectionFilter }),
  });

  const { data: connStats } = useQuery({
    queryKey: ['integrations-conn-stats'],
    queryFn: async () => {
      try {
        return await integrationsApi.analyticsConnectionStats();
      } catch {
        return { data: [] };
      }
    },
  });

  const batchRecalc = useMutation({
    mutationFn: () => integrationsApi.batchRecalculate({ connection_id: connectionFilter }),
  });

  const assignSLA = useMutation({
    mutationFn: () => integrationsApi.assignSLADeadlines({ connection_id: connectionFilter }),
  });

  const ov = overview?.data;
  const trendData = trends?.data?.trends || [];
  const mttrData = mttr?.data;
  const slaData = slaCompliance?.data;
  const assets = topAssets?.data || [];
  const coverageData = coverage?.data;
  const connections = connStats?.data || [];

  const severityPieData = ov ? Object.entries(ov.severity_distribution || {})
    .filter(([, v]) => (v as number) > 0)
    .map(([k, v]) => ({ name: k.charAt(0).toUpperCase() + k.slice(1), value: v as number })) : [];

  if (loadingOverview) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-blue-600" size={32} />
      </div>
    );
  }

  if (overviewError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-500">
        <AlertTriangle size={32} className="text-red-400 mb-2" />
        <p className="text-sm">Failed to load integration analytics. Please try again later.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900" style={{ fontFamily: 'Poppins, sans-serif' }}>
            Scanner Integration Dashboard
          </h1>
          <p className="text-sm text-slate-500 mt-1">Vulnerability scanner data overview</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => assignSLA.mutate()}
            disabled={assignSLA.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            <Clock size={16} />
            {assignSLA.isPending ? 'Assigning...' : 'Assign SLA Deadlines'}
          </button>
          <button
            onClick={() => batchRecalc.mutate()}
            disabled={batchRecalc.isPending}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            <RefreshCw size={16} className={batchRecalc.isPending ? 'animate-spin' : ''} />
            {batchRecalc.isPending ? 'Recalculating...' : 'Recalculate Scores'}
          </button>
        </div>
      </div>

      <IdentityProvidersCard />

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <StatCard label="Total Vulns" value={ov?.total_vulnerabilities || 0} icon={Shield} color="blue" />
        <StatCard label="Open" value={ov?.open_vulnerabilities || 0} icon={AlertTriangle} color="red" />
        <StatCard label="Closed" value={ov?.closed_vulnerabilities || 0} icon={Target} color="green" />
        <StatCard label="Overdue" value={ov?.overdue_vulnerabilities || 0} icon={Clock} color="orange" />
        <StatCard label="Assets" value={ov?.total_assets || 0} icon={Server} color="slate" />
        <StatCard
          label="SLA Rate"
          value={`${slaData?.compliance_rate || 0}%`}
          icon={TrendingUp}
          color={slaData?.compliance_rate >= 80 ? 'green' : slaData?.compliance_rate >= 50 ? 'yellow' : 'red'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Severity Distribution</h3>
          {severityPieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={severityPieData} cx="50%" cy="50%" outerRadius={90} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                  {severityPieData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[250px] text-slate-400 text-sm">No vulnerability data</div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Vulnerability Trends (30 days)</h3>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="new" stroke="#dc2626" name="New" dot={false} />
              <Line type="monotone" dataKey="closed" stroke="#16a34a" name="Closed" dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Mean Time to Remediate</h3>
          <div className="text-3xl font-bold text-blue-600 mb-1">{mttrData?.overall_mttr_days || 0} days</div>
          <p className="text-xs text-slate-500 mb-4">Overall average</p>
          <div className="space-y-2">
            {Object.entries(mttrData?.by_severity || {}).map(([sev, data]: [string, any]) => (
              <div key={sev} className="flex items-center justify-between text-sm">
                <span className="capitalize" style={{ color: SEVERITY_COLORS[sev] || '#64748b' }}>{sev}</span>
                <span className="font-medium text-slate-700">{data.avg_days}d ({data.count})</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">SLA Compliance</h3>
          <div className="text-3xl font-bold text-green-600 mb-1">{slaData?.compliance_rate || 0}%</div>
          <p className="text-xs text-slate-500 mb-4">On-time closure rate</p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">On-time closed</span><span className="font-medium text-green-600">{slaData?.on_time_closed || 0}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Late closed</span><span className="font-medium text-orange-600">{slaData?.late_closed || 0}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Currently overdue</span><span className="font-medium text-red-600">{slaData?.currently_overdue || 0}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Within SLA</span><span className="font-medium text-blue-600">{slaData?.within_sla || 0}</span></div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h3 className="text-sm font-semibold text-slate-700 mb-4">Scanner Coverage</h3>
          <div className="text-3xl font-bold text-blue-600 mb-1">{coverageData?.coverage_percentage || 0}%</div>
          <p className="text-xs text-slate-500 mb-4">Assets covered by scanner</p>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">Total assets</span><span className="font-medium">{coverageData?.total_assets || 0}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Scanner assets</span><span className="font-medium">{coverageData?.scanner_assets || 0}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Assessed</span><span className="font-medium text-green-600">{coverageData?.assessed_assets || 0}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">Stale (&gt;30 days)</span><span className="font-medium text-orange-600">{coverageData?.stale_assets || 0}</span></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-700">Top Affected Assets</h3>
            <Link href="/assets" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
              View all <ChevronRight size={12} />
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead> 
                <tr className="border-b border-slate-100">
                  <th className="text-left py-2 text-slate-500 font-medium">Asset</th>
                  <th className="text-right py-2 text-slate-500 font-medium">Critical</th>
                  <th className="text-right py-2 text-slate-500 font-medium">High</th>
                  <th className="text-right py-2 text-slate-500 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {(assets as any[]).map((a: any) => (
                  <tr key={a.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-2">
                      <div className="font-medium text-slate-800">{a.name || 'Unnamed Asset'}</div>
                    </td>
                    <td className="text-right text-red-600 font-medium">{a.critical_vulns}</td>
                    <td className="text-right text-orange-600 font-medium">{a.severe_vulns}</td>
                    <td className="text-right font-semibold text-slate-700">{a.total_vulns}</td>
                  </tr>
                ))}
                {(assets as any[]).length === 0 && (
                  <tr><td colSpan={4} className="text-center py-6 text-slate-400">No scanner assets</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-700">Connection Status</h3>
            <Link href="/integrations/connections" className="text-xs text-blue-600 hover:underline flex items-center gap-1">
              Manage <ChevronRight size={12} />
            </Link>
          </div>
          <div className="space-y-3">
            {(connections as any[]).map((c: any) => (
              <div key={c.connection_id} className="flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:border-slate-200">
                <div>
                  <div className="font-medium text-slate-800 text-sm">{c.connection_name}</div>
                  <div className="text-xs text-slate-400">
                    {c.total_assets} assets &middot; {c.total_vulns} vulns
                    {c.last_sync_at && ` &middot; Last sync: ${new Date(c.last_sync_at).toLocaleDateString()}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`inline-block w-2 h-2 rounded-full ${
                    c.status === 'connected' ? 'bg-green-500' :
                    c.status === 'error' ? 'bg-red-500' :
                    c.status === 'deactivated' ? 'bg-slate-400' : 'bg-yellow-500'
                  }`} />
                  <span className="text-xs text-slate-500 capitalize">{c.status}</span>
                </div>
              </div>
            ))}
            {(connections as any[]).length === 0 && (
              <div className="text-center py-8 text-slate-400 text-sm">
                No connections configured.{' '}
                <Link href="/integrations/connections" className="text-blue-600 hover:underline">Add one</Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: any; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'text-blue-600',
    red: 'text-red-600',
    green: 'text-green-600',
    orange: 'text-orange-600',
    yellow: 'text-yellow-600',
    slate: 'text-slate-600',
  };
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <Icon size={18} className={colorMap[color] || 'text-slate-600'} />
      </div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{label}</div>
    </div>
  );
}
