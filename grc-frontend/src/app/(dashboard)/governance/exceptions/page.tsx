'use client';

import { useState, useMemo } from 'react';

import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { policyExceptionApi, governanceApi, documentsApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Shield,
  Plus,
  CheckCircle,
  Loader2,
  AlertCircle,
  Eye,
  Edit2,
  Send,
  Check,
  XCircle,
  Ban,
  MessageSquare,
  Sparkles,
  Trash2,
  Search,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { RightSlidePanel, SearchInput, MultiSelectDropdown } from '@/components/ui';

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending_approval', label: 'Pending Approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' },
  { value: 'revoked', label: 'Revoked' },
];

const PRIORITY_OPTIONS = [
  { value: '', label: 'All Priorities' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-gray-100', text: 'text-black', label: 'Draft' },
  pending_approval: { bg: 'bg-yellow-100', text: 'text-black', label: 'Pending Approval' },
  approved: { bg: 'bg-green-100', text: 'text-black', label: 'Approved' },
  rejected: { bg: 'bg-red-100', text: 'text-black', label: 'Rejected' },
  expired: { bg: 'bg-orange-100', text: 'text-black', label: 'Expired' },
  revoked: { bg: 'bg-gray-200', text: 'text-black', label: 'Revoked' },
};

const PRIORITY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  low: { bg: 'bg-gray-100', text: 'text-black', label: 'Low' },
  medium: { bg: 'bg-blue-100', text: 'text-black', label: 'Medium' },
  high: { bg: 'bg-amber-100', text: 'text-black', label: 'High' },
  critical: { bg: 'bg-red-100', text: 'text-black', label: 'Critical' },
};

interface ExceptionItem {
  id: number;
  title: string;
  document_id: number | null;
  document_title?: string;
  policy_name?: string;
  status: string;
  priority: string;
  justification: string;
  risk_assessment: string;
  compensating_controls: string;
  requested_by: string;
  requested_by_name?: string;
  requester_name?: string;
  effective_date: string | null;
  expiry_date: string | null;
  created_at: string;
  updated_at: string | null;
  rejection_reason?: string;
  approval_comments?: string;
  approved_by_name?: string;
  approved_at?: string;
}

interface ExceptionComment {
  id: number;
  comment: string;
  user_name: string;
  created_at: string;
}

interface GovernancePolicyOption {
  id: number;
  title: string;
  document_code?: string;
  doc_type?: string;
}

interface PolicySearchResult {
  document_id: number;
  document_title?: string;
  doc_type?: string;
  document_code?: string | null;
  match_field: string;
  snippet: string;
  statement_id?: number | null;
  statement_code?: string | null;
}

