'use client';

import { useState, useEffect, useRef, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';

import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { policyExceptionApi, governanceApi, documentsApi, assetsApi } from '@/lib/api';
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
  ArrowRightLeft,
  ExternalLink,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  LineChart,
  Line,
} from 'recharts';
import { AnimatedModal, RightSlidePanel, SearchInput, MultiSelectDropdown, DataTable, type ColumnDef } from '@/components/ui';
import { RowActionsMenu, type RowAction } from '../documents/_workspace/RowActionsMenu';

/**
 * Textarea that grows to fit its content so long (often AI-generated) field
 * values are fully visible the moment the panel opens — no manual dragging or
 * inner scrolling (item 14: "fields should be already expanded based on content").
 */
function AutoGrowTextarea({
  value,
  onChange,
  className,
  placeholder,
  minRows = 3,
}: {
  value: string;
  onChange: (e: ChangeEvent<HTMLTextAreaElement>) => void;
  className?: string;
  placeholder?: string;
  minRows?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      className={className}
      placeholder={placeholder}
      rows={minRows}
      style={{ overflow: 'hidden', resize: 'vertical' }}
    />
  );
}

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

// Charter: single-hue light status/priority pills (bg-{tone}-50 text-{tone}-700).
const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Draft' },
  pending_approval: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Pending Approval' },
  approved: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Approved' },
  rejected: { bg: 'bg-rose-50', text: 'text-rose-700', label: 'Rejected' },
  expired: { bg: 'bg-orange-50', text: 'text-orange-700', label: 'Expired' },
  revoked: { bg: 'bg-slate-100', text: 'text-slate-500', label: 'Revoked' },
};

const PRIORITY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  low: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Low' },
  medium: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Medium' },
  high: { bg: 'bg-orange-50', text: 'text-orange-700', label: 'High' },
  critical: { bg: 'bg-rose-50', text: 'text-rose-700', label: 'Critical' },
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
  linked_asset_ids?: number[];
  linked_assets?: Array<{ id: number; name: string; asset_type?: string; criticality?: string; confidentiality?: number | null; integrity?: number | null; availability?: number | null }>;
  posture?: { score: number; band: string; overdue: boolean; linked_assets: number };
  closed_on_time?: boolean | null;
  promoted_risk_id?: number | null;
}

interface ExceptionAnalytics {
  avg_posture: number | null;
  posture_band: string | null;
  open: number;
  overdue: number;
  resolved: number;
  closed_on_time_pct: number | null;
  aging_buckets: Record<string, number>;
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  total: number;
}

interface AssetOption { id: number; name: string; asset_type?: string; criticality?: string }

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

// ── Register cell primitives (charter — shared look with the Documents register) ──
function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLES[status] || STATUS_STYLES.draft;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

