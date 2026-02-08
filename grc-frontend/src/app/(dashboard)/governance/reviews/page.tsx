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

const DOCUMENT_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'policy', label: 'Policy', icon: BookOpen, color: 'text-primary-600', bgColor: 'bg-primary-500/20' },
  { value: 'standard', label: 'Standard', icon: FileCheck, color: 'text-blue-400', bgColor: 'bg-blue-500/20' },
  { value: 'procedure', label: 'Procedure', icon: ClipboardList, color: 'text-green-400', bgColor: 'bg-green-500/20' },
  { value: 'guideline', label: 'Guideline', icon: Lightbulb, color: 'text-yellow-400', bgColor: 'bg-yellow-500/20' },
  { value: 'charter', label: 'Charter', icon: Shield, color: 'text-cyan-400', bgColor: 'bg-cyan-500/20' },
  { value: 'framework', label: 'Framework', icon: Layers, color: 'text-orange-400', bgColor: 'bg-orange-500/20' },
];

const getTypeStyle = (type: string) => {
  return DOCUMENT_TYPES.find(t => t.value === type) || { label: type, color: 'text-slate-400', bgColor: 'bg-slate-500/20', icon: FileText };
};

type TabType = 'overdue' | 'upcoming' | 'completed' | 'all';

export default function GovernanceReviewsPage() {
  const [activeTab, setActiveTab] = useState<TabType>('overdue');
  const [typeFilter, setTypeFilter] = useState('');
  const [completingId, setCompletingId] = useState<number | null>(null);
  const queryClient = useQueryClient();

  const { data: statistics, isLoading: statsLoading } = useQuery({
    queryKey: ['governance-review-statistics'],
    queryFn: async () => {
      const response = await governanceApi.getReviewStatistics();
      return response.data as ReviewStatistics;
    },
  });

  const { data: overdueData, isLoading: overdueLoading } = useQuery({
    queryKey: ['governance-reviews-overdue', typeFilter],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (typeFilter) params.doc_type = typeFilter;
      const response = await governanceApi.getOverdueReviews(params);
      return response.data as ReviewListResponse;
    },
  });

  const { data: upcomingData, isLoading: upcomingLoading } = useQuery({
    queryKey: ['governance-reviews-upcoming', typeFilter],
    queryFn: async () => {
      const params: Record<string, string | number> = { days: 90 };
      if (typeFilter) params.doc_type = typeFilter;
      const response = await governanceApi.getUpcomingReviews(params);
      return response.data as ReviewListResponse;
    },
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
    },
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

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString();
  };

  const getDaysDisplay = (days: number | null, isOverdue: boolean) => {
    if (days === null) return { text: '-', className: 'text-slate-400' };
    
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

  const tabs: { key: TabType; label: string; count: number }[] = [
    { key: 'overdue', label: 'Overdue', count: statistics?.overdue || 0 },
    { key: 'upcoming', label: 'Upcoming', count: statistics?.due_next_30_days || 0 },
    { key: 'completed', label: 'Completed', count: 0 },
    { key: 'all', label: 'All', count: allDocuments.length },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Document Reviews</h1>
          <p className="text-slate-400">Track and complete document review schedules</p>
        </div>
        <a
          href="/governance/reviews/calendar"
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
        >
          <CalendarDays className="h-4 w-4" />
          Calendar View
        </a>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary-500/20 p-3">
              <Calendar className="h-6 w-6 text-primary-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Upcoming (30 days)</p>
              <p className="text-3xl font-bold text-slate-800">
                {statsLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : statistics?.due_next_30_days || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-red-500/30 bg-white p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-red-500/20 p-3">
              <AlertTriangle className="h-6 w-6 text-red-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Overdue Reviews</p>
              <p className="text-3xl font-bold text-red-400">
                {statsLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : statistics?.overdue || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-500/20 p-3">
              <CheckCircle className="h-6 w-6 text-green-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Completed This Month</p>
              <p className="text-3xl font-bold text-slate-800">
                {statsLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : statistics?.by_status?.on_track || 0}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-amber-500/30 bg-white p-5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-500/20 p-3">
              <Clock className="h-6 w-6 text-amber-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Due This Week</p>
              <p className="text-3xl font-bold text-amber-400">
                {statsLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : statistics?.due_this_week || 0}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex flex-col gap-4 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-2 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? 'bg-primary-600 text-white'
                    : 'bg-slate-200 text-slate-600 hover:bg-slate-600'
                }`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className={`rounded-full px-2 py-0.5 text-xs ${
                    activeTab === tab.key ? 'bg-primary-500' : 'bg-slate-600'
                  } ${tab.key === 'overdue' && activeTab !== tab.key ? 'bg-red-500/30 text-red-400' : ''}`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <Filter className="h-4 w-4 text-slate-400" />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-sm text-slate-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
            >
              {DOCUMENT_TYPES.map(type => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="p-4">
          {isLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
            </div>
          ) : activeTab === 'completed' ? (
            <div className="flex h-64 flex-col items-center justify-center gap-4 text-slate-400">
              <CheckCircle className="h-12 w-12" />
              <p>Completed reviews will appear here</p>
            </div>
          ) : getDisplayedDocuments().length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center gap-4 text-slate-400">
              <CalendarDays className="h-12 w-12" />
              <p>No documents found for this filter</p>
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
                    className={`rounded-lg border p-4 transition-colors hover:bg-slate-50 ${
                      doc.is_overdue
                        ? 'border-red-500/50 bg-red-500/5'
                        : 'border-slate-200 bg-slate-50/50'
                    }`}
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="flex items-start gap-4 flex-1 min-w-0">
                        <div className={`rounded-lg p-2.5 ${typeStyle.bgColor}`}>
                          <TypeIcon className={`h-5 w-5 ${typeStyle.color}`} />
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-medium text-slate-800 truncate">{doc.title}</h3>
                            {doc.is_overdue && (
                              <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs font-medium text-red-400">
                                Overdue
                              </span>
                            )}
                          </div>
                          
                          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-400">
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
                            <p className="text-slate-500 text-xs">Next Review</p>
                            <p className="text-slate-600">{formatDate(doc.next_review_date)}</p>
                          </div>
                          <div>
                            <p className="text-slate-500 text-xs">Status</p>
                            <p className={daysDisplay.className}>{daysDisplay.text}</p>
                          </div>
                          <div>
                            <p className="text-slate-500 text-xs">Last Reviewed</p>
                            <p className="text-slate-600">{formatDate(doc.last_reviewed_at)}</p>
                          </div>
                          <div>
                            <p className="text-slate-500 text-xs">Cycle</p>
                            <p className="text-slate-600">{doc.review_cycle_months} months</p>
                          </div>
                        </div>

                        <button
                          onClick={() => handleCompleteReview(doc.id)}
                          disabled={completingId === doc.id}
                          className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-4 py-2 font-medium transition-colors ${
                            doc.is_overdue
                              ? 'bg-red-600 text-white hover:bg-red-700'
                              : 'bg-primary-600 text-white hover:bg-primary-700'
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
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="mb-4 text-lg font-semibold text-slate-800">Reviews by Document Type</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(statistics.by_doc_type).map(([docType, data]) => {
              const typeStyle = getTypeStyle(docType);
              const TypeIcon = typeStyle.icon || FileText;
              
              return (
                <div
                  key={docType}
                  className="rounded-lg border border-slate-200 bg-slate-50/50 p-4"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className={`rounded-lg p-2 ${typeStyle.bgColor}`}>
                      <TypeIcon className={`h-4 w-4 ${typeStyle.color}`} />
                    </div>
                    <span className="font-medium text-slate-800">{typeStyle.label}</span>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-400">Total</span>
                      <span className="text-sm font-medium text-slate-800">{data.total}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-400">Overdue</span>
                      <span className={`text-sm font-medium ${data.overdue > 0 ? 'text-red-400' : 'text-slate-400'}`}>
                        {data.overdue}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-400">Due Soon</span>
                      <span className={`text-sm font-medium ${data.due_soon > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
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
