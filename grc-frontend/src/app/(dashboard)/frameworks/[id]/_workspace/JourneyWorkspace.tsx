'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { certificationsApi, governanceApi, frameworkTemplatesApi } from '@/lib/api';
import apiClient from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { CertificationJourney, CertificationControl, SubControlWithEvidence, ControlEvidence } from '@/types';
import { EvidenceMaturity } from '@/app/(dashboard)/evidence/_review';
import EvidenceViewer from '@/components/evidence/EvidenceViewer';
import { SearchInput, MultiSelectDropdown } from '@/components/ui';
import { InlineIssueBadge } from '@/components/issue-management/InlineIssueBadge';
import { ErrorState, Skeleton, SkeletonRows, TabPanel, Tabs, useConfirm, useReportedMutation, useTabParam } from '@/components/ui/ds';
import { apiErrorText, safeDetail } from '@/lib/apiError';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Circle, Eye, FileCheck, Loader2, Paperclip, Radio, Sparkles, Unlink, Upload, Users, X, XCircle, CheckCircle, Shield } from 'lucide-react';
import ArtifactsTab from '@/components/compliance/ArtifactsTab';
import FrameworkRegisterTab from '../_tabs/FrameworkRegisterTab';
import FrameworkDocumentTab from '../_tabs/FrameworkDocumentTab';
import FrameworkDynamicRegisterTab from '../_tabs/FrameworkDynamicRegisterTab';
import PciCdeInventoryTab from '../_tabs/_PciCdeInventoryTab';
import HipaaEphiInventoryTab from '../_tabs/_HipaaEphiInventoryTab';
import HierarchicalRequirements from '../_tabs/HierarchicalRequirements';
import { orderRegisters, orderDocuments } from '../_tabs/templateSequence';
import { matchFrameworkFlow } from '../_data/frameworkFlows';
import {
  aliasesFor, journeyNumbers, journeyTabKeys, landingTab, openItem, recentActivity, requirementCount, TAB_ALIASES, waitingForMe, type ScopeRecordLite,
} from '@/lib/journeyModel';
import RequirementArtifactsSection from './RequirementArtifactsSection';
import JourneyHeader from './JourneyHeader';
import JourneyHome from './JourneyHome';
import OverviewTab from './OverviewTab';
import ScopeTab, { type ScopeRecord } from './ScopeTab';
import ActivityTab from './ActivityTab';
import RegistersHost, { type RegisterItem } from './RegistersHost';
import ScopeDecisionDialog from './ScopeDecisionDialog';

const getCategoryFromDomain = (domainName: string): string => {
  const name = domainName?.toLowerCase() || '';
  if (name.includes('organizational')) return 'Organizational';
  if (name.includes('people')) return 'People';
  if (name.includes('physical')) return 'Physical';
  if (name.includes('technological')) return 'Technological';
  return 'Other';
};

type CategoryFilter = 'all' | 'organizational' | 'people' | 'physical' | 'technological';
type StatusFilter = 'all' | 'implemented' | 'not_implemented' | 'partial' | 'in_progress' | 'verified';
type SortOrder = 'asc' | 'desc' | 'default';

/** The journey page: loads the journey, says so when it cannot, and hands the loaded journey to the body (whose hooks need it). */
export default function JourneyWorkspace({ journeyId }: { journeyId: number }) {
  const { data: journey, isLoading, error, refetch } = useQuery({
    queryKey: ['certification', journeyId],
    queryFn: async () => (await certificationsApi.getById(journeyId)).data as CertificationJourney,
    enabled: Number.isFinite(journeyId),
  });
  if (!Number.isFinite(journeyId)) {
    return <ErrorState title="This framework journey does not exist" message="The address is not a journey. Open the frameworks list and pick one." />;
  }
  if (isLoading) {
    return (
      <div className="space-y-[16px]" aria-busy="true">
        <Skeleton className="h-[32px] w-1/3" />
        <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-4"><Skeleton className="h-[96px]" /><Skeleton className="h-[96px]" /><Skeleton className="h-[96px]" /><Skeleton className="h-[96px]" /></div>
        <SkeletonRows rows={5} />
      </div>
    );
  }
  if (error || !journey) {
    return <ErrorState title="Couldn't load this framework journey" message={safeDetail(apiErrorText(error, 'Please try again.'))} onRetry={() => { void refetch(); }} />;
  }
  return <JourneyBody key={journeyId} journey={journey} journeyId={journeyId} />;
}

