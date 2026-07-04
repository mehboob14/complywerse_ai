'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { governanceApi } from '@/lib/api';
import apiClient from '@/lib/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useToast } from '@/components/ui/ToastProvider';
import { SearchInput, MultiSelectDropdown, PageLoader, RightSlidePanel } from '@/components/ui';
import RichTextEditor from '../_RichTextEditor';
import { SignOffControlTab } from '../_SignoffControl';
import GovernanceMappingsPage from '../../mappings/page';
import DocumentAnnotationPanel from '@/components/evidence/DocumentAnnotationPanel';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  FileText,
  Loader2,
  AlertCircle,
  Download,
  Eye,
  Shield,
  BookOpen,
  FileCheck,
  ClipboardList,
  Lightbulb,
  Layers,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  ExternalLink,
  Wand2,
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  BarChart3,
  Play,
  X,
  User,
  Calendar,
  Edit3,
  ShieldAlert,
  ShieldCheck,
  Check,
  Minus,
  Link2,
  Save,
  Pencil,
  Send,
  Archive,
  Plus,
  Trash2,
  History,
  RotateCcw,
  GitCompare,
  Sparkles,
  Search,
  Info,
  MessageSquare,
  Maximize2,
} from 'lucide-react';
import NcaCompareModal from '@/components/governance/NcaCompareModal';
import { GovernanceDocumentMarkdown } from '@/components/governance/GovernanceDocumentMarkdown';

// Charter: single-hue light status pills (bg-{tone}-50 text-{tone}-700); neutral
// slate for doc-type markers (icon carries the distinction, not a rainbow).
const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Draft' },
  pending_review: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Pending Review' },
  pending_approval: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Pending Approval' },
  approved: { bg: 'bg-primary-50', text: 'text-primary-700', label: 'Approved' },
  published: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Published' },
  expired: { bg: 'bg-rose-50', text: 'text-rose-700', label: 'Expired' },
  archived: { bg: 'bg-slate-100', text: 'text-slate-500', label: 'Archived' },
};

const COMPLIANCE_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  fully_compliant: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Fully Compliant' },
  partially_compliant: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Partially Compliant' },
  not_addressed: { bg: 'bg-rose-50', text: 'text-rose-700', label: 'Not Addressed' },
  not_applicable: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Not Applicable' },
};

const RISK_SEVERITY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  critical: { bg: 'bg-rose-50', text: 'text-rose-700', label: 'Critical' },
  high: { bg: 'bg-orange-50', text: 'text-orange-700', label: 'High' },
  medium: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Medium' },
  low: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Low' },
};

const REMEDIATION_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  open: { bg: 'bg-rose-50', text: 'text-rose-700', label: 'Open' },
  in_progress: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'In Progress' },
  closed: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Closed' },
  accepted_risk: { bg: 'bg-primary-50', text: 'text-primary-700', label: 'Accepted Risk' },
};

const DOC_TYPE_STYLES: Record<string, { icon: any; color: string; bgColor: string; label: string }> = {
  policy: { icon: BookOpen, color: 'text-slate-600', bgColor: 'bg-slate-100', label: 'Policy' },
  standard: { icon: FileCheck, color: 'text-slate-600', bgColor: 'bg-slate-100', label: 'Standard' },
  procedure: { icon: ClipboardList, color: 'text-slate-600', bgColor: 'bg-slate-100', label: 'Procedure' },
  guideline: { icon: Lightbulb, color: 'text-slate-600', bgColor: 'bg-slate-100', label: 'Guideline' },
  charter: { icon: Shield, color: 'text-slate-600', bgColor: 'bg-slate-100', label: 'Charter' },
  framework: { icon: Layers, color: 'text-slate-600', bgColor: 'bg-slate-100', label: 'Framework' },
};

const formatDate = (dateStr: string | null | undefined) => {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString();
};

const truncateText = (text: string | null | undefined, maxLen: number = 80) => {
  if (!text) return '-';
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen) + '...';
};

const dedupeFrameworkOptions = (items: any[] = []) => {
  const statusRank: Record<string, number> = { published: 4, completed: 3, classified: 2, parsed: 1 };
  const deduped = new Map<string, any>();

  items.forEach((framework: any) => {
    const key = String(
      framework?.published_framework_id ||
      `${String(framework?.name || '').trim().toLowerCase()}::${String(framework?.version || framework?.framework_version || '').trim().toLowerCase()}`
    );
    const existing = deduped.get(key);
    const existingRank = existing ? statusRank[String(existing?.upload_status || '').toLowerCase()] ?? 0 : -1;
    const currentRank = statusRank[String(framework?.upload_status || '').toLowerCase()] ?? 0;
    const existingUpdated = existing?.updated_at ? new Date(existing.updated_at).getTime() : 0;
    const currentUpdated = framework?.updated_at ? new Date(framework.updated_at).getTime() : 0;

    if (!existing || currentRank > existingRank || (currentRank === existingRank && currentUpdated > existingUpdated)) {
      deduped.set(key, framework);
    }
  });

  return Array.from(deduped.values()).sort((a, b) => String(a?.name || '').localeCompare(String(b?.name || '')));
};

/**
 * Some AI-generated documents emit markdown where a bullet marker (`* `,
 * `- `, `+ `) appears on a line by itself, with the actual list-item text
 * on a separate non-blank line below it. ReactMarkdown then renders an
 * empty bullet followed by a stray paragraph, which looks broken (see
 * "Mandatory Standard Requirements" example with empty dots above 6.1, 6.2…).
 *
 * This pre-processor merges the empty marker with the next content line so
 * markdown sees a normal "* 6.1: text" list item. It preserves indentation
 * (so nested lists keep their hierarchy) and leaves intentional blank-line
 * separators between true paragraphs alone.
 */
const normalizeAiMarkdown = (raw: string | null | undefined): string => {
  if (!raw) return '';
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  const result: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const current = lines[i];
    const stripped = current.trimEnd();
    // Match a line that is ONLY a list marker (with optional indent), no content after it.
    const emptyBulletMatch = stripped.match(/^([\t ]*)([*+\-]|\d+\.)\s*$/);
    if (emptyBulletMatch) {
      const indent = emptyBulletMatch[1] ?? '';
      const marker = emptyBulletMatch[2] ?? '*';
      // Look ahead for the next non-blank line whose indentation is >= the marker's
      // indent — that's the content that belongs with this bullet.
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      if (j < lines.length) {
        const nextStripped = lines[j].replace(/^\s+/, '');
        result.push(`${indent}${marker} ${nextStripped}`);
        i = j + 1;
        continue;
      }
    }
    result.push(current);
    i += 1;
  }
  return result.join('\n');
};

const sanitizeDocumentHtml = (html: string | null | undefined) => {
  if (!html) return '';

  return html.replace(/\sstyle=(['"])(.*?)\1/gi, (_match, quote, styleValue) => {
    const cleanedStyle = String(styleValue)
      .replace(/(^|;)\s*(color|background|background-color|opacity|-webkit-text-fill-color|text-fill-color|filter|mix-blend-mode|text-shadow)\s*:[^;]*;?/gi, '$1')
      .replace(/;;+/g, ';')
      .replace(/^\s*;|;\s*$/g, '')
      .trim();

    return cleanedStyle ? ` style=${quote}${cleanedStyle}${quote}` : '';
  });
};

// Pulls the items from any heading whose title matches a "related documents"
// / "references" pattern. Returns a Map<normalized-text, {raw, doc_type}> so
// the markdown renderer can look up each <li> and decide whether to inject
// a "+ Draft" button without re-parsing on every render.
type ReferenceEntry = { raw: string; doc_type: 'policy' | 'standard' | 'procedure' | 'guideline' };
const REFERENCE_HEADING_PATTERN = /(related\s+documents(?:\s+and\s+references)?|normative\s+references|references|supporting\s+documents)/i;

const inferDocType = (title: string): ReferenceEntry['doc_type'] => {
  const t = title.toLowerCase();
  if (/\bstandard(s)?\b/.test(t)) return 'standard';
  if (/\bprocedure(s)?\b/.test(t)) return 'procedure';
  if (/\b(guideline|guide|playbook|handbook|manual)\b/.test(t)) return 'guideline';
  return 'policy';
};

const cleanReferenceLine = (text: string): string => {
  // Strip markdown emphasis, link syntax, leading clause numbers, and
  // trailing punctuation / version suffixes so each of these:
  //   "**Information Classification Standard** v1.0 —"
  //   "11.2.1 Information Classification Standard."
  //   "11.2.5 Secure SDLC Standard (including secure coding, code review)."
  // all reduce to: "Information Classification Standard" / "Secure SDLC Standard".
  let out = text
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
  // Leading clause number — "11.2.1 ", "5. ", "A.3 ", "(11.2) ".
  out = out.replace(/^\(?(?:[A-Z]\.?\d+(?:\.\d+)*|\d+(?:\.\d+)+|\d+\.)\)?\s+/, '').trim();
  // Drop a trailing parenthetical or "— description" so we keep just the name.
  out = out.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s*[—–-]\s+.+$/, '').trim();
  // Trailing punctuation.
  out = out.replace(/[.,;:]+$/, '').trim();
  return out;
};

const extractReferenceEntries = (raw: string): Map<string, ReferenceEntry> => {
  const out = new Map<string, ReferenceEntry>();
  if (!raw) return out;
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  let inSection = false;
  let sectionLevel = 0;
  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const titleRaw = headingMatch[2].replace(/^\d+(\.\d+)*\s+/, '').trim();
      if (REFERENCE_HEADING_PATTERN.test(titleRaw)) {
        inSection = true;
        sectionLevel = level;
      } else if (inSection && level <= sectionLevel) {
        inSection = false;
      }
      continue;
    }
    if (!inSection) continue;
    // Match bullets (`- foo`), simple numbered list items (`1. foo`), AND
    // numbered clause paragraphs (`11.2.1 Information Classification
    // Standard.`) which is how the AI-drafting scaffold lays them out.
    let candidate: string | null = null;
    const bulletMatch = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.+?)\s*$/);
    if (bulletMatch) {
      candidate = bulletMatch[1];
    } else {
      const clauseMatch = line.match(/^\s*(?:\d+(?:\.\d+)+|\d+\.\d+)\s+(.+?)\s*$/);
      if (clauseMatch) candidate = clauseMatch[1];
    }
    if (!candidate) continue;
    const cleaned = cleanReferenceLine(candidate);
    // Filter: a reference document name is short-ish, not a sentence, and
    // not obviously a regulation citation like "ISO/IEC 27001:2022" which
    // already exists outside the platform. Reject sentences that read like
    // a clause body ("The CISO shall …") rather than a document name.
    if (cleaned.length < 4 || cleaned.length > 140) continue;
    if (/^\s*(see|refer|note|e\.g\.|i\.e\.)\b/i.test(cleaned)) continue;
    if (/\b(shall|must|will|should|may)\b/i.test(cleaned)) continue;
    out.set(cleaned.toLowerCase(), { raw: cleaned, doc_type: inferDocType(cleaned) });
  }
  return out;
};

// Flatten a ReactMarkdown <li>'s children prop into a plain string so we
// can match it against the pre-extracted reference set. Handles nested
// elements that come through as JSX (e.g. <strong>, <em>) by recursing.
const childrenToText = (node: React.ReactNode): string => {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(childrenToText).join('');
  if (typeof node === 'object') {
    const maybeElement = node as { props?: { children?: React.ReactNode } };
    if (maybeElement.props) return childrenToText(maybeElement.props.children);
  }
  return '';
};

type TabKey = 'viewer' | 'statements' | 'controls' | 'gap-analysis' | 'sign-off' | 'discussion' | 'review-history';

