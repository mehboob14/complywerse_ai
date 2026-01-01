'use client';

import { useQuery } from '@tanstack/react-query';
import {
  Shield,
  FileCheck,
  AlertTriangle,
  FileStack,
  TrendingUp,
  TrendingDown,
  CheckCircle,
  Clock,
  FileText,
  Server,
} from 'lucide-react';

interface DashboardStats {
  stats: {
    frameworks: number;
    controls: number;
    evidence: number;
    open_risks: number;
    documents: number;
    assets: number;
  };
  compliance_overview: Array<{
    framework: string;
    short_code: string;
    score: number;
    status: string;
  }>;
  recent_activity: Array<{
    id: number;
    action: string;
    item: string;
    user: string;
    time: string;
    status: string;
  }>;
}

export default function DashboardPage() {
  const { data, isLoading, error } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/stats', { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch stats');
      return res.json();
    },
  });

  const stats = [
    {
      name: 'Frameworks',
      value: data?.stats.frameworks ?? 0,
      icon: FileStack,
      change: '+1',
      changeType: 'increase',
      description: 'Active compliance frameworks',
    },
    {
      name: 'Controls',
      value: data?.stats.controls ?? 0,
      icon: Shield,
      change: '100%',
      changeType: 'neutral',
      description: 'Normalized controls',
    },
    {
      name: 'Evidence Items',
      value: data?.stats.evidence ?? 0,
      icon: FileCheck,
      change: '',
      changeType: 'neutral',
      description: 'Collected evidence',
    },
    {
      name: 'Open Risks',
      value: data?.stats.open_risks ?? 0,
      icon: AlertTriangle,
      change: '',
      changeType: 'neutral',
      description: 'Risks requiring attention',
    },
  ];

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary-500 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-red-900/20 p-4 text-red-400">
        <p>Failed to load dashboard data. Please try logging in again.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-slate-400">Welcome to your GRC command center</p>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.name} className="card">
            <div className="flex items-center justify-between">
              <div className="rounded-lg bg-slate-700 p-3">
                <stat.icon className="h-6 w-6 text-primary-400" />
              </div>
              {stat.change && (
                <div className="flex items-center gap-1 text-sm">
                  {stat.changeType === 'increase' && (
                    <TrendingUp className="h-4 w-4 text-green-400" />
                  )}
                  {stat.changeType === 'decrease' && (
                    <TrendingDown className="h-4 w-4 text-green-400" />
                  )}
                  <span
                    className={
                      stat.changeType === 'increase'
                        ? 'text-green-400'
                        : stat.changeType === 'decrease'
                        ? 'text-green-400'
                        : 'text-slate-400'
                    }
                  >
                    {stat.change}
                  </span>
                </div>
              )}
            </div>
            <div className="mt-4">
              <p className="text-3xl font-bold text-white">{stat.value.toLocaleString()}</p>
              <p className="text-sm text-slate-400">{stat.name}</p>
            </div>
            <p className="mt-2 text-xs text-slate-500">{stat.description}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-4 text-lg font-semibold text-white">Compliance Overview</h2>
          <div className="space-y-4">
            {data?.compliance_overview.map((item) => (
              <div key={item.short_code} className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-300">{item.short_code}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{item.score}%</span>
                    <span
                      className={`rounded px-2 py-0.5 text-xs font-medium ${
                        item.status === 'compliant'
                          ? 'bg-green-900/50 text-green-400'
                          : item.status === 'partial'
                          ? 'bg-yellow-900/50 text-yellow-400'
                          : 'bg-red-900/50 text-red-400'
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-700">
                  <div
                    className={`h-full rounded-full ${
                      item.score >= 90
                        ? 'bg-green-500'
                        : item.score >= 70
                        ? 'bg-yellow-500'
                        : 'bg-red-500'
                    }`}
                    style={{ width: `${item.score}%` }}
                  />
                </div>
              </div>
            ))}
            {(!data?.compliance_overview || data.compliance_overview.length === 0) && (
              <p className="text-sm text-slate-500">No compliance data available yet.</p>
            )}
          </div>
        </div>

        <div className="card">
          <h2 className="mb-4 text-lg font-semibold text-white">Quick Stats</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg bg-slate-700/50 p-4">
              <div className="flex items-center gap-3">
                <FileText className="h-8 w-8 text-blue-400" />
                <div>
                  <p className="text-2xl font-bold text-white">{data?.stats.documents ?? 0}</p>
                  <p className="text-xs text-slate-400">Documents</p>
                </div>
              </div>
            </div>
            <div className="rounded-lg bg-slate-700/50 p-4">
              <div className="flex items-center gap-3">
                <Server className="h-8 w-8 text-purple-400" />
                <div>
                  <p className="text-2xl font-bold text-white">{data?.stats.assets ?? 0}</p>
                  <p className="text-xs text-slate-400">IT Assets</p>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4 rounded-lg bg-slate-700/50 p-4">
            <h3 className="mb-2 text-sm font-medium text-slate-300">Platform Features</h3>
            <ul className="space-y-2 text-sm text-slate-400">
              <li className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-400" />
                Multi-framework compliance tracking
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-400" />
                Normalized control model
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-400" />
                Evidence management with AI assessment
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-green-400" />
                Enterprise risk management
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
