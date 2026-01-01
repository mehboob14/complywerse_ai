'use client';

import { useQuery } from '@tanstack/react-query';
import { risksApi, advancedErmApi } from '@/lib/api';
import {
  AlertTriangle,
  Activity,
  AlertCircle,
  Calendar,
  TrendingUp,
  TrendingDown,
  Shield,
  Loader2,
  ArrowRight,
  Clock,
  CheckCircle,
} from 'lucide-react';
import Link from 'next/link';

const KRI_STATUS_COLORS = {
  green: 'bg-green-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
  unknown: 'bg-slate-500',
};

const SEVERITY_COLORS = {
  low: 'bg-green-500/20 text-green-400',
  medium: 'bg-yellow-500/20 text-yellow-400',
  high: 'bg-orange-500/20 text-orange-400',
  critical: 'bg-red-500/20 text-red-400',
};

export default function ERMOverviewPage() {
  const { data: risks, isLoading: risksLoading } = useQuery({
    queryKey: ['risks'],
    queryFn: async () => {
      const response = await risksApi.getAll();
      return response.data;
    },
  });

  const { data: dashboard, isLoading: dashboardLoading } = useQuery({
    queryKey: ['risks-dashboard'],
    queryFn: async () => {
      const response = await risksApi.getDashboard();
      return response.data;
    },
  });

  const { data: kriAlerts } = useQuery({
    queryKey: ['kri-alerts'],
    queryFn: async () => {
      const response = await advancedErmApi.getKRIAlerts();
      return response.data;
    },
  });

  const { data: incidents } = useQuery({
    queryKey: ['recent-incidents'],
    queryFn: async () => {
      const response = await advancedErmApi.getIncidents();
      return response.data;
    },
  });

  const { data: pendingReviews } = useQuery({
    queryKey: ['pending-reviews'],
    queryFn: async () => {
      const response = await advancedErmApi.getPendingReviews();
      return response.data;
    },
  });

  const { data: overdueReviews } = useQuery({
    queryKey: ['overdue-reviews'],
    queryFn: async () => {
      const response = await advancedErmApi.getOverdueReviews();
      return response.data;
    },
  });

  const isLoading = risksLoading || dashboardLoading;

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  const recentIncidents = incidents?.slice(0, 5) || [];
  const pendingCount = pendingReviews?.length || 0;
  const overdueCount = overdueReviews?.length || 0;
  const redAlerts = kriAlerts?.filter(k => k.current_status === 'red') || [];
  const amberAlerts = kriAlerts?.filter(k => k.current_status === 'amber') || [];

  const byCategory = dashboard?.by_category || {};
  const byStatus = dashboard?.by_status || {};

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary-500/20 p-3">
              <AlertTriangle className="h-6 w-6 text-primary-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Total Risks</p>
              <p className="text-3xl font-bold text-white">{dashboard?.total_risks || 0}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-red-500/20 p-3">
              <Shield className="h-6 w-6 text-red-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Open Risks</p>
              <p className="text-3xl font-bold text-white">{dashboard?.open_risks || 0}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-orange-500/20 p-3">
              <TrendingUp className="h-6 w-6 text-orange-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Avg Inherent Score</p>
              <p className="text-3xl font-bold text-white">
                {(dashboard?.avg_inherent_score || 0).toFixed(1)}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-500/20 p-3">
              <TrendingDown className="h-6 w-6 text-green-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Avg Residual Score</p>
              <p className="text-3xl font-bold text-white">
                {(dashboard?.avg_residual_score || 0).toFixed(1)}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <p className="mb-3 text-sm font-medium text-slate-400">By Score Range</p>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-red-500"></span>
                <span className="text-sm text-slate-300">Critical</span>
              </span>
              <span className="text-lg font-semibold text-white">
                {dashboard?.by_score_range?.critical || 0}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-orange-500"></span>
                <span className="text-sm text-slate-300">High</span>
              </span>
              <span className="text-lg font-semibold text-white">
                {dashboard?.by_score_range?.high || 0}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-yellow-500"></span>
                <span className="text-sm text-slate-300">Medium</span>
              </span>
              <span className="text-lg font-semibold text-white">
                {dashboard?.by_score_range?.medium || 0}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 rounded-full bg-green-500"></span>
                <span className="text-sm text-slate-300">Low</span>
              </span>
              <span className="text-lg font-semibold text-white">
                {dashboard?.by_score_range?.low || 0}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <p className="mb-3 text-sm font-medium text-slate-400">By Status</p>
          <div className="space-y-2">
            {Object.entries(byStatus).map(([status, count]) => (
              <div key={status} className="flex items-center justify-between">
                <span className="text-sm capitalize text-slate-300">{status.replace('_', ' ')}</span>
                <span className="text-lg font-semibold text-white">{count as number}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <p className="mb-3 text-sm font-medium text-slate-400">By Category</p>
          <div className="space-y-2">
            {Object.entries(byCategory).slice(0, 4).map(([category, count]) => (
              <div key={category} className="flex items-center justify-between">
                <span className="text-sm capitalize text-slate-300">{category.replace('_', ' ')}</span>
                <span className="text-lg font-semibold text-white">{count as number}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-medium text-slate-400">Reviews Status</p>
            <Link href="/erm/reviews" className="text-primary-400 hover:text-primary-300">
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 p-3">
              <Clock className="h-5 w-5 text-yellow-400" />
              <div>
                <p className="text-lg font-bold text-white">{pendingCount}</p>
                <p className="text-xs text-yellow-400">Pending Reviews</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg bg-red-500/10 border border-red-500/30 p-3">
              <AlertCircle className="h-5 w-5 text-red-400" />
              <div>
                <p className="text-lg font-bold text-white">{overdueCount}</p>
                <p className="text-xs text-red-400">Overdue Reviews</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">KRI Alerts</h3>
            <Link
              href="/erm/kris"
              className="flex items-center gap-1 text-sm text-primary-400 hover:text-primary-300"
            >
              View All <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          
          {redAlerts.length === 0 && amberAlerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <CheckCircle className="h-10 w-10 text-green-500" />
              <p className="mt-2 text-slate-400">All KRIs are within acceptable thresholds</p>
            </div>
          ) : (
            <div className="space-y-3">
              {redAlerts.slice(0, 3).map((kri) => (
                <div
                  key={kri.id}
                  className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3"
                >
                  <div className={`h-3 w-3 rounded-full ${KRI_STATUS_COLORS.red}`} />
                  <div className="flex-1">
                    <p className="font-medium text-white">{kri.name}</p>
                    <p className="text-sm text-slate-400">
                      Current: {kri.current_value}{kri.unit || ''} | Threshold: {kri.amber_threshold}
                    </p>
                  </div>
                  <span className="rounded bg-red-500/20 px-2 py-0.5 text-xs text-red-400">
                    Critical
                  </span>
                </div>
              ))}
              {amberAlerts.slice(0, 2).map((kri) => (
                <div
                  key={kri.id}
                  className="flex items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3"
                >
                  <div className={`h-3 w-3 rounded-full ${KRI_STATUS_COLORS.amber}`} />
                  <div className="flex-1">
                    <p className="font-medium text-white">{kri.name}</p>
                    <p className="text-sm text-slate-400">
                      Current: {kri.current_value}{kri.unit || ''} | Threshold: {kri.green_threshold}
                    </p>
                  </div>
                  <span className="rounded bg-amber-500/20 px-2 py-0.5 text-xs text-amber-400">
                    Warning
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Recent Incidents</h3>
            <Link
              href="/erm/incidents"
              className="flex items-center gap-1 text-sm text-primary-400 hover:text-primary-300"
            >
              View All <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          
          {recentIncidents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <AlertCircle className="h-10 w-10 text-slate-500" />
              <p className="mt-2 text-slate-400">No incidents recorded</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentIncidents.map((incident) => (
                <div
                  key={incident.id}
                  className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-900 p-3"
                >
                  <AlertCircle className="h-5 w-5 text-slate-400" />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white truncate">{incident.title}</p>
                    <p className="text-sm text-slate-400">
                      {new Date(incident.incident_date).toLocaleDateString()}
                    </p>
                  </div>
                  <span className={`rounded px-2 py-0.5 text-xs ${SEVERITY_COLORS[incident.severity] || SEVERITY_COLORS.medium}`}>
                    {incident.severity}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Link
          href="/erm/risks"
          className="group rounded-xl border border-slate-700 bg-slate-800 p-5 transition-all hover:border-primary-500/50 hover:bg-slate-750"
        >
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary-500/20 p-3 group-hover:bg-primary-500/30">
              <AlertTriangle className="h-6 w-6 text-primary-400" />
            </div>
            <div>
              <p className="font-semibold text-white">Risk Register</p>
              <p className="text-sm text-slate-400">View and manage all risks</p>
            </div>
            <ArrowRight className="ml-auto h-5 w-5 text-slate-400 group-hover:text-primary-400" />
          </div>
        </Link>

        <Link
          href="/erm/kris"
          className="group rounded-xl border border-slate-700 bg-slate-800 p-5 transition-all hover:border-primary-500/50 hover:bg-slate-750"
        >
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-cyan-500/20 p-3 group-hover:bg-cyan-500/30">
              <Activity className="h-6 w-6 text-cyan-400" />
            </div>
            <div>
              <p className="font-semibold text-white">Key Risk Indicators</p>
              <p className="text-sm text-slate-400">Monitor risk metrics</p>
            </div>
            <ArrowRight className="ml-auto h-5 w-5 text-slate-400 group-hover:text-cyan-400" />
          </div>
        </Link>

        <Link
          href="/erm/reports"
          className="group rounded-xl border border-slate-700 bg-slate-800 p-5 transition-all hover:border-primary-500/50 hover:bg-slate-750"
        >
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-purple-500/20 p-3 group-hover:bg-purple-500/30">
              <Activity className="h-6 w-6 text-purple-400" />
            </div>
            <div>
              <p className="font-semibold text-white">Reports & Analytics</p>
              <p className="text-sm text-slate-400">Generate risk reports</p>
            </div>
            <ArrowRight className="ml-auto h-5 w-5 text-slate-400 group-hover:text-purple-400" />
          </div>
        </Link>
      </div>
    </div>
  );
}
