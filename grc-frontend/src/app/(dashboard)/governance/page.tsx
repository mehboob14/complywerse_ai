'use client';

import { useQuery } from '@tanstack/react-query';
import { governanceApi } from '@/lib/api';
import {
  FileText,
  CheckCircle,
  Clock,
  AlertTriangle,
  Calendar,
  ArrowRight,
  AlertCircle,
  BookOpen,
  FileCheck,
  ClipboardList,
  Lightbulb,
  Shield,
  Layers,
} from 'lucide-react';
import Link from 'next/link';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-500',
  pending_review: 'bg-yellow-500',
  pending_approval: 'bg-amber-500',
  approved: 'bg-blue-500',
  published: 'bg-emerald-500',
  expired: 'bg-rose-500',
  archived: 'bg-gray-500',
};

const TYPE_ICONS: Record<string, React.ElementType> = {
  policy: BookOpen,
  standard: FileCheck,
  procedure: ClipboardList,
  guideline: Lightbulb,
  charter: Shield,
  framework: Layers,
};

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  policy: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  standard: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
  procedure: { bg: 'bg-purple-500/20', text: 'text-purple-400' },
  guideline: { bg: 'bg-cyan-500/20', text: 'text-cyan-400' },
  charter: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  framework: { bg: 'bg-rose-500/20', text: 'text-rose-400' },
};

