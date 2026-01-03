'use client';

import { useQuery } from '@tanstack/react-query';
import { complianceApi } from '@/lib/api';
import {
  FileText,
  CheckCircle,
  XCircle,
  HelpCircle,
  AlertTriangle,
  ArrowRight,
  Clock,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  compliant: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'Compliant' },
  partially_compliant: { bg: 'bg-amber-500/20', text: 'text-amber-400', label: 'Partially Compliant' },
  non_compliant: { bg: 'bg-rose-500/20', text: 'text-rose-400', label: 'Non-Compliant' },
  not_assessed: { bg: 'bg-slate-500/20', text: 'text-slate-400', label: 'Not Assessed' },
  not_applicable: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Not Applicable' },
};

const PRIORITY_COLORS: Record<string, { bg: string; text: string }> = {
  critical: { bg: 'bg-rose-500/20', text: 'text-rose-400' },
  high: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
  medium: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  low: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
};

export default function ComplianceOverviewPage() {
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['compliance-dashboard-summary'],
    queryFn: async () => {
      const response = await complianceApi.dashboard.getSummary();
      return response.data;
    },
  });

  const { data: overdue } = useQuery({
    queryKey: ['compliance-overdue'],
    queryFn: async () => {
      const response = await complianceApi.dashboard.getOverdue({ limit: 5 });
      return response.data;
    },
  });

  const { data: statements } = useQuery({
    queryKey: ['compliance-recent-statements'],
    queryFn: async () => {
      const response = await complianceApi.statements.getAll({ limit: 5 });
      return response.data;
    },
  });

  if (summaryLoading) {
    return (
      <div className="space-y-8">
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

  const byStatus = summary?.by_status || {};
  const totalStatements = summary?.total_statements || 0;
  const compliantCount = byStatus.compliant || 0;
  const nonCompliantCount = byStatus.non_compliant || 0;
  const notAssessedCount = byStatus.not_assessed || 0;
  const partiallyCompliantCount = byStatus.partially_compliant || 0;
  const notApplicableCount = byStatus.not_applicable || 0;
  
  const applicableCount = totalStatements - notApplicableCount;
  const compliantPercent = applicableCount > 0 
    ? Math.round((compliantCount / applicableCount) * 100) 
    : 0;

  const statCards = [
    {
      name: 'Total Statements',
      value: totalStatements,
      icon: FileText,
      iconColor: 'text-primary-400',
      bgColor: 'from-primary-500/20 to-primary-600/10',
    },
    {
      name: 'Compliant Rate',
      value: `${compliantPercent}%`,
      icon: CheckCircle,
      iconColor: 'text-emerald-400',
      bgColor: 'from-emerald-500/20 to-emerald-600/10',
    },
    {
      name: 'Non-Compliant',
      value: nonCompliantCount,
      icon: XCircle,
      iconColor: 'text-rose-400',
      bgColor: 'from-rose-500/20 to-rose-600/10',
    },
    {
      name: 'Not Assessed',
      value: notAssessedCount,
      icon: HelpCircle,
      iconColor: 'text-slate-400',
      bgColor: 'from-slate-500/20 to-slate-600/10',
    },
  ];

  const overdueItems = overdue?.overdue || [];
  const recentStatements = statements?.statements || [];

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <div
            key={stat.name}
            className="stat-card group hover:border-slate-600 transition-all duration-200 hover:shadow-xl"
          >
            <div className="flex items-start justify-between mb-4">
              <div className={`rounded-xl bg-gradient-to-br ${stat.bgColor} p-3`}>
                <stat.icon className={`h-6 w-6 ${stat.iconColor}`} />
              </div>
            </div>
            <p className="stat-value">{stat.value}</p>
            <p className="stat-label">{stat.name}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Compliance Status Breakdown</h2>
              <p className="card-description">Distribution by status</p>
            </div>
          </div>
          <div className="space-y-4">
            {[
              { key: 'compliant', label: 'Compliant', count: compliantCount },
              { key: 'partially_compliant', label: 'Partially Compliant', count: partiallyCompliantCount },
              { key: 'non_compliant', label: 'Non-Compliant', count: nonCompliantCount },
              { key: 'not_assessed', label: 'Not Assessed', count: notAssessedCount },
              { key: 'not_applicable', label: 'Not Applicable', count: notApplicableCount },
            ].map(({ key, label, count }) => {
              const percentage = totalStatements > 0 ? Math.round((count / totalStatements) * 100) : 0;
              const style = STATUS_COLORS[key] || STATUS_COLORS.not_assessed;
              return (
                <div key={key} className="group">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-sm font-medium ${style.text}`}>{label}</span>
                    <span className="text-sm text-slate-400">{count} ({percentage}%)</span>
                  </div>
                  <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${style.bg.replace('/20', '')} transition-all duration-500`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">By Category</h2>
              <p className="card-description">Statement distribution</p>
            </div>
          </div>
          <div className="space-y-3">
            {Object.entries(summary?.by_category || {}).slice(0, 6).map(([category, count]) => (
              <div key={category} className="flex items-center justify-between group">
                <span className="text-sm text-slate-300 group-hover:text-white transition-colors capitalize">
                  {category.replace(/_/g, ' ')}
                </span>
                <span className="text-base font-semibold text-white">{count as number}</span>
              </div>
            ))}
            {Object.keys(summary?.by_category || {}).length === 0 && (
              <p className="text-sm text-slate-500 text-center py-4">No categories found</p>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-400" />
                Overdue Assessments
              </h2>
              <p className="card-description">{overdue?.total || 0} overdue</p>
            </div>
            <Link href="/compliance/statements" className="btn-secondary btn-sm">
              View All
            </Link>
          </div>
          <div className="space-y-3">
            {overdueItems.length > 0 ? (
              overdueItems.map((item: any) => (
                <div
                  key={item.compliance_id}
                  className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg hover:bg-slate-700/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">
                      {item.statement_code || 'No Code'}
                    </p>
                    <p className="text-xs text-slate-400 truncate">
                      {item.document_title || 'No Document'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-rose-400 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {item.days_overdue}d overdue
                    </span>
                    <span className={`badge ${PRIORITY_COLORS[item.priority]?.bg || 'bg-slate-500/20'} ${PRIORITY_COLORS[item.priority]?.text || 'text-slate-400'}`}>
                      {item.priority || 'medium'}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8">
                <CheckCircle className="h-12 w-12 text-emerald-400 mx-auto mb-3" />
                <p className="text-slate-400">No overdue assessments</p>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Recent Statements</h2>
              <p className="card-description">Latest policy statements</p>
            </div>
            <Link href="/compliance/statements" className="btn-secondary btn-sm">
              View All
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="space-y-3">
            {recentStatements.length > 0 ? (
              recentStatements.map((stmt: any) => {
                const statusStyle = STATUS_COLORS[stmt.compliance_status] || STATUS_COLORS.not_assessed;
                return (
                  <div
                    key={stmt.id}
                    className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg hover:bg-slate-700/50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">
                        {stmt.statement_code || 'No Code'}
                      </p>
                      <p className="text-xs text-slate-400 truncate">
                        {stmt.statement_summary || stmt.statement_text?.slice(0, 60) + '...' || 'No text'}
                      </p>
                    </div>
                    <span className={`badge ${statusStyle.bg} ${statusStyle.text}`}>
                      {statusStyle.label}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-8">
                <FileText className="h-12 w-12 text-slate-500 mx-auto mb-3" />
                <p className="text-slate-400">No statements found</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary-400" />
              Compliance Score
            </h2>
            <p className="card-description">Overall compliance health</p>
          </div>
        </div>
        <div className="flex items-center gap-8">
          <div className="relative w-32 h-32">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
              <path
                d="M18 2.0845
                  a 15.9155 15.9155 0 0 1 0 31.831
                  a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="rgb(51, 65, 85)"
                strokeWidth="3"
              />
              <path
                d="M18 2.0845
                  a 15.9155 15.9155 0 0 1 0 31.831
                  a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke={compliantPercent >= 80 ? 'rgb(16, 185, 129)' : compliantPercent >= 50 ? 'rgb(245, 158, 11)' : 'rgb(239, 68, 68)'}
                strokeWidth="3"
                strokeDasharray={`${compliantPercent}, 100`}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-2xl font-bold text-white">{summary?.compliance_score?.toFixed(0) || compliantPercent}%</span>
            </div>
          </div>
          <div className="flex-1">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-slate-400">Assessed</p>
                <p className="text-xl font-semibold text-white">{summary?.statistics?.assessed_count || 0}</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">Mandatory</p>
                <p className="text-xl font-semibold text-white">{summary?.statistics?.mandatory_count || 0}</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">Active</p>
                <p className="text-xl font-semibold text-white">{summary?.statistics?.active_count || 0}</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">Compliance Rate</p>
                <p className="text-xl font-semibold text-emerald-400">{summary?.compliance_rate?.toFixed(1) || 0}%</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
