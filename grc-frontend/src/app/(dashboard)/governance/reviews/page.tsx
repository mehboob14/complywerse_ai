'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { governanceApi } from '@/lib/api';
import {
  Calendar,
  Clock,
  AlertTriangle,
  CheckCircle,
  Loader2,
  AlertCircle,
  FileText,
  BookOpen,
  FileCheck,
  ClipboardList,
  Lightbulb,
  Shield,
  Layers,
  Filter,
  CalendarDays,
  CheckCircle2,
  Eye,
} from 'lucide-react';

interface ReviewDocument {
  id: number;
  tenant_id: number;
  document_code: string | null;
  title: string;
  doc_type: string;
  classification: string;
  status: string;
  current_version: string;
  owner_id: number | null;
  owner_name: string | null;
  review_cycle_months: number;
  next_review_date: string | null;
  last_reviewed_at: string | null;
  last_reviewed_by: number | null;
  last_reviewer_name: string | null;
  days_until_review: number | null;
  is_overdue: boolean;
  effective_date: string | null;
  expiry_date: string | null;
}

interface ReviewListResponse {
  items: ReviewDocument[];
  total: number;
  skip: number;
  limit: number;
}

interface ReviewStatistics {
  total_documents: number;
  total_with_review_date: number;
  overdue: number;
  due_this_week: number;
  due_this_month: number;
  due_next_30_days: number;
  by_doc_type: Record<string, { total: number; overdue: number; due_soon: number }>;
  by_status: { overdue: number; due_soon: number; on_track: number };
  never_reviewed: number;
}

interface GovernanceActionReview {
  id: number;
  action_type: string;
  action_description: string;
  entity_type: string;
  entity_id: number | null;
  review_status: string;
  action_user_id: number;
  action_user_name: string | null;
  action_date: string;
  action_metadata: Record<string, any>;
  review_notes: string | null;
  reviewer_id: number | null;
  reviewer_name: string | null;
  review_started_at: string | null;
  review_completed_at: string | null;
}

interface GovernanceActionsResponse {
  items: GovernanceActionReview[];
  total: number;
  skip: number;
  limit: number;
}

const DOCUMENT_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'policy', label: 'Policy', icon: BookOpen, color: 'text-purple-400', bgColor: 'bg-purple-500/20' },
  { value: 'standard', label: 'Standard', icon: FileCheck, color: 'text-blue-400', bgColor: 'bg-blue-500/20' },
  { value: 'procedure', label: 'Procedure', icon: ClipboardList, color: 'text-green-400', bgColor: 'bg-green-500/20' },
  { value: 'guideline', label: 'Guideline', icon: Lightbulb, color: 'text-yellow-400', bgColor: 'bg-yellow-500/20' },
  { value: 'charter', label: 'Charter', icon: Shield, color: 'text-cyan-400', bgColor: 'bg-cyan-500/20' },
  { value: 'framework', label: 'Framework', icon: Layers, color: 'text-orange-400', bgColor: 'bg-orange-500/20' },
];

const getTypeStyle = (type: string) => {
  return DOCUMENT_TYPES.find(t => t.value === type) || { label: type, color: 'text-gray-600', bgColor: 'bg-slate-500/20', icon: FileText };
};

type TabType = 'overdue' | 'upcoming' | 'completed' | 'all';
type ReviewsSection = 'documents' | 'actions';

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString();
};

const getDaysDisplay = (days: number | null, isOverdue: boolean) => {
  if (days === null) return { text: '-', className: 'text-gray-600' };

  if (isOverdue || days < 0) {
    const absDays = Math.abs(days);
    return {
      text: `${absDays} day${absDays !== 1 ? 's' : ''} overdue`,
      className: 'text-red-400 font-medium',
    };
  }

  if (days === 0) {
    return { text: 'Due today', className: 'text-amber-400 font-medium' };
  }

  if (days <= 7) {
    return { text: `${days} day${days !== 1 ? 's' : ''} left`, className: 'text-amber-400' };
  }

  return { text: `${days} days left`, className: 'text-green-400' };
};

const getActionTypeLabel = (actionType: string): string => {
  const actionLabels: Record<string, string> = {
    'document_draft_created': 'Document Draft',
    'document_uploaded': 'Document Upload',
    'policy_statement_created': 'Policy Statement',
    'risk_acceptance': 'Risk Acceptance',
    'evidence_uploaded': 'Evidence Upload',
    'committee_action': 'Committee Action',
    'attestation_created': 'Attestation',
    'certification_submitted': 'Certification',
  };
  return actionLabels[actionType] || actionType.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
};

