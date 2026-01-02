'use client';

import { useQuery } from '@tanstack/react-query';
import { governanceApi } from '@/lib/api';
import {
  FileText,
  CheckCircle,
  Clock,
  AlertTriangle,
  Calendar,
  Loader2,
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
  published: 'bg-green-500',
  expired: 'bg-red-500',
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
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Governance Dashboard</h1>
          <p className="text-slate-400">Policy, standards, and document management overview</p>
        </div>
        <Link
          href="/governance/documents"
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
        >
          <FileText size={18} />
          Manage Documents
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary-500/20 p-3">
              <FileText className="h-6 w-6 text-primary-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Total Documents</p>
              <p className="text-3xl font-bold text-white">{totalDocuments}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-500/20 p-3">
              <CheckCircle className="h-6 w-6 text-green-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Published</p>
              <p className="text-3xl font-bold text-white">{publishedCount}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-yellow-500/20 p-3">
              <Clock className="h-6 w-6 text-yellow-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Pending Approvals</p>
              <p className="text-3xl font-bold text-white">{pendingCount}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-orange-500/20 p-3">
              <Calendar className="h-6 w-6 text-orange-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Expiring Soon</p>
              <p className="text-3xl font-bold text-white">{expiringCount}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-red-500/20 p-3">
              <AlertTriangle className="h-6 w-6 text-red-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Overdue Reviews</p>
              <p className="text-3xl font-bold text-white">{overdueCount}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <h3 className="mb-4 text-lg font-semibold text-white">Status Distribution</h3>
          <div className="space-y-3">
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
                <div key={key}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="flex items-center gap-2">
                      <span className={`h-3 w-3 rounded-full ${STATUS_COLORS[key]}`}></span>
                      <span className="text-sm text-slate-300">{label}</span>
                    </span>
                    <span className="text-sm font-semibold text-white">{count}</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-700">
                    <div
                      className={`h-2 rounded-full ${STATUS_COLORS[key]}`}
                      style={{ width: `${percentage}%` }}
                    ></div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <h3 className="mb-4 text-lg font-semibold text-white">Documents by Type</h3>
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
              const count = byType[key] || 0;
              return (
                <div
                  key={key}
                  className="flex items-center gap-3 rounded-lg border border-slate-700 bg-slate-700/50 p-3"
                >
                  <div className="rounded-lg bg-slate-600 p-2">
                    <Icon className="h-5 w-5 text-slate-300" />
                  </div>
                  <div>
                    <p className="text-lg font-bold text-white">{count}</p>
                    <p className="text-xs text-slate-400">{label}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">Recent Activity</h3>
            <Link
              href="/governance/documents"
              className="flex items-center gap-1 text-sm text-primary-400 hover:text-primary-300"
            >
              View All <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          
          {recentlyPublished?.documents?.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <FileText className="h-10 w-10 text-slate-600" />
              <p className="mt-2 text-slate-400">No recently published documents</p>
            </div>
          ) : (
            <div className="space-y-3">
              {recentlyPublished?.documents?.slice(0, 5).map((doc: any) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-700/30 p-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="rounded bg-green-500/20 p-1.5">
                      <CheckCircle className="h-4 w-4 text-green-400" />
                    </div>
                    <div>
                      <p className="font-medium text-white text-sm">{doc.title}</p>
                      <p className="text-xs text-slate-400">
                        {doc.doc_type} • {doc.document_code}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-slate-500">
                    {doc.published_at ? new Date(doc.published_at).toLocaleDateString() : '-'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-5">
          <h3 className="mb-4 text-lg font-semibold text-white">Alerts & Actions Required</h3>
          <div className="space-y-4">
            {expiringCount > 0 && (
              <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 p-4">
                <div className="flex items-start gap-3">
                  <Calendar className="h-5 w-5 text-orange-400 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-orange-400">Expiring Soon</p>
                    <p className="text-sm text-slate-300 mt-1">
                      {expiringCount} document{expiringCount !== 1 ? 's' : ''} expiring in the next 30 days
                    </p>
                    {expiringSoon?.documents?.slice(0, 3).map((doc: any) => (
                      <div key={doc.id} className="mt-2 text-xs text-slate-400">
                        • {doc.title} - expires in {doc.days_until_expiry} days
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {overdueCount > 0 && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-red-400 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-red-400">Overdue Reviews</p>
                    <p className="text-sm text-slate-300 mt-1">
                      {overdueCount} document{overdueCount !== 1 ? 's' : ''} require{overdueCount === 1 ? 's' : ''} immediate review
                    </p>
                    {overdueReviews?.documents?.slice(0, 3).map((doc: any) => (
                      <div key={doc.id} className="mt-2 text-xs text-slate-400">
                        • {doc.title} - {doc.days_overdue} days overdue
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {pendingCount > 0 && (
              <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-4">
                <div className="flex items-start gap-3">
                  <Clock className="h-5 w-5 text-yellow-400 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-medium text-yellow-400">Pending Approvals</p>
                    <p className="text-sm text-slate-300 mt-1">
                      {pendingCount} document{pendingCount !== 1 ? 's' : ''} awaiting approval
                    </p>
                    {pendingApprovals?.approvals?.slice(0, 3).map((approval: any) => (
                      <div key={approval.id} className="mt-2 text-xs text-slate-400">
                        • {approval.document_title} - Step: {approval.step_name}
                        {approval.is_overdue && <span className="text-red-400 ml-1">(Overdue)</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {expiringCount === 0 && overdueCount === 0 && pendingCount === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle className="h-10 w-10 text-green-500" />
                <p className="mt-2 text-slate-400">All documents are up to date!</p>
                <p className="text-sm text-slate-500">No actions required at this time.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
