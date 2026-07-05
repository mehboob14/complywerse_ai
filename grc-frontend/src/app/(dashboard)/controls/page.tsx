'use client';

/**
 * Controls Workbench — a split master/detail surface. The LEFT pane is a
 * searchable, filterable, scrollable list of framework-control rows; the RIGHT
 * pane is a docked inspector that shows everything about the selected control
 * inline (no popup): status pipeline, owner, requirement, evidence checklist,
 * mapping, activity, AI recommendations, and promote-to-risk.
 *
 * The framework Tree / Document (Figure-2) structure views and the health
 * snapshot strip live on the companion `/controls/overview` route.
 *
 * Every useQuery / useMutation / handler / permission / filter from the
 * original monolithic page is preserved verbatim — no API call, query key, or
 * data shape changed. The status pipeline and owner are READ-ONLY because the
 * backend exposes no framework-control status-update endpoint; they reflect the
 * status-summary `control_status` record.
 */

import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { controlsApi, ermApi, adminApi, aiRecommendationsApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { SearchInput, MultiSelectDropdown, PageLoader, RightSlidePanel, AnimatedModal } from '@/components/ui';
import { useToast } from '@/components/ui/ToastProvider';
import {
  FrameworkControlEvidenceLinkSection,
  PriorityLevelBadge,
  ImplStatusPill,
  IMPL_STATUS_META,
  type FrameworkControl,
  type FrameworkControlsResponse,
  type FrameworkSummaryResponse,
  type StatusSummary,
} from './_shared/components';
import {
  Shield,
  Loader2,
  AlertCircle,
  CheckCircle,
  Clock,
  ChevronRight,
  ChevronLeft,
  FileText,
  Paperclip,
  Sparkles,
  Link2,
  User,
  LayoutGrid,
  ClipboardList,
  FolderOpen,
  AlertTriangle,
  Target,
  Plus,
  ShieldAlert,
  Activity,
  ListChecks,
  ChevronDown,
  ArrowUpNarrowWide,
  ArrowDownWideNarrow,
} from 'lucide-react';

interface TestProcedure {
  procedure_type: string;
  description: string;
  frequency: string;
  sample_size: string;
}

interface EvidenceRequirement {
  evidence_type: string;
  title: string;
  description: string;
  mandatory: boolean;
}

interface AddressedRisk {
  id: number; title: string; category: string | null; status: string | null;
  inherent_score: number | null; residual_score: number | null; mitigation_effectiveness: string | null;
}
interface PotentialRisk {
  title: string; description?: string; category?: string; severity?: string;
  likelihood?: number; impact?: number; rationale?: string;
}
interface AIRecommendations {
  control_id: number;
  test_procedures: TestProcedure[];
  evidence_requirements: EvidenceRequirement[];
  key_risks_addressed: string[];
  audit_focus_areas: string[];
  addressed_risks: AddressedRisk[];
  risks_if_not_implemented: PotentialRisk[];
}

const RISK_CATEGORIES = ['strategic', 'operational', 'financial', 'compliance', 'technology', 'third_party', 'project_change', 'internal'];
// Mirror the standard ERM Risk Register "Register Type" options (UBL/NCA template
// import flows are excluded — they don't apply to a control-gap risk).
const REGISTER_TYPES = ['PCI-DSS', 'ISO 27001', 'SOX', 'GDPR', 'NIST', 'SAMA CSF', 'Internal', 'Project-Based', 'Third-Party', 'Other'];
const RISK_INPUT_CLS = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';
function riskSevCls(sev?: string): string {
  const m: Record<string, string> = {
    critical: 'bg-rose-50 text-rose-700 border-rose-200', high: 'bg-orange-50 text-orange-700 border-orange-200',
    medium: 'bg-amber-50 text-amber-700 border-amber-200', low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
  return m[(sev || 'medium').toLowerCase()] || m.medium;
}

type SortField =
  | 'control_id'
  | 'title'
  | 'framework_name'
  | 'domain'
  | 'priority'
  | 'evidence_count'
  | 'status';

// ── The 4-stage implementation pipeline. Backend vocabulary is preserved; we
// only present it as an ordered pipeline. `not_applicable` is not part of the
// linear pipeline, so it renders as a standalone pill instead. ────────────────
const PIPELINE_STAGES: { key: string; label: string }[] = [
  { key: 'not_started', label: 'Not started' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'implemented', label: 'Implemented' },
  { key: 'verified', label: 'Verified' },
];

// Left-pane quick filters. Each maps onto real page state (search / status
// summary), never an invented API param. `mine`/`in_progress` filter against
// the read-only control_status record; `gaps` = no evidence linked yet.
type QuickFilter = 'all' | 'gaps' | 'mine' | 'in_progress';

export default function ControlsPage() {
  const searchParams = useSearchParams();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('controls:control_library:create');
  const queryClient = useQueryClient();
  const initialFrameworkId = searchParams.get('framework');

  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [frameworkFilter, setFrameworkFilter] = useState<number | null>(
    initialFrameworkId ? Number(initialFrameworkId) : null
  );
  const [domainFilter, setDomainFilter] = useState('');
  const [sortBy, setSortBy] = useState<SortField>('control_id');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [selectedControlId, setSelectedControlId] = useState<number | null>(null);
  // Heavy inspector sections open in a popup so the docked record stays short.
  const [showRecEvidence, setShowRecEvidence] = useState(false);
  const [page, setPage] = useState(0);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [aiRecommendations, setAiRecommendations] = useState<Record<number, AIRecommendations>>({});
  const [loadingAI, setLoadingAI] = useState<number | null>(null);
  // When a single framework is in view we load it whole (no pagination) so the
  // domain hierarchy is complete; the cross-framework "All" view stays paginated.
  const pageSize = frameworkFilter ? 1000 : 50;
  // Collapsible framework→domain groups in the left master list.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // Auto-select PCI DSS (or the first framework) on first load when none is set.
  const didAutoSelectFramework = useRef(false);
  // Controls whose AI recommendation we've already loaded-or-generated this
  // session (prevents duplicate auto-runs; a failure is removed so it retries).
  const autoRecTried = useRef<Set<number>>(new Set());

  const AI_REC_KEY = {
    module: 'control_library',
    recommendation_type: 'control_ai_recommendations',
    entity_type: 'framework_control',
  } as const;

  const aiRecommendationMutation = useMutation({
    mutationFn: (data: { control_id: number; control_title: string; control_description?: string; framework_name?: string }) =>
      controlsApi.getAIRecommendations(data),
    onSuccess: (response, variables) => {
      const output = response.data as AIRecommendations;
      setAiRecommendations(prev => ({ ...prev, [variables.control_id]: output }));
      setLoadingAI(null);
      // Persist to the per-tenant AI-recommendations store so it loads instantly
      // next time (for every user in this tenant) — no manual save, no re-run.
      aiRecommendationsApi.save({
        ...AI_REC_KEY,
        entity_id: String(variables.control_id),
        title: `AI recommendations · ${variables.control_title}`,
        output: output as unknown as Record<string, unknown>,
        model: 'gpt-4o',
      }).catch(() => {});
    },
    onError: (_e, variables) => {
      setLoadingAI(null);
      autoRecTried.current.delete(variables.control_id); // allow a retry on reopen
    }
  });

  // ── Promote an AI "risk if not implemented" into the real ERM Risk Register ──
  const { toast } = useToast();
  const [promoteCtx, setPromoteCtx] = useState<{ control: FrameworkControl; risk: PotentialRisk } | null>(null);
  const [promoteForm, setPromoteForm] = useState({
    title: '', description: '', register_type: '', category: 'compliance', risk_sub_category: '',
    business_owner_id: undefined as number | undefined,
    likelihood: 3, impact: 3, residual_likelihood: 3, residual_impact: 3,
    treatment_plan: '', root_cause: '', recommendations: '', due_date: '',
  });

  // Users for the Business Owner select — fetched only while the panel is open.
  const { data: usersList } = useQuery({
    queryKey: ['admin-users-for-control-risk'],
    queryFn: async () => {
      try {
        const r = await adminApi.getUsers();
        return ((r.data || []) as Array<{ id: number; email?: string; full_name?: string; name?: string; first_name?: string; last_name?: string }>).map((u) => ({
          id: u.id,
          name: u.full_name || u.name || [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.email || `User ${u.id}`,
        }));
      } catch { return []; }
    },
    // Loaded when the user can edit (owner picker) or the promote panel is open.
    enabled: canCreate || !!promoteCtx,
  });

  // Standalone per-control ownership: set owner + implementation stage directly
  // (no certification journey needed). Refreshes the status-summary on success.
  const [ownerPendingId, setOwnerPendingId] = useState<number | null>(null);
  const ownershipMutation = useMutation({
    mutationFn: ({ controlId, data }: { controlId: number; data: { status?: string; assigned_user_ids?: number[] } }) =>
      controlsApi.updateFrameworkControlOwnership(controlId, data),
    onMutate: ({ controlId }) => setOwnerPendingId(controlId),
    onSettled: () => {
      setOwnerPendingId(null);
      queryClient.invalidateQueries({ queryKey: ['framework-controls-status-summary'] });
    },
    onError: () => toast({ type: 'error', title: 'Could not update control', message: 'Please try again.' }),
  });

  const openPromote = (control: FrameworkControl, risk: PotentialRisk) => {
    const lk = risk.likelihood && risk.likelihood >= 1 && risk.likelihood <= 5 ? risk.likelihood : 3;
    const im = risk.impact && risk.impact >= 1 && risk.impact <= 5 ? risk.impact : 3;
    setPromoteCtx({ control, risk });
    setPromoteForm({
      title: risk.title || '',
      description: risk.description || '',
      register_type: control.framework_name || '',
      category: risk.category && RISK_CATEGORIES.includes(risk.category) ? risk.category : 'compliance',
      risk_sub_category: '',
      business_owner_id: undefined,
      likelihood: lk, impact: im,
      // Control not yet implemented → residual starts at inherent (user can adjust).
      residual_likelihood: lk, residual_impact: im,
      treatment_plan: '', root_cause: risk.rationale || '', recommendations: '', due_date: '',
    });
  };

  const promoteRiskMutation = useMutation({
    mutationFn: () => controlsApi.promoteControlRisk({
      control_id: promoteCtx!.control.id,
      framework_name: promoteCtx!.control.framework_name || undefined,
      title: promoteForm.title,
      description: promoteForm.description || promoteCtx!.risk.description || undefined,
      register_type: promoteForm.register_type || undefined,
      category: promoteForm.category,
      risk_sub_category: promoteForm.risk_sub_category || undefined,
      inherent_likelihood: promoteForm.likelihood,
      inherent_impact: promoteForm.impact,
      residual_likelihood: promoteForm.residual_likelihood,
      residual_impact: promoteForm.residual_impact,
      business_owner_id: promoteForm.business_owner_id,
      treatment_plan: promoteForm.treatment_plan || undefined,
      root_cause: promoteForm.root_cause || undefined,
      recommendations: promoteForm.recommendations || undefined,
      due_date: promoteForm.due_date || undefined,
    }),
    onSuccess: (resp) => {
      // The new risk is now linked to this control. Reflect it locally so the
      // section flips to "risks addressed" mode (mutual exclusivity) without a refetch.
      const data = (resp?.data || {}) as { risk_id?: number; title?: string; category?: string | null; inherent_score?: number | null; status?: string | null };
      const ctrlId = promoteCtx!.control.id;
      const promoted = promoteCtx!.risk;
      if (data.risk_id) {
        setAiRecommendations((prev) => {
          const rec = prev[ctrlId];
          if (!rec) return prev;
          const added: AddressedRisk = {
            id: data.risk_id!, title: data.title || promoted.title, category: data.category ?? promoteForm.category,
            status: data.status ?? 'open', inherent_score: data.inherent_score ?? null,
            residual_score: data.inherent_score ?? null, mitigation_effectiveness: 'full',
          };
          return {
            ...prev,
            [ctrlId]: {
              ...rec,
              addressed_risks: [...rec.addressed_risks, added],
              risks_if_not_implemented: rec.risks_if_not_implemented.filter((r) => r !== promoted),
            },
          };
        });
      }
      toast({ type: 'success', title: 'Risk added to register', message: 'Created in the ERM Risk Register and linked to this control as a mitigation.' });
      setPromoteCtx(null);
    },
    onError: (e: { response?: { data?: { detail?: string } } }) =>
      toast({ type: 'error', title: 'Could not add risk', message: e?.response?.data?.detail || 'Try again.' }),
  });

  // ── Close a linked register risk in one click (control mitigates it) ──
  const [closingRiskId, setClosingRiskId] = useState<number | null>(null);
  const [closedRiskIds, setClosedRiskIds] = useState<Set<number>>(new Set());
  const closeRiskMutation = useMutation({
    mutationFn: (riskId: number) => ermApi.risks.closeRisk(riskId, 'Closed from Controls — the mitigating control is in place.'),
    onMutate: (riskId: number) => setClosingRiskId(riskId),
    onSuccess: (_resp, riskId) => {
      setClosedRiskIds((prev) => new Set(prev).add(riskId));
      setClosingRiskId(null);
      toast({ type: 'success', title: 'Risk closed', message: 'The linked risk was closed in the ERM Risk Register.' });
    },
    onError: (e: { response?: { data?: { detail?: string } } }) => {
      setClosingRiskId(null);
      toast({ type: 'error', title: 'Could not close risk', message: e?.response?.data?.detail || 'Try again.' });
    },
  });

  const getProcedureTypeBadge = (type: string) => {
    const colors: Record<string, string> = {
      walkthrough: 'bg-primary-50 text-primary-700',
      inquiry: 'bg-primary-50 text-primary-700',
      observation: 'bg-slate-100 text-slate-600',
      inspection: 'bg-amber-50 text-amber-700',
      reperformance: 'bg-emerald-50 text-emerald-700',
    };
    return (
      <span className={`rounded-full px-2 py-0.5 text-xs capitalize ${colors[type] || 'bg-slate-200 text-slate-500'}`}>
        {type}
      </span>
    );
  };

  const getEvidenceTypeIcon = (type: string) => {
    const icons: Record<string, React.ReactNode> = {
      policy: <FileText className="h-4 w-4" />,
      procedure: <ClipboardList className="h-4 w-4" />,
      report: <FolderOpen className="h-4 w-4" />,
      screenshot: <FileText className="h-4 w-4" />,
      log: <FileText className="h-4 w-4" />,
      configuration: <FileText className="h-4 w-4" />,
      certificate: <FileText className="h-4 w-4" />,
      attestation: <FileText className="h-4 w-4" />,
      training: <FileText className="h-4 w-4" />,
    };
    return icons[type] || <FileText className="h-4 w-4" />;
  };

  useEffect(() => {
    if (initialFrameworkId) {
      setFrameworkFilter(Number(initialFrameworkId));
    }
  }, [initialFrameworkId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchTerm(searchInput.trim());
      setPage(0);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const { data: summaryData } = useQuery({
    queryKey: ['framework-controls-summary'],
    queryFn: async () => {
      const response = await controlsApi.getFrameworkControlsSummary();
      return response.data as FrameworkSummaryResponse;
    },
  });

  // Default the workbench to PCI DSS (fallback: first framework) when opened
  // without an explicit framework — so controls always land framework-scoped &
  // hierarchical rather than as a flat cross-framework dump. Runs once; a later
  // manual switch to "All Frameworks" is respected.
  useEffect(() => {
    if (didAutoSelectFramework.current) return;
    if (initialFrameworkId || frameworkFilter != null) { didAutoSelectFramework.current = true; return; }
    const fws = summaryData?.frameworks;
    if (!fws || fws.length === 0) return;
    didAutoSelectFramework.current = true;
    const pci = fws.find((f) => /pci/i.test(f.name)) ?? fws[0];
    if (pci) { setFrameworkFilter(pci.id); setPage(0); }
  }, [summaryData, initialFrameworkId, frameworkFilter]);

  // Control-health snapshot — endpoint-derived, unpaginated. Guarded to {} so a
  // 404/absent endpoint degrades gracefully. Drives the read-only status
  // pipeline + owner in the inspector (control_status record).
  const { data: statusSummary } = useQuery({
    queryKey: ['framework-controls-status-summary', frameworkFilter],
    queryFn: async (): Promise<Partial<StatusSummary>> => {
      try {
        const res = await controlsApi.getFrameworkControlsStatusSummary(frameworkFilter ?? undefined);
        return (res.data ?? {}) as StatusSummary;
      } catch {
        return {};
      }
    },
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['framework-controls', frameworkFilter, domainFilter, searchTerm, sortBy, sortOrder, page],
    queryFn: async () => {
      const params: {
        skip: number;
        limit: number;
        framework_id?: number;
        domain?: string;
        search?: string;
        sort_by?: string;
        sort_order?: 'asc' | 'desc';
      } = {
        skip: page * pageSize,
        limit: pageSize,
      };
      if (frameworkFilter) params.framework_id = frameworkFilter;
      if (domainFilter) params.domain = domainFilter;
      if (searchTerm) params.search = searchTerm;
      params.sort_by = sortBy;
      params.sort_order = sortOrder;

      const response = await controlsApi.getFrameworkControls(params);
      return response.data as FrameworkControlsResponse;
    },
    placeholderData: (previousData) => previousData,
  });

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  // AUTO AI recommendations: the first time a control is opened, load its saved
  // recommendation from the per-tenant store, or generate + persist it — no
  // button, no manual save. Subsequent opens (this session or a future one, any
  // user in the tenant) load instantly from the store.
  useEffect(() => {
    if (selectedControlId == null) return;
    const cid = selectedControlId;
    const c = (data?.controls || []).find((x) => x.id === cid);
    if (!c) return;
    if (aiRecommendations[cid] || loadingAI === cid || autoRecTried.current.has(cid)) return;
    autoRecTried.current.add(cid);
    setLoadingAI(cid);
    const generate = () =>
      aiRecommendationMutation.mutate({
        control_id: cid,
        control_title: c.title,
        control_description: c.description || undefined,
        framework_name: c.framework_name || undefined,
      });
    const clear = () => setLoadingAI((v) => (v === cid ? null : v));
    aiRecommendationsApi
      .list({ ...AI_REC_KEY, entity_id: cid })
      .then((res) => {
        const saved = ((res.data as { items?: Array<{ output?: unknown }> })?.items || [])[0];
        if (saved?.output) {
          // Everyone loads the saved recommendation from the per-tenant store.
          setAiRecommendations((prev) => ({ ...prev, [cid]: saved.output as AIRecommendations }));
          clear();
        } else if (canCreate) {
          // First time: only editors trigger (+persist) generation.
          generate();
        } else {
          clear();
        }
      })
      .catch(() => { if (canCreate) generate(); else clear(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedControlId, data]);

  const getPriorityBadge = (priority: string) => {
    const colors: Record<string, string> = {
      high: 'bg-rose-50 text-rose-700',
      medium: 'bg-amber-50 text-amber-700',
      low: 'bg-slate-100 text-slate-600',
    };
    return (
      <span className={`rounded-full px-2 py-0.5 text-xs capitalize ${colors[priority] || 'bg-slate-100 text-slate-500'}`}>
        {priority}
      </span>
    );
  };

  const getVerificationBadge = (isVerified: boolean) => {
    if (isVerified) {
      return (
        <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
          <CheckCircle size={12} /> Verified
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
        <Clock size={12} /> Pending
      </span>
    );
  };

  // Read-only implementation status for a control, keyed by the status-summary
  // endpoint's control_status record.
  const implStatusFor = (control: FrameworkControl) =>
    statusSummary?.control_status?.[String(control.id)] ?? null;

  if (isLoading && !data) {
    return (
      <div className="flex h-64 items-center justify-center">
        <PageLoader size="md" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-rose-600">
        <AlertCircle className="mb-2 h-8 w-8" />
        <p>Failed to load controls</p>
      </div>
    );
  }

  const allControls = data?.controls ?? [];

  // Quick-filter chips → real filters (no new API params).
  const filteredControls = allControls.filter((c) => {
    if (quickFilter === 'gaps') return c.evidence_count === 0;
    const st = implStatusFor(c)?.status;
    if (quickFilter === 'in_progress') return st === 'in_progress';
    if (quickFilter === 'mine') return !!implStatusFor(c)?.assignee_name;
    return true;
  });

  const selectedControl = allControls.find((c) => c.id === selectedControlId) ?? null;
  const selectedImplStatus = selectedControl ? implStatusFor(selectedControl) : null;

  // Prev/Next navigation across the currently filtered list.
  const selectedIndex = selectedControl ? filteredControls.findIndex((c) => c.id === selectedControl.id) : -1;
  const prevControl = selectedIndex > 0 ? filteredControls[selectedIndex - 1] : null;
  const nextControl = selectedIndex >= 0 && selectedIndex < filteredControls.length - 1 ? filteredControls[selectedIndex + 1] : null;

  const selectedFramework = summaryData?.frameworks.find(f => f.id === frameworkFilter);
  // Fallback: derive framework name from loaded controls when not in summaryData (e.g. status=draft/classified)
  const fallbackFrameworkName = !selectedFramework && frameworkFilter && allControls.length
    ? allControls[0]?.framework_name
    : null;
  const effectiveFrameworkName = selectedFramework?.name || fallbackFrameworkName;

  const quickChips: { key: QuickFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'gaps', label: 'Gaps' },
    { key: 'mine', label: 'Mine' },
    { key: 'in_progress', label: 'In progress' },
  ];

  // Domain filter options derived from the loaded (framework-scoped) controls.
  const domainOptions = Array.from(new Set(allControls.map((c) => c.domain).filter(Boolean) as string[]))
    .sort((a, b) => a.localeCompare(b))
    .map((d) => ({ value: d, label: d }));

  const userItems = (usersList || []).map((u) => ({ value: String(u.id), label: u.name }));

  const sortOptions: { value: SortField; label: string }[] = [
    { value: 'control_id', label: 'Control ID' },
    { value: 'title', label: 'Title' },
    { value: 'priority', label: 'Priority' },
    { value: 'evidence_count', label: 'Evidence' },
  ];

  // Group the filtered controls into a Framework → Domain hierarchy (order
  // preserved from the backend sort). The framework header is only shown when
  // more than one framework is present (i.e. the "All Frameworks" view).
  const groups: { framework: string; domains: { domain: string; controls: FrameworkControl[] }[] }[] = (() => {
    const fwOrder: string[] = [];
    const fwMap = new Map<string, Map<string, FrameworkControl[]>>();
    for (const c of filteredControls) {
      const fw = c.framework_name || 'Unknown framework';
      const dom = c.domain || 'Uncategorized';
      if (!fwMap.has(fw)) { fwMap.set(fw, new Map()); fwOrder.push(fw); }
      const domMap = fwMap.get(fw)!;
      if (!domMap.has(dom)) domMap.set(dom, []);
      domMap.get(dom)!.push(c);
    }
    return fwOrder.map((fw) => ({
      framework: fw,
      domains: Array.from(fwMap.get(fw)!.entries()).map(([domain, controls]) => ({ domain, controls })),
    }));
  })();
  const showFrameworkHeaders = groups.length > 1;
  const toggleGroup = (key: string) =>
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  return (
    <div className="space-y-5">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          {frameworkFilter && (selectedFramework || effectiveFrameworkName) ? (
            <>
              <h1 className="text-2xl font-bold text-slate-900">
                {effectiveFrameworkName}
              </h1>
              <p className="text-slate-600">
                {selectedFramework ? `${selectedFramework.control_count} controls extracted from this framework` : 'Controls for this framework'}
              </p>
            </>
          ) : (
            <>
              <h1 className="text-lg font-semibold text-slate-900">Controls Workbench</h1>
              <p className="text-xs text-slate-500">Search, inspect &amp; evidence controls from your frameworks</p>
            </>
          )}
        </div>
        <Link
          href={`/controls/overview${frameworkFilter ? `?framework=${frameworkFilter}` : ''}`}
          className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          <LayoutGrid className="h-4 w-4" strokeWidth={1.75} />
          Overview
        </Link>
      </div>

      {/* ── Filter bar (search + framework) ────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[180px] flex-1 sm:min-w-[280px]">
          <SearchInput
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Search controls by ID, title, or description..."
            size="md"
          />
        </div>
        <MultiSelectDropdown
          title="Framework"
          items={(() => {
            const list = summaryData?.frameworks?.map((fw) => ({
              value: String(fw.id),
              label: `${fw.name} (${fw.control_count})`,
            })) || [];
            if (frameworkFilter && !summaryData?.frameworks?.find((f) => f.id === frameworkFilter) && effectiveFrameworkName) {
              list.unshift({ value: String(frameworkFilter), label: effectiveFrameworkName });
            }
            return list;
          })()}
          selectedValues={frameworkFilter ? [String(frameworkFilter)] : []}
          onApply={(v) => {
            setFrameworkFilter(v[0] ? Number(v[0]) : null);
            setPage(0);
          }}
          multiSelect={false}
          autoApply
          forceSearch
          placeholder="All Frameworks"
          searchPlaceholder="Search frameworks"
          size="md"
        />
        {domainOptions.length > 0 && (
          <MultiSelectDropdown
            title="Domain"
            items={domainOptions}
            selectedValues={domainFilter ? [domainFilter] : []}
            onApply={(v) => { setDomainFilter(v[0] || ''); setPage(0); }}
            multiSelect={false}
            autoApply
            forceSearch
            placeholder="All"
            searchPlaceholder="Search domains"
            size="md"
          />
        )}
        <MultiSelectDropdown
          title="Sort"
          items={sortOptions.map((s) => ({ value: s.value, label: s.label }))}
          selectedValues={[sortBy]}
          onApply={(v) => { setSortBy((v[0] as SortField) || 'control_id'); setPage(0); }}
          multiSelect={false}
          autoApply
          placeholder="Control ID"
          size="md"
        />
        <button
          type="button"
          onClick={() => { setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc')); setPage(0); }}
          title={`Sort ${sortOrder === 'asc' ? 'ascending' : 'descending'}`}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          {sortOrder === 'asc' ? <ArrowUpNarrowWide className="h-4 w-4" strokeWidth={1.75} /> : <ArrowDownWideNarrow className="h-4 w-4" strokeWidth={1.75} />}
          <span className="hidden sm:inline">{sortOrder === 'asc' ? 'Asc' : 'Desc'}</span>
        </button>
      </div>

      {/* ── Split workbench ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* LEFT — master list */}
        <div className="lg:col-span-5">
          {/* Quick filter chips */}
          <div className="mb-3 flex flex-wrap items-center gap-1.5">
            {quickChips.map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => setQuickFilter(chip.key)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  quickFilter === chip.key
                    ? 'border-primary-600 bg-primary-600 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {chip.label}
              </button>
            ))}
            <span className="ml-auto text-[11px] text-slate-400">
              {filteredControls.length}{filteredControls.length !== allControls.length ? ` / ${allControls.length}` : ''} shown
            </span>
          </div>

          <div className="card p-0">
            {filteredControls.length ? (
              <div className="max-h-[75vh] overflow-y-auto">
                {groups.map((g) => {
                  const fwKey = `fw::${g.framework}`;
                  const fwCollapsed = collapsedGroups.has(fwKey);
                  const fwCount = g.domains.reduce((n, d) => n + d.controls.length, 0);
                  return (
                    <div key={g.framework}>
                      {showFrameworkHeaders && (
                        <button
                          type="button"
                          onClick={() => toggleGroup(fwKey)}
                          className="sticky top-0 z-10 flex w-full items-center gap-2 border-b border-slate-200 bg-slate-100 px-3 py-2 text-left text-xs font-semibold text-slate-700"
                        >
                          <ChevronDown className={`h-3.5 w-3.5 flex-shrink-0 transition-transform ${fwCollapsed ? '-rotate-90' : ''}`} strokeWidth={2} />
                          <span className="truncate">{g.framework}</span>
                          <span className="ml-auto rounded-full bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{fwCount}</span>
                        </button>
                      )}
                      {!fwCollapsed && g.domains.map((d) => {
                        const domKey = `dom::${g.framework}::${d.domain}`;
                        const domCollapsed = collapsedGroups.has(domKey);
                        return (
                          <div key={domKey}>
                            <button
                              type="button"
                              onClick={() => toggleGroup(domKey)}
                              className={`sticky ${showFrameworkHeaders ? 'top-[33px]' : 'top-0'} z-[9] flex w-full items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-slate-500`}
                            >
                              <ChevronDown className={`h-3 w-3 flex-shrink-0 transition-transform ${domCollapsed ? '-rotate-90' : ''}`} strokeWidth={2} />
                              <span className="truncate">{d.domain}</span>
                              <span className="ml-auto rounded-full bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-400">{d.controls.length}</span>
                            </button>
                            {!domCollapsed && (
                              <div className="divide-y divide-slate-100">
                                {d.controls.map((control) => {
                                  const isSelected = control.id === selectedControlId;
                                  const st = implStatusFor(control)?.status;
                                  // Right-side status dot: verified > tracked-status > pending.
                                  const dot =
                                    st === 'verified' || control.is_verified ? 'bg-emerald-500' :
                                    st === 'implemented' ? 'bg-primary-500' :
                                    st === 'in_progress' ? 'bg-amber-500' :
                                    'bg-slate-300';
                                  return (
                                    <button
                                      key={control.id}
                                      type="button"
                                      onClick={() => setSelectedControlId(control.id)}
                                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
                                        isSelected ? 'bg-primary-50' : 'hover:bg-slate-50'
                                      }`}
                                    >
                                      <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                          <span className="font-mono text-xs font-semibold text-slate-900">
                                            {control.original_reference || control.control_id}
                                          </span>
                                          {control.priority_level && <PriorityLevelBadge level={control.priority_level} />}
                                        </div>
                                        <p className="mt-1 line-clamp-2 text-sm text-slate-700">{control.title}</p>
                                        <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-500">
                                          <span className="inline-flex items-center gap-1">
                                            <Paperclip className="h-3 w-3" strokeWidth={1.75} />
                                            {control.evidence_count} evidence
                                          </span>
                                        </div>
                                      </div>
                                      <span className={`mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full ${dot}`} title={st ? IMPL_STATUS_META[st]?.label ?? st : (control.is_verified ? 'Verified' : 'Pending')} />
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex min-h-[16rem] flex-col items-center justify-center px-4 py-8 text-center">
                <Shield className="mb-3 h-10 w-10 text-slate-300" strokeWidth={1.5} />
                <p className="text-sm font-medium text-slate-700">No controls found</p>
                <p className="mt-1 text-xs text-slate-500">
                  {summaryData?.total_frameworks === 0
                    ? 'Upload a regulatory framework to see controls here'
                    : 'Try adjusting your search, framework, or quick filter'}
                </p>
              </div>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-3 flex items-center justify-between">
              <p className="text-xs text-slate-500">
                {page * pageSize + 1}–{Math.min((page + 1) * pageSize, data?.total || 0)} of {data?.total || 0}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(Math.max(0, page - 1))}
                  disabled={page === 0}
                  className="btn-secondary btn-sm"
                >
                  Previous
                </button>
                <span className="text-xs text-slate-500">
                  {page + 1} / {totalPages}
                </span>
                <button
                  onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                  disabled={page >= totalPages - 1}
                  className="btn-secondary btn-sm"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT — docked inspector */}
        <div className="lg:col-span-7">
          <div className="lg:sticky lg:top-4">
            {!selectedControl ? (
              <div className="card flex min-h-[24rem] flex-col items-center justify-center text-center">
                <ListChecks className="mb-3 h-10 w-10 text-slate-300" strokeWidth={1.5} />
                <p className="text-sm font-medium text-slate-700">Select a control to inspect</p>
                <p className="mt-1 text-xs text-slate-500">Everything about a control opens here — no popup.</p>
              </div>
            ) : (() => {
              const control = selectedControl;
              const currentStatus = selectedImplStatus?.status ?? (control.is_verified ? 'verified' : 'not_started');
              const stageIdx = PIPELINE_STAGES.findIndex((s) => s.key === currentStatus);
              return (
                <>
                <div className="card p-0">
                  {/* Inspector header */}
                  <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm text-primary-700">{control.original_reference || control.control_id}</span>
                        {control.priority_level
                          ? <PriorityLevelBadge level={control.priority_level} />
                          : getPriorityBadge(control.priority)}
                      </div>
                      <h2 className="mt-1 text-sm font-semibold text-slate-900">{control.title}</h2>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {control.framework_name}{control.framework_version ? ` (${control.framework_version})` : ''}{control.domain ? ` · ${control.domain}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      {selectedImplStatus
                        ? <ImplStatusPill status={selectedImplStatus.status} />
                        : getVerificationBadge(control.is_verified)}
                    </div>
                  </div>

                  <div className="max-h-[72vh] space-y-4 overflow-y-auto px-4 py-4 scrollbar-thin">
                    {/* Implementation stage — click a stage to set it directly. */}
                    <div>
                      <div className="mb-1.5 flex items-center justify-between">
                        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Implementation stage</h4>
                        {canCreate ? (
                          <button
                            type="button"
                            onClick={() => ownershipMutation.mutate({ controlId: control.id, data: { status: currentStatus === 'not_applicable' ? 'not_started' : 'not_applicable' } })}
                            disabled={ownerPendingId === control.id}
                            className="text-[11px] font-medium text-slate-500 hover:text-slate-800 disabled:opacity-50"
                          >
                            {currentStatus === 'not_applicable' ? 'Mark applicable' : 'Mark N/A'}
                          </button>
                        ) : currentStatus === 'not_applicable' ? <ImplStatusPill status="not_applicable" /> : null}
                      </div>
                      <div className={`flex overflow-hidden rounded-lg border border-slate-200 ${currentStatus === 'not_applicable' ? 'opacity-50' : ''}`}>
                        {PIPELINE_STAGES.map((stage, i) => {
                          const done = stageIdx >= 0 && i <= stageIdx;
                          const isCurrent = i === stageIdx;
                          const cls = `flex-1 border-r border-slate-200 px-2 py-1.5 text-center text-[11px] font-medium last:border-r-0 ${
                            isCurrent ? 'bg-primary-600 text-white'
                            : done ? 'bg-primary-50 text-primary-700'
                            : 'bg-white text-slate-400'
                          } ${canCreate ? 'cursor-pointer hover:brightness-95' : ''}`;
                          return canCreate ? (
                            <button
                              key={stage.key}
                              type="button"
                              onClick={() => ownershipMutation.mutate({ controlId: control.id, data: { status: stage.key } })}
                              disabled={ownerPendingId === control.id}
                              className={`${cls} disabled:opacity-60`}
                              title={`Set stage: ${stage.label}`}
                            >
                              {stage.label}
                            </button>
                          ) : (
                            <div key={stage.key} className={cls} title={stage.label}>{stage.label}</div>
                          );
                        })}
                      </div>
                      {canCreate && (
                        <p className="mt-1 text-[11px] text-slate-400">Click a stage to set this control&apos;s implementation status.</p>
                      )}
                    </div>

                    {/* Owner + link-evidence actions */}
                    <div className="flex flex-wrap items-center gap-2">
                      {canCreate ? (
                        <MultiSelectDropdown
                          title="Owner"
                          items={userItems}
                          selectedValues={selectedImplStatus?.assigned_user_ids?.[0] ? [String(selectedImplStatus.assigned_user_ids[0])] : []}
                          onApply={(v) => ownershipMutation.mutate({ controlId: control.id, data: { assigned_user_ids: v[0] ? [Number(v[0])] : [] } })}
                          multiSelect={false}
                          autoApply
                          forceSearch
                          placeholder="Unassigned"
                          searchPlaceholder="Search users"
                          size="sm"
                        />
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700">
                          <User className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.75} />
                          <span className="text-slate-500">Owner:</span>
                          <span className="font-medium text-slate-800">{selectedImplStatus?.assignee_name || 'Unassigned'}</span>
                        </span>
                      )}
                      <Link
                        href={`/evidence?control_id=${control.id}`}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                      >
                        <Paperclip className="h-3.5 w-3.5" strokeWidth={1.75} /> Manage evidence
                      </Link>
                      {control.evidence_requirements && control.evidence_requirements.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setShowRecEvidence(true)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                        >
                          <FileText className="h-3.5 w-3.5 text-amber-600" strokeWidth={1.75} /> Recommended evidence
                          <span className="rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">{control.evidence_requirements.length}</span>
                        </button>
                      )}
                    </div>

                    {/* Requirement */}
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Requirement</h4>
                      <div className="max-h-72 space-y-3 overflow-y-auto pr-1 scrollbar-thin">
                        {control.description && (
                          <p className="text-sm text-slate-700">{control.description}</p>
                        )}
                        {control.full_text && (
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600">{control.full_text}</p>
                        )}
                        {!control.description && !control.full_text && (
                          <p className="text-sm text-slate-400">No requirement text provided.</p>
                        )}
                      </div>
                    </div>

                    {/* Evidence checklist */}
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <h4 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        <ListChecks className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.75} /> Evidence checklist
                      </h4>
                      <FrameworkControlEvidenceLinkSection controlId={control.id} />
                    </div>

                    {/* Recommended evidence moved to a popup (button in the action row) */}

                    {/* Mapping + Activity — compact side-by-side */}
                    <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <h4 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Mapping</h4>
                      <dl className="space-y-2 text-sm">
                        <div className="flex justify-between gap-4">
                          <dt className="text-slate-500">Framework</dt>
                          <dd className="text-right font-medium text-slate-800">{control.framework_name}{control.framework_version && ` (${control.framework_version})`}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-slate-500">Domain</dt>
                          <dd className="text-right text-slate-700">{control.domain || '—'}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-slate-500">Category</dt>
                          <dd className="text-right text-slate-700">{control.category || '—'}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-slate-500">Section</dt>
                          <dd className="text-right font-mono text-slate-700">{control.section_number || '—'}</dd>
                        </div>
                        <div className="flex justify-between gap-4">
                          <dt className="text-slate-500">Original reference</dt>
                          <dd className="text-right font-mono text-slate-700">{control.original_reference || control.control_id}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <dt className="text-slate-500">Mandatory</dt>
                          <dd className="text-right text-slate-700">{control.is_mandatory ? 'Yes' : 'No'}</dd>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <dt className="text-slate-500">Parent control</dt>
                          <dd className="text-right">
                            {control.parent_section ? (
                              <button
                                onClick={() => {
                                  setSearchInput(control.parent_section || '');
                                  setSearchTerm(control.parent_section || '');
                                  setPage(0);
                                  setSelectedControlId(null);
                                }}
                                className="inline-flex items-center gap-1 rounded bg-primary-50 px-2 py-0.5 font-mono text-xs text-primary-700 hover:bg-primary-100"
                              >
                                <ChevronRight className="h-3.5 w-3.5" />{control.parent_section}
                              </button>
                            ) : <span className="text-slate-400">—</span>}
                          </dd>
                        </div>
                      </dl>
                      {/* Dependencies + AI confidence */}
                      <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {control.dependencies && control.dependencies.length > 0 ? (
                            control.dependencies.map((d) => (
                              <span key={d} className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 font-mono text-xs text-slate-600">
                                <Link2 className="h-3 w-3" />{d}
                              </span>
                            ))
                          ) : (
                            <span className="text-xs text-slate-400">No dependencies</span>
                          )}
                        </div>
                        {control.ai_confidence !== null && (
                          <div className="ml-auto flex items-center gap-2">
                            <span className="text-xs text-slate-500">AI confidence</span>
                            <span className={`text-sm font-semibold ${
                              control.ai_confidence >= 0.8 ? 'text-emerald-600' :
                              control.ai_confidence >= 0.5 ? 'text-amber-600' : 'text-rose-600'
                            }`}>{Math.round(control.ai_confidence * 100)}%</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Activity — status changes / evidence linked */}
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <h4 className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        <Activity className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.75} /> Activity
                      </h4>
                      {selectedImplStatus ? (
                        <ul className="space-y-2 text-sm">
                          <li className="flex items-center justify-between gap-4">
                            <span className="flex items-center gap-2 text-slate-600"><span className="h-1.5 w-1.5 rounded-full bg-primary-400" /> Current stage</span>
                            <span className="text-slate-700"><ImplStatusPill status={selectedImplStatus.status} /></span>
                          </li>
                          <li className="flex items-center justify-between gap-4">
                            <span className="flex items-center gap-2 text-slate-600"><span className="h-1.5 w-1.5 rounded-full bg-slate-300" /> Implemented</span>
                            <span className="text-slate-700">{selectedImplStatus.implementation_date || '—'}</span>
                          </li>
                          <li className="flex items-center justify-between gap-4">
                            <span className="flex items-center gap-2 text-slate-600"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Verified</span>
                            <span className="text-slate-700">{selectedImplStatus.verified_date || '—'}</span>
                          </li>
                          <li className="flex items-center justify-between gap-4">
                            <span className="flex items-center gap-2 text-slate-600"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Evidence linked</span>
                            <span className="text-slate-700">{control.evidence_count}</span>
                          </li>
                        </ul>
                      ) : (
                        <p className="text-sm text-slate-400">No tracked activity yet. {control.evidence_count} evidence item{control.evidence_count === 1 ? '' : 's'} linked.</p>
                      )}
                    </div>
                    </div>

                    {/* AI Recommendations */}
                    <div className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="mb-4 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Sparkles className="h-4 w-4 text-primary-600" />
                          <h4 className="text-sm font-semibold text-slate-800">AI Recommendations</h4>
                        </div>
                        {loadingAI === control.id && (
                          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating…
                          </span>
                        )}
                      </div>

                      {!aiRecommendations[control.id] && (
                        <div className="flex items-center gap-2 py-4 text-sm text-slate-500">
                          {loadingAI === control.id
                            ? <><Loader2 className="h-4 w-4 animate-spin" /> Generating AI recommendations…</>
                            : <span className="text-xs text-slate-400">AI recommendations are prepared automatically when you open a control.</span>}
                        </div>
                      )}

                      {aiRecommendations[control.id] && (
                        <div className="space-y-6">
                          <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
                            <Sparkles className="h-3 w-3 text-primary-400" /> Generated automatically &amp; saved for your team — no need to re-run.
                          </p>
                          <div className="rounded-lg border border-primary-200 bg-primary-50 p-4">
                            <div className="mb-3 flex items-center gap-2">
                              <ClipboardList className="h-4 w-4 text-primary-600" />
                              <h5 className="text-sm font-medium text-primary-600">Test Procedures</h5>
                            </div>
                            <div className="space-y-3">
                              {aiRecommendations[control.id].test_procedures.map((proc, idx) => (
                                <div key={idx} className="flex gap-3">
                                  <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary-50 text-xs font-medium text-primary-600">{idx + 1}</span>
                                  <div className="flex-1">
                                    <div className="mb-1 flex items-center gap-2">
                                      {getProcedureTypeBadge(proc.procedure_type)}
                                      <span className="text-xs text-slate-500">{proc.frequency}</span>
                                      {proc.sample_size !== 'N/A' && proc.sample_size !== 'N/A for inquiry' && (
                                        <span className="text-xs text-slate-500">| Sample: {proc.sample_size}</span>
                                      )}
                                    </div>
                                    <p className="text-sm text-slate-600">{proc.description}</p>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                            <div className="mb-2 flex items-center gap-2">
                              <Target className="h-4 w-4 text-emerald-600" />
                              <h5 className="text-sm font-medium text-emerald-600">Audit Focus Areas</h5>
                            </div>
                            <ul className="space-y-1">
                              {aiRecommendations[control.id].audit_focus_areas.map((area, idx) => (
                                <li key={idx} className="flex items-start gap-2 text-sm text-slate-600">
                                  <span className="mt-1 text-emerald-600">•</span>{area}
                                </li>
                              ))}
                            </ul>
                          </div>

                          {aiRecommendations[control.id].addressed_risks.length > 0 ? (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                              <div className="mb-3 flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4 text-amber-600" />
                                <h5 className="text-sm font-medium text-amber-600">Risks addressed by this control</h5>
                                <span className="text-[10px] text-slate-400">linked in the Risk Register · close when mitigated</span>
                              </div>
                              <div className="space-y-2">
                                {aiRecommendations[control.id].addressed_risks.map((r) => {
                                  const isClosed = closedRiskIds.has(r.id) || (r.status || '').toLowerCase() === 'closed';
                                  return (
                                    <div key={r.id} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3">
                                      <AlertTriangle className={`mt-0.5 h-4 w-4 flex-shrink-0 ${isClosed ? 'text-slate-300' : 'text-amber-500'}`} />
                                      <div className="min-w-0 flex-1">
                                        <Link href="/erm/risks/list" className="text-sm font-medium text-slate-800 hover:text-primary-600">{r.title}</Link>
                                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                                          {r.category && <span className="capitalize">{r.category.replace('_', ' ')}</span>}
                                          {r.residual_score != null && <span className="font-mono">· res {r.residual_score}</span>}
                                          {isClosed && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-1.5 py-0.5 text-emerald-600"><CheckCircle className="h-3 w-3" /> Closed</span>}
                                        </div>
                                      </div>
                                      {canCreate && (
                                        isClosed ? (
                                          <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-600"><CheckCircle className="h-3.5 w-3.5" /> Closed</span>
                                        ) : (
                                          <button onClick={() => closeRiskMutation.mutate(r.id)}
                                            disabled={closingRiskId === r.id}
                                            className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                                            {closingRiskId === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />} Close risk
                                          </button>
                                        )
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          ) : aiRecommendations[control.id].risks_if_not_implemented.length > 0 ? (
                            <div className="rounded-lg border border-rose-200 bg-rose-50 p-4">
                              <div className="mb-3 flex items-center gap-2">
                                <ShieldAlert className="h-4 w-4 text-rose-600" />
                                <h5 className="text-sm font-medium text-rose-600">Risks if this control isn’t implemented</h5>
                                <span className="text-[10px] text-slate-400">AI-reasoned · no risks linked yet · add to Risk Register</span>
                              </div>
                              <div className="space-y-2">
                                {aiRecommendations[control.id].risks_if_not_implemented.map((r, idx) => (
                                  <div key={idx} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3">
                                    <span className={`mt-0.5 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize ${riskSevCls(r.severity)}`}>{r.severity || 'medium'}</span>
                                    <div className="min-w-0 flex-1">
                                      <p className="text-sm font-medium text-slate-800">{r.title}</p>
                                      {r.description && <p className="mt-0.5 text-xs text-slate-500">{r.description}</p>}
                                      {r.rationale && <p className="mt-1 text-[11px] italic text-slate-400">Why: {r.rationale}</p>}
                                      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                                        {r.category && <span className="capitalize">{r.category.replace('_', ' ')}</span>}
                                        {!!r.likelihood && !!r.impact && <span>· L{r.likelihood}×I{r.impact} = {r.likelihood * r.impact}</span>}
                                      </div>
                                    </div>
                                    {canCreate && (
                                      <button onClick={() => openPromote(control, r)}
                                        className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg bg-rose-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-rose-700">
                                        <Plus className="h-3.5 w-3.5" /> Add to Risk Register
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                              <p className="text-xs text-slate-500">No register risks are linked to this control, and the AI found no residual risks to add.</p>
                              {aiRecommendations[control.id].key_risks_addressed.length > 0 && (
                                <ul className="mt-2 space-y-1">
                                  {aiRecommendations[control.id].key_risks_addressed.map((risk, idx) => (
                                    <li key={idx} className="flex items-start gap-2 text-xs text-slate-500"><span className="mt-0.5 text-amber-600">•</span>{risk}</li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Prev / Next control navigation */}
                  <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => prevControl && setSelectedControlId(prevControl.id)}
                      disabled={!prevControl}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40"
                    >
                      <ChevronLeft className="h-4 w-4" strokeWidth={1.75} /> Previous
                    </button>
                    <span className="text-[11px] text-slate-400">
                      {selectedIndex >= 0 ? `${selectedIndex + 1} of ${filteredControls.length}` : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => nextControl && setSelectedControlId(nextControl.id)}
                      disabled={!nextControl}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-40"
                    >
                      Next <ChevronRight className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                  </div>
                </div>

                {/* Recommended-evidence popup — keeps the docked inspector short */}
                <AnimatedModal
                  isOpen={showRecEvidence}
                  onClose={() => setShowRecEvidence(false)}
                  title="Recommended evidence"
                  subtitle={`${control.control_id} · ${control.evidence_requirements?.length || 0} suggested`}
                  size="lg"
                >
                  <div className="space-y-2.5 p-5">
                    {(control.evidence_requirements || []).length === 0 ? (
                      <p className="py-6 text-center text-sm text-slate-500">No recommended evidence for this control.</p>
                    ) : (
                      (control.evidence_requirements || []).map((evidence, idx) => {
                        const evTitle = evidence.name || evidence.title || 'Evidence';
                        const evType = evidence.filetype || evidence.artifact_type;
                        return (
                          <div key={idx} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3">
                            <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                              {getEvidenceTypeIcon(evType || 'document')}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <h5 className="text-sm font-medium text-slate-800">{evTitle}</h5>
                                {evType && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-700">{evType}</span>}
                              </div>
                              {evidence.description && <p className="mt-1 text-xs leading-relaxed text-slate-600">{evidence.description}</p>}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </AnimatedModal>
                </>
              );
            })()}
          </div>
        </div>
      </div>

      {/* Promote an AI risk → real ERM Risk Register entry */}
      {promoteCtx && (
        <RightSlidePanel
          isOpen
          onClose={() => setPromoteCtx(null)}
          title="Add risk to register"
          subtitle={`From control ${promoteCtx.control.control_id} — implementing it mitigates this risk`}
          width="w-full max-w-lg"
          footer={
            <div className="flex justify-end gap-2">
              <button onClick={() => setPromoteCtx(null)} className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
              <button onClick={() => promoteRiskMutation.mutate()} disabled={promoteRiskMutation.isPending || !promoteForm.title.trim()}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
                {promoteRiskMutation.isPending ? 'Adding…' : 'Add to Risk Register'}
              </button>
            </div>
          }
        >
          <div className="space-y-4">
            <p className="rounded-lg bg-rose-50 p-2 text-[11px] text-rose-700">
              Creates a real risk in the ERM Risk Register, linked to this control as a mitigation. These are the same fields as the Risk Register. Residual defaults to inherent until the control is implemented.
            </p>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Title <span className="text-rose-500">*</span></label>
              <input className={RISK_INPUT_CLS} value={promoteForm.title} onChange={(e) => setPromoteForm({ ...promoteForm, title: e.target.value })} required />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Description</label>
              <textarea className={RISK_INPUT_CLS} rows={2} value={promoteForm.description} onChange={(e) => setPromoteForm({ ...promoteForm, description: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Register Type</label>
                <select className={RISK_INPUT_CLS} value={promoteForm.register_type} onChange={(e) => setPromoteForm({ ...promoteForm, register_type: e.target.value })}>
                  <option value="">Select…</option>
                  {promoteForm.register_type && !REGISTER_TYPES.includes(promoteForm.register_type) && (
                    <option value={promoteForm.register_type}>{promoteForm.register_type}</option>
                  )}
                  {REGISTER_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Category</label>
                <select className={RISK_INPUT_CLS} value={promoteForm.category} onChange={(e) => setPromoteForm({ ...promoteForm, category: e.target.value })}>
                  {RISK_CATEGORIES.map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Sub-Category <span className="text-gray-400">(optional)</span></label>
                <input className={RISK_INPUT_CLS} value={promoteForm.risk_sub_category} onChange={(e) => setPromoteForm({ ...promoteForm, risk_sub_category: e.target.value })} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Business Owner</label>
                <select className={RISK_INPUT_CLS} value={promoteForm.business_owner_id ?? ''} onChange={(e) => setPromoteForm({ ...promoteForm, business_owner_id: e.target.value ? Number(e.target.value) : undefined })}>
                  <option value="">Unassigned</option>
                  {(usersList || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Inherent Likelihood</label>
                <select className={RISK_INPUT_CLS} value={promoteForm.likelihood} onChange={(e) => setPromoteForm({ ...promoteForm, likelihood: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Inherent Impact</label>
                <select className={RISK_INPUT_CLS} value={promoteForm.impact} onChange={(e) => setPromoteForm({ ...promoteForm, impact: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Residual Likelihood</label>
                <select className={RISK_INPUT_CLS} value={promoteForm.residual_likelihood} onChange={(e) => setPromoteForm({ ...promoteForm, residual_likelihood: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">Residual Impact</label>
                <select className={RISK_INPUT_CLS} value={promoteForm.residual_impact} onChange={(e) => setPromoteForm({ ...promoteForm, residual_impact: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Treatment Plan <span className="text-gray-400">(optional)</span></label>
              <textarea className={RISK_INPUT_CLS} rows={2} value={promoteForm.treatment_plan} onChange={(e) => setPromoteForm({ ...promoteForm, treatment_plan: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Root Cause <span className="text-gray-400">(optional)</span></label>
              <textarea className={RISK_INPUT_CLS} rows={2} value={promoteForm.root_cause} onChange={(e) => setPromoteForm({ ...promoteForm, root_cause: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Recommendations <span className="text-gray-400">(optional)</span></label>
              <textarea className={RISK_INPUT_CLS} rows={2} value={promoteForm.recommendations} onChange={(e) => setPromoteForm({ ...promoteForm, recommendations: e.target.value })} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">Due date <span className="text-gray-400">(optional)</span></label>
              <input type="date" className={RISK_INPUT_CLS} value={promoteForm.due_date} onChange={(e) => setPromoteForm({ ...promoteForm, due_date: e.target.value })} />
            </div>
          </div>
        </RightSlidePanel>
      )}
    </div>
  );
}
