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
  FileText,
  Server,
  ArrowRight,
  AlertCircle,
} from 'lucide-react';
import Link from 'next/link';
import apiClient from '@/lib/api';

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
      const response = await apiClient.get('/dashboard/stats');
      return response.data;
    },
  });

  const stats = [
    {
      name: 'Frameworks',
      value: data?.stats.frameworks ?? 0,
      icon: FileStack,
      iconColor: 'text-primary-400',
      bgColor: 'from-primary-500/20 to-primary-600/10',
      change: '+1',
      changeType: 'increase',
      href: '/frameworks',
    },
    {
      name: 'Controls',
      value: data?.stats.controls ?? 0,
      icon: Shield,
      iconColor: 'text-emerald-400',
      bgColor: 'from-emerald-500/20 to-emerald-600/10',
      change: '',
      changeType: 'neutral',
      href: '/controls',
    },
    {
      name: 'Evidence Items',
      value: data?.stats.evidence ?? 0,
      icon: FileCheck,
      iconColor: 'text-cyan-400',
      bgColor: 'from-cyan-500/20 to-cyan-600/10',
      change: '',
      changeType: 'neutral',
      href: '/evidence',
    },
    {
      name: 'Open Risks',
      value: data?.stats.open_risks ?? 0,
      icon: AlertTriangle,
      iconColor: 'text-amber-400',
      bgColor: 'from-amber-500/20 to-amber-600/10',
      change: '',
      changeType: data?.stats.open_risks && data.stats.open_risks > 5 ? 'warning' : 'neutral',
      href: '/risks',
    },
  ];

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="page-header">
          <div className="skeleton h-8 w-48 mb-2" />
          <div className="skeleton h-5 w-72" />
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="stat-card">
              <div className="skeleton h-12 w-12 rounded-xl mb-4" />
              <div className="skeleton h-8 w-20 mb-2" />
              <div className="skeleton h-4 w-32" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    // The apiClient will redirect to login on 401, so just show loading state while redirecting
    return (
      <div className="space-y-6">
        <div className="page-header">
          <h1 className="page-title">Dashboard</h1>
          <p className="page-description">Redirecting to login...</p>
        </div>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="stat-card">
              <div className="skeleton h-12 w-12 rounded-xl mb-4" />
              <div className="skeleton h-8 w-20 mb-2" />
              <div className="skeleton h-4 w-32" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-description">Welcome to your GRC command center</p>
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
              {stat.change && (
                <div className="flex items-center gap-1 text-sm">
                  {stat.changeType === 'increase' && (
                    <>
                      <TrendingUp className="h-4 w-4 text-emerald-400" />
                      <span className="text-emerald-400">{stat.change}</span>
                    </>
                  )}
                  {stat.changeType === 'decrease' && (
                    <>
                      <TrendingDown className="h-4 w-4 text-rose-400" />
                      <span className="text-rose-400">{stat.change}</span>
                    </>
                  )}
                </div>
              )}
            </div>
            <p className="stat-value">{stat.value.toLocaleString()}</p>
            <div className="flex items-center justify-between mt-1">
              <p className="stat-label">{stat.name}</p>
              <ArrowRight className="h-4 w-4 text-slate-600 group-hover:text-primary-400 transition-colors" />
            </div>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Compliance Overview</h2>
              <p className="card-description">Framework compliance status</p>
            </div>
            <Link href="/frameworks" className="btn-ghost btn-sm">
              View all
            </Link>
          </div>
          <div className="space-y-5">
            {data?.compliance_overview.map((item) => (
              <div key={item.short_code} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-slate-700/50 flex items-center justify-center">
                      <Shield className="h-5 w-5 text-slate-400" />
                    </div>
                    <div>
                      <span className="text-sm font-medium text-white">{item.short_code}</span>
                      <p className="text-xs text-slate-500 truncate max-w-48">{item.framework}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-lg font-semibold text-white">{item.score}%</span>
                    <span
                      className={
                        item.status === 'compliant'
                          ? 'badge-success'
                          : item.status === 'partial'
                          ? 'badge-warning'
                          : 'badge-danger'
                      }
                    >
                      {item.status}
                    </span>
                  </div>
                </div>
                <div className="progress-bar">
                  <div
                    className={`progress-bar-fill ${
                      item.score >= 90
                        ? 'bg-emerald-500'
                        : item.score >= 70
                        ? 'bg-amber-500'
                        : 'bg-rose-500'
                    }`}
                    style={{ width: `${item.score}%` }}
                  />
                </div>
              </div>
            ))}
            {(!data?.compliance_overview || data.compliance_overview.length === 0) && (
              <div className="empty-state py-8">
                <div className="empty-state-icon">
                  <Shield className="h-8 w-8 text-slate-500" />
                </div>
                <p className="empty-state-title">No frameworks yet</p>
                <p className="empty-state-description text-sm">
                  Upload your first regulatory framework to get started
                </p>
                <Link href="/framework-upload" className="btn-primary mt-4">
                  Upload Framework
                </Link>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Quick Stats</h2>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-4 p-3 rounded-lg bg-slate-800/50 hover:bg-slate-700/50 transition-colors">
                <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                  <FileText className="h-5 w-5 text-blue-400" />
                </div>
                <div className="flex-1">
                  <p className="text-2xl font-bold text-white">{data?.stats.documents ?? 0}</p>
                  <p className="text-xs text-slate-400">Documents</p>
                </div>
              </div>
              <div className="flex items-center gap-4 p-3 rounded-lg bg-slate-800/50 hover:bg-slate-700/50 transition-colors">
                <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                  <Server className="h-5 w-5 text-purple-400" />
                </div>
                <div className="flex-1">
                  <p className="text-2xl font-bold text-white">{data?.stats.assets ?? 0}</p>
                  <p className="text-xs text-slate-400">IT Assets</p>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Platform Status</h2>
            </div>
            <ul className="space-y-3">
              <li className="flex items-center gap-3 text-sm">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-slate-300">Multi-framework compliance</span>
                <CheckCircle className="h-4 w-4 text-emerald-400 ml-auto" />
              </li>
              <li className="flex items-center gap-3 text-sm">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-slate-300">Normalized control model</span>
                <CheckCircle className="h-4 w-4 text-emerald-400 ml-auto" />
              </li>
              <li className="flex items-center gap-3 text-sm">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-slate-300">AI-powered framework parsing</span>
                <CheckCircle className="h-4 w-4 text-emerald-400 ml-auto" />
              </li>
              <li className="flex items-center gap-3 text-sm">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-slate-300">Enterprise risk management</span>
                <CheckCircle className="h-4 w-4 text-emerald-400 ml-auto" />
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
