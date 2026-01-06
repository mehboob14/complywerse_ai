'use client';

import { useQuery } from '@tanstack/react-query';
import { vulnManagementApi } from '@/lib/api';
import {
  Bug,
  Loader2,
  AlertCircle,
  Clock,
  TrendingUp,
  Server,
  Calendar,
} from 'lucide-react';
import Link from 'next/link';

interface DashboardData {
  total: number;
  by_severity: Record<string, number>;
  by_status: Record<string, number>;
  sla_compliance_percent: number;
  mttr_days?: number;
  aging_buckets?: {
    '0-7': number;
    '8-30': number;
    '31-90': number;
    '90+': number;
  };
}

interface OverdueVuln {
  id: number;
  title: string;
  severity: string;
  due_date: string;
  days_overdue: number;
}

interface AssetExposure {
  asset_id: number;
  asset_name: string;
  vulnerability_count: number;
  critical_count: number;
  high_count: number;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-500',
  info: 'bg-slate-500',
};

const SEVERITY_TEXT: Record<string, string> = {
  critical: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-blue-400',
  info: 'text-slate-400',
};

export default function VulnerabilityDashboardPage() {
  const { data: dashboard, isLoading: dashLoading } = useQuery({
    queryKey: ['vuln-dashboard'],
    queryFn: async () => {
      const response = await vulnManagementApi.dashboard.get();
      return response.data as DashboardData;
    },
  });

  const { data: overdue } = useQuery({
    queryKey: ['vuln-overdue'],
    queryFn: async () => {
      const response = await vulnManagementApi.dashboard.getOverdue();
      return response.data as OverdueVuln[];
    },
  });

  const { data: assetExposure } = useQuery({
    queryKey: ['vuln-asset-exposure'],
    queryFn: async () => {
      const response = await vulnManagementApi.dashboard.getAssetExposure();
      return response.data as AssetExposure[];
    },
  });

  if (dashLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  const totalVulns = dashboard?.total || 0;
  const severities = ['critical', 'high', 'medium', 'low', 'info'];
  const agingBuckets = dashboard?.aging_buckets || { '0-7': 0, '8-30': 0, '31-90': 0, '90+': 0 };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Vulnerability Dashboard</h1>
        <p className="mt-1 text-slate-400">Overview of vulnerability posture and metrics</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-500/20 p-2">
              <Bug className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Total Vulnerabilities</p>
              <p className="text-2xl font-bold text-white">{totalVulns}</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-500/20 p-2">
              <TrendingUp className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">SLA Compliance</p>
              <p className="text-2xl font-bold text-green-400">{dashboard?.sla_compliance_percent || 0}%</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-purple-500/20 p-2">
              <Clock className="h-5 w-5 text-purple-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">MTTR (days)</p>
              <p className="text-2xl font-bold text-purple-400">{dashboard?.mttr_days?.toFixed(1) || '-'}</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-red-500/20 p-2">
              <AlertCircle className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Overdue</p>
              <p className="text-2xl font-bold text-red-400">{overdue?.length || 0}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Severity Breakdown</h2>
          <div className="space-y-3">
            {severities.map((sev) => {
              const count = dashboard?.by_severity?.[sev] || 0;
              const percentage = totalVulns > 0 ? (count / totalVulns) * 100 : 0;
              return (
                <div key={sev} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className={`capitalize ${SEVERITY_TEXT[sev]}`}>{sev}</span>
                    <span className="text-slate-300">{count} ({percentage.toFixed(0)}%)</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
                    <div
                      className={`h-full ${SEVERITY_COLORS[sev]} transition-all duration-300`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-6">
          <h2 className="text-lg font-semibold text-white mb-4">Aging Buckets</h2>
          <div className="grid grid-cols-4 gap-4">
            <div className="text-center p-4 rounded-lg bg-slate-700/50">
              <Calendar className="h-6 w-6 text-green-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-white">{agingBuckets['0-7']}</p>
              <p className="text-xs text-slate-400">0-7 days</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-slate-700/50">
              <Calendar className="h-6 w-6 text-yellow-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-white">{agingBuckets['8-30']}</p>
              <p className="text-xs text-slate-400">8-30 days</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-slate-700/50">
              <Calendar className="h-6 w-6 text-orange-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-white">{agingBuckets['31-90']}</p>
              <p className="text-xs text-slate-400">31-90 days</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-slate-700/50">
              <Calendar className="h-6 w-6 text-red-400 mx-auto mb-2" />
              <p className="text-2xl font-bold text-white">{agingBuckets['90+']}</p>
              <p className="text-xs text-slate-400">90+ days</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Overdue Vulnerabilities</h2>
            <Link href="/vulnerabilities?status=open" className="text-sm text-primary-400 hover:text-primary-300">
              View All
            </Link>
          </div>
          {(!overdue || overdue.length === 0) ? (
            <p className="text-slate-400 text-center py-8">No overdue vulnerabilities</p>
          ) : (
            <div className="space-y-2">
              {overdue.slice(0, 5).map((vuln) => (
                <Link
                  key={vuln.id}
                  href={`/vulnerabilities/${vuln.id}`}
                  className="flex items-center justify-between p-3 rounded-lg bg-slate-700/50 hover:bg-slate-700 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full ${SEVERITY_COLORS[vuln.severity]}`} />
                    <span className="text-sm text-white">{vuln.title}</span>
                  </div>
                  <span className="text-sm text-red-400">{vuln.days_overdue} days overdue</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Asset Exposure</h2>
            <Link href="/assets" className="text-sm text-primary-400 hover:text-primary-300">
              View Assets
            </Link>
          </div>
          {(!assetExposure || assetExposure.length === 0) ? (
            <p className="text-slate-400 text-center py-8">No asset exposure data</p>
          ) : (
            <div className="space-y-2">
              {assetExposure.slice(0, 5).map((asset) => (
                <div
                  key={asset.asset_id}
                  className="flex items-center justify-between p-3 rounded-lg bg-slate-700/50"
                >
                  <div className="flex items-center gap-3">
                    <Server className="h-4 w-4 text-slate-400" />
                    <span className="text-sm text-white">{asset.asset_name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    {asset.critical_count > 0 && (
                      <span className="text-red-400">{asset.critical_count} Critical</span>
                    )}
                    {asset.high_count > 0 && (
                      <span className="text-orange-400">{asset.high_count} High</span>
                    )}
                    <span className="text-slate-400">{asset.vulnerability_count} total</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
