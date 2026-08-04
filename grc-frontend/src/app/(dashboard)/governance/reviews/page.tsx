'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { governanceApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Calendar,
  Clock,
  AlertTriangle,
  CheckCircle,
  Loader2,
  FileText,
  BookOpen,
  FileCheck,
  ClipboardList,
  Lightbulb,
  Shield,
  Layers,
  CalendarDays,
  CheckCircle2,
  Eye,
} from 'lucide-react';
import { MultiSelectDropdown } from '@/components/ui';
import AttestationsPage from '../attestations/page';

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
  { value: 'policy', label: 'Policy', icon: BookOpen, color: 'text-purple-700', bgColor: 'bg-purple-50' },
  { value: 'standard', label: 'Standard', icon: FileCheck, color: 'text-teal-700', bgColor: 'bg-teal-50' },
  { value: 'procedure', label: 'Procedure', icon: ClipboardList, color: 'text-emerald-700', bgColor: 'bg-emerald-50' },
  { value: 'guideline', label: 'Guideline', icon: Lightbulb, color: 'text-amber-700', bgColor: 'bg-amber-50' },
  { value: 'charter', label: 'Charter', icon: Shield, color: 'text-primary-700', bgColor: 'bg-primary-50' },
  { value: 'framework', label: 'Framework', icon: Layers, color: 'text-orange-700', bgColor: 'bg-orange-50' },
];

const getTypeStyle = (type: string) => {
  return DOCUMENT_TYPES.find(t => t.value === type) || { label: type, color: 'text-slate-600', bgColor: 'bg-slate-100', icon: FileText };
};

type TabType = 'overdue' | 'upcoming' | 'all';
type ReviewsSection = 'documents' | 'actions' | 'attestations';

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString();
};

const getDaysDisplay = (days: number | null, isOverdue: boolean) => {
  if (days === null) return { text: '-', className: 'text-slate-500' };

  if (isOverdue || days < 0) {
    const absDays = Math.abs(days);
    return {
      text: `${absDays} day${absDays !== 1 ? 's' : ''} overdue`,
      className: 'text-red-600 font-medium',
    };
  }

  if (days === 0) {
    return { text: 'Due today', className: 'text-amber-600 font-medium' };
  }

  if (days <= 7) {
    return { text: `${days} day${days !== 1 ? 's' : ''} left`, className: 'text-amber-600' };
  }

  return { text: `${days} days left`, className: 'text-emerald-600' };
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
    'document_draft_created': { bgColor: 'bg-teal-50', textColor: 'text-teal-700', icon: FileText },
    'document_uploaded': { bgColor: 'bg-teal-50', textColor: 'text-teal-700', icon: FileText },
    'policy_statement_created': { bgColor: 'bg-purple-50', textColor: 'text-purple-700', icon: BookOpen },
    'risk_acceptance': { bgColor: 'bg-red-50', textColor: 'text-red-700', icon: AlertTriangle },
    'evidence_uploaded': { bgColor: 'bg-emerald-50', textColor: 'text-emerald-700', icon: CheckCircle },
    'committee_action': { bgColor: 'bg-amber-50', textColor: 'text-amber-700', icon: ClipboardList },
    'attestation_created': { bgColor: 'bg-primary-50', textColor: 'text-primary-700', icon: FileCheck },
    'certification_submitted': { bgColor: 'bg-orange-50', textColor: 'text-orange-700', icon: Shield },
  };
  return colorMap[actionType] || { bgColor: 'bg-slate-100', textColor: 'text-slate-600', icon: FileText };
};

const getStatusColor = (status: string) => {
  const statusColors: Record<string, string> = {
    'pending_review': 'bg-amber-50 text-amber-700 border-amber-200',
    'in_review': 'bg-teal-50 text-teal-700 border-teal-200',
    'approved': 'bg-emerald-50 text-emerald-700 border-emerald-200',
    'rejected': 'bg-red-50 text-red-700 border-red-200',
    'archived': 'bg-slate-100 text-slate-600 border-slate-200',
  };
  return statusColors[status] || 'bg-slate-100 text-slate-600 border-slate-200';
};