export default function GovernanceDashboardPage() {
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['governance-dashboard-summary'],
    queryFn: async () => {
      const response = await governanceApi.getDashboardSummary();
      return response.data;
    },
  });

  const { data: pendingApprovals, isLoading: pendingLoading } = useQuery({
    queryKey: ['governance-pending-approvals'],
    queryFn: async () => {
      const response = await governanceApi.getDashboardPendingApprovals();
      return response.data;
    },
  });

  const { data: expiringSoon, isLoading: expiringLoading } = useQuery({
    queryKey: ['governance-expiring-soon'],
    queryFn: async () => {
      const response = await governanceApi.getExpiringSoon(30);
      return response.data;
    },
  });

  const { data: overdueReviews, isLoading: overdueLoading } = useQuery({
    queryKey: ['governance-overdue-reviews'],
    queryFn: async () => {
      const response = await governanceApi.getDashboardOverdueReviews();
      return response.data;
    },
  });

  const { data: recentlyPublished, isLoading: recentLoading } = useQuery({
    queryKey: ['governance-recently-published'],
    queryFn: async () => {
      const response = await governanceApi.getRecentlyPublished(5);
      return response.data;
    },
  });

  const isLoading = summaryLoading || pendingLoading || expiringLoading || overdueLoading || recentLoading;

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div className="page-header">
          <div className="skeleton h-8 w-56 mb-2" />
          <div className="skeleton h-5 w-80" />
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
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

  const totalDocuments = summary?.total_documents || 0;
  const byStatus = summary?.by_status || {};
  const byType = summary?.by_type || {};
  const publishedCount = byStatus['published'] || 0;
  const pendingCount = pendingApprovals?.count || 0;
  const expiringCount = expiringSoon?.by_timeframe?.['30_days'] || 0;
  const overdueCount = overdueReviews?.count || 0;

  const statCards = [
    {
      name: 'Total Documents',
      value: totalDocuments,
      icon: FileText,
      iconColor: 'text-primary-400',
      bgColor: 'from-primary-500/20 to-primary-600/10',
    },
    {
      name: 'Published',
      value: publishedCount,
      icon: CheckCircle,
      iconColor: 'text-emerald-400',
      bgColor: 'from-emerald-500/20 to-emerald-600/10',
    },
    {
      name: 'Pending Approvals',
      value: pendingCount,
      icon: Clock,
      iconColor: 'text-amber-400',
      bgColor: 'from-amber-500/20 to-amber-600/10',
    },
    {
      name: 'Expiring Soon',
      value: expiringCount,
      icon: Calendar,
      iconColor: 'text-orange-400',
      bgColor: 'from-orange-500/20 to-orange-600/10',
    },
    {
      name: 'Overdue Reviews',
      value: overdueCount,
      icon: AlertTriangle,
      iconColor: 'text-rose-400',
      bgColor: 'from-rose-500/20 to-rose-600/10',
    },
  ];

  return (
    <div className="space-y-8">
      <div className="page-header flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="page-title">Governance Dashboard</h1>
          <p className="page-description">Policy, standards, and document management overview</p>
        </div>
        <Link href="/governance/documents" className="btn-primary">
          <FileText size={18} />
          Manage Documents
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-5">
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
            <p className="stat-value">{stat.value.toLocaleString()}</p>
            <p className="stat-label">{stat.name}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Status Distribution</h2>
              <p className="card-description">Document lifecycle status breakdown</p>
            </div>
          </div>
          <div className="space-y-4">
            {[
              { key: 'draft', label: 'Draft' },
              { key: 'pending_review', label: 'Pending Review' },
              { key: 'pending_approval', label: 'Pending Approval' },
              { key: 'approved', label: 'Approved' },
              { key: 'published', label: 'Published' },
              { key: 'expired', label: 'Expired' },
            ].map(({ key, label }) => {
              const count = byStatus[key] || 0;
              const percentage = totalDocuments > 0 ? (count / totalDocuments) * 100 : 0;
              return (
                <div key={key} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2">
                      <span className={`h-3 w-3 rounded-full ${STATUS_COLORS[key]}`}></span>
                      <span className="text-sm text-slate-300">{label}</span>
                    </span>
                    <span className="text-sm font-semibold text-white">{count}</span>
                  </div>
                  <div className="progress-bar">
                    <div
                      className={`progress-bar-fill ${STATUS_COLORS[key]}`}
                      style={{ width: `${percentage}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Documents by Type</h2>
              <p className="card-description">Categorized governance artifacts</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[
              { key: 'policy', label: 'Policies' },
              { key: 'standard', label: 'Standards' },
              { key: 'procedure', label: 'Procedures' },
              { key: 'guideline', label: 'Guidelines' },
              { key: 'charter', label: 'Charters' },
              { key: 'framework', label: 'Frameworks' },
            ].map(({ key, label }) => {
              const Icon = TYPE_ICONS[key] || FileText;
              const colors = TYPE_COLORS[key] || { bg: 'bg-slate-500/20', text: 'text-slate-400' };
              const count = byType[key] || 0;
              return (
                <div
                  key={key}
                  className="flex items-center gap-3 rounded-lg border border-slate-700/50 bg-slate-800/50 p-4 hover:bg-slate-700/50 transition-all duration-200"
                >
                  <div className={`rounded-lg ${colors.bg} p-2.5`}>
                    <Icon className={`h-5 w-5 ${colors.text}`} />
                  </div>
                  <div>
                    <p className="text-xl font-bold text-white">{count}</p>
                    <p className="text-xs text-slate-400">{label}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Recent Activity</h2>
              <p className="card-description">Recently published documents</p>
            </div>
            <Link href="/governance/documents" className="btn-ghost btn-sm">
              View All <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          
          {recentlyPublished?.documents?.length === 0 ? (
            <div className="empty-state py-8">
              <div className="empty-state-icon">
                <FileText className="h-8 w-8 text-slate-500" />
              </div>
              <p className="empty-state-title">No recent activity</p>
              <p className="empty-state-description text-sm">
                Published documents will appear here
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentlyPublished?.documents?.slice(0, 5).map((doc: any) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between rounded-lg border border-slate-700/50 bg-slate-800/50 p-3 hover:bg-slate-700/50 transition-all duration-200"
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-emerald-500/20 p-2">
                      <CheckCircle className="h-4 w-4 text-emerald-400" />
                    </div>
                    <div>
                      <p className="font-medium text-white text-sm">{doc.title}</p>
                      <p className="text-xs text-slate-400">
                        <span className="capitalize">{doc.doc_type}</span> • {doc.document_code}
                      </p>
                    </div>
                  </div>
                  <span className="badge-neutral">
                    {doc.published_at ? new Date(doc.published_at).toLocaleDateString() : '-'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Alerts & Actions</h2>
              <p className="card-description">Items requiring attention</p>
            </div>
          </div>
          <div className="space-y-4">
            {expiringCount > 0 && (
              <div className="alert-warning">
                <Calendar className="h-5 w-5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-medium">Expiring Soon</p>
                  <p className="text-sm opacity-80 mt-1">
                    {expiringCount} document{expiringCount !== 1 ? 's' : ''} expiring in the next 30 days
                  </p>
                  {expiringSoon?.documents?.slice(0, 3).map((doc: any) => (
                    <div key={doc.id} className="mt-2 text-xs opacity-70">
                      • {doc.title} - expires in {doc.days_until_expiry} days
                    </div>
                  ))}
                </div>
              </div>
            )}

            {overdueCount > 0 && (
              <div className="alert-danger">
                <AlertCircle className="h-5 w-5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-medium">Overdue Reviews</p>
                  <p className="text-sm opacity-80 mt-1">
                    {overdueCount} document{overdueCount !== 1 ? 's' : ''} require{overdueCount === 1 ? 's' : ''} immediate review
                  </p>
                  {overdueReviews?.documents?.slice(0, 3).map((doc: any) => (
                    <div key={doc.id} className="mt-2 text-xs opacity-70">
                      • {doc.title} - {doc.days_overdue} days overdue
                    </div>
                  ))}
                </div>
              </div>
            )}

            {pendingCount > 0 && (
              <div className="alert-info">
                <Clock className="h-5 w-5 flex-shrink-0" />
                <div className="flex-1">
                  <p className="font-medium">Pending Approvals</p>
                  <p className="text-sm opacity-80 mt-1">
                    {pendingCount} document{pendingCount !== 1 ? 's' : ''} awaiting approval
                  </p>
                  {pendingApprovals?.approvals?.slice(0, 3).map((approval: any) => (
                    <div key={approval.id} className="mt-2 text-xs opacity-70">
                      • {approval.document_title} - Step: {approval.step_name}
                      {approval.is_overdue && <span className="text-rose-400 ml-1 font-medium">(Overdue)</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {expiringCount === 0 && overdueCount === 0 && pendingCount === 0 && (
              <div className="empty-state py-8">
                <div className="empty-state-icon bg-emerald-500/20">
                  <CheckCircle className="h-8 w-8 text-emerald-400" />
                </div>
                <p className="empty-state-title">All caught up!</p>
                <p className="empty-state-description text-sm">
                  No actions required at this time
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
