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
  draft: '#6B7280',
  pending_review: '#92570E',
  pending_approval: '#92570E',
  approved: '#1C2B3A',
  published: '#2D6A4F',
  expired: '#9B1C1C',
  archived: '#6B7280',
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
  policy: { bg: 'rgba(28, 43, 58, 0.08)', text: 'var(--color-base)', fill: '#1C2B3A' },
  standard: { bg: 'rgba(45, 106, 79, 0.08)', text: 'var(--color-success)', fill: '#2D6A4F' },
  procedure: { bg: 'rgba(28, 43, 58, 0.06)', text: 'var(--color-base)', fill: '#2C3E50' },
  guideline: { bg: 'rgba(146, 87, 14, 0.08)', text: 'var(--color-warning)', fill: '#92570E' },
  charter: { bg: 'rgba(146, 87, 14, 0.06)', text: 'var(--color-warning)', fill: '#B8860B' },
  framework: { bg: 'rgba(155, 28, 28, 0.06)', text: 'var(--color-danger)', fill: '#9B1C1C' },
};

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
    if (total === 0) return 'conic-gradient(#DDE1E7 0% 100%)';
    
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
        <div className="absolute inset-4 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-surface)' }}>
          <div className="text-center">
            <p className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>{total}</p>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Total</p>
          </div>
        </div>
      </div>
      <div className="flex-1 space-y-2">
        {segments.filter(s => s.value > 0).map((seg, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: seg.color }}></div>
            <span className="text-sm flex-1" style={{ color: 'var(--color-text)' }}>{seg.label}</span>
            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{seg.value}</span>
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
      <div className="flex items-center gap-4 text-xs mb-4" style={{ color: 'var(--color-muted)' }}>
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded" style={{ backgroundColor: 'var(--color-base)' }}></div>
          <span>Created</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded" style={{ backgroundColor: 'var(--color-success)' }}></div>
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
                <span className="w-16" style={{ color: 'var(--color-muted)' }}>{monthLabel}</span>
                <span style={{ color: 'var(--color-muted)' }}>{item.created + item.published} docs</span>
              </div>
              <div className="flex gap-1 h-4">
                <div 
                  className="rounded-sm transition-all duration-300"
                  style={{ width: `${createdWidth}%`, minWidth: item.created > 0 ? '4px' : '0', backgroundColor: 'var(--color-base)' }}
                  title={`Created: ${item.created}`}
                ></div>
                <div 
                  className="rounded-sm transition-all duration-300"
                  style={{ width: `${publishedWidth}%`, minWidth: item.published > 0 ? '4px' : '0', backgroundColor: 'var(--color-success)' }}
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
      iconColor: 'var(--color-base)',
      bgColor: 'rgba(28, 43, 58, 0.08)',
      href: '/governance/documents',
    },
    {
      name: 'Published',
      value: publishedCount,
      icon: CheckCircle,
      iconColor: 'var(--color-success)',
      bgColor: 'rgba(45, 106, 79, 0.08)',
      href: '/governance/documents?status=published',
    },
    {
      name: 'Pending Approvals',
      value: pendingCount,
      icon: Clock,
      iconColor: 'var(--color-warning)',
      bgColor: 'rgba(146, 87, 14, 0.08)',
      href: '/governance/approvals',
    },
    {
      name: 'Overdue Reviews',
      value: overdueCount,
      icon: AlertTriangle,
      iconColor: 'var(--color-danger)',
      bgColor: 'rgba(155, 28, 28, 0.08)',
      href: '/governance/reviews',
    },
  ];

  const secondaryKpis = [
    {
      name: 'Reviews This Month',
      value: reviewsDueThisMonth,
      icon: Calendar,
      iconColor: 'var(--color-base)',
      bgColor: 'rgba(28, 43, 58, 0.06)',
      description: 'Documents due for review',
    },
    {
      name: 'Compliance Coverage',
      value: `${complianceRate}%`,
      icon: Shield,
      iconColor: 'var(--color-base)',
      bgColor: 'rgba(28, 43, 58, 0.06)',
      description: 'Documents linked to controls/frameworks',
    },
    {
      name: 'Expiring Soon',
      value: expiringCount,
      icon: AlertCircle,
      iconColor: 'var(--color-warning)',
      bgColor: 'rgba(146, 87, 14, 0.06)',
      description: 'Within next 30 days',
    },
    {
      name: 'Active Policies',
      value: byType['policy'] || 0,
      icon: BookOpen,
      iconColor: 'var(--color-base)',
      bgColor: 'rgba(28, 43, 58, 0.06)',
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
            className="stat-card group transition-all duration-200 hover:shadow-md cursor-pointer"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="rounded-xl p-3" style={{ backgroundColor: stat.bgColor }}>
                <stat.icon className="h-6 w-6" style={{ color: stat.iconColor }} />
              </div>
              <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--color-muted)' }} />
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
            className="stat-card transition-all duration-200"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="rounded-xl p-2.5" style={{ backgroundColor: stat.bgColor }}>
                <stat.icon className="h-5 w-5" style={{ color: stat.iconColor }} />
              </div>
            </div>
            <p className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>{stat.value}</p>
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{stat.name}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{stat.description}</p>
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
            className="flex items-center gap-4 rounded-lg p-4 transition-all duration-200 group"
            style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}
          >
            <div className="rounded-lg p-3 transition-colors" style={{ backgroundColor: 'rgba(146, 87, 14, 0.08)' }}>
              <Eye className="h-5 w-5" style={{ color: 'var(--color-warning)' }} />
            </div>
            <div>
              <p className="font-medium" style={{ color: 'var(--color-text)' }}>View Pending Approvals</p>
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{pendingCount} items awaiting action</p>
            </div>
          </Link>
          
          <Link
            href="/governance/reviews"
            className="flex items-center gap-4 rounded-lg p-4 transition-all duration-200 group"
            style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}
          >
            <div className="rounded-lg p-3 transition-colors" style={{ backgroundColor: 'rgba(155, 28, 28, 0.08)' }}>
              <AlertTriangle className="h-5 w-5" style={{ color: 'var(--color-danger)' }} />
            </div>
            <div>
              <p className="font-medium" style={{ color: 'var(--color-text)' }}>View Overdue Reviews</p>
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{overdueCount} reviews overdue</p>
            </div>
          </Link>
          
          <Link
            href="/governance/documents?action=upload"
            className="flex items-center gap-4 rounded-lg p-4 transition-all duration-200 group"
            style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}
          >
            <div className="rounded-lg p-3 transition-colors" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
              <Upload className="h-5 w-5" style={{ color: 'var(--color-base)' }} />
            </div>
            <div>
              <p className="font-medium" style={{ color: 'var(--color-text)' }}>Upload New Document</p>
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Add policies, standards & more</p>
            </div>
          </Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="card-header">
            <div className="flex items-center gap-2">
              <PieChart className="h-5 w-5" style={{ color: 'var(--color-base)' }} />
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
              <BarChart3 className="h-5 w-5" style={{ color: 'var(--color-success)' }} />
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
              <TrendingUp className="h-8 w-8" style={{ color: 'var(--color-muted)' }} />
              <p className="text-sm mt-2" style={{ color: 'var(--color-muted)' }}>No trend data available</p>
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
                      <span className="h-3 w-3 rounded-full" style={{ backgroundColor: STATUS_COLORS[key] }}></span>
                      <span className="text-sm" style={{ color: 'var(--color-text)' }}>{label}</span>
                    </span>
                    <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{count}</span>
                  </div>
                  <div className="progress-bar">
                    <div
                      className="progress-bar-fill"
                      style={{ width: `${percentage}%`, backgroundColor: STATUS_COLORS[key] }}
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
              const colors = TYPE_COLORS[key] || { bg: 'var(--color-subtle)', text: 'var(--color-muted)' };
              const count = byType[key] || 0;
              return (
                <div
                  key={key}
                  className="flex items-center gap-3 rounded-lg p-4 transition-all duration-200"
                  style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}
                >
                  <div className="rounded-lg p-2.5" style={{ backgroundColor: colors.bg }}>
                    <Icon className="h-5 w-5" style={{ color: colors.text }} />
                  </div>
                  <div>
                    <p className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>{count}</p>
                    <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</p>
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
                <FileText className="h-8 w-8" style={{ color: 'var(--color-muted)' }} />
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
                  className="flex items-center justify-between rounded-lg p-3 transition-all duration-200"
                  style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(45, 106, 79, 0.08)' }}>
                      <CheckCircle className="h-4 w-4" style={{ color: 'var(--color-success)' }} />
                    </div>
                    <div>
                      <p className="font-medium text-sm" style={{ color: 'var(--color-text)' }}>{doc.title}</p>
                      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
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
          <div className="space-y-3">
            {overdueCount > 0 && (
              <Link
                href="/governance/reviews"
                className="flex items-center gap-3 rounded-lg p-3 transition-all duration-200"
                style={{ backgroundColor: 'rgba(155, 28, 28, 0.04)', border: '1px solid rgba(155, 28, 28, 0.15)' }}
              >
                <AlertTriangle className="h-5 w-5" style={{ color: 'var(--color-danger)' }} />
                <div className="flex-1">
                  <p className="text-sm font-medium" style={{ color: 'var(--color-danger)' }}>{overdueCount} Overdue Reviews</p>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Documents past review date</p>
                </div>
                <ArrowRight className="h-4 w-4" style={{ color: 'var(--color-danger)' }} />
              </Link>
            )}
            {pendingCount > 0 && (
              <Link
                href="/governance/approvals"
                className="flex items-center gap-3 rounded-lg p-3 transition-all duration-200"
                style={{ backgroundColor: 'rgba(146, 87, 14, 0.04)', border: '1px solid rgba(146, 87, 14, 0.15)' }}
              >
                <Clock className="h-5 w-5" style={{ color: 'var(--color-warning)' }} />
                <div className="flex-1">
                  <p className="text-sm font-medium" style={{ color: 'var(--color-warning)' }}>{pendingCount} Pending Approvals</p>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Awaiting review and approval</p>
                </div>
                <ArrowRight className="h-4 w-4" style={{ color: 'var(--color-warning)' }} />
              </Link>
            )}
            {expiringCount > 0 && (
              <Link
                href="/governance/documents?expiring=true"
                className="flex items-center gap-3 rounded-lg p-3 transition-all duration-200"
                style={{ backgroundColor: 'rgba(146, 87, 14, 0.03)', border: '1px solid rgba(146, 87, 14, 0.1)' }}
              >
                <AlertCircle className="h-5 w-5" style={{ color: 'var(--color-warning)' }} />
                <div className="flex-1">
                  <p className="text-sm font-medium" style={{ color: 'var(--color-warning)' }}>{expiringCount} Expiring Soon</p>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Within the next 30 days</p>
                </div>
                <ArrowRight className="h-4 w-4" style={{ color: 'var(--color-warning)' }} />
              </Link>
            )}
            {overdueCount === 0 && pendingCount === 0 && expiringCount === 0 && (
              <div className="text-center py-8">
                <CheckCircle className="h-8 w-8 mx-auto mb-2" style={{ color: 'var(--color-success)' }} />
                <p className="text-sm font-medium" style={{ color: 'var(--color-success)' }}>All clear!</p>
                <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>No pending actions or alerts</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