const getActionTypeColor = (actionType: string) => {
  const colorMap: Record<string, { bgColor: string; textColor: string; icon: any }> = {
    'document_draft_created': { bgColor: 'bg-blue-500/20', textColor: 'text-blue-400', icon: FileText },
    'document_uploaded': { bgColor: 'bg-blue-500/20', textColor: 'text-blue-400', icon: FileText },
    'policy_statement_created': { bgColor: 'bg-purple-500/20', textColor: 'text-purple-400', icon: BookOpen },
    'risk_acceptance': { bgColor: 'bg-red-500/20', textColor: 'text-red-400', icon: AlertTriangle },
    'evidence_uploaded': { bgColor: 'bg-green-500/20', textColor: 'text-green-400', icon: CheckCircle },
    'committee_action': { bgColor: 'bg-yellow-500/20', textColor: 'text-yellow-400', icon: ClipboardList },
    'attestation_created': { bgColor: 'bg-cyan-500/20', textColor: 'text-cyan-400', icon: FileCheck },
    'certification_submitted': { bgColor: 'bg-orange-500/20', textColor: 'text-orange-400', icon: Shield },
  };
  return colorMap[actionType] || { bgColor: 'bg-gray-500/20', textColor: 'text-gray-400', icon: FileText };
};

const getStatusColor = (status: string) => {
  const statusColors: Record<string, string> = {
    'pending_review': 'bg-amber-500/20 text-amber-400 border-amber-500/50',
    'in_review': 'bg-blue-500/20 text-blue-400 border-blue-500/50',
    'approved': 'bg-green-500/20 text-green-400 border-green-500/50',
    'rejected': 'bg-red-500/20 text-red-400 border-red-500/50',
    'archived': 'bg-gray-500/20 text-gray-400 border-gray-500/50',
  };
  return statusColors[status] || 'bg-gray-500/20 text-gray-400';
};

