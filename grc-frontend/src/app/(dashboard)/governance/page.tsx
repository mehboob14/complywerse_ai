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
  Upload,
  Eye,
  TrendingUp,
  BarChart3,
  PieChart,
} from 'lucide-react';
import Link from 'next/link';

const STATUS_COLORS: Record<string, string> = {
  draft: 'var(--color-status-draft)',
  pending_review: 'var(--color-status-review)',
  pending_approval: 'var(--color-status-approval)',
  approved: 'var(--color-status-approved)',
  published: 'var(--color-status-published)',
  expired: 'var(--color-status-expired)',
  archived: 'var(--color-status-archived)',
};

const TYPE_ICONS: Record<string, React.ElementType> = {
  policy: BookOpen,
  standard: FileCheck,
  procedure: ClipboardList,
  guideline: Lightbulb,
  charter: Shield,
  framework: Layers,
};

const TYPE_COLORS: Record<string, { bg: string; text: string; fill: string }> = {
  policy: { bg: 'var(--color-base-soft)', text: 'var(--color-base)', fill: 'var(--color-base)' },
  standard: { bg: 'var(--color-success-soft)', text: 'var(--color-success)', fill: 'var(--color-success)' },
  procedure: { bg: 'var(--color-base-soft-strong)', text: 'var(--color-base)', fill: 'var(--color-base)' },
  guideline: { bg: 'var(--color-warning-soft)', text: 'var(--color-warning)', fill: 'var(--color-warning)' },
  charter: { bg: 'var(--color-warning-soft)', text: 'var(--color-warning)', fill: 'var(--color-warning)' },
  framework: { bg: 'var(--color-danger-soft)', text: 'var(--color-danger)', fill: 'var(--color-danger)' },
};

const DONUT_COLORS = [
  'var(--color-base)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-danger)',
  'var(--color-muted)',
  'var(--color-base-soft-strong)',
];