interface ExceptionCandidate {
  document_id: number;
  document_title?: string;
  suggested_title: string;
  rationale: string;
  suggested_priority: string;
  source?: string;
}

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function PolicyExceptionsPage() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('governance:policy_exceptions:create');
  const canDelete = hasPermission('governance:policy_exceptions:delete');
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingException, setEditingException] = useState<ExceptionItem | null>(null);
  const [viewingException, setViewingException] = useState<ExceptionItem | null>(null);
  const [approveModal, setApproveModal] = useState<ExceptionItem | null>(null);
  const [rejectModal, setRejectModal] = useState<ExceptionItem | null>(null);
  const [revokeModal, setRevokeModal] = useState<ExceptionItem | null>(null);
  const [approveComments, setApproveComments] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [revokeReason, setRevokeReason] = useState('');
  const [newComment, setNewComment] = useState('');
  const [formData, setFormData] = useState({
    title: '',
    document_id: '' as string | number,
    justification: '',
    risk_assessment: '',
    compensating_controls: '',
    priority: 'medium',
    effective_date: '',
    expiry_date: '',
  });

  // ── Discover & generate exceptions (policy-content search + AI suggestions) ──
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [policyQuery, setPolicyQuery] = useState('');
  const [policyResults, setPolicyResults] = useState<PolicySearchResult[]>([]);
  const [searchingPolicies, setSearchingPolicies] = useState(false);
  const [searchedOnce, setSearchedOnce] = useState(false);
  const [candidates, setCandidates] = useState<ExceptionCandidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidateSource, setCandidateSource] = useState('');

  const queryClient = useQueryClient();

  const extractItemsArray = (payload: any): any[] => {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload?.exceptions)) return payload.exceptions;
    if (Array.isArray(payload?.documents)) return payload.documents;
    if (Array.isArray(payload?.data)) return payload.data;
    return [];
  };

  const { data: exceptions, isLoading, error: exceptionsError } = useQuery({
    queryKey: ['policy-exceptions', statusFilter, priorityFilter],
    queryFn: async () => {
      const params: Record<string, string | number> = {};
      if (statusFilter) params.status = statusFilter;
      if (priorityFilter) params.priority = priorityFilter;
      try {
        const response = await policyExceptionApi.getAll(params);
        return extractItemsArray(response.data) as ExceptionItem[];
      } catch {
        const fallback = await governanceApi.getExceptions();
        return extractItemsArray(fallback.data) as ExceptionItem[];
      }
    },
    placeholderData: keepPreviousData,
  });

  const { data: documents, error: documentsError } = useQuery({
    queryKey: ['governance-documents-list'],
    queryFn: async () => {
      try {
        const response = await governanceApi.getDocuments({ limit: 200 });
        const allDocs = extractItemsArray(response.data);
        const policyDocs = allDocs.filter((doc: any) => {
          const t = String(doc?.doc_type || '').toLowerCase();
          return t === 'policy' || t === 'standard' || t === 'procedure' || t === 'guideline' || t === 'charter';
        });
        return (policyDocs.length > 0 ? policyDocs : allDocs) as GovernancePolicyOption[];
      } catch {
        const fallback = await documentsApi.getAll();
        return extractItemsArray(fallback.data) as GovernancePolicyOption[];
      }
    },
  });

  const { data: comments, isLoading: commentsLoading } = useQuery({
    queryKey: ['exception-comments', viewingException?.id],
    queryFn: async () => {
      if (!viewingException) return [];
      const response = await policyExceptionApi.getComments(viewingException.id);
      return response.data as ExceptionComment[];
    },
    enabled: !!viewingException,
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      await policyExceptionApi.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policy-exceptions'] });
      queryClient.invalidateQueries({ queryKey: ['policy-exceptions-summary'] });
      setShowCreateModal(false);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
      await policyExceptionApi.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policy-exceptions'] });
      queryClient.invalidateQueries({ queryKey: ['policy-exceptions-summary'] });
      setEditingException(null);
      resetForm();
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (id: number) => {
      await policyExceptionApi.submit(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policy-exceptions'] });
      queryClient.invalidateQueries({ queryKey: ['policy-exceptions-summary'] });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data?: { comments?: string } }) => {
      await policyExceptionApi.approve(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policy-exceptions'] });
      queryClient.invalidateQueries({ queryKey: ['policy-exceptions-summary'] });
      setApproveModal(null);
      setApproveComments('');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { rejection_reason: string } }) => {
      await policyExceptionApi.reject(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policy-exceptions'] });
      queryClient.invalidateQueries({ queryKey: ['policy-exceptions-summary'] });
      setRejectModal(null);
      setRejectReason('');
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data?: { reason?: string } }) => {
      await policyExceptionApi.revoke(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policy-exceptions'] });
      queryClient.invalidateQueries({ queryKey: ['policy-exceptions-summary'] });
      setRevokeModal(null);
      setRevokeReason('');
    },
  });

  const addCommentMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { comment: string } }) => {
      await policyExceptionApi.addComment(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exception-comments', viewingException?.id] });
      setNewComment('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await policyExceptionApi.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policy-exceptions'] });
      queryClient.invalidateQueries({ queryKey: ['policy-exceptions-summary'] });
    },
  });

  const suggestContentMutation = useMutation({
    mutationFn: async (data: { title: string; document_id: number }) => {
      const response = await policyExceptionApi.suggestContent(data);
      return response.data as {
        justification?: string;
        risk_assessment?: string;
        compensating_controls?: string;
      };
    },
    onSuccess: (data) => {
      setFormData((prev) => ({
        ...prev,
        justification: prev.justification?.trim() ? prev.justification : (data.justification || ''),
        risk_assessment: prev.risk_assessment?.trim() ? prev.risk_assessment : (data.risk_assessment || ''),
        compensating_controls: prev.compensating_controls?.trim() ? prev.compensating_controls : (data.compensating_controls || ''),
      }));
    },
  });

  const resetForm = () => {
    setFormData({
      title: '',
      document_id: '',
      justification: '',
      risk_assessment: '',
      compensating_controls: '',
      priority: 'medium',
      effective_date: '',
      expiry_date: '',
    });
  };

  const openEditModal = (exception: ExceptionItem) => {
    setFormData({
      title: exception.title,
      document_id: exception.document_id || '',
      justification: exception.justification || '',
      risk_assessment: exception.risk_assessment || '',
      compensating_controls: exception.compensating_controls || '',
      priority: exception.priority || 'medium',
      effective_date: exception.effective_date || '',
      expiry_date: exception.expiry_date || '',
    });
    setEditingException(exception);
  };

  const handleSubmitForm = () => {
    const payload: Record<string, unknown> = {
      title: formData.title,
      justification: formData.justification,
      risk_assessment: formData.risk_assessment,
      compensating_controls: formData.compensating_controls,
      priority: formData.priority,
    };
    if (formData.document_id) payload.document_id = Number(formData.document_id);
    if (formData.effective_date) payload.effective_date = formData.effective_date;
    if (formData.expiry_date) payload.expiry_date = formData.expiry_date;

    if (editingException) {
      updateMutation.mutate({ id: editingException.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  // Open the (existing) create modal pre-filled — used by policy-search results
  // and AI candidate suggestions. Does not alter the create flow itself.
  const openCreateForDocument = (
    documentId: number,
    opts?: { title?: string; justification?: string; priority?: string }
  ) => {
    setFormData({
      title: opts?.title || '',
      document_id: documentId || '',
      justification: opts?.justification || '',
      risk_assessment: '',
      compensating_controls: '',
      priority: opts?.priority || 'medium',
      effective_date: '',
      expiry_date: '',
    });
    setEditingException(null);
    setShowCreateModal(true);
  };

  const runPolicySearch = async () => {
    const q = policyQuery.trim();
    if (!q) return;
    setSearchingPolicies(true);
    setSearchedOnce(true);
    try {
      const res = await policyExceptionApi.searchPolicies(q, 25);
      setPolicyResults((res.data?.results || []) as PolicySearchResult[]);
    } catch {
      setPolicyResults([]);
    } finally {
      setSearchingPolicies(false);
    }
  };

  const loadCandidates = async () => {
    setLoadingCandidates(true);
    try {
      const res = await policyExceptionApi.suggestCandidates({ limit: 8 });
      setCandidates((res.data?.candidates || []) as ExceptionCandidate[]);
      setCandidateSource(res.data?.source || '');
    } catch {
      setCandidates([]);
    } finally {
      setLoadingCandidates(false);
    }
  };

  // Reveal the panel; auto-load AI suggestions the first time it's opened.
  const toggleDiscover = () => {
    const willOpen = !discoverOpen;
    setDiscoverOpen(willOpen);
    if (willOpen && candidates.length === 0 && !loadingCandidates) loadCandidates();
  };

  const allExceptions = Array.isArray(exceptions) ? exceptions : [];
  const exceptionList = searchTerm.trim()
    ? allExceptions.filter(
        (e) =>
          e.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
          (e.document_title || e.policy_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
          (e.requested_by_name || e.requested_by || '').toLowerCase().includes(searchTerm.toLowerCase())
      )
    : allExceptions;
  const selectedDocumentId = formData.document_id ? Number(formData.document_id) : 0;
  const normalizedTitle = formData.title.trim();

  // Charts data
  const statusChartData = Object.entries(
    allExceptions.reduce((acc: Record<string, number>, e) => {
      acc[e.status] = (acc[e.status] || 0) + 1;
      return acc;
    }, {})
  ).map(([key, value]) => ({
    name: STATUS_STYLES[key]?.label || key,
    value,
    color:
      key === 'approved' ? '#10b981'
      : key === 'pending_approval' ? '#f59e0b'
      : key === 'draft' ? '#94a3b8'
      : key === 'rejected' ? '#ef4444'
      : key === 'expired' ? '#f97316'
      : '#6b7280',
  }));

  const PRIORITY_WEIGHT: Record<string, number> = { low: 1, medium: 2, high: 3, critical: 4 };
  const priorityCount = allExceptions.reduce((acc: Record<string, number>, e) => {
    acc[e.priority] = (acc[e.priority] || 0) + 1;
    return acc;
  }, {});
  const priorityScore = allExceptions.length
    ? Math.round(
        allExceptions.reduce((sum, e) => sum + (PRIORITY_WEIGHT[e.priority] || 1), 0) /
          allExceptions.length / 4 * 100
      )
    : 0;
  const gaugeColor =
    priorityScore >= 75 ? '#ef4444' : priorityScore >= 50 ? '#f59e0b' : priorityScore >= 25 ? '#3b82f6' : '#10b981';
  const gaugeData = [
    { name: 'score', value: priorityScore, fill: gaugeColor },
    { name: 'rest', value: 100 - priorityScore, fill: '#e5e7eb' },
  ];

  return (
    <div className="governance-exceptions space-y-4 sm:space-y-6 p-4 sm:p-5">
      {/* Header row */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-black">Policy Exception Management</h1>
          <p className="text-xs sm:text-sm text-gray-600 mt-0.5">Request, review, and manage policy exceptions</p>
        </div>
      </div>

      {(exceptionsError || documentsError) && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800 text-xs">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          Some governance data could not be loaded from the primary endpoint.
        </div>
      )}

      {/* Charts row */}
      {allExceptions.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {/* Speedometer — Priority Risk Level */}
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">Priority Risk Level</p>
            <div className="flex items-center gap-4">
              <div className="relative h-[110px] w-[170px] flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={gaugeData}
                      cx="50%"
                      cy="88%"
                      startAngle={180}
                      endAngle={0}
                      innerRadius={44}
                      outerRadius={62}
                      dataKey="value"
                      stroke="none"
                    >
                      {gaugeData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-end pb-1 pointer-events-none">
                  <span className="text-lg font-bold" style={{ color: gaugeColor }}>{priorityScore}%</span>
                  <span className="text-[9px] text-gray-500 leading-tight">risk score</span>
                </div>
              </div>
              <div className="space-y-1.5 flex-1">
                {(['critical','high','medium','low'] as const).map((p) => (
                  <div key={p} className="flex items-center gap-2 text-xs">
                    <span className={`inline-flex w-14 justify-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                      p === 'critical' ? 'bg-red-100 text-red-700'
                      : p === 'high' ? 'bg-amber-100 text-amber-700'
                      : p === 'medium' ? 'bg-blue-100 text-blue-700'
                      : 'bg-gray-100 text-gray-600'
                    }`}>{p.charAt(0).toUpperCase() + p.slice(1)}</span>
                    <span className="font-semibold text-black">{priorityCount[p] || 0}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Pie chart — Status distribution */}
          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">Status Distribution</p>
            <div className="flex items-center gap-3">
              <div className="h-[110px] w-[110px] flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusChartData} cx="50%" cy="50%" innerRadius={30} outerRadius={48} dataKey="value" paddingAngle={2}>
                      {statusChartData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid #e5e7eb' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-1.5 flex-1">
                {statusChartData.map((s) => (
                  <div key={s.name} className="flex items-center gap-2 text-xs">
                    <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="flex-1 text-gray-600">{s.name}</span>
                    <span className="font-semibold text-black">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search + Filters + Button row */}
      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
        <div className="flex-1 min-w-[180px]">
          <SearchInput
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search exceptions..."
            size="md"
          />
        </div>
        <MultiSelectDropdown
          title="Status"
          items={STATUS_OPTIONS.filter((o) => o.value).map((o) => ({ value: o.value, label: o.label }))}
          selectedValues={statusFilter ? [statusFilter] : []}
          onApply={(values) => setStatusFilter(values[0] || '')}
          multiSelect={false}
          placeholder="All Statuses"
        />
        <MultiSelectDropdown
          title="Priority"
          items={PRIORITY_OPTIONS.filter((o) => o.value).map((o) => ({ value: o.value, label: o.label }))}
          selectedValues={priorityFilter ? [priorityFilter] : []}
          onApply={(values) => setPriorityFilter(values[0] || '')}
          multiSelect={false}
          placeholder="All Priorities"
        />
        {canCreate && (
        <button
          onClick={() => { resetForm(); setShowCreateModal(true); }}
          className="btn-primary sm:ml-auto flex items-center gap-1.5 px-3 py-2 text-sm"
        >
          <Plus className="h-4 w-4" />
          New Exception
        </button>
        )}
      </div>

      {/* ── Discover & generate exceptions ─────────────────────────────────────
          1) Search any sentence/keyword across policy CONTENT (+ parsed clauses)
          2) AI-driven suggestions of exceptions that could be raised across policies
          Both pre-fill the existing "New Exception" modal — nothing else changes. */}
      <div className="rounded-lg border border-gray-200 bg-white">
        <button
          onClick={toggleDiscover}
          className="flex w-full items-center justify-between px-3 py-2.5 text-left"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-black">
            <Sparkles className="h-4 w-4 text-indigo-600" />
            Find &amp; generate exceptions
            <span className="hidden sm:inline text-[11px] font-normal text-gray-400">
              search policy content · AI suggestions
            </span>
          </span>
          <span className="text-xs text-gray-400">{discoverOpen ? 'Hide' : 'Show'}</span>
        </button>

        {discoverOpen && (
          <div className="grid grid-cols-1 gap-4 border-t border-gray-100 p-3 lg:grid-cols-2">
            {/* Feature 1 — search across policy content */}
            <div>
              <p className="mb-1.5 text-xs font-semibold text-gray-700">Search across policy content</p>
              <div className="flex gap-1.5">
                <input
                  value={policyQuery}
                  onChange={(e) => setPolicyQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') runPolicySearch(); }}
                  placeholder="Search any sentence or keyword across policies…"
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs focus:border-indigo-400 focus:outline-none"
                />
                <button
                  onClick={runPolicySearch}
                  disabled={searchingPolicies || !policyQuery.trim()}
                  className="btn-primary flex items-center gap-1 px-2.5 py-1.5 text-xs disabled:opacity-50"
                >
                  {searchingPolicies ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  Search
                </button>
              </div>
              <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto">
                {searchedOnce && !searchingPolicies && policyResults.length === 0 && (
                  <p className="px-1 py-2 text-xs text-gray-400">No policies matched “{policyQuery}”.</p>
                )}
                {policyResults.map((r, i) => (
                  <div key={`${r.document_id}-${r.statement_id ?? 'doc'}-${i}`} className="rounded border border-gray-100 bg-gray-50 p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-black">{r.document_title || `Policy #${r.document_id}`}</p>
                        <p className="text-[10px] uppercase tracking-wide text-gray-400">
                          {r.doc_type || 'policy'}{r.document_code ? ` · ${r.document_code}` : ''}{r.match_field === 'policy_statement' ? ' · clause' : ''}
                        </p>
                      </div>
                      {canCreate && (
                        <button
                          onClick={() => openCreateForDocument(r.document_id)}
                          className="flex flex-shrink-0 items-center gap-1 rounded border border-indigo-200 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 hover:bg-indigo-50"
                        >
                          <Plus className="h-3 w-3" /> Exception
                        </button>
                      )}
                    </div>
                    {r.snippet && <p className="mt-1 text-[11px] leading-snug text-gray-600">{r.snippet}</p>}
                  </div>
                ))}
              </div>
            </div>

            {/* Feature 2 — AI-suggested candidate exceptions */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-700">AI-suggested exceptions across policies</p>
                <button
                  onClick={loadCandidates}
                  disabled={loadingCandidates}
                  className="flex items-center gap-1 rounded border border-indigo-200 px-2 py-1 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                >
                  {loadingCandidates ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  {candidates.length ? 'Refresh' : 'Suggest'}
                </button>
              </div>
              <div className="max-h-64 space-y-1.5 overflow-y-auto">
                {loadingCandidates && (
                  <div className="flex items-center gap-2 px-1 py-3 text-xs text-gray-500">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Analyzing policies…
                  </div>
                )}
                {!loadingCandidates && candidates.length === 0 && (
                  <p className="px-1 py-2 text-xs text-gray-400">No suggestions yet — click “Suggest” to let AI propose exceptions across your policies.</p>
                )}
                {candidates.map((c, i) => (
                  <div key={`${c.document_id}-${i}`} className="rounded border border-gray-100 bg-gray-50 p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-black">{c.suggested_title}</p>
                        <p className="text-[10px] text-gray-400">{c.document_title || `Policy #${c.document_id}`} · {c.suggested_priority}</p>
                      </div>
                      {canCreate && (
                        <button
                          onClick={() => openCreateForDocument(c.document_id, { title: c.suggested_title, justification: c.rationale, priority: c.suggested_priority })}
                          className="flex flex-shrink-0 items-center gap-1 rounded border border-indigo-200 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 hover:bg-indigo-50"
                        >
                          <Plus className="h-3 w-3" /> Use
                        </button>
                      )}
                    </div>
                    {c.rationale && <p className="mt-1 text-[11px] leading-snug text-gray-600">{c.rationale}</p>}
                  </div>
                ))}
                {candidateSource === 'template' && candidates.length > 0 && (
                  <p className="px-1 text-[10px] italic text-gray-400">Generated from policy metadata (configure an AI key for richer, content-aware suggestions).</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Policy</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Requested By</th>
              <th>Requested Date</th>
              <th>Expiry Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} className="text-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin mx-auto text-primary-400" />
                </td>
              </tr>
            ) : exceptionList.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-8">
                  <Shield className="h-7 w-7 text-gray-400 mx-auto mb-2" />
                  <p className="text-xs text-gray-600">No exceptions found</p>
                  <p className="text-[10px] text-gray-500 mt-0.5">Create a new exception request to get started</p>
                </td>
              </tr>
            ) : (
              exceptionList.map((exc) => {
                const statusStyle = STATUS_STYLES[exc.status] || STATUS_STYLES.draft;
                const priorityStyle = PRIORITY_STYLES[exc.priority] || PRIORITY_STYLES.medium;

                return (
                  <tr key={exc.id} className="hover:bg-gray-50">
                    <td>
                      <span className="font-medium text-black">{exc.title}</span>
                    </td>
                    <td className="text-gray-700">
                      {exc.document_title || exc.policy_name || '-'}
                    </td>
                    <td>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                        {statusStyle.label}
                      </span>
                    </td>
                    <td>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${priorityStyle.bg} ${priorityStyle.text}`}>
                        {priorityStyle.label}
                      </span>
                    </td>
                    <td className="text-gray-700">{exc.requester_name || exc.requested_by_name || '-'}</td>
                    <td className="text-gray-700">{formatDate(exc.created_at)}</td>
                    <td className="text-gray-700">{formatDate(exc.expiry_date)}</td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setViewingException(exc)}
                          className="btn-ghost btn-sm"
                          title="View Details"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        {exc.status === 'draft' && (
                          <>
                            <button
                              onClick={() => openEditModal(exc)}
                              className="btn-ghost btn-sm"
                              title="Edit"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => submitMutation.mutate(exc.id)}
                              disabled={submitMutation.isPending}
                              className="btn-ghost btn-sm"
                              title="Submit for Approval"
                            >
                              <Send className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {exc.status === 'pending_approval' && (
                          <>
                            <button
                              onClick={() => setApproveModal(exc)}
                              className="btn-ghost btn-sm text-green-700 hover:text-green-800 hover:bg-green-50"
                              title="Approve"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setRejectModal(exc)}
                              className="btn-ghost btn-sm text-red-700 hover:text-red-800 hover:bg-red-50"
                              title="Reject"
                            >
                              <XCircle className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {exc.status === 'approved' && (
                          <button
                            onClick={() => setRevokeModal(exc)}
                            className="btn-ghost btn-sm"
                            title="Revoke"
                          >
                            <Ban className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={() => {
                            if (confirm('Are you sure you want to delete this exception?')) {
                              deleteMutation.mutate(exc.id);
                            }
                          }}
                          disabled={deleteMutation.isPending}
                          className="btn-ghost btn-sm text-red-600 hover:text-red-700 hover:bg-red-50"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

   <RightSlidePanel
  isOpen={showCreateModal || !!editingException}
  onClose={() => { setShowCreateModal(false); setEditingException(null); resetForm(); }}
  title={editingException ? 'Edit Exception Request' : 'New Exception Request'}
  widthClassName="w-[780px]"
>
  <div className="space-y-3.5">
    <div className='flex items-center w-full gap-2'>
      <div className='w-2/4'>

      <label className="label">Title *</label>
      <input
        type="text"
        value={formData.title}
        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
        className="block rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 transition-colors focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 w-full"
        placeholder="Exception request title"
        />
        </div>
        <div className='w-2/4'>

      <label className="label">Policy</label>
      <MultiSelectDropdown
        title="Policy"
        items={(documents || []).map((doc: GovernancePolicyOption) => ({
          value: String(doc.id),
          label: doc.title,
          subLabel: doc.document_code || doc.doc_type,
        }))}
        selectedValues={formData.document_id ? [String(formData.document_id)] : []}
        onApply={(values) => setFormData({ ...formData, document_id: values[0] || '' })}
        multiSelect={false}
        triggerVariant="input"
        triggerClassName="w-full"
        placeholder="Select a policy..."
        forceSearch
      />
        </div>
    </div>

    {/* <div> */}
    {/* </div> */}

    {showCreateModal && !editingException && (
      <div>
        <button
          type="button"
          onClick={() => suggestContentMutation.mutate({ title: normalizedTitle, document_id: selectedDocumentId })}
          disabled={!selectedDocumentId || !normalizedTitle || suggestContentMutation.isPending}
          className="btn-secondary inline-flex items-center gap-2"
        >
          {suggestContentMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          AI Assist
        </button>
        <p className="mt-1 text-xs text-gray-600">
          Select a policy and enter title, then use AI Assist to fill suggested details.
        </p>
      </div>
    )}

    {showCreateModal && !editingException && suggestContentMutation.isPending && (
      <div className="rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-3 flex items-center gap-3">
        <div className="relative flex-shrink-0">
          <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-blue-600 animate-pulse" />
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-blue-900">AI is working...</p>
          <p className="text-xs text-blue-700 mt-0.5">Generating suggested justification and risk details...</p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '0ms' }}></span>
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '150ms' }}></span>
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-bounce" style={{ animationDelay: '300ms' }}></span>
        </div>
      </div>
    )}

    <div>
      <label className="label">Justification *</label>
      <textarea
        value={formData.justification}
        onChange={(e) => setFormData({ ...formData, justification: e.target.value })}
        className="input"
        placeholder="Explain why this exception is needed"
      />
    </div>

    <div>
      <label className="label">Risk Assessment</label>
      <textarea
        value={formData.risk_assessment}
        onChange={(e) => setFormData({ ...formData, risk_assessment: e.target.value })}
        className="input"
        placeholder="Describe the risk associated with this exception"
      />
    </div>

    <div>
      <label className="label">Compensating Controls</label>
      <textarea
        value={formData.compensating_controls}
        onChange={(e) => setFormData({ ...formData, compensating_controls: e.target.value })}
        className="input"
        placeholder="Describe compensating controls in place"
      />
    </div>

    <div>
      <label className="label">Priority</label>
      <MultiSelectDropdown
        title="Priority"
        items={[
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
          { value: 'critical', label: 'Critical' },
        ]}
        selectedValues={formData.priority ? [formData.priority] : []}
        onApply={(values) => setFormData({ ...formData, priority: values[0] || 'medium' })}
        multiSelect={false}
        triggerVariant="input"
        triggerClassName="w-full"
      />
    </div>

    <div className="grid grid-cols-2 gap-3">
      <div>
        <label className="label">Effective Date</label>
        <input
          type="date"
          value={formData.effective_date}
          onChange={(e) => setFormData({ ...formData, effective_date: e.target.value })}
          className="input"
        />
      </div>
      <div>
        <label className="label">Expiry Date</label>
        <input
          type="date"
          value={formData.expiry_date}
          onChange={(e) => setFormData({ ...formData, expiry_date: e.target.value })}
          className="input"
        />
      </div>
    </div>

    <div className="flex items-center justify-end gap-2.5 border-t border-gray-200 pt-4">
      <button
        onClick={() => { setShowCreateModal(false); setEditingException(null); resetForm(); }}
        className="btn-secondary"
      >
        Cancel
      </button>
      <button
        onClick={handleSubmitForm}
        disabled={!formData.title || !formData.justification || createMutation.isPending || updateMutation.isPending}
        className="btn-primary flex items-center gap-2"
      >
        {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}
        {editingException ? 'Update Exception' : 'Create Exception'}
      </button>
    </div>
  </div>
</RightSlidePanel>

<RightSlidePanel
  isOpen={!!viewingException}
  onClose={() => setViewingException(null)}
  title={
    viewingException ? (
      <div>
        <span>{viewingException.title}</span>
        <div className="flex items-center gap-2 mt-1">
          {(() => {
            const ss = STATUS_STYLES[viewingException.status] || STATUS_STYLES.draft;
            return (
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${ss.bg} ${ss.text}`}>
                {ss.label}
              </span>
            );
          })()}
          {(() => {
            const ps = PRIORITY_STYLES[viewingException.priority] || PRIORITY_STYLES.medium;
            return (
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${ps.bg} ${ps.text}`}>
                {ps.label} Priority
              </span>
            );
          })()}
        </div>
      </div>
    ) : ''
  }
  widthClassName="w-[780px]"
>
  {viewingException && (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-600 uppercase tracking-wide">Policy</label>
          <p className="text-black mt-1">{viewingException.document_title || viewingException.policy_name || '-'}</p>
        </div>
        <div>
          <label className="text-xs text-gray-600 uppercase tracking-wide">Requested By</label>
          <p className="text-black mt-1">{viewingException.requested_by_name || viewingException.requested_by || '-'}</p>
        </div>
        <div>
          <label className="text-xs text-gray-600 uppercase tracking-wide">Effective Date</label>
          <p className="text-black mt-1">{formatDate(viewingException.effective_date)}</p>
        </div>
        <div>
          <label className="text-xs text-gray-600 uppercase tracking-wide">Expiry Date</label>
          <p className="text-black mt-1">{formatDate(viewingException.expiry_date)}</p>
        </div>
        <div>
          <label className="text-xs text-gray-600 uppercase tracking-wide">Created</label>
          <p className="text-black mt-1">{formatDate(viewingException.created_at)}</p>
        </div>
        {viewingException.approved_by_name && (
          <div>
            <label className="text-xs text-gray-600 uppercase tracking-wide">Approved By</label>
            <p className="text-black mt-1">{viewingException.approved_by_name}</p>
          </div>
        )}
      </div>

      <div>
        <label className="text-xs text-gray-600 uppercase tracking-wide">Justification</label>
        <p className="text-gray-800 mt-1 whitespace-pre-wrap">{viewingException.justification || '-'}</p>
      </div>

      <div>
        <label className="text-xs text-gray-600 uppercase tracking-wide">Risk Assessment</label>
        <p className="text-gray-800 mt-1 whitespace-pre-wrap">{viewingException.risk_assessment || '-'}</p>
      </div>

      <div>
        <label className="text-xs text-gray-600 uppercase tracking-wide">Compensating Controls</label>
        <p className="text-gray-800 mt-1 whitespace-pre-wrap">{viewingException.compensating_controls || '-'}</p>
      </div>

      {viewingException.rejection_reason && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3.5">
          <label className="text-xs text-red-700 uppercase tracking-wide font-medium">Rejection Reason</label>
          <p className="text-red-800 mt-1">{viewingException.rejection_reason}</p>
        </div>
      )}

      {viewingException.approval_comments && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3.5">
          <label className="text-xs text-green-700 uppercase tracking-wide font-medium">Approval Comments</label>
          <p className="text-green-800 mt-1">{viewingException.approval_comments}</p>
        </div>
      )}

      <div className="border-t border-gray-200 pt-3.5">
        <h3 className="text-sm font-semibold text-black flex items-center gap-2 mb-3">
          <MessageSquare className="h-4 w-4 text-gray-600" />
          Comments
        </h3>
        {commentsLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-primary-400" />
          </div>
        ) : (
          <div className="space-y-2.5 mb-3.5">
            {(!comments || comments.length === 0) && (
              <p className="text-sm text-gray-600 text-center py-2">No comments yet</p>
            )}
            {(comments || []).map((comment) => (
              <div key={comment.id} className="bg-gray-100 rounded-lg p-2.5">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-black">{comment.user_name}</span>
                  <span className="text-xs text-gray-600">{formatDate(comment.created_at)}</span>
                </div>
                <p className="text-sm text-gray-800">{comment.comment}</p>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            className="input flex-1"
            placeholder="Add a comment..."
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newComment.trim()) {
                addCommentMutation.mutate({ id: viewingException.id, data: { comment: newComment.trim() } });
              }
            }}
          />
          <button
            onClick={() => {
              if (newComment.trim()) {
                addCommentMutation.mutate({ id: viewingException.id, data: { comment: newComment.trim() } });
              }
            }}
            disabled={!newComment.trim() || addCommentMutation.isPending}
            className="btn-primary"
          >
            {addCommentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  )}
</RightSlidePanel>

      {approveModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-300 bg-white shadow-xl">
            <div className="px-5 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-black flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-emerald-400" />
                Approve Exception
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                Approve &quot;{approveModal.title}&quot;
              </p>
            </div>
            <div className="px-5 py-4">
              <label className="label">Comments (optional)</label>
              <textarea
                value={approveComments}
                onChange={(e) => setApproveComments(e.target.value)}
                className="input min-h-[80px]"
                placeholder="Add approval comments..."
              />
            </div>
            <div className="flex items-center justify-end gap-2.5 px-5 py-4 border-t border-gray-200">
              <button onClick={() => { setApproveModal(null); setApproveComments(''); }} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => approveMutation.mutate({ id: approveModal.id, data: approveComments ? { comments: approveComments } : undefined })}
                disabled={approveMutation.isPending}
                className="btn-primary flex items-center gap-2"
              >
                {approveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Approve
              </button>
            </div>
          </div>
        </div>
      )}

      {rejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-300 bg-white shadow-xl">
            <div className="px-5 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-black flex items-center gap-2">
                <XCircle className="h-5 w-5 text-rose-400" />
                Reject Exception
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                Reject &quot;{rejectModal.title}&quot;
              </p>
            </div>
            <div className="px-5 py-4">
              <label className="label">Rejection Reason *</label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="input min-h-[100px]"
                placeholder="Explain why this exception is being rejected..."
              />
            </div>
            <div className="flex items-center justify-end gap-2.5 px-5 py-4 border-t border-gray-200">
              <button onClick={() => { setRejectModal(null); setRejectReason(''); }} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => rejectMutation.mutate({ id: rejectModal.id, data: { rejection_reason: rejectReason } })}
                disabled={!rejectReason.trim() || rejectMutation.isPending}
                className="btn-primary flex items-center gap-2 bg-rose-600 hover:bg-rose-700"
              >
                {rejectMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {revokeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-300 bg-white shadow-xl">
            <div className="px-5 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-black flex items-center gap-2">
                <Ban className="h-5 w-5 text-gray-400" />
                Revoke Exception
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                Revoke &quot;{revokeModal.title}&quot;
              </p>
            </div>
            <div className="px-5 py-4">
              <label className="label">Reason (optional)</label>
              <textarea
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                className="input min-h-[80px]"
                placeholder="Reason for revoking this exception..."
              />
            </div>
            <div className="flex items-center justify-end gap-2.5 px-5 py-4 border-t border-gray-200">
              <button onClick={() => { setRevokeModal(null); setRevokeReason(''); }} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => revokeMutation.mutate({ id: revokeModal.id, data: revokeReason ? { reason: revokeReason } : undefined })}
                disabled={revokeMutation.isPending}
                className="btn-primary flex items-center gap-2 bg-gray-600 hover:bg-gray-700"
              >
                {revokeMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Revoke
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
