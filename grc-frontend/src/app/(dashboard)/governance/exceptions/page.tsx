'use client';

import { useState, useEffect, useId, useRef, type ChangeEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';

import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { policyExceptionApi, governanceApi, documentsApi, assetsApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { parseUtc } from '@/lib/serverTime';
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
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Download,
  Search,
  SearchX,
  X,
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
import { AnimatedModal, RightSlidePanel, MultiSelectDropdown, InfoTip } from '@/components/ui';
import { DocPageHeader } from '@/components/governance/DocPageHeader';
import { BTN, BTN_ICON, BTN_PRIMARY } from '@/components/governance/docUi';
import { RowActionsMenu, type RowAction } from '../documents/_workspace/RowActionsMenu';
import { relativeTime } from '../documents/_workspace/libraryFormat';
// what the page decides (the order, the pages, the CSV, the search, the counts, the dates) is in _logic.ts, with its tests
import {
  DATA_COLS, DEFAULT_PAGE_SIZE, PAGE_SIZES, countLabel, formatDate, nextSort, pagerOf, searchExceptions, shownCols, sortRows,
  tableMinWidth, toCsv, toggleHidden, type DataCol, type Pager, type Sort,
} from './_logic';

/**
 * Textarea that grows to fit its content so long (often AI-generated) field
 * values are fully visible the moment the panel opens — no manual dragging or
 * inner scrolling (item 14: "fields should be already expanded based on content").
 */
function AutoGrowTextarea({
  id,
  value,
  onChange,
  className,
  placeholder,
  minRows = 3,
}: {
  id?: string;
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
      id={id}
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
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending_approval', label: 'Pending approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' },
  { value: 'revoked', label: 'Revoked' },
];

const PRIORITY_OPTIONS = [
  { value: '', label: 'All' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

// Single-hue light status/priority chips. Explicit hex: the platform CSS repaints the slate/amber/emerald/rose utilities.
const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-[#eef2f6]', text: 'text-[#586472]', label: 'Draft' },
  pending_approval: { bg: 'bg-[#fffbeb]', text: 'text-[#b45309]', label: 'Pending approval' },
  approved: { bg: 'bg-[#ecfdf5]', text: 'text-[#047857]', label: 'Approved' },
  rejected: { bg: 'bg-[#fff1f2]', text: 'text-[#be123c]', label: 'Rejected' },
  expired: { bg: 'bg-[#fff7ed]', text: 'text-[#c2410c]', label: 'Expired' },
  revoked: { bg: 'bg-[#eef2f6]', text: 'text-[#586472]', label: 'Revoked' },
};

const PRIORITY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  low: { bg: 'bg-[#eef2f6]', text: 'text-[#586472]', label: 'Low' },
  medium: { bg: 'bg-[#fffbeb]', text: 'text-[#b45309]', label: 'Medium' },
  high: { bg: 'bg-[#fff7ed]', text: 'text-[#c2410c]', label: 'High' },
  critical: { bg: 'bg-[#fff1f2]', text: 'text-[#be123c]', label: 'Critical' },
};

const FOCUS = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';
const CARD = 'rounded-xl border border-[#d5dbe1] bg-[#fff] p-4';
const CARD_TITLE = 'mb-2 text-[13px] font-semibold text-[#1f2933]';
const FACT_LABEL = 'text-xs font-medium text-[#586472]';
const TIP = { fontSize: 11, borderRadius: 6, border: '1px solid #d5dbe1' };
/** The slim icon tools (Columns, Export, the pager): the shared icon button at the 32px of the library's filter row. */
const TOOL = `${BTN_ICON} !h-8 !w-8`;
// A table cell paints its own opaque background (the dashboard stripes the rows), has a hairline under it, and the ROW sets the
// height (the dashboard forces 7px of padding above and below every cell).
const CELL = 'overflow-hidden border-b border-[#e1e6eb] bg-[#fff] px-[12px] align-middle group-hover/row:bg-[#f7f9fb]';
// where a click on a row is not a click on the row
const CONTROLS = 'a, button, input, select, textarea, label, [role="menu"], [role="dialog"]';

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
  approver_name?: string;
  approved_at?: string;
  revocation_reason?: string;
  revoker_name?: string;
  /** what the person may do with it, from the server (it refuses the rest) */
  can_edit?: boolean;
  can_delete?: boolean;
  can_decide?: boolean;
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

// ── Rich-text field rendering ──────────────────────────────────────────────
// AI-generated exception content is sometimes stored as a stringified list
// (e.g. "['Enforce MFA', 'Log access']" from a str(list) on the server) or
// wrapped in stray quotes. Parse those back into clean numbered lists for
// display and tidy multiline text for the edit textareas — plain prose is
// left untouched.
const _LIST_MARKER = /^(\d+[.)]\s+|[-*•]\s+)/;

function parseListish(raw: unknown): string[] | null {
  if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean);
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  // JSON / Python-list-repr arrays, e.g. ["a","b"] or ['a','b']
  if (s.startsWith('[') && s.endsWith(']')) {
    for (const candidate of [s, s.replace(/'/g, '"')]) {
      try {
        const arr = JSON.parse(candidate);
        if (Array.isArray(arr)) return arr.map((x) => String(x).trim()).filter(Boolean);
      } catch {
        // ponytail: the single→double quote swap breaks on apostrophes inside
        // items; those just fall through to raw text, which is safe.
      }
    }
  }
  // Numbered / bulleted multi-line text: "1. a\n2. b" · "- a\n- b" · "1) a\n2) b"
  const lines = s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length >= 2 && lines.every((l) => _LIST_MARKER.test(l))) {
    return lines.map((l) => l.replace(_LIST_MARKER, '').trim()).filter(Boolean);
  }
  return null;
}

function cleanText(raw?: unknown): string {
  if (raw == null) return '';
  let s = String(raw).trim();
  if (!s || ['""', "''", '[]', '{}', 'null', 'None'].includes(s)) return '';
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

// Textarea-friendly: numbered lines for lists, clean text otherwise.
function toEditableText(raw?: unknown): string {
  const items = parseListish(raw);
  if (items && items.length > 1) return items.map((it, i) => `${i + 1}. ${it}`).join('\n');
  if (items && items.length === 1) return items[0];
  return cleanText(raw);
}

function RichText({ value, tone = 'text-[#26323d]' }: { value?: string | null; tone?: string }) {
  const items = parseListish(value);
  if (items && items.length > 1) {
    return (
      <ol className={`mt-1 list-decimal space-y-1 pl-5 text-[13px] leading-5 ${tone}`}>
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ol>
    );
  }
  const text = items && items.length === 1 ? items[0] : cleanText(value);
  return <p className={`mt-1 whitespace-pre-wrap text-[13px] leading-5 ${tone}`}>{text || '—'}</p>;
}

// ── Register cell primitives (explicit sizes and hex colours: the dashboard CSS gives a bare <td>/<p> its own) ──
function StatusPill({ status }: { status: string }) {
  const s = STATUS_STYLES[(status || '').toLowerCase()] || STATUS_STYLES.draft;
  return (
    <span className={`inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

function PriorityPill({ priority, withWord = false }: { priority: string; withWord?: boolean }) {
  const p = PRIORITY_STYLES[(priority || '').toLowerCase()] || PRIORITY_STYLES.medium;
  return (
    <span className={`inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-xs font-medium ${p.bg} ${p.text}`}>
      {p.label}{withWord && ' priority'}
    </span>
  );
}

/** "—" for a value that is not there, said in words to a screen reader. */
function Dash({ what }: { what: string }) {
  return (
    <span className="text-[13px] text-[#586472]" title={what}>
      <span aria-hidden>—</span>
      <span className="sr-only">{what}</span>
    </span>
  );
}

function DateCell({ value }: { value: string | null | undefined }) {
  const at = parseUtc(value);
  if (!at) return <Dash what="No date" />;
  return <time dateTime={at.toISOString()} className="whitespace-nowrap text-[13px] tabular-nums text-[#26323d]">{formatDate(value)}</time>;
}

function RequesterCell({ name }: { name?: string }) {
  const label = (name && name.trim()) || '';
  if (!label) return <Dash what="No requester" />;
  const initials = label.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#eef2f6] text-[11px] font-semibold text-[#586472]" aria-hidden>
        {initials}
      </span>
      <span className="min-w-0 truncate text-[13px] text-[#26323d]" title={label}>{label}</span>
    </span>
  );
}

/** A label over a value, in the details panel. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className={FACT_LABEL}>{label}</dt>
      <dd className="mt-0.5 break-words text-[13px] text-[#1f2933]">{children}</dd>
    </div>
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

  // ── Suggest exceptions (modal: searchable policy picker + opt-in AI suggestions) ──
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
        justification: prev.justification?.trim() ? prev.justification : toEditableText(data.justification),
        risk_assessment: prev.risk_assessment?.trim() ? prev.risk_assessment : toEditableText(data.risk_assessment),
        compensating_controls: prev.compensating_controls?.trim() ? prev.compensating_controls : toEditableText(data.compensating_controls),
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
      justification: toEditableText(exception.justification),
      risk_assessment: toEditableText(exception.risk_assessment),
      compensating_controls: toEditableText(exception.compensating_controls),
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
      justification: toEditableText(opts?.justification),
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
  const exceptionList = searchExceptions(allExceptions, searchTerm);
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

  // Per-row actions (⋯ menu), shown only to the people the server lets do them: changing a request is its requester's or an
  // editor's while it is a draft or pending; deciding it is for someone with the approve right who did not request it.
  const rowActions = (exc: ExceptionItem): RowAction[] => [
    { key: 'view', label: 'Details', icon: Eye, onClick: () => setViewingException(exc) },
    { key: 'edit', label: 'Edit', icon: Edit2, onClick: () => openEditModal(exc), hidden: !exc.can_edit },
    { key: 'submit', label: 'Submit for approval', icon: Send, onClick: () => submitMutation.mutate(exc.id), hidden: exc.status !== 'draft' || !exc.can_edit },
    { key: 'approve', label: 'Approve', icon: Check, onClick: () => setApproveModal(exc), hidden: exc.status !== 'pending_approval' || !exc.can_decide },
    { key: 'reject', label: 'Reject', icon: XCircle, onClick: () => setRejectModal(exc), variant: 'danger', hidden: exc.status !== 'pending_approval' || !exc.can_decide },
    { key: 'revoke', label: 'Revoke', icon: Ban, onClick: () => setRevokeModal(exc), hidden: exc.status !== 'approved' || !exc.can_decide },
    {
      key: 'delete',
      label: 'Delete',
      icon: Trash2,
      variant: 'danger',
      hidden: !exc.can_delete,
      onClick: () => {
        if (confirm('Are you sure you want to delete this exception?')) deleteMutation.mutate(exc.id);
      },
    },
  ];

  // ── The register: sorted, paged, with columns that can be hidden. It replaced the shared DataTable, whose toolbar (Columns and
  // Export as text buttons) cannot be slimmed. What it keeps: the five sortable columns (a click: ascending, descending, off), the
  // Columns menu, the CSV of the data columns in the sorted order, rows that open the details, and 15 rows a page.
  const uid = useId();
  const [sort, setSort] = useState<Sort>(null);
  const [hiddenCols, setHiddenCols] = useState<string[]>([]);
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  useEffect(() => { setPageNo(1); }, [searchTerm, statusFilter, priorityFilter, pageSize, sort]);

  // the data columns (name, sort key, CSV value) are DATA_COLS in _logic.ts; here is how each is drawn
  const columns: Col[] = [
    {
      id: 'title', always: true, ...DATA_COLS.title,
      cell: (e) => (
        <button
          type="button"
          onClick={() => setViewingException(e)}
          title={e.title}
          // text-sm, not text-[13px]: the dashboard's CSS gives every <button> 12px, and only the named sizes win over it
          className={`block max-w-full truncate rounded-sm text-left text-sm font-medium text-[#1f2933] hover:text-[#0f766e] hover:underline ${FOCUS}`}
        >
          {e.title}
        </button>
      ),
    },
    {
      id: 'policy', header: 'Policy', width: 160,
      cell: (e) => {
        const policy = e.document_title || e.policy_name;
        return policy ? <span className="block truncate text-[13px] text-[#26323d]" title={policy}>{policy}</span> : <Dash what="No policy" />;
      },
    },
    { id: 'status', width: 140, ...DATA_COLS.status, cell: (e) => <StatusPill status={e.status} /> },
    { id: 'priority', width: 100, ...DATA_COLS.priority, cell: (e) => <PriorityPill priority={e.priority} /> },
    { id: 'requester', header: 'Requester', width: 150, cell: (e) => <RequesterCell name={e.requester_name || e.requested_by_name} /> },
    { id: 'created', width: 108, ...DATA_COLS.created, cell: (e) => <DateCell value={e.created_at} /> },
    { id: 'expiry', width: 108, ...DATA_COLS.expiry, cell: (e) => <DateCell value={e.expiry_date} /> },
    {
      id: 'actions', header: 'Actions', always: true, width: 52,
      cell: (e) => <div className="flex justify-end"><RowActionsMenu actions={rowActions(e)} /></div>,
    },
  ];
  const visibleCols = shownCols(columns, hiddenCols);
  const sorted = sortRows(exceptionList, visibleCols, sort);
  const pager = pagerOf(sorted.length, pageNo, pageSize);
  const pageRows = sorted.slice(pager.start, pager.end);
  const toggleCol = (id: string) => setHiddenCols((h) => toggleHidden(h, id));

  const none = allExceptions.length === 0;
  const startNew = () => { resetForm(); setShowCreateModal(true); };
  const empty = (
    <div className="mx-auto flex min-h-[10rem] max-w-sm flex-col items-center justify-center gap-2 px-4 py-10 text-center">
      {none ? <Shield className="h-8 w-8 text-[#9aa5b1]" strokeWidth={1.5} aria-hidden /> : <SearchX className="h-8 w-8 text-[#9aa5b1]" strokeWidth={1.5} aria-hidden />}
      <h3 className="text-[15px] font-semibold text-[#1f2933]">{none ? 'No exceptions' : 'No matches'}</h3>
      {none && canCreate && (
        <button type="button" onClick={startNew} className={BTN_PRIMARY}>
          <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden /> New exception
        </button>
      )}
      {!none && <button type="button" onClick={() => setSearchTerm('')} className={BTN}>Clear search</button>}
    </div>
  );

  return (
    <div className="governance-light space-y-4">
      <DocPageHeader
        title="Policy exceptions"
        info="Request, review, and manage policy exceptions"
        meta={isLoading ? undefined : countLabel(exceptionList.length, allExceptions.length, searchTerm.trim() !== '')}
        actions={(
          <>
            <button
              type="button"
              onClick={() => setDiscoverOpen(true)}
              title="Pick a policy and let AI suggest exceptions to raise"
              className={BTN}
            >
              <Sparkles className="h-4 w-4 text-[#0f766e]" strokeWidth={1.75} aria-hidden /> Suggest exceptions
            </button>
            {canCreate && (
              <button type="button" onClick={startNew} className={BTN_PRIMARY}>
                <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden /> New exception
              </button>
            )}
          </>
        )}
      />

      {(exceptionsError || documentsError) && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-[#e6d3a3] bg-[#fffbeb] px-3 py-2 text-[13px] text-[#6b4f0a]">
          <AlertCircle className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
          Some data could not be loaded.
        </div>
      )}

      {/* Summary row — status mix · aging · closure timeliness */}
      {allExceptions.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <section className={CARD}>
            <h2 className={CARD_TITLE}>Status</h2>
            <div className="flex items-center gap-3">
              <div className="h-[110px] w-[110px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={statusChartData} cx="50%" cy="50%" innerRadius={30} outerRadius={48} dataKey="value" paddingAngle={2}>
                      {statusChartData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={TIP} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="min-w-0 flex-1 space-y-1.5">
                {statusChartData.map((s) => (
                  <li key={s.name} className="flex items-center gap-2 text-xs">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-[#586472]">{s.name}</span>
                    <span className="font-semibold tabular-nums text-[#1f2933]">{s.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className={CARD}>
            <h2 className={CARD_TITLE}>Open by age</h2>
            <div className="h-[130px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={agingData} margin={{ top: 4, right: 6, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e1e6eb" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#586472' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#586472' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={TIP} />
                  <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                    {agingData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className={CARD}>
            <h2 className={CARD_TITLE}>Closed on time</h2>
            <div className="flex items-center gap-4">
              <span className="text-2xl font-bold tabular-nums" style={{ color: (analytics?.closed_on_time_pct ?? 100) >= 80 ? '#059669' : (analytics?.closed_on_time_pct ?? 0) >= 50 ? '#d97706' : '#e11d48' }}>
                {analytics?.closed_on_time_pct != null ? `${analytics.closed_on_time_pct}%` : '—'}
              </span>
              <dl className="flex-1 space-y-1.5 text-xs">
                <div className="flex items-center justify-between"><dt className="text-[#586472]">Open</dt><dd className="font-semibold tabular-nums text-[#1f2933]">{analytics?.open ?? 0}</dd></div>
                <div className="flex items-center justify-between"><dt className="text-[#586472]">Overdue</dt><dd className={`font-semibold tabular-nums ${analytics?.overdue ? 'text-[#b42318]' : 'text-[#1f2933]'}`}>{analytics?.overdue ?? 0}</dd></div>
                <div className="flex items-center justify-between"><dt className="text-[#586472]">Resolved</dt><dd className="font-semibold tabular-nums text-[#1f2933]">{analytics?.resolved ?? 0}</dd></div>
              </dl>
            </div>
          </section>
        </div>
      )}

      {/* One slim row: the search, the filters, and on the right the Columns and Export tools as icons */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-auto sm:min-w-[200px] sm:max-w-[300px] sm:flex-1">
          <Search aria-hidden strokeWidth={1.75} className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#586472]" />
          <input
            type="text"
            inputMode="search"
            autoComplete="off"
            spellCheck={false}
            aria-label="Search exceptions"
            title="Searches the title, the policy and the requester"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search exceptions"
            className="h-8 w-full rounded-lg border border-[#c3ccd5] bg-white pl-9 pr-8 text-xs text-[#1f2933] text-ellipsis placeholder:text-[#586472] focus-visible:!border-[#0f766e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]"
          />
          {searchTerm && (
            <button
              type="button"
              aria-label="Clear search"
              title="Clear search"
              onClick={() => setSearchTerm('')}
              className={`absolute right-1.5 top-1/2 grid h-5 w-5 -translate-y-1/2 place-items-center rounded-full text-[#586472] hover:bg-[#f3f6f8] hover:text-[#1f2933] ${FOCUS}`}
            >
              <X aria-hidden strokeWidth={1.75} className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <MultiSelectDropdown
          title="Status"
          items={STATUS_OPTIONS.filter((o) => o.value).map((o) => ({ value: o.value, label: o.label }))}
          selectedValues={statusFilter ? [statusFilter] : []}
          onApply={(values) => setStatusFilter(values[0] || '')}
          multiSelect={false}
          compact
          size="sm"
          className="shrink-0"
          triggerClassName="max-w-[14rem]"
        />
        <MultiSelectDropdown
          title="Priority"
          items={PRIORITY_OPTIONS.filter((o) => o.value).map((o) => ({ value: o.value, label: o.label }))}
          selectedValues={priorityFilter ? [priorityFilter] : []}
          onApply={(values) => setPriorityFilter(values[0] || '')}
          multiSelect={false}
          compact
          size="sm"
          className="shrink-0"
          triggerClassName="max-w-[14rem]"
        />
        <div className="ml-auto flex items-center gap-2">
          <ColumnsMenu columns={columns} hidden={hiddenCols} onToggle={toggleCol} />
          <button
            type="button"
            onClick={() => downloadCsv('policy-exceptions', visibleCols, sorted)}
            disabled={sorted.length === 0}
            aria-label="Export CSV"
            title={sorted.length === 0 ? 'Nothing to export' : 'Export CSV'}
            className={TOOL}
          >
            <Download aria-hidden strokeWidth={1.75} className="h-4 w-4" />
          </button>
        </div>
      </div>

      <section className="min-w-0">
        <RegisterTable
          columns={visibleCols}
          rows={pageRows}
          loading={isLoading}
          sort={sort}
          onSort={(id) => setSort((s) => nextSort(s, id))}
          onOpen={setViewingException}
          total={sorted.length}
          pager={pager}
          pageSize={pageSize}
          onPage={setPageNo}
          onPageSize={setPageSize}
          empty={empty}
        />
      </section>

      {/* Suggest exceptions — searchable policy picker + opt-in AI */}
      <AnimatedModal
        isOpen={discoverOpen}
        onClose={() => setDiscoverOpen(false)}
        size="lg"
        title="Suggest exceptions"
        headerAccessory={(
          <InfoTip
            align="end"
            label="About suggesting exceptions"
            text="Pick a policy, or all of them, then press Suggest: AI proposes exceptions you may need to raise. Nothing runs until you press Suggest."
          />
        )}
      >
        <div className="space-y-4 px-5 py-5">
          <div>
            <p className="mb-1 text-[13px] font-medium text-[#26323d]">Policy</p>
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
                className={`${BTN_PRIMARY} justify-center`}
              >
                {loadingCandidates ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
                {candidates.length ? 'Refresh' : 'Suggest'}
              </button>
            </div>
          </div>

          {selectedDiscoverPolicy && canCreate && (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-[#d5dbe1] bg-[#fff] p-3">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-[#1f2933]">{selectedDiscoverPolicy.title}</p>
                <p className="text-xs capitalize text-[#586472]">
                  {selectedDiscoverPolicy.doc_type || 'policy'}
                  {selectedDiscoverPolicy.document_code ? ` · ${selectedDiscoverPolicy.document_code}` : ''}
                </p>
              </div>
              <button type="button" onClick={() => openCreateForDocument(selectedDiscoverPolicy.id)} className={BTN}>
                <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden /> New exception
              </button>
            </div>
          )}

          <div className="max-h-72 space-y-2 overflow-y-auto pr-0.5">
            {loadingCandidates && (
              <div role="status" className="space-y-2">
                <span className="sr-only">{candidatePolicyId === 'all' ? 'Analyzing your policies' : 'Analyzing this policy'}</span>
                {[0, 1, 2].map((i) => <div key={i} aria-hidden className="h-16 animate-pulse rounded-lg bg-[#eef2f6] motion-reduce:animate-none" />)}
              </div>
            )}
            {!loadingCandidates && !candidatesFetched && candidates.length === 0 && (
              <p className="rounded-lg border border-dashed border-[#c3ccd5] px-3 py-4 text-center text-[13px] text-[#586472]">
                Pick a policy, then Suggest
              </p>
            )}
            {!loadingCandidates && candidatesFetched && candidates.length === 0 && (
              <p className="px-1 py-2 text-[13px] text-[#586472]">No suggestions found</p>
            )}
            {candidates.map((c, i) => (
              <div key={`${c.document_id}-${i}`} className="rounded-lg border border-[#d5dbe1] bg-[#fff] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-[#1f2933]">{c.suggested_title}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#586472]">
                      <span className="truncate">{c.document_title || `Policy #${c.document_id}`}</span>
                      <PriorityPill priority={c.suggested_priority} />
                    </div>
                  </div>
                  {canCreate && (
                    <button
                      type="button"
                      onClick={() => openCreateForDocument(c.document_id, { title: c.suggested_title, justification: c.rationale, priority: c.suggested_priority })}
                      className={BTN}
                    >
                      <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden /> Use
                    </button>
                  )}
                </div>
                {c.rationale && <p className="mt-2 text-xs leading-5 text-[#26323d]">{c.rationale}</p>}
              </div>
            ))}
          </div>
          {candidateSource === 'template' && candidates.length > 0 && (
            <p className="flex items-center gap-1 px-1 text-xs text-[#586472]">
              From policy details only
              <InfoTip label="About these suggestions" text="Generated from policy metadata. Configure an AI key for richer, content-aware suggestions." />
            </p>
          )}
        </div>
      </AnimatedModal>

      <RightSlidePanel
        isOpen={showCreateModal || !!editingException}
        onClose={() => { setShowCreateModal(false); setEditingException(null); resetForm(); }}
        title={editingException ? 'Edit exception' : 'New exception'}
        widthClassName="w-[780px] max-w-full"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor={`${uid}-title`}>Title *</label>
              <input
                id={`${uid}-title`}
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="input"
              />
            </div>
            <div>
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
                placeholder="Select a policy…"
                forceSearch
              />
            </div>
          </div>

          {showCreateModal && !editingException && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => suggestContentMutation.mutate({ title: normalizedTitle, document_id: selectedDocumentId })}
                disabled={!selectedDocumentId || !normalizedTitle || suggestContentMutation.isPending}
                className={BTN}
              >
                {suggestContentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4 text-[#0f766e]" strokeWidth={1.75} aria-hidden />}
                {suggestContentMutation.isPending ? 'Drafting…' : 'AI Assist'}
              </button>
              <InfoTip label="About AI Assist" text="Select a policy and enter a title, then AI Assist fills in suggested details. Anything you already wrote is kept." />
              <span role="status" className="sr-only">{suggestContentMutation.isPending ? 'AI is drafting suggestions' : ''}</span>
            </div>
          )}

          <div>
            <label className="label" htmlFor={`${uid}-why`}>Justification *</label>
            <AutoGrowTextarea
              id={`${uid}-why`}
              value={formData.justification}
              onChange={(e) => setFormData({ ...formData, justification: e.target.value })}
              className="input"
              placeholder="Why is it needed?"
            />
          </div>

          <div>
            <label className="label" htmlFor={`${uid}-risk`}>Potential risks</label>
            <AutoGrowTextarea
              id={`${uid}-risk`}
              value={formData.risk_assessment}
              onChange={(e) => setFormData({ ...formData, risk_assessment: e.target.value })}
              className="input"
              placeholder="What could go wrong?"
            />
          </div>

          <div>
            <label className="label" htmlFor={`${uid}-ctl`}>Compensating controls</label>
            <AutoGrowTextarea
              id={`${uid}-ctl`}
              value={formData.compensating_controls}
              onChange={(e) => setFormData({ ...formData, compensating_controls: e.target.value })}
              className="input"
              placeholder="What covers the gap?"
            />
          </div>

          <div>
            <div className="mb-1 flex items-center gap-1">
              <span className="text-[13px] font-medium text-slate-700">Assets</span>
              <InfoTip label="About linked assets" text="Linked assets' CIA ratings and criticality weight this exception's risk posture; the most critical one drives the score." />
            </div>
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
              placeholder="Link assets…"
              forceSearch
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
            <div>
              <label className="label" htmlFor={`${uid}-from`}>Effective date</label>
              <input
                id={`${uid}-from`}
                type="date"
                value={formData.effective_date}
                onChange={(e) => setFormData({ ...formData, effective_date: e.target.value })}
                className="input"
              />
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-to`}>Expiry date</label>
              <input
                id={`${uid}-to`}
                type="date"
                value={formData.expiry_date}
                onChange={(e) => setFormData({ ...formData, expiry_date: e.target.value })}
                className="input"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-[#e1e6eb] pt-4">
            <button
              type="button"
              onClick={() => { setShowCreateModal(false); setEditingException(null); resetForm(); }}
              className={BTN}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmitForm}
              disabled={!formData.title || !formData.justification || createMutation.isPending || updateMutation.isPending}
              className={BTN_PRIMARY}
            >
              {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {editingException ? 'Save changes' : 'Create exception'}
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
              <div className="mt-1 flex items-center gap-2">
                <StatusPill status={viewingException.status} />
                <PriorityPill priority={viewingException.priority} withWord />
              </div>
            </div>
          ) : ''
        }
        widthClassName="w-[780px] max-w-full"
      >
        {viewingException && (
          <div className="space-y-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Fact label="Policy">{viewingException.document_title || viewingException.policy_name || '—'}</Fact>
              <Fact label="Requester">{viewingException.requester_name || viewingException.requested_by_name || '—'}</Fact>
              <Fact label="Effective date">{formatDate(viewingException.effective_date)}</Fact>
              <Fact label="Expiry date">{formatDate(viewingException.expiry_date)}</Fact>
              <Fact label="Created">{formatDate(viewingException.created_at)}</Fact>
              {(viewingException.approver_name || viewingException.approved_by_name) && (
                <Fact label="Approved by">{viewingException.approver_name || viewingException.approved_by_name}</Fact>
              )}
              {viewingException.revoker_name && <Fact label="Revoked by">{viewingException.revoker_name}</Fact>}
            </dl>

            <section>
              <h3 className={FACT_LABEL}>Justification</h3>
              <RichText value={viewingException.justification} />
            </section>

            <section>
              <div className="flex items-center justify-between gap-2">
                <h3 className={FACT_LABEL}>Potential risks</h3>
                {viewingException.promoted_risk_id ? (
                  <button
                    type="button"
                    onClick={() => { const id = viewingException.promoted_risk_id; setViewingException(null); if (id) router.push(`/erm/risks/${id}`); }}
                    title="Open it in the risk register to assess it"
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-sm font-medium text-[#0f766e] hover:bg-[#f0fdfa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]"
                  >
                    <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden /> In risk register
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => promoteToRiskMutation.mutate(viewingException.id)}
                      disabled={promoteToRiskMutation.isPending}
                      className={BTN}
                    >
                      {promoteToRiskMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <ArrowRightLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
                      Move to risk register
                    </button>
                    <InfoTip
                      align="end"
                      label="About moving to the risk register"
                      text="Creates a risk-register entry from these potential risks, with the linked assets, so you can complete the likelihood and impact assessment there."
                    />
                  </span>
                )}
              </div>
              <RichText value={viewingException.risk_assessment} />
            </section>

            <section>
              <h3 className={FACT_LABEL}>Compensating controls</h3>
              <RichText value={viewingException.compensating_controls} />
            </section>

            {viewingException.rejection_reason && (
              <div className="rounded-lg border border-[#f1b5ae] bg-[#fef3f2] p-3.5">
                <h3 className="text-xs font-medium text-[#b42318]">Rejection reason</h3>
                <RichText value={viewingException.rejection_reason} tone="text-[#7a1616]" />
              </div>
            )}

            {viewingException.approval_comments && (
              <div className="rounded-lg border border-[#b7e4d0] bg-[#ecfdf5] p-3.5">
                <h3 className="text-xs font-medium text-[#047857]">Approval comments</h3>
                <RichText value={viewingException.approval_comments} tone="text-[#065f46]" />
              </div>
            )}

            {viewingException.revocation_reason && (
              <div className="rounded-lg border border-[#d5dbe1] bg-[#f3f6f8] p-3.5">
                <h3 className="text-xs font-medium text-[#586472]">Revocation reason</h3>
                <RichText value={viewingException.revocation_reason} tone="text-[#26323d]" />
              </div>
            )}

            <div className="border-t border-[#e1e6eb] pt-4">
              <h3 className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-[#1f2933]">
                <MessageSquare className="h-4 w-4 text-[#586472]" strokeWidth={1.75} aria-hidden />
                Comments
              </h3>
              {commentsLoading ? (
                <div aria-hidden className="mb-3.5 space-y-2">
                  <div className="h-10 animate-pulse rounded-lg bg-[#eef2f6] motion-reduce:animate-none" />
                  <div className="h-10 animate-pulse rounded-lg bg-[#eef2f6] motion-reduce:animate-none" />
                </div>
              ) : (
                <div className="mb-3.5 space-y-2.5">
                  {(!comments || comments.length === 0) && (
                    <p className="py-2 text-center text-[13px] text-[#586472]">No comments yet</p>
                  )}
                  {(comments || []).map((comment) => (
                    <div key={comment.id} className="rounded-lg bg-[#f3f6f8] p-2.5">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="text-[13px] font-medium text-[#1f2933]">{comment.user_name}</span>
                        <span className="text-xs text-[#586472]" title={formatDate(comment.created_at)}>{relativeTime(comment.created_at)}</span>
                      </div>
                      <p className="text-[13px] text-[#26323d]">{comment.comment}</p>
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
                  placeholder="Add a comment…"
                  aria-label="Add a comment"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newComment.trim()) {
                      addCommentMutation.mutate({ id: viewingException.id, data: { comment: newComment.trim() } });
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (newComment.trim()) {
                      addCommentMutation.mutate({ id: viewingException.id, data: { comment: newComment.trim() } });
                    }
                  }}
                  disabled={!newComment.trim() || addCommentMutation.isPending}
                  aria-label="Send comment"
                  title="Send comment"
                  className={`${BTN_PRIMARY} !w-9 justify-center !px-0`}
                >
                  {addCommentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
                </button>
              </div>
            </div>
          </div>
        )}
      </RightSlidePanel>

      {approveModal && (
        <AnimatedModal
          isOpen
          onClose={() => { setApproveModal(null); setApproveComments(''); }}
          size="md"
          title={<span className="flex items-center gap-2"><CheckCircle className="h-5 w-5 shrink-0 text-[#047857]" strokeWidth={1.75} aria-hidden /> Approve exception</span>}
          subtitle={approveModal.title}
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setApproveModal(null); setApproveComments(''); }} className={BTN}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => approveMutation.mutate({ id: approveModal.id, data: approveComments ? { comments: approveComments } : undefined })}
                disabled={approveMutation.isPending}
                className={BTN_PRIMARY}
              >
                {approveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Approve
              </button>
            </div>
          )}
        >
          <div className="px-5 py-4">
            <label className="label" htmlFor={`${uid}-approve`}>Comments</label>
            <textarea
              id={`${uid}-approve`}
              value={approveComments}
              onChange={(e) => setApproveComments(e.target.value)}
              className="input min-h-[80px]"
            />
          </div>
        </AnimatedModal>
      )}

      {rejectModal && (
        <AnimatedModal
          isOpen
          onClose={() => { setRejectModal(null); setRejectReason(''); }}
          size="md"
          title={<span className="flex items-center gap-2"><XCircle className="h-5 w-5 shrink-0 text-[#be123c]" strokeWidth={1.75} aria-hidden /> Reject exception</span>}
          subtitle={rejectModal.title}
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setRejectModal(null); setRejectReason(''); }} className={BTN}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => rejectMutation.mutate({ id: rejectModal.id, data: { rejection_reason: rejectReason } })}
                disabled={!rejectReason.trim() || rejectMutation.isPending}
                className={`${BTN_PRIMARY} !bg-[#be123c] hover:!bg-[#9f1239]`}
              >
                {rejectMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Reject
              </button>
            </div>
          )}
        >
          <div className="px-5 py-4">
            <label className="label" htmlFor={`${uid}-reject`}>Reason *</label>
            <textarea
              id={`${uid}-reject`}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="input min-h-[100px]"
              placeholder="Why is it rejected?"
            />
          </div>
        </AnimatedModal>
      )}

      {revokeModal && (
        <AnimatedModal
          isOpen
          onClose={() => { setRevokeModal(null); setRevokeReason(''); }}
          size="md"
          title={<span className="flex items-center gap-2"><Ban className="h-5 w-5 shrink-0 text-[#586472]" strokeWidth={1.75} aria-hidden /> Revoke exception</span>}
          subtitle={revokeModal.title}
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setRevokeModal(null); setRevokeReason(''); }} className={BTN}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => revokeMutation.mutate({ id: revokeModal.id, data: revokeReason ? { reason: revokeReason } : undefined })}
                disabled={revokeMutation.isPending}
                className={`${BTN_PRIMARY} !bg-[#586472] hover:!bg-[#3f4b58]`}
              >
                {revokeMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Revoke
              </button>
            </div>
          )}
        >
          <div className="px-5 py-4">
            <label className="label" htmlFor={`${uid}-revoke`}>Reason</label>
            <textarea
              id={`${uid}-revoke`}
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              className="input min-h-[80px]"
            />
          </div>
        </AnimatedModal>
      )}
    </div>
  );
}

// ── The register's parts ──────────────────────────────────────────────────────────────────────────────────────────────

/** One column of the register: what sorting and the CSV use (DataCol, in _logic.ts) and how it is drawn. An `always` column cannot be hidden. */
interface Col extends DataCol<ExceptionItem> {
  width?: number;
  always?: boolean;
  cell: (e: ExceptionItem) => ReactNode;
}

/** Downloaded as `<name>.csv`; the text is toCsv's. */
function downloadCsv(name: string, cols: Col[], rows: ExceptionItem[]) {
  const url = URL.createObjectURL(new Blob([toCsv(cols, rows)], { type: 'text/csv;charset=utf-8;' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function HeadCell({ col, sort, onSort }: { col: Col; sort: Sort; onSort: (id: string) => void }) {
  const sorted = sort?.id === col.id;
  return (
    <th
      scope="col"
      aria-sort={sorted ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : undefined}
      className="border-b border-[#d5dbe1] px-[12px] text-left align-middle !bg-[#f3f6f8]"
    >
      {col.sort ? (
        <button
          type="button"
          onClick={() => onSort(col.id)}
          title={`Sort by ${col.header.toLowerCase()}`}
          className={`group/sort -mx-1 inline-flex items-center gap-0.5 rounded px-1 py-0.5 ${FOCUS} ${sorted ? 'text-[#1f2933]' : 'text-[#586472] hover:text-[#1f2933]'}`}
        >
          <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide">{col.header}</span>
          {sorted ? (
            sort?.dir === 'asc'
              ? <ChevronUp className="h-4 w-4 text-[#0f766e]" strokeWidth={1.75} aria-hidden />
              : <ChevronDown className="h-4 w-4 text-[#0f766e]" strokeWidth={1.75} aria-hidden />
          ) : (
            <ChevronsUpDown className="h-4 w-4 opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60" strokeWidth={1.75} aria-hidden />
          )}
        </button>
      ) : (
        <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide text-[#586472]">
          {col.id === 'actions' ? <span className="sr-only">{col.header}</span> : col.header}
        </span>
      )}
    </th>
  );
}

/** The library's table look: one white card, a grey header, 44px rows with a hairline, a footer with the range and the pages. */
function RegisterTable({ columns, rows, loading, sort, onSort, onOpen, total, pager, pageSize, onPage, onPageSize, empty }: {
  columns: Col[];
  /** the rows of this page */
  rows: ExceptionItem[];
  loading: boolean;
  sort: Sort;
  onSort: (id: string) => void;
  onOpen: (e: ExceptionItem) => void;
  /** every row there is (all pages) */
  total: number;
  /** which page this is, how many there are, and the range in words (pagerOf) */
  pager: Pager;
  pageSize: number;
  onPage: (n: number) => void;
  onPageSize: (n: number) => void;
  empty: ReactNode;
}) {
  const { page, pages } = pager;
  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-[#d5dbe1] bg-white">
      {!loading && total === 0 ? (
        empty
      ) : (
        <div className="overflow-x-auto">
          {/* the Title column takes what the others leave (at least 240px): below that the card scrolls sideways */}
          <table
            className="w-full table-fixed !border-separate border-spacing-0 text-left"
            style={{ minWidth: tableMinWidth(columns) }}
          >
            <caption className="sr-only">{loading ? 'Loading the exceptions' : 'Policy exceptions'}</caption>
            <colgroup>
              {columns.map((c) => <col key={c.id} style={c.width ? { width: c.width } : undefined} />)}
            </colgroup>
            <thead>
              <tr className="h-10">
                {columns.map((c) => <HeadCell key={c.id} col={c} sort={sort} onSort={onSort} />)}
              </tr>
            </thead>
            <tbody aria-busy={loading || undefined}>
              {loading
                ? Array.from({ length: 6 }, (_, i) => (
                    <tr key={i} aria-hidden className="h-11">
                      {columns.map((c) => (
                        <td key={c.id} className={CELL}>
                          <span className="block h-3.5 animate-pulse rounded bg-[#e1e6eb] motion-reduce:animate-none" style={{ width: c.id === 'title' ? '65%' : c.id === 'actions' ? '30%' : '70%' }} />
                        </td>
                      ))}
                    </tr>
                  ))
                : rows.map((e) => (
                    <tr
                      key={e.id}
                      // a click on the row opens the details, unless it was on a control (the title, the ⋯ menu) or ended selecting text
                      onClick={(ev) => {
                        if ((ev.target as HTMLElement).closest(CONTROLS) || window.getSelection()?.toString()) return;
                        onOpen(e);
                      }}
                      className="group/row h-11 cursor-pointer"
                    >
                      {columns.map((c) => <td key={c.id} className={CELL}>{c.cell(e)}</td>)}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-[#e1e6eb] px-[12px] py-[8px]">
          <p className="text-[13px] tabular-nums text-[#586472]" aria-live="polite">{pager.label}</p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="inline-flex items-center gap-2 text-[13px] text-[#586472]">
              Rows
              <select
                value={pageSize}
                onChange={(e) => onPageSize(Number(e.target.value))}
                className={`h-8 rounded-lg border border-[#c3ccd5] bg-[#fff] px-2 text-sm text-[#26323d] ${FOCUS}`}
              >
                {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <div className="flex items-center gap-2">
              <button type="button" className={TOOL} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page" title="Previous page">
                <ChevronLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              </button>
              <span className="text-[13px] tabular-nums text-[#586472]">{page} / {pages}</span>
              <button type="button" className={TOOL} disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page" title="Next page">
                <ChevronRight className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** The Columns tool: an icon that opens a small panel of tick boxes (portaled and fixed, so no scroller clips it). Esc, a click elsewhere or a scroll closes it. */
function ColumnsMenu({ columns, hidden, onToggle }: { columns: Col[]; hidden: string[]; onToggle: (id: string) => void }) {
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const open = at !== null;

  useEffect(() => {
    if (!open) return;
    const away = () => setAt(null);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!button.current?.contains(target) && !panel.current?.contains(target)) away();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setAt(null); button.current?.focus(); } };
    const onScroll = (e: Event) => { if (!panel.current?.contains(e.target as Node)) away(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', away);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', away);
    };
  }, [open]);

  // the panel is at the end of the page for the keyboard, so focus moves into it when it opens
  useEffect(() => {
    if (open) panel.current?.querySelector<HTMLElement>('input')?.focus({ preventScroll: true });
  }, [open]);

  const toggle = () => {
    if (open) { setAt(null); return; }
    const r = button.current?.getBoundingClientRect();
    if (r) setAt({ left: Math.max(8, Math.min(r.right - 224, window.innerWidth - 232)), top: r.bottom + 6 });
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        onClick={toggle}
        aria-label="Columns"
        title="Columns"
        aria-haspopup="dialog"
        aria-expanded={open}
        className={TOOL}
      >
        <Columns3 aria-hidden strokeWidth={1.75} className="h-4 w-4" />
      </button>
      {at && createPortal(
        <div
          ref={panel}
          role="dialog"
          aria-label="Columns"
          style={{ left: at.left, top: at.top }}
          className="fixed z-[70] w-56 rounded-xl border border-[#d5dbe1] bg-[#fff] p-2 shadow-elevated"
        >
          <p className="px-2 pb-1 pt-1 text-xs font-medium text-[#586472]">Columns</p>
          {columns.filter((c) => !c.always).map((c) => (
            <label key={c.id} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] text-[#26323d] hover:bg-[#f3f6f8]">
              <input
                type="checkbox"
                checked={!hidden.includes(c.id)}
                onChange={() => onToggle(c.id)}
                className={`h-4 w-4 shrink-0 rounded accent-[#0f766e] ${FOCUS}`}
              />
              {c.header}
            </label>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