function DonutChart({ data, total }: { data: { label: string; value: number; color: string }[]; total: number }) {
  let cumulativePercent = 0;
  
  const segments = data.map((item, index) => {
    const percent = total > 0 ? (item.value / total) * 100 : 0;
    const startPercent = cumulativePercent;
    cumulativePercent += percent;
    
    return {
      ...item,
      percent,
      startPercent,
      endPercent: cumulativePercent,
    };
  });

  const getConicGradient = () => {
    if (total === 0) return 'conic-gradient(var(--color-muted) 0% 100%)';
    
    const stops = segments.map((seg) => 
      `${seg.color} ${seg.startPercent}% ${seg.endPercent}%`
    ).join(', ');
    
    return `conic-gradient(${stops})`;
  };

  return (
    <div className="flex items-center gap-6">
      <div 
        className="relative h-36 w-36 rounded-full"
        style={{ background: getConicGradient() }}
      >
        <div className="absolute inset-4 rounded-full bg-[var(--color-surface)] flex items-center justify-center">
          <div className="text-center">
            <p className="cw-text-default text-2xl font-bold">{total}</p>
            <p className="cw-text-muted text-xs">Total</p>
          </div>
        </div>
      </div>
      <div className="flex-1 space-y-2">
        {segments.filter(s => s.value > 0).map((seg, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: seg.color }}></div>
            <span className="cw-text-default text-sm flex-1">{seg.label}</span>
            <span className="cw-text-default text-sm font-medium">{seg.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrendBarChart({ data }: { data: { month: string; created: number; published: number }[] }) {
  const maxValue = Math.max(...data.flatMap(d => [d.created, d.published]), 1);
  
  return (
    <div className="space-y-3">
      <div className="cw-text-muted flex items-center gap-4 text-xs mb-4">
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded bg-[var(--color-base)]"></div>
          <span>Created</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded bg-[var(--color-success)]"></div>
          <span>Published</span>
        </div>
      </div>
      <div className="space-y-2">
        {data.slice(-6).map((item, idx) => {
          const monthLabel = new Date(item.month + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
          const createdWidth = (item.created / maxValue) * 100;
          const publishedWidth = (item.published / maxValue) * 100;
          
          return (
            <div key={idx} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="cw-text-muted w-16">{monthLabel}</span>
                <span className="cw-text-default">{item.created + item.published} docs</span>
              </div>
              <div className="flex gap-1 h-4">
                <div 
                  className="bg-[var(--color-base)] rounded-sm transition-all duration-300"
                  style={{ width: `${createdWidth}%`, minWidth: item.created > 0 ? '4px' : '0' }}
                  title={`Created: ${item.created}`}
                ></div>
                <div 
                  className="bg-[var(--color-success)] rounded-sm transition-all duration-300"
                  style={{ width: `${publishedWidth}%`, minWidth: item.published > 0 ? '4px' : '0' }}
                  title={`Published: ${item.published}`}
                ></div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

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

  const { data: reviewStats, isLoading: reviewStatsLoading } = useQuery({
    queryKey: ['governance-review-statistics'],
    queryFn: async () => {
      const response = await governanceApi.getReviewStatistics();
      return response.data;
    },
  });

  const { data: complianceCoverage, isLoading: complianceLoading } = useQuery({
    queryKey: ['governance-compliance-coverage'],
    queryFn: async () => {
      const response = await governanceApi.getComplianceCoverage();
      return response.data;
    },
  });

  const { data: trends, isLoading: trendsLoading } = useQuery({
    queryKey: ['governance-trends'],
    queryFn: async () => {
      const response = await governanceApi.getTrends(6);
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
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
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

  const totalDocuments = summary?.total_documents || 0;
  const byStatus = summary?.by_status || {};
  const byType = summary?.by_type || {};
  const publishedCount = byStatus['published'] || 0;
  const pendingCount = pendingApprovals?.count || 0;
  const expiringCount = expiringSoon?.by_timeframe?.['30_days'] || 0;
  const overdueCount = overdueReviews?.count || 0;
  const reviewsDueThisMonth = reviewStats?.due_this_month || 0;
  const complianceRate = complianceCoverage?.overall_coverage_percent || 0;

  const mainKpis = [
    {
      name: 'Total Documents',
      value: totalDocuments,
      icon: FileText,
      iconColor: 'text-[var(--color-base)]',
      bgColor: 'bg-[var(--color-base-soft)]',
      href: '/governance/documents',
    },
    {
      name: 'Published',
      value: publishedCount,
      icon: CheckCircle,
      iconColor: 'text-[var(--color-success)]',
      bgColor: 'bg-[var(--color-success-soft)]',
      href: '/governance/documents?status=published',
    },
    {
      name: 'Pending Approvals',
      value: pendingCount,
      icon: Clock,
      iconColor: 'text-[var(--color-warning)]',
      bgColor: 'bg-[var(--color-warning-soft)]',
      href: '/governance/approvals',
    },
    {
      name: 'Overdue Reviews',
      value: overdueCount,
      icon: AlertTriangle,
      iconColor: 'text-[var(--color-danger)]',
      bgColor: 'bg-[var(--color-danger-soft)]',
      href: '/governance/reviews',
    },
  ];

  const secondaryKpis = [
    {
      name: 'Reviews This Month',
      value: reviewsDueThisMonth,
      icon: Calendar,
      iconColor: 'text-[var(--color-base)]',
      bgColor: 'bg-[var(--color-base-soft)]',
      description: 'Documents due for review',
    },
    {
      name: 'Compliance Coverage',
      value: `${complianceRate}%`,
      icon: Shield,
      iconColor: 'text-[var(--color-base)]',
      bgColor: 'bg-[var(--color-base-soft)]',
      description: 'Documents linked to controls/frameworks',
    },
    {
      name: 'Expiring Soon',
      value: expiringCount,
      icon: AlertCircle,
      iconColor: 'text-[var(--color-warning)]',
      bgColor: 'bg-[var(--color-warning-soft)]',
      description: 'Within next 30 days',
    },
    {
      name: 'Active Policies',
      value: byType['policy'] || 0,
      icon: BookOpen,
      iconColor: 'text-[var(--color-base)]',
      bgColor: 'bg-[var(--color-base-soft)]',
      description: 'Total policy documents',
    },
  ];

  const typeChartData = [
    { label: 'Policies', value: byType['policy'] || 0, color: TYPE_COLORS.policy.fill },
    { label: 'Standards', value: byType['standard'] || 0, color: TYPE_COLORS.standard.fill },
    { label: 'Procedures', value: byType['procedure'] || 0, color: TYPE_COLORS.procedure.fill },
    { label: 'Guidelines', value: byType['guideline'] || 0, color: TYPE_COLORS.guideline.fill },
    { label: 'Charters', value: byType['charter'] || 0, color: TYPE_COLORS.charter.fill },
    { label: 'Frameworks', value: byType['framework'] || 0, color: TYPE_COLORS.framework.fill },
  ];

  const trendData = (trends?.created || []).map((item: { month: string; count: number }, idx: number) => ({
    month: item.month,
    created: item.count,
    published: trends?.published?.[idx]?.count || 0,
  }));

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

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {mainKpis.map((stat) => (
          <Link
            key={stat.name}
            href={stat.href}
            className="stat-card group hover:border-[var(--color-border)] transition-all duration-200 hover:shadow-xl cursor-pointer"
          >
            <div className="flex items-start justify-between mb-4">
              <div className={`rounded-xl ${stat.bgColor} p-3`}>
                <stat.icon className={`h-6 w-6 ${stat.iconColor}`} />
              </div>
              <ArrowRight className="h-4 w-4 text-[var(--color-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
            <p className="stat-value">{stat.value.toLocaleString()}</p>
            <p className="stat-label">{stat.name}</p>
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {secondaryKpis.map((stat) => (
          <div
            key={stat.name}
            className="stat-card hover:border-[var(--color-border)] transition-all duration-200"
          >
            <div className="flex items-start justify-between mb-3">
              <div className={`rounded-xl bg-gradient-to-br ${stat.bgColor} p-2.5`}>
                <stat.icon className={`h-5 w-5 ${stat.iconColor}`} />
              </div>
            </div>
            <p className="stat-value">{stat.value}</p>
            <p className="stat-label">{stat.name}</p>
            <p className="cw-text-muted text-xs mt-1">{stat.description}</p>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Quick Actions</h2>
            <p className="card-description">Common governance tasks</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Link
            href="/governance/approvals"
            className="flex items-center gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:bg-[var(--color-hover)] hover:border-[var(--color-warning)] transition-all duration-200 group"
          >
            <div className="rounded-lg bg-[var(--color-warning-soft)] p-3 group-hover:bg-[var(--color-warning)]/30 transition-colors">
              <Eye className="h-5 w-5 text-[var(--color-warning)]" />
            </div>
            <div>
              <p className="cw-text-default font-medium">View Pending Approvals</p>
              <p className="cw-text-muted text-sm">{pendingCount} items awaiting action</p>
            </div>
          </Link>
          
          <Link
            href="/governance/reviews"
            className="flex items-center gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:bg-[var(--color-hover)] hover:border-[var(--color-danger)] transition-all duration-200 group"
          >
            <div className="rounded-lg bg-[var(--color-danger-soft)] p-3 group-hover:bg-[var(--color-danger)]/30 transition-colors">
              <AlertTriangle className="h-5 w-5 text-[var(--color-danger)]" />
            </div>
            <div>
              <p className="cw-text-default font-medium">View Overdue Reviews</p>
              <p className="cw-text-muted text-sm">{overdueCount} reviews overdue</p>
            </div>
          </Link>
          
          <Link
            href="/governance/documents?action=upload"
            className="flex items-center gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:bg-[var(--color-hover)] hover:border-[var(--color-base)] transition-all duration-200 group"
          >
            <div className="rounded-lg bg-[var(--color-base-soft)] p-3 group-hover:bg-[var(--color-base)]/30 transition-colors">
              <Upload className="h-5 w-5 text-[var(--color-base)]" />
            </div>
            <div>
              <p className="cw-text-default font-medium">Upload New Document</p>
              <p className="cw-text-muted text-sm">Add policies, standards & more</p>
            </div>
          </Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="card-header">
            <div className="flex items-center gap-2">
              <PieChart className="h-5 w-5 text-[var(--color-base)]" />
              <div>
                <h2 className="card-title">Documents by Type</h2>
                <p className="card-description">Distribution of governance artifacts</p>
              </div>
            </div>
          </div>
          <DonutChart data={typeChartData} total={totalDocuments} />
        </div>

        <div className="card">
          <div className="card-header">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-[var(--color-success)]" />
              <div>
                <h2 className="card-title">Document Trends</h2>
                <p className="card-description">Created vs published over time</p>
              </div>
            </div>
          </div>
          {trendData.length > 0 ? (
            <TrendBarChart data={trendData} />
          ) : (
            <div className="empty-state py-8">
              <TrendingUp className="h-8 w-8 text-[var(--color-muted)]" />
              <p className="cw-text-muted text-sm mt-2">No trend data available</p>
            </div>
          )}
        </div>
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
                      <span className="cw-text-default text-sm">{label}</span>
                    </span>
                    <span className="cw-text-default text-sm font-semibold">{count}</span>
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
              const colors = TYPE_COLORS[key] || { bg: 'bg-[var(--color-muted)]', text: 'text-[var(--color-muted)]' };
              const count = byType[key] || 0;
              return (
                <div
                  key={key}
                  className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 hover:bg-[var(--color-hover)] transition-all duration-200"
                >
                  <div className={`rounded-lg ${colors.bg} p-2.5`}>
                    <Icon className={`h-5 w-5 ${colors.text}`} />
                  </div>
                  <div>
                    <p className="cw-text-default text-xl font-bold">{count}</p>
                    <p className="cw-text-muted text-xs">{label}</p>
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
                <FileText className="h-8 w-8 text-[var(--color-muted)]" />
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
                  className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 hover:bg-[var(--color-hover)] transition-all duration-200"
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg bg-[var(--color-success-soft)] p-2">
                      <CheckCircle className="h-4 w-4 text-[var(--color-success)]" />
                    </div>
                    <div>
                      <p className="cw-text-default font-medium text-sm">{doc.title}</p>
                      <p className="cw-text-muted text-xs">
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
                      {approval.is_overdue && <span className="text-[var(--color-danger)] ml-1 font-medium">(Overdue)</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {expiringCount === 0 && overdueCount === 0 && pendingCount === 0 && (
              <div className="empty-state py-8">
                <div className="empty-state-icon bg-[var(--color-success-soft)]">
                  <CheckCircle className="h-8 w-8 text-[var(--color-success)]" />
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