function PriorityPill({ priority }: { priority: string }) {
  const p = PRIORITY_STYLES[priority] || PRIORITY_STYLES.medium;
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${p.bg} ${p.text}`}>
      {p.label}
    </span>
  );
}

function RequesterCell({ name }: { name?: string }) {
  const label = (name && name.trim()) || 'Unassigned';
  const initials =
    label === 'Unassigned'
      ? '—'
      : label.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <span className="inline-flex items-center gap-2 text-sm text-slate-700">
      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-500">
        {initials}
      </span>
      <span className="truncate">{label}</span>
    </span>
  );
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
    asset_ids: [] as number[],
  });

  // ── Find & generate (modal: searchable policy picker + opt-in AI suggestions) ──
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [candidates, setCandidates] = useState<ExceptionCandidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [candidateSource, setCandidateSource] = useState('');
  const [candidatesFetched, setCandidatesFetched] = useState(false);
  // Empty until the user picks a policy (or "all"). AI never runs until they
  // click Suggest — opening the modal / changing the select does not auto-fetch.
  const [candidatePolicyId, setCandidatePolicyId] = useState<number | 'all' | ''>('');

  const queryClient = useQueryClient();
  const router = useRouter();

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
        const response = await governanceApi.getDocuments({ limit: 500 });
        // Exceptions can ONLY be raised against policies — show policy documents
        // only, never procedures / standards / guidelines / other doc types.
        return extractItemsArray(response.data).filter(
          (doc: any) => String(doc?.doc_type || '').toLowerCase() === 'policy'
        ) as GovernancePolicyOption[];
      } catch {
        const fallback = await documentsApi.getAll();
        return extractItemsArray(fallback.data) as GovernancePolicyOption[];
      }
    },
  });

  const { data: assetOptions } = useQuery({
    queryKey: ['assets-for-exception-link'],
    queryFn: async () => {
      try {
        const res = await assetsApi.getAll({ limit: 500 });
        return extractItemsArray(res.data) as AssetOption[];
      } catch { return [] as AssetOption[]; }
    },
  });

  const { data: analytics } = useQuery({
    queryKey: ['policy-exceptions-analytics'],
    queryFn: async () => (await policyExceptionApi.getAnalytics()).data as ExceptionAnalytics,
  });

  const { data: postureTrend } = useQuery({
    queryKey: ['policy-exceptions-trend'],
    queryFn: async () => {
      const res = await policyExceptionApi.getTrend('exception_risk_posture', 180);
      return (res.data?.series || []) as Array<{ date: string; value: number | null }>;
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

  const promoteToRiskMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await policyExceptionApi.promoteToRisk(id);
      return res.data as { risk_id: number; created: boolean; message?: string };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['policy-exceptions'] });
      setViewingException(null);
      if (result?.risk_id) router.push(`/erm/risks/${result.risk_id}`);
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
      asset_ids: [],
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
      asset_ids: exception.linked_asset_ids || [],
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
    payload.asset_ids = formData.asset_ids;

    if (editingException) {
      updateMutation.mutate({ id: editingException.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  // Open the (existing) create modal pre-filled — used by selected policy
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
      asset_ids: [],
    });
    setEditingException(null);
    setDiscoverOpen(false);
    setShowCreateModal(true);
  };

  // Opt-in AI only — requires an explicit Suggest click and a selected target.
  const loadCandidates = async () => {
    if (candidatePolicyId === '') return;
    setLoadingCandidates(true);
    try {
      const params: { document_id?: number; limit: number } = { limit: 8 };
      if (candidatePolicyId !== 'all') params.document_id = candidatePolicyId;
      const res = await policyExceptionApi.suggestCandidates(params);
      setCandidates((res.data?.candidates || []) as ExceptionCandidate[]);
      setCandidateSource(res.data?.source || '');
    } catch {
      setCandidates([]);
      setCandidateSource('');
    } finally {
      setCandidatesFetched(true);
      setLoadingCandidates(false);
    }
  };

  const onSelectCandidatePolicy = (values: string[]) => {
    const value = values[0] || '';
    const target: number | 'all' | '' =
      value === '' ? '' : value === 'all' ? 'all' : Number(value);
    setCandidatePolicyId(target);
    setCandidates([]);
    setCandidateSource('');
    setCandidatesFetched(false);
  };

  const selectedDiscoverPolicy =
    typeof candidatePolicyId === 'number'
      ? (documents || []).find((d) => d.id === candidatePolicyId) || null
      : null;

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

  // Asset-weighted risk posture + aging + trend (items 17 & 18) from the analytics endpoint.
  const postureScore = analytics?.avg_posture != null ? Math.round(analytics.avg_posture) : priorityScore;
  const postureColor =
    postureScore >= 75 ? '#ef4444' : postureScore >= 50 ? '#f59e0b' : postureScore >= 25 ? '#3b82f6' : '#10b981';
  const postureGaugeData = [
    { name: 'score', value: postureScore, fill: postureColor },
    { name: 'rest', value: 100 - postureScore, fill: '#e5e7eb' },
  ];
  const AGING_LABEL: Record<string, string> = { '0_30': '0–30d', '31_60': '31–60d', '61_90': '61–90d', '90_plus': '90d+', overdue: 'Overdue' };
  const AGING_COLOR: Record<string, string> = { '0_30': '#1ed4b0', '31_60': '#3ddfc2', '61_90': '#f59e0b', '90_plus': '#fb923c', overdue: '#f43f5e' };
  const agingData = ['0_30', '31_60', '61_90', '90_plus', 'overdue'].map((k) => ({
    name: AGING_LABEL[k], value: (analytics?.aging_buckets?.[k] as number) || 0, fill: AGING_COLOR[k],
  }));
  const trendData = (postureTrend || []).map((p) => ({ date: p.date.slice(5), value: p.value ?? 0 }));

  // Per-row actions (⋯ menu) — same lifecycle logic as before, now surfaced
  // through the shared RowActionsMenu used by the Documents register.
  const rowActions = (exc: ExceptionItem): RowAction[] => [
    { key: 'view', label: 'View details', icon: Eye, onClick: () => setViewingException(exc) },
    { key: 'edit', label: 'Edit', icon: Edit2, onClick: () => openEditModal(exc), hidden: exc.status !== 'draft' },
    { key: 'submit', label: 'Submit for approval', icon: Send, onClick: () => submitMutation.mutate(exc.id), hidden: exc.status !== 'draft' },
    { key: 'approve', label: 'Approve', icon: Check, onClick: () => setApproveModal(exc), hidden: exc.status !== 'pending_approval' },
    { key: 'reject', label: 'Reject', icon: XCircle, onClick: () => setRejectModal(exc), variant: 'danger', hidden: exc.status !== 'pending_approval' },
    { key: 'revoke', label: 'Revoke', icon: Ban, onClick: () => setRevokeModal(exc), hidden: exc.status !== 'approved' },
    {
      key: 'delete',
      label: 'Delete',
      icon: Trash2,
      variant: 'danger',
      onClick: () => {
        if (confirm('Are you sure you want to delete this exception?')) deleteMutation.mutate(exc.id);
      },
    },
  ];

  const columns: ColumnDef<ExceptionItem>[] = [
    { id: 'title', header: 'Title', accessor: 'title', sortable: true, minWidth: '240px', render: (e) => <span className="font-medium text-slate-900">{e.title}</span> },
    { id: 'policy', header: 'Policy', minWidth: '160px', render: (e) => <span className="text-slate-600">{e.document_title || e.policy_name || '—'}</span> },
    { id: 'status', header: 'Status', accessor: 'status', sortable: true, minWidth: '140px', render: (e) => <StatusPill status={e.status} /> },
    { id: 'priority', header: 'Priority', accessor: 'priority', sortable: true, minWidth: '110px', render: (e) => <PriorityPill priority={e.priority} /> },
    { id: 'requester', header: 'Requested by', minWidth: '160px', render: (e) => <RequesterCell name={e.requester_name || e.requested_by_name} /> },
    { id: 'created', header: 'Requested', accessor: 'created_at', sortable: true, minWidth: '120px', render: (e) => <span className="text-slate-600">{formatDate(e.created_at)}</span> },
    { id: 'expiry', header: 'Expiry', accessor: 'expiry_date', sortable: true, minWidth: '120px', render: (e) => <span className="text-slate-600">{formatDate(e.expiry_date)}</span> },
    {
      id: 'actions',
      header: '',
      minWidth: '56px',
      render: (e) => (
        <div onClick={(ev) => ev.stopPropagation()}>
          <RowActionsMenu actions={rowActions(e)} />
        </div>
      ),
    },
  ];

  return (
    <div className="governance-exceptions space-y-4 sm:space-y-5 p-4 sm:p-5">
      {/* Header + primary actions (single row — no stacked chrome strips) */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900">Policy Exception Management</h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">Request, review, and manage policy exceptions</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
          <button
            type="button"
            onClick={() => setDiscoverOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
          >
            <Sparkles className="h-4 w-4 text-primary-600" />
            Find &amp; generate
          </button>
          {canCreate && (
            <button
              type="button"
              onClick={() => { resetForm(); setShowCreateModal(true); }}
              className="btn-primary flex items-center gap-1.5 px-3 py-2 text-sm"
            >
              <Plus className="h-4 w-4" />
              New Exception
            </button>
          )}
        </div>
      </div>

      {(exceptionsError || documentsError) && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-800 text-xs">
          <AlertCircle className="h-4 w-4 flex-shrink-0" />
          Some governance data could not be loaded from the primary endpoint.
        </div>
      )}

      {/* Summary row — status mix · aging · closure timeliness (single row of 3) */}
      {allExceptions.length > 0 && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {/* Status distribution */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Status Distribution</p>
            <div className="flex items-center gap-3">
              <div className="h-[110px] w-[110px] flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusChartData} cx="50%" cy="50%" innerRadius={30} outerRadius={48} dataKey="value" paddingAngle={2}>
                      {statusChartData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid #e2e8f0' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-1.5">
                {statusChartData.map((s) => (
                  <div key={s.name} className="flex items-center gap-2 text-xs">
                    <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="flex-1 text-slate-500">{s.name}</span>
                    <span className="font-semibold text-slate-900">{s.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Open exception aging */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Open Exception Aging</p>
            <div className="h-[130px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={agingData} margin={{ top: 4, right: 6, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid #e2e8f0' }} />
                  <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                    {agingData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Closure timeliness */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Closure Timeliness</p>
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-center">
                <span className="text-2xl font-bold" style={{ color: (analytics?.closed_on_time_pct ?? 100) >= 80 ? '#059669' : (analytics?.closed_on_time_pct ?? 0) >= 50 ? '#d97706' : '#e11d48' }}>
                  {analytics?.closed_on_time_pct != null ? `${analytics.closed_on_time_pct}%` : '—'}
                </span>
                <span className="text-[10px] text-slate-500">closed on time</span>
              </div>
              <div className="flex-1 space-y-1.5 text-xs">
                <div className="flex items-center justify-between"><span className="text-slate-500">Open</span><span className="font-semibold text-slate-900">{analytics?.open ?? 0}</span></div>
                <div className="flex items-center justify-between"><span className="text-slate-500">Overdue</span><span className={`font-semibold ${analytics?.overdue ? 'text-rose-600' : 'text-slate-900'}`}>{analytics?.overdue ?? 0}</span></div>
                <div className="flex items-center justify-between"><span className="text-slate-500">Resolved</span><span className="font-semibold text-slate-900">{analytics?.resolved ?? 0}</span></div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Search + Filters */}
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
      </div>

      {/* Exception Register — same DataTable register UI as Governance Documents */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Exception Register</h2>
            <p className="text-sm text-slate-500">{exceptionList.length} shown · {allExceptions.length} total</p>
          </div>
        </div>
        <DataTable<ExceptionItem>
          data={exceptionList}
          columns={columns}
          loading={isLoading}
          searchable={false}
          exportable
          exportFilename="policy-exceptions"
          pageSize={15}
          stickyHeader
          onRowClick={(exc) => setViewingException(exc)}
          emptyMessage="No exceptions found. Create a new exception request to get started."
          emptyIcon={Shield}
        />
      </section>

      {/* Find & generate — searchable policy picker + opt-in AI */}
      <AnimatedModal
        isOpen={discoverOpen}
        onClose={() => setDiscoverOpen(false)}
        size="lg"
        title="Find & generate exceptions"
        subtitle="Filter and pick a policy, then raise an exception or generate AI suggestions"
      >
        <div className="space-y-5 px-5 py-5">
          <ol className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
            {[
              { n: '1', t: 'Select a policy', d: 'Search and pick from the policy list (or scan all).' },
              { n: '2', t: 'Suggest with AI', d: 'Run suggestions when you are ready — nothing auto-runs.' },
            ].map((s) => (
              <li key={s.n} className="flex gap-2.5">
                <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-600 text-[11px] font-semibold text-white">
                  {s.n}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-slate-800">{s.t}</p>
                  <p className="text-[11px] leading-snug text-slate-500">{s.d}</p>
                </div>
              </li>
            ))}
          </ol>

          <section className="min-w-0 space-y-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Policy</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Type in the dropdown to filter policies. Select one to raise an exception or run AI suggestions.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <MultiSelectDropdown
                title="Policy"
                items={[
                  { value: 'all', label: 'All policies', subLabel: 'Scan across every policy' },
                  ...(documents || []).map((d: GovernancePolicyOption) => ({
                    value: String(d.id),
                    label: d.title,
                    subLabel: d.document_code || d.doc_type,
                  })),
                ]}
                selectedValues={candidatePolicyId === '' ? [] : [String(candidatePolicyId)]}
                onApply={onSelectCandidatePolicy}
                multiSelect={false}
                triggerVariant="input"
                triggerClassName="w-full"
                placeholder="Select a policy…"
                searchPlaceholder="Search policies…"
                forceSearch
                className="min-w-0 flex-1"
              />
              <button
                type="button"
                onClick={loadCandidates}
                disabled={loadingCandidates || candidatePolicyId === ''}
                className="btn-primary flex shrink-0 items-center justify-center gap-1.5 px-3 py-2 text-sm disabled:opacity-50"
              >
                {loadingCandidates ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {candidates.length ? 'Refresh' : 'Suggest'}
              </button>
            </div>

            {selectedDiscoverPolicy && canCreate && (
              <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{selectedDiscoverPolicy.title}</p>
                    <p className="text-[10px] uppercase tracking-wide text-slate-400">
                      {selectedDiscoverPolicy.doc_type || 'policy'}
                      {selectedDiscoverPolicy.document_code ? ` · ${selectedDiscoverPolicy.document_code}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openCreateForDocument(selectedDiscoverPolicy.id)}
                    className="flex flex-shrink-0 items-center gap-1 rounded-md border border-primary-200 px-2 py-1 text-[11px] font-medium text-primary-700 hover:bg-primary-50"
                  >
                    <Plus className="h-3 w-3" /> Exception
                  </button>
                </div>
              </div>
            )}

            <div className="max-h-72 space-y-2 overflow-y-auto pr-0.5">
              {loadingCandidates && (
                <div className="flex items-center gap-2 px-1 py-3 text-xs text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {candidatePolicyId === 'all' ? 'Analyzing your policies…' : 'Analyzing this policy…'}
                </div>
              )}
              {!loadingCandidates && candidatePolicyId === '' && candidates.length === 0 && (
                <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-400">
                  Choose a policy above, then click Suggest to generate candidates.
                </p>
              )}
              {!loadingCandidates && candidatePolicyId !== '' && !candidatesFetched && candidates.length === 0 && (
                <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-xs text-slate-400">
                  Ready — click Suggest to generate candidates for the selected policy.
                </p>
              )}
              {!loadingCandidates && candidatesFetched && candidates.length === 0 && (
                <p className="px-1 py-2 text-xs text-slate-400">
                  No AI-suggested exceptions found for this selection — click Suggest to retry.
                </p>
              )}
              {candidates.map((c, i) => (
                <div key={`${c.document_id}-${i}`} className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900">{c.suggested_title}</p>
                      <p className="text-[11px] text-slate-400">{c.document_title || `Policy #${c.document_id}`} · {c.suggested_priority}</p>
                    </div>
                    {canCreate && (
                      <button
                        type="button"
                        onClick={() => openCreateForDocument(c.document_id, { title: c.suggested_title, justification: c.rationale, priority: c.suggested_priority })}
                        className="flex flex-shrink-0 items-center gap-1 rounded-md border border-primary-200 px-2 py-1 text-[11px] font-medium text-primary-700 hover:bg-primary-50"
                      >
                        <Plus className="h-3 w-3" /> Use
                      </button>
                    )}
                  </div>
                  {c.rationale && <p className="mt-1.5 text-xs leading-snug text-slate-600">{c.rationale}</p>}
                </div>
              ))}
              {candidateSource === 'template' && candidates.length > 0 && (
                <p className="px-1 text-[10px] italic text-slate-400">Generated from policy metadata (configure an AI key for richer, content-aware suggestions).</p>
              )}
            </div>
          </section>
        </div>
      </AnimatedModal>

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
      <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 flex items-center gap-3">
        <div className="relative flex-shrink-0">
          <div className="h-8 w-8 rounded-full bg-primary-100 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-primary-700 animate-pulse" />
          </div>
          <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-3 w-3 bg-primary-500"></span>
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-900">AI is working...</p>
          <p className="text-xs text-slate-600 mt-0.5">Generating suggested justification and potential risks...</p>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className="w-2 h-2 rounded-full bg-primary-400 animate-bounce" style={{ animationDelay: '0ms' }}></span>
          <span className="w-2 h-2 rounded-full bg-primary-400 animate-bounce" style={{ animationDelay: '150ms' }}></span>
          <span className="w-2 h-2 rounded-full bg-primary-400 animate-bounce" style={{ animationDelay: '300ms' }}></span>
        </div>
      </div>
    )}

    <div>
      <label className="label">Justification *</label>
      <AutoGrowTextarea
        value={formData.justification}
        onChange={(e) => setFormData({ ...formData, justification: e.target.value })}
        className="input"
        placeholder="Explain why this exception is needed"
      />
    </div>

    <div>
      <label className="label">Potential Risks</label>
      <AutoGrowTextarea
        value={formData.risk_assessment}
        onChange={(e) => setFormData({ ...formData, risk_assessment: e.target.value })}
        className="input"
        placeholder="Describe the potential risks this exception introduces"
      />
    </div>

    <div>
      <label className="label">Compensating Controls</label>
      <AutoGrowTextarea
        value={formData.compensating_controls}
        onChange={(e) => setFormData({ ...formData, compensating_controls: e.target.value })}
        className="input"
        placeholder="Describe compensating controls in place"
      />
    </div>

    <div>
      <label className="label">Link Assets <span className="text-xs font-normal text-gray-400">— their CIA &amp; criticality weight this exception&apos;s risk posture</span></label>
      <MultiSelectDropdown
        title="Assets"
        items={(assetOptions || []).map((a) => ({
          value: String(a.id),
          label: a.name,
          subLabel: [a.criticality, a.asset_type].filter(Boolean).join(' · ') || undefined,
        }))}
        selectedValues={formData.asset_ids.map(String)}
        onApply={(values) => setFormData({ ...formData, asset_ids: values.map(Number) })}
        multiSelect
        triggerVariant="input"
        triggerClassName="w-full"
        placeholder="Link assets affected by this exception..."
        forceSearch
      />
      {formData.asset_ids.length > 0 && (
        <p className="mt-1 text-[11px] text-gray-500">{formData.asset_ids.length} asset(s) linked — the most critical drives the posture score.</p>
      )}
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
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs text-gray-600 uppercase tracking-wide">Potential Risks</label>
          {viewingException.promoted_risk_id ? (
            <button
              type="button"
              onClick={() => { const id = viewingException.promoted_risk_id; setViewingException(null); if (id) router.push(`/erm/risks/${id}`); }}
              className="inline-flex items-center gap-1 text-xs font-medium text-green-700 hover:text-green-800"
            >
              <ExternalLink className="h-3.5 w-3.5" /> In risk register — assess
            </button>
          ) : (
            <button
              type="button"
              onClick={() => promoteToRiskMutation.mutate(viewingException.id)}
              disabled={promoteToRiskMutation.isPending}
              className="inline-flex items-center gap-1 rounded-md border border-primary-300 px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50 disabled:opacity-50"
            >
              {promoteToRiskMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRightLeft className="h-3.5 w-3.5" />}
              Move to Risk Register
            </button>
          )}
        </div>
        <p className="text-gray-800 mt-1 whitespace-pre-wrap">{viewingException.risk_assessment || '-'}</p>
        {!viewingException.promoted_risk_id && (
          <p className="mt-1 text-[11px] text-gray-500">
            Creates an ERM risk-register entry from these potential risks (carrying the linked assets across) so you can complete the likelihood/impact assessment there.
          </p>
        )}
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
