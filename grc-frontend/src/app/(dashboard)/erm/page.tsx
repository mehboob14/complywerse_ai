'use client';

import { useQuery } from '@tanstack/react-query';
import { ermApi } from '@/lib/api';
import {
  AlertTriangle,
  Activity,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  Shield,
  ArrowRight,
  Clock,
  CheckCircle,
  BarChart3,
  FileWarning,
} from 'lucide-react';
import Link from 'next/link';

const SEVERITY_BADGE = {
  low: 'badge-success',
  medium: 'badge-warning',
  high: 'badge-danger',
  critical: 'badge-danger',
};

export default function ERMOverviewPage() {
  const { data: dashboard, isLoading: dashboardLoading } = useQuery({
    queryKey: ['erm-risks-dashboard'],
    queryFn: async () => {
      const response = await ermApi.risks.getDashboard();
      return response.data;
    },
  });

  const { data: kriAlerts } = useQuery({
    queryKey: ['erm-kri-alerts'],
    queryFn: async () => {
      const response = await ermApi.kris.getAlerts();
      return response.data;
    },
  });

  const { data: incidents } = useQuery({
    queryKey: ['erm-recent-incidents'],
    queryFn: async () => {
      const response = await ermApi.incidents.getAll();
      return response.data;
    },
  });

  const { data: pendingReviews } = useQuery({
    queryKey: ['erm-pending-reviews'],
    queryFn: async () => {
      const response = await ermApi.reviews.getPending();
      return response.data;
    },
  });

  const { data: overdueReviews } = useQuery({
    queryKey: ['erm-overdue-reviews'],
    queryFn: async () => {
      const response = await ermApi.reviews.getOverdue();
      return response.data;
    },
  });

  if (dashboardLoading) {
    return (
      <div className="space-y-8">
        <div className="page-header">
          <div className="skeleton h-8 w-64 mb-2" />
          <div className="skeleton h-5 w-96" />
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="stat-card">
              <div className="skeleton h-12 w-12 rounded-xl mb-4" />
              <div className="skeleton h-8 w-20 mb-2" />
              <div className="skeleton h-4 w-32" />
            </div>
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card">
            <div className="skeleton h-6 w-32 mb-4" />
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="skeleton h-16 w-full rounded-lg" />
              ))}
            </div>
          </div>
          <div className="card">
            <div className="skeleton h-6 w-32 mb-4" />
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="skeleton h-16 w-full rounded-lg" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const recentIncidents = incidents?.slice(0, 5) || [];
  const pendingCount = pendingReviews?.length || 0;
  const overdueCount = overdueReviews?.length || 0;
  const redAlerts = kriAlerts?.filter((k: any) => k.current_status === 'red') || [];
  const amberAlerts = kriAlerts?.filter((k: any) => k.current_status === 'amber') || [];

  const byCategory = dashboard?.by_category || {};
  const byStatus = dashboard?.by_status || {};

  const stats = [
    {
      name: 'Total Risks',
      value: dashboard?.total_risks || 0,
      icon: AlertTriangle,
      iconColor: 'text-primary-400',
      bgColor: 'from-primary-500/20 to-primary-600/10',
      href: '/erm/risks',
    },
    {
      name: 'Open Risks',
      value: dashboard?.open_risks || 0,
      icon: Shield,
      iconColor: 'text-rose-400',
      bgColor: 'from-rose-500/20 to-rose-600/10',
      href: '/erm/risks',
    },
    {
      name: 'Avg Inherent Score',
      value: (dashboard?.avg_inherent_score || 0).toFixed(1),
      icon: TrendingUp,
      iconColor: 'text-amber-400',
      bgColor: 'from-amber-500/20 to-amber-600/10',
      href: '/erm/risks',
    },
    {
      name: 'Avg Residual Score',
      value: (dashboard?.avg_residual_score || 0).toFixed(1),
      icon: TrendingDown,
      iconColor: 'text-emerald-400',
      bgColor: 'from-emerald-500/20 to-emerald-600/10',
      href: '/erm/risks',
    },
  ];

  return (
    <div className="space-y-8">
      <div className="page-header">
        <h1 className="page-title">Enterprise Risk Management</h1>
        <p className="page-description">Monitor, assess, and mitigate organizational risks</p>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link
            key={stat.name}
            href={stat.href}
            className="stat-card group hover:border-slate-600 transition-all duration-200 hover:shadow-xl"
          >
            <div className="flex items-start justify-between mb-4">
              <div className={`rounded-xl bg-gradient-to-br ${stat.bgColor} p-3`}>
                <stat.icon className={`h-6 w-6 ${stat.iconColor}`} />
              </div>
            </div>
            <p className="stat-value">{stat.value}</p>
            <div className="flex items-center justify-between mt-1">
              <p className="stat-label">{stat.name}</p>
              <ArrowRight className="h-4 w-4 text-slate-600 group-hover:text-primary-400 transition-colors" />
            </div>
          </Link>
        ))}
      </div>

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
        <div className="card">
          <div className="card-header !border-0 !pb-2 !mb-2">
            <h3 className="card-title text-base">By Score Range</h3>
          </div>
          <div className="space-y-3">
            {[
              { label: 'Critical', color: 'bg-rose-500', value: dashboard?.by_score_range?.critical || 0 },
              { label: 'High', color: 'bg-amber-500', value: dashboard?.by_score_range?.high || 0 },
              { label: 'Medium', color: 'bg-yellow-500', value: dashboard?.by_score_range?.medium || 0 },
              { label: 'Low', color: 'bg-emerald-500', value: dashboard?.by_score_range?.low || 0 },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between group">
                <span className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${item.color}`}></span>
                  <span className="text-sm text-slate-300 group-hover:text-white transition-colors">{item.label}</span>
                </span>
                <span className="text-base font-semibold text-white">{item.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header !border-0 !pb-2 !mb-2">
            <h3 className="card-title text-base">By Status</h3>
          </div>
          <div className="space-y-3">
            {Object.entries(byStatus).length > 0 ? (
              Object.entries(byStatus).map(([status, count]) => (
                <div key={status} className="flex items-center justify-between group">
                  <span className="text-sm capitalize text-slate-300 group-hover:text-white transition-colors">
                    {status.replace('_', ' ')}
                  </span>
                  <span className="text-base font-semibold text-white">{count as number}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">No status data</p>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header !border-0 !pb-2 !mb-2">
            <h3 className="card-title text-base">By Category</h3>
          </div>
          <div className="space-y-3">
            {Object.entries(byCategory).length > 0 ? (
              Object.entries(byCategory).slice(0, 4).map(([category, count]) => (
                <div key={category} className="flex items-center justify-between group">
                  <span className="text-sm capitalize text-slate-300 group-hover:text-white transition-colors">
                    {category.replace('_', ' ')}
                  </span>
                  <span className="text-base font-semibold text-white">{count as number}</span>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">No category data</p>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header !border-0 !pb-2 !mb-2">
            <div className="flex items-center justify-between w-full">
              <h3 className="card-title text-base">Reviews Status</h3>
              <Link href="/erm/reviews" className="text-primary-400 hover:text-primary-300 transition-colors">
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 hover:border-amber-500/40 transition-colors">
              <div className="rounded-lg bg-amber-500/20 p-2">
                <Clock className="h-4 w-4 text-amber-400" />
              </div>
              <div>
                <p className="text-lg font-bold text-white">{pendingCount}</p>
                <p className="text-xs text-amber-400">Pending Reviews</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg bg-rose-500/10 border border-rose-500/20 p-3 hover:border-rose-500/40 transition-colors">
              <div className="rounded-lg bg-rose-500/20 p-2">
                <AlertCircle className="h-4 w-4 text-rose-400" />
              </div>
              <div>
                <p className="text-lg font-bold text-white">{overdueCount}</p>
                <p className="text-xs text-rose-400">Overdue Reviews</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">KRI Alerts</h2>
              <p className="card-description">Key Risk Indicator status</p>
            </div>
            <Link href="/erm/kris" className="btn-ghost btn-sm">
              View All
            </Link>
          </div>
          
          {redAlerts.length === 0 && amberAlerts.length === 0 ? (
            <div className="empty-state py-8">
              <div className="empty-state-icon bg-emerald-500/10">
                <CheckCircle className="h-8 w-8 text-emerald-400" />
              </div>
              <p className="empty-state-title">All Clear</p>
              <p className="empty-state-description text-sm">
                All KRIs are within acceptable thresholds
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {redAlerts.slice(0, 3).map((kri: any) => (
                <div
                  key={kri.id}
                  className="flex items-center gap-3 rounded-lg border border-rose-500/20 bg-rose-500/5 p-4 hover:border-rose-500/40 hover:bg-rose-500/10 transition-all"
                >
                  <div className="h-3 w-3 rounded-full bg-rose-500 animate-pulse" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white truncate">{kri.name}</p>
                    <p className="text-sm text-slate-400">
                      Current: {kri.current_value}{kri.unit || ''} | Threshold: {kri.amber_threshold}
                    </p>
                  </div>
                  <span className="badge-danger">Critical</span>
                </div>
              ))}
              {amberAlerts.slice(0, 2).map((kri: any) => (
                <div
                  key={kri.id}
                  className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4 hover:border-amber-500/40 hover:bg-amber-500/10 transition-all"
                >
                  <div className="h-3 w-3 rounded-full bg-amber-500" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white truncate">{kri.name}</p>
                    <p className="text-sm text-slate-400">
                      Current: {kri.current_value}{kri.unit || ''} | Threshold: {kri.green_threshold}
                    </p>
                  </div>
                  <span className="badge-warning">Warning</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Recent Incidents</h2>
              <p className="card-description">Latest reported incidents</p>
            </div>
            <Link href="/erm/incidents" className="btn-ghost btn-sm">
              View All
            </Link>
          </div>
          
          {recentIncidents.length === 0 ? (
            <div className="empty-state py-8">
              <div className="empty-state-icon">
                <FileWarning className="h-8 w-8 text-slate-500" />
              </div>
              <p className="empty-state-title">No Incidents</p>
              <p className="empty-state-description text-sm">
                No incidents have been recorded yet
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentIncidents.map((incident: any) => (
                <div
                  key={incident.id}
                  className="flex items-center gap-3 rounded-lg border border-slate-700/50 bg-slate-800/30 p-4 hover:border-slate-600 hover:bg-slate-800/50 transition-all cursor-pointer"
                >
                  <div className="rounded-lg bg-slate-700/50 p-2">
                    <AlertCircle className="h-4 w-4 text-slate-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white truncate">{incident.title}</p>
                    <p className="text-sm text-slate-400">
                      {new Date(incident.incident_date).toLocaleDateString()}
                    </p>
                  </div>
                  <span className={SEVERITY_BADGE[incident.severity as keyof typeof SEVERITY_BADGE] || 'badge-neutral'}>
                    {incident.severity}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-3">
        <Link
          href="/erm/risks"
          className="card group hover:border-primary-500/30 transition-all duration-200"
        >
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-gradient-to-br from-primary-500/20 to-primary-600/10 p-3 group-hover:from-primary-500/30 group-hover:to-primary-600/20 transition-all">
              <AlertTriangle className="h-6 w-6 text-primary-400" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-white group-hover:text-primary-300 transition-colors">Risk Register</p>
              <p className="text-sm text-slate-400">View and manage all risks</p>
            </div>
            <ArrowRight className="h-5 w-5 text-slate-600 group-hover:text-primary-400 transition-colors" />
          </div>
        </Link>

        <Link
          href="/erm/kris"
          className="card group hover:border-cyan-500/30 transition-all duration-200"
        >
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-gradient-to-br from-cyan-500/20 to-cyan-600/10 p-3 group-hover:from-cyan-500/30 group-hover:to-cyan-600/20 transition-all">
              <Activity className="h-6 w-6 text-cyan-400" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-white group-hover:text-cyan-300 transition-colors">Key Risk Indicators</p>
              <p className="text-sm text-slate-400">Monitor risk metrics</p>
            </div>
            <ArrowRight className="h-5 w-5 text-slate-600 group-hover:text-cyan-400 transition-colors" />
          </div>
        </Link>

        <Link
          href="/erm/reports"
          className="card group hover:border-purple-500/30 transition-all duration-200"
        >
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-gradient-to-br from-purple-500/20 to-purple-600/10 p-3 group-hover:from-purple-500/30 group-hover:to-purple-600/20 transition-all">
              <BarChart3 className="h-6 w-6 text-purple-400" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-white group-hover:text-purple-300 transition-colors">Reports & Analytics</p>
              <p className="text-sm text-slate-400">Generate risk reports</p>
            </div>
            <ArrowRight className="h-5 w-5 text-slate-600 group-hover:text-purple-400 transition-colors" />
          </div>
        </Link>
      </div>
    </div>
  );
}