export default function PolicyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const id = Number(params.id);

  // Restore the operator's scroll position after they round-tripped through
  // /governance/documents to draft a referenced standard. handleDraftReference
  // writes window.scrollY to sessionStorage under `gov-doc-scroll-<id>`
  // before navigating away; we read it on remount and clear the key so the
  // next visit isn't surprised by a stale offset.
  useEffect(() => {
    if (!id || Number.isNaN(id)) return;
    const key = `gov-doc-scroll-${id}`;
    try {
      const saved = sessionStorage.getItem(key);
      if (!saved) return;
      const y = Number(saved);
      sessionStorage.removeItem(key);
      if (!Number.isNaN(y) && y > 0) {
        // Defer to after the document content paints — otherwise the page
        // is still short and the scroll is clamped to 0.
        const t = window.setTimeout(() => window.scrollTo({ top: y, behavior: 'auto' }), 250);
        return () => window.clearTimeout(t);
      }
    } catch {
      // sessionStorage disabled — silently no-op.
    }
  }, [id]);

  const searchParams = useSearchParams();
  const _VALID_TABS = ['viewer', 'statements', 'controls', 'gap-analysis', 'sign-off', 'discussion', 'review-history'];
  const _paramTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<TabKey>(
    (_paramTab && _VALID_TABS.includes(_paramTab) ? _paramTab : 'viewer') as TabKey,
  );
  const [showGapModal, setShowGapModal] = useState(false);
  const [showNcaCompareModal, setShowNcaCompareModal] = useState(false);
  const [selectedFrameworkIds, setSelectedFrameworkIds] = useState<number[]>([]);
  // Search term used to filter the framework picker inside the gap
  // analysis modal. Reset when the modal closes.
  const [gapFrameworkSearch, setGapFrameworkSearch] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [editingRow, setEditingRow] = useState<number | null>(null);
  const [editAction, setEditAction] = useState<string | null>(null);

  const [gapFilters, setGapFilters] = useState({
    framework_name: '',
    compliance_status: '',
    risk_severity: '',
    remediation_status: '',
    sort_by: 'clause_reference',
    sort_order: 'asc' as 'asc' | 'desc',
    skip: 0,
    limit: 20,
  });

  const [overrideForm, setOverrideForm] = useState({ status: 'fully_compliant', justification: '' });
  const [acceptRiskForm, setAcceptRiskForm] = useState({ justification: '', expiry_date: '' });
  const [assignOwnerForm, setAssignOwnerForm] = useState<number | null>(null);
  const [targetDateForm, setTargetDateForm] = useState('');
  const [statusUpdateForm, setStatusUpdateForm] = useState('');
  const [showEditForm, setShowEditForm] = useState(false);
  const [editForm, setEditForm] = useState({ title: '', description: '', classification: '', doc_type: '' });

  // Address-Gap modal state. The AI may either:
  //   - propose REPLACING an existing block of policy text (mode='replace'):
  //     `addressGapOriginal` holds the verbatim slice the AI matched; the
  //     left pane shows it read-only, the right pane shows the editable
  //     proposed replacement.
  //   - propose APPENDING a brand-new clause (mode='append'): only the
  //     right pane is shown; `addressGapHeading` controls the section
  //     heading the new clause is added under.
  const [addressGapFinding, setAddressGapFinding] = useState<any | null>(null);
  const [addressGapMode, setAddressGapMode] = useState<'replace' | 'append'>('append');
  const [addressGapOriginal, setAddressGapOriginal] = useState<string>('');
  const [addressGapDraft, setAddressGapDraft] = useState<string>('');
  const [addressGapHeading, setAddressGapHeading] = useState<string>('');
  const [addressGapReason, setAddressGapReason] = useState<string>('');

  const { data: document, isLoading: docLoading, error: docError } = useQuery({
    queryKey: ['governance-document', id],
    queryFn: async () => {
      const response = await governanceApi.getDocument(id);
      return response.data as any;
    },
    enabled: !!id,
  });

  // All platform documents for the compare-modal "Other Document" picker.
  // Fetched lazily — only when the gap-analysis tab is active.
  const { data: allDocumentsForCompare = [] } = useQuery({
    queryKey: ['governance-documents-for-compare'],
    queryFn: async () => {
      const response = await governanceApi.getDocuments({
        skip: 0,
        limit: 1000,
        sort_by: 'title',
        sort_order: 'asc',
      } as any);
      const payload = response.data as any;
      return (payload?.items || []) as Array<{ id: number; title: string; doc_type: string }>;
    },
    enabled: !!id && activeTab === 'gap-analysis',
    staleTime: 60 * 1000,
  });

  const { data: htmlContent, isLoading: htmlLoading } = useQuery({
    queryKey: ['document-view-html', id],
    queryFn: async () => {
      const response = await governanceApi.getDocumentViewHtml(id);
      return response.data as any;
    },
    enabled: !!id && activeTab === 'viewer',
  });

  const { data: statements, isLoading: statementsLoading } = useQuery({
    queryKey: ['document-policy-statements', id],
    queryFn: async () => {
      const response = await governanceApi.getDocumentPolicyStatements(id);
      return (response.data as any) || [];
    },
    enabled: !!id && activeTab === 'statements',
  });

  const { data: mappings, isLoading: mappingsLoading } = useQuery({
    queryKey: ['document-mappings', id],
    queryFn: async () => {
      const response = await governanceApi.getDocumentMappings(id);
      return response.data as any;
    },
    enabled: !!id && activeTab === 'controls',
  });

  const { data: gapAnalysisRuns } = useQuery({
    queryKey: ['gap-analysis-runs', id],
    queryFn: async () => {
      const response = await governanceApi.getGapAnalysisRuns(id);
      return response.data as any;
    },
    enabled: !!id && activeTab === 'gap-analysis',
    refetchInterval: (query) => {
      const data = query.state.data;
      const runs = data?.runs || data || [];
      const hasRunning = Array.isArray(runs) && runs.some((r: any) => r.status === 'running');
      return hasRunning ? 5000 : false;
    },
  });

  const hasRunningAnalysis = (() => {
    const runs = gapAnalysisRuns?.runs || gapAnalysisRuns || [];
    return Array.isArray(runs) && runs.some((r: any) => r.status === 'running');
  })();

  const { data: complianceSummary, isLoading: summaryLoading } = useQuery({
    queryKey: ['compliance-summary', id],
    queryFn: async () => {
      const response = await governanceApi.getComplianceSummary(id);
      return response.data as any;
    },
    enabled: !!id && activeTab === 'gap-analysis',
    // Poll while any run is in flight so the summary updates as soon as
    // each framework completes (otherwise the user sees an empty card after
    // the runs finish until they refresh).
    refetchInterval: hasRunningAnalysis ? 5000 : false,
  });

  // When all runs transition from running → completed, force an immediate
  // refetch of summary + findings so the UI doesn't have to wait for the
  // next poll tick.
  const prevHasRunningRef = useRef(hasRunningAnalysis);
  useEffect(() => {
    if (prevHasRunningRef.current && !hasRunningAnalysis) {
      queryClient.invalidateQueries({ queryKey: ['compliance-summary', id] });
      queryClient.invalidateQueries({ queryKey: ['document-gap-findings', id] });
      queryClient.invalidateQueries({ queryKey: ['gap-analysis-runs', id] });
    }
    prevHasRunningRef.current = hasRunningAnalysis;
  }, [hasRunningAnalysis, id, queryClient]);

  const { data: gapFindings, isLoading: findingsLoading } = useQuery({
    queryKey: ['document-gap-findings', id, gapFilters],
    queryFn: async () => {
      const params: Record<string, any> = {
        skip: gapFilters.skip,
        limit: gapFilters.limit,
        sort_by: gapFilters.sort_by,
        sort_order: gapFilters.sort_order,
      };
      if (gapFilters.framework_name) params.framework_name = gapFilters.framework_name;
      if (gapFilters.compliance_status) params.compliance_status = gapFilters.compliance_status;
      if (gapFilters.risk_severity) params.risk_severity = gapFilters.risk_severity;
      if (gapFilters.remediation_status) params.remediation_status = gapFilters.remediation_status;
      const response = await governanceApi.getDocumentGapFindings(id, params);
      return response.data as any;
    },
    enabled: !!id && activeTab === 'gap-analysis',
    refetchInterval: hasRunningAnalysis ? 3000 : false, // Poll every 3 seconds when analysis is running
    placeholderData: keepPreviousData,
  });

  const { data: uploadedFrameworks } = useQuery({
    queryKey: ['frameworks-list'],
    queryFn: async () => {
      const response = await apiClient.get('/framework-upload/upload');
      const data = response.data;
      const items = Array.isArray(data) ? data : data?.items || data?.frameworks || [];
      return dedupeFrameworkOptions(
        items.filter((f: any) => f.is_active && ['parsed', 'published', 'classified', 'completed'].includes(f.upload_status))
      );
    },
    enabled: showGapModal,
  });

  const { data: tenantUsers } = useQuery({
    queryKey: ['tenant-users', document?.tenant_id],
    queryFn: async () => {
      const response = await governanceApi.getTenantUsers(document?.tenant_id || 1);
      return response.data as any[];
    },
    enabled: !!document?.tenant_id && editAction === 'assign-owner',
  });

  const [isParsing, setIsParsing] = useState(false);
  const parsePollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopParsePolling = () => {
    if (parsePollingRef.current) {
      clearInterval(parsePollingRef.current);
      parsePollingRef.current = null;
    }
  };

  const startParsePolling = () => {
    stopParsePolling();
    setIsParsing(true);
    parsePollingRef.current = setInterval(async () => {
      try {
        const res = await governanceApi.getParseStatus(id);
        const data = res.data as any;
        if (data.status === 'completed') {
          stopParsePolling();
          setIsParsing(false);
          toast({ type: 'success', title: 'Policy Parsed', message: data.message || `${data.total_statements || 0} statements extracted.` });
          queryClient.invalidateQueries({ queryKey: ['document-policy-statements', id] });
        } else if (data.status === 'review_required') {
          stopParsePolling();
          setIsParsing(false);
          toast({ type: 'info', title: 'Review Required', message: data.message || 'Re-parse proposals are ready for review.' });
          queryClient.invalidateQueries({ queryKey: ['document-policy-statements', id] });
          queryClient.invalidateQueries({ queryKey: ['reparse-proposals', id] });
        } else if (data.status === 'failed') {
          stopParsePolling();
          setIsParsing(false);
          toast({ type: 'error', title: 'Parse Failed', message: data.error || 'Failed to parse policy.' });
        }
      } catch {
        stopParsePolling();
        setIsParsing(false);
      }
    }, 3000);
  };

  useEffect(() => {
    return () => stopParsePolling();
  }, []);

  const parsePolicyMutation = useMutation({
    mutationFn: () => governanceApi.parsePolicy(id),
    onSuccess: () => {
      toast({ type: 'info', title: 'Parsing Started', message: 'Policy parsing started in background. Results will appear automatically.' });
      startParsePolling();
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Parse Failed', message: error?.response?.data?.detail || 'Failed to parse policy.' });
    },
  });

  const runGapAnalysisMutation = useMutation({
    mutationFn: (data: { document_id: number; framework_ids?: number[]; run_all?: boolean }) =>
      governanceApi.runGapAnalysis(data),
    onSuccess: () => {
      toast({ type: 'success', title: 'Gap Analysis Started', message: 'Processing in background. Results will appear automatically.' });
      // Refetch all gap analysis related queries to get fresh data
      queryClient.invalidateQueries({ queryKey: ['gap-analysis-runs', id], refetchType: 'all' });
      queryClient.invalidateQueries({ queryKey: ['compliance-summary', id], refetchType: 'all' });
      // Refetch findings with all filter combinations
      queryClient.invalidateQueries({ queryKey: ['document-gap-findings'], refetchType: 'all' });
      setShowGapModal(false);
      setSelectedFrameworkIds([]);
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Analysis Failed', message: error?.response?.data?.detail || 'Failed to run gap analysis.' });
    },
  });

  const updateFindingMutation = useMutation({
    mutationFn: ({ findingId, data }: { findingId: number; data: Record<string, any> }) =>
      governanceApi.updateGapFinding(findingId, data),
    onSuccess: () => {
      toast({ type: 'success', title: 'Finding Updated' });
      queryClient.invalidateQueries({ queryKey: ['document-gap-findings', id] });
      setEditingRow(null);
      setEditAction(null);
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Update Failed', message: error?.response?.data?.detail || 'Failed to update finding.' });
    },
  });

  const overrideMutation = useMutation({
    mutationFn: ({ findingId, data }: { findingId: number; data: { override_status: string; override_justification: string } }) =>
      governanceApi.overrideGapFinding(findingId, data),
    onSuccess: () => {
      toast({ type: 'success', title: 'Override Applied' });
      queryClient.invalidateQueries({ queryKey: ['document-gap-findings', id] });
      setEditingRow(null);
      setEditAction(null);
      setOverrideForm({ status: 'fully_compliant', justification: '' });
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Override Failed', message: error?.response?.data?.detail || 'Failed to override.' });
    },
  });

  const acceptRiskMutation = useMutation({
    mutationFn: ({ findingId, data }: { findingId: number; data: { justification: string; expiry_date?: string } }) =>
      governanceApi.acceptGapRisk(findingId, data),
    onSuccess: () => {
      toast({ type: 'success', title: 'Risk Accepted' });
      queryClient.invalidateQueries({ queryKey: ['document-gap-findings', id] });
      setEditingRow(null);
      setEditAction(null);
      setAcceptRiskForm({ justification: '', expiry_date: '' });
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Accept Risk Failed', message: error?.response?.data?.detail || 'Failed to accept risk.' });
    },
  });

  const updateDocumentMutation = useMutation({
    mutationFn: (data: any) => governanceApi.updateDocument(id, data),
    onSuccess: () => {
      toast({ type: 'success', title: 'Document Updated' });
      queryClient.invalidateQueries({ queryKey: ['governance-document', id] });
      setShowEditForm(false);
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Update Failed', message: error?.response?.data?.detail || 'Failed to update document.' });
    },
  });

  // Two-step Apply Fix flow. generate-fix calls AI to draft the clause text;
  // apply-fix appends the (user-approved, possibly edited) text to the
  // document content and marks the finding as remediated.
  const generateGapFixMutation = useMutation({
    mutationFn: (findingId: number) => governanceApi.generateGapFix(findingId),
    onSuccess: (response: any) => {
      const data = response?.data || {};
      const mode = (data.mode === 'replace' || data.mode === 'append') ? data.mode : 'append';
      setAddressGapMode(mode);
      setAddressGapOriginal(data.current_text || '');
      setAddressGapDraft(data.proposed_text || data.suggested_clause_text || '');
      // Backend persists the draft on the finding row, so refresh the table
      // — even if the user closes the modal, the draft is now stored and
      // re-opening will pre-fill it instantly without another AI call.
      queryClient.invalidateQueries({ queryKey: ['document-gap-findings', id] });
    },
    onError: (error: any) => {
      toast({
        type: 'error',
        title: 'AI draft failed',
        message: error?.response?.data?.detail || 'Could not generate a clause draft. Please try again.'
      });
    },
  });

  const applyGapFixMutation = useMutation({
    mutationFn: (
      { findingId, data }:
      { findingId: number; data: {
        mode: 'replace' | 'append';
        proposed_text: string;
        current_text?: string | null;
        section_heading?: string;
        change_reason?: string;
      }; }
    ) => governanceApi.applyGapFix(findingId, data),
    onSuccess: (response: any) => {
      const v = response?.data?.applied_version_number;
      toast({
        type: 'success',
        title: 'Gap closed',
        message: v
          ? `Document updated — version ${v} saved with the prior content archived.`
          : 'The document has been updated.'
      });
      // Refresh findings (status=closed), document content (new clause),
      // and version-history list.
      queryClient.invalidateQueries({ queryKey: ['document-gap-findings', id] });
      queryClient.invalidateQueries({ queryKey: ['governance-document', id] });
      queryClient.invalidateQueries({ queryKey: ['document-versions', id] });
      setAddressGapFinding(null);
      setAddressGapMode('append');
      setAddressGapOriginal('');
      setAddressGapDraft('');
      setAddressGapHeading('');
      setAddressGapReason('');
    },
    onError: (error: any) => {
      toast({
        type: 'error',
        title: 'Apply failed',
        message: error?.response?.data?.detail || 'Could not apply the fix to the document.'
      });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: (status: string) => governanceApi.updateDocumentStatus(id, status),
    onSuccess: () => {
      toast({ type: 'success', title: 'Status Updated' });
      queryClient.invalidateQueries({ queryKey: ['governance-document', id] });
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Status Update Failed', message: error?.response?.data?.detail || 'Failed to update status.' });
    },
  });

  const submitForReviewMutation = useMutation({
    mutationFn: () => governanceApi.submitDocumentForReview(id),
    onSuccess: () => {
      toast({ type: 'success', title: 'Submitted for Review', message: 'The document is now in the approvals queue.' });
      queryClient.invalidateQueries({ queryKey: ['governance-document', id] });
      queryClient.invalidateQueries({ queryKey: ['governance-documents'] });
      queryClient.invalidateQueries({ queryKey: ['pending-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['workflow-dashboard'] });
      router.push('/governance/workflows');
    },
    onError: (error: any) => {
      const detail = error?.response?.data?.detail || 'Failed to submit document for review.';
      if (typeof detail === 'string' && detail.toLowerCase().includes('already has pending approval steps')) {
        toast({ type: 'info', title: 'Already in Review', message: 'This document is already waiting in approvals.' });
        router.push('/governance/workflows');
        return;
      }
      toast({ type: 'error', title: 'Submit Failed', message: detail });
    },
  });

  const publishMutation = useMutation({
    mutationFn: () => governanceApi.publishDocument(id),
    onSuccess: () => {
      toast({ type: 'success', title: 'Document Published' });
      queryClient.invalidateQueries({ queryKey: ['governance-document', id] });
      queryClient.invalidateQueries({ queryKey: ['governance-documents'] });
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Publish Failed', message: error?.response?.data?.detail || 'Failed to publish document.' });
    },
  });

  const handleEditOpen = () => {
    setEditForm({
      title: document?.title || '',
      description: document?.description || '',
      classification: document?.classification || 'internal',
      doc_type: document?.doc_type || 'policy',
    });
    setShowEditForm(true);
  };

  const handleEditSave = () => {
    updateDocumentMutation.mutate(editForm);
  };

  const handleDownload = async () => {
    try {
      let blob: Blob;
      let fileName = document?.file_name || `${document?.title || `document_${id}`}.html`;

      if (document?.has_file) {
        const response = await governanceApi.downloadDocumentFile(id);
        blob = new Blob([response.data]);
      } else {
        const response = await governanceApi.getDocumentViewHtml(id);
        const html = response.data?.html || '';
        blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        if (!fileName.toLowerCase().endsWith('.html')) {
          fileName = `${fileName}.html`;
        }
      }

      const url = window.URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = fileName;
      window.document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      window.document.body.removeChild(a);
    } catch {
      toast({ type: 'error', title: 'Download Failed' });
    }
  };

  const handleExportCSV = async () => {
    try {
      const response = await governanceApi.exportGapFindings(id);
      const blob = new Blob([response.data], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = window.document.createElement('a');
      a.href = url;
      a.download = `gap_findings_${id}.csv`;
      window.document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      window.document.body.removeChild(a);
      toast({ type: 'success', title: 'Export Complete' });
    } catch {
      toast({ type: 'error', title: 'Export Failed' });
    }
  };

  const handleRunAnalysis = () => {
    if (selectedFrameworkIds.length === 0) {
      runGapAnalysisMutation.mutate({ document_id: id, run_all: true });
    } else {
      runGapAnalysisMutation.mutate({ document_id: id, framework_ids: selectedFrameworkIds });
    }
  };

  const toggleFramework = (fwId: number) => {
    setSelectedFrameworkIds(prev =>
      prev.includes(fwId) ? prev.filter(i => i !== fwId) : [...prev, fwId]
    );
  };

  const toggleSelectAll = () => {
    if (!uploadedFrameworks) return;
    if (selectedFrameworkIds.length === uploadedFrameworks.length) {
      setSelectedFrameworkIds([]);
    } else {
      setSelectedFrameworkIds(uploadedFrameworks.map((f: any) => f.id));
    }
  };

  const toggleRowExpand = (rowId: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  const handleGapSort = (field: string) => {
    setGapFilters(prev => ({
      ...prev,
      sort_by: field,
      sort_order: prev.sort_by === field && prev.sort_order === 'asc' ? 'desc' : 'asc',
      skip: 0,
    }));
  };

  const findings = useMemo(() => {
    const data = gapFindings;
    if (Array.isArray(data)) return data;
    if (data?.items) return data.items;
    if (data?.findings) return data.findings;
    return [];
  }, [gapFindings]);

  const totalFindings = useMemo(() => {
    if (gapFindings?.total) return gapFindings.total;
    return findings.length;
  }, [gapFindings, findings]);

  const totalPages = Math.ceil(totalFindings / gapFilters.limit);
  const currentPage = Math.floor(gapFilters.skip / gapFilters.limit);

  if (docLoading) {
    return (
      <PageLoader className="h-64" />
    );
  }

  if (docError || !document) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4 text-red-400">
        <AlertCircle className="h-12 w-12" />
        <p>Failed to load document</p>
        <button onClick={() => router.back()} className="text-primary-400 hover:underline">Go Back</button>
      </div>
    );
  }

  const docStatus = STATUS_STYLES[document.status] || { bg: 'bg-slate-500/20', text: 'text-slate-600', label: document.status };
  const docType = DOC_TYPE_STYLES[document.doc_type] || { icon: FileText, color: 'text-slate-600', bgColor: 'bg-slate-500/20', label: document.doc_type };
  const TypeIcon = docType.icon;

  const tabs: { key: TabKey; label: string; icon: any }[] = [
    { key: 'viewer', label: 'Document Viewer', icon: Eye },
    { key: 'statements', label: 'Statements', icon: ClipboardList },
    { key: 'controls', label: 'Mappings', icon: Link2 },
    { key: 'gap-analysis', label: 'Gap Analysis', icon: BarChart3 },
    { key: 'sign-off', label: 'Sign-off & Control', icon: ShieldCheck },
    { key: 'discussion', label: 'Discussion', icon: MessageSquare },
    { key: 'review-history', label: 'Review History', icon: Clock },
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-4">
          <button
            onClick={() => router.push('/governance/documents')}
            className="mt-1 rounded-lg border border-slate-300 bg-white p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-lg font-semibold text-slate-900">{document.title}</h1>
            </div>
            <div className="flex items-center gap-3 text-sm text-slate-600">
              {document.document_code && <span className="font-mono">{document.document_code}</span>}
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${docStatus.bg} ${docStatus.text}`}>
                {docStatus.label}
              </span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${docType.bgColor} ${docType.color}`}>
                {docType.label}
              </span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {document.status === 'draft' && (
            <button
              onClick={() => submitForReviewMutation.mutate()}
              disabled={submitForReviewMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-slate-900 hover:bg-primary-700 disabled:opacity-50"
            >
              {submitForReviewMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Submit for Review
            </button>
          )}
          {(document.status === 'pending_review' || document.status === 'pending_approval') && (
            <button
              onClick={() => router.push('/governance/workflows')}
              className="flex items-center gap-2 rounded-lg border border-primary-200 bg-primary-50 px-4 py-2 text-primary-700 hover:bg-primary-100 transition-colors"
            >
              <Clock className="h-4 w-4" />
              Open Approvals
            </button>
          )}
          {document.status === 'approved' && (
            <button
              onClick={() => publishMutation.mutate()}
              disabled={publishMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-white hover:bg-green-700 disabled:opacity-50"
            >
              {publishMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
              Publish
            </button>
          )}
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          >
            <Download className="h-4 w-4" />
            {document.has_file ? 'Download File' : 'Download Draft'}
          </button>
          <button
            onClick={handleEditOpen}
            className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          >
            <Pencil className="h-4 w-4" />
            Edit Details
          </button>
        </div>
      </div>

      {showEditForm && (
        <div className="rounded-xl border border-slate-300 bg-white p-5">
          <h3 className="text-lg font-semibold text-slate-900 mb-4">Edit Document Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
              <input
                type="text"
                value={editForm.title}
                onChange={(e) => setEditForm(prev => ({ ...prev, title: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Classification</label>
              <select
                value={editForm.classification}
                onChange={(e) => setEditForm(prev => ({ ...prev, classification: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none"
              >
                <option value="public">Public</option>
                <option value="internal">Internal</option>
                <option value="confidential">Confidential</option>
                <option value="restricted">Restricted</option>
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
              <textarea
                value={editForm.description}
                onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                rows={3}
                className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Document Type</label>
              <select
                value={editForm.doc_type}
                onChange={(e) => setEditForm(prev => ({ ...prev, doc_type: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none"
              >
                <option value="policy">Policy</option>
                <option value="standard">Standard</option>
                <option value="procedure">Procedure</option>
                <option value="guideline">Guideline</option>
                <option value="charter">Charter</option>
                <option value="framework">Framework</option>
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-3 mt-4 pt-4 border-t border-slate-300">
            <button
              onClick={() => setShowEditForm(false)}
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 rounded-lg hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              onClick={handleEditSave}
              disabled={updateDocumentMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-primary-700 disabled:opacity-50"
            >
              {updateDocumentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Changes
            </button>
          </div>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="border-b border-slate-300">
        <nav className="flex gap-1">
          {tabs.map(tab => {
            const TabIcon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-primary-600 text-primary-700'
                    : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                <TabIcon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'viewer' && (
        <DocumentViewerTab
          document={document}
          htmlContent={htmlContent}
          htmlLoading={htmlLoading}
          docType={docType}
        />
      )}

      {activeTab === 'statements' && (
        <StatementsTab
          statements={statements}
          statementsLoading={statementsLoading}
          parsePolicyMutation={parsePolicyMutation}
          isParsing={isParsing}
          documentId={id}
        />
      )}

      {activeTab === 'controls' && (
        <ControlsTab
          mappings={mappings}
          mappingsLoading={mappingsLoading}
          documentId={id}
        />
      )}

      {activeTab === 'gap-analysis' && (
        <div className="space-y-4">
          {/* Side-by-Side Document Compare Panel */}
          <div className="rounded-xl border border-primary-200 bg-primary-50/40 p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <div className="rounded-lg bg-primary-100 p-2 flex-shrink-0">
                  <GitCompare className="h-5 w-5 text-primary-700" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-900">Compare with Other Document</h3>
                  <p className="text-xs text-slate-500">Compare this document against another platform document or a reference template, with AI gap analysis</p>
                </div>
              </div>
              <button
                onClick={() => setShowNcaCompareModal(true)}
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-3.5 py-1.5 text-sm font-medium text-slate-900 hover:bg-primary-700 transition-colors"
              >
                <GitCompare className="h-3.5 w-3.5" />
                Compare with Other Document
              </button>
            </div>
          </div>

          {/* Run Analysis Panel — neutral slate, compact */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3 min-w-0">
                <div className="rounded-lg bg-slate-100 p-2 flex-shrink-0">
                  <Wand2 className="h-5 w-5 text-slate-700" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-900">AI Gap Analysis</h3>
                  <p className="text-xs text-slate-500">Analyze this document against compliance frameworks</p>
                </div>
              </div>
              <button
                onClick={() => setShowGapModal(true)}
                disabled={runGapAnalysisMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-primary-700 transition-colors disabled:opacity-50"
              >
                {runGapAnalysisMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
                Run Gap Analysis
              </button>
            </div>

            {/* In-flight runs — compact 2-column grid; each card is its own framework */}
            {(() => {
              const runs = (gapAnalysisRuns?.runs || gapAnalysisRuns || []) as any[];
              const running = Array.isArray(runs) ? runs.filter((r: any) => r.status === 'running' || r.status === 'queued') : [];
              if (!runGapAnalysisMutation.isPending && running.length === 0) return null;
              return (
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {runGapAnalysisMutation.isPending && running.length === 0 && (
                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 flex items-center gap-2 text-xs text-slate-600">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary-600 flex-shrink-0" />
                      <span>Submitting analysis request…</span>
                    </div>
                  )}
                  {running.map((r: any) => {
                    const total = Number(r.clauses_total || 0);
                    const done = Number(r.clauses_processed || 0);
                    const hasProgress = total > 0;
                    const pct = hasProgress ? Math.min(100, Math.round((done / total) * 100)) : 0;
                    return (
                      <div
                        key={r.id}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2 mb-1.5">
                          <span className="truncate text-xs font-medium text-slate-800" title={r.framework_name || 'Framework'}>
                            {r.framework_name || `Run ${r.id}`}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-1.5 py-0.5 text-[10px] font-medium text-primary-700 flex-shrink-0">
                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
                            {r.status === 'queued' ? 'Queued' : hasProgress ? `${pct}%` : 'Running'}
                          </span>
                        </div>
                        {hasProgress ? (
                          <>
                            <div className="h-1 w-full overflow-hidden rounded-full bg-slate-200">
                              <div
                                className="h-full rounded-full bg-primary-500 transition-all duration-300"
                                style={{ width: `${Math.max(2, pct)}%` }}
                              />
                            </div>
                            <div className="mt-1 text-[10px] text-slate-500">
                              {done}/{total} clauses
                            </div>
                          </>
                        ) : (
                          <div className="h-1 w-full overflow-hidden rounded-full bg-slate-200">
                            <div className="h-full w-1/3 animate-[gap-progress_1.4s_ease-in-out_infinite] rounded-full bg-primary-500" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>

          {/* Compliance Summary */}
          <ComplianceSummarySection summary={complianceSummary} loading={summaryLoading} />

          {/* Gap Findings Table */}
          <div className="rounded-xl border border-slate-300 bg-white overflow-hidden">
            <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-300">
              <h3 className="text-lg font-semibold text-slate-900">Gap Findings & Remediation Tracker</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExportCSV}
                  className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-100 px-3 py-1.5 text-sm text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                >
                  <Download className="h-4 w-4" />
                  Export CSV
                </button>
              </div>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2 p-4 border-b border-slate-300 bg-white/30">
              <MultiSelectDropdown
                title="Framework"
                items={(complianceSummary?.frameworks || complianceSummary?.framework_summaries || []).map((fw: any) => ({
                  value: String(fw.framework_name || fw.name),
                  label: String(fw.framework_name || fw.name),
                }))}
                selectedValues={gapFilters.framework_name ? [gapFilters.framework_name] : []}
                onApply={(v) => setGapFilters(prev => ({ ...prev, framework_name: v[0] || '', skip: 0 }))}
                multiSelect={false}
                autoApply
                placeholder="All Frameworks"
                size="md"
              />
              <MultiSelectDropdown
                title="Compliance"
                items={Object.entries(COMPLIANCE_STATUS_STYLES).map(([val, s]) => ({ value: val, label: s.label }))}
                selectedValues={gapFilters.compliance_status ? [gapFilters.compliance_status] : []}
                onApply={(v) => setGapFilters(prev => ({ ...prev, compliance_status: v[0] || '', skip: 0 }))}
                multiSelect={false}
                autoApply
                placeholder="All Compliance Status"
                size="md"
              />
              <MultiSelectDropdown
                title="Risk Severity"
                items={Object.entries(RISK_SEVERITY_STYLES).map(([val, s]) => ({ value: val, label: s.label }))}
                selectedValues={gapFilters.risk_severity ? [gapFilters.risk_severity] : []}
                onApply={(v) => setGapFilters(prev => ({ ...prev, risk_severity: v[0] || '', skip: 0 }))}
                multiSelect={false}
                autoApply
                placeholder="All Risk Severity"
                size="md"
              />
              <MultiSelectDropdown
                title="Remediation"
                items={Object.entries(REMEDIATION_STATUS_STYLES).map(([val, s]) => ({ value: val, label: s.label }))}
                selectedValues={gapFilters.remediation_status ? [gapFilters.remediation_status] : []}
                onApply={(v) => setGapFilters(prev => ({ ...prev, remediation_status: v[0] || '', skip: 0 }))}
                multiSelect={false}
                autoApply
                placeholder="All Remediation Status"
                size="md"
              />
            </div>

            {findingsLoading ? (
              <div className="flex h-48 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
              </div>
            ) : findings.length === 0 ? (
              <div className="flex h-48 flex-col items-center justify-center gap-3 text-slate-600">
                <BarChart3 className="h-12 w-12" />
                <p>No gap findings yet</p>
                <p className="text-sm">Run a gap analysis to generate findings</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-white">
                      <tr>
                        <th className="w-8 px-2 py-3"></th>
                        <SortHeader field="clause_reference" current={gapFilters.sort_by} order={gapFilters.sort_order} onSort={handleGapSort}>Framework Clause</SortHeader>
                        <SortHeader field="policy_section_reference" current={gapFilters.sort_by} order={gapFilters.sort_order} onSort={handleGapSort}>Policy Ref</SortHeader>
                        <SortHeader field="compliance_status" current={gapFilters.sort_by} order={gapFilters.sort_order} onSort={handleGapSort}>Compliance</SortHeader>
                        <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-600">Gap Description</th>
                        <SortHeader field="risk_severity" current={gapFilters.sort_by} order={gapFilters.sort_order} onSort={handleGapSort}>Risk</SortHeader>
                        <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-600">Recommendation</th>
                        <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-600">Owner</th>
                        <SortHeader field="target_remediation_date" current={gapFilters.sort_by} order={gapFilters.sort_order} onSort={handleGapSort}>Target Date</SortHeader>
                        <SortHeader field="remediation_status" current={gapFilters.sort_by} order={gapFilters.sort_order} onSort={handleGapSort}>Status</SortHeader>
                        <th className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-600">Evidence</th>
                        <SortHeader field="updated_at" current={gapFilters.sort_by} order={gapFilters.sort_order} onSort={handleGapSort}>Updated</SortHeader>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {findings.map((finding: any) => {
                        const isExpanded = expandedRows.has(finding.id);
                        const isEditing = editingRow === finding.id;
                        const cs = COMPLIANCE_STATUS_STYLES[finding.compliance_status] || { bg: 'bg-slate-500/20', text: 'text-slate-600', label: finding.compliance_status };
                        const rs = RISK_SEVERITY_STYLES[finding.risk_severity] || { bg: 'bg-slate-500/20', text: 'text-slate-600', label: finding.risk_severity };
                        const rms = REMEDIATION_STATUS_STYLES[finding.remediation_status] || { bg: 'bg-slate-500/20', text: 'text-slate-600', label: finding.remediation_status };

                        return (
                          <GapFindingRow
                            key={finding.id}
                            finding={finding}
                            isExpanded={isExpanded}
                            isEditing={isEditing}
                            editAction={editAction}
                            cs={cs}
                            rs={rs}
                            rms={rms}
                            onToggleExpand={() => toggleRowExpand(finding.id)}
                            onSetEditAction={(action: string | null) => {
                              setEditingRow(action ? finding.id : null);
                              setEditAction(action);
                            }}
                            tenantUsers={tenantUsers}
                            overrideForm={overrideForm}
                            setOverrideForm={setOverrideForm}
                            acceptRiskForm={acceptRiskForm}
                            setAcceptRiskForm={setAcceptRiskForm}
                            assignOwnerForm={assignOwnerForm}
                            setAssignOwnerForm={setAssignOwnerForm}
                            targetDateForm={targetDateForm}
                            setTargetDateForm={setTargetDateForm}
                            statusUpdateForm={statusUpdateForm}
                            setStatusUpdateForm={setStatusUpdateForm}
                            onUpdateFinding={(findingId: number, data: any) => updateFindingMutation.mutate({ findingId, data })}
                            onOverride={(findingId: number, data: any) => overrideMutation.mutate({ findingId, data })}
                            onAcceptRisk={(findingId: number, data: any) => acceptRiskMutation.mutate({ findingId, data })}
                            onAddressGap={(f: any) => {
                              setAddressGapFinding(f);
                              // Pre-fill with whatever the backend already has
                              // stashed on this finding (could be empty if
                              // the user has never clicked "Generate" before).
                              const mode = (f.replacement_mode === 'replace' || f.replacement_mode === 'append')
                                ? f.replacement_mode
                                : 'append';
                              setAddressGapMode(mode);
                              setAddressGapOriginal(f.original_clause_text || '');
                              setAddressGapDraft(f.suggested_clause_text || '');
                              const heading = [f.framework_name, f.clause_reference, f.clause_title]
                                .filter(Boolean)
                                .join(' — ');
                              setAddressGapHeading(heading);
                              setAddressGapReason('');
                            }}
                            isPending={updateFindingMutation.isPending || overrideMutation.isPending || acceptRiskMutation.isPending}
                          />
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between p-4 border-t border-slate-300">
                    <span className="text-sm text-slate-600">
                      Showing {gapFilters.skip + 1}-{Math.min(gapFilters.skip + gapFilters.limit, totalFindings)} of {totalFindings}
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setGapFilters(prev => ({ ...prev, skip: Math.max(0, prev.skip - prev.limit) }))}
                        disabled={currentPage === 0}
                        className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <span className="text-sm text-slate-700">
                        Page {currentPage + 1} of {totalPages}
                      </span>
                      <button
                        onClick={() => setGapFilters(prev => ({ ...prev, skip: prev.skip + prev.limit }))}
                        disabled={currentPage >= totalPages - 1}
                        className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:text-slate-900 disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {activeTab === 'sign-off' && (
        <SignOffControlTab documentId={id} doc={document} />
      )}

      {activeTab === 'discussion' && (
        <div className="rounded-xl border border-slate-300 bg-white p-4">
          <h3 className="text-sm font-semibold text-slate-900 mb-1">Discussion</h3>
          <p className="text-xs text-slate-500 mb-3">All participants (preparer, reviewers, approvers) can comment here.</p>
          <DocumentAnnotationPanel documentId={id} />
        </div>
      )}

      {activeTab === 'review-history' && (
        <ReviewHistoryTab documentId={id} document={document} />
      )}

      {/* Address-Gap Modal — review/edit the AI-drafted clause text and apply
          it to the document. Two layouts:
            - mode='replace': side-by-side. Left = current text (read-only),
              right = editable proposed replacement.
            - mode='append': single editable proposed-clause area + an
              optional section-heading field.
          On apply, the previous content is snapshotted into a version row
          so the change is auditable. */}
      {addressGapFinding && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-6xl mx-4 max-h-[92vh] flex flex-col rounded-xl border border-slate-300 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-200">
              <div className="min-w-0">
                <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary-700" />
                  Address Gap
                  {addressGapMode === 'replace' && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                      Replacing existing clause
                    </span>
                  )}
                  {addressGapMode === 'append' && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                      Adding new clause
                    </span>
                  )}
                </h3>
                <p className="text-xs text-slate-600 mt-0.5 truncate">
                  {addressGapFinding.framework_name && (
                    <span className="font-medium">{addressGapFinding.framework_name} · </span>
                  )}
                  <span className="font-mono text-slate-700">{addressGapFinding.clause_reference || '—'}</span>
                  {addressGapFinding.clause_title && <> · {addressGapFinding.clause_title}</>}
                </p>
              </div>
              <button
                onClick={() => {
                  setAddressGapFinding(null);
                  setAddressGapMode('append');
                  setAddressGapOriginal('');
                  setAddressGapDraft('');
                  setAddressGapHeading('');
                  setAddressGapReason('');
                }}
                className="p-2 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 flex-shrink-0"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {addressGapFinding.gap_description && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <label className="text-xs font-medium uppercase tracking-wider text-amber-800 block mb-1">Gap</label>
                  <p className="text-sm text-amber-900">{addressGapFinding.gap_description}</p>
                </div>
              )}
              {addressGapFinding.remediation_recommendation && (
                <div className="rounded-lg border border-primary-200 bg-primary-50 p-3">
                  <label className="text-xs font-medium uppercase tracking-wider text-primary-700 block mb-1">AI Remediation Recommendation</label>
                  <p className="text-sm text-slate-900">{addressGapFinding.remediation_recommendation}</p>
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="text-xs text-slate-500">
                  {addressGapMode === 'replace'
                    ? 'AI matched an existing clause in the document. Review the proposed replacement on the right.'
                    : 'AI proposed a new clause to append to the document.'}
                </div>
                <button
                  type="button"
                  onClick={() => generateGapFixMutation.mutate(addressGapFinding.id)}
                  disabled={generateGapFixMutation.isPending}
                  className="flex items-center gap-1.5 rounded-md border border-primary-300 bg-white px-2.5 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50 disabled:opacity-50"
                  title={addressGapDraft ? 'Re-draft with AI' : 'Draft clause text with AI'}
                >
                  {generateGapFixMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  {generateGapFixMutation.isPending
                    ? 'Drafting…'
                    : (addressGapDraft ? 'Re-draft with AI' : 'Generate with AI')}
                </button>
              </div>

              {addressGapMode === 'replace' ? (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-slate-700 block mb-1.5">
                      Current text in document <span className="text-xs font-normal text-slate-500">(read-only)</span>
                    </label>
                    <textarea
                      value={addressGapOriginal}
                      readOnly
                      rows={14}
                      className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 resize-y font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-slate-700 block mb-1.5">
                      Proposed replacement <span className="text-xs font-normal text-slate-500">(editable)</span>
                    </label>
                    <textarea
                      value={addressGapDraft}
                      onChange={(e) => setAddressGapDraft(e.target.value)}
                      rows={14}
                      placeholder='Click "Generate with AI" to draft a replacement, or write your own.'
                      className="w-full rounded-lg border border-emerald-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 resize-y"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="text-sm font-medium text-slate-700 block mb-1.5">
                    Proposed new clause <span className="text-xs font-normal text-slate-500">(editable)</span>
                  </label>
                  <textarea
                    value={addressGapDraft}
                    onChange={(e) => setAddressGapDraft(e.target.value)}
                    rows={12}
                    placeholder='Click "Generate with AI" to draft a clause that closes this gap, or write your own.'
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 resize-y"
                  />
                </div>
              )}

              {addressGapMode === 'append' && (
                <div>
                  <label className="text-sm font-medium text-slate-700 block mb-1.5">
                    Section heading <span className="text-xs font-normal text-slate-500">(optional — defaults to framework + clause)</span>
                  </label>
                  <input
                    type="text"
                    value={addressGapHeading}
                    onChange={(e) => setAddressGapHeading(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    The clause will be appended under <code className="font-mono text-slate-700">## {addressGapHeading || 'Compliance Update'}</code>.
                  </p>
                </div>
              )}

              <div>
                <label className="text-sm font-medium text-slate-700 block mb-1.5">
                  Change reason <span className="text-xs font-normal text-slate-500">(optional — saved to version history)</span>
                </label>
                <input
                  type="text"
                  value={addressGapReason}
                  onChange={(e) => setAddressGapReason(e.target.value)}
                  placeholder='e.g. "Closing PCI-DSS Req 1.2 gap during Q1 audit prep"'
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              </div>

              <p className="text-xs text-slate-500 italic">
                Applying creates a new document version. The current content is preserved in version history before the change.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200">
              <button
                onClick={() => {
                  setAddressGapFinding(null);
                  setAddressGapMode('append');
                  setAddressGapOriginal('');
                  setAddressGapDraft('');
                  setAddressGapHeading('');
                  setAddressGapReason('');
                }}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => applyGapFixMutation.mutate({
                  findingId: addressGapFinding.id,
                  data: {
                    mode: addressGapMode,
                    proposed_text: addressGapDraft,
                    current_text: addressGapMode === 'replace' ? addressGapOriginal : undefined,
                    section_heading: addressGapMode === 'append' ? (addressGapHeading || undefined) : undefined,
                    change_reason: addressGapReason || undefined,
                  },
                })}
                disabled={
                  !addressGapDraft.trim()
                  || applyGapFixMutation.isPending
                  || (addressGapMode === 'replace' && !addressGapOriginal.trim())
                }
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-primary-700 disabled:opacity-50"
              >
                {applyGapFixMutation.isPending ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Applying…</>
                ) : (
                  <><Check className="h-4 w-4" /> {addressGapMode === 'replace' ? 'Save replacement' : 'Append clause'}</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Gap Analysis Framework Selection Modal */}
      {showGapModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-slate-300 bg-white p-6 shadow-2xl mx-4">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Run Gap Analysis</h3>
                <p className="text-sm text-slate-600">Select frameworks to analyze against</p>
              </div>
              <button
                onClick={() => { setShowGapModal(false); setSelectedFrameworkIds([]); setGapFrameworkSearch(''); }}
                className="p-2 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Search box for the framework picker — the previous list
                forced the user to scroll through every uploaded framework
                to find one (~30+ in seeded tenants). Filter applies to
                name, short_code, framework_type, regulator, and version. */}
            {uploadedFrameworks && uploadedFrameworks.length > 0 && (
              <div className="relative mb-3">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={gapFrameworkSearch}
                  onChange={(e) => setGapFrameworkSearch(e.target.value)}
                  placeholder="Search frameworks by name, code, or regulator…"
                  className="w-full rounded-lg border border-slate-300 bg-white pl-9 pr-9 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                />
                {gapFrameworkSearch && (
                  <button
                    onClick={() => setGapFrameworkSearch('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700"
                    title="Clear search"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            )}

            <div className="space-y-3 max-h-64 overflow-y-auto mb-6">
              {!uploadedFrameworks ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin text-primary-400" />
                </div>
              ) : uploadedFrameworks.length === 0 ? (
                <p className="text-sm text-slate-600 text-center py-4">No frameworks uploaded yet</p>
              ) : (() => {
                // Apply the search filter to the framework list. We compute
                // the visible subset here so both the Select-All checkbox
                // and the row count below reflect the current filter.
                const term = gapFrameworkSearch.trim().toLowerCase();
                const visible = term
                  ? (uploadedFrameworks as any[]).filter((fw) => {
                      const haystack = [
                        fw.name,
                        fw.short_code,
                        fw.framework_type,
                        fw.regulator,
                        fw.source_organization,
                        fw.version,
                      ].filter(Boolean).join(' ').toLowerCase();
                      return haystack.includes(term);
                    })
                  : (uploadedFrameworks as any[]);

                if (visible.length === 0) {
                  return (
                    <p className="text-sm text-slate-600 text-center py-4">
                      No frameworks match &ldquo;{gapFrameworkSearch}&rdquo;.
                    </p>
                  );
                }

                const visibleIds = visible.map((fw: any) => fw.id);
                const allVisibleSelected = visibleIds.every((vid: number) => selectedFrameworkIds.includes(vid));
                const handleToggleVisible = () => {
                  if (allVisibleSelected) {
                    // Unselect just the visible ones; keep any selections
                    // outside the current filter so the user doesn't lose
                    // them when narrowing/widening the search.
                    setSelectedFrameworkIds((prev) => prev.filter((pid) => !visibleIds.includes(pid)));
                  } else {
                    setSelectedFrameworkIds((prev) => Array.from(new Set([...prev, ...visibleIds])));
                  }
                };

                return (
                  <>
                    <label className="flex items-center gap-3 rounded-lg border border-slate-300 bg-white p-3 cursor-pointer hover:bg-slate-100 transition-colors">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={handleToggleVisible}
                        className="h-4 w-4 rounded border-slate-300 bg-slate-100 text-primary-500 focus:ring-primary-500"
                      />
                      <span className="font-medium text-slate-900">
                        {term ? `Select all matching (${visible.length})` : `Select All (${uploadedFrameworks.length})`}
                      </span>
                    </label>
                    {visible.map((fw: any) => (
                      <label
                        key={fw.id}
                        className="flex items-center gap-3 rounded-lg border border-slate-300/50 bg-white/50 p-3 cursor-pointer hover:bg-slate-100/50 transition-colors"
                      >
                        <input
                          type="checkbox"
                          checked={selectedFrameworkIds.includes(fw.id)}
                          onChange={() => toggleFramework(fw.id)}
                          className="h-4 w-4 rounded border-slate-300 bg-slate-100 text-primary-500 focus:ring-primary-500"
                        />
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-slate-900">{fw.name || `Framework ${fw.id}`}</span>
                            {(fw.short_code || fw.framework_type) && (
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono text-slate-700">{fw.short_code || fw.framework_type}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-600">
                            {fw.version && <span>v{fw.version}</span>}
                            {(fw.control_count != null || fw.parsed_controls_count != null) && <span>{fw.control_count ?? fw.parsed_controls_count} controls</span>}
                            {(fw.regulator || fw.source_organization) && <span>{fw.regulator || fw.source_organization}</span>}
                          </div>
                        </div>
                      </label>
                    ))}
                  </>
                );
              })()}
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-slate-300">
              <button
                onClick={() => { setShowGapModal(false); setSelectedFrameworkIds([]); setGapFrameworkSearch(''); }}
                className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 rounded-lg hover:bg-white"
              >
                Cancel
              </button>
              <button
                onClick={handleRunAnalysis}
                disabled={runGapAnalysisMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-primary-700 disabled:opacity-50"
              >
                {runGapAnalysisMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
                {selectedFrameworkIds.length === 0 ? 'Run All' : `Run Analysis (${selectedFrameworkIds.length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      <NcaCompareModal
        isOpen={showNcaCompareModal}
        onClose={() => setShowNcaCompareModal(false)}
        documents={allDocumentsForCompare.map(d => ({
          id: d.id,
          title: d.title,
          doc_type: d.doc_type,
        }))}
        initialDocumentId={document?.id ?? null}
      />
    </div>
  );
}

function SortHeader({ field, current, order, onSort, children }: {
  field: string;
  current: string;
  order: string;
  onSort: (f: string) => void;
  children: React.ReactNode;
}) {
  return (
    <th
      className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-600 cursor-pointer hover:text-slate-900 transition-colors"
      onClick={() => onSort(field)}
    >
      <div className="flex items-center gap-1">
        {children}
        <ArrowUpDown className={`h-3 w-3 ${current === field ? 'text-primary-400' : ''}`} />
      </div>
    </th>
  );
}

const REVIEW_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'Pending' },
  in_progress: { bg: 'bg-primary-100', text: 'text-primary-700', label: 'In Progress' },
  completed: { bg: 'bg-green-100', text: 'text-green-700', label: 'Completed' },
  overdue: { bg: 'bg-red-100', text: 'text-red-700', label: 'Overdue' },
};

const OUTCOME_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  no_changes: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'No Changes' },
  minor_update: { bg: 'bg-primary-100', text: 'text-primary-700', label: 'Minor Update' },
  major_revision: { bg: 'bg-orange-100', text: 'text-orange-700', label: 'Major Revision' },
  retired: { bg: 'bg-red-100', text: 'text-red-700', label: 'Retired' },
};

function ReviewHistoryTab({ documentId, document: doc }: { documentId: number; document: any }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showCompleteForm, setShowCompleteForm] = useState(false);
  const [completeForm, setCompleteForm] = useState({ review_notes: '', changes_made: '', outcome: 'no_changes' });

  const { data: reviewHistory, isLoading } = useQuery({
    queryKey: ['review-history', documentId],
    queryFn: async () => {
      const response = await governanceApi.getDocumentReviewHistory(documentId);
      const data = response.data as any;
      return Array.isArray(data) ? data : (data?.items ?? []);
    },
    enabled: !!documentId,
  });

  const startReviewMutation = useMutation({
    mutationFn: () => governanceApi.startDocumentReview(documentId),
    onSuccess: () => {
      toast({ type: 'success', title: 'Review Started', message: 'Periodic review has been initiated.' });
      queryClient.invalidateQueries({ queryKey: ['review-history', documentId] });
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Failed to Start Review', message: error?.response?.data?.detail || 'An error occurred.' });
    },
  });

  const completeReviewMutation = useMutation({
    mutationFn: (data: { review_notes: string; changes_made: string; outcome: string }) =>
      governanceApi.completeDocumentReview(documentId, data),
    onSuccess: () => {
      toast({ type: 'success', title: 'Review Completed', message: 'Review has been completed and next review date updated.' });
      queryClient.invalidateQueries({ queryKey: ['review-history', documentId] });
      queryClient.invalidateQueries({ queryKey: ['governance-document', documentId] });
      setShowCompleteForm(false);
      setCompleteForm({ review_notes: '', changes_made: '', outcome: 'no_changes' });
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Failed to Complete Review', message: error?.response?.data?.detail || 'An error occurred.' });
    },
  });

  const hasInProgressReview = reviewHistory?.some((r: any) => r.review_status === 'in_progress');
  const isOverdue = doc?.next_review_date && new Date(doc.next_review_date) < new Date();

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-300 bg-primary-50 p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary-50 p-2.5">
              <Clock className="h-6 w-6 text-primary-700" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Policy Review Lifecycle</h3>
              <div className="flex items-center gap-3 mt-1">
                {doc?.next_review_date ? (
                  <span className={`text-sm ${isOverdue ? 'text-red-400' : 'text-slate-600'}`}>
                    {isOverdue ? (
                      <span className="flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Overdue — was due {formatDate(doc.next_review_date)}</span>
                    ) : (
                      <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> Next review: {formatDate(doc.next_review_date)}</span>
                    )}
                  </span>
                ) : (
                  <span className="text-sm text-slate-700">No review date scheduled</span>
                )}
                {doc?.review_cycle_months && (
                  <span className="text-xs text-slate-700">({doc.review_cycle_months}-month cycle)</span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!hasInProgressReview && (
              <button
                onClick={() => startReviewMutation.mutate()}
                disabled={startReviewMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-slate-900 hover:bg-primary-700 transition-colors disabled:opacity-50"
              >
                {startReviewMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Start Review
              </button>
            )}
            {hasInProgressReview && (
              <button
                onClick={() => setShowCompleteForm(!showCompleteForm)}
                className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 font-medium text-slate-900 hover:bg-green-700 transition-colors"
              >
                <CheckCircle className="h-4 w-4" />
                Complete Review
              </button>
            )}
          </div>
        </div>

        {showCompleteForm && (
          <div className="mt-4 rounded-lg border border-slate-300 bg-white p-4 space-y-3">
            <h4 className="text-sm font-medium text-slate-900">Complete Review</h4>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Outcome</label>
              <select
                value={completeForm.outcome}
                onChange={(e) => setCompleteForm(prev => ({ ...prev, outcome: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
              >
                <option value="no_changes">No Changes Needed</option>
                <option value="minor_update">Minor Update</option>
                <option value="major_revision">Major Revision</option>
                <option value="retired">Retired</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Review Notes</label>
              <textarea
                value={completeForm.review_notes}
                onChange={(e) => setCompleteForm(prev => ({ ...prev, review_notes: e.target.value }))}
                rows={2}
                placeholder="Notes about the review..."
                className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none resize-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-600 mb-1">Changes Made</label>
              <textarea
                value={completeForm.changes_made}
                onChange={(e) => setCompleteForm(prev => ({ ...prev, changes_made: e.target.value }))}
                rows={2}
                placeholder="Summary of changes made (if any)..."
                className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none resize-none"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => completeReviewMutation.mutate(completeForm)}
                disabled={completeReviewMutation.isPending}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-green-700 disabled:opacity-50"
              >
                {completeReviewMutation.isPending ? 'Submitting...' : 'Submit Review'}
              </button>
              <button
                onClick={() => setShowCompleteForm(false)}
                className="rounded-lg border border-slate-300 bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:text-slate-900 hover:bg-slate-100"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-xl border border-slate-300 bg-white overflow-hidden">
        <div className="border-b border-slate-300 bg-white/50 px-6 py-3">
          <h3 className="font-medium text-slate-900">Review History</h3>
        </div>
        {isLoading ? (
          <PageLoader size="sm" className="h-32" />
        ) : !reviewHistory || reviewHistory.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-slate-600">
            <Clock className="h-8 w-8" />
            <p className="text-sm">No review history yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-300 bg-white/30">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-600">Type</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-600">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-600">Outcome</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-600">Started</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-600">Completed</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-600">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {reviewHistory.map((review: any) => {
                  const statusStyle = REVIEW_STATUS_STYLES[review.review_status] || { bg: 'bg-slate-500/20', text: 'text-slate-600', label: review.review_status };
                  const outcomeStyle = review.outcome ? (OUTCOME_STYLES[review.outcome] || { bg: 'bg-slate-500/20', text: 'text-slate-600', label: review.outcome }) : null;
                  return (
                    <tr key={review.id} className="hover:bg-slate-100/30">
                      <td className="px-4 py-3 text-sm text-slate-700 capitalize">{(review.review_type || 'periodic').replace('_', ' ')}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                          {statusStyle.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {outcomeStyle ? (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${outcomeStyle.bg} ${outcomeStyle.text}`}>
                            {outcomeStyle.label}
                          </span>
                        ) : <span className="text-xs text-slate-700">—</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-600">{formatDate(review.started_at)}</td>
                      <td className="px-4 py-3 text-sm text-slate-600">{formatDate(review.completed_at)}</td>
                      <td className="px-4 py-3 text-sm text-slate-600 max-w-xs truncate">{review.review_notes || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// Document CONTENT version history — timeline + diff + restore, mirroring the
// statement version modal but for the whole document body (item #3a).
function DocumentVersionHistoryPanel({
  documentId, isOpen, onClose, onRestored,
}: { documentId: number; isOpen: boolean; onClose: () => void; onRestored: () => void }) {
  const [compareId, setCompareId] = useState<number | null>(null);
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['document-versions', documentId],
    enabled: isOpen,
    queryFn: async () => {
      const res = await governanceApi.getDocumentVersions(documentId);
      const d: any = res.data;
      return (Array.isArray(d) ? d : d?.items || []) as any[];
    },
  });
  const versions = data || [];
  const currentRow = versions.find((v) => v.status === 'current') || versions[0];

  const diffQuery = useQuery({
    queryKey: ['document-version-diff', documentId, compareId, currentRow?.id],
    enabled: isOpen && !!compareId && !!currentRow?.id && compareId !== currentRow?.id,
    queryFn: async () => (await governanceApi.compareDocumentVersions(compareId as number, currentRow.id)).data as any,
  });

  const rollbackMutation = useMutation({
    mutationFn: async (versionId: number) => governanceApi.rollbackDocumentVersion(documentId, versionId),
    onSuccess: () => { refetch(); onRestored(); },
  });

  const changeColors: Record<string, string> = {
    baseline: 'bg-slate-100 text-slate-600',
    major: 'bg-rose-100 text-rose-700',
    minor: 'bg-primary-100 text-primary-700',
    patch: 'bg-emerald-100 text-emerald-700',
    signoff: 'bg-primary-50 text-primary-700',
  };

  return (
    <RightSlidePanel isOpen={isOpen} onClose={onClose} title="Version History" widthClassName="w-[560px]">
      {isLoading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary-400" /></div>
      ) : versions.length === 0 ? (
        <p className="text-sm text-slate-500 py-6 text-center">No version history yet. Edits to the document content will appear here.</p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">{versions.length} version{versions.length !== 1 ? 's' : ''} · newest first. Restore reverts the content to that version (creating a new version, so nothing is lost).</p>
          {versions.map((v) => {
            const isCurrent = v.id === currentRow?.id;
            return (
              <div key={v.id} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900">v{v.version_number}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${changeColors[v.change_type] || 'bg-slate-100 text-slate-600'}`}>{v.change_type}</span>
                    {isCurrent && <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-medium text-primary-700">current</span>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {!isCurrent && currentRow && (
                      <button onClick={() => setCompareId(compareId === v.id ? null : v.id)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50">
                        <GitCompare className="h-3 w-3" /> {compareId === v.id ? 'Hide diff' : 'Diff'}
                      </button>
                    )}
                    {!isCurrent && (
                      <button onClick={() => rollbackMutation.mutate(v.id)} disabled={rollbackMutation.isPending} className="inline-flex items-center gap-1 rounded-md border border-amber-300 px-2 py-1 text-[11px] text-amber-700 hover:bg-amber-50 disabled:opacity-50">
                        <RotateCcw className="h-3 w-3" /> Restore
                      </button>
                    )}
                  </div>
                </div>
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-slate-500">
                  <User className="h-3 w-3" />{v.creator_name || 'Unknown'}
                  <Clock className="h-3 w-3 ml-1" />{v.created_at ? new Date(v.created_at).toLocaleString() : ''}
                </div>
                {v.change_reason && <p className="mt-1 text-xs text-slate-600 italic">“{v.change_reason}”</p>}
                {compareId === v.id && (
                  <div className="mt-2 rounded-md bg-slate-50 border border-slate-200 p-2">
                    {diffQuery.isLoading ? (
                      <p className="text-[11px] text-slate-400">Computing diff…</p>
                    ) : diffQuery.data ? (
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[11px] font-mono text-slate-700">
                        {(diffQuery.data.diff || diffQuery.data.text_diff || `+${diffQuery.data.additions ?? 0} additions · -${diffQuery.data.deletions ?? 0} deletions`)}
                      </pre>
                    ) : (
                      <p className="text-[11px] text-slate-400">No differences.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </RightSlidePanel>
  );
}

// Sign-off / fill-placeholders panel (item #3b): fill approver name/designation/
// date into the Approval Signoff table and refresh the document-control header,
// applied to the content as a versioned, audited edit.
function DocumentSignoffPanel({
  documentId, isOpen, onClose, onDone,
}: { documentId: number; isOpen: boolean; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<Array<{ role: string; name: string; designation: string; date: string }>>([
    { role: 'Prepared by', name: '', designation: '', date: '' },
    { role: 'Reviewed by', name: '', designation: '', date: '' },
    { role: 'Approved by', name: '', designation: '', date: '' },
  ]);
  const [effectiveDate, setEffectiveDate] = useState('');
  const [version, setVersion] = useState('');
  const [nextReview, setNextReview] = useState('');
  const [markApproved, setMarkApproved] = useState(false);

  const setRow = (i: number, patch: Partial<{ role: string; name: string; designation: string; date: string }>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const mutation = useMutation({
    mutationFn: async () => governanceApi.signoffDocument(documentId, {
      signoffs: rows.filter((r) => r.role.trim() && (r.name.trim() || r.date.trim() || r.designation.trim())),
      effective_date: effectiveDate || undefined,
      version: version || undefined,
      next_review_date: nextReview || undefined,
      mark_approved: markApproved,
    }),
    onSuccess: () => {
      toast({ type: 'success', title: 'Signed off', message: 'Approval details applied to the document (versioned + audited).' });
      onDone();
      onClose();
    },
    onError: () => toast({ type: 'error', title: 'Sign-off failed', message: 'Could not apply the sign-off.' }),
  });

  return (
    <RightSlidePanel isOpen={isOpen} onClose={onClose} title="Sign-off & Document Control" widthClassName="w-[560px]">
      <div className="space-y-5">
        <p className="text-xs text-slate-500">
          Fill in approver details and document-control fields. These replace the placeholders in the
          Approval Signoff and Document Description tables — recorded as a new version in the audit trail.
        </p>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Approval Signoff</p>
          <div className="space-y-3">
            {rows.map((r, i) => (
              <div key={i} className="rounded-lg border border-slate-200 p-3 space-y-2">
                <input
                  value={r.role}
                  onChange={(e) => setRow(i, { role: e.target.value })}
                  placeholder="Role (e.g. Approved by)"
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm font-medium"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} placeholder="Name" className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
                  <input value={r.designation} onChange={(e) => setRow(i, { designation: e.target.value })} placeholder="Designation" className="rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
                </div>
                <input type="date" value={r.date} onChange={(e) => setRow(i, { date: e.target.value })} className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
              </div>
            ))}
            <button
              type="button"
              onClick={() => setRows((prev) => [...prev, { role: '', name: '', designation: '', date: '' }])}
              className="text-xs font-medium text-primary-600 hover:text-primary-700"
            >
              + Add approver row
            </button>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Document Control</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">Effective date</label>
              <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">Version</label>
              <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.1" className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-0.5">Next review</label>
              <input type="date" value={nextReview} onChange={(e) => setNextReview(e.target.value)} className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm" />
            </div>
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs text-slate-700">
            <input type="checkbox" checked={markApproved} onChange={(e) => setMarkApproved(e.target.checked)} className="rounded border-slate-300" />
            Also mark the document as approved (records approver + timestamp)
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
          <button onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />} Apply Sign-off
          </button>
        </div>
      </div>
    </RightSlidePanel>
  );
}

// Document metadata / description / tags — moved off the page into a slide
// panel so the document itself gets the full width. Opened via the "Details"
// button in the content header.
function DocumentDetailsPanel({ doc, docType, isOpen, onClose }: any) {
  return (
    <RightSlidePanel isOpen={isOpen} onClose={onClose} title="Document Details" widthClassName="w-[420px]">
      <div className="space-y-4">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Metadata</h3>
          <div className="space-y-2.5">
            <MetadataRow label="Type" value={docType.label} />
            <MetadataRow label="Classification" value={doc.classification || '-'} />
            <MetadataRow label="Version" value={doc.current_version || '1.0'} />
            <MetadataRow label="Owner" value={doc.owner_name || '-'} />
            <MetadataRow label="Effective Date" value={formatDate(doc.effective_date)} />
            <MetadataRow label="Next Review" value={formatDate(doc.next_review_date)} />
            <MetadataRow label="Review Cycle" value={`${doc.review_cycle_months || 12} months`} />
            {doc.file_name && <MetadataRow label="File" value={doc.file_name} />}
            {doc.file_size && <MetadataRow label="File Size" value={`${(doc.file_size / 1024).toFixed(1)} KB`} />}
          </div>
        </div>
        {doc.description && (
          <div className="border-t border-slate-100 pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Description</h3>
            <p className="text-sm text-slate-700">{doc.description}</p>
          </div>
        )}
        {doc.tags?.length > 0 && (
          <div className="border-t border-slate-100 pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Tags</h3>
            <div className="flex flex-wrap gap-2">
              {doc.tags.map((tag: string) => (
                <span key={tag} className="rounded-full bg-slate-200 px-2.5 py-0.5 text-xs text-slate-900">{tag}</span>
              ))}
            </div>
          </div>
        )}
      </div>
    </RightSlidePanel>
  );
}

function DocumentViewerTab({ document: doc, htmlContent, htmlLoading, docType }: any) {
  // Detect if doc.content is markdown (AI-generated docs always are).
  // Markdown rendering + normalization is delegated to
  // GovernanceDocumentMarkdown — see _src/components/governance/_ for the
  // normalization pipeline (heading-space, GFM table-separator inject,
  // orphan-bullet merge, blank-line collapse). Keeping it in one place is
  // how the doc viewer and the NCA preview stay visually identical.
  const rawContent: string = doc?.content || '';
  const isMarkdown = /^#{1,6}\s|^\*\*|^-\s|^\d+\.\s/m.test(rawContent);
  const renderedHtml = useMemo(() => sanitizeDocumentHtml(htmlContent?.html), [htmlContent?.html]);
  const router = useRouter();
  const { toast } = useToast();

  // Inline content editing + version history (item #3a). Editing is gated to
  // markdown, non-file-backed docs so we never corrupt an HTML/uploaded doc.
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editReason, setEditReason] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [showSignoff, setShowSignoff] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showFullViewer, setShowFullViewer] = useState(false);
  const canEdit = isMarkdown && !doc?.has_file;

  const openEditor = () => { startEdit(); setShowFullViewer(true); };
  const closeFullViewer = () => { setShowFullViewer(false); if (editing) setEditing(false); };

  const saveContentMutation = useMutation({
    mutationFn: async () =>
      governanceApi.editDocumentContent(doc.id, { content: editContent, change_reason: editReason || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['governance-document', doc.id] });
      queryClient.invalidateQueries({ queryKey: ['document-versions', doc.id] });
      setEditing(false);
      setEditReason('');
      toast({ type: 'success', title: 'Saved', message: 'Content updated — a new version was recorded in the audit trail.' });
    },
    onError: () => toast({ type: 'error', title: 'Save failed', message: 'Could not save the document content.' }),
  });

  const startEdit = () => { setEditContent(rawContent); setEditReason(''); setEditing(true); };

  // Pre-compute the set of bullet items that live inside any
  // "Related Documents and References" / "Normative References" / "References"
  // section. The <li> renderer below uses this to decide whether the bullet
  // should sprout a single-click "+ Draft" button.
  const referenceItems = useMemo(() => extractReferenceEntries(rawContent), [rawContent]);

  // Single-click handler — jumps to /governance/documents with prefill query
  // params. The listing page reads these on mount and opens the AI Draft
  // modal pre-populated so the operator stays in the existing draft flow
  // (review AI output, accept, save) without retyping the title.
  //
  // Two UX guarantees baked in:
  //   1. The reference's parent (THIS document) is pre-selected in the
  //      modal's parent-document picker, so the new draft inherits the
  //      hierarchy automatically.
  //   2. If the operator cancels the draft, they land back on THIS document
  //      page at the same scroll offset they left — `aiDraftReturn` carries
  //      the return path and sessionStorage carries the scroll Y so a
  //      session-state hop doesn't lose their place.
  const handleDraftReference = (entry: ReferenceEntry, parentTitle: string) => {
    const params = new URLSearchParams({
      aiDraftTitle: entry.raw,
      aiDraftType: entry.doc_type,
    });
    if (parentTitle) {
      params.set('aiDraftDescription', `Referenced from "${parentTitle}".`);
    }
    if (doc?.id) {
      params.set('aiDraftParentId', String(doc.id));
      const returnPath = `/governance/documents/${doc.id}`;
      params.set('aiDraftReturn', returnPath);
      try {
        sessionStorage.setItem(`gov-doc-scroll-${doc.id}`, String(window.scrollY));
      } catch {
        // sessionStorage can be disabled in private/embedded contexts —
        // we still navigate, the user just loses scroll position.
      }
    }
    // Propagate the parent doc's framework linkage so the new draft
    // inherits the same compliance scope automatically. The listing page
    // parses this back into prefill.framework_ids → AI Draft's
    // multi-select. Operator can still tweak inside the modal.
    const parentFrameworkIds: number[] = Array.isArray((doc as { framework_ids?: number[] } | undefined)?.framework_ids)
      ? ((doc as { framework_ids?: number[] }).framework_ids as number[]).filter((n) => Number.isFinite(n))
      : [];
    if (parentFrameworkIds.length > 0) {
      params.set('aiDraftFrameworkIds', parentFrameworkIds.join(','));
    }
    const frameworkHint = parentFrameworkIds.length > 0
      ? ` Framework${parentFrameworkIds.length === 1 ? '' : 's'} auto-selected from parent.`
      : '';
    toast({
      type: 'info',
      title: 'Opening AI Draft',
      message: `Pre-filling "${entry.raw}" for drafting. Parent set to "${parentTitle}".${frameworkHint}`,
    });
    router.push(`/governance/documents?${params.toString()}`);
  };

  // The read-only document body (markdown / sanitized HTML / empty), rendered
  // both as the collapsed inline preview and inside the full-view popup.
  const renderReadBody = () => (
    htmlLoading ? (
      <div className="flex h-48 items-center justify-center"><PageLoader size="md" /></div>
    ) : isMarkdown ? (
      <GovernanceDocumentMarkdown
        content={rawContent}
        references={referenceItems}
        onDraftReference={handleDraftReference}
        parentTitle={doc?.title || ''}
        cleanReferenceLine={cleanReferenceLine}
      />
    ) : renderedHtml ? (
      <>
        <style dangerouslySetInnerHTML={{ __html: `
          .document-viewer-html, .document-viewer-html * {
            color: #111827 !important; -webkit-text-fill-color: #111827 !important;
            opacity: 1 !important; filter: none !important; mix-blend-mode: normal !important;
            text-shadow: none !important; background: transparent !important;
          }
          .document-viewer-html h1, .document-viewer-html h2, .document-viewer-html h3,
          .document-viewer-html h4, .document-viewer-html h5, .document-viewer-html h6,
          .document-viewer-html strong, .document-viewer-html b {
            color: #000000 !important; -webkit-text-fill-color: #000000 !important; font-weight: 700 !important;
          }
          .document-viewer-html a, .document-viewer-html a * {
            color: #2563eb !important; -webkit-text-fill-color: #2563eb !important;
          }
        `}} />
        <div className="document-viewer-html text-[15px] leading-7 text-slate-900" dangerouslySetInnerHTML={{ __html: renderedHtml }} />
      </>
    ) : (
      <div className="flex h-48 flex-col items-center justify-center gap-3 text-slate-600">
        <FileText className="h-12 w-12" />
        <p>No viewable content available</p>
        {doc.has_file && <p className="text-sm">Download the file to view its contents</p>}
      </div>
    )
  );

  const editorBody = (
    <div className="space-y-3">
      <RichTextEditor value={editContent} onChange={setEditContent} minHeight={460} />
      <div>
        <label className="block text-xs font-medium text-slate-700 mb-1">Change reason <span className="font-normal text-slate-400">(recorded in the audit trail)</span></label>
        <input
          value={editReason}
          onChange={(e) => setEditReason(e.target.value)}
          placeholder="What did you change and why…"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
      </div>
      <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-slate-100 bg-white pt-3">
        <button onClick={() => setEditing(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
        <button
          onClick={() => saveContentMutation.mutate()}
          disabled={saveContentMutation.isPending || editContent === rawContent}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {saveContentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Version
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Full-document popup — scrollable read/edit surface */}
      {showFullViewer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="flex h-[90vh] w-full max-w-5xl flex-col rounded-xl border border-slate-300 bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-5 py-3">
              <h3 className="min-w-0 truncate font-semibold text-slate-900">{doc?.title || 'Document'}</h3>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setShowDetails(true)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"><Info className="h-3.5 w-3.5" /> Details</button>
                <button onClick={() => setShowHistory(true)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"><History className="h-3.5 w-3.5" /> History</button>
                {canEdit && <button onClick={() => setShowSignoff(true)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"><CheckCircle className="h-3.5 w-3.5" /> Sign-off</button>}
                {canEdit && !editing && <button onClick={startEdit} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50"><Pencil className="h-3.5 w-3.5" /> Edit</button>}
                <button onClick={closeFullViewer} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {editing ? editorBody : renderReadBody()}
            </div>
          </div>
        </div>
      )}
      {doc?.id && (
        <DocumentVersionHistoryPanel
          documentId={doc.id}
          isOpen={showHistory}
          onClose={() => setShowHistory(false)}
          onRestored={() => {
            queryClient.invalidateQueries({ queryKey: ['governance-document', doc.id] });
            toast({ type: 'success', title: 'Restored', message: 'Document content restored to the selected version.' });
          }}
        />
      )}
      {doc?.id && (
        <DocumentSignoffPanel
          documentId={doc.id}
          isOpen={showSignoff}
          onClose={() => setShowSignoff(false)}
          onDone={() => {
            queryClient.invalidateQueries({ queryKey: ['governance-document', doc.id] });
            queryClient.invalidateQueries({ queryKey: ['document-versions', doc.id] });
          }}
        />
      )}
      <DocumentDetailsPanel doc={doc} docType={docType} isOpen={showDetails} onClose={() => setShowDetails(false)} />
      <div className="rounded-xl border border-slate-300 bg-white overflow-hidden">
        <div className="border-b border-slate-300 bg-white/50 px-6 py-3 flex items-center justify-between gap-2">
          <h3 className="font-medium text-slate-900">Document Content</h3>
          <div className="flex items-center gap-1.5">
            <button onClick={() => setShowDetails(true)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50">
              <Info className="h-3.5 w-3.5" /> Details
            </button>
            <button onClick={() => setShowHistory(true)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50">
              <History className="h-3.5 w-3.5" /> History
            </button>
            {canEdit && (
              <button onClick={() => setShowSignoff(true)} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50">
                <CheckCircle className="h-3.5 w-3.5" /> Sign-off
              </button>
            )}
            {canEdit && (
              <button onClick={openEditor} className="inline-flex items-center gap-1 rounded-md border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50">
                <Pencil className="h-3.5 w-3.5" /> Edit
              </button>
            )}
            <button onClick={() => setShowFullViewer(true)} className="inline-flex items-center gap-1 rounded-md border border-primary-300 bg-primary-50 px-2.5 py-1 text-xs font-medium text-primary-700 hover:bg-primary-100">
              <Maximize2 className="h-3.5 w-3.5" /> Open full
            </button>
          </div>
        </div>
        {/* Collapsed, non-scrollable preview — click "Open full" for the whole doc. */}
        <div className="p-6">
          <div className="relative max-h-[360px] overflow-hidden">
            {renderReadBody()}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-white to-transparent" />
          </div>
          <div className="mt-2 flex justify-center border-t border-slate-100 pt-3">
            <button
              onClick={() => setShowFullViewer(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Maximize2 className="h-4 w-4" /> Read full document
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-slate-600">{label}</span>
      <span className="text-slate-900 capitalize">{value}</span>
    </div>
  );
}

const CATEGORY_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  security: { bg: 'bg-primary-100', text: 'text-slate-700', border: 'border-primary-300' },
  privacy: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-primary-300' },
  governance: { bg: 'bg-emerald-100', text: 'text-slate-700', border: 'border-emerald-300' },
  compliance: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' },
  operational: { bg: 'bg-orange-100', text: 'text-slate-700', border: 'border-orange-300' },
  risk_management: { bg: 'bg-amber-100', text: 'text-slate-700', border: 'border-amber-300' },
  hr: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300' },
  it: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' },
  financial: { bg: 'bg-yellow-100', text: 'text-slate-700', border: 'border-yellow-300' },
  legal: { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-300' },
  environmental: { bg: 'bg-teal-100', text: 'text-slate-700', border: 'border-teal-300' },
  quality: { bg: 'bg-rose-100', text: 'text-slate-700', border: 'border-rose-300' },
};

const CATEGORY_ABBREVIATIONS: Record<string, string> = { hr: 'HR', it: 'IT' };
function formatCategory(cat: string): string {
  if (CATEGORY_ABBREVIATIONS[cat]) return CATEGORY_ABBREVIATIONS[cat];
  return cat.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function StatementsTab({ statements, statementsLoading, parsePolicyMutation, isParsing, documentId }: any) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const stmts = Array.isArray(statements) ? statements : statements?.statements || [];
  const allCategories = Object.keys(CATEGORY_COLORS);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set(allCategories));
  const [editingStmtId, setEditingStmtId] = useState<number | null>(null);
  const [editStmtForm, setEditStmtForm] = useState({ statement_text: '', statement_summary: '', category: '', priority: '', is_mandatory: false, source_section: '' });
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ statement_text: '', statement_summary: '', category: 'security', priority: 'medium', is_mandatory: true, source_section: '' });
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null);
  const [versionHistoryStmtId, setVersionHistoryStmtId] = useState<number | null>(null);
  const [compareVersions, setCompareVersions] = useState<{a: number, b: number} | null>(null);

  const addMutation = useMutation({
    mutationFn: (data: any) => {
      console.log('[Add Statement] Sending to backend:', data);
      return governanceApi.addStatement(documentId, data);
    },
    onSuccess: (response: any) => {
      console.log('[Add Statement] Success response:', response);
      toast({ type: 'success', title: 'Statement Added' });
      queryClient.invalidateQueries({ queryKey: ['document-policy-statements', documentId] });
      setShowAddForm(false);
      setAddForm({ statement_text: '', statement_summary: '', category: 'security', priority: 'medium', is_mandatory: true, source_section: '' });
    },
    onError: (error: any) => {
      console.error('[Add Statement] Error:', error);
      console.error('[Add Statement] Error details:', error?.response?.data);
      toast({ type: 'error', title: 'Add Failed', message: error?.response?.data?.detail || error?.message || 'Failed to add statement.' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ stmtId, data }: { stmtId: number; data: any }) => governanceApi.updateStatement(documentId, stmtId, data),
    onSuccess: () => {
      toast({ type: 'success', title: 'Statement Updated' });
      queryClient.invalidateQueries({ queryKey: ['document-policy-statements', documentId] });
      queryClient.invalidateQueries({ queryKey: ['statement-versions', documentId] });
      queryClient.invalidateQueries({ queryKey: ['statement-diff', documentId] });
      setEditingStmtId(null);
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Update Failed', message: error?.response?.data?.detail || 'Failed to update statement.' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (stmtId: number) => governanceApi.deleteStatement(documentId, stmtId),
    onSuccess: () => {
      toast({ type: 'success', title: 'Statement Deleted' });
      queryClient.invalidateQueries({ queryKey: ['document-policy-statements', documentId] });
      setDeleteConfirm(null);
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Delete Failed', message: error?.response?.data?.detail || 'Failed to delete statement.' });
    },
  });

  const { data: versionData, isLoading: versionsLoading } = useQuery({
    queryKey: ['statement-versions', documentId, versionHistoryStmtId],
    queryFn: async () => {
      const res = await governanceApi.getStatementVersions(documentId, versionHistoryStmtId!);
      return res.data;
    },
    enabled: !!versionHistoryStmtId,
  });

  const { data: diffData } = useQuery({
    queryKey: ['statement-diff', documentId, versionHistoryStmtId, compareVersions],
    queryFn: async () => {
      const res = await governanceApi.getStatementDiff(documentId, versionHistoryStmtId!, compareVersions!.a, compareVersions!.b);
      return res.data;
    },
    enabled: !!versionHistoryStmtId && !!compareVersions,
  });

  const rollbackMutation = useMutation({
    mutationFn: ({ stmtId, versionId }: { stmtId: number; versionId: number }) =>
      governanceApi.rollbackStatement(documentId, stmtId, versionId),
    onSuccess: () => {
      toast({ type: 'success', title: 'Rolled Back', message: 'Statement restored to selected version' });
      queryClient.invalidateQueries({ queryKey: ['document-policy-statements', documentId] });
      queryClient.invalidateQueries({ queryKey: ['statement-versions', documentId, versionHistoryStmtId] });
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Rollback Failed', message: error?.response?.data?.detail || 'Failed to rollback' });
    },
  });

  const { data: parseStatus } = useQuery({
    queryKey: ['parse-status', documentId],
    queryFn: async () => {
      const res = await governanceApi.getParseStatus(documentId);
      return res.data as any;
    },
    enabled: !!documentId,
    // Poll while parsing is in flight so the progress bar advances. Stop
    // polling once the run is terminal so we don't burn CPU on idle pages.
    refetchInterval: (query) => {
      const s = (query.state.data as any)?.status;
      return s === 'parsing' || s === 'queued' ? 2000 : false;
    },
  });

  const { data: proposalsData } = useQuery({
    queryKey: ['reparse-proposals', documentId],
    queryFn: async () => {
      const res = await governanceApi.getReparseProposals(documentId);
      return res.data;
    },
    enabled: !!parseStatus?.has_proposals || parseStatus?.status === 'review_required',
  });

  const applyProposalsMutation = useMutation({
    mutationFn: (decisions: Array<{index: number, action: string}>) =>
      governanceApi.applyReparseProposals(documentId, decisions),
    onSuccess: (res: any) => {
      toast({ type: 'success', title: 'Proposals Applied', message: res.data?.message || 'Changes applied successfully' });
      queryClient.invalidateQueries({ queryKey: ['document-policy-statements', documentId] });
      queryClient.invalidateQueries({ queryKey: ['reparse-proposals', documentId] });
      queryClient.invalidateQueries({ queryKey: ['parse-status', documentId] });
    },
    onError: (error: any) => {
      toast({ type: 'error', title: 'Apply Failed', message: error?.response?.data?.detail || 'Failed to apply proposals' });
    },
  });

  const grouped = useMemo(() => {
    const groups: Record<string, any[]> = {};
    stmts.forEach((stmt: any) => {
      const cat = stmt.category || 'uncategorized';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(stmt);
    });
    return groups;
  }, [stmts]);

  const toggleCategory = (cat: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  };

  const startEdit = (stmt: any) => {
    setEditingStmtId(stmt.id);
    setEditStmtForm({
      statement_text: stmt.statement_text || '',
      statement_summary: stmt.statement_summary || '',
      category: stmt.category || 'security',
      priority: stmt.priority || 'medium',
      is_mandatory: stmt.is_mandatory ?? true,
      source_section: stmt.source_section || '',
    });
  };

  if (statementsLoading) {
    return (
      <div className="flex h-48 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (stmts.length === 0) {
    return (
      <div className="space-y-4">
        {showAddForm && (
          <div className="rounded-xl border border-green-500/30 bg-white p-5">
            <h4 className="text-sm font-semibold text-green-400 mb-3 flex items-center gap-2">
              <Plus className="h-4 w-4" /> Add New Statement
            </h4>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Statement Text *</label>
                <textarea
                  value={addForm.statement_text}
                  onChange={(e) => setAddForm(prev => ({ ...prev, statement_text: e.target.value }))}
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
                  placeholder="Enter the policy statement text..."
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Summary</label>
                <input
                  type="text"
                  value={addForm.statement_summary}
                  onChange={(e) => setAddForm(prev => ({ ...prev, statement_summary: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
                  placeholder="Brief summary..."
                />
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
                  <select
                    value={addForm.category}
                    onChange={(e) => setAddForm(prev => ({ ...prev, category: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
                  >
                    {Object.keys(CATEGORY_COLORS).map(c => (
                      <option key={c} value={c}>{formatCategory(c)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Priority</label>
                  <select
                    value={addForm.priority}
                    onChange={(e) => setAddForm(prev => ({ ...prev, priority: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
                  >
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Source Section</label>
                  <input
                    type="text"
                    value={addForm.source_section}
                    onChange={(e) => setAddForm(prev => ({ ...prev, source_section: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
                    placeholder="e.g. Section 4.1"
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer pb-2">
                    <input
                      type="checkbox"
                      checked={addForm.is_mandatory}
                      onChange={(e) => setAddForm(prev => ({ ...prev, is_mandatory: e.target.checked }))}
                      className="h-4 w-4 rounded border-slate-300 bg-slate-100 text-primary-500"
                    />
                    <span className="text-sm text-slate-700">Mandatory</span>
                  </label>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-300">
                <button
                  onClick={() => setShowAddForm(false)}
                  className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    console.log('[Add Statement Button] Clicked - Form data:', addForm);
                    addMutation.mutate(addForm);
                  }}
                  disabled={addMutation.isPending || !addForm.statement_text.trim()}
                  className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-1.5 text-sm font-medium text-slate-900 hover:bg-green-700 disabled:opacity-50"
                >
                  {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Add Statement
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-xl border border-slate-300 bg-white p-8 text-center">
          <ClipboardList className="h-12 w-12 text-slate-700 mx-auto mb-3" />
          <p className="text-slate-600 mb-4">No policy statements have been parsed yet</p>
          <div className="flex items-center gap-3 justify-center">
            <button
              onClick={() => parsePolicyMutation.mutate()}
              disabled={parsePolicyMutation.isPending || isParsing}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {(parsePolicyMutation.isPending || isParsing) ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wand2 className="h-4 w-4" />
              )}
              {isParsing ? 'Parsing in background…' : 'Parse Policy Statements'}
            </button>
            <button
              onClick={() => setShowAddForm(true)}
              className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-100 px-4 py-2 font-medium text-slate-900 hover:bg-slate-100"
            >
              <Plus className="h-4 w-4" />
              Add Manually
            </button>
          </div>
          {/* Live parse progress bar */}
          {(isParsing || parseStatus?.status === 'parsing' || parseStatus?.status === 'queued') && (
            <div className="mx-auto mt-4 max-w-md">
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="text-slate-600">
                  {parseStatus?.status === 'queued'
                    ? 'Queued — waiting for worker'
                    : parseStatus?.message || 'Parsing'}
                </span>
                <span className="font-medium text-slate-700">
                  {typeof parseStatus?.progress_percent === 'number' ? `${parseStatus.progress_percent}%` : ''}
                </span>
              </div>
              <div className="h-1 w-full overflow-hidden rounded-full bg-slate-200">
                {typeof parseStatus?.progress_percent === 'number' && parseStatus.progress_percent > 0 ? (
                  <div
                    className="h-full rounded-full bg-primary-500 transition-all"
                    style={{ width: `${Math.min(100, Math.max(2, parseStatus.progress_percent))}%` }}
                  />
                ) : (
                  <div className="h-full w-1/3 animate-[gap-progress_1.4s_ease-in-out_infinite] rounded-full bg-primary-500" />
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const categoryKeys = Object.keys(grouped);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="text-lg font-semibold text-slate-900">{stmts.length} Policy Statement{stmts.length !== 1 ? 's' : ''}</h3>
          <div className="flex items-center gap-1.5 flex-wrap">
            {categoryKeys.map(cat => {
              const colors = CATEGORY_COLORS[cat] || { bg: 'bg-slate-500/20', text: 'text-slate-600', border: 'border-slate-500/30' };
              return (
                <span key={cat} className={`rounded-full px-2 py-0.5 text-xs font-medium ${colors.bg} ${colors.text}`}>
                  {formatCategory(cat)}: {grouped[cat].length}
                </span>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              try {
                const response = await governanceApi.exportPolicyStatements(documentId);
                const blob = new Blob([response.data], { type: 'text/csv' });
                const url = window.URL.createObjectURL(blob);
                const a = window.document.createElement('a');
                a.href = url;
                a.download = `policy_statements_${documentId}_${new Date().toISOString().slice(0, 10)}.csv`;
                window.document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                window.document.body.removeChild(a);
              } catch (e) { console.error('Export failed:', e); }
            }}
            className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-100 px-3 py-1.5 text-sm text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          >
            <Download className="h-4 w-4" />
            Export Statements (CSV)
          </button>
          <button
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-2 rounded-lg border border-green-500/50 bg-green-500/10 px-3 py-1.5 text-sm text-green-400 hover:bg-green-500/20"
          >
            <Plus className="h-4 w-4" />
            Add Statement
          </button>
          <button
            onClick={() => parsePolicyMutation.mutate()}
            disabled={parsePolicyMutation.isPending || isParsing}
            className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            {(parsePolicyMutation.isPending || isParsing) ? <Loader2 className="h-4 w-4 animate-spin text-primary-600" /> : <Wand2 className="h-4 w-4" />}
            {isParsing ? 'Parsing…' : 'Re-parse All'}
          </button>
        </div>
      </div>

      {/* Live re-parse progress bar — same shape as the empty-state one */}
      {(isParsing || parseStatus?.status === 'parsing' || parseStatus?.status === 'queued') && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="truncate text-slate-700">
              {parseStatus?.status === 'queued'
                ? 'Queued — waiting for worker'
                : parseStatus?.message || 'Re-parsing policy statements'}
            </span>
            <span className="font-medium text-slate-700 ml-2 flex-shrink-0">
              {typeof parseStatus?.progress_percent === 'number' ? `${parseStatus.progress_percent}%` : ''}
            </span>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-slate-200">
            {typeof parseStatus?.progress_percent === 'number' && parseStatus.progress_percent > 0 ? (
              <div
                className="h-full rounded-full bg-primary-500 transition-all"
                style={{ width: `${Math.min(100, Math.max(2, parseStatus.progress_percent))}%` }}
              />
            ) : (
              <div className="h-full w-1/3 animate-[gap-progress_1.4s_ease-in-out_infinite] rounded-full bg-primary-500" />
            )}
          </div>
        </div>
      )}

      {showAddForm && (
        <div className="rounded-xl border border-green-500/30 bg-white p-5">
          <h4 className="text-sm font-semibold text-green-400 mb-3 flex items-center gap-2">
            <Plus className="h-4 w-4" /> Add New Statement
          </h4>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Statement Text *</label>
              <textarea
                value={addForm.statement_text}
                onChange={(e) => setAddForm(prev => ({ ...prev, statement_text: e.target.value }))}
                rows={3}
                className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
                placeholder="Enter the policy statement text..."
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Summary</label>
              <input
                type="text"
                value={addForm.statement_summary}
                onChange={(e) => setAddForm(prev => ({ ...prev, statement_summary: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
                placeholder="Brief summary..."
              />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
                <select
                  value={addForm.category}
                  onChange={(e) => setAddForm(prev => ({ ...prev, category: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
                >
                  {Object.keys(CATEGORY_COLORS).map(c => (
                    <option key={c} value={c}>{formatCategory(c)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Priority</label>
                <select
                  value={addForm.priority}
                  onChange={(e) => setAddForm(prev => ({ ...prev, priority: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
                >
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Source Section</label>
                <input
                  type="text"
                  value={addForm.source_section}
                  onChange={(e) => setAddForm(prev => ({ ...prev, source_section: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
                  placeholder="e.g. Section 4.1"
                />
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 cursor-pointer pb-2">
                  <input
                    type="checkbox"
                    checked={addForm.is_mandatory}
                    onChange={(e) => setAddForm(prev => ({ ...prev, is_mandatory: e.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300 bg-slate-100 text-primary-500"
                  />
                  <span className="text-sm text-slate-700">Mandatory</span>
                </label>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-300">
              <button
                onClick={() => setShowAddForm(false)}
                className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  console.log('[Add Statement Button] Clicked - Form data:', addForm);
                  addMutation.mutate(addForm);
                }}
                disabled={addMutation.isPending || !addForm.statement_text.trim()}
                className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-1.5 text-sm font-medium text-slate-900 hover:bg-green-700 disabled:opacity-50"
              >
                {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Add Statement
              </button>
            </div>
          </div>
        </div>
      )}

      {proposalsData?.proposals?.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              <div>
                <h4 className="text-sm font-semibold text-amber-400">Re-parse Review Required</h4>
                <p className="text-xs text-slate-600 mt-0.5">{proposalsData.total} proposed changes ({proposalsData.update_count} updates, {proposalsData.new_count} new)</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const decisions = proposalsData.proposals.map((_: any, i: number) => ({ index: i, action: 'accept' }));
                  applyProposalsMutation.mutate(decisions);
                }}
                disabled={applyProposalsMutation.isPending}
                className="flex items-center gap-1 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-green-700 disabled:opacity-50"
              >
                <Check className="h-3 w-3" /> Accept All
              </button>
              <button
                onClick={() => {
                  const decisions = proposalsData.proposals.map((_: any, i: number) => ({ index: i, action: 'reject' }));
                  applyProposalsMutation.mutate(decisions);
                }}
                disabled={applyProposalsMutation.isPending}
                className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-slate-900 hover:bg-red-700 disabled:opacity-50"
              >
                <X className="h-3 w-3" /> Reject All
              </button>
            </div>
          </div>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {proposalsData.proposals.filter((p: any) => p.status === 'pending').map((proposal: any, idx: number) => (
              <div key={idx} className="rounded-lg border border-slate-300 bg-white p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-xs font-medium ${proposal.type === 'update' ? 'bg-amber-500/20 text-amber-400' : 'bg-green-500/20 text-green-400'}`}>
                      {proposal.type === 'update' ? 'Update Existing' : 'New Statement'}
                    </span>
                    {proposal.similarity_score > 0 && (
                      <span className="text-xs text-slate-700">{Math.round(proposal.similarity_score * 100)}% match</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => applyProposalsMutation.mutate([{ index: proposal.index, action: 'accept' }])}
                      disabled={applyProposalsMutation.isPending}
                      className="p-1.5 text-green-400 hover:bg-green-500/20 rounded-lg transition-colors"
                      title="Accept"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => applyProposalsMutation.mutate([{ index: proposal.index, action: 'reject' }])}
                      disabled={applyProposalsMutation.isPending}
                      className="p-1.5 text-red-400 hover:bg-red-500/20 rounded-lg transition-colors"
                      title="Reject"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                {proposal.type === 'update' && proposal.existing_text && (
                  <div className="grid grid-cols-2 gap-3 mb-2">
                    <div className="rounded bg-red-500/5 border border-red-500/20 p-2">
                      <span className="text-xs text-red-400 font-medium">Current</span>
                      <p className="text-xs text-slate-600 mt-1 line-clamp-3">{proposal.existing_text}</p>
                    </div>
                    <div className="rounded bg-green-500/5 border border-green-500/20 p-2">
                      <span className="text-xs text-green-400 font-medium">Proposed</span>
                      <p className="text-xs text-slate-600 mt-1 line-clamp-3">{proposal.new_statement?.statement_text}</p>
                    </div>
                  </div>
                )}
                {proposal.type === 'new' && (
                  <p className="text-xs text-slate-600 line-clamp-3">{proposal.new_statement?.statement_text}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {categoryKeys.map(cat => {
        const colors = CATEGORY_COLORS[cat] || { bg: 'bg-slate-500/20', text: 'text-slate-600', border: 'border-slate-500/30' };
        const isExpanded = expandedCategories.has(cat);
        const catStmts = grouped[cat];

        return (
          <div key={cat} className={`rounded-xl border ${colors.border} bg-white overflow-hidden`}>
            <button
              onClick={() => toggleCategory(cat)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-100/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${colors.bg} ${colors.text}`}>
                  {formatCategory(cat)}
                </span>
                <span className="text-sm text-slate-700">{catStmts.length} statement{catStmts.length !== 1 ? 's' : ''}</span>
              </div>
              {isExpanded ? <ChevronUp className="h-4 w-4 text-slate-600" /> : <ChevronDown className="h-4 w-4 text-slate-600" />}
            </button>

            {isExpanded && (
              <div className="border-t border-slate-300 divide-y divide-slate-200">
                {catStmts.map((stmt: any, idx: number) => {
                  const isEditingThis = editingStmtId === stmt.id;
                  const isDeleting = deleteConfirm === stmt.id;

                  return (
                    <div key={stmt.id || idx} className="p-4 hover:bg-white/80 transition-colors">
                      {isEditingThis ? (
                        <div className="space-y-3">
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">Statement Text</label>
                            <textarea
                              value={editStmtForm.statement_text}
                              onChange={(e) => setEditStmtForm(prev => ({ ...prev, statement_text: e.target.value }))}
                              rows={3}
                              className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-slate-600 mb-1">Summary</label>
                            <input
                              type="text"
                              value={editStmtForm.statement_summary}
                              onChange={(e) => setEditStmtForm(prev => ({ ...prev, statement_summary: e.target.value }))}
                              className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
                            />
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
                              <select
                                value={editStmtForm.category}
                                onChange={(e) => setEditStmtForm(prev => ({ ...prev, category: e.target.value }))}
                                className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
                              >
                                {Object.keys(CATEGORY_COLORS).map(c => (
                                  <option key={c} value={c}>{formatCategory(c)}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">Priority</label>
                              <select
                                value={editStmtForm.priority}
                                onChange={(e) => setEditStmtForm(prev => ({ ...prev, priority: e.target.value }))}
                                className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
                              >
                                <option value="critical">Critical</option>
                                <option value="high">High</option>
                                <option value="medium">Medium</option>
                                <option value="low">Low</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-600 mb-1">Source Section</label>
                              <input
                                type="text"
                                value={editStmtForm.source_section}
                                onChange={(e) => setEditStmtForm(prev => ({ ...prev, source_section: e.target.value }))}
                                className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
                              />
                            </div>
                            <div className="flex items-end">
                              <label className="flex items-center gap-2 cursor-pointer pb-2">
                                <input
                                  type="checkbox"
                                  checked={editStmtForm.is_mandatory}
                                  onChange={(e) => setEditStmtForm(prev => ({ ...prev, is_mandatory: e.target.checked }))}
                                  className="h-4 w-4 rounded border-slate-300 bg-slate-100 text-primary-500"
                                />
                                <span className="text-sm text-slate-700">Mandatory</span>
                              </label>
                            </div>
                          </div>
                          <div className="flex justify-end gap-2 pt-2">
                            <button onClick={() => setEditingStmtId(null)} className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100">Cancel</button>
                            <button
                              onClick={() => updateMutation.mutate({ stmtId: stmt.id, data: editStmtForm })}
                              disabled={updateMutation.isPending}
                              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-slate-900 hover:bg-primary-700 disabled:opacity-50"
                            >
                              {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                              Save
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              {stmt.statement_code && (
                                <span className="rounded bg-primary-50 px-2 py-0.5 text-xs font-mono text-primary-400">
                                  {stmt.statement_code}
                                </span>
                              )}
                              {stmt.source_section && (
                                <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                                  {stmt.source_section}
                                </span>
                              )}
                              {stmt.is_mandatory && (
                                <span className="rounded bg-red-500/15 px-2 py-0.5 text-xs text-red-400">mandatory</span>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              {stmt.priority && (
                                <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                                  stmt.priority === 'critical' ? 'bg-red-500/20 text-red-400' :
                                  stmt.priority === 'high' ? 'bg-orange-500/20 text-orange-400' :
                                  stmt.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                                  'bg-green-500/20 text-green-400'
                                }`}>
                                  {stmt.priority}
                                </span>
                              )}
                              {(stmt.ai_confidence != null || stmt.confidence_score != null) && (
                                <span className="text-xs text-slate-600">
                                  {Math.round((stmt.ai_confidence ?? stmt.confidence_score) * 100)}% confidence
                                </span>
                              )}
                              <button
                                onClick={() => setVersionHistoryStmtId(stmt.id)}
                                className="p-1 text-slate-700 hover:text-primary-700 rounded hover:bg-slate-100 transition-colors"
                                title="Version history"
                              >
                                <History className="h-3.5 w-3.5" />
                              </button>
                              <button
                                onClick={() => startEdit(stmt)}
                                className="p-1 text-slate-700 hover:text-primary-700 rounded hover:bg-slate-100 transition-colors"
                                title="Edit statement"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              {isDeleting ? (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => deleteMutation.mutate(stmt.id)}
                                    disabled={deleteMutation.isPending}
                                    className="px-2 py-0.5 text-xs bg-red-600 text-slate-900 rounded hover:bg-red-700 disabled:opacity-50"
                                  >
                                    {deleteMutation.isPending ? '...' : 'Confirm'}
                                  </button>
                                  <button
                                    onClick={() => setDeleteConfirm(null)}
                                    className="px-2 py-0.5 text-xs text-slate-600 rounded hover:bg-slate-100"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setDeleteConfirm(stmt.id)}
                                  className="p-1 text-slate-700 hover:text-red-400 rounded hover:bg-slate-100 transition-colors"
                                  title="Delete statement"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                          <p className="text-sm text-slate-700">{stmt.statement_text || stmt.text}</p>
                          {stmt.statement_summary && (
                            <p className="text-xs text-slate-700 mt-1 italic">{stmt.statement_summary}</p>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {versionHistoryStmtId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-4xl max-h-[85vh] overflow-y-auto rounded-2xl border border-slate-300 bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-300 bg-white px-6 py-4">
              <div className="flex items-center gap-3">
                <History className="h-5 w-5 text-primary-700" />
                <h3 className="text-lg font-semibold text-slate-900">Version History</h3>
                {versionData?.total_versions != null && (
                  <span className="rounded-full bg-primary-50 px-2.5 py-0.5 text-xs font-medium text-primary-700">
                    {versionData.total_versions} version{versionData.total_versions !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
              <button onClick={() => { setVersionHistoryStmtId(null); setCompareVersions(null); }} className="p-1.5 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {versionsLoading ? (
                <div className="flex h-32 items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-primary-700" />
                </div>
              ) : versionData?.versions?.length > 0 ? (
                <>
                  <div className="space-y-3">
                    {versionData.versions.map((v: any, idx: number) => {
                      const isLatest = idx === 0;
                      const changeColors: Record<string, string> = {
                        initial_parse: 'bg-primary-50 text-primary-700',
                        manual_edit: 'bg-primary-50 text-primary-700',
                        ai_reparse: 'bg-amber-500/20 text-amber-400',
                        rollback: 'bg-slate-100 text-slate-600',
                        manual_add: 'bg-green-500/20 text-green-400',
                      };
                      return (
                        <div key={v.id} className={`rounded-xl border ${isLatest ? 'border-primary-200 bg-primary-50' : 'border-slate-300 bg-white'} p-4`}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-700">v{v.version_number}</span>
                              <span className={`rounded px-2 py-0.5 text-xs font-medium ${changeColors[v.change_type] || 'bg-slate-500/20 text-slate-600'}`}>
                                {v.change_type?.replace(/_/g, ' ')}
                              </span>
                              {isLatest && <span className="rounded bg-green-500/20 px-2 py-0.5 text-xs text-green-400">current</span>}
                            </div>
                            <div className="flex items-center gap-2">
                              {!isLatest && (
                                <>
                                  <button
                                    onClick={() => setCompareVersions({ a: v.id, b: versionData.versions[0].id })}
                                    className="flex items-center gap-1 rounded-lg border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs text-slate-700 hover:text-slate-900 hover:bg-slate-100"
                                  >
                                    <GitCompare className="h-3 w-3" />
                                    Compare
                                  </button>
                                  <button
                                    onClick={() => rollbackMutation.mutate({ stmtId: versionHistoryStmtId, versionId: v.id })}
                                    disabled={rollbackMutation.isPending}
                                    className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                                  >
                                    <RotateCcw className="h-3 w-3" />
                                    {rollbackMutation.isPending ? 'Rolling back...' : 'Rollback'}
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                          <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">{v.statement_text}</p>
                          <div className="flex items-center gap-3 mt-2 text-xs text-slate-700">
                            {v.changed_by_name && <span className="flex items-center gap-1"><User className="h-3 w-3" /> {v.changed_by_name}</span>}
                            {v.changed_at && <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {new Date(v.changed_at).toLocaleString()}</span>}
                            {v.change_reason && <span className="italic">&quot;{v.change_reason}&quot;</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {compareVersions && diffData && (
                    <div className="mt-6 rounded-xl border border-primary-200 bg-white p-5">
                      <h4 className="text-sm font-semibold text-primary-700 mb-3 flex items-center gap-2">
                        <GitCompare className="h-4 w-4" />
                        Version Comparison
                      </h4>
                      {diffData.field_changes?.length > 0 ? (
                        <div className="space-y-2">
                          {diffData.field_changes.map((change: any, i: number) => (
                            <div key={i} className="rounded-lg border border-slate-300 bg-white p-3">
                              <span className="text-xs font-semibold text-slate-600 uppercase">{change.field.replace(/_/g, ' ')}</span>
                              <div className="grid grid-cols-2 gap-3 mt-1">
                                <div className="rounded bg-red-500/10 border border-red-500/20 p-2">
                                  <span className="text-xs text-red-400">v{diffData.version_a.version_number}</span>
                                  <p className="text-sm text-slate-700 mt-1 whitespace-pre-wrap break-words">{change.version_a_value || '(empty)'}</p>
                                </div>
                                <div className="rounded bg-green-500/10 border border-green-500/20 p-2">
                                  <span className="text-xs text-green-400">v{diffData.version_b.version_number}</span>
                                  <p className="text-sm text-slate-700 mt-1 whitespace-pre-wrap break-words">{change.version_b_value || '(empty)'}</p>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-600">No differences found between these versions.</p>
                      )}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-slate-600 text-center py-8">No version history available for this statement.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Control coverage of the document against its applicable frameworks —
// mapped / recommended / MISSING (gap) controls per framework (feature #6).
function ControlCoveragePanel({ documentId }: { documentId: number }) {
  const [openFw, setOpenFw] = useState<number | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['doc-coverage', documentId],
    queryFn: async () => (await governanceApi.getDocumentCoverage(documentId)).data as {
      frameworks: Array<{
        framework_id: number; framework_name: string; total_controls: number;
        mapped_count: number; missing_count: number; coverage_pct: number;
        missing_controls: Array<{ id: number; reference: string; title: string; domain: string | null }>;
      }>;
      recommended_controls: any[];
      totals: { mapped: number; recommended: number; missing: number; frameworks: number };
    },
  });

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Computing framework control coverage…
      </div>
    );
  }
  const frameworks = data?.frameworks || [];
  const recommended = data?.recommended_controls || [];
  if (frameworks.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-600">
        <p className="font-medium text-slate-700 mb-0.5">No applicable frameworks set</p>
        Edit this document and pick its <span className="font-medium">Applicable Frameworks</span> to see which
        of their controls this document covers — and which are missing (the audit gap).
      </div>
    );
  }

  const barColor = (pct: number) => (pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444');

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 text-primary-500" />
        <h3 className="text-sm font-semibold text-slate-900">Framework Control Coverage</h3>
        <span className="text-xs text-slate-500">
          {data?.totals.mapped ?? 0} mapped · {data?.totals.missing ?? 0} missing across {frameworks.length} framework{frameworks.length !== 1 ? 's' : ''}
        </span>
      </div>
      {frameworks.map((fw) => {
        const isOpen = openFw === fw.framework_id;
        return (
          <div key={fw.framework_id} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <button
              type="button"
              onClick={() => setOpenFw(isOpen ? null : fw.framework_id)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
            >
              <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900 truncate">{fw.framework_name}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-1.5 flex-1 max-w-[220px] rounded-full bg-slate-100 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${fw.coverage_pct}%`, backgroundColor: barColor(fw.coverage_pct) }} />
                  </div>
                  <span className="text-xs font-medium" style={{ color: barColor(fw.coverage_pct) }}>{fw.coverage_pct}%</span>
                </div>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-emerald-600 font-medium">{fw.mapped_count} mapped</span>
                <span className={`font-medium ${fw.missing_count > 0 ? 'text-rose-600' : 'text-slate-400'}`}>{fw.missing_count} missing</span>
              </div>
            </button>
            {isOpen && (
              <div className="border-t border-slate-100 px-4 py-3">
                {fw.missing_controls.length === 0 ? (
                  <p className="text-xs text-emerald-700 flex items-center gap-1">
                    <CheckCircle className="h-3.5 w-3.5" /> Every control of this framework is covered by a statement in this document.
                  </p>
                ) : (
                  <>
                    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-rose-600 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" /> {fw.missing_count} control{fw.missing_count !== 1 ? 's' : ''} not covered by this document
                    </p>
                    <div className="max-h-64 overflow-y-auto space-y-1.5">
                      {fw.missing_controls.map((c) => (
                        <div key={c.id} className="flex items-start gap-2 rounded-md bg-rose-50/60 border border-rose-100 px-2.5 py-1.5">
                          <span className="font-mono text-[10px] text-rose-600 mt-0.5 shrink-0">{c.reference}</span>
                          <div className="min-w-0">
                            <p className="text-xs text-slate-700 truncate">{c.title}</p>
                            {c.domain && <p className="text-[10px] text-slate-400">{c.domain}</p>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      {recommended.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs font-semibold text-slate-700 mb-2">{recommended.length} AI-recommended control{recommended.length !== 1 ? 's' : ''} (not yet confirmed)</p>
          <div className="flex flex-wrap gap-1.5">
            {recommended.slice(0, 24).map((r: any, i: number) => (
              <span key={i} className="inline-flex items-center gap-1 rounded-full border border-primary-200 bg-primary-50 px-2 py-0.5 text-[11px] text-primary-700" title={r.control_title || ''}>
                {r.clause_reference || r.control_code}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ControlsTab({ documentId }: any) {
  // Coverage/gap panel + the full Policy-Control Mappings surface, scoped
  // (auto-selected) to this document — same functionality as the standalone
  // Mappings page, embedded here so it lives with the document.
  return (
    <div className="space-y-4">
      <ControlCoveragePanel documentId={documentId} />
      <GovernanceMappingsPage lockedDocumentId={documentId} />
    </div>
  );
}

function ComplianceSummarySection({ summary, loading }: { summary: any; loading: boolean }) {
  if (loading) {
    return <PageLoader size="sm" className="h-32" />;
  }

  const frameworks = summary?.frameworks || summary?.framework_summaries || [];
  if (!Array.isArray(frameworks) || frameworks.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-slate-300 bg-white p-5">
      <div className="space-y-4">
        {frameworks.map((fw: any, idx: number) => {
          const pct = fw.compliance_percentage ?? fw.compliance_score ?? 0;
          const color = pct >= 80 ? 'bg-green-500' : pct >= 60 ? 'bg-yellow-500' : 'bg-red-500';
          const textColor = pct >= 80 ? 'text-green-400' : pct >= 60 ? 'text-yellow-400' : 'text-red-400';
          return (
            <div key={fw.framework_id || idx}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium text-slate-700">{fw.framework_name || fw.name || `Framework ${fw.framework_id}`}</span>
                <span className={`text-sm font-bold ${textColor}`}>{Math.round(pct)}%</span>
              </div>
              <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${pct}%` }} />
              </div>
              <div className="flex items-center gap-4 mt-1 text-xs text-slate-600">
                {fw.total_clauses != null && <span>{fw.total_clauses} clauses</span>}
                {fw.compliant_count != null && <span className="text-green-400">{fw.compliant_count} compliant</span>}
                {fw.gaps_count != null && <span className="text-red-400">{fw.gaps_count} gaps</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function GapFindingRow({
  finding, isExpanded, isEditing, editAction, cs, rs, rms,
  onToggleExpand, onSetEditAction,
  tenantUsers, overrideForm, setOverrideForm, acceptRiskForm, setAcceptRiskForm,
  assignOwnerForm, setAssignOwnerForm, targetDateForm, setTargetDateForm,
  statusUpdateForm, setStatusUpdateForm,
  onUpdateFinding, onOverride, onAcceptRisk, onAddressGap, isPending,
}: any) {
  return (
    <>
      <tr className="bg-white hover:bg-slate-50 transition-colors cursor-pointer border-b border-slate-200" onClick={onToggleExpand}>
        <td className="px-2 py-2">
          {isExpanded ? <ChevronUp className="h-3.5 w-3.5 text-slate-500" /> : <ChevronDown className="h-3.5 w-3.5 text-slate-500" />}
        </td>
        <td className="px-3 py-2">
          <div className="text-xs text-slate-700 font-mono">{finding.clause_reference || '-'}</div>
          {finding.clause_title && (
            <div className="text-xs text-slate-500 mt-0.5 max-w-[180px] truncate">{finding.clause_title}</div>
          )}
        </td>
        <td className="px-3 py-2">
          <div className="text-xs text-slate-700 max-w-[140px] truncate">{finding.policy_section_reference || '-'}</div>
        </td>
        <td className="px-3 py-2">
          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cs.bg} ${cs.text}`}>
            {cs.label}
          </span>
          {finding.is_overridden && (
            <span className="ml-1 text-xs text-slate-500" title="Overridden">✓</span>
          )}
        </td>
        <td className="px-3 py-2 text-xs text-slate-700 max-w-[160px] truncate">{finding.gap_description || '-'}</td>
        <td className="px-3 py-2">
          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${rs.bg} ${rs.text}`}>
            {rs.label}
          </span>
        </td>
        <td className="px-3 py-2 text-xs text-slate-700 max-w-[140px] truncate">{finding.remediation_recommendation || '-'}</td>
        <td className="px-3 py-2 text-xs">
          {finding.assigned_owner_name || finding.assigned_owner?.display_name ? (
            <span className="text-slate-700">{finding.assigned_owner_name || finding.assigned_owner?.display_name}</span>
          ) : (
            <span className="text-slate-400 italic">Unassigned</span>
          )}
        </td>
        <td className="px-3 py-2 text-xs text-slate-700">{formatDate(finding.target_remediation_date)}</td>
        <td className="px-3 py-2">
          <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${rms.bg} ${rms.text}`}>
            {rms.label}
          </span>
        </td>
        <td className="px-3 py-2">
          <span className="inline-flex items-center justify-center rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
            {finding.evidence_count || finding.evidence?.length || 0}
          </span>
        </td>
        <td className="px-3 py-2 text-xs text-slate-500">{formatDate(finding.updated_at)}</td>
      </tr>

      {isExpanded && (
        <tr className="bg-slate-50 border-b border-slate-200">
          <td colSpan={12} className="px-6 py-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Details Section */}
              <div className="space-y-4">
                {finding.clause_requirement_text && (
                  <div className="rounded-lg border border-primary-200 bg-primary-50 p-3">
                    <label className="text-xs font-medium uppercase tracking-wider text-primary-700 block mb-1">Framework Clause Requirement</label>
                    <p className="text-sm text-slate-700">{finding.clause_requirement_text}</p>
                  </div>
                )}
                {finding.policy_section_text && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                    <label className="text-xs font-medium uppercase tracking-wider text-emerald-700 block mb-1">Matching Policy Text</label>
                    <p className="text-sm text-slate-700">{finding.policy_section_text}</p>
                  </div>
                )}
                {finding.gap_description && (
                  <div>
                    <label className="text-xs font-medium uppercase tracking-wider text-slate-600 block mb-1">Full Gap Description</label>
                    <p className="text-sm text-slate-700">{finding.gap_description}</p>
                  </div>
                )}
                {finding.ai_reasoning && (
                  <div className="rounded-lg border border-primary-200 bg-primary-50 p-3">
                    <label className="text-xs font-medium uppercase tracking-wider text-primary-700 block mb-1">AI Reasoning</label>
                    <p className="text-sm text-slate-700">{finding.ai_reasoning}</p>
                  </div>
                )}
                {finding.confidence_score != null && (
                  <div>
                    <label className="text-xs font-medium uppercase tracking-wider text-slate-600 block mb-1">Confidence Score</label>
                    <div className="flex items-center gap-2">
                      <div className="h-2 flex-1 rounded-full bg-slate-200 overflow-hidden">
                        <div className="h-full rounded-full bg-primary-500" style={{ width: `${finding.confidence_score * 100}%` }} />
                      </div>
                      <span className="text-sm text-slate-700">{Math.round(finding.confidence_score * 100)}%</span>
                    </div>
                  </div>
                )}
                {finding.missing_requirement && (
                  <div>
                    <label className="text-xs font-medium uppercase tracking-wider text-slate-600 block mb-1">Missing Requirement</label>
                    <p className="text-sm text-slate-700">{finding.missing_requirement}</p>
                  </div>
                )}
                {finding.remediation_recommendation && (
                  <div>
                    <label className="text-xs font-medium uppercase tracking-wider text-slate-600 block mb-1">Remediation Recommendation</label>
                    <p className="text-sm text-slate-700">{finding.remediation_recommendation}</p>
                  </div>
                )}
                {/* Impact Types */}
                <div>
                  <label className="text-xs font-medium uppercase tracking-wider text-slate-600 block mb-2">Impact Types</label>
                  <div className="flex flex-wrap gap-3">
                    {['regulatory', 'operational', 'financial', 'reputational'].map(impact => {
                      const isActive = finding[`${impact}_impact`] || finding.impact_types?.includes(impact);
                      return (
                        <div key={impact} className="flex items-center gap-1.5">
                          {isActive ? (
                            <Check className="h-4 w-4 text-green-600" />
                          ) : (
                            <Minus className="h-4 w-4 text-slate-400" />
                          )}
                          <span className={`text-sm capitalize ${isActive ? 'text-slate-700' : 'text-slate-500'}`}>{impact}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Actions Section */}
              <div className="space-y-3">
                <label className="text-xs font-medium uppercase tracking-wider text-slate-600 block">Actions</label>
                <div className="flex flex-wrap gap-2">
                  {onAddressGap
                    && (finding.compliance_status === 'not_addressed' || finding.compliance_status === 'partially_compliant')
                    && finding.remediation_status !== 'closed'
                    && !finding.applied_at
                    && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onAddressGap(finding); }}
                        className="flex items-center gap-1.5 rounded-lg border border-primary-300 bg-primary-50 px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-primary-100"
                        title="Draft a clause with AI and apply it to the document"
                      >
                        <Sparkles className="h-3.5 w-3.5" /> Address Gap
                      </button>
                    )}
                  {finding.applied_at && (
                    <span className="flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">
                      <Check className="h-3.5 w-3.5" /> Clause applied
                    </span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); onSetEditAction(editAction === 'assign-owner' ? null : 'assign-owner'); }}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-100 px-3 py-1.5 text-sm text-slate-700 hover:text-slate-900 hover:bg-slate-200"
                  >
                    <User className="h-3.5 w-3.5" /> Assign Owner
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onSetEditAction(editAction === 'set-date' ? null : 'set-date'); }}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-100 px-3 py-1.5 text-sm text-slate-700 hover:text-slate-900 hover:bg-slate-200"
                  >
                    <Calendar className="h-3.5 w-3.5" /> Set Target Date
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onSetEditAction(editAction === 'update-status' ? null : 'update-status'); }}
                    className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-100 px-3 py-1.5 text-sm text-slate-700 hover:text-slate-900 hover:bg-slate-200"
                  >
                    <Edit3 className="h-3.5 w-3.5" /> Update Status
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); onSetEditAction(editAction === 'override' ? null : 'override'); }}
                    className="flex items-center gap-1.5 rounded-lg border border-primary-300 bg-primary-50 px-3 py-1.5 text-sm text-slate-700 hover:bg-primary-100"
                  >
                    <ShieldCheck className="h-3.5 w-3.5 text-primary-700" /> Override
                  </button>
                  {finding.compliance_status !== 'fully_compliant' && finding.compliance_status !== 'not_applicable' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onSetEditAction(editAction === 'accept-risk' ? null : 'accept-risk'); }}
                      className="flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm text-slate-700 hover:bg-amber-100"
                    >
                      <ShieldAlert className="h-3.5 w-3.5 text-amber-600" /> Accept Risk
                    </button>
                  )}
                </div>

                {/* Inline Forms */}
                {isEditing && editAction === 'assign-owner' && (
                  <div className="rounded-lg border border-slate-300 bg-white p-3 space-y-3" onClick={(e) => e.stopPropagation()}>
                    <label className="text-sm font-medium text-slate-700">Select Owner</label>
                    <select
                      value={assignOwnerForm || ''}
                      onChange={(e) => setAssignOwnerForm(e.target.value ? Number(e.target.value) : null)}
                      className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
                    >
                      <option value="">Select user...</option>
                      {tenantUsers?.map((u: any) => (
                        <option key={u.user_id || u.id} value={u.user_id || u.id}>
                          {u.user?.display_name || u.display_name || u.user?.email || u.email}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={(e) => { e.stopPropagation(); onUpdateFinding(finding.id, { assigned_owner_id: assignOwnerForm }); }}
                      disabled={!assignOwnerForm || isPending}
                      className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-primary-700 disabled:opacity-50"
                    >
                      {isPending ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                )}

                {isEditing && editAction === 'set-date' && (
                  <div className="rounded-lg border border-slate-300 bg-white p-3 space-y-3" onClick={(e) => e.stopPropagation()}>
                    <label className="text-sm font-medium text-slate-700">Target Remediation Date</label>
                    <input
                      type="date"
                      value={targetDateForm}
                      onChange={(e) => setTargetDateForm(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); onUpdateFinding(finding.id, { target_remediation_date: targetDateForm }); }}
                      disabled={!targetDateForm || isPending}
                      className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-primary-700 disabled:opacity-50"
                    >
                      {isPending ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                )}

                {isEditing && editAction === 'update-status' && (
                  <div className="rounded-lg border border-slate-300 bg-white p-3 space-y-3" onClick={(e) => e.stopPropagation()}>
                    <label className="text-sm font-medium text-slate-700">Remediation Status</label>
                    <select
                      value={statusUpdateForm}
                      onChange={(e) => setStatusUpdateForm(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
                    >
                      <option value="">Select status...</option>
                      {Object.entries(REMEDIATION_STATUS_STYLES).map(([val, s]) => (
                        <option key={val} value={val}>{s.label}</option>
                      ))}
                    </select>
                    <button
                      onClick={(e) => { e.stopPropagation(); onUpdateFinding(finding.id, { remediation_status: statusUpdateForm }); }}
                      disabled={!statusUpdateForm || isPending}
                      className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-primary-700 disabled:opacity-50"
                    >
                      {isPending ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                )}

                {isEditing && editAction === 'override' && (
                  <div className="rounded-lg border border-primary-300 bg-primary-50 p-3 space-y-3" onClick={(e) => e.stopPropagation()}>
                    <label className="text-sm font-medium text-slate-700">Override Compliance Status</label>
                    <select
                      value={overrideForm.status}
                      onChange={(e) => setOverrideForm((prev: any) => ({ ...prev, status: e.target.value }))}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
                    >
                      {Object.entries(COMPLIANCE_STATUS_STYLES).map(([val, s]) => (
                        <option key={val} value={val}>{s.label}</option>
                      ))}
                    </select>
                    <textarea
                      value={overrideForm.justification}
                      onChange={(e) => setOverrideForm((prev: any) => ({ ...prev, justification: e.target.value }))}
                      placeholder="Justification (required)"
                      rows={3}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none resize-none"
                    />
                    <button
                      onClick={(e) => { e.stopPropagation(); onOverride(finding.id, { override_status: overrideForm.status, override_justification: overrideForm.justification }); }}
                      disabled={!overrideForm.justification.trim() || isPending}
                      className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-slate-900 hover:bg-primary-700 disabled:opacity-50"
                    >
                      {isPending ? 'Applying...' : 'Apply Override'}
                    </button>
                  </div>
                )}

                {isEditing && editAction === 'accept-risk' && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 space-y-3" onClick={(e) => e.stopPropagation()}>
                    <label className="text-sm font-medium text-slate-700">Accept Risk</label>
                    <textarea
                      value={acceptRiskForm.justification}
                      onChange={(e) => setAcceptRiskForm((prev: any) => ({ ...prev, justification: e.target.value }))}
                      placeholder="Justification (required)"
                      rows={3}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none resize-none"
                    />
                    <div>
                      <label className="text-xs text-slate-600 block mb-1">Expiry Date (optional)</label>
                      <input
                        type="date"
                        value={acceptRiskForm.expiry_date}
                        onChange={(e) => setAcceptRiskForm((prev: any) => ({ ...prev, expiry_date: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
                      />
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const data: any = { justification: acceptRiskForm.justification };
                        if (acceptRiskForm.expiry_date) data.expiry_date = acceptRiskForm.expiry_date;
                        onAcceptRisk(finding.id, data);
                      }}
                      disabled={!acceptRiskForm.justification.trim() || isPending}
                      className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                    >
                      {isPending ? 'Accepting...' : 'Accept Risk'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