function JourneyBody({ journey, journeyId }: { journey: CertificationJourney; journeyId: number }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('frameworks:framework_library:create');
  const canEdit = hasPermission('frameworks:framework_library:edit');
  const canDelete = hasPermission('frameworks:framework_library:delete');

  const [searchQuery, setSearchQuery] = useState('');
  const [expandedControls, setExpandedControls] = useState<number[]>([]);
  // Requirement detail popup (the Requirements tab's row click, `?req=<id>`): the accordion forced open inside a frame. J2 replaces it.
  const [selectedSpineControl, setSelectedSpineControl] = useState<CertificationControl | null>(null);

  /**
   * Open/close the requirement modal AND mirror that selection into the URL as `?req=<id>` (and `?tab=controls`). Critical for
   * back-from-evidence-detail: `router.back()` inside /evidence/[id] returns to /frameworks/<fwId>?req=<reqId> and the page re-opens the
   * modal on the same requirement. replaceState keeps SPA navigation intact; Next syncs the router's search params with it.
   */
  const openSpineControl = (control: CertificationControl | null) => {
    setSelectedSpineControl(control);
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (control) {
      url.searchParams.set('req', String(control.id));
      url.searchParams.set('tab', 'controls');
    } else {
      url.searchParams.delete('req');
    }
    window.history.replaceState({}, '', url.toString());
  };

  const spineAutoOpenedFor = useRef<number | null>(null);
  useEffect(() => {
    if (!selectedSpineControl) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') openSpineControl(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedSpineControl]);
  const [expandedRequirementTextIds, setExpandedRequirementTextIds] = useState<number[]>([]);
  // Local override of per-control assessment-criteria check state (control.id -> {idx: met}). Seeded from the API's criteria_status.
  const [criteriaState, setCriteriaState] = useState<Record<number, Record<string, boolean>>>({});
  const toggleCriterion = (control: CertificationControl, idx: number) => {
    const current = criteriaState[control.id] ?? control.criteria_status ?? {};
    const next = { ...current, [String(idx)]: !current[String(idx)] };
    setCriteriaState((prev) => ({ ...prev, [control.id]: next }));
    criteriaMutation.mutate({ controlId: control.id, next, current });
  };
  // Ticking criteria moves the control's status server-side: the list and the journey's numbers must refetch. A failed tick is put back and said.
  const criteriaMutation = useReportedMutation({
    mutationFn: async ({ controlId, next }: { controlId: number; next: Record<string, boolean>; current: Record<string, boolean> }) =>
      apiClient.patch(`/certifications/${journeyId}/controls/${controlId}/criteria`, { criteria_status: next }),
    failure: "Couldn't save the tick",
    invalidate: [['certification-controls', journeyId], ['certification-progress', journeyId]],
    onError: (_e, vars) => setCriteriaState((prev) => ({ ...prev, [vars.controlId]: vars.current })),
  });
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortOrder, setSortOrder] = useState<SortOrder>('default');
  const [uploadingControlId, setUploadingControlId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: controls, isLoading: controlsLoading, error: controlsError, refetch: refetchControls } = useQuery({
    queryKey: ['certification-controls', journeyId],
    queryFn: async () => (await certificationsApi.getControls(journeyId)).data as CertificationControl[],
  });

  // The journey's numbers: the detail payload already carries them (one server pass), so there is no request of its own on open; a mutation that
  // changes them invalidates this key and they are read again.
  const { data: progress } = useQuery({
    queryKey: ['certification-progress', journeyId],
    queryFn: async () => (await certificationsApi.getProgress(journeyId)).data as any,
    initialData: (journey as any).progress,
    staleTime: Infinity,
  });
  const numbers = journeyNumbers(progress);

  const [assessingEvidenceId, setAssessingEvidenceId] = useState<number | null>(null);
  const [deletingEvidenceId, setDeletingEvidenceId] = useState<number | null>(null);
  // Evidence file currently shown in the in-browser preview modal (the minimal fields the shared viewer needs).
  const [previewEvidenceFile, setPreviewEvidenceFile] = useState<{ file_path: string; file_name: string; mime_type?: string | null; file_size?: number | null; evidence_id?: number | null } | null>(null);

  const evidenceInvalidate = [['certification-controls', journeyId], ['certification-progress', journeyId]] as const;
  const uploadEvidenceMutation = useReportedMutation({
    mutationFn: async ({ controlId, file }: { controlId: number; file: File }) => {
      const formData = new FormData();
      formData.append('file', file);
      return certificationsApi.uploadEvidence(journeyId, controlId, formData);
    },
    success: 'Evidence uploaded',
    failure: "Couldn't upload the file",
    retryable: false,
    invalidate: evidenceInvalidate,
    onSuccess: () => setUploadingControlId(null),
    onError: () => setUploadingControlId(null),
  });
  const assessEvidenceMutation = useReportedMutation({
    mutationFn: async (evidenceId: number) => apiClient.post(`/evidence-mgmt/ai/${evidenceId}/review`, null, { params: { force: true } }),
    success: 'AI review finished',
    failure: "AI couldn't review the file",
    invalidate: [...evidenceInvalidate, ['evidence-review']],
    onSuccess: () => setAssessingEvidenceId(null),
    onError: () => setAssessingEvidenceId(null),
  });
  const deleteEvidenceMutation = useReportedMutation({
    mutationFn: async (ev: { id: number; item_type?: string; linked_evidence_id?: number }) => {
      if (ev.item_type === 'ecm' && ev.linked_evidence_id) {
        // ECM-sourced item: unlink via the evidence-mgmt endpoint
        return apiClient.delete(`/evidence-mgmt/links/${ev.linked_evidence_id}/controls/${ev.id}`);
      }
      // ImplementationEvidence item: unlink via the certifications endpoint
      return apiClient.delete(`/certifications/evidence/${ev.id}`);
    },
    success: 'Evidence unlinked',
    failure: "Couldn't unlink the evidence",
    invalidate: evidenceInvalidate,
    onSuccess: () => setDeletingEvidenceId(null),
    onError: () => setDeletingEvidenceId(null),
  });
  const reviewEvidenceMutation = useReportedMutation({
    mutationFn: async ({ evidenceId, action }: { evidenceId: number; action: 'approve' | 'reject' }) =>
      apiClient.put(`/certifications/evidence/${evidenceId}/review`, { action }),
    success: (_d, v) => (v.action === 'approve' ? 'Evidence approved' : 'Evidence rejected'),
    failure: "Couldn't record the review",
    invalidate: evidenceInvalidate,
  });

  // Per-requirement assignment: current-user id (for "waiting for me") and the tenant's users.
  const [currentUserId, setCurrentUserId] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { authedFetch } = await import('@/lib/auth-fetch');
        const res = await authedFetch('/api/auth/me');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.authenticated && data.user?.id) setCurrentUserId(Number(data.user.id));
      } catch {
        /* non-fatal: "waiting for me" then lists nothing of the person's own */
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const { data: assignmentTenantUsers } = useQuery({
    queryKey: ['certification-tenant-users', journeyId],
    queryFn: async () => (await certificationsApi.getTenantUsers()).data,
  });

  // Multi-assignee picker: per-control draft list + open/closed toggle. Removing every selection acts as "withdraw".
  const [assignPickerOpenFor, setAssignPickerOpenFor] = useState<number | null>(null);
  const [assignDraftByControl, setAssignDraftByControl] = useState<Record<number, number[]>>({});
  const assignControlMutation = useReportedMutation({
    mutationFn: async ({ controlId, userIds }: { controlId: number; userIds: number[] }) => certificationsApi.assignControl(journeyId, controlId, userIds),
    success: (_d, v) => (v.userIds.length ? 'Assignment saved' : 'Assignment withdrawn'),
    failure: "Couldn't save the assignment",
    invalidate: [['certification-controls', journeyId]],
    onSuccess: (_d, vars) => {
      setAssignPickerOpenFor(null);
      setAssignDraftByControl((prev) => {
        const next = { ...prev };
        delete next[vars.controlId];
        return next;
      });
    },
  });

  const frameworkClassification = ((journey as any)?.framework_classification || '').toLowerCase();
  const fallbackName = (((journey as any)?.framework_name || journey?.framework?.name || '') as string).toLowerCase();
  const isCertificationFramework = frameworkClassification
    ? frameworkClassification === 'certification'
    : (fallbackName.includes('iso') || fallbackName.includes('pci'));
  const entityLabel = isCertificationFramework ? 'Control' : 'Requirement';
  const entityLabelPlural = isCertificationFramework ? 'Controls' : 'Requirements';

  // Applicability is keyed by the UPLOADED framework id. For flat/uploaded frameworks (NDMO) journey.framework_id is null and
  // uploaded_framework_id carries the real id.
  const appFwId: number | null = (journey as any)?.uploaded_framework_id ?? (journey as any)?.framework_id ?? null;

  // Scope decisions of this framework: one request; it feeds the Scope tab, its badge, "waiting for me" and the recent activity.
  const scopeQuery = useQuery({
    queryKey: ['applicability', appFwId],
    queryFn: async () => (await governanceApi.getFrameworkApplicability(appFwId as number)).data as { records: ScopeRecord[] },
    enabled: !!appFwId,
  });
  const records: ScopeRecord[] = scopeQuery.data?.records ?? [];

  // The dialog that asks for a scope decision (opened from a requirement row or from the requirement popup).
  const [scopeAsk, setScopeAsk] = useState<{ control: CertificationControl; applicable: boolean } | null>(null);
  const setApplicabilityMutation = useReportedMutation({
    mutationFn: async (data: { control_id: number; uploaded_framework_id: number; is_applicable: boolean; justification: string }) => governanceApi.setClauseApplicability(data),
    success: (_d, v) => ({
      title: 'Request sent to a reviewer',
      message: `The requirement stays as it is until a reviewer decides${v.is_applicable ? '' : '; if it is approved it leaves the scope'}.`,
    }),
    failure: "Couldn't send the request",
    invalidate: [['applicability'], ['certification-controls', journeyId], ['certification-progress', journeyId]],
    onSuccess: () => setScopeAsk(null),
  });
  /** Ask to put a requirement in or out of scope (the server saves every such decision as waiting for a reviewer). */
  const askScope = (control: CertificationControl, applicable: boolean) => {
    if (!appFwId) return;
    if (applicable) {
      setApplicabilityMutation.mutate({ control_id: control.parsed_control_id ?? control.id, uploaded_framework_id: appFwId, is_applicable: true, justification: '' });
    } else {
      setScopeAsk({ control, applicable: false });
    }
  };

  const toggleControl = (controlId: number) => {
    setExpandedControls(prev => (prev.includes(controlId) ? prev.filter(id => id !== controlId) : [...prev, controlId]));
  };

  const handleFileUpload = (controlId: number, event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setUploadingControlId(controlId);
      uploadEvidenceMutation.mutate({ controlId, file });
    }
    if (event.target) {
      event.target.value = '';
    }
  };

  // Natural sort comparison for section/clause numbers (e.g., "1.2.10" should come after "1.2.9")
  const naturalSortCompare = (a: string, b: string): number => {
    const parts = (s: string) => (s || '').split(/[.\-_\s]+/).map(p => { const num = parseInt(p, 10); return isNaN(num) ? p.toLowerCase() : num; });
    const aParts = parts(a);
    const bParts = parts(b);
    const maxLen = Math.max(aParts.length, bParts.length);
    for (let i = 0; i < maxLen; i++) {
      const aPart = aParts[i] ?? '';
      const bPart = bParts[i] ?? '';
      if (typeof aPart === 'number' && typeof bPart === 'number') {
        if (aPart !== bPart) return aPart - bPart;
      } else if (typeof aPart === 'number') {
        return -1; // Numbers come before strings
      } else if (typeof bPart === 'number') {
        return 1;
      } else {
        const cmp = String(aPart).localeCompare(String(bPart));
        if (cmp !== 0) return cmp;
      }
    }
    return 0;
  };

  // Domain -> document-order rank, derived from the API response order (the backend returns controls in the framework's published sequence).
  const domainOrderRank = (() => {
    const m = new Map<string, number>();
    (controls || []).forEach((c: CertificationControl) => {
      const d = (c.domain_name || '').toLowerCase().trim();
      if (!m.has(d)) m.set(d, m.size);
    });
    return m;
  })();

  const filteredControls = controls?.filter((control: CertificationControl) => {
    // Controls approved as Not Applicable are not listed: they stay reversible from the Scope & decisions tab.
    if (control.is_applicable === false) return false;
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesSearch =
        control.control_code?.toLowerCase().includes(query) ||
        control.control_name?.toLowerCase().includes(query) ||
        control.control_statement?.toLowerCase().includes(query) ||
        control.sub_control_tree?.some((n) => `${n.lead_in ?? ''} ${n.text}`.toLowerCase().includes(query));
      if (!matchesSearch) return false;
    }
    if (categoryFilter !== 'all') {
      const category = getCategoryFromDomain(control.domain_name).toLowerCase();
      if (category !== categoryFilter) return false;
    }
    if (statusFilter !== 'all') {
      if (statusFilter === 'not_implemented' && control.status !== 'not_started') return false;
      if (statusFilter === 'implemented' && !['implemented', 'verified'].includes(control.status)) return false;
      if (statusFilter === 'partial' && control.status !== 'in_progress') return false;
      if (statusFilter === 'in_progress' && control.status !== 'in_progress') return false;
      if (statusFilter === 'verified' && control.status !== 'verified') return false;
    }
    return true;
  }).sort((a: CertificationControl, b: CertificationControl) => {
    // Order by domain document-sequence first, then natural code within the domain (DG.1.1 < DG.1.2 < DG.2.1).
    const da = domainOrderRank.get((a.domain_name || '').toLowerCase().trim()) ?? 9999;
    const db = domainOrderRank.get((b.domain_name || '').toLowerCase().trim()) ?? 9999;
    if (da !== db) return sortOrder === 'desc' ? db - da : da - db;
    const codeA = a.original_control_code || a.system_control_code || a.control_code || '';
    const codeB = b.original_control_code || b.system_control_code || b.control_code || '';
    const result = naturalSortCompare(codeA, codeB);
    return sortOrder === 'desc' ? -result : result;
  }) || [];

  // Group the (already filtered + sorted) controls into hierarchy sections for the requirements "progress spine". Section key is the leading
  // numeric prefix of the control code (e.g. "1.2" -> section "1") with `domain_name` as fallback for non-numeric clause ids.
  type RequirementSection = { key: string; label: string; sectionNumber: number | null; controls: CertificationControl[] };
  const requirementSections: RequirementSection[] = (() => {
    const map = new Map<string, RequirementSection>();
    for (const c of filteredControls) {
      const code = String((c as any).control_code || (c as any).original_control_code || '').trim();
      const numericPrefix = code.match(/^\s*(\d+)/)?.[1];
      const key = numericPrefix ? `num:${numericPrefix}` : `dom:${(c.domain_name || 'general').toLowerCase().trim()}`;
      const label = c.domain_name || (numericPrefix ? `Section ${numericPrefix}` : 'General');
      if (!map.has(key)) map.set(key, { key, label, sectionNumber: numericPrefix ? Number(numericPrefix) : null, controls: [] });
      map.get(key)!.controls.push(c);
    }
    const list = Array.from(map.values());
    list.sort((a, b) => {
      if (a.sectionNumber !== null && b.sectionNumber !== null) return a.sectionNumber - b.sectionNumber;
      if (a.sectionNumber !== null) return -1;
      if (b.sectionNumber !== null) return 1;
      // Letter-coded frameworks (e.g. NDMO: DG, MCM, DQ...) carry no numeric section prefix: keep the API order (the published sequence).
      return 0;
    });
    return list;
  })();

  // ── the numbers the requirement spine and the header read (one model: lib/journeyModel.ts; "implemented" already holds the verified ones) ──
  const totalControlsProgress = numbers?.applicable ?? 0;          // the requirements in scope: every share on this page is of these
  const implementedCount = numbers?.implemented ?? 0;
  const inProgressCount = numbers?.inProgress ?? 0;
  const completionPercentage = numbers?.implementedPct ?? 0;

  const isPciDssFramework = (((journey as any)?.framework_name || journey?.framework?.name || '') as string).toLowerCase().includes('pci');
  // ISO 27001 template tabs (Gap Analysis, Internal Audit, Risk Treatment, Scope Statement, Audit Procedure) are gated to the ISO 27001 framework.
  const _fwNameNorm = (((journey as any)?.framework_name || journey?.framework?.name || journey?.name || '') as string).toLowerCase().replace(/[^a-z0-9]/g, '');
  const isIso27001Framework = _fwNameNorm.includes('27001') && _fwNameNorm.includes('iso');
  const templateTenantUsers = useMemo(
    () => (assignmentTenantUsers || []).map((u: any) => ({ id: u.id, name: u.display_name || u.email || String(u.id) })),
    [assignmentTenantUsers]
  );
  const templateFrameworkControls = useMemo(
    () => ((controls as any[]) || [])
      .map((c: any) => ({ code: c.control_code || c.original_reference || '', title: c.control_name || c.title || '' }))
      .filter((c: any) => c.code),
    [controls]
  );
  const templateFrameworkName = (((journey as any)?.framework_name || journey?.framework?.name || journey?.name || '') as string);
  // Canonical end-to-end journey flow for this framework, if one is mapped: it adds the Journey tab.
  const journeyFlow = useMemo(() => matchFrameworkFlow(templateFrameworkName), [templateFrameworkName]);
  const { data: fwTemplateDef, isLoading: fwTemplateLoading } = useQuery({
    queryKey: ['ft-definition', templateFrameworkName],
    queryFn: async () => (await frameworkTemplatesApi.definition(templateFrameworkName)).data as {
      matched: boolean;
      display_name?: string;
      registers: Array<{ type: string; label: string; description?: string; columns: any[]; formSections?: any[]; assetSource?: string }>;
      documents: Array<{ type: string; label: string; control_ref?: string | null }>;
    },
    enabled: !!templateFrameworkName,
  });

  const toggleRequirementText = (controlId: number) => {
    setExpandedRequirementTextIds((prev) => (prev.includes(controlId) ? prev.filter((id) => id !== controlId) : [...prev, controlId]));
  };

  // The framework's own registers and documents, listed stage-wise (templateSequence), live behind the one Registers tab.
  const registerItems: RegisterItem[] = useMemo(() => [
    ...orderRegisters([
      ...(isIso27001Framework ? [
        { id: 'gap-analysis', label: 'Gap Analysis' },
        { id: 'internal-audit', label: 'Internal Audit' },
        { id: 'risk-treatment', label: 'Risk Treatment' },
      ] : []),
      ...(fwTemplateDef?.registers || []).map((r) => ({ id: r.type, label: r.label })),
    ]).map((t) => ({ id: String(t.id), label: t.label, kind: 'register' as const })),
    ...orderDocuments([
      ...(isIso27001Framework ? [
        { id: 'scope-statement', label: 'Scope Statement' },
        { id: 'audit-procedure', label: 'Audit Procedure' },
      ] : []),
      ...(fwTemplateDef?.documents || []).map((d) => ({ id: d.type, label: d.label })),
    ]).map((t) => ({ id: String(t.id), label: t.label, kind: 'document' as const })),
  ], [isIso27001Framework, fwTemplateDef]);
  const templateKeys = useMemo(() => registerItems.map((i) => i.id), [registerItems]);

  // ── the tabs: kit Tabs, the open one kept in the address (?tab=), every old address still opens the tab that holds its content ──
  const hasFlow = !!journeyFlow;
  const tabKeys = journeyTabKeys({ hasFlow, templateKeys });
  const [tab, setTab] = useTabParam<string>('tab', tabKeys, { fallback: landingTab(hasFlow), aliases: aliasesFor(templateKeys) });
  const search = typeof window === 'undefined' ? '' : window.location.search;
  const item = openItem(search, templateKeys);
  const setItem = (id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('tab', 'registers');
    url.searchParams.set('item', id);
    router.replace(`${url.pathname}?${url.searchParams.toString()}`, { scroll: false });
  };

  // `?req=<id>` in the address (a link from My Work, or the Back button from an evidence page) opens the requirement popup once the list is here.
  useEffect(() => {
    if (typeof window === 'undefined' || !controls || controls.length === 0) return;
    const reqRaw = new URL(window.location.href).searchParams.get('req');
    if (!reqRaw) return;
    const reqId = Number(reqRaw);
    if (!Number.isFinite(reqId) || spineAutoOpenedFor.current === reqId) return;
    const match = (controls as CertificationControl[]).find((c) => c.id === reqId || c.parsed_control_id === reqId);
    if (!match) return;
    spineAutoOpenedFor.current = reqId;
    setTab('controls');
    setSelectedSpineControl(match);
  }, [controls]);

  // Snapshots (Activity tab and the recent-activity line of the Journey tab).
  const { data: snapshots, isLoading: snapshotsLoading, error: snapshotsError, refetch: refetchSnapshots } = useQuery({
    queryKey: ['compliance-snapshots', journeyId],
    queryFn: async () => (await apiClient.get(`/certifications/${journeyId}/snapshots`)).data as Array<{
      id: number; year: number | null; label: string | null; captured_at: string | null; overall_pct: number; compliant_count: number; total_count: number;
      breakdown: { tiers?: Record<string, { total: number; compliant: number; avg: number }>; domains?: Array<{ domain: string; total: number; compliant: number; avg: number }> };
      notes: string | null;
    }>,
  });

  const waiting = waitingForMe({ controls, userId: currentUserId, canReview: canEdit, records: records as ScopeRecordLite[] });
  const activity = recentActivity({ records, snapshots, limit: 5 });
  // "Need you" is a number only when what it counts has been read: the person is known and the requirements (and, for a reviewer, the scope decisions) are here.
  const waitingKnown = !!controls && !controlsError && currentUserId !== null && (!canEdit || !appFwId || (!scopeQuery.isLoading && !scopeQuery.error));
  const waitingTotal = waitingKnown ? waiting.total : null;

  // The registers/documents tab is addressed by an old ?tab=<type>: until the template definition is here, show a loader, not the landing tab.
  const rawTab = typeof window === 'undefined' ? '' : new URLSearchParams(window.location.search).get('tab') || '';
  const waitingForTemplates = fwTemplateLoading && !!rawTab && tabKeys.indexOf(rawTab) < 0 && !Object.prototype.hasOwnProperty.call(TAB_ALIASES, rawTab);

  const renderRegisterItem = (id: string) => {
    const dynReg = (fwTemplateDef?.registers || []).find((r) => r.type === id);
    if (dynReg) {
      // Asset-backed inventory (PCI CDE / HIPAA ePHI) -> dedicated Assets CRUD tab; everything else -> the generic dynamic register table.
      if (dynReg.assetSource === 'ephi') return <HipaaEphiInventoryTab journeyId={journeyId} frameworkName={templateFrameworkName} tenantUsers={templateTenantUsers as any} />;
      if (dynReg.assetSource === 'cde') return <PciCdeInventoryTab journeyId={journeyId} frameworkName={templateFrameworkName} tenantUsers={templateTenantUsers as any} />;
      return <FrameworkDynamicRegisterTab config={dynReg} journeyId={journeyId} frameworkId={appFwId} frameworkName={templateFrameworkName} tenantUsers={templateTenantUsers} frameworkControls={templateFrameworkControls} />;
    }
    const dynDoc = (fwTemplateDef?.documents || []).find((d) => d.type === id);
    if (dynDoc) return <FrameworkDocumentTab docType={dynDoc.type} journeyId={journeyId} frameworkId={appFwId} frameworkName={templateFrameworkName} tenantUsers={templateTenantUsers} />;
    const isoName = (journey as any)?.framework_name || 'ISO 27001';
    switch (id) {
      case 'gap-analysis':
        return <FrameworkRegisterTab registerType="gap_analysis" journeyId={journeyId} frameworkId={appFwId} frameworkName={isoName} tenantUsers={templateTenantUsers} frameworkControls={templateFrameworkControls} />;
      case 'internal-audit':
        return <FrameworkRegisterTab registerType="internal_audit" journeyId={journeyId} frameworkId={appFwId} frameworkName={isoName} tenantUsers={templateTenantUsers} frameworkControls={templateFrameworkControls} />;
      case 'risk-treatment':
        return <FrameworkRegisterTab registerType="risk_treatment" journeyId={journeyId} frameworkId={appFwId} frameworkName={isoName} tenantUsers={templateTenantUsers} frameworkControls={templateFrameworkControls} />;
      case 'scope-statement':
        return <FrameworkDocumentTab docType="isms_scope_statement" journeyId={journeyId} frameworkId={appFwId} frameworkName={isoName} tenantUsers={templateTenantUsers} />;
      case 'audit-procedure':
        return <FrameworkDocumentTab docType="internal_audit_procedure" journeyId={journeyId} frameworkId={appFwId} frameworkName={isoName} tenantUsers={templateTenantUsers} />;
      default:
        return null;
    }
  };
  const renderControlAccordion = (
    control: CertificationControl,
    showUpload = true,
    forceExpanded = false,
  ) => {
    // `forceExpanded` is set when the accordion is rendered inside the
    // spine's detail modal — the modal is the user's explicit request
    // for the deep view, so it stays open regardless of the per-row
    // expanded state used for the legacy inline-accordion tabs.
    const isExpanded = forceExpanded || expandedControls.includes(control.id);
    const category = getCategoryFromDomain(control.domain_name);
    const statusConfig: Record<string, { label: string; color: string }> = {
      not_started: { label: 'Not Implemented', color: 'bg-rose-50 text-rose-700' },
      in_progress: { label: 'Partial', color: 'bg-amber-50 text-amber-700' },
      implemented: { label: 'Implemented', color: 'bg-emerald-50 text-emerald-700' },
      verified: { label: 'Verified', color: 'bg-primary-50 text-primary-700' },
      not_applicable: { label: 'N/A', color: 'bg-slate-50 text-slate-700' },
    };
    const status = statusConfig[control.status] || statusConfig.not_started;
    const evidenceCount = control.evidence_count ?? (control.evidence ? control.evidence.length : 0);
    const requiredEvidenceCount = control.required_evidence_count ?? (control.evidence_requirements ? control.evidence_requirements.length : 0);
    const approvedEvidenceCount = control.approved_evidence_count ?? (control.evidence ? control.evidence.filter((ev) => ev.review_status === 'approved').length : 0);
    const hasEvidence = evidenceCount > 0;
    const evidenceCoverageValue = control.evidence_coverage ?? (requiredEvidenceCount > 0 ? Math.min(1, evidenceCount / requiredEvidenceCount) : hasEvidence ? 1 : 0);
    const isRequirementTextExpanded = expandedRequirementTextIds.includes(control.id);
    const requirementTextFull = control.control_statement_full || control.control_statement || '';
    const requirementTextShort = control.control_statement || requirementTextFull;
    const hasLongRequirementText = requirementTextFull.length > 160;
    
    return (
      <div id={`control-${control.id}`} key={control.id} className={forceExpanded ? '' : 'rounded-lg border border-slate-200 bg-white'}>
        {/* Accordion header. Hidden when forceExpanded is set — the
            spine modal owns its own header (code + name + scope/badge
            action bar) and rendering this row inside the modal would
            duplicate the title. Keyboard support is preserved via
            tabIndex + Enter/Space when the row is interactive. */}
        {!forceExpanded && (
        <div
          role="button"
          tabIndex={0}
          onClick={() => toggleControl(control.id)}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
              e.preventDefault();
              toggleControl(control.id);
            }
          }}
          className="flex w-full items-center justify-between p-4 text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded-lg"
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {isExpanded ? (
              <ChevronDown className="h-4 w-4 text-slate-600 flex-shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 text-slate-600 flex-shrink-0" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm text-primary-700">{control.control_code}</span>
                <span className="font-medium text-slate-900">{control.control_name}</span>
                {/* v2 Issue Management — show open-issue badge against this
                    control. Hides itself when there are none. Type guard via
                    `as any` matches the wider control-object pattern used
                    elsewhere in this file. */}
                {(() => {
                  const c = control as { framework_control_id?: number | null; parsed_control_id?: number | null };
                  if (c.framework_control_id) {
                    return <InlineIssueBadge sourceType="control_framework" sourceId={c.framework_control_id} />;
                  }
                  if (c.parsed_control_id) {
                    return <InlineIssueBadge sourceType="control_parsed" sourceId={c.parsed_control_id} />;
                  }
                  return null;
                })()}
              </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                    Original: {control.original_control_code || control.control_code}
                  </span>
                  <span className="rounded bg-primary-50 px-2 py-0.5 text-xs text-primary-700">
                    System: {control.system_control_code || control.control_code}
                  </span>
                </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 ml-4">
            {control.is_critical && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-1 text-xs font-medium text-rose-700"
                title={control.criticality_reason || 'AI-flagged critical clause — requires reviewer approval to mark Not Applicable'}
              >
                <AlertTriangle className="h-3 w-3" />
                Critical
              </span>
            )}
            <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">{category}</span>
            {/* Inline scope toggle — one click flips applicability without
                opening the modal. Critical clauses still route the
                out-of-scope direction through the modal so the reviewer
                warning + justification step is preserved (backend records
                their decision as pending until approved). */}
            <div
              role="group"
              aria-label="Requirement scope"
              className="relative z-10 inline-flex items-center overflow-hidden rounded-lg border border-slate-300 text-xs"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                disabled={setApplicabilityMutation.isPending}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (control.is_applicable || !appFwId) return;
                  const parsedId = control.parsed_control_id ?? control.id;
                  setApplicabilityMutation.mutate({
                    control_id: parsedId,
                    uploaded_framework_id: appFwId,
                    is_applicable: true,
                    justification: '',
                  });
                }}
                title="Mark this requirement as part of scope"
                className={`px-2.5 py-1 transition-colors cursor-pointer disabled:opacity-50 ${control.is_applicable
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white text-slate-600 hover:bg-emerald-50 hover:text-emerald-700'}`}
              >
                In Scope
              </button>
              <button
                type="button"
                disabled={setApplicabilityMutation.isPending}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (!control.is_applicable || !appFwId) return;
                  // Always prompt for justification when marking Not Applicable —
                  // the audit trail needs a documented reason regardless of
                  // whether the clause was AI-flagged as critical. (Critical
                  // clauses get the additional reviewer-approval banner inside
                  // the modal; non-critical ones skip straight to a recorded
                  // decision.)
                  askScope(control, false);
                }}
                title="Mark this requirement as out of scope (justification required)"
                className={`border-l border-slate-300 px-2.5 py-1 transition-colors cursor-pointer disabled:opacity-50 ${!control.is_applicable
                  ? 'bg-rose-600 text-white'
                  : 'bg-white text-slate-600 hover:bg-rose-50 hover:text-rose-700'}`}
              >
                Out of Scope
              </button>
            </div>
            <span className={`rounded-lg px-2 py-1 text-xs ${status.color}`}>{status.label}</span>
            <span className="text-xs text-slate-500">{approvedEvidenceCount}/{requiredEvidenceCount || '—'} approved</span>
            <span className="text-xs text-slate-500">{evidenceCount}/{requiredEvidenceCount || '—'} evidence</span>
            <div className="flex items-center gap-1">
              <Circle className={`h-4 w-4 ${hasEvidence ? 'text-emerald-600 fill-emerald-600' : 'text-slate-300'}`} />
              <span className="text-[10px] text-slate-500">{Math.round(evidenceCoverageValue * 100)}%</span>
            </div>
          </div>
        </div>
        )}
        {isExpanded && (
          <div className={forceExpanded ? '' : 'border-t border-slate-200 p-4'}>
            {/* Figure-2 identity fields — labelled (bold heading + value), one
                per field, so every value is clearly named (Domain Name, Domain
                ID, Control Name, Control ID, Priority, Version, Dependencies). */}
            {control.priority_level && (() => {
              const pl = control.priority_level || '';
              const domainId = (control.control_code || '').split('.')[0] || '—';
              const catRaw = control.objective_name || control.objective_code || '';
              const controlId = catRaw.includes(':')
                ? catRaw.split(':')[0].trim()
                : (control.control_code || '').split('.').slice(0, 2).join('.');
              const controlName = catRaw.includes(':')
                ? catRaw.split(':').slice(1).join(':').trim()
                : (catRaw || '—');
              const plMeta: Record<string, { yr: string; cls: string }> = {
                P1: { yr: 'Year 1', cls: 'bg-rose-50 text-rose-700' },
                P2: { yr: 'Year 2', cls: 'bg-amber-50 text-amber-700' },
                P3: { yr: 'Year 3', cls: 'bg-emerald-50 text-emerald-700' },
              };
              const m = plMeta[pl];
              const ver = (control.version_history && control.version_history[0]) || null;
              const L = 'text-[11px] font-bold uppercase tracking-wide text-slate-500';
              const V = 'mt-0.5 text-sm font-medium text-slate-800';
              const MONO = 'mt-0.5 font-mono text-sm font-semibold text-primary-700';
              return (
                <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50/40 px-4 py-3.5">
                  <div className="grid grid-cols-1 gap-x-10 gap-y-3 sm:grid-cols-2">
                    <div><p className={L}>Domain Name</p><p className={V}>{control.domain_name}</p></div>
                    <div><p className={L}>Domain ID</p><p className={MONO}>{domainId}</p></div>
                    <div><p className={L}>Control Name</p><p className={V}>{controlName}</p></div>
                    <div><p className={L}>Control ID</p><p className={MONO}>{controlId}</p></div>
                    <div>
                      <p className={L}>Priority</p>
                      <p className="mt-0.5"><span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${m ? m.cls : 'bg-slate-100 text-slate-600'}`}>{pl}{m ? ` · ${m.yr}` : ''}</span></p>
                    </div>
                    <div><p className={L}>Version</p><p className="mt-0.5 text-sm text-slate-700">{ver ? `${ver.version || '—'}${ver.date ? ' · ' + ver.date : ''}` : '—'}</p></div>
                    {control.control_description && (
                      <div className="sm:col-span-2 border-t border-slate-200 pt-3">
                        <p className={L}>Control Description</p>
                        <p className="mt-0.5 text-sm leading-relaxed text-slate-700">{control.control_description}</p>
                      </div>
                    )}
                    <div className="sm:col-span-2">
                      <p className={L}>Dependencies</p>
                      <p className="mt-0.5 text-sm text-slate-700">{control.dependencies && control.dependencies.length ? control.dependencies.join(', ') : 'None'}</p>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Specification requirement text (Figure-2 "Control Specification").
                Hidden for single-statement specs (exactly 1 criterion) since that
                criterion already shows the full requirement as the tickable item. */}
            {control.control_statement && control.assessment_criteria?.length !== 1 && (
              <div className="mb-3">
                {control.priority_level && (
                  <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">Control Specification</p>
                )}
                <p className={`text-sm whitespace-pre-wrap break-words ${forceExpanded
                  ? 'rounded-lg border border-slate-200 bg-slate-50 p-4 leading-relaxed text-slate-700'
                  : 'text-slate-600'}`}>
                  {control.control_statement}
                </p>
              </div>
            )}

            {/* Assessment Criteria — weighted score calculator. Each criterion
                carries equal weight (100 / N); the spec score is the sum of met
                weights. Compliant only at 100% (all met) — NDMO-consistent. */}
            {control.assessment_criteria && control.assessment_criteria.length > 0 && (() => {
              const crits = control.assessment_criteria;
              const st = criteriaState[control.id] ?? control.criteria_status ?? {};
              const met = crits.filter((_, i) => st[String(i)]).length;
              const weight = Math.round(100 / crits.length);
              const pct = Math.round((met / crits.length) * 100);
              const status = pct === 100
                ? { label: 'Compliant', cls: 'bg-emerald-50 text-emerald-700', bar: 'bg-emerald-500' }
                : pct > 0
                  ? { label: 'In Progress', cls: 'bg-amber-50 text-amber-700', bar: 'bg-amber-500' }
                  : { label: 'Not Started', cls: 'bg-slate-100 text-slate-500', bar: 'bg-slate-300' };
              return (
                <div className="mb-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <div className="border-b border-slate-100 bg-slate-50/60 px-4 py-2.5">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Assessment Criteria</p>
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.cls}`}>{status.label}</span>
                        <span className="text-sm font-bold text-slate-800">{pct}%</span>
                        <span className="text-xs text-slate-400">· {met}/{crits.length}</span>
                      </div>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full rounded-full transition-all ${status.bar}`} style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <ul className="divide-y divide-slate-50">
                    {crits.map((c, i) => {
                      const checked = !!st[String(i)];
                      return (
                        <li key={i}>
                          <button
                            type="button"
                            onClick={() => toggleCriterion(control, i)}
                            className="flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors hover:bg-slate-50"
                          >
                            <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] leading-none ${checked ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white text-transparent'}`}>✓</span>
                            <span className={`flex-1 text-[13px] leading-relaxed ${checked ? 'text-slate-700' : 'text-slate-600'}`}>
                              <span className="mr-1 font-mono text-xs text-slate-400">{i + 1}.</span>{c}
                            </span>
                            <span className="mt-0.5 shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">{weight}%</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
                    Each criterion = {weight}%. All must be met (with evidence) for this requirement to score 100%.
                  </div>
                </div>
              );
            })()}

            {/* Compliance Artifacts — inline per-requirement view of catalog
                items + tenant-created artifacts that match this clause's
                control_ref. Hidden when the framework has no artifact catalog
                or no items match this clause. Only mounted when the row is
                expanded so we don't fan out N queries on initial render. */}
            <RequirementArtifactsSection
              control={control}
              frameworkLabel={(journey as any)?.framework_name || journey?.name || ''}
              tenantUsers={(assignmentTenantUsers || []).map((u: any) => ({
                id: u.id,
                label: u.display_name || u.email || String(u.id),
                email: u.email ?? null,
              }))}
            />

            {/* Sub-controls section - recursive hierarchy */}
            {/* {control.sub_controls && control.sub_controls.length > 0 && (
              <div className="mb-6">
                <h4 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Layers className="h-4 w-4 text-primary-700" />
                  {entityLabel} Hierarchy ({control.sub_controls.length} sub-controls)
                </h4>
                {renderSubControlsRecursive(control.sub_controls, 0)}
              </div>
            )} */}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Linked Evidence - Now appears FIRST (left column) */}
              <div>
                {/* Compact "Assigned to" row, sitting above the evidence
                    upload control. Shows a count + names summary at a glance,
                    expands to the global MultiSelectDropdown picker on click.
                    Multi-assignee: any combination of users; clearing all
                    selections withdraws every assignment. */}
                {(() => {
                  const serverIds: number[] = control.assigned_user_ids
                    || (control.assigned_to_user_id ? [control.assigned_to_user_id] : []);
                  const serverNames = (control.assignees && control.assignees.length > 0)
                    ? control.assignees.map((a) => a.display_name)
                    : (control.assignee_name ? [control.assignee_name] : []);
                  const draftIds = assignDraftByControl[control.id] ?? serverIds;
                  const isOpen = assignPickerOpenFor === control.id;
                  const isPendingForThis = assignControlMutation.isPending
                    && assignControlMutation.variables?.controlId === control.id;
                  const isDirty = JSON.stringify([...draftIds].sort())
                    !== JSON.stringify([...serverIds].sort());

                  return (
                    <div className="mb-2">
                      <div className="flex items-start gap-2 text-xs">
                        <Users className="h-3.5 w-3.5 text-slate-500 mt-1 flex-shrink-0" />
                        <span className="text-slate-500 mt-1 flex-shrink-0">Assigned to:</span>
                        {serverNames.length === 0 ? (
                          <span className="italic text-slate-400 mt-1">Unassigned</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {serverNames.map((name, idx) => (
                              <span
                                key={`${idx}-${name}`}
                                className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700"
                              >
                                {name}
                              </span>
                            ))}
                          </div>
                        )}
                        {canEdit && !isOpen && (
                          <button
                            type="button"
                            onClick={() => {
                              setAssignDraftByControl((prev) => ({ ...prev, [control.id]: serverIds }));
                              setAssignPickerOpenFor(control.id);
                            }}
                            className="ml-auto flex items-center gap-1 rounded bg-primary-600 px-3 py-1.5 text-xs font-medium text-[color:var(--color-on-base,#0a0a0a)] hover:bg-primary-700"
                          >
                            {serverNames.length ? 'Change' : 'Assign'}
                          </button>
                        )}
                      </div>

                      {isOpen && (
                        <div className="mt-2 flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <MultiSelectDropdown
                              title="Assignees"
                              items={(assignmentTenantUsers || []).map((u: any) => ({
                                value: String(u.id),
                                label: u.display_name || u.username || u.email || `User #${u.id}`,
                                subLabel: u.email,
                              }))}
                              selectedValues={draftIds.map(String)}
                              onApply={(values) =>
                                setAssignDraftByControl((prev) => ({
                                  ...prev,
                                  [control.id]: values.map(Number),
                                }))
                              }
                              multiSelect
                              autoApply
                              forceSearch
                              triggerVariant="input"
                              triggerClassName="w-full"
                              placeholder={
                                draftIds.length === 0
                                  ? 'Select users...'
                                  : `${draftIds.length} selected`
                              }
                              searchPlaceholder="Search users"
                              size="sm"
                            />
                          </div>
                          {/* Assign button — same dimensions as the Upload button below. */}
                          <button
                            type="button"
                            onClick={() =>
                              assignControlMutation.mutate({
                                controlId: control.id,
                                userIds: draftIds,
                              })
                            }
                            disabled={!isDirty || isPendingForThis}
                            className="flex items-center gap-1 rounded bg-primary-600 px-3 py-1.5 text-xs font-medium text-[color:var(--color-on-base,#0a0a0a)] hover:bg-primary-700 disabled:bg-slate-400 disabled:cursor-not-allowed"
                          >
                            {isPendingForThis ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Check className="h-3 w-3" />
                            )}
                            {draftIds.length === 0 ? 'Withdraw' : 'Assign'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setAssignPickerOpenFor(null)}
                            className="rounded border border-slate-300 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                          >
                            Close
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div className="flex items-center justify-between mb-4">
                  <h4 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                    <Paperclip className="h-4 w-4 text-primary-700" />
                    Linked Evidence ({evidenceCount})
                  </h4>
                  {showUpload && canCreate && (
                    <label className="cursor-pointer">
                      <input
                        type="file"
                        className="hidden"
                        onChange={(e) => handleFileUpload(control.id, e)}
                        disabled={uploadingControlId === control.id}
                      />
                      <span className="flex items-center gap-1 rounded bg-primary-600 px-3 py-1.5 text-xs font-medium text-[color:var(--color-on-base,#0a0a0a)] hover:bg-primary-700">
                        {uploadingControlId === control.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Upload className="h-3 w-3" />
                        )}
                        Upload
                      </span>
                    </label>
                  )}
                </div>
                {control.evidence?.length > 0 ? (
                  <div className="space-y-2">
                    {control.evidence.map((ev: ControlEvidence) => {
                      const getAIAssessmentBadge = () => {
                        const status = ev.ai_assessment_status || 'pending';
                        switch (status) {
                          case 'completed':
                            return { label: 'Assessed', className: 'bg-emerald-50 text-emerald-700' };
                          case 'processing':
                            return { label: 'Assessing...', className: 'bg-amber-50 text-amber-700' };
                          case 'pending_assessment':
                            return { label: 'Ready for Assessment', className: 'bg-primary-50 text-primary-700' };
                          case 'pending_ocr':
                            return { label: 'Processing...', className: 'bg-slate-50 text-slate-700' };
                          default:
                            return { label: 'Pending', className: 'bg-slate-50 text-slate-700' };
                        }
                      };
                      const aiBadge = getAIAssessmentBadge();
                      const canAssess = ev.ai_assessment_status === 'pending_assessment' || ev.ai_assessment_status === 'pending' || !ev.ai_assessment_status;
                      const isAssessing = assessingEvidenceId === ev.id;
                      const isPendingReview = ev.review_status === 'pending';
                      
                      return (
                        <div key={ev.id} className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                          <div className="flex items-center gap-3">
                            <Paperclip className="h-4 w-4 text-slate-600 flex-shrink-0" />
                            {ev.linked_evidence_id ? (
                              <Link
                                href={`/evidence/${ev.linked_evidence_id}`}
                                className="flex-1 min-w-0 group"
                                title="Open evidence detail"
                              >
                                <p className="text-sm text-slate-900 truncate group-hover:text-primary-700 group-hover:underline">{ev.file_name || 'Evidence file'}</p>
                                <p className="text-xs text-slate-500">{ev.uploaded_at ? new Date(ev.uploaded_at).toLocaleDateString() : ''}</p>
                              </Link>
                            ) : (
                              <div className="flex-1 min-w-0">
                                <p className="text-sm text-slate-900 truncate">{ev.file_name || 'Evidence file'}</p>
                                <p className="text-xs text-slate-500">{ev.uploaded_at ? new Date(ev.uploaded_at).toLocaleDateString() : ''}</p>
                              </div>
                            )}
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {ev.sub_control_code && (
                                <span className="rounded bg-[#f3f6f8] px-1.5 py-0.5 font-mono text-[10px] text-[#5a6670]" title="Attached to this sub-control">{ev.sub_control_code}</span>
                              )}
                              {ev.linked_evidence_id ? (
                                <EvidenceMaturity evidenceId={ev.linked_evidence_id} refresh={['certification-controls']} />
                              ) : (
                                <span className={`rounded px-2 py-0.5 text-xs ${aiBadge.className}`} title={ev.ai_assessment_summary || ''}>
                                  {aiBadge.label}
                                </span>
                              )}
                              <span className={`rounded px-2 py-0.5 text-xs ${
                                ev.review_status === 'approved' ? 'bg-emerald-50 text-emerald-700' :
                                ev.review_status === 'rejected' ? 'bg-rose-50 text-rose-700' :
                                'bg-amber-50 text-amber-700'
                              }`}>
                                {ev.review_status}
                              </span>
                            </div>
                          </div>
                          {ev.ai_assessment_summary && (
                            <div className="mt-2 ml-7 rounded bg-white border border-slate-200 p-2">
                              <p className="text-xs text-slate-700">{ev.ai_assessment_summary}</p>
                            </div>
                          )}
                          {/* Action buttons row */}
                          <div className="mt-3 ml-7 flex items-center gap-2 flex-wrap">
                            {ev.file_path && (
                              <button
                                onClick={() => setPreviewEvidenceFile({
                                  // Set evidence_id so the viewer hits
                                  // /evidence/{id}/preview (the tenant-
                                  // checked endpoint) instead of trying
                                  // to GET file_path as a URL.
                                  evidence_id: ev.id,
                                  file_path: ev.file_path!,
                                  file_name: ev.file_name || 'evidence',
                                  mime_type: ev.mime_type,
                                  file_size: ev.file_size,
                                })}
                                className="flex items-center gap-1 rounded bg-primary-50 px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-100"
                                title="Preview evidence file in-browser"
                              >
                                <Eye className="h-3 w-3" />
                                Preview
                              </button>
                            )}
                            {isPendingReview && canEdit && (
                              <>
                                <button
                                  onClick={() => {
                                    reviewEvidenceMutation.mutate({ evidenceId: ev.id, action: 'approve' });
                                  }}
                                  disabled={reviewEvidenceMutation.isPending}
                                  className="flex items-center gap-1 rounded bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
                                  title="Approve evidence"
                                >
                                  <CheckCircle className="h-3 w-3" />
                                  Approve
                                </button>
                                <button
                                  onClick={() => {
                                    reviewEvidenceMutation.mutate({ evidenceId: ev.id, action: 'reject' });
                                  }}
                                  disabled={reviewEvidenceMutation.isPending}
                                  className="flex items-center gap-1 rounded bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                                  title="Reject evidence"
                                >
                                  <XCircle className="h-3 w-3" />
                                  Reject
                                </button>
                              </>
                            )}
                            {canAssess && ev.linked_evidence_id && (
                              <button
                                onClick={() => {
                                  setAssessingEvidenceId(ev.id);
                                  assessEvidenceMutation.mutate(ev.linked_evidence_id!);
                                }}
                                disabled={isAssessing}
                                className="flex items-center gap-1 rounded bg-primary-600 px-2 py-1 text-xs font-medium text-[color:var(--color-on-base,#0a0a0a)] hover:bg-primary-700 disabled:opacity-50"
                                title="Trigger AI assessment"
                              >
                                {isAssessing ? (
                                  <Loader2 className="h-3 w-3 animate-spin" />
                                ) : (
                                  <Sparkles className="h-3 w-3" />
                                )}
                                Assess
                              </button>
                            )}
                            {canDelete && <button
                              onClick={async () => {
                                const ok = await confirm({
                                  title: 'Unlink this evidence?',
                                  message: 'It is taken off this requirement. The file stays in your evidence library.',
                                  confirmLabel: 'Unlink evidence',
                                  tone: 'danger',
                                });
                                if (!ok) return;
                                setDeletingEvidenceId(ev.id);
                                deleteEvidenceMutation.mutate(ev);
                              }}
                              disabled={deletingEvidenceId === ev.id}
                              className="flex items-center gap-1 rounded bg-rose-50 px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                              title="Unlink evidence from this control"
                            >
                              {deletingEvidenceId === ev.id ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Unlink className="h-3 w-3" />
                              )}
                              Unlink
                            </button>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-300 bg-white p-6 text-center">
                    <Paperclip className="mx-auto h-8 w-8 text-slate-400 mb-2" />
                    <p className="text-sm text-slate-900">No evidence linked yet</p>
                    <p className="text-xs text-slate-600 mt-1">Upload evidence to comply</p>
                  </div>
                )}
              </div>
              {/* Required Evidence - Now appears SECOND (right column) */}
              <div>
                <h4 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <FileCheck className="h-4 w-4 text-primary-700" />
                  Required Evidence for {entityLabel} {control.control_code}
                </h4>
                {control.evidence_requirements?.length > 0 ? (
                  <div className="space-y-2">
                    {control.evidence_requirements.map((ev, idx: number) => {
                      const evType = ev.type || 'document';
                      // Categorical evidence-type markers render as neutral slate;
                      // only genuinely status-bearing types keep a semantic tone
                      // (certificate → emerald, contract/audit → amber). Policy is
                      // the single teal accent.
                      const typeColors: Record<string, string> = {
                        'policy': 'bg-primary-50 text-primary-700',
                        'procedure': 'bg-slate-100 text-slate-600',
                        'log': 'bg-slate-100 text-slate-600',
                        'report': 'bg-slate-100 text-slate-600',
                        'screenshot': 'bg-slate-100 text-slate-600',
                        'record': 'bg-slate-100 text-slate-600',
                        'configuration': 'bg-slate-100 text-slate-600',
                        'certificate': 'bg-emerald-50 text-emerald-700',
                        'contract': 'bg-amber-50 text-amber-700',
                        'attestation': 'bg-slate-100 text-slate-600',
                        'test_results': 'bg-slate-100 text-slate-600',
                        'register': 'bg-slate-100 text-slate-600',
                      };
                      const typeColor = typeColors[evType] || 'bg-slate-100 text-slate-600';
                      const typeLabel = evType.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                      const rawFiletype = (ev.filetype || ev.format || ev.evidence_format || '').toString().toLowerCase().replace(/^\./, '');
                      const isDocumentExt = ['pdf', 'doc', 'docx', 'docs', 'xls', 'xlsx'].includes(rawFiletype);
                      const filetypeLabel = !rawFiletype
                        ? null
                        : isDocumentExt
                          ? 'Document'
                          : rawFiletype.toUpperCase();
                      
                      return (
                        <div key={`${idx}`} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 hover:bg-slate-50/60 transition-colors">
                          <div className="flex items-center gap-3">
                            <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ${typeColor.replace('100', '50').replace('text-', 'text-')}`}>
                              <Radio className="h-3.5 w-3.5" />
                            </div>
                            <div className="min-w-0 flex-shrink">
                              <p className="text-sm font-medium text-slate-900 leading-tight truncate">{ev.title}</p>
                              {(() => {
                                const titleText = (ev.title || '').trim();
                                const descText = (ev.description || '').trim();
                                const isDuplicate = titleText.toLowerCase() === descText.toLowerCase();
                                return !descText || isDuplicate ? null : (
                                  <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1">{ev.description}</p>
                                );
                              })()}
                              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${typeColor}`}>
                                  {typeLabel}
                                </span>
                                {filetypeLabel && (
                                  <span className="rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-600">
                                    {filetypeLabel}
                                  </span>
                                )}
                                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${ev.is_required !== false ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-700'}`}>
                                  {ev.is_required !== false ? 'Required' : 'Optional'}
                                </span>
                              </div>
                            </div>
                            {showUpload && (
                              <label className="ml-auto cursor-pointer flex-shrink-0">
                                <input
                                  type="file"
                                  className="hidden"
                                  onChange={(e) => handleFileUpload(control.id, e)}
                                  disabled={uploadingControlId === control.id}
                                />
                                <span className="inline-flex items-center gap-1 rounded-md bg-primary-600 px-2.5 py-1 text-xs font-medium text-[color:var(--color-on-base,#0a0a0a)] hover:bg-primary-700 shadow-sm">
                                  {uploadingControlId === control.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Upload className="h-3.5 w-3.5" />
                                  )}
                                  Upload
                                </span>
                              </label>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  control.evidence_recommendations?.length ? (
                    <div className="rounded-lg bg-white border border-slate-200 p-4">
                      <p className="mb-2 text-sm font-medium text-slate-900">Recommended Evidence</p>
                      <div className="flex flex-wrap gap-2">
                        {control.evidence_recommendations.map((rec: string, idx: number) => (
                          <span key={idx} className="rounded bg-primary-50 px-2 py-1 text-xs text-primary-700">{rec}</span>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg bg-white border border-dashed border-slate-300 p-4 text-center">
                      <p className="text-sm text-slate-900">No evidence requirements defined</p>
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  /**
   * Vertical "Progress spine" renderer for the requirements list. Each
   * top-level section becomes a numbered circle anchored to a vertical
   * spine; controls inside that section render with the existing
   * `renderControlAccordion` so the actual per-clause content stays
   * unchanged — only the surrounding hierarchy/visual rhythm is new.
   *
   * The summary banner at the top is built from the framework progress
   * payload (implementedCount, inProgressCount, totalControlsProgress).
   * In-review = `in_progress` controls; "to start" = the residual.
   */
  /**
   * Render the progress-spine layout. By default sources its sections
   * from the page-level `requirementSections` (filteredControls), but
   * callers can pass `customSections` + `summaryOverride` to reuse the
   * exact same visual on a different slice — that's how the Assigned-
   * to-me tab gets the spine treatment without duplicating any markup.
   *
   * `summaryOverride` swaps the top "your assessment" banner for a
   * caller-specific one; counts inside (compliant / in review / to
   * start) are recomputed from the supplied sections so the bar always
   * reflects the actual list being shown.
   */
  const renderRequirementsSpine = (
    customSections?: RequirementSection[],
    summaryOverride?: { title: string; subtitle?: string; hideAttestationEstimate?: boolean },
  ) => {
    const sectionsToRender = customSections ?? requirementSections;
    const isCustom = !!customSections;

    // When rendering a custom slice (e.g. "assigned to me"), recompute
    // every count from the slice itself — the framework-wide totals
    // would lie. For the default page-level call we use the
    // pre-aggregated progress payload because it already accounts for
    // controls that were trimmed by the search/category/status filters
    // (which we still want represented in the summary).
    const allSlice = sectionsToRender.flatMap((s) => s.controls);
    const compliant = isCustom
      ? allSlice.filter((c) => c.status === 'implemented' || c.status === 'verified').length
      : implementedCount;
    const inReview = isCustom
      ? allSlice.filter((c) => c.status === 'in_progress').length
      : inProgressCount;
    const totalForBar = isCustom
      ? allSlice.length
      : (totalControlsProgress || filteredControls.length || 0);
    const naForBar = isCustom
      ? allSlice.filter((c) => c.status === 'not_applicable').length
      : 0;                                                            // out of scope is not part of the bar (the key figures say how many)
    const toStart = Math.max(0, totalForBar - compliant - inReview - naForBar);

    const compliantPct = totalForBar > 0 ? (compliant / totalForBar) * 100 : 0;
    const inReviewPct = totalForBar > 0 ? (inReview / totalForBar) * 100 : 0;
    const naPct = totalForBar > 0 ? (naForBar / totalForBar) * 100 : 0;

    const sectionsInProgress = sectionsToRender.filter((s) =>
      s.controls.some((c) => c.status === 'in_progress')
        || s.controls.some((c) => c.status !== 'implemented' && c.status !== 'verified' && c.status !== 'not_applicable'),
    ).length;
    const totalSections = sectionsToRender.length;
    const fwName = (journey as any)?.framework_name || journey?.framework?.name || journey?.name || 'Framework';
    const summaryTitle = summaryOverride?.title ?? `${fwName} — your assessment`;
    const defaultSubtitle = totalSections > 0
      ? `Section ${Math.min(sectionsInProgress + 1, totalSections)} of ${totalSections} in progress`
      : 'No sections yet';
    const summarySubtitle = summaryOverride?.subtitle ?? defaultSubtitle;
    const completionPct = totalForBar > 0 ? Math.round((compliant / totalForBar) * 100) : 0;
    const displayCompletionPct = isCustom ? completionPct : Math.round(completionPercentage);

    return (
      <div className="space-y-6">
        {/* ===== Top "your assessment" summary card =====
            Multi-segment bar with compliant / in-review / to-start
            counts so the user gets the whole story at a glance. */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold text-slate-900 leading-tight">
                {summaryTitle}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                {summarySubtitle}
                {!summaryOverride?.hideAttestationEstimate && (journey as any)?.due_date && (() => {
                  const dueRaw = (journey as any).due_date as string;
                  const days = Math.max(0, Math.round((new Date(dueRaw).getTime() - Date.now()) / 86_400_000));
                  return ` · est. ${days} day${days === 1 ? '' : 's'} to attestation`;
                })()}
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-3xl font-bold text-emerald-700 leading-none">
                {displayCompletionPct}<span className="text-base text-emerald-600/70">%</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {compliant} of {totalForBar} {isCustom ? 'assigned' : 'controls'} compliant
              </p>
            </div>
          </div>

          <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100 flex">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${compliantPct}%` }} title={`${compliant} compliant`} />
            <div className="h-full bg-orange-500 transition-all" style={{ width: `${inReviewPct}%` }} title={`${inReview} in review`} />
            <div className="h-full bg-slate-300 transition-all" style={{ width: `${naPct}%` }} title={`${naForBar} N/A`} />
          </div>

          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              <span className="font-semibold text-slate-900">{compliant}</span> compliant
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-orange-500" />
              <span className="font-semibold text-slate-900">{inReview}</span> in review
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-slate-300" />
              <span className="font-semibold text-slate-900">{toStart}</span> to start
            </span>
            {naForBar > 0 && (
              <span className="inline-flex items-center gap-1.5 text-slate-500">
                <span className="h-2 w-2 rounded-full bg-slate-400" />
                <span className="font-semibold">{naForBar}</span> N/A
              </span>
            )}
          </div>
        </div>

        {/* ===== Spine ===== */}
        {sectionsToRender.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center bg-white border border-slate-200 rounded-xl">
            <Shield className="mb-4 h-12 w-12 text-slate-400" />
            <p className="text-slate-600">No {entityLabelPlural.toLowerCase()} found</p>
            <p className="mt-1 text-sm text-slate-500">Try adjusting your filters</p>
          </div>
        ) : !isCustom && journey?.control_structure ? (
          <HierarchicalRequirements
            key={journeyId}
            journeyId={journeyId}
            sections={sectionsToRender}
            structure={journey.control_structure}
            filtersActive={!!searchQuery || categoryFilter !== 'all' || statusFilter !== 'all'}
            focusControlId={selectedSpineControl?.id ?? null}
            criteriaState={criteriaState}
            onToggleCriterion={toggleCriterion}
            onOpenControl={openSpineControl}
            frameworkLabel={(journey as any)?.framework_name || journey?.name || ''}
            tenantUsers={assignmentTenantUsers || []}
          />
        ) : (
          <div className="relative">
            {sectionsToRender.map((section, idx) => {
              const sCompliant = section.controls.filter((c) =>
                c.status === 'implemented' || c.status === 'verified',
              ).length;
              const sTotal = section.controls.length;
              const sRemaining = Math.max(0, sTotal - sCompliant);
              const isLast = idx === sectionsToRender.length - 1;
              const displayNum = section.sectionNumber ?? (idx + 1);

              return (
                <div key={section.key} className="relative pl-16 pb-8 last:pb-0">
                  {/* Numbered anchor circle — the "trunk node" the
                      section's spine grows out of. Thicker border to
                      match the trunk, soft ring shadow to lift it off
                      the page, and the emerald-600 ink matches the
                      branches below so the whole hierarchy reads as
                      one connected tree. */}
                  <div
                    className={`absolute left-0 top-0 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white text-base font-semibold shadow-md ring-4 ring-white transition-colors ${
                      sCompliant === sTotal
                        ? 'border-[3px] border-emerald-600 text-emerald-700'
                        : sCompliant > 0
                          ? 'border-[3px] border-emerald-600 text-emerald-700'
                          : 'border-[3px] border-slate-400 text-slate-600'
                    }`}
                  >
                    {displayNum}
                  </div>
                  {/* Vertical spine line connecting to the next section.
                      Thicker (1.5px) and darker (emerald-600) so the
                      hierarchy reads at a glance — this is the trunk of
                      the tree the requirements branch off of. */}
                  {!isLast && (
                    <div className="absolute left-6 top-12 -ml-[0.75px] w-[3px] h-[calc(100%-3rem)] rounded-full bg-emerald-600/80" />
                  )}

                  {/* Section header */}
                  <div className="mb-3">
                    <h3 className="text-lg font-semibold text-slate-900 leading-tight">{section.label}</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      <span className="text-emerald-700 font-medium">{sCompliant}</span> of {sTotal} compliant
                      {sRemaining > 0 && (
                        <> · <span className="text-slate-700">{sRemaining}</span> to go</>
                      )}
                    </p>
                  </div>

                  {/* Compact spine cards. Each card is a click-target
                      that opens the requirement detail modal — keeps
                      the spine visually quiet while still surfacing the
                      key per-row signal (status dot, code, name,
                      critical / evidence count). The L-junction line
                      on the left visually anchors each card to the
                      section's spine. */}
                  <div className="relative space-y-2">
                    {section.controls.map((control: CertificationControl, ctrlIdx: number) => {
                      const isCompliant = control.status === 'implemented' || control.status === 'verified';
                      const isInProgress = control.status === 'in_progress';
                      const isNA = control.status === 'not_applicable';
                      const dotClass = isCompliant
                        ? 'bg-emerald-600 border-emerald-600'
                        : isInProgress
                          ? 'bg-orange-500 border-orange-500'
                          : isNA
                            ? 'bg-slate-300 border-slate-300'
                            : 'bg-white border-slate-300';
                      const statusLabel = isCompliant
                        ? 'Compliant'
                        : isInProgress
                          ? 'In progress'
                          : isNA
                            ? 'Not applicable'
                            : 'Not implemented';
                      const evidenceTotal = control.required_evidence_count
                        ?? (control.evidence_requirements?.length || 0);
                      const evidenceApproved = control.approved_evidence_count
                        ?? (control.evidence?.filter((e) => e.review_status === 'approved').length || 0);
                      const isLastCard = ctrlIdx === section.controls.length - 1;
                      // Control grouping (NDMO Domain → Control → Specification).
                      // The control id/name come from `objective_*` (e.g.
                      // "DG.1: Strategy and Plan"). Render a control sub-header
                      // before the first specification of each control.
                      const _cat = control.objective_code || control.objective_name || '';
                      const ctrlGroupId = _cat.includes(':') ? _cat.split(':')[0].trim() : '';
                      const ctrlGroupName = _cat.includes(':') ? _cat.split(':').slice(1).join(':').trim() : '';
                      const _prev = section.controls[ctrlIdx - 1];
                      const _prevCat = _prev ? (_prev.objective_code || _prev.objective_name || '') : '';
                      const _prevId = _prevCat.includes(':') ? _prevCat.split(':')[0].trim() : '';
                      const isNewControl = !!ctrlGroupId && ctrlGroupId !== _prevId;
                      // Each requirement's branch reads as a true tree:
                      // a vertical leg dropping from the parent trunk
                      // turns into a horizontal arm that meets the card.
                      // We draw the joint with a rounded-top-left corner
                      // so it bends visually instead of looking like two
                      // disconnected sticks. The vertical sliver under
                      // the last card is hidden so the rail terminates
                      // cleanly under the final requirement of the
                      // section.
                      return (
                        <Fragment key={control.id}>
                        {/* Control sub-header (NDMO control level) — appears
                            once above the first specification of each control. */}
                        {isNewControl && (
                          <div className={`flex items-center gap-2 ${ctrlIdx === 0 ? '' : 'pt-3'} pb-0.5`}>
                            <span className="font-mono text-xs font-semibold text-slate-500">{ctrlGroupId}</span>
                            <span className="text-sm font-semibold text-slate-700">{ctrlGroupName}</span>
                          </div>
                        )}
                        <div className="relative">
                          {/* Vertical leg dropping from the parent
                              section spine down to this card's row.
                              For sibling cards it continues to the next;
                              for the final card it stops at the bend. */}
                          <div
                            aria-hidden="true"
                            className="absolute -left-[2.625rem] top-0 w-[3px] bg-emerald-600/80"
                            style={{ height: isLastCard ? '1.625rem' : 'calc(100% + 0.5rem)' }}
                          />
                          {/* Rounded L-junction: horizontal arm with a
                              soft corner where it meets the vertical
                              leg. Drawn as a single rounded segment so
                              the bend looks intentional, not stuck-on. */}
                          <div
                            aria-hidden="true"
                            className="absolute -left-[2.625rem] top-[1.4rem] h-[3px] w-6 bg-emerald-600/80 rounded-bl-md"
                            style={{ borderBottomLeftRadius: '0', borderTopLeftRadius: '0' }}
                          />
                          {/* Soft circular bullet where the arm meets
                              the card — gives the branch a finished
                              "node" feel and helps the eye land on the
                              row anchor. */}
                          <div
                            aria-hidden="true"
                            className="absolute -left-[1.05rem] top-[1.25rem] h-2 w-2 rounded-full border-2 border-emerald-600 bg-white"
                          />
                          <button
                            type="button"
                            onClick={() => openSpineControl(control)}
                            className="w-full text-left rounded-xl border border-slate-200 bg-white px-4 py-3 hover:border-emerald-300 hover:shadow-sm transition-all group"
                          >
                            <div className="flex items-center gap-3">
                              {/* Status dot */}
                              <span className={`h-4 w-4 flex-shrink-0 rounded-full border-2 ${dotClass}`} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-mono text-sm font-medium text-primary-700">{control.control_code}</span>
                                  <span className="text-sm font-medium text-slate-900 truncate">{control.control_name}</span>
                                  {control.is_critical && (
                                    <span
                                      className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-medium text-rose-700"
                                      title={control.criticality_reason || 'AI-flagged critical clause'}
                                    >
                                      Critical
                                    </span>
                                  )}
                                </div>
                                <p className="mt-0.5 text-xs text-slate-500">
                                  {statusLabel}
                                  {evidenceTotal > 0 && (
                                    <> · {evidenceApproved}/{evidenceTotal} evidence approved</>
                                  )}
                                </p>
                              </div>
                              <span className="flex-shrink-0 inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 group-hover:border-emerald-400 group-hover:text-emerald-700">
                                {isCompliant || isNA ? 'View' : 'Continue →'}
                              </span>
                            </div>
                          </button>
                        </div>
                        </Fragment>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderControlsTab = () => (
    <div className="space-y-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="min-w-[180px] flex-1 sm:min-w-[260px]">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder={`Search ${entityLabelPlural.toLowerCase()}...`}
            size="md"
          />
        </div>
        <MultiSelectDropdown
          title="Category"
          items={[
            { value: 'organizational', label: 'Organizational' },
            { value: 'people', label: 'People' },
            { value: 'physical', label: 'Physical' },
            { value: 'technological', label: 'Technological' },
          ]}
          selectedValues={categoryFilter !== 'all' ? [categoryFilter] : []}
          onApply={(v) => setCategoryFilter((v[0] as CategoryFilter) || 'all')}
          multiSelect={false}
          autoApply
          placeholder="All Categories"
          size="md"
        />
        <MultiSelectDropdown
          title="Status"
          items={[
            { value: 'implemented', label: 'Implemented' },
            { value: 'partial', label: 'In Progress' },
            { value: 'not_implemented', label: 'Not Started' },
          ]}
          selectedValues={statusFilter !== 'all' ? [statusFilter] : []}
          onApply={(v) => setStatusFilter((v[0] as StatusFilter) || 'all')}
          multiSelect={false}
          autoApply
          placeholder="All Statuses"
          size="md"
        />
        <MultiSelectDropdown
          title="Sort"
          items={[
            { value: 'default', label: 'Default' },
            { value: 'asc', label: 'Clause # (Asc)' },
            { value: 'desc', label: 'Clause # (Desc)' },
          ]}
          selectedValues={[sortOrder]}
          onApply={(v) => setSortOrder((v[0] as SortOrder) || 'default')}
          multiSelect={false}
          autoApply
          placeholder="Sort"
          size="md"
        />
      </div>
      {renderRequirementsSpine()}
    </div>
  );

  const renderControlsError = () => (
    <ErrorState
      title="Couldn't load the requirements"
      message={safeDetail(apiErrorText(controlsError, 'Please try again.'))}
      onRetry={() => { void refetchControls(); }}
    />
  );

  const scopePending = records.filter((r) => r.status === 'pending').length;
  const tabItems = tabKeys.map((key) => {
    switch (key) {
      case 'journey': return { key, label: 'Journey' };
      case 'overview': return { key, label: 'Overview' };
      case 'controls': return { key, label: 'Requirements', count: controls ? requirementCount(controls) : undefined };
      case 'scope': return { key, label: 'Scope & decisions', count: scopePending || undefined };
      case 'registers': return { key, label: 'Registers' };
      case 'artifacts': return { key, label: 'Artifacts' };
      default: return { key, label: 'Activity' };
    }
  });
  const tenantUsersForArtifacts = (assignmentTenantUsers || []).map((u: any) => ({ id: u.id, label: u.display_name || u.email || String(u.id), email: u.email }));

  return (
    <div className="flex flex-col gap-[16px]">
      <JourneyHeader journeyId={journeyId} journey={journey} numbers={numbers} waitingTotal={waitingTotal} isCertification={isCertificationFramework} />

      {waitingForTemplates ? (
        <SkeletonRows rows={4} />
      ) : (
        <Tabs tabs={tabItems} value={tab} onChange={setTab} ariaLabel="Framework journey sections" countFormat="exact">
          {hasFlow && (
            <TabPanel tabKey="journey" lazy className="pt-[16px]">
              <JourneyHome
                journeyId={journeyId}
                flow={journeyFlow}
                stageOwners={(journey as any)?.stage_owners}
                frameworkId={appFwId}
                frameworkName={templateFrameworkName}
                waiting={waiting}
                controlsLoading={controlsLoading}
                controlsFailed={!!controlsError}
                scopeLoading={scopeQuery.isLoading}
                scopeFailed={!!scopeQuery.error}
                activity={activity}
                numbers={numbers}
                onOpenRequirement={openSpineControl}
                goTab={setTab}
                entityLabelPlural={entityLabelPlural}
              />
            </TabPanel>
          )}
          <TabPanel tabKey="overview" lazy className="pt-[16px]">
            <OverviewTab
              journeyId={journeyId}
              journey={journey}
              controls={controls}
              numbers={numbers}
              canEdit={canEdit}
              isCertification={isCertificationFramework}
              entityLabelPlural={entityLabelPlural}
              criteriaState={criteriaState}
              onOpenRequirement={openSpineControl}
              showWaiting={!hasFlow}
              waiting={waiting}
              controlsLoading={controlsLoading}
              controlsFailed={!!controlsError}
              scopeLoading={scopeQuery.isLoading}
              scopeFailed={!!scopeQuery.error}
              activity={activity}
              goTab={setTab}
            />
          </TabPanel>
          <TabPanel tabKey="controls" lazy className="pt-[16px]">
            {controlsLoading ? <SkeletonRows rows={6} /> : controlsError ? renderControlsError() : renderControlsTab()}
          </TabPanel>
          <TabPanel tabKey="scope" lazy className="pt-[16px]">
            <ScopeTab
              journeyId={journeyId}
              appFwId={appFwId}
              records={records}
              loading={scopeQuery.isLoading}
              error={scopeQuery.error}
              onRetry={() => { void scopeQuery.refetch(); }}
              controls={controls}
              canEdit={canEdit}
              users={templateTenantUsers}
            />
          </TabPanel>
          {templateKeys.length > 0 && (
            <TabPanel tabKey="registers" lazy className="pt-[16px]">
              <RegistersHost items={registerItems} open={item} onOpen={setItem} render={renderRegisterItem} label={fwTemplateDef?.display_name || templateFrameworkName} />
            </TabPanel>
          )}
          <TabPanel tabKey="artifacts" lazy className="pt-[16px]">
            <ArtifactsTab assessmentType={(journey as any)?.framework_name || journey?.name || ''} tenantUsers={tenantUsersForArtifacts} />
          </TabPanel>
          <TabPanel tabKey="activity" lazy className="pt-[16px]">
            <ActivityTab
              journeyId={journeyId}
              snapshots={snapshots}
              loading={snapshotsLoading}
              error={snapshotsError}
              onRetry={() => { void refetchSnapshots(); }}
              activity={activity}
              scopeFailed={!!scopeQuery.error}
              goTab={setTab}
            />
          </TabPanel>
        </Tabs>
      )}

      {confirmDialog}
      <ScopeDecisionDialog
        control={scopeAsk?.control ?? null}
        pending={setApplicabilityMutation.isPending}
        onClose={() => setScopeAsk(null)}
        onSubmit={(justification) => {
          if (!scopeAsk || !appFwId) return;
          setApplicabilityMutation.mutate({ control_id: scopeAsk.control.parsed_control_id ?? scopeAsk.control.id, uploaded_framework_id: appFwId, is_applicable: scopeAsk.applicable, justification });
        }}
      />

      {/* Shared in-browser evidence viewer. Renders image / PDF / xlsx /
          csv / markdown / text inline; degrades to download for formats
          (e.g. DOCX/PPTX) that can't be portably previewed in-browser. */}
      <EvidenceViewer
        evidence={previewEvidenceFile}
        onClose={() => setPreviewEvidenceFile(null)}
      />

      {/* Large-format requirement detail popup. Opens from the progress
          spine when the user clicks a requirement card. The content
          inside is the existing renderControlAccordion forced into its
          expanded state — so every feature (per-recommendation upload,
          assign-to picker, artifacts, evidence approve/reject, create
          flow) is preserved verbatim. The modal is just a frame around
          the same accordion content the SoA/Assigned tabs use inline. */}
      {selectedSpineControl && (() => {
        const sc = selectedSpineControl;
        const requiredCount = sc.required_evidence_count
          ?? (sc.evidence_requirements ? sc.evidence_requirements.length : 0);
        const evCount = sc.evidence_count ?? (sc.evidence ? sc.evidence.length : 0);
        const approvedCount = sc.approved_evidence_count
          ?? (sc.evidence ? sc.evidence.filter((ev) => ev.review_status === 'approved').length : 0);
        const coverage = sc.evidence_coverage
          ?? (requiredCount > 0 ? Math.min(1, evCount / requiredCount) : evCount > 0 ? 1 : 0);
        const statusPill: Record<string, { label: string; className: string }> = {
          not_started: { label: 'Not Implemented', className: 'bg-rose-50 text-rose-700 border-rose-200' },
          in_progress: { label: 'Partial', className: 'bg-amber-50 text-amber-700 border-amber-200' },
          implemented: { label: 'Implemented', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
          verified: { label: 'Verified', className: 'bg-primary-50 text-primary-700 border-primary-200' },
          not_applicable: { label: 'Not Applicable', className: 'bg-slate-50 text-slate-600 border-slate-200' },
        };
        const sp = statusPill[sc.status] || statusPill.not_started;
        const category = getCategoryFromDomain(sc.domain_name);
        const parsedId = sc.parsed_control_id ?? sc.id;
        return (
        <div
          // Backdrop + container colours/spacing match the existing
          // applicability modal pattern (bg-black/60, slate-200 border,
          // slate-* text scale) so the spine modal feels like a first-
          // class citizen of the same design system rather than a one-
          // off. items-center + body-owns-scroll keeps the popup
          // anchored centre while artifacts expand inside.
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => openSpineControl(null)}
        >
          <div
            className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header — title row (code + name once) and a compact
                action bar pulling all the chips/toggles that used to
                live on the accordion's header row. The inner accordion
                now skips its own header when forceExpanded so there's
                no duplication. Tokens (text-lg semibold for title,
                slate-200 borders, text-sm subtext) align with every
                other modal in the app. */}
            <div className="flex-shrink-0 border-b border-slate-200 bg-white px-6 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm font-semibold text-primary-700">{sc.control_code}</span>
                  <h2 className="text-lg font-semibold text-slate-900 truncate">{sc.control_name}</h2>
                  {sc.domain_name && (
                    <span className="text-sm text-slate-500">· {sc.domain_name}</span>
                  )}
                </div>
                <button
                  onClick={() => openSpineControl(null)}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 flex-shrink-0"
                  title="Close (Esc)"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {sc.is_critical && (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-1 text-xs font-medium text-rose-700"
                    title={sc.criticality_reason || 'AI-flagged critical clause'}
                  >
                    <AlertTriangle className="h-3 w-3" />
                    Critical
                  </span>
                )}
                <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-700">{category}</span>
                {/* Scope toggle: identical contract to the accordion's
                    inline scope buttons (one-click for In Scope, modal-
                    prompted justification for Out of Scope). Lives here
                    so the user can flip scope without scrolling down. */}
                <div
                  role="group"
                  aria-label="Requirement scope"
                  className="inline-flex items-center overflow-hidden rounded-lg border border-slate-300 text-xs"
                >
                  <button
                    type="button"
                    disabled={setApplicabilityMutation.isPending}
                    onClick={() => {
                      if (sc.is_applicable || !appFwId) return;
                      setApplicabilityMutation.mutate({
                        control_id: parsedId,
                        uploaded_framework_id: appFwId,
                        is_applicable: true,
                        justification: '',
                      });
                    }}
                    title="Mark this requirement as part of scope"
                    className={`px-2.5 py-1 transition-colors disabled:opacity-50 ${sc.is_applicable
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white text-slate-600 hover:bg-emerald-50 hover:text-emerald-700'}`}
                  >
                    In Scope
                  </button>
                  <button
                    type="button"
                    disabled={setApplicabilityMutation.isPending}
                    onClick={() => {
                      if (!sc.is_applicable || !appFwId) return;
                      askScope(sc, false);
                    }}
                    title="Mark this requirement as out of scope (justification required)"
                    className={`border-l border-slate-300 px-2.5 py-1 transition-colors disabled:opacity-50 ${!sc.is_applicable
                      ? 'bg-rose-600 text-white'
                      : 'bg-white text-slate-600 hover:bg-rose-50 hover:text-rose-700'}`}
                  >
                    Out of Scope
                  </button>
                </div>
                <span className={`rounded-lg border px-2 py-1 text-xs font-medium ${sp.className}`}>
                  {sp.label}
                </span>
                <span className="text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">{approvedCount}/{requiredCount || '—'}</span> approved
                </span>
                <span className="text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">{evCount}/{requiredCount || '—'}</span> evidence
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                  <Circle className={`h-3.5 w-3.5 ${evCount > 0 ? 'text-emerald-600 fill-emerald-600' : 'text-slate-300'}`} />
                  {Math.round(coverage * 100)}%
                </span>
              </div>
            </div>
            {/* Body owns the scroll: when artifacts/evidence expand
                inside, the body scrolls but the modal itself stays
                anchored to the viewport's centre. */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {renderControlAccordion(sc, true, true)}
            </div>
          </div>
        </div>
        );
      })()}
    </div>
  );
}