export default function GovernanceReviewsPage() {
  const [reviewsSection, setReviewsSection] = useState<ReviewsSection>('documents');
  const [activeTab, setActiveTab] = useState<TabType>('overdue');
  const [typeFilter, setTypeFilter] = useState('');
  const [actionStatusFilter, setActionStatusFilter] = useState('pending_review');
  const [completingId, setCompletingId] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('governance:document_management:edit');

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
    },
    placeholderData: keepPreviousData,
  });

  const { data: upcomingData, isLoading: upcomingLoading } = useQuery({
    queryKey: ['governance-reviews-upcoming', typeFilter],
    queryFn: async () => {
      const params: Record<string, string | number> = { days: 90 };
      if (typeFilter) params.doc_type = typeFilter;
      const response = await governanceApi.getUpcomingReviews(params);
      return response.data as ReviewListResponse;
    },
    placeholderData: keepPreviousData,
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
    },
    placeholderData: keepPreviousData,
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
    if (!window.confirm('Mark this document review as complete? This will reset its review cycle and next review date.')) {
      return;
    }
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
    { key: 'all', label: 'All', count: allDocuments.length },
  ];

  const sectionBtn = (key: ReviewsSection, label: string, Icon: any, badge?: number) => (
    <button
      onClick={() => setReviewsSection(key)}
      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
        reviewsSection === key
          ? 'border-primary-600 bg-primary-50 text-primary-700'
          : 'border-slate-200 text-slate-700 hover:bg-slate-50'
      }`}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
      {label}
      {badge != null && badge > 0 && (
        <span className="rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] text-white">{badge}</span>
      )}
    </button>
  );
  const sectionButtons = (
    <>
      {sectionBtn('documents', 'Document Reviews', FileCheck)}
      {sectionBtn('actions', 'Actions', Eye, pendingActionsCount)}
      {sectionBtn('attestations', 'Attestations', ClipboardList)}
    </>
  );

  if (reviewsSection === 'attestations') {
    return (
      <div className="space-y-4 sm:space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-lg sm:text-xl font-semibold text-slate-900">Pending Approvals</h1>
            <p className="text-xs sm:text-sm text-slate-500">Policy attestations &amp; certification campaigns</p>
          </div>
          <div className="flex flex-wrap gap-2">{sectionButtons}</div>
        </div>
        <AttestationsPage />
      </div>
    );
  }

  if (reviewsSection === 'actions') {
    return (
      <div className="space-y-4 sm:space-y-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900">Pending Approvals</h1>
          <p className="text-xs sm:text-sm text-slate-500">Actions and documents awaiting your review and approval</p>
          </div>
          <div className="flex flex-wrap gap-2">{sectionButtons}</div>
        </div>

        <div className="grid gap-2.5 md:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2.5">
              <div className="rounded bg-amber-50 p-1.5">
                <Clock className="h-4 w-4 text-amber-600" strokeWidth={1.75} />
              </div>
              <div>
                <p className="text-xs text-slate-500">Pending Review</p>
                <p className="text-xl font-bold text-amber-600">
                  {actionsLoading ? <Loader2 className="h-6 w-6 animate-spin" strokeWidth={1.75} /> : pendingActionsCount}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2.5">
              <div className="rounded bg-primary-50 p-1.5">
                <Eye className="h-4 w-4 text-primary-600" strokeWidth={1.75} />
              </div>
              <div>
                <p className="text-xs text-slate-500">In Review</p>
                <p className="text-xl font-bold text-primary-600">
                  {actionsLoading ? <Loader2 className="h-6 w-6 animate-spin" strokeWidth={1.75} /> : governanceActions?.items?.filter(a => a.review_status === 'in_review').length || 0}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-2.5">
              <div className="rounded bg-emerald-50 p-1.5">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" strokeWidth={1.75} />
              </div>
              <div>
                <p className="text-xs text-slate-500">Approved</p>
                <p className="text-xl font-bold text-emerald-600">
                  {actionsLoading ? <Loader2 className="h-6 w-6 animate-spin" strokeWidth={1.75} /> : governanceActions?.items?.filter(a => a.review_status === 'approved').length || 0}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-3 sm:px-4">
            <nav className="flex gap-4 sm:gap-6 overflow-x-auto" aria-label="Action status">
              {['all', 'pending_review', 'in_review', 'approved', 'rejected'].map((status) => (
                <button
                  key={status}
                  onClick={() => setActionStatusFilter(status)}
                  className={`whitespace-nowrap border-b-2 px-1 py-2.5 text-sm font-medium transition-colors ${
                    actionStatusFilter === status
                      ? 'border-primary-600 text-primary-700'
                      : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
                  }`}
                >
                  {status === 'all' ? 'All Actions' : status.replace(/_/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                </button>
              ))}
            </nav>
          </div>

          <div className="p-3">
            {actionsLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-primary-500" strokeWidth={1.75} />
              </div>
            ) : !governanceActions?.items || governanceActions.items.length === 0 ? (
              <div className="flex h-32 flex-col items-center justify-center gap-2 text-slate-400">
                <CheckCircle className="h-7 w-7" strokeWidth={1.75} />
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
                      className={`rounded-lg border px-3 py-2 transition-colors hover:bg-slate-50 ${action.review_status === 'pending_review'
                          ? 'border-amber-200 bg-amber-50/50'
                          : 'border-slate-200 bg-white'
                        }`}
                    >
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex items-start gap-4 flex-1 min-w-0">
                          <div className={`rounded p-1.5 ${actionColor.bgColor}`}>
                            <ActionIcon className={`h-4 w-4 ${actionColor.textColor}`} strokeWidth={1.75} />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <h3 className="text-xs font-medium text-slate-900">{action.action_description}</h3>
                              <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusColor}`}>
                                {action.review_status.replace(/_/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                              </span>
                            </div>

                            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                              <span className={`inline-flex items-center gap-1 ${actionColor.textColor}`}>
                                <ActionIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
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
                              <p className="text-slate-400 text-[10px]">Action Date</p>
                              <p className="text-slate-700">{formatDate(action.action_date)}</p>
                            </div>
                            <div>
                              <p className="text-slate-400 text-[10px]">Entity Type</p>
                              <p className="text-slate-700 capitalize">{action.entity_type.replace(/_/g, ' ')}</p>
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
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900">Document Reviews</h1>
          <p className="text-xs sm:text-sm text-slate-500">Track and complete document review schedules</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {sectionButtons}
          <a
            href="/governance/reviews/calendar"
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <CalendarDays className="h-4 w-4" strokeWidth={1.75} />
            Calendar View
          </a>
        </div>
      </div>

      <div className="grid gap-2.5 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded bg-primary-50 p-1.5">
              <Calendar className="h-4 w-4 text-primary-600" strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-xs text-slate-500">Upcoming (30 days)</p>
              <p className="text-xl font-bold text-slate-900">
                {statsLoading ? <Loader2 className="h-6 w-6 animate-spin" strokeWidth={1.75} /> : statistics?.due_next_30_days || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded bg-red-50 p-1.5">
              <AlertTriangle className="h-4 w-4 text-red-600" strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-xs text-slate-500">Overdue Reviews</p>
              <p className="text-xl font-bold text-red-600">
                {statsLoading ? <Loader2 className="h-6 w-6 animate-spin" strokeWidth={1.75} /> : statistics?.overdue || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded bg-emerald-50 p-1.5">
              <CheckCircle className="h-4 w-4 text-emerald-600" strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-xs text-slate-500">On Track</p>
              <p className="text-xl font-bold text-slate-900">
                {statsLoading ? <Loader2 className="h-6 w-6 animate-spin" strokeWidth={1.75} /> : statistics?.by_status?.on_track || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded bg-amber-50 p-1.5">
              <Clock className="h-4 w-4 text-amber-600" strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-xs text-slate-500">Due This Week</p>
              <p className="text-xl font-bold text-amber-600">
                {statsLoading ? <Loader2 className="h-6 w-6 animate-spin" strokeWidth={1.75} /> : statistics?.due_this_week || 0}
              </p>
            </div>
          </div>
        </div>
      </div>

      {statistics && Object.keys(statistics.by_doc_type).length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <div className="flex items-center gap-3 overflow-x-auto">
            <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              By type
            </span>
            {Object.entries(statistics.by_doc_type).map(([docType, data]) => {
              const typeStyle = getTypeStyle(docType);
              const TypeIcon = typeStyle.icon || FileText;

              return (
                <div
                  key={docType}
                  className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-slate-200 px-2.5 py-1"
                >
                  <span className={`rounded p-1 ${typeStyle.bgColor}`}>
                    <TypeIcon className={`h-3 w-3 ${typeStyle.color}`} strokeWidth={1.75} />
                  </span>
                  <span className="text-xs font-medium text-slate-900">{typeStyle.label}</span>
                  <span className="text-[11px] text-slate-500">{data.total} total</span>
                  {data.overdue > 0 && (
                    <span className="rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-medium text-red-700">
                      {data.overdue} overdue
                    </span>
                  )}
                  {data.due_soon > 0 && (
                    <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                      {data.due_soon} soon
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-col gap-3 border-b border-slate-200 px-3 sm:px-4 sm:flex-row sm:items-center sm:justify-between">
          <nav className="flex gap-4 sm:gap-6 overflow-x-auto" aria-label="Review tabs">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as TabType)}
                className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-1 py-2.5 text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? 'border-primary-600 text-primary-700'
                    : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] ${activeTab === tab.key ? 'bg-primary-50 text-primary-700' : 'bg-slate-100 text-slate-500'
                    } ${tab.key === 'overdue' && activeTab !== tab.key ? 'bg-red-50 text-red-600' : ''}`}
                  >
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div className="pb-3 sm:pb-0">
            <MultiSelectDropdown
              title="Type"
              items={DOCUMENT_TYPES.filter((t) => t.value).map((t) => ({ value: t.value, label: t.label }))}
              selectedValues={typeFilter ? [typeFilter] : []}
              onApply={(values) => setTypeFilter(values[0] || '')}
              multiSelect={false}
              placeholder="All Types"
              size="sm"
            />
          </div>
        </div>

        <div className="p-3">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-primary-500" strokeWidth={1.75} />
            </div>
          ) : getDisplayedDocuments().length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center gap-2 text-slate-400">
              <CalendarDays className="h-7 w-7" strokeWidth={1.75} />
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
                    className={`rounded-lg border px-3 py-2 transition-colors hover:bg-slate-50 ${doc.is_overdue
                        ? 'border-red-200 bg-red-50/50'
                        : 'border-slate-200 bg-white'
                      }`}
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex items-start gap-4 flex-1 min-w-0">
                        <div className={`rounded p-1.5 ${typeStyle.bgColor}`}>
                          <TypeIcon className={`h-4 w-4 ${typeStyle.color}`} strokeWidth={1.75} />
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="text-xs font-medium text-slate-900 truncate">{doc.title}</h3>
                            {doc.is_overdue && (
                              <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                                Overdue
                              </span>
                            )}
                          </div>

                          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
                            <span className={`inline-flex items-center gap-1 ${typeStyle.color}`}>
                              <TypeIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
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
                            <p className="text-slate-500 text-xs">Next Review</p>
                            <p className="text-slate-800">{formatDate(doc.next_review_date)}</p>
                          </div>
                          <div>
                            <p className="text-slate-500 text-xs">Status</p>
                            <p className={daysDisplay.className}>{daysDisplay.text}</p>
                          </div>
                          <div>
                            <p className="text-slate-500 text-xs">Last Reviewed</p>
                            <p className="text-slate-800">{formatDate(doc.last_reviewed_at)}</p>
                          </div>
                          <div>
                            <p className="text-slate-500 text-xs">Cycle</p>
                            <p className="text-slate-800">{doc.review_cycle_months} months</p>
                          </div>
                        </div>

                        {canEdit && <button
                          onClick={() => handleCompleteReview(doc.id)}
                          disabled={completingId === doc.id}
                          className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium transition-colors ${doc.is_overdue
                              ? 'border border-red-200 bg-red-50 text-red-700 hover:bg-red-100'
                              : 'bg-primary-600 text-[color:var(--color-on-base,#0a0a0a)] hover:bg-primary-700'
                            } disabled:opacity-50`}
                        >
                          {completingId === doc.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                          ) : (
                            <CheckCircle className="h-4 w-4" strokeWidth={1.75} />
                          )}
                          Complete Review
                        </button>}
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
