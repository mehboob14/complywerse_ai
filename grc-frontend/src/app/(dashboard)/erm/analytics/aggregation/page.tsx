'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ermApi } from '@/lib/api';
import Link from 'next/link';
import {
  ArrowLeft,
  Loader2,
  Layers,
  Building2,
  AlertTriangle,
  TrendingDown,
  BarChart3,
  Shield,
  Activity,
  AlertOctagon,
  CheckCircle,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

const CATEGORY_COLORS: Record<string, string> = {
  strategic: '#8b5cf6',
  operational: '#3b82f6',
  financial: '#10b981',
  compliance: '#f59e0b',
  technology: '#06b6d4',
  reputational: '#ec4899',
  third_party: '#f97316',
};

const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  open: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/30' },
  mitigated: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30' },
  accepted: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/30' },
  closed: { bg: 'bg-slate-500/10', text: 'text-slate-600', border: 'border-slate-500/30' },
  transferred: { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/30' },
  monitoring: { bg: 'bg-cyan-500/10', text: 'text-cyan-400', border: 'border-cyan-500/30' },
};

function getStatusStyle(status: string) {
  return STATUS_COLORS[status?.toLowerCase()] || STATUS_COLORS.open;
}

function getCategoryColor(category: string) {
  return CATEGORY_COLORS[category?.toLowerCase()] || '#6366f1';
}

type TabType = 'category' | 'business_unit' | 'status';

export default function RiskAggregationPage() {
  const [activeTab, setActiveTab] = useState<TabType>('category');

  const { data, isLoading } = useQuery({
    queryKey: ['erm-aggregation'],
    queryFn: async () => {
      const response = await ermApi.analytics.getAggregation();
      return response.data;
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/erm/analytics" className="p-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 transition-colors">
            <ArrowLeft className="h-4 w-4 text-slate-600" />
          </Link>
          <div>
            <div className="h-8 w-48 bg-slate-100 rounded animate-pulse" />
            <div className="h-4 w-72 bg-slate-100 rounded animate-pulse mt-2" />
          </div>
        </div>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-slate-600" />
        </div>
      </div>
    );
  }

  const summary = data?.enterprise_summary || {
    total_risks: 0,
    total_inherent_score: 0,
    total_residual_score: 0,
    avg_inherent_score: 0,
    avg_residual_score: 0,
    risk_reduction_pct: 0,
    critical_count: 0,
    high_count: 0,
    medium_count: 0,
    low_count: 0,
  };

  const byCategory = data?.by_category || [];
  const byBusinessUnit = data?.by_business_unit || [];
  const byStatus = data?.by_status || [];

  const tabs: { key: TabType; label: string; icon: React.ElementType }[] = [
    { key: 'category', label: 'By Category', icon: Layers },
    { key: 'business_unit', label: 'By Business Unit', icon: Building2 },
    { key: 'status', label: 'By Status', icon: Activity },
  ];

  const categoryChartData = byCategory.map((c: any) => ({
    name: c.category,
    Critical: c.critical || 0,
    High: c.high || 0,
    Medium: c.medium || 0,
    Low: c.low || 0,
  }));

  return (
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6">
      <div className="flex items-center gap-4">
        <Link href="/erm/analytics" className="p-2 rounded-lg bg-white border border-slate-200 hover:border-slate-300 transition-colors">
          <ArrowLeft className="h-4 w-4 text-slate-600" />
        </Link>
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900">Risk Aggregation</h1>
          <p className="text-sm text-slate-600 mt-1">Enterprise-wide risk aggregation and analysis</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <AlertTriangle className="h-5 w-5 text-blue-400" />
            </div>
            <span className="text-sm font-medium text-slate-600">Total Risks</span>
          </div>
          <p className="text-3xl font-bold text-slate-900">{summary.total_risks}</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-orange-500/10">
              <BarChart3 className="h-5 w-5 text-orange-400" />
            </div>
            <span className="text-sm font-medium text-slate-600">Total Inherent Score</span>
          </div>
          <p className="text-3xl font-bold text-slate-900">{Number(summary.total_inherent_score || 0).toFixed(1)}</p>
          <p className="text-xs text-slate-500 mt-1">Avg: {Number(summary.avg_inherent_score || 0).toFixed(1)}</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-emerald-500/10">
              <Shield className="h-5 w-5 text-emerald-400" />
            </div>
            <span className="text-sm font-medium text-slate-600">Total Residual Score</span>
          </div>
          <p className="text-3xl font-bold text-slate-900">{Number(summary.total_residual_score || 0).toFixed(1)}</p>
          <p className="text-xs text-slate-500 mt-1">Avg: {Number(summary.avg_residual_score || 0).toFixed(1)}</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-cyan-500/10">
              <TrendingDown className="h-5 w-5 text-cyan-400" />
            </div>
            <span className="text-sm font-medium text-slate-600">Risk Reduction</span>
          </div>
          <p className="text-3xl font-bold text-slate-900">{Number(summary.risk_reduction_pct || 0).toFixed(1)}%</p>
          <div className="mt-2 w-full bg-slate-100 rounded-full h-2">
            <div
              className="bg-cyan-500 h-2 rounded-full transition-all"
              style={{ width: `${Math.min(100, Number(summary.risk_reduction_pct || 0))}%` }}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-center">
          <AlertOctagon className="h-5 w-5 text-rose-400 mx-auto mb-2" />
          <p className="text-2xl font-bold text-rose-400">{summary.critical_count}</p>
          <p className="text-xs text-rose-400/70">Critical</p>
        </div>
        <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-4 text-center">
          <AlertTriangle className="h-5 w-5 text-orange-400 mx-auto mb-2" />
          <p className="text-2xl font-bold text-orange-400">{summary.high_count}</p>
          <p className="text-xs text-orange-400/70">High</p>
        </div>
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-center">
          <Activity className="h-5 w-5 text-amber-400 mx-auto mb-2" />
          <p className="text-2xl font-bold text-amber-400">{summary.medium_count}</p>
          <p className="text-xs text-amber-400/70">Medium</p>
        </div>
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-center">
          <CheckCircle className="h-5 w-5 text-emerald-400 mx-auto mb-2" />
          <p className="text-2xl font-bold text-emerald-400">{summary.low_count}</p>
          <p className="text-xs text-emerald-400/70">Low</p>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex border-b border-slate-200">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors border-b-2 ${
                  activeTab === tab.key
                    ? 'border-blue-500 text-blue-400'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="p-6">
          {activeTab === 'category' && (
            <div className="space-y-6">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200">
                      <th className="text-left py-3 px-4 text-slate-600 font-medium">Category</th>
                      <th className="text-right py-3 px-4 text-slate-600 font-medium">Count</th>
                      <th className="text-right py-3 px-4 text-slate-600 font-medium">Total Inherent</th>
                      <th className="text-right py-3 px-4 text-slate-600 font-medium">Total Residual</th>
                      <th className="text-right py-3 px-4 text-slate-600 font-medium">Avg Inherent</th>
                      <th className="text-right py-3 px-4 text-slate-600 font-medium">Avg Residual</th>
                      <th className="text-right py-3 px-4 text-slate-600 font-medium">Reduction %</th>
                      <th className="text-center py-3 px-4 text-slate-600 font-medium">C</th>
                      <th className="text-center py-3 px-4 text-slate-600 font-medium">H</th>
                      <th className="text-center py-3 px-4 text-slate-600 font-medium">M</th>
                      <th className="text-center py-3 px-4 text-slate-600 font-medium">L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byCategory.length === 0 ? (
                      <tr>
                        <td colSpan={11} className="py-8 text-center text-slate-500">No category data available</td>
                      </tr>
                    ) : (
                      byCategory.map((cat: any, idx: number) => (
                        <tr key={idx} className="border-b border-slate-200/50 hover:bg-slate-100/30 transition-colors">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <div className="w-3 h-3 rounded" style={{ backgroundColor: getCategoryColor(cat.category) }} />
                              <span className="text-slate-900 font-medium capitalize">{cat.category}</span>
                            </div>
                          </td>
                          <td className="text-right py-3 px-4 text-slate-900">{cat.count}</td>
                          <td className="text-right py-3 px-4 text-slate-700">{Number(cat.total_inherent || 0).toFixed(1)}</td>
                          <td className="text-right py-3 px-4 text-slate-700">{Number(cat.total_residual || 0).toFixed(1)}</td>
                          <td className="text-right py-3 px-4 text-slate-700">{Number(cat.avg_inherent || 0).toFixed(1)}</td>
                          <td className="text-right py-3 px-4 text-slate-700">{Number(cat.avg_residual || 0).toFixed(1)}</td>
                          <td className="text-right py-3 px-4">
                            <span className={`${Number(cat.reduction_pct || 0) > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>
                              {Number(cat.reduction_pct || 0).toFixed(1)}%
                            </span>
                          </td>
                          <td className="text-center py-3 px-4">
                            <span className="text-rose-400 font-medium">{cat.critical || 0}</span>
                          </td>
                          <td className="text-center py-3 px-4">
                            <span className="text-orange-400 font-medium">{cat.high || 0}</span>
                          </td>
                          <td className="text-center py-3 px-4">
                            <span className="text-amber-400 font-medium">{cat.medium || 0}</span>
                          </td>
                          <td className="text-center py-3 px-4">
                            <span className="text-emerald-400 font-medium">{cat.low || 0}</span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {byCategory.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-slate-600 mb-4">Severity Distribution by Category</h3>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={categoryChartData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
                        <XAxis
                          dataKey="name"
                          tick={{ fill: '#94a3b8', fontSize: 11 }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <YAxis
                          tick={{ fill: '#94a3b8', fontSize: 11 }}
                          axisLine={false}
                          tickLine={false}
                        />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#1e293b',
                            border: '1px solid #475569',
                            borderRadius: '8px',
                            color: '#f1f5f9',
                          }}
                        />
                        <Legend
                          wrapperStyle={{ fontSize: '12px', color: '#94a3b8' }}
                        />
                        <Bar dataKey="Critical" stackId="a" fill="#f43f5e" radius={[0, 0, 0, 0]} />
                        <Bar dataKey="High" stackId="a" fill="#f97316" radius={[0, 0, 0, 0]} />
                        <Bar dataKey="Medium" stackId="a" fill="#f59e0b" radius={[0, 0, 0, 0]} />
                        <Bar dataKey="Low" stackId="a" fill="#10b981" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'business_unit' && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-3 px-4 text-slate-600 font-medium">Business Unit</th>
                    <th className="text-right py-3 px-4 text-slate-600 font-medium">Count</th>
                    <th className="text-right py-3 px-4 text-slate-600 font-medium">Total Inherent</th>
                    <th className="text-right py-3 px-4 text-slate-600 font-medium">Total Residual</th>
                    <th className="text-right py-3 px-4 text-slate-600 font-medium">Avg Inherent</th>
                    <th className="text-right py-3 px-4 text-slate-600 font-medium">Avg Residual</th>
                    <th className="text-center py-3 px-4 text-slate-600 font-medium">C</th>
                    <th className="text-center py-3 px-4 text-slate-600 font-medium">H</th>
                    <th className="text-center py-3 px-4 text-slate-600 font-medium">M</th>
                    <th className="text-center py-3 px-4 text-slate-600 font-medium">L</th>
                  </tr>
                </thead>
                <tbody>
                  {byBusinessUnit.length === 0 ? (
                    <tr>
                      <td colSpan={10} className="py-8 text-center text-slate-500">No business unit data available</td>
                    </tr>
                  ) : (
                    byBusinessUnit.map((bu: any, idx: number) => {
                      const total = (bu.critical || 0) + (bu.high || 0) + (bu.medium || 0) + (bu.low || 0);
                      return (
                        <tr key={idx} className="border-b border-slate-200/50 hover:bg-slate-100/30 transition-colors">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <Building2 className="h-4 w-4 text-slate-500" />
                              <span className="text-slate-900 font-medium">{bu.business_unit || 'Unassigned'}</span>
                            </div>
                          </td>
                          <td className="text-right py-3 px-4 text-slate-900">{bu.count}</td>
                          <td className="text-right py-3 px-4 text-slate-700">{Number(bu.total_inherent || 0).toFixed(1)}</td>
                          <td className="text-right py-3 px-4 text-slate-700">{Number(bu.total_residual || 0).toFixed(1)}</td>
                          <td className="text-right py-3 px-4 text-slate-700">{Number(bu.avg_inherent || 0).toFixed(1)}</td>
                          <td className="text-right py-3 px-4 text-slate-700">{Number(bu.avg_residual || 0).toFixed(1)}</td>
                          <td className="text-center py-3 px-4">
                            <span className="text-rose-400 font-medium">{bu.critical || 0}</span>
                          </td>
                          <td className="text-center py-3 px-4">
                            <span className="text-orange-400 font-medium">{bu.high || 0}</span>
                          </td>
                          <td className="text-center py-3 px-4">
                            <span className="text-amber-400 font-medium">{bu.medium || 0}</span>
                          </td>
                          <td className="text-center py-3 px-4">
                            <span className="text-emerald-400 font-medium">{bu.low || 0}</span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>

              {byBusinessUnit.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-sm font-medium text-slate-600 mb-4">Risk Distribution by Business Unit</h3>
                  <div className="space-y-3">
                    {byBusinessUnit.map((bu: any, idx: number) => {
                      const total = (bu.critical || 0) + (bu.high || 0) + (bu.medium || 0) + (bu.low || 0);
                      if (total === 0) return null;
                      return (
                        <div key={idx}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs text-slate-600">{bu.business_unit || 'Unassigned'}</span>
                            <span className="text-xs text-slate-500">{total} risks</span>
                          </div>
                          <div className="flex h-5 rounded overflow-hidden">
                            {(bu.critical || 0) > 0 && (
                              <div className="bg-rose-500" style={{ width: `${((bu.critical || 0) / total) * 100}%` }} title={`Critical: ${bu.critical}`} />
                            )}
                            {(bu.high || 0) > 0 && (
                              <div className="bg-orange-500" style={{ width: `${((bu.high || 0) / total) * 100}%` }} title={`High: ${bu.high}`} />
                            )}
                            {(bu.medium || 0) > 0 && (
                              <div className="bg-amber-500" style={{ width: `${((bu.medium || 0) / total) * 100}%` }} title={`Medium: ${bu.medium}`} />
                            )}
                            {(bu.low || 0) > 0 && (
                              <div className="bg-emerald-500" style={{ width: `${((bu.low || 0) / total) * 100}%` }} title={`Low: ${bu.low}`} />
                            )}
                          </div>
                        </div>
                      );
                    })}
                    <div className="flex items-center gap-4 mt-2 pt-2 border-t border-slate-200">
                      <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-rose-500" /><span className="text-xs text-slate-600">Critical</span></div>
                      <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-orange-500" /><span className="text-xs text-slate-600">High</span></div>
                      <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-amber-500" /><span className="text-xs text-slate-600">Medium</span></div>
                      <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-emerald-500" /><span className="text-xs text-slate-600">Low</span></div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'status' && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="text-left py-3 px-4 text-slate-600 font-medium">Status</th>
                    <th className="text-right py-3 px-4 text-slate-600 font-medium">Count</th>
                    <th className="text-right py-3 px-4 text-slate-600 font-medium">Avg Score</th>
                    <th className="text-right py-3 px-4 text-slate-600 font-medium">Total Score</th>
                  </tr>
                </thead>
                <tbody>
                  {byStatus.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="py-8 text-center text-slate-500">No status data available</td>
                    </tr>
                  ) : (
                    byStatus.map((s: any, idx: number) => {
                      const style = getStatusStyle(s.status);
                      return (
                        <tr key={idx} className="border-b border-slate-200/50 hover:bg-slate-100/30 transition-colors">
                          <td className="py-3 px-4">
                            <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${style.bg} ${style.text} ${style.border}`}>
                              {s.status}
                            </span>
                          </td>
                          <td className="text-right py-3 px-4 text-slate-900 font-medium">{s.count}</td>
                          <td className="text-right py-3 px-4 text-slate-700">{Number(s.avg_score || 0).toFixed(1)}</td>
                          <td className="text-right py-3 px-4 text-slate-700">{Number(s.total_score || 0).toFixed(1)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
