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

const TYPE_COLORS: Record<string, { bg: string; text: string; fill: string }> = {
  policy: { bg: '', text: 'text-blue-600', fill: '#3b82f6' },
  standard: { bg: '', text: 'text-emerald-600', fill: '#10b981' },
  procedure: { bg: '', text: 'text-primary-600', fill: '#a855f7' },
  guideline: { bg: '', text: 'text-cyan-600', fill: '#06b6d4' },
  charter: { bg: '', text: 'text-amber-600', fill: '#f59e0b' },
  framework: { bg: '', text: 'text-rose-600', fill: '#f43f5e' },
};

const DONUT_COLORS = ['#3b82f6', '#10b981', '#a855f7', '#06b6d4', '#f59e0b', '#f43f5e'];

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
    if (total === 0) return 'conic-gradient(#475569 0% 100%)';
    
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
        <div className="absolute inset-4 rounded-full bg-white flex items-center justify-center">
          <div className="text-center">
            <p className="text-2xl font-bold text-black">{total}</p>
            <p className="text-xs text-slate-600">Total</p>
          </div>
        </div>
      </div>
      <div className="flex-1 space-y-2">
        {segments.filter(s => s.value > 0).map((seg, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-full" style={{ backgroundColor: seg.color }}></div>
            <span className="text-sm text-slate-600 flex-1">{seg.label}</span>
            <span className="text-sm font-medium text-black">{seg.value}</span>
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
      <div className="flex items-center gap-4 text-xs text-slate-600 mb-4">
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded bg-primary-500"></div>
          <span>Created</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded bg-emerald-500"></div>
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
                <span className="text-slate-600 w-16">{monthLabel}</span>
                <span className="text-slate-500">{item.created + item.published} docs</span>
              </div>
              <div className="flex gap-1 h-4">
                <div 
                  className="bg-primary-500 rounded-sm transition-all duration-300"
                  style={{ width: `${createdWidth}%`, minWidth: item.created > 0 ? '4px' : '0' }}
                  title={`Created: ${item.created}`}
                ></div>
                <div 
                  className="bg-emerald-500 rounded-sm transition-all duration-300"
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
      iconColor: 'text-primary-600',
      bgColor: 'from-primary-500/20 to-primary-600/10',
      href: '/governance/documents',
    },
    {
      name: 'Published',
      value: publishedCount,
      icon: CheckCircle,
      iconColor: 'text-emerald-600',
      bgColor: 'from-emerald-500/20 to-emerald-600/10',
      href: '/governance/documents?status=published',
    },
    {
      name: 'Pending Approvals',
      value: pendingCount,
      icon: Clock,
      iconColor: 'text-amber-600',
      bgColor: 'from-amber-500/20 to-amber-600/10',
      href: '/governance/approvals',
    },
    {
      name: 'Overdue Reviews',
      value: overdueCount,
      icon: AlertTriangle,
      iconColor: 'text-rose-600',
      bgColor: 'from-rose-500/20 to-rose-600/10',
      href: '/governance/reviews',
    },
  ];

  const secondaryKpis = [
    {
      name: 'Reviews This Month',
      value: reviewsDueThisMonth,
      icon: Calendar,
      iconColor: 'text-cyan-600',
      bgColor: 'from-cyan-500/20 to-cyan-600/10',
      description: 'Documents due for review',
    },
    {
      name: 'Compliance Coverage',
      value: `${complianceRate}%`,
      icon: Shield,
      iconColor: 'text-primary-600',
      bgColor: 'from-purple-500/20 to-purple-600/10',
      description: 'Documents linked to controls/frameworks',
    },
    {
      name: 'Expiring Soon',
      value: expiringCount,
      icon: AlertCircle,
      iconColor: 'text-orange-600',
      bgColor: 'from-orange-500/20 to-orange-600/10',
      description: 'Within next 30 days',
    },
    {
      name: 'Active Policies',
      value: byType['policy'] || 0,
      icon: BookOpen,
      iconColor: 'text-blue-600',
      bgColor: 'from-blue-500/20 to-blue-600/10',
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
            className="stat-card group hover:border-slate-300 transition-all duration-200 hover:shadow-xl cursor-pointer"
          >
            <div className="flex items-start justify-between mb-4">
                              <stat.icon className={`h-6 w-6 ${stat.iconColor}`} />
              <ArrowRight className="h-4 w-4 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
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
            className="stat-card hover:border-slate-300 transition-all duration-200"
          >
            <div className="flex items-start justify-between mb-3">
                              <stat.icon className={`h-5 w-5 ${stat.iconColor}`} />
            </div>
            <p className="text-2xl font-bold text-black">{stat.value}</p>
            <p className="text-sm text-slate-600">{stat.name}</p>
            <p className="text-xs text-slate-500 mt-1">{stat.description}</p>
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
            className="flex items-center gap-4 rounded-lg border border-slate-200 bg-white/50 p-4 hover:bg-slate-50 hover:border-amber-500/50 transition-all duration-200 group"
          >
                          <Eye className="h-5 w-5 text-amber-600" />
            <div>
              <p className="font-medium text-black">View Pending Approvals</p>
              <p className="text-sm text-slate-600">{pendingCount} items awaiting action</p>
            </div>
          </Link>
          
          <Link
            href="/governance/reviews"
            className="flex items-center gap-4 rounded-lg border border-slate-200 bg-white/50 p-4 hover:bg-slate-50 hover:border-rose-500/50 transition-all duration-200 group"
          >
                          <AlertTriangle className="h-5 w-5 text-rose-600" />
            <div>
              <p className="font-medium text-black">View Overdue Reviews</p>
              <p className="text-sm text-slate-600">{overdueCount} reviews overdue</p>
            </div>
          </Link>
          
          <Link
            href="/governance/documents?action=upload"
            className="flex items-center gap-4 rounded-lg border border-slate-200 bg-white/50 p-4 hover:bg-slate-50 hover:border-primary-500/50 transition-all duration-200 group"
          >
                          <Upload className="h-5 w-5 text-primary-600" />
            <div>
              <p className="font-medium text-black">Upload New Document</p>
              <p className="text-sm text-slate-600">Add policies, standards & more</p>
            </div>
          </Link>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="card-header">
            <div className="flex items-center gap-2">
              <PieChart className="h-5 w-5 text-primary-600" />
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
              <BarChart3 className="h-5 w-5 text-emerald-600" />
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
              <TrendingUp className="h-8 w-8 text-slate-500" />
              <p className="text-sm text-slate-600 mt-2">No trend data available</p>
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
                      <span className="text-sm text-slate-600">{label}</span>
                    </span>
                    <span className="text-sm font-semibold text-black">{count}</span>
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
              const colors = TYPE_COLORS[key] || { bg: 'bg-slate-50', text: 'text-slate-600' };
              const count = byType[key] || 0;
              return (
                <div
                  key={key}
                  className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white/50 p-4 hover:bg-slate-50 transition-all duration-200"
                >
                                      <Icon className={`h-5 w-5 ${colors.text}`} />
                  <div>
                    <p className="text-xl font-bold text-black">{count}</p>
                    <p className="text-xs text-slate-600">{label}</p>
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
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-white/50 p-3 hover:bg-slate-50 transition-all duration-200"
                >
                  <div className="flex items-center gap-3">
                                          <CheckCircle className="h-4 w-4 text-emerald-600" />
                    <div>
                      <p className="font-medium text-black text-sm">{doc.title}</p>
                      <p className="text-xs text-slate-600">
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
                      {approval.is_overdue && <span className="text-rose-600 ml-1 font-medium">(Overdue)</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {expiringCount === 0 && overdueCount === 0 && pendingCount === 0 && (
              <div className="empty-state py-8">
                <div className="empty-state-icon bg-emerald-50">
                  <CheckCircle className="h-8 w-8 text-emerald-600" />
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