export default function GovernanceReviewsPage() {
  const [reviewsSection, setReviewsSection] = useState<ReviewsSection>('actions');
  const [activeTab, setActiveTab] = useState<TabType>('overdue');
  const [typeFilter, setTypeFilter] = useState('');
  const [actionStatusFilter, setActionStatusFilter] = useState('pending_review');
  const [completingId, setCompletingId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const { data: statistics, isLoading: statsLoading } = useQuery({
    queryKey: ['governance-review-statistics'],
    queryFn: async () => {
      const response = await governanceApi.getReviewStatistics();
      return response.data as ReviewStatistics;
    }
  });

  const { data: overdueData, isLoading: overdueLoading } = useQuery({
    queryKey: ['governance-reviews-overdue', typeFilter],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (typeFilter) params.doc_type = typeFilter;
      const response = await governanceApi.getOverdueReviews(params);
      return response.data as ReviewListResponse;
    }
  });

  const { data: upcomingData, isLoading: upcomingLoading } = useQuery({
    queryKey: ['governance-reviews-upcoming', typeFilter],
    queryFn: async () => {
      const params: Record<string, string | number> = { days: 90 };
      if (typeFilter) params.doc_type = typeFilter;
      const response = await governanceApi.getUpcomingReviews(params);
      return response.data as ReviewListResponse;
    }
  });

  const { data: governanceActions, isLoading: actionsLoading } = useQuery({
    queryKey: ['my-pending-reviews', actionStatusFilter],
    queryFn: async () => {
      if (actionStatusFilter === 'pending_review' || actionStatusFilter === 'all') {
        // For pending reviews, use my-pending-reviews endpoint
        const response = await governanceApi.getMyPendingReviews({});
        return response.data as GovernanceActionsResponse;
      } else {
        // For other statuses, use the general endpoint
        const params: Record<string, string> = {};
        if (actionStatusFilter && actionStatusFilter !== 'all') {
          params.status_filter = actionStatusFilter;
        }
        const response = await governanceApi.getAllGovernanceActions(params);
        return response.data as GovernanceActionsResponse;
      }
    }
  });

  const completeMutation = useMutation({
    mutationFn: async (documentId: number) => {
      return governanceApi.completeReview(documentId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['governance-review-statistics'] });
      queryClient.invalidateQueries({ queryKey: ['governance-reviews-overdue'] });
      queryClient.invalidateQueries({ queryKey: ['governance-reviews-upcoming'] });
      setCompletingId(null);
    },
    onError: () => {
      setCompletingId(null);
    }
  });

  const handleCompleteReview = (documentId: number) => {
    setCompletingId(documentId);
    completeMutation.mutate(documentId);
  };

  const overdueDocuments = overdueData?.items || [];
  const upcomingDocuments = upcomingData?.items || [];
  const allDocuments = useMemo(() => {
    const combined = [...overdueDocuments, ...upcomingDocuments];
    const uniqueMap = new Map();
    combined.forEach(doc => uniqueMap.set(doc.id, doc));
    return Array.from(uniqueMap.values()).sort((a, b) => {
      if (!a.next_review_date) return 1;
      if (!b.next_review_date) return -1;
      return new Date(a.next_review_date).getTime() - new Date(b.next_review_date).getTime();
    });
  }, [overdueDocuments, upcomingDocuments]);

  const getDisplayedDocuments = () => {
    switch (activeTab) {
      case 'overdue':
        return overdueDocuments;
      case 'upcoming':
        return upcomingDocuments.filter(d => !d.is_overdue);
      case 'all':
        return allDocuments;
      default:
        return [];
    }
  };

  const isLoading = statsLoading || overdueLoading || upcomingLoading;
  const pendingActionsCount = governanceActions?.items?.filter(a => a.review_status === 'pending_review').length || 0;

  const tabs = [
    { key: 'overdue', label: 'Overdue', count: statistics?.overdue || 0 },
    { key: 'upcoming', label: 'Upcoming', count: statistics?.due_next_30_days || 0 },
    { key: 'completed', label: 'Completed', count: 0 },
    { key: 'all', label: 'All', count: allDocuments.length },
  ];

  if (reviewsSection === 'actions') {
    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <div>
          <h1 className="text-sm font-semibold text-black">My Reviews</h1>
          <p className="text-xs text-gray-500">Track and manage your submitted actions requiring review</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setReviewsSection('actions')}
              className="flex items-center gap-1.5 rounded border border-blue-600 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700"
            >
              <Eye className="h-3.5 w-3.5" />
              Actions {pendingActionsCount > 0 && <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] text-white">{pendingActionsCount}</span>}
            </button>
            <button
              onClick={() => setReviewsSection('documents')}
              className="flex items-center gap-1.5 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              <FileCheck className="h-4 w-4" />
              Documents
            </button>
          </div>
        </div>

        <div className="grid gap-2.5 md:grid-cols-3">
          <div className="rounded-lg border border-amber-200 bg-white p-3">
            <div className="flex items-center gap-2.5">
              <div className="rounded bg-amber-50 p-1.5">
                <Clock className="h-4 w-4 text-amber-500" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Pending Review</p>
                <p className="text-xl font-bold text-amber-500">
                  {actionsLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : pendingActionsCount}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-blue-200 bg-white p-3">
            <div className="flex items-center gap-2.5">
              <div className="rounded bg-blue-50 p-1.5">
                <Eye className="h-4 w-4 text-blue-500" />
              </div>
              <div>
                <p className="text-xs text-gray-500">In Review</p>
                <p className="text-xl font-bold text-blue-500">
                  {actionsLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : governanceActions?.items?.filter(a => a.review_status === 'in_review').length || 0}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-green-200 bg-white p-3">
            <div className="flex items-center gap-2.5">
              <div className="rounded bg-green-50 p-1.5">
                <CheckCircle2 className="h-4 w-4 text-green-600" />
              </div>
              <div>
                <p className="text-xs text-gray-500">Approved</p>
                <p className="text-xl font-bold text-green-600">
                  {actionsLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : governanceActions?.items?.filter(a => a.review_status === 'approved').length || 0}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-gray-300 bg-white">
          <div className="flex flex-col gap-4 border-b border-gray-300 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-1.5 overflow-x-auto">
              {['all', 'pending_review', 'in_review', 'approved', 'rejected'].map((status) => (
                <button
                  key={status}
                  onClick={() => setActionStatusFilter(status)}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded border px-2.5 py-1 text-xs font-medium transition-colors ${actionStatusFilter === status
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                >
                  {status === 'all' ? 'All Actions' : status.replace(/_/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                </button>
              ))}
            </div>
          </div>

          <div className="p-3">
            {actionsLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-primary-400" />
              </div>
            ) : !governanceActions?.items || governanceActions.items.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center gap-2 text-gray-400">
                <CheckCircle className="h-7 w-7" />
                <p className="text-xs">No governance actions found</p>
              </div>
            ) : (
              <div className="space-y-3">
                {governanceActions.items.map((action) => {
                  const actionColor = getActionTypeColor(action.action_type);
                  const ActionIcon = actionColor.icon;
                  const statusColor = getStatusColor(action.review_status);

                  return (
                    <div
                      key={action.id}
                      className={`rounded-lg border px-3 py-2 transition-colors hover:bg-gray-50 ${action.review_status === 'pending_review'
                          ? 'border-amber-200 bg-amber-50/50'
                          : 'border-gray-200 bg-white'
                        }`}
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex items-start gap-4 flex-1 min-w-0">
                          <div className={`rounded p-1.5 ${actionColor.bgColor}`}>
                            <ActionIcon className={`h-4 w-4 ${actionColor.textColor}`} />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="text-xs font-medium text-black">{action.action_description}</h3>
                              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusColor}`}>
                                {action.review_status.replace(/_/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                              </span>
                            </div>

                            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-500">
                              <span className={`inline-flex items-center gap-1 ${actionColor.textColor}`}>
                                <ActionIcon className="h-3.5 w-3.5" />
                                {getActionTypeLabel(action.action_type)}
                              </span>
                              {action.action_user_name && (
                                <span>By: {action.action_user_name}</span>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <p className="text-gray-400 text-[10px]">Action Date</p>
                              <p className="text-gray-700">{formatDate(action.action_date)}</p>
                            </div>
                            <div>
                              <p className="text-gray-400 text-[10px]">Entity Type</p>
                              <p className="text-gray-700 capitalize">{action.entity_type.replace(/_/g, ' ')}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-sm font-semibold text-black">Document Reviews</h1>
          <p className="text-xs text-gray-500">Track and complete document review schedules</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setReviewsSection('actions')}
            className="flex items-center gap-2 rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-100"
          >
            <Eye className="h-4 w-4" />
            Actions {pendingActionsCount > 0 && <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs text-white">{pendingActionsCount}</span>}
          </button>
          <button
            onClick={() => setReviewsSection('documents')}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-black"
          >
            <FileCheck className="h-4 w-4" />
            Documents
          </button>
          <a
            href="/governance/reviews/calendar"
            className="flex items-center gap-1.5 rounded border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <CalendarDays className="h-4 w-4" />
            Calendar View
          </a>
        </div>
      </div>

      <div className="grid gap-2.5 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded bg-blue-50 p-1.5">
              <Calendar className="h-4 w-4 text-blue-500" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Upcoming (30 days)</p>
              <p className="text-xl font-bold text-black">
                {statsLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : statistics?.due_next_30_days || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-red-200 bg-white p-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded bg-red-50 p-1.5">
              <AlertTriangle className="h-4 w-4 text-red-500" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Overdue Reviews</p>
              <p className="text-xl font-bold text-red-500">
                {statsLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : statistics?.overdue || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded bg-green-50 p-1.5">
              <CheckCircle className="h-4 w-4 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Completed This Month</p>
              <p className="text-xl font-bold text-black">
                {statsLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : statistics?.by_status?.on_track || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-amber-200 bg-white p-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded bg-amber-50 p-1.5">
              <Clock className="h-4 w-4 text-amber-500" />
            </div>
            <div>
              <p className="text-xs text-gray-500">Due This Week</p>
              <p className="text-xl font-bold text-amber-500">
                {statsLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : statistics?.due_this_week || 0}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-gray-300 bg-white">
        <div className="flex flex-col gap-4 border-b border-gray-300 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-1.5 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as TabType)}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded border px-2.5 py-1 text-xs font-medium transition-colors ${activeTab === tab.key
                    ? 'border-blue-600 bg-blue-50 text-blue-700'
                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                  }`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] ${activeTab === tab.key ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                    } ${tab.key === 'overdue' && activeTab !== tab.key ? 'bg-red-100 text-red-500' : ''}`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <Filter className="h-4 w-4 text-gray-600" />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded border border-gray-300 bg-white px-2 py-1 text-xs text-black focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              {DOCUMENT_TYPES.map(type => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="p-3">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary-400" />
            </div>
          ) : activeTab === 'completed' ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 text-gray-400">
              <CheckCircle className="h-7 w-7" />
              <p className="text-xs">Completed reviews will appear here</p>
            </div>
          ) : getDisplayedDocuments().length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 text-gray-400">
              <CalendarDays className="h-7 w-7" />
              <p className="text-xs">No documents found for this filter</p>
            </div>
          ) : (
            <div className="space-y-3">
              {getDisplayedDocuments().map((doc) => {
                const typeStyle = getTypeStyle(doc.doc_type);
                const TypeIcon = typeStyle.icon || FileText;
                const daysDisplay = getDaysDisplay(doc.days_until_review, doc.is_overdue);

                return (
                  <div
                    key={doc.id}
                    className={`rounded-lg border px-3 py-2 transition-colors hover:bg-gray-50 ${doc.is_overdue
                        ? 'border-red-200 bg-red-50/50'
                        : 'border-gray-200 bg-white'
                      }`}
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex items-start gap-4 flex-1 min-w-0">
                        <div className={`rounded p-1.5 ${typeStyle.bgColor}`}>
                          <TypeIcon className={`h-4 w-4 ${typeStyle.color}`} />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-xs font-medium text-black truncate">{doc.title}</h3>
                            {doc.is_overdue && (
                              <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-400">
                                Overdue
                              </span>
                            )}
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-600">
                            <span className={`inline-flex items-center gap-1 ${typeStyle.color}`}>
                              <TypeIcon className="h-3.5 w-3.5" />
                              {typeStyle.label}
                            </span>
                            {doc.owner_name && (
                              <span>Owner: {doc.owner_name}</span>
                            )}
                            {doc.document_code && (
                              <span className="font-mono text-xs">{doc.document_code}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <p className="text-gray-700 text-xs">Next Review</p>
                            <p className="text-gray-800">{formatDate(doc.next_review_date)}</p>
                          </div>
                          <div>
                            <p className="text-gray-700 text-xs">Status</p>
                            <p className={daysDisplay.className}>{daysDisplay.text}</p>
                          </div>
                          <div>
                            <p className="text-gray-700 text-xs">Last Reviewed</p>
                            <p className="text-gray-800">{formatDate(doc.last_reviewed_at)}</p>
                          </div>
                          <div>
                            <p className="text-gray-700 text-xs">Cycle</p>
                            <p className="text-gray-800">{doc.review_cycle_months} months</p>
                          </div>
                        </div>

                        <button
                          onClick={() => handleCompleteReview(doc.id)}
                          disabled={completingId === doc.id}
                          className={`flex items-center gap-1 whitespace-nowrap rounded px-2.5 py-1 text-xs font-medium transition-colors ${doc.is_overdue
                              ? 'border border-red-300 bg-red-50 text-red-700 hover:bg-red-100'
                              : 'border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100'
                            } disabled:opacity-50`}
                        >
                          {completingId === doc.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <CheckCircle className="h-4 w-4" />
                          )}
                          Complete Review
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {statistics && Object.keys(statistics.by_doc_type).length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <h3 className="mb-2 text-xs font-semibold text-black">Reviews by Document Type</h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(statistics.by_doc_type).map(([docType, data]) => {
              const typeStyle = getTypeStyle(docType);
              const TypeIcon = typeStyle.icon || FileText;

              return (
                <div
                  key={docType}
                  className="rounded-lg border border-gray-200 bg-white p-2.5"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <div className={`rounded p-1 ${typeStyle.bgColor}`}>
                      <TypeIcon className={`h-3 w-3 ${typeStyle.color}`} />
                    </div>
                    <span className="text-xs font-medium text-black">{typeStyle.label}</span>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-gray-500">Total</span>
                      <span className="text-[10px] font-semibold text-black">{data.total}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-gray-500">Overdue</span>
                      <span className={`text-[10px] font-semibold ${data.overdue > 0 ? 'text-red-500' : 'text-gray-500'}`}>
                        {data.overdue}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-gray-500">Due Soon</span>
                      <span className={`text-[10px] font-semibold ${data.due_soon > 0 ? 'text-amber-500' : 'text-gray-500'}`}>
                        {data.due_soon}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
