'use client';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vulnManagementApi, assetsApi, ermApi, apiClient } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { InlineLinkPicker, PageLoader, ComboBoxInput, SeverityBadge, StatusBadge, type ComboBoxOption, type SeverityLevel } from '@/components/ui';
import AiRecommendationSaver from '@/components/ai/AiRecommendationSaver';
import { Abbr } from '@/components/common/Abbr';
import {
  Bug,
  Loader2,
  ArrowLeft,
  AlertCircle,
  Server,
  Shield,
  Clock,
  CheckCircle,
  RefreshCw,
  Sparkles,
  Plus,
  X,
  Trash2,
  FileText,
  FileCheck,
  Link2,
  Calendar,
  User,
  ExternalLink,
  Users,
  GitBranch,
  Bell,
  ChevronRight,
  MessageSquare,
} from 'lucide-react';
import Link from 'next/link';
import { CreateIssueButton } from '@/components/issue-management/CreateIssueButton';
import { RelatedIssuesPanel } from '@/components/issue-management/RelatedIssuesPanel';

interface VulnerabilityDetail {
  id: number;
  title: string;
  description?: string;
  severity: string;
  status: string;
  cve_id?: string;
  cwe_id?: string;
  cvss_score?: number;
  affected_component?: string;
  affected_host?: string;
  linked_assets?: string[];
  due_date?: string;
  assigned_to?: number;
  assigned_user_name?: string;
  report_id?: number;
  report_name?: string;
  ai_recommendation?: string;
  created_at: string;
  updated_at?: string;
  template_type?: string | null;
  template_fields?: Record<string, unknown> | null;
  // Threat-intelligence enrichment fields. The Threat Intelligence panel
  // below renders only when at least one is populated, so un-enriched rows
  // look identical to before.
  epss_score?: number;
  epss_percentile?: number;
  kev_flag?: boolean;
  kev_date_added?: string;
  nvd_published_at?: string;
  nvd_last_modified_at?: string;
  nvd_last_synced_at?: string;
  exploit_references?: string[];
  composite_priority?: number;
  // Public-exploit detection (GitHub PoC search). Non-null count = we
  // checked; >0 = clone-and-run code is in the wild.
  public_exploit_count?: number | null;
  public_exploit_refs?: Array<{
    full_name: string;
    url: string;
    stars: number;
    description?: string | null;
  }> | null;
  public_exploit_synced_at?: string | null;
  // Phase 6 — Vendor patch intelligence. Same nullable discipline: the
  // Patch Information section hides itself when nothing has been synced.
  patch_references?: Array<{ source: string; id: string; url: string; type: string }>;
  vendor_advisory_ids?: string[];
  remediation_guidance?: string;
  psirt_synced_at?: string;
  psirt_source?: string;
  // Phase 8 — Exception workflow. Defaults to "none"; richer than the
  // legacy is_exception/exception_reason/exception_approved_by/
  // exception_expiry fields above, which are kept in sync server-side.
  exception_status?: 'none' | 'requested' | 'approved' | 'denied' | 'expired' | 'revoked' | string | null;
  exception_requested_by_id?: number | null;
  exception_requested_at?: string | null;
  exception_justification?: string | null;
  exception_compensating_controls?: string[] | null;
  exception_approved_at?: string | null;
  exception_expires_at?: string | null;
  exception_denial_reason?: string | null;
  exception_revoked_by_id?: number | null;
  exception_revoked_at?: string | null;
  exception_revocation_reason?: string | null;
  exception_metadata?: Record<string, unknown> | null;
}

interface Mitigation {
  id: number;
  action_title: string;
  action_description?: string;
  action_type?: string;
  status: string;
  priority?: string;
  target_date?: string;
  owner_id?: number;
  owner_name?: string;
  completed_at?: string;
  effort_estimate?: string;
  actual_effort?: string;
  notes?: string;
  created_at?: string;
  updated_at?: string;
  creator_name?: string;
}

interface AssetLink {
  id: number;
  asset_id: number;
  asset_name: string;
  asset_type?: string;
  relationship_type?: string;
  // Provenance — Track B / Phase 4. Drives the Auto badge + source chip.
  link_source?: string | null;
  auto_linked?: boolean | null;
}

interface ControlLink {
  id: number;
  framework_control_id?: number;
  normalized_control_id?: number;
  internal_control_id?: number;
  // ParsedFrameworkControl FK — populated by the CWE auto-mapper because
  // upload-driven seeded frameworks live in the parsed-control tables.
  parsed_framework_control_id?: number | null;
  compliance_impact?: string;
  notes?: string;
  framework_control_code?: string;
  framework_control_name?: string;
  normalized_control_code?: string;
  normalized_control_name?: string;
  internal_control_name?: string;
  // ParsedFrameworkControl rendering data — mirrors the legacy fields
  // above so the UI doesn't have to branch on which FK is set.
  parsed_control_code?: string | null;
  parsed_control_name?: string | null;
  parsed_framework_name?: string | null;
  // CWE auto-mapping provenance — populated by the backend `_build_response`
  // helper. `source` is "manual" or "auto_cwe"; `auto_cwe` is the CWE-ID
  // that triggered the auto-link; `framework_short_code` lets the UI
  // render a framework badge without a second fetch.
  source?: 'manual' | 'auto_cwe' | string;
  auto_cwe?: string | null;
  framework_short_code?: string | null;
}

interface DepartmentAssignment {
  id: number;
  vulnerability_id: number;
  department_id: number;
  department_name?: string;
  department_code?: string;
  assigned_by?: number;
  assigner_name?: string;
  assigned_at: string;
  notes?: string;
  priority: string;
  sla_override_days?: number;
  notification_sent?: boolean;
}

interface Department {
  id: number;
  name: string;
  code?: string;
  description?: string;
  member_count?: number;
}

interface WorkflowTransition {
  id: number;
  name: string;
  to_state_id: number;
  to_state_name: string;
  requires_comment: boolean;
  requires_approval: boolean;
}

interface WorkflowHistoryItem {
  id: number;
  vulnerability_id: number;
  from_state_id?: number;
  from_state_name?: string;
  to_state_id: number;
  to_state_name?: string;
  transition_id?: number;
  transition_name?: string;
  performed_by: number;
  performer_name?: string;
  comment?: string;
  performed_at: string;
}

interface Escalation {
  id: number;
  rule_name: string;
  escalated_to?: string;
  escalated_at: string;
  reason?: string;
  status: string;
}

const SEVERITY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  critical: { bg: 'bg-red-50', text: 'text-red-600', label: 'Critical' },
  high: { bg: 'bg-orange-50', text: 'text-orange-600', label: 'High' },
  medium: { bg: 'bg-yellow-50', text: 'text-yellow-600', label: 'Medium' },
  low: { bg: 'bg-blue-50', text: 'text-blue-600', label: 'Low' },
  info: { bg: 'bg-slate-50', text: 'text-slate-600', label: 'Info' },
};

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  open: { bg: 'bg-red-50', text: 'text-red-600', label: 'Open' },
  in_progress: { bg: 'bg-yellow-50', text: 'text-yellow-600', label: 'In Progress' },
  remediated: { bg: 'bg-blue-50', text: 'text-blue-600', label: 'Remediated' },
  verified: { bg: 'bg-green-50', text: 'text-green-600', label: 'Verified' },
  closed: { bg: 'bg-slate-50', text: 'text-slate-600', label: 'Closed' },
  accepted: { bg: 'bg-primary-50', text: 'text-primary-600', label: 'Risk Accepted' },
  false_positive: { bg: 'bg-slate-50', text: 'text-slate-600', label: 'False Positive' },
};

function getStatusStyle(status: string) {
  return STATUS_STYLES[status?.toLowerCase()] || STATUS_STYLES.open;
}

function parseInlineBold(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i} className="font-semibold text-slate-800">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

function formatAIText(text: string): React.ReactNode {
  if (!text) return null;
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let listBuffer: React.ReactNode[] = [];

  const flushList = (isBulleted: boolean) => {
    if (listBuffer.length === 0) return;
    elements.push(
      isBulleted
        ? <ul key={elements.length} className="list-disc list-inside space-y-0.5 text-slate-700">{listBuffer}</ul>
        : <ol key={elements.length} className="list-decimal list-inside space-y-0.5 text-slate-700">{listBuffer}</ol>
    );
    listBuffer = [];
  };

  let lastWasBullet = false;
  let lastWasOrdered = false;

  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed === '') {
      flushList(lastWasBullet);
      lastWasBullet = false;
      lastWasOrdered = false;
      elements.push(<div key={i} className="h-1" />);
      return;
    }
    if (trimmed.startsWith('## ')) {
      flushList(lastWasBullet);
      lastWasBullet = false; lastWasOrdered = false;
      elements.push(<h3 key={i} className="text-sm font-semibold text-slate-900 mt-3 first:mt-0">{trimmed.slice(3)}</h3>);
      return;
    }
    if (trimmed.startsWith('### ')) {
      flushList(lastWasBullet);
      lastWasBullet = false; lastWasOrdered = false;
      elements.push(<h4 key={i} className="text-sm font-medium text-slate-800 mt-2">{trimmed.slice(4)}</h4>);
      return;
    }
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      if (lastWasOrdered) { flushList(false); lastWasOrdered = false; }
      lastWasBullet = true;
      listBuffer.push(<li key={i}>{parseInlineBold(trimmed.slice(2))}</li>);
      return;
    }
    if (/^\d+\.\s/.test(trimmed)) {
      if (lastWasBullet) { flushList(true); lastWasBullet = false; }
      lastWasOrdered = true;
      listBuffer.push(<li key={i}>{parseInlineBold(trimmed.replace(/^\d+\.\s/, ''))}</li>);
      return;
    }
    flushList(lastWasBullet || lastWasOrdered);
    lastWasBullet = false; lastWasOrdered = false;
    elements.push(<p key={i} className="text-sm text-slate-700">{parseInlineBold(trimmed)}</p>);
  });
  flushList(lastWasBullet || lastWasOrdered);

  return <div className="space-y-1">{elements}</div>;
}

export default function VulnerabilityDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vulnerabilities:vulnerability_register:edit');
  const canDelete = hasPermission('vulnerabilities:vulnerability_register:delete');
  const vulnId = Number(params.id);

  const [showMitigationModal, setShowMitigationModal] = useState(false);
  // When the user clicks "Add as Mitigation" on an AI suggestion, we don't
  // create it instantly anymore — we stage the suggestion here, open the
  // existing Add Mitigation modal pre-filled with title/description/priority,
  // and let the user set due_date + assignee + tweak anything else before
  // confirming. The same modal handles both manual and AI-seeded creates,
  // so the operator gets a consistent UX and the AI path never bypasses
  // the assignment/due-date controls.
  const [mitigationPrefill, setMitigationPrefill] = useState<{
    title: string;
    description?: string;
    priority?: string;
    action_type?: string;
    /** Provenance — surfaced as a banner inside the modal.
     *  - 'ai':    AI suggestion staged from the AI Analysis card
     *  - 'patch': patch / advisory / remediation-guidance row in the
     *             Threat Intelligence panel
     *  - 'manual': operator opened the modal directly */
    source?: 'ai' | 'manual' | 'patch';
  } | null>(null);
  // Detail panel for an already-created mitigation. Click a row in the
  // table to open this — it lets the operator view every field and
  // transition status / re-assign / change due date without going back
  // to the create form.
  const [selectedMitigation, setSelectedMitigation] = useState<Mitigation | null>(null);
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [showDeptAssignModal, setShowDeptAssignModal] = useState(false);
  const [showTransitionModal, setShowTransitionModal] = useState(false);
  const [selectedTransition, setSelectedTransition] = useState<WorkflowTransition | null>(null);
  const [transitionComment, setTransitionComment] = useState('');

  const { data: vulnerability, isLoading, error } = useQuery({
    queryKey: ['vulnerability', vulnId],
    queryFn: async () => {
      const response = await vulnManagementApi.vulnerabilities.getById(vulnId);
      return response.data as VulnerabilityDetail;
    },
  });

  // Phase 8 — the Exception Workflow panel needs the current user's ID to
  // enforce separation of duties client-side (the backend is the real gate,
  // but disabling the Approve/Deny buttons up front gives a cleaner UX than
  // a 400 after the click). Cached across the session.
  const { data: currentUser } = useQuery({
    queryKey: ['current-user-id'],
    queryFn: async () => {
      const response = await apiClient.get('/auth/me');
      return response.data as { id: number };
    },
    staleTime: 5 * 60 * 1000,
  });
  const currentUserId = currentUser?.id ?? null;

  // Tenant users for the mitigation assignee dropdown. Reuses the existing
  // /assets/tenant-users endpoint — same shape ({id, display_name, email}),
  // same tenant scoping, no new backend route needed.
  const { data: tenantUsers } = useQuery({
    queryKey: ['vuln.tenant-users'],
    queryFn: async () => {
      const r = await apiClient.get<Array<{ id: number; display_name: string; email: string }>>('/assets/tenant-users');
      return r.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: mitigations } = useQuery({
    queryKey: ['vuln-mitigations', vulnId],
    queryFn: async () => {
      const response = await vulnManagementApi.mitigations.list(vulnId);
      return response.data as Mitigation[];
    },
  });

  const { data: assetLinks } = useQuery({
    queryKey: ['vuln-assets', vulnId],
    queryFn: async () => {
      const response = await vulnManagementApi.assetLinks.list(vulnId);
      return response.data as AssetLink[];
    },
  });

  const { data: controlLinks } = useQuery({
    queryKey: ['vuln-controls', vulnId],
    queryFn: async () => {
      const response = await vulnManagementApi.controlLinks.list(vulnId);
      return response.data as ControlLink[];
    },
  });

  const { data: departmentAssignments } = useQuery({
    queryKey: ['vuln-departments', vulnId],
    queryFn: async () => {
      const response = await vulnManagementApi.departments.getVulnerabilityDepartments(vulnId);
      return response.data as DepartmentAssignment[];
    },
  });

  const { data: availableDepartments } = useQuery({
    queryKey: ['all-departments'],
    queryFn: async () => {
      const response = await vulnManagementApi.departments.getAll();
      return response.data as Department[];
    },
    enabled: showDeptAssignModal,
  });

  const { data: workflowTransitions } = useQuery({
    queryKey: ['vuln-workflow-transitions', vulnId],
    queryFn: async () => {
      const response = await vulnManagementApi.workflows.getAvailableTransitions(vulnId);
      return response.data as WorkflowTransition[];
    },
  });

  const { data: workflowHistory } = useQuery({
    queryKey: ['vuln-workflow-history', vulnId],
    queryFn: async () => {
      const response = await vulnManagementApi.workflows.getHistory(vulnId);
      return response.data as WorkflowHistoryItem[];
    },
  });

  const { data: escalationsData } = useQuery({
    queryKey: ['vuln-escalations', vulnId],
    queryFn: async () => {
      const response = await vulnManagementApi.escalations.getVulnerabilityEscalations(vulnId);
      return response.data as Escalation[];
    },
  });

  const { data: assets, isLoading: assetsLoading } = useQuery({
    queryKey: ['assets-list'],
    queryFn: async () => {
      const response = await assetsApi.getAll();
      return response.data;
    },
  });

  const { data: internalControls, isLoading: internalControlsLoading } = useQuery({
    queryKey: ['internal-controls-list'],
    queryFn: async () => {
      const response = await ermApi.internalControls.getAll();
      return response.data;
    },
  });

  const changeStatusMutation = useMutation({
    mutationFn: ({ status, notes }: { status: string; notes?: string }) =>
      vulnManagementApi.vulnerabilities.changeStatus(vulnId, status, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vulnerability', vulnId] });
      queryClient.invalidateQueries({ queryKey: ['vulnerabilities'] });
      setShowStatusModal(false);
    },
  });

  const suggestFixMutation = useMutation({
    // Unwrap the AxiosResponse so AIAnalysisTab can read output_data directly.
    // The backend returns the full job row with output_data.{summary,
    // suggestions, recommendation} after a successful run.
    mutationFn: async () => {
      const res = await vulnManagementApi.ai.suggestFix(vulnId);
      return res.data as SuggestFixJobResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vulnerability', vulnId] });
    },
  });

  const createMitigationMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => vulnManagementApi.mitigations.create(vulnId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vuln-mitigations', vulnId] });
      setShowMitigationModal(false);
      // Always clear staged AI-suggestion data on close — both success and
      // cancel paths funnel through this state, so the next manual "Add
      // Mitigation" click opens a blank form.
      setMitigationPrefill(null);
    },
  });

  // Update existing mitigation — status transitions (in_progress → completed),
  // re-assignment, due-date changes, and free-form notes from the detail panel.
  const updateMitigationMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      vulnManagementApi.mitigations.update(vulnId, id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vuln-mitigations', vulnId] });
      setSelectedMitigation(null);
    },
  });

  const deleteMitigationMutation = useMutation({
    mutationFn: (id: number) => vulnManagementApi.mitigations.delete(vulnId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vuln-mitigations', vulnId] });
      setSelectedMitigation(null);
    },
  });

  const createAssetLinkMutation = useMutation({
    mutationFn: (data: { asset_id: number; relationship_type?: string }) =>
      vulnManagementApi.assetLinks.create(vulnId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vuln-assets', vulnId] });
    },
  });

  const deleteAssetLinkMutation = useMutation({
    mutationFn: (linkId: number) => vulnManagementApi.assetLinks.delete(vulnId, linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vuln-assets', vulnId] });
    },
  });

  const createControlLinkMutation = useMutation({
    mutationFn: (data: { control_type: string; framework_control_id?: number; internal_control_id?: number }) =>
      vulnManagementApi.controlLinks.create(vulnId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vuln-controls', vulnId] });
    },
  });

  const deleteControlLinkMutation = useMutation({
    mutationFn: (linkId: number) => vulnManagementApi.controlLinks.delete(vulnId, linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vuln-controls', vulnId] });
    },
  });

  // CWE → framework-control auto-map. The mutation result drives a small
  // banner on the Controls tab; the banner clears itself after the next
  // user action (clicking Auto-map again, leaving the tab, etc.).
  const [autoMapBanner, setAutoMapBanner] = useState<{
    tone: 'success' | 'info' | 'error';
    text: string;
  } | null>(null);
  const autoMapMutation = useMutation({
    mutationFn: async () => {
      const res = await vulnManagementApi.controlLinks.autoMap(vulnId);
      return res.data as {
        matched_controls: number;
        added: number;
        kept: number;
        removed_stale: number;
        errors: string[];
      };
    },
    onSuccess: (summary) => {
      queryClient.invalidateQueries({ queryKey: ['vuln-controls', vulnId] });
      const noMatch = summary.matched_controls === 0;
      if (noMatch) {
        setAutoMapBanner({
          tone: 'info',
          text: 'No framework controls matched this vuln. Either the CWE isn\'t in our mapping table or this tenant hasn\'t seeded a framework that covers it.',
        });
      } else {
        const parts: string[] = [];
        if (summary.added) parts.push(`${summary.added} added`);
        if (summary.kept) parts.push(`${summary.kept} already linked`);
        if (summary.removed_stale) parts.push(`${summary.removed_stale} stale removed`);
        setAutoMapBanner({
          tone: 'success',
          text: `Matched ${summary.matched_controls} framework control${summary.matched_controls === 1 ? '' : 's'}: ${parts.join(' · ')}.`,
        });
      }
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setAutoMapBanner({
        tone: 'error',
        text: detail || 'Auto-map failed. Check that the framework data is seeded.',
      });
    },
  });

  const assignDepartmentMutation = useMutation({
    mutationFn: (data: { department_id: number; priority?: string; sla_override_days?: number; notes?: string }) => 
      vulnManagementApi.departments.assignDepartment(vulnId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vuln-departments', vulnId] });
      setShowDeptAssignModal(false);
    },
  });

  const removeDepartmentAssignmentMutation = useMutation({
    mutationFn: (assignmentId: number) => 
      vulnManagementApi.departments.removeDepartmentAssignment(vulnId, assignmentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vuln-departments', vulnId] });
    },
  });

  const workflowTransitionMutation = useMutation({
    mutationFn: (data: { transition_name: string; comment?: string }) => 
      vulnManagementApi.workflows.transition(vulnId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vulnerability', vulnId] });
      queryClient.invalidateQueries({ queryKey: ['vuln-workflow-transitions', vulnId] });
      queryClient.invalidateQueries({ queryKey: ['vuln-workflow-history', vulnId] });
      setShowTransitionModal(false);
      setSelectedTransition(null);
      setTransitionComment('');
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-xl border border-slate-200 bg-white">
        <PageLoader size="md" />
      </div>
    );
  }

  if (error || !vulnerability) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-red-600" />
        <p className="mt-2 text-red-600">Failed to load vulnerability details</p>
        <Link href="/vulnerabilities" className="mt-4 inline-flex items-center gap-2 text-blue-600 hover:underline">
          <ArrowLeft size={16} />
          Back to Vulnerabilities
        </Link>
      </div>
    );
  }

  const statusStyle = getStatusStyle(vulnerability.status);

  // ── Hero-strip derived values ───────────────────────────────────────
  // The header KPI strip shows the operator everything they need to triage
  // this vuln at a glance. All values come from existing columns; no new
  // queries.
  const dueDate = vulnerability.due_date ? new Date(vulnerability.due_date) : null;
  const dueDays = dueDate
    ? Math.ceil((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const dueLabel = dueDays === null
    ? null
    : dueDays < 0
      ? `${Math.abs(dueDays)}d overdue`
      : dueDays === 0
        ? 'Due today'
        : `${dueDays}d to SLA`;
  const dueTone = dueDays === null
    ? 'border-slate-200 bg-slate-50 text-slate-600'
    : dueDays < 0
      ? 'border-red-300 bg-red-50 text-red-700'
      : dueDays <= 3
        ? 'border-orange-300 bg-orange-50 text-orange-700'
        : 'border-emerald-200 bg-emerald-50 text-emerald-700';

  const priorityValue = typeof vulnerability.composite_priority === 'number'
    ? vulnerability.composite_priority
    : null;
  const priorityTone = priorityValue === null
    ? 'border-slate-200 bg-slate-50 text-slate-600'
    : priorityValue >= 9
      ? 'border-red-300 bg-red-50 text-red-700'
      : priorityValue >= 7
        ? 'border-orange-300 bg-orange-50 text-orange-700'
        : priorityValue >= 4
          ? 'border-yellow-300 bg-yellow-50 text-yellow-700'
          : 'border-blue-200 bg-blue-50 text-blue-700';

  const epssValue = typeof vulnerability.epss_score === 'number' ? vulnerability.epss_score : null;
  const cvssValue = typeof vulnerability.cvss_score === 'number' ? vulnerability.cvss_score : null;
  const linkedAssetCount = vulnerability.linked_assets?.length ?? 0;
  const hasPublicExploit = typeof vulnerability.public_exploit_count === 'number'
    && vulnerability.public_exploit_count > 0;

  // Normalised severity level for the shared SeverityBadge (charter-fixed).
  const severityLevel = (['critical', 'high', 'medium', 'low', 'info'].includes(
    (vulnerability.severity || '').toLowerCase(),
  ) ? (vulnerability.severity || '').toLowerCase() : 'info') as SeverityLevel;

  // Mitigation-progress line (n of m complete) — derived from the always-loaded
  // mitigations list; no new query.
  const mitigationTotal = mitigations?.length ?? 0;
  const mitigationDone = (mitigations || []).filter((m) => m.status === 'completed').length;

  // Exception-state badge tone (mirrors the FSM panel's state styles).
  const exceptionState = (vulnerability.exception_status || 'none') as string;
  const exceptionStateTone = EXCEPTION_STATE_STYLES[exceptionState] || EXCEPTION_STATE_STYLES.none;

  // Section registry for the right-column in-page nav. Each entry anchors to a
  // scroll target so nothing that answers the core question hides behind a tab.
  const SECTIONS = [
    { id: 'sec-narrative', label: 'Threat', icon: Shield },
    { id: 'sec-description', label: 'Description', icon: FileText },
    { id: 'sec-assets', label: 'Assets', icon: Server },
    { id: 'sec-remediation', label: 'Remediation', icon: CheckCircle },
    { id: 'sec-controls', label: 'Controls', icon: Shield },
    { id: 'sec-chain', label: 'Chain', icon: Link2 },
    { id: 'sec-departments', label: 'Departments', icon: Users },
    { id: 'sec-exception', label: 'Exception', icon: AlertCircle },
    { id: 'sec-activity', label: 'Activity', icon: GitBranch },
  ];

  return (
    <div className="risk-workspace -m-4 space-y-4 lg:-m-5">
      {/* ── Header bar (D1 charter) ───────────────────────────────────── */}
      <div className="border-b border-slate-200 px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-start gap-3">
            <Link
              href="/vulnerabilities"
              className="mt-0.5 rounded-md p-1.5 text-slate-600 hover:bg-slate-50 hover:text-slate-800"
              title="Back to vulnerabilities"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
            </Link>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
              <Bug className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500">
                  VULN-{vulnerability.id}
                </span>
                {vulnerability.cve_id && (
                  <span className="text-[10px] font-mono text-slate-500">· {vulnerability.cve_id}</span>
                )}
              </div>
              <h1 className="text-lg font-semibold text-slate-800 leading-snug">{vulnerability.title}</h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <StatusBadge status={vulnerability.status} customLabel={statusStyle.label} size="md" />
            <button
              onClick={() => setShowStatusModal(true)}
              className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-50"
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
              Change Status
            </button>
            <CreateIssueButton
              sourceType="vulnerability"
              sourceId={vulnerability.id}
              presetFields={{
                title: `VULN-${vulnerability.id} — ${vulnerability.title}`,
                description: vulnerability.description || undefined,
                category: 'security',
                issue_type: vulnerability.kev_flag ? 'incident' : 'audit_finding',
              }}
            />
          </div>
        </div>
      </div>

      {/* ── D1 split: pinned left context + scrolling right work column ── */}
      <div className="mx-4 grid grid-cols-1 gap-4 pb-4 sm:mx-6 lg:grid-cols-12">
        {/* ── LEFT: identity + triage facts stay on screen ──────────────── */}
        <div className="lg:col-span-5">
          <div className="space-y-3 lg:sticky lg:top-4">
            {/* Threat flags */}
            {(vulnerability.kev_flag || hasPublicExploit) && (
              <div className="flex flex-wrap gap-1.5">
                {vulnerability.kev_flag && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-700">
                    <AlertCircle size={10} strokeWidth={1.75} />
                    <Abbr code="CISA" showIcon={false}>CISA</Abbr>{' '}<Abbr code="KEV" showIcon={false}>KEV</Abbr>
                  </span>
                )}
                {hasPublicExploit && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 border border-rose-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-700">
                    Public Exploit
                  </span>
                )}
              </div>
            )}

            {/* Triage facts */}
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2">
                <SeverityBadge severity={severityLevel} size="md" />
                {cvssValue !== null && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 border border-slate-200 px-2 py-0.5 text-xs text-slate-700">
                    <span className="text-[9px] uppercase tracking-wider text-slate-500"><Abbr code="CVSS" showIcon={false} /></span>
                    <span className="font-semibold text-slate-900">{cvssValue.toFixed(1)} / 10</span>
                  </span>
                )}
                {epssValue !== null && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 border border-slate-200 px-2 py-0.5 text-xs text-slate-700">
                    <span className="text-[9px] uppercase tracking-wider text-slate-500"><Abbr code="EPSS" showIcon={false} /></span>
                    <span className="font-semibold text-slate-900">{(epssValue * 100).toFixed(1)}%</span>
                  </span>
                )}
                {priorityValue !== null && (
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs ${priorityTone}`}
                    title="Composite priority — blends CVSS, EPSS, KEV, and asset criticality"
                  >
                    <span className="text-[9px] uppercase tracking-wider opacity-75">Priority</span>
                    <span className="font-bold">{priorityValue.toFixed(2)} / 10</span>
                  </span>
                )}
              </div>
              {dueLabel && (
                <div className={`mt-2.5 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${dueTone}`}>
                  <Clock size={12} strokeWidth={1.75} />
                  <span className="text-xs font-semibold">{dueLabel}</span>
                </div>
              )}
            </div>

            {/* Identity */}
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 mb-2">
                <FileText className="h-3.5 w-3.5" strokeWidth={1.75} /> Identity
              </div>
              <dl className="space-y-2">
                {vulnerability.cve_id && (
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-xs text-slate-500 flex-shrink-0"><Abbr code="CVE" /> ID</dt>
                    <dd className="text-xs font-mono text-slate-900 text-right truncate">{vulnerability.cve_id}</dd>
                  </div>
                )}
                {vulnerability.cwe_id && /^cwe-/i.test(vulnerability.cwe_id) && (
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-xs text-slate-500 flex-shrink-0"><Abbr code="CWE" /> ID</dt>
                    <dd className="text-xs font-mono text-slate-900 text-right truncate">{vulnerability.cwe_id}</dd>
                  </div>
                )}
                {vulnerability.affected_component && (
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-xs text-slate-500 flex-shrink-0">Component</dt>
                    <dd className="text-xs text-slate-800 text-right truncate">{vulnerability.affected_component}</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Ownership & progress */}
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 mb-2">
                <User className="h-3.5 w-3.5" strokeWidth={1.75} /> Ownership &amp; Progress
              </div>
              <dl className="space-y-2">
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-xs text-slate-500 flex-shrink-0">Owner</dt>
                  <dd className="text-xs text-slate-800 text-right truncate">{vulnerability.assigned_user_name || '— Unassigned —'}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-xs text-slate-500 flex-shrink-0">Linked assets</dt>
                  <dd className="text-xs text-slate-800 text-right">{linkedAssetCount}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-xs text-slate-500 flex-shrink-0">Mitigations</dt>
                  <dd className="text-xs text-slate-800 text-right">
                    {mitigationTotal === 0 ? 'None yet' : `${mitigationDone} of ${mitigationTotal} complete`}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-xs text-slate-500 flex-shrink-0">Exception</dt>
                  <dd>
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${exceptionStateTone}`}>
                      {exceptionState}
                    </span>
                  </dd>
                </div>
              </dl>
            </div>

            {/* Timeline */}
            <div className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500 mb-2">
                <Calendar className="h-3.5 w-3.5" strokeWidth={1.75} /> Timeline
              </div>
              <dl className="space-y-2">
                {vulnerability.due_date && (
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-xs text-slate-500 flex-shrink-0">Due</dt>
                    <dd className="text-xs text-slate-800 text-right">{new Date(vulnerability.due_date).toLocaleDateString()}</dd>
                  </div>
                )}
                <div className="flex items-baseline justify-between gap-2">
                  <dt className="text-xs text-slate-500 flex-shrink-0">Created</dt>
                  <dd className="text-xs text-slate-700 text-right">{new Date(vulnerability.created_at).toLocaleDateString()}</dd>
                </div>
                {vulnerability.updated_at && (
                  <div className="flex items-baseline justify-between gap-2">
                    <dt className="text-xs text-slate-500 flex-shrink-0">Updated</dt>
                    <dd className="text-xs text-slate-700 text-right">{new Date(vulnerability.updated_at).toLocaleDateString()}</dd>
                  </div>
                )}
              </dl>
            </div>

            {/* In-page section nav */}
            <nav className="rounded-lg border border-slate-200 bg-white p-2">
              <div className="flex flex-wrap gap-1">
                {SECTIONS.map((s) => (
                  <a
                    key={s.id}
                    href={`#${s.id}`}
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-primary-700 transition-colors"
                  >
                    <s.icon size={13} strokeWidth={1.75} />
                    {s.label}
                  </a>
                ))}
              </div>
            </nav>
          </div>
        </div>

        {/* ── RIGHT: scrolling work column ──────────────────────────────── */}
        <div className="space-y-4 lg:col-span-7">
          {/* Linked Issues — surfaces any Issues opened against this vuln. */}
          <RelatedIssuesPanel
            sourceType="vulnerability"
            sourceId={vulnerability.id}
            title="Linked Issues"
            createFields={{
              title: `VULN-${vulnerability.id} — ${vulnerability.title}`,
              description: vulnerability.description || undefined,
              category: 'security',
              issue_type: vulnerability.kev_flag ? 'incident' : 'audit_finding',
            }}
          />

          {/* (1) Threat Narrative + Threat Intelligence + Patch Information.
              ThreatIntelPanel is reused UNCHANGED — it hosts the plain-English
              narrative banner, the enrich/sync actions, and the patch-info
              Add-as-Mitigation handoff. */}
          <section id="sec-narrative" className="scroll-mt-4">
            <ThreatIntelPanel
              vulnerability={vulnerability}
              onAddRemediation={(prefill) => {
                setMitigationPrefill({
                  title: prefill.title,
                  description: prefill.description,
                  priority: prefill.priority,
                  action_type: prefill.action_type ?? 'remediate',
                  source: 'patch',
                });
                setShowMitigationModal(true);
              }}
            />
          </section>

          {/* (2) Description + affected component */}
          <section id="sec-description" className="cw-card rounded-xl p-4 sm:p-5 scroll-mt-4">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5 mb-2">
              <FileText className="h-3.5 w-3.5 text-slate-500" strokeWidth={1.75} />
              Description
            </h2>
            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">
              {vulnerability.description || (
                <span className="text-slate-400 italic">No description provided.</span>
              )}
            </p>
            {vulnerability.affected_component && (
              <p className="mt-3 text-xs text-slate-500">
                Affected component: <span className="text-slate-800">{vulnerability.affected_component}</span>
              </p>
            )}

            {/* NCA Template Fields — verbatim register data preserved on the bridge */}
            {vulnerability.template_type === 'NCA Template' && vulnerability.template_fields && Object.keys(vulnerability.template_fields).length > 0 && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
                <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5 text-primary-600" strokeWidth={1.75} />
                  NCA Template Fields
                </h3>
                <p className="text-xs text-slate-600 mb-3">
                  Verbatim fields from the NCA Saudi vulnerability register template. Owner and assets are managed via the platform pickers.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {Object.entries(vulnerability.template_fields).filter(([, v]) => v !== null && v !== '' && v !== undefined).map(([k, v]) => (
                    <div key={k} className="rounded-md border border-slate-200 bg-white px-2.5 py-2">
                      <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-0.5">{k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</p>
                      <p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{String(v)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Legacy AI Recommendation prose — charter: no gradient */}
            {vulnerability.ai_recommendation && (
              <div className="mt-4 rounded-lg border border-primary-200 bg-primary-50/60 p-4">
                <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-primary-600" strokeWidth={1.75} />
                  AI Recommendation
                </h3>
                {formatAIText(vulnerability.ai_recommendation)}
              </div>
            )}
          </section>

          {/* (3) Affected Assets — linked asset records */}
          <section id="sec-assets" className="cw-card rounded-xl p-4 sm:p-5 scroll-mt-4">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                <Server className="h-3.5 w-3.5 text-slate-500" strokeWidth={1.75} />
                Affected Assets
              </h2>
              {canEdit && (
                <InlineLinkPicker
                  triggerLabel="Link Asset"
                  triggerClassName="flex items-center gap-1.5 rounded-md bg-primary-600 px-3 py-1.5 text-sm text-white hover:bg-primary-700 transition-colors disabled:opacity-50"
                  items={(assets || []).filter((a: { id: number }) => !assetLinks?.some((l) => l.asset_id === a.id)).map((a: { id: number; name: string; asset_type?: string }) => ({
                    value: String(a.id),
                    label: a.name,
                    subLabel: a.asset_type,
                  }))}
                  isLoading={assetsLoading || createAssetLinkMutation.isPending}
                  emptyText="No assets available"
                  searchPlaceholder="Search assets"
                  onSelect={(value) => createAssetLinkMutation.mutate({
                    asset_id: Number(value),
                    relationship_type: 'affected',
                  })}
                />
              )}
            </div>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              {(!assetLinks || assetLinks.length === 0) ? (
                <div className="p-8 text-center text-slate-600 text-sm">No assets linked yet</div>
              ) : (
                <table className="w-full">
                  <thead className="bg-slate-50/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Asset</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Type</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Relationship</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Provenance</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {assetLinks.map((link) => (
                      <tr key={link.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 cw-text">{link.asset_name}</td>
                        <td className="px-4 py-3 text-slate-600">{link.asset_type || '-'}</td>
                        <td className="px-4 py-3 text-slate-600">{link.relationship_type || 'affected'}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            {link.link_source && link.link_source !== 'manual' && (
                              <span className="rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">
                                {link.link_source.replace(/_/g, ' ')}
                              </span>
                            )}
                            {link.auto_linked && (
                              <span
                                className="rounded-full border border-primary-200 bg-primary-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary-700"
                                title="Linked automatically by scanner / sync / matcher — review for accuracy"
                              >
                                Auto
                              </span>
                            )}
                            {!link.link_source && !link.auto_linked && (
                              <span className="text-[10px] text-slate-400">manual</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {canDelete && (
                          <button
                            onClick={() => deleteAssetLinkMutation.mutate(link.id)}
                            className="text-slate-600 hover:text-red-600"
                          >
                            <Trash2 size={16} strokeWidth={1.75} />
                          </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {/* (4) Remediation — Patch/AI plan + Mitigations list, co-located.
              AIAnalysisTab is reused UNCHANGED. */}
          <section id="sec-remediation" className="space-y-4 scroll-mt-4">
            <AIAnalysisTab
              vulnerability={vulnerability}
              suggestFixMutation={suggestFixMutation}
              onAcceptSuggestion={(payload) => {
                const title = String(payload.action_title ?? '').replace(/^\[AI\]\s*/, '');
                setMitigationPrefill({
                  title,
                  description: typeof payload.action_description === 'string' ? payload.action_description : undefined,
                  priority: typeof payload.priority === 'string' ? payload.priority : undefined,
                  action_type: 'remediate',
                  source: 'ai',
                });
                setShowMitigationModal(true);
              }}
              acceptingSuggestion={createMitigationMutation.isPending}
            />

            {/* Mitigations list */}
            <div className="cw-card rounded-xl p-4 sm:p-5">
              <div className="flex justify-between items-center mb-3">
                <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                  <CheckCircle className="h-3.5 w-3.5 text-slate-500" strokeWidth={1.75} />
                  Mitigations
                  {mitigationTotal > 0 && (
                    <span className="text-xs font-normal text-slate-500">
                      {mitigationDone} of {mitigationTotal} complete
                    </span>
                  )}
                </h2>
                <button onClick={() => setShowMitigationModal(true)} className="btn-primary flex items-center gap-1.5 text-sm py-1 px-3">
                  <Plus size={14} strokeWidth={1.75} />
                  Add Mitigation
                </button>
              </div>
              <div className="overflow-hidden rounded-lg border border-slate-200">
                {(!mitigations || mitigations.length === 0) ? (
                  <div className="p-8 text-center text-slate-600 text-sm">No mitigations added yet</div>
                ) : (
                  <table className="w-full">
                <thead className="bg-slate-50/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Title</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Priority</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Due Date</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Assigned To</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-600"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {mitigations.map((m) => (
                    <tr
                      key={m.id}
                      onClick={() => setSelectedMitigation(m)}
                      className="hover:bg-slate-50 cursor-pointer"
                      title="View / edit details"
                    >
                      <td className="px-4 py-3 cw-text">
                        <div className="font-medium">{m.action_title}</div>
                        {m.action_description && (
                          <div className="text-xs text-slate-500 mt-0.5 line-clamp-1">{m.action_description}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                          m.status === 'completed' ? 'bg-green-50 text-green-700' :
                          m.status === 'in_progress' ? 'bg-blue-50 text-blue-700' :
                          m.status === 'cancelled' || m.status === 'deferred' ? 'bg-slate-100 text-slate-600' :
                          'bg-yellow-50 text-yellow-700'
                        }`}>
                          {m.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 capitalize">{m.priority || '-'}</td>
                      <td className="px-4 py-3 text-slate-600">{m.target_date ? new Date(m.target_date).toLocaleDateString() : '-'}</td>
                      <td className="px-4 py-3 text-slate-600">{m.owner_name || '-'}</td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-xs text-blue-600 hover:underline">View</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
                )}
              </div>
            </div>
          </section>

          {/* (5) Controls — compliance impact */}
          <section id="sec-controls" className="cw-card rounded-xl p-4 sm:p-5 scroll-mt-4 space-y-3">
          <div className="flex justify-between items-center flex-wrap gap-2">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                <Shield className="h-3.5 w-3.5 text-slate-500" strokeWidth={1.75} />
                Linked Controls
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">
                Compliance impact — every linked control this vulnerability currently breaks
                or puts at risk. Auto-mapped rows come from this vuln&apos;s CWE; manual rows
                are linked by you.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {canEdit && vulnerability.cwe_id && (
                <button
                  type="button"
                  onClick={() => autoMapMutation.mutate()}
                  disabled={autoMapMutation.isPending}
                  className="inline-flex items-center gap-1.5 rounded-md border border-primary-300 bg-white px-3 py-1.5 text-sm text-primary-700 hover:bg-primary-50 disabled:opacity-50"
                  title={`Auto-map framework controls from ${vulnerability.cwe_id}`}
                >
                  {autoMapMutation.isPending ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Sparkles size={14} strokeWidth={1.75} />
                  )}
                  Auto-map from CWE
                </button>
              )}
              {canEdit && (
                <InlineLinkPicker
                  triggerLabel="Link Control"
                  triggerClassName="flex items-center gap-1.5 rounded-md bg-primary-600 px-3 py-1.5 text-sm text-white hover:bg-primary-700 transition-colors disabled:opacity-50"
                  items={(internalControls || []).filter((c: { id: number }) => !controlLinks?.some((l) => l.internal_control_id === c.id)).map((c: { id: number; control_id?: string; name: string; category?: string }) => ({
                    value: String(c.id),
                    label: c.control_id ? `${c.control_id} — ${c.name}` : c.name,
                    subLabel: c.category,
                  }))}
                  isLoading={internalControlsLoading || createControlLinkMutation.isPending}
                  emptyText="No controls available"
                  searchPlaceholder="Search controls"
                  onSelect={(value) => createControlLinkMutation.mutate({
                    control_type: 'internal',
                    internal_control_id: Number(value),
                  })}
                />
              )}
            </div>
          </div>

          {/* Auto-map result banner */}
          {autoMapBanner && (
            <div
              className={`rounded-md border p-2.5 text-xs ${
                autoMapBanner.tone === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : autoMapBanner.tone === 'error'
                  ? 'border-red-200 bg-red-50 text-red-700'
                  : 'border-blue-200 bg-blue-50 text-blue-800'
              }`}
            >
              {autoMapBanner.text}
            </div>
          )}

          {/* Compliance Impact summary — visible whenever we have at least one
              auto-mapped row. Counts the unique framework short_codes so the
              user sees the impact span at a glance ("breaks N controls across
              3 frameworks: PCI-DSS, ISO27001, OWASP"). */}
          {(() => {
            const autoLinks = (controlLinks || []).filter((l) => l.source === 'auto_cwe');
            if (autoLinks.length === 0) return null;
            const frameworks = Array.from(new Set(
              autoLinks
                .map((l) => l.framework_short_code)
                .filter((s): s is string => !!s),
            ));
            return (
              <div className="rounded-md border border-orange-200 bg-orange-50 p-3 text-xs text-orange-900 flex items-start gap-2">
                <AlertCircle size={14} className="text-orange-600 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p>
                    This vulnerability currently breaks <strong>{autoLinks.length}</strong>{' '}
                    control{autoLinks.length === 1 ? '' : 's'}
                    {frameworks.length > 0 && (
                      <> across <strong>{frameworks.length}</strong> framework{frameworks.length === 1 ? '' : 's'}</>
                    )}.
                    Resolving or mitigating it lifts each control out of non-compliant status.
                  </p>
                  {frameworks.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {frameworks.map((fw) => (
                        <span
                          key={fw}
                          className="inline-flex items-center rounded-full border border-orange-300 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-orange-800"
                        >
                          {fw}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          <div className="cw-card overflow-hidden">
            {(!controlLinks || controlLinks.length === 0) ? (
              <div className="p-8 text-center text-slate-600">
                No controls linked yet.
                {vulnerability.cwe_id && (
                  <div className="mt-2 text-xs">
                    Click <strong>Auto-map from CWE</strong> to discover framework controls this vuln affects.
                  </div>
                )}
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-50/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Control</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Framework</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">ID</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Source</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {controlLinks.map((link) => {
                    const displayName = link.internal_control_name
                      || link.parsed_control_name
                      || link.framework_control_name
                      || link.normalized_control_name
                      || '-';
                    const displayCode = link.parsed_control_code
                      || link.framework_control_code
                      || link.normalized_control_code
                      || (link.internal_control_id ? `IC-${link.internal_control_id}` : '-');
                    const displayType = link.internal_control_id
                      ? 'Internal'
                      : (link.framework_control_id || link.parsed_framework_control_id)
                      ? 'Framework'
                      : link.normalized_control_id
                      ? 'Normalized'
                      : '-';
                    const isAuto = link.source === 'auto_cwe';
                    // Detail-page link target — prefer the new parsed-FK
                    // route, fall back to the legacy framework-FK route.
                    const detailHref = link.parsed_framework_control_id
                      ? `/erm/framework-controls/${link.parsed_framework_control_id}?type=parsed`
                      : link.framework_control_id
                      ? `/erm/framework-controls/${link.framework_control_id}?type=legacy`
                      : null;
                    return (
                    <tr key={link.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 cw-text">{displayName}</td>
                      <td className="px-4 py-3 text-slate-600">{displayType}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {link.framework_short_code ? (
                          detailHref ? (
                            <Link
                              href={detailHref}
                              className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-700 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                              title={link.parsed_framework_name || 'Open framework control detail'}
                            >
                              {link.framework_short_code}
                            </Link>
                          ) : (
                            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-700">
                              {link.framework_short_code}
                            </span>
                          )
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600 font-mono text-xs">
                        {detailHref ? (
                          <Link
                            href={detailHref}
                            className="hover:text-blue-600 hover:underline"
                            title="Open framework control detail"
                          >
                            {displayCode}
                          </Link>
                        ) : (
                          displayCode
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {isAuto ? (
                          <span
                            className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700"
                            title={`Auto-mapped from ${link.auto_cwe || 'vulnerability management rules'}`}
                          >
                            <Sparkles size={9} />
                            Auto{link.auto_cwe ? ` • ${link.auto_cwe}` : ''}
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                            Manual
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {canDelete && (
                        <button
                          onClick={() => deleteControlLinkMutation.mutate(link.id)}
                          className="text-slate-600 hover:text-red-600"
                          title={isAuto ? 'Remove this auto-mapped link (it will not be re-created until you click Auto-map again)' : 'Remove this manual link'}
                        >
                          <Trash2 size={16} />
                        </button>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          </section>

          {/* (6) Chain — prerequisites + dependents + kill-chain (reused unchanged) */}
          <section id="sec-chain" className="cw-card rounded-xl p-4 sm:p-5 scroll-mt-4">
            <DependenciesTab vulnId={vulnId} />
          </section>

          {/* Departments — assignments */}
          <section id="sec-departments" className="cw-card rounded-xl p-4 sm:p-5 scroll-mt-4 space-y-3">
          <div className="flex justify-between items-center">
            <h2 className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5 text-slate-500" strokeWidth={1.75} />
              Department Assignments
            </h2>
            {canEdit && (
            <button onClick={() => setShowDeptAssignModal(true)} className="btn-primary flex items-center gap-1.5 text-sm py-1 px-3">
              <Plus size={14} strokeWidth={1.75} />
              Assign Department
            </button>
            )}
          </div>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            {(!departmentAssignments || departmentAssignments.length === 0) ? (
              <div className="p-8 text-center text-slate-600 text-sm">No departments assigned yet</div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-50/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Department</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Priority</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">SLA Override</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Assigned</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {departmentAssignments.map((assignment) => (
                    <tr key={assignment.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50">
                            <Users size={14} className="text-primary-600" />
                          </div>
                          <div>
                            <span className="cw-text font-medium">{assignment.department_name || `Department ${assignment.department_id}`}</span>
                            {assignment.department_code && (
                              <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-[var(--color-subtle)] cw-text-muted font-mono">
                                {assignment.department_code}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                          assignment.priority === 'high' ? 'bg-red-50 text-red-700' :
                          assignment.priority === 'medium' ? 'bg-yellow-50 text-yellow-700' :
                          'bg-green-50 text-green-700'
                        }`}>
                          {assignment.priority}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {assignment.sla_override_days ? `${assignment.sla_override_days} days` : '-'}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {new Date(assignment.assigned_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        {canDelete && (
                        <button
                          onClick={() => removeDepartmentAssignmentMutation.mutate(assignment.id)}
                          className="text-slate-600 hover:text-red-600"
                        >
                          <Trash2 size={16} />
                        </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          </section>

          {/* (7) Exception — full FSM workflow panel (reused unchanged; replaces
              the old thin exception table). request → approve|deny → revoke. */}
          <section id="sec-exception" className="scroll-mt-4">
            <ExceptionWorkflowPanel vulnerability={vulnerability} currentUserId={currentUserId} />
          </section>

          {/* (8) Activity / History — workflow transitions + history timeline +
              escalations, merged into one stream. */}
          <section id="sec-activity" className="cw-card rounded-xl p-4 sm:p-5 scroll-mt-4 space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-1.5">
                <GitBranch className="h-4 w-4 text-primary-600" strokeWidth={1.75} />
                Workflow — Available Actions
              </h2>
              {(!workflowTransitions || workflowTransitions.length === 0) ? (
                <p className="text-slate-500 text-sm">No transitions available from current state</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {workflowTransitions.map((transition) => (
                    <button
                      key={transition.name}
                      onClick={() => {
                        if (transition.requires_comment) {
                          setSelectedTransition(transition);
                          setShowTransitionModal(true);
                        } else {
                          workflowTransitionMutation.mutate({ transition_name: transition.name });
                        }
                      }}
                      disabled={workflowTransitionMutation.isPending}
                      className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 transition-colors"
                    >
                      <ChevronRight size={14} strokeWidth={1.75} />
                      {transition.name}
                      {transition.requires_comment && (
                        <MessageSquare size={12} className="text-slate-600" strokeWidth={1.75} />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 pt-4">
              <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-slate-500" strokeWidth={1.75} />
                History
              </h3>
              {(!workflowHistory || workflowHistory.length === 0) ? (
                <p className="text-slate-500 text-sm">No workflow history available</p>
              ) : (
                <div className="space-y-4 max-h-80 overflow-y-auto">
                  {workflowHistory.map((item, index) => (
                    <div key={item.id} className="relative pl-6 pb-4">
                      {index < workflowHistory.length - 1 && (
                        <div className="absolute left-2 top-4 bottom-0 w-0.5 bg-slate-200" />
                      )}
                      <div className="absolute left-0 top-1 w-4 h-4 rounded-full bg-primary-50 border-2 border-primary-500" />
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-slate-800">{item.transition_name || 'State Change'}</span>
                          <span className="text-xs text-slate-500">
                            {item.from_state_name || 'Initial'} → {item.to_state_name || 'Unknown'}
                          </span>
                        </div>
                        {item.comment && (
                          <p className="text-sm text-slate-600">{item.comment}</p>
                        )}
                        <p className="text-xs text-slate-500">
                          {item.performer_name || 'System'} • {new Date(item.performed_at).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 pt-4">
              <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-1.5">
                <Bell className="h-4 w-4 text-slate-500" strokeWidth={1.75} />
                Escalations
              </h3>
              <div className="overflow-hidden rounded-lg border border-slate-200">
                {(!escalationsData || escalationsData.length === 0) ? (
                  <div className="p-6 text-center text-slate-600 text-sm">No escalations triggered</div>
                ) : (
                  <table className="w-full">
                    <thead className="bg-slate-50/50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Rule</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Escalated To</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Date</th>
                        <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {escalationsData.map((esc) => (
                        <tr key={esc.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <Bell size={14} className="text-orange-600" strokeWidth={1.75} />
                              <span className="text-slate-800">{esc.rule_name}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-600">{esc.escalated_to || '-'}</td>
                          <td className="px-4 py-3 text-slate-600">
                            {new Date(esc.escalated_at).toLocaleString()}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                              esc.status === 'acknowledged' ? 'bg-emerald-50 text-emerald-700' :
                              esc.status === 'pending' ? 'bg-amber-50 text-amber-700' :
                              'bg-slate-50 text-slate-700'
                            }`}>
                              {esc.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* ── Modals (page-level, reused unchanged) ─────────────────────── */}
      {showStatusModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="cw-card w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold cw-text">Change Status</h2>
              <button onClick={() => setShowStatusModal(false)} className="text-slate-600 hover:text-slate-900">
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                changeStatusMutation.mutate({
                  status: formData.get('status') as string,
                  notes: formData.get('notes') as string || undefined,
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">New Status</label>
                <select name="status" required className="input-field w-full" defaultValue={vulnerability.status}>
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="remediated">Remediated</option>
                  <option value="verified">Verified</option>
                  <option value="closed">Closed</option>
                  <option value="accepted">Risk Accepted</option>
                  <option value="false_positive">False Positive</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Notes</label>
                <textarea name="notes" rows={3} className="input-field w-full" />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setShowStatusModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={changeStatusMutation.isPending} className="btn-primary">
                  {changeStatusMutation.isPending ? 'Updating...' : 'Update Status'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showMitigationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="cw-card w-full max-w-lg p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-bold cw-text">
                {mitigationPrefill?.source === 'ai'
                  ? 'Accept AI Suggestion'
                  : mitigationPrefill?.source === 'patch'
                  ? 'Add Mitigation from Patch'
                  : 'Add Mitigation'}
              </h2>
              <button
                onClick={() => {
                  setShowMitigationModal(false);
                  setMitigationPrefill(null);
                }}
                className="text-slate-600 hover:text-slate-900"
              >
                <X size={20} />
              </button>
            </div>
            {mitigationPrefill?.source === 'ai' && (
              <div className="mb-4 flex items-start gap-2 rounded-md border border-violet-200 bg-violet-50 px-3 py-2 text-xs text-violet-800">
                <Sparkles className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <div>
                  <strong className="block">Pre-filled from AI suggestion.</strong>
                  Review the brief, set a due date and assignee, and click Create.
                  Editing any field here is fine — your changes are what land in the register.
                </div>
              </div>
            )}
            {mitigationPrefill?.source === 'patch' && (
              <div className="mb-4 flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                <Plus className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                <div>
                  <strong className="block">Pre-filled from a vendor patch / advisory.</strong>
                  Title and description carry the patch context. Choose the
                  Action Type, set Override Priority, Due Date, and Assigned
                  To, then Create.
                </div>
              </div>
            )}
            <form
              // Re-mount the form whenever the prefill changes so the
              // uncontrolled inputs pick up the new defaultValue. Without
              // this, switching between manual / AI-staged opens would
              // re-use the previous render's input values.
              key={mitigationPrefill ? `prefill-${mitigationPrefill.title}` : 'blank'}
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const ownerRaw = formData.get('owner_id');
                const ownerId = ownerRaw && String(ownerRaw).length ? Number(ownerRaw) : undefined;
                const priority = (formData.get('priority') as string) || undefined;
                const actionType = (formData.get('action_type') as string) || undefined;
                createMitigationMutation.mutate({
                  action_title: formData.get('title'),
                  action_description: formData.get('description') || undefined,
                  action_type: actionType,
                  owner_id: ownerId,
                  priority,
                  target_date: formData.get('due_date') ? new Date(`${formData.get('due_date')}T00:00:00Z`).toISOString() : undefined,
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Title *</label>
                <input
                  type="text"
                  name="title"
                  required
                  className="input-field w-full"
                  defaultValue={mitigationPrefill?.title ?? ''}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Description</label>
                <textarea
                  name="description"
                  rows={mitigationPrefill?.source === 'ai' ? 6 : 3}
                  className="input-field w-full"
                  defaultValue={mitigationPrefill?.description ?? ''}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Action Type</label>
                  <select
                    name="action_type"
                    defaultValue={mitigationPrefill?.action_type ?? 'remediate'}
                    className="input-field w-full"
                  >
                    <option value="remediate">Remediate</option>
                    <option value="mitigate">Mitigate</option>
                    <option value="accept">Accept risk</option>
                    <option value="transfer">Transfer</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Override Priority</label>
                  <select
                    name="priority"
                    defaultValue={(mitigationPrefill?.priority || 'medium').toLowerCase()}
                    className="input-field w-full"
                    title="Defaults to medium (or the suggested priority when staged from a patch / AI). Pick a value here to override."
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Due Date</label>
                  <input type="date" name="due_date" className="input-field w-full" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Assigned To</label>
                  <select name="owner_id" defaultValue="" className="input-field w-full">
                    <option value="">— Unassigned —</option>
                    {(tenantUsers || []).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.display_name} {u.email ? `(${u.email})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setShowMitigationModal(false);
                    setMitigationPrefill(null);
                  }}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button type="submit" disabled={createMitigationMutation.isPending} className="btn-primary">
                  {createMitigationMutation.isPending
                    ? 'Creating...'
                    : mitigationPrefill?.source === 'ai'
                      ? 'Accept & Create'
                      : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Mitigation detail panel — click a row in the Mitigations table to
          open this. Shows every field on the row plus inline edit controls
          for status / due date / assignee / notes. Status transitions
          set completed_at server-side; the panel auto-closes on save. */}
      {selectedMitigation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="cw-card w-full max-w-2xl p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between mb-4">
              <div className="min-w-0">
                <h2 className="text-xl font-bold cw-text truncate">{selectedMitigation.action_title}</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Mitigation #{selectedMitigation.id}
                  {selectedMitigation.action_type ? ` · ${selectedMitigation.action_type}` : ''}
                  {selectedMitigation.creator_name ? ` · created by ${selectedMitigation.creator_name}` : ''}
                </p>
              </div>
              <button onClick={() => setSelectedMitigation(null)} className="text-slate-600 hover:text-slate-900">
                <X size={20} />
              </button>
            </div>

            {/* Read-only summary grid */}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 mb-5 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Status</dt>
                <dd className="mt-0.5">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                    selectedMitigation.status === 'completed' ? 'bg-green-50 text-green-700' :
                    selectedMitigation.status === 'in_progress' ? 'bg-blue-50 text-blue-700' :
                    selectedMitigation.status === 'cancelled' ? 'bg-slate-100 text-slate-600' :
                    'bg-yellow-50 text-yellow-700'
                  }`}>
                    {selectedMitigation.status}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Priority</dt>
                <dd className="mt-0.5 text-slate-800 capitalize">{selectedMitigation.priority || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Due Date</dt>
                <dd className="mt-0.5 text-slate-800">
                  {selectedMitigation.target_date ? new Date(selectedMitigation.target_date).toLocaleDateString() : '—'}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Assigned To</dt>
                <dd className="mt-0.5 text-slate-800">{selectedMitigation.owner_name || '— Unassigned —'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Effort Estimate</dt>
                <dd className="mt-0.5 text-slate-800">{selectedMitigation.effort_estimate || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Completed At</dt>
                <dd className="mt-0.5 text-slate-800">
                  {selectedMitigation.completed_at ? new Date(selectedMitigation.completed_at).toLocaleString() : '—'}
                </dd>
              </div>
              {selectedMitigation.action_description && (
                <div className="col-span-2">
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Description</dt>
                  <dd className="mt-1 text-slate-700 text-sm whitespace-pre-wrap break-words">
                    {selectedMitigation.action_description}
                  </dd>
                </div>
              )}
              {selectedMitigation.notes && (
                <div className="col-span-2">
                  <dt className="text-xs uppercase tracking-wide text-slate-500">Notes</dt>
                  <dd className="mt-1 text-slate-700 text-sm whitespace-pre-wrap break-words">
                    {selectedMitigation.notes}
                  </dd>
                </div>
              )}
            </dl>

            {/* Inline edit form — only the fields most often updated mid-flight */}
            {canEdit && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  const ownerRaw = fd.get('owner_id');
                  const dueRaw = fd.get('due_date');
                  const newStatus = (fd.get('status') as string) || selectedMitigation.status;
                  const data: Record<string, unknown> = {
                    status: newStatus,
                    priority: fd.get('priority'),
                    notes: fd.get('notes') || undefined,
                    owner_id: ownerRaw && String(ownerRaw).length ? Number(ownerRaw) : null,
                    target_date: dueRaw ? new Date(`${dueRaw}T00:00:00Z`).toISOString() : null,
                  };
                  // Stamp completed_at client-side too — backend already does
                  // this on transition to 'completed' but we send it explicitly
                  // so the optimistic UI shows the right date immediately.
                  if (newStatus === 'completed' && !selectedMitigation.completed_at) {
                    data.completed_at = new Date().toISOString();
                  }
                  updateMitigationMutation.mutate({ id: selectedMitigation.id, data });
                }}
                className="space-y-4 border-t border-slate-200 pt-4"
              >
                <h3 className="text-sm font-semibold text-slate-700">Update</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Status</label>
                    <select name="status" defaultValue={selectedMitigation.status} className="input-field w-full">
                      <option value="planned">Planned</option>
                      <option value="in_progress">In progress</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                      <option value="deferred">Deferred</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Override Priority</label>
                    <select
                      name="priority"
                      defaultValue={selectedMitigation.priority || 'medium'}
                      className="input-field w-full"
                      title="The mitigation row's priority. Change to override what was set at creation."
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Due Date</label>
                    <input
                      type="date"
                      name="due_date"
                      defaultValue={selectedMitigation.target_date ? new Date(selectedMitigation.target_date).toISOString().slice(0, 10) : ''}
                      className="input-field w-full"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 mb-1">Assigned To</label>
                    <select name="owner_id" defaultValue={selectedMitigation.owner_id ?? ''} className="input-field w-full">
                      <option value="">— Unassigned —</option>
                      {(tenantUsers || []).map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.display_name} {u.email ? `(${u.email})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">Notes</label>
                  <textarea
                    name="notes"
                    rows={3}
                    defaultValue={selectedMitigation.notes || ''}
                    placeholder="Progress notes, blockers, next steps…"
                    className="input-field w-full"
                  />
                </div>
                <div className="flex justify-between items-center gap-3 pt-2 border-t border-slate-100">
                  {canDelete ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Delete mitigation "${selectedMitigation.action_title}"? This cannot be undone.`)) {
                          deleteMitigationMutation.mutate(selectedMitigation.id);
                        }
                      }}
                      disabled={deleteMitigationMutation.isPending}
                      className="text-xs text-red-600 hover:underline disabled:opacity-50"
                    >
                      {deleteMitigationMutation.isPending ? 'Deleting…' : 'Delete'}
                    </button>
                  ) : <span />}
                  <div className="flex gap-3">
                    <button type="button" onClick={() => setSelectedMitigation(null)} className="btn-secondary">Close</button>
                    <button type="submit" disabled={updateMitigationMutation.isPending} className="btn-primary">
                      {updateMitigationMutation.isPending ? 'Saving…' : 'Save changes'}
                    </button>
                  </div>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {showDeptAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="cw-card w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold cw-text">Assign Department</h2>
              <button onClick={() => setShowDeptAssignModal(false)} className="text-slate-600 hover:text-slate-900">
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                assignDepartmentMutation.mutate({
                  department_id: parseInt(formData.get('department_id') as string),
                  priority: formData.get('priority') as string || 'medium',
                  sla_override_days: formData.get('sla_override_days') ? parseInt(formData.get('sla_override_days') as string) : undefined,
                  notes: formData.get('notes') as string || undefined,
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Department *</label>
                <select name="department_id" required className="input-field w-full">
                  <option value="">Select a department</option>
                  {availableDepartments?.map((dept) => (
                    <option key={dept.id} value={dept.id}>{dept.name} {dept.code && `(${dept.code})`}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Priority</label>
                <select name="priority" className="input-field w-full" defaultValue="medium">
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">SLA Override (days)</label>
                <input type="number" name="sla_override_days" className="input-field w-full" placeholder="Leave empty to use default SLA" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Notes</label>
                <textarea name="notes" rows={2} className="input-field w-full" placeholder="Optional notes..." />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setShowDeptAssignModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={assignDepartmentMutation.isPending} className="btn-primary">
                  {assignDepartmentMutation.isPending ? 'Assigning...' : 'Assign Department'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showTransitionModal && selectedTransition && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="cw-card w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold cw-text">{selectedTransition.name}</h2>
              <button 
                onClick={() => {
                  setShowTransitionModal(false);
                  setSelectedTransition(null);
                  setTransitionComment('');
                }} 
                className="text-slate-600 hover:text-slate-900"
              >
                <X size={20} />
              </button>
            </div>
            <div className="mb-4">
              <p className="text-slate-600 text-sm">
                Transition to <span className="cw-text font-medium">{selectedTransition.to_state_name}</span>
              </p>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Comment {selectedTransition.requires_comment && <span className="text-red-600">*</span>}
                </label>
                <textarea
                  value={transitionComment}
                  onChange={(e) => setTransitionComment(e.target.value)}
                  rows={4}
                  required={selectedTransition.requires_comment}
                  className="input-field w-full"
                  placeholder="Add a comment for this transition..."
                />
              </div>
              <div className="flex justify-end gap-3">
                <button 
                  type="button" 
                  onClick={() => {
                    setShowTransitionModal(false);
                    setSelectedTransition(null);
                    setTransitionComment('');
                  }} 
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button 
                  onClick={() => {
                    workflowTransitionMutation.mutate({
                      transition_name: selectedTransition.name,
                      comment: transitionComment || undefined,
                    });
                  }}
                  disabled={workflowTransitionMutation.isPending || (selectedTransition.requires_comment && !transitionComment.trim())}
                  className="btn-primary"
                >
                  {workflowTransitionMutation.isPending ? 'Processing...' : 'Confirm Transition'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// AIAnalysisTab
// ---------------------------------------------------------------------------
// Triggers the structured /ai/suggest-fix endpoint and renders the JSON
// response as a list of actionable suggestion cards. Each card has an
// "Add as Mitigation" button that calls the mitigations create endpoint
// with the suggestion's title + description + priority pre-filled, so the
// operator can accept the AI's plan one click at a time. The legacy
// `ai_recommendation` markdown is shown below as a fallback / expanded
// view for context.

interface AISuggestion {
  title: string;
  description?: string;
  priority?: string;
  effort?: string;
  category?: string;
}

interface SuggestFixOutput {
  summary?: string;
  recommendation?: string;
  suggestions?: AISuggestion[];
}

interface SuggestFixJobResponse {
  status?: string;
  error_message?: string | null;
  output_data?: SuggestFixOutput | null;
}

const SUGGESTION_PRIORITY_STYLES: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 border-red-200',
  high: 'bg-orange-50 text-orange-700 border-orange-200',
  medium: 'bg-yellow-50 text-yellow-700 border-yellow-200',
  low: 'bg-blue-50 text-blue-700 border-blue-200',
};

const SUGGESTION_CATEGORY_LABELS: Record<string, string> = {
  patch: 'Patch',
  config: 'Configuration',
  compensating_control: 'Compensating control',
  monitoring: 'Monitoring',
  isolation: 'Isolation',
  detection: 'Detection',
};

// ---------------------------------------------------------------------------
// DependenciesTab  (vuln chain — prerequisites + dependents)
// ---------------------------------------------------------------------------
// Two-column view: vulns this one *needs* to be exploitable (prerequisites)
// and vulns that *need* this one (dependents). Plus an "Add prerequisite"
// picker that searches the tenant's open vulns.
//
// Composite priority is NOT modified by chain state — that would surprise
// users whose SLAs/dashboards are calibrated to today's numbers. Instead,
// the backend returns a `chain_warning` string when there's at least one
// unresolved high-urgency prereq, and we render it as a coloured banner.

interface ChainDependency {
  id: number;
  dependent_vuln_id: number;
  prerequisite_vuln_id: number;
  notes?: string | null;
  chain_stage?: string | null;
  prerequisite_title?: string | null;
  prerequisite_vuln_code?: string | null;
  prerequisite_severity?: string | null;
  prerequisite_status?: string | null;
  prerequisite_cve_id?: string | null;
  prerequisite_kev_flag?: boolean | null;
  prerequisite_composite_priority?: number | null;
  created_at?: string;
}

interface ChainDependent {
  id: number;
  dependent_vuln_id: number;
  prerequisite_vuln_id: number;
  notes?: string | null;
  chain_stage?: string | null;
  dependent_title?: string | null;
  dependent_vuln_code?: string | null;
  dependent_severity?: string | null;
  dependent_status?: string | null;
  dependent_cve_id?: string | null;
  dependent_kev_flag?: boolean | null;
  dependent_composite_priority?: number | null;
}

interface VulnSearchOption {
  id: number;
  title: string;
  vuln_id?: string | null;
  cve_id?: string | null;
  severity?: string | null;
  status?: string | null;
}

const CHAIN_STAGE_OPTIONS = [
  { value: '',                    label: '— No stage —' },
  { value: 'initial_access',      label: 'Initial Access' },
  { value: 'execution',           label: 'Execution' },
  { value: 'privilege_escalation', label: 'Privilege Escalation' },
  { value: 'lateral_movement',    label: 'Lateral Movement' },
  { value: 'persistence',         label: 'Persistence' },
  { value: 'exfiltration',        label: 'Exfiltration' },
];

function DependenciesTab({ vulnId }: { vulnId: number }) {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [pickedVulnId, setPickedVulnId] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [chainStage, setChainStage] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const { data: chainData, isLoading } = useQuery({
    queryKey: ['vuln-dependencies', vulnId],
    queryFn: async () => {
      const res = await vulnManagementApi.vulnerabilities.listDependencies(vulnId);
      return res.data as {
        prerequisites: ChainDependency[];
        dependents: ChainDependent[];
        chain_warning: string | null;
      };
    },
  });

  // Picker: pull every visible vuln (up to 500) once when the modal opens
  // so the ComboBoxInput can filter client-side instantly. 500 is enough
  // headroom for almost every tenant; if a tenant exceeds that we'd fall
  // back to server-side search — but the existing endpoint defaults to
  // open vulns only, so 500 covers very large estates in practice.
  const { data: allVulns, isFetching: pickerLoading } = useQuery({
    queryKey: ['vuln-picker-all'],
    queryFn: async () => {
      const res = await vulnManagementApi.vulnerabilities.getAll({ limit: 500 });
      const list = (res.data as VulnSearchOption[] | undefined) ?? [];
      // Exclude self — a vuln can't be its own prerequisite.
      return list.filter((v) => v.id !== vulnId);
    },
    enabled: showAdd,
    staleTime: 30_000,
  });

  // Shape the vulns into ComboBoxInput options, grouped by severity so
  // the dropdown shows sticky section headings (Critical, High, …).
  const pickerOptions: ComboBoxOption[] = React.useMemo(() => {
    const list = allVulns ?? [];
    const sevOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
    return list
      .slice()
      .sort((a, b) => {
        const sa = sevOrder[(a.severity || 'info').toLowerCase()] ?? 5;
        const sb = sevOrder[(b.severity || 'info').toLowerCase()] ?? 5;
        if (sa !== sb) return sa - sb;
        return (a.title || '').localeCompare(b.title || '');
      })
      .map((v) => {
        const sev = (v.severity || 'info').toLowerCase();
        const sevLabel = sev.charAt(0).toUpperCase() + sev.slice(1);
        const idTag = v.cve_id || v.vuln_id || `#${v.id}`;
        return {
          value: String(v.id),
          label: `${v.title}`,
          group: `${sevLabel} severity`,
          hint: idTag,
        } as ComboBoxOption;
      });
  }, [allVulns]);

  const addMutation = useMutation({
    mutationFn: async (body: { prerequisite_vuln_id: number; notes?: string; chain_stage?: string }) => {
      const res = await vulnManagementApi.vulnerabilities.addDependency(vulnId, body);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vuln-dependencies', vulnId] });
      setShowAdd(false);
      setPickedVulnId(null);
      setNotes('');
      setChainStage('');
      setErrorMsg(null);
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setErrorMsg(detail || 'Could not add dependency.');
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (dependencyId: number) => {
      const res = await vulnManagementApi.vulnerabilities.removeDependency(vulnId, dependencyId);
      return res.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vuln-dependencies', vulnId] });
    },
  });

  const submitAdd = () => {
    if (!pickedVulnId) {
      setErrorMsg('Pick a prerequisite vulnerability first.');
      return;
    }
    addMutation.mutate({
      prerequisite_vuln_id: pickedVulnId,
      notes: notes.trim() || undefined,
      chain_stage: chainStage || undefined,
    });
  };

  const renderSeverityChip = (sev?: string | null) => {
    const s = (sev || '').toLowerCase();
    const style = SEVERITY_STYLES[s] || SEVERITY_STYLES.info;
    return (
      <span className={`inline-flex items-center rounded-full px-1.5 py-0 text-[10px] font-semibold uppercase ${style.bg} ${style.text}`}>
        {style.label}
      </span>
    );
  };

  if (isLoading) return <PageLoader className="h-40" />;

  const prereqs = chainData?.prerequisites ?? [];
  const deps = chainData?.dependents ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold cw-text">Vulnerability Chain</h2>
          <p className="text-xs text-slate-500 mt-0.5 max-w-2xl">
            Declare prerequisites — vulnerabilities that must also exist for this one
            to be exploitable in practice. A privilege-escalation flaw on a server is
            far more urgent when a remote-code-execution flaw lets attackers reach
            that server in the first place.
          </p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setErrorMsg(null); }}
          className="btn-primary flex items-center gap-1.5 text-sm py-1 px-3"
        >
          <Plus size={14} />
          Add Prerequisite
        </button>
      </div>

      {chainData?.chain_warning && (
        <div className="rounded-md border border-orange-200 bg-orange-50 p-3 text-xs text-orange-900 flex items-start gap-2">
          <AlertCircle size={14} className="text-orange-600 flex-shrink-0 mt-0.5" />
          <div>{chainData.chain_warning}</div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Prerequisites: vulns this one depends on. */}
        <div className="cw-card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2 flex items-center gap-1.5">
            <Link2 size={12} />
            Prerequisites ({prereqs.length})
          </h3>
          <p className="text-[11px] text-slate-500 mb-2">
            Vulnerabilities that must be present for this one to be exploitable.
          </p>
          {prereqs.length === 0 ? (
            <p className="text-xs text-slate-500 italic py-3">No prerequisites declared.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {prereqs.map((p) => {
                const resolved = ['resolved', 'remediated', 'verified', 'closed', 'false_positive'].includes(
                  (p.prerequisite_status || '').toLowerCase()
                );
                return (
                  <li key={p.id} className="py-2 flex items-start gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={`/vulnerabilities/${p.prerequisite_vuln_id}`}
                          className="text-sm text-slate-900 hover:text-blue-600 hover:underline font-medium truncate"
                        >
                          {p.prerequisite_title || `#${p.prerequisite_vuln_id}`}
                        </Link>
                        {renderSeverityChip(p.prerequisite_severity)}
                        {p.prerequisite_kev_flag && (
                          <span className="inline-flex items-center rounded-full bg-red-50 px-1.5 py-0 text-[10px] font-bold text-red-700 border border-red-200">KEV</span>
                        )}
                        {resolved && (
                          <span className="inline-flex items-center rounded-full bg-emerald-50 px-1.5 py-0 text-[10px] font-semibold text-emerald-700 border border-emerald-200">Resolved</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                        {p.prerequisite_vuln_code && <span className="font-mono">{p.prerequisite_vuln_code}</span>}
                        {p.prerequisite_cve_id && <span className="font-mono">{p.prerequisite_cve_id}</span>}
                        {typeof p.prerequisite_composite_priority === 'number' && (
                          <span>priority {p.prerequisite_composite_priority.toFixed(2)}</span>
                        )}
                        {p.chain_stage && (
                          <span className="rounded bg-slate-100 px-1.5 py-0 uppercase tracking-wide text-[9px]">
                            {p.chain_stage.replace(/_/g, ' ')}
                          </span>
                        )}
                      </div>
                      {p.notes && <p className="text-xs text-slate-600 mt-1">{p.notes}</p>}
                    </div>
                    <button
                      onClick={() => removeMutation.mutate(p.id)}
                      className="text-slate-400 hover:text-red-600"
                      disabled={removeMutation.isPending}
                      title="Remove this dependency"
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Dependents: vulns that depend on this one. Read-only — managed
            from the other vuln's tab. */}
        <div className="cw-card p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-2 flex items-center gap-1.5">
            <Link2 size={12} className="rotate-180" />
            Depended On By ({deps.length})
          </h3>
          <p className="text-[11px] text-slate-500 mb-2">
            Vulnerabilities that declare this one as a prerequisite. Closing this
            row makes those rows less urgent.
          </p>
          {deps.length === 0 ? (
            <p className="text-xs text-slate-500 italic py-3">Nothing depends on this vulnerability.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {deps.map((d) => (
                <li key={d.id} className="py-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      href={`/vulnerabilities/${d.dependent_vuln_id}`}
                      className="text-sm text-slate-900 hover:text-blue-600 hover:underline font-medium truncate"
                    >
                      {d.dependent_title || `#${d.dependent_vuln_id}`}
                    </Link>
                    {renderSeverityChip(d.dependent_severity)}
                    {d.dependent_kev_flag && (
                      <span className="inline-flex items-center rounded-full bg-red-50 px-1.5 py-0 text-[10px] font-bold text-red-700 border border-red-200">KEV</span>
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                    {d.dependent_vuln_code && <span className="font-mono">{d.dependent_vuln_code}</span>}
                    {d.dependent_cve_id && <span className="font-mono">{d.dependent_cve_id}</span>}
                    {typeof d.dependent_composite_priority === 'number' && (
                      <span>priority {d.dependent_composite_priority.toFixed(2)}</span>
                    )}
                  </div>
                  {d.notes && <p className="text-xs text-slate-600 mt-1">{d.notes}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Add-prerequisite modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="cw-card w-full max-w-lg p-5 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-900">Add Prerequisite</h3>
              <button onClick={() => setShowAdd(false)} className="text-slate-500 hover:text-slate-900">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Prerequisite vulnerability *
                </label>
                <ComboBoxInput
                  value={pickedVulnId !== null ? String(pickedVulnId) : ''}
                  onChange={(v) => {
                    const n = Number(v);
                    setPickedVulnId(Number.isFinite(n) && n > 0 ? n : null);
                  }}
                  options={pickerOptions}
                  allowCustom={false}
                  displayLabelInsteadOfValue
                  placeholder={
                    pickerLoading
                      ? 'Loading vulnerabilities…'
                      : pickerOptions.length === 0
                        ? 'No other vulnerabilities to pick from'
                        : `Search across ${pickerOptions.length} vulnerabilities…`
                  }
                  emptyText="No vulnerabilities match that query."
                  ariaLabel="Prerequisite vulnerability"
                  disabled={pickerLoading || pickerOptions.length === 0}
                />
                <p className="text-[10px] text-slate-500 mt-1">
                  Click to open the dropdown — type any part of the title, CVE-ID, or severity to filter.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Kill-chain stage (optional)</label>
                <select
                  value={chainStage}
                  onChange={(e) => setChainStage(e.target.value)}
                  className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                >
                  {CHAIN_STAGE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Rationale (recommended)</label>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="e.g. Priv-esc only matters once an RCE foothold is established via the prerequisite."
                  className="w-full rounded border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                />
              </div>

              {errorMsg && (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                  {errorMsg}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setShowAdd(false)} className="cw-btn-secondary text-sm px-3 py-1.5">
                  Cancel
                </button>
                <button
                  onClick={submitAdd}
                  disabled={addMutation.isPending}
                  className="btn-primary flex items-center gap-1.5 text-sm px-3 py-1.5"
                >
                  {addMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                  Add Dependency
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function AIAnalysisTab({
  vulnerability,
  suggestFixMutation,
  onAcceptSuggestion,
  acceptingSuggestion,
}: {
  vulnerability: VulnerabilityDetail;
  suggestFixMutation: {
    mutate: () => void;
    isPending: boolean;
    data?: SuggestFixJobResponse | null;
  };
  onAcceptSuggestion: (payload: Record<string, unknown>) => void;
  acceptingSuggestion: boolean;
}) {
  const [acceptedTitles, setAcceptedTitles] = useState<Set<string>>(new Set());
  // Per-card expand toggle so the operator can read the full AI payload
  // (description + metadata) before deciding whether to stage it as a
  // mitigation. Keyed on the suggestion title which is what the parent
  // uses to dedup the "already accepted" set.
  const [expandedTitles, setExpandedTitles] = useState<Set<string>>(new Set());

  const job = suggestFixMutation.data ?? null;
  const output = job?.output_data ?? null;
  const suggestions = (output?.suggestions ?? []).filter((s) => !!s?.title);
  const summary = (output?.summary ?? '').trim();
  const jobFailed = job?.status === 'failed';
  const fallbackText = (
    output?.recommendation ?? vulnerability.ai_recommendation ?? ''
  ).trim();

  // Has the operator at least once asked for AI analysis? We use this to
  // switch from "intro card with CTA" to "results section".
  const hasResult = suggestions.length > 0 || !!summary || !!fallbackText;

  // Quick context chips so the user can see WHICH signals the AI used.
  const contextChips: { label: string; tone: string }[] = [];
  if (vulnerability.kev_flag) contextChips.push({ label: 'CISA KEV', tone: 'bg-red-50 text-red-700 border-red-200' });
  if (typeof vulnerability.epss_score === 'number')
    contextChips.push({ label: `EPSS ${vulnerability.epss_score.toFixed(2)}`, tone: 'bg-amber-50 text-amber-700 border-amber-200' });
  if (typeof vulnerability.composite_priority === 'number')
    contextChips.push({ label: `Priority ${vulnerability.composite_priority.toFixed(1)}`, tone: 'bg-slate-50 text-slate-700 border-slate-200' });
  if (vulnerability.patch_references && vulnerability.patch_references.length > 0)
    contextChips.push({ label: `${vulnerability.patch_references.length} KB articles`, tone: 'bg-blue-50 text-blue-700 border-blue-200' });

  const acceptSuggestion = (s: AISuggestion) => {
    const priority = ['critical', 'high', 'medium', 'low'].includes((s.priority || '').toLowerCase())
      ? (s.priority || '').toLowerCase()
      : 'medium';
    const titlePrefix = '[AI] ';
    // The parent stages this suggestion into the Add Mitigation modal
    // pre-filled — it does NOT instantly create the row. We deliberately
    // don't add to `acceptedTitles` here, because the user can still cancel
    // the modal and re-stage; the authoritative "this is now in the
    // register" signal is the Mitigations tab refresh after createSuccess.
    // (The state lookup stays in place for any callers that want to wire
    // a confirmed-add hook later.)
    onAcceptSuggestion({
      action_title: (titlePrefix + s.title).slice(0, 255),
      action_description: s.description || undefined,
      priority,
    });
  };

  return (
    <div className="space-y-4">
      <div className="cw-card p-5">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold cw-text flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary-600" />
              AI-Powered Remediation Plan
            </h2>
            <p className="text-xs text-slate-600 mt-1 max-w-2xl">
              The AI reads this vulnerability&apos;s CVE description, CVSS score,
              <strong> CISA KEV flag</strong>, <strong>EPSS probability</strong>,
              vendor <strong>KB articles &amp; advisories</strong>, and linked
              asset context — then produces ranked, accept-with-one-click
              remediation steps.
            </p>
            {contextChips.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {contextChips.map((c) => (
                  <span key={c.label} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${c.tone}`}>
                    {c.label}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => suggestFixMutation.mutate()}
            disabled={suggestFixMutation.isPending}
            className="btn-primary flex items-center gap-2 text-sm whitespace-nowrap"
          >
            {suggestFixMutation.isPending ? (
              <>
                <Loader2 size={14} className="animate-spin" />
                Analyzing…
              </>
            ) : (
              <>
                <Sparkles size={14} />
                {hasResult ? 'Regenerate' : 'Generate Plan'}
              </>
            )}
          </button>
        </div>
      </div>

      {jobFailed && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <strong>AI analysis failed.</strong> {job?.error_message || 'Please try again.'}
        </div>
      )}

      {output && (
        <AiRecommendationSaver
          module="vuln_remediation"
          recommendationType="ai_remediation"
          entityType="vulnerability"
          entityId={vulnerability.id}
          title={`AI remediation · ${vulnerability.cve_id || `#${vulnerability.id}`}`}
          output={output as unknown as Record<string, unknown>}
          model="gpt-4o"
        />
      )}

      {summary && (
        <div className="rounded-xl border border-primary-200 bg-primary-50/60 p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-primary-700 mb-1.5">
            Overall recommendation
          </h3>
          <p className="text-sm text-slate-800 leading-relaxed whitespace-pre-wrap">
            {summary}
          </p>
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              Suggested mitigation actions
            </h3>
            <span className="text-xs text-slate-500">
              {suggestions.length} suggestion{suggestions.length === 1 ? '' : 's'} · ordered by urgency
            </span>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {suggestions.map((s, idx) => {
              const priorityKey = (s.priority || 'medium').toLowerCase();
              const priorityStyle = SUGGESTION_PRIORITY_STYLES[priorityKey] ?? SUGGESTION_PRIORITY_STYLES.medium;
              const categoryLabel = s.category ? SUGGESTION_CATEGORY_LABELS[s.category.toLowerCase()] ?? s.category : null;
              const accepted = acceptedTitles.has(s.title);
              return (
                <div key={`${idx}-${s.title}`} className="cw-card p-4 flex flex-col">
                  <div className="flex items-start gap-2 mb-2">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-semibold text-primary-700">
                      {idx + 1}
                    </span>
                    <h4 className="text-sm font-semibold text-slate-900 leading-snug">
                      {s.title}
                    </h4>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${priorityStyle}`}>
                      {priorityKey}
                    </span>
                    {s.effort && (
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                        effort · {s.effort.toLowerCase()}
                      </span>
                    )}
                    {categoryLabel && (
                      <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                        {categoryLabel}
                      </span>
                    )}
                  </div>
                  {s.description && (() => {
                    const isExpanded = expandedTitles.has(s.title);
                    const isLong = (s.description?.length ?? 0) > 220;
                    return (
                      <>
                        <div
                          className={`text-xs text-slate-700 leading-relaxed whitespace-pre-wrap flex-1 ${
                            isLong && !isExpanded ? 'line-clamp-4' : ''
                          }`}
                        >
                          {s.description}
                        </div>
                        {isLong && (
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedTitles((prev) => {
                                const next = new Set(prev);
                                if (next.has(s.title)) next.delete(s.title);
                                else next.add(s.title);
                                return next;
                              });
                            }}
                            className="mt-1 text-[11px] font-medium text-primary-700 hover:underline self-start"
                          >
                            {isExpanded ? 'Show less' : 'View details'}
                          </button>
                        )}
                      </>
                    );
                  })()}
                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                    <div className="text-[10px] uppercase tracking-wider text-slate-400">
                      AI suggestion
                    </div>
                    <button
                      type="button"
                      onClick={() => acceptSuggestion(s)}
                      disabled={accepted || acceptingSuggestion}
                      title={accepted ? 'Already in mitigations' : 'Open the Add Mitigation form pre-filled with this AI suggestion'}
                      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                        accepted
                          ? 'border border-emerald-200 bg-emerald-50 text-emerald-700 cursor-default'
                          : 'border border-primary-300 bg-primary-50 text-primary-700 hover:bg-primary-100 disabled:opacity-50'
                      }`}
                    >
                      {accepted ? (
                        <>
                          <CheckCircle size={12} />
                          Added to mitigations
                        </>
                      ) : acceptingSuggestion ? (
                        <>
                          <Loader2 size={12} className="animate-spin" />
                          Adding…
                        </>
                      ) : (
                        <>
                          <Plus size={12} />
                          Add as Mitigation
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Legacy markdown recommendation — show only when we have NO structured
          suggestions, so older runs (or fallback prose) still surface. */}
      {suggestions.length === 0 && fallbackText && (
        <div className="rounded-xl border border-primary-200 bg-primary-50 p-4">
          <h3 className="text-sm font-medium text-primary-600 mb-2">Recommendation</h3>
          {formatAIText(fallbackText)}
        </div>
      )}

      {!hasResult && !suggestFixMutation.isPending && !jobFailed && (
        <div className="cw-card p-6 text-center">
          <Sparkles className="mx-auto h-8 w-8 text-slate-300 mb-2" />
          <p className="text-sm text-slate-600">
            Click <strong>Generate Plan</strong> to produce a ranked remediation plan tuned to this
            vulnerability&apos;s real-world exploit signals and available vendor patches.
          </p>
        </div>
      )}
    </div>
  );
}


// ---------------------------------------------------------------------------
// buildThreatNarrative
// ---------------------------------------------------------------------------
// Deterministic, client-side natural-language summary of the threat-intel
// signals on a vuln. The whole point: a security analyst knows what
// "EPSS 0.94" and "CISA KEV" mean instantly — most operators don't. This
// helper turns those into one short paragraph + a recommended-action line
// that any reader can act on. No AI call, no API key, no latency — it's
// pure derivation from columns the row already carries.

function buildThreatNarrative(v: VulnerabilityDetail): {
  paragraph: string;
  action: string;
  tone: 'critical' | 'high' | 'medium' | 'low' | 'unknown';
} {
  const bits: string[] = [];
  const cve = v.cve_id || 'this vulnerability';
  const sev = (v.severity || '').toLowerCase();

  // Severity / CVSS sentence — universal opener.
  if (typeof v.cvss_score === 'number' && v.cvss_score > 0) {
    const sevLabel = sev === 'critical' ? 'critical-severity'
      : sev === 'high' ? 'high-severity'
      : sev === 'medium' ? 'medium-severity'
      : sev === 'low' ? 'low-severity'
      : 'rated';
    bits.push(`${cve} is a ${sevLabel} flaw (CVSS ${v.cvss_score.toFixed(1)} / 10).`);
  } else if (sev) {
    bits.push(`${cve} is currently classified as ${sev}.`);
  } else {
    bits.push(`${cve} is logged in this register.`);
  }

  // KEV sentence — strongest urgency signal.
  if (v.kev_flag) {
    const when = v.kev_date_added
      ? new Date(v.kev_date_added).toLocaleDateString(undefined, {
          year: 'numeric', month: 'short', day: 'numeric',
        })
      : '';
    bits.push(
      `CISA has confirmed it is being actively exploited in real attacks${when ? ` (added to the Known Exploited Vulnerabilities catalogue on ${when})` : ''}. This is not theoretical — attackers are using it right now.`
    );
  }

  // Public-exploit sentence — almost as strong as KEV; bolder than EPSS.
  if (typeof v.public_exploit_count === 'number' && v.public_exploit_count > 0) {
    bits.push(
      `Working exploit code is publicly available on GitHub (${v.public_exploit_count} ${v.public_exploit_count === 1 ? 'repository' : 'repositories'} reference this CVE), so any attacker can clone and run it — no skill required.`
    );
  }

  // EPSS sentence — converts the number into a plain-English likelihood.
  if (typeof v.epss_score === 'number') {
    const pctRank = typeof v.epss_percentile === 'number'
      ? (v.epss_percentile * 100)
      : null;
    let likelihood: string;
    if (v.epss_score >= 0.5 || (pctRank !== null && pctRank >= 95)) {
      likelihood = 'extremely likely to be exploited in the wild over the next 30 days';
    } else if (v.epss_score >= 0.1 || (pctRank !== null && pctRank >= 80)) {
      likelihood = 'has a meaningfully elevated chance of being exploited soon';
    } else if (v.epss_score >= 0.01) {
      likelihood = 'is unlikely to be exploited in the near term';
    } else {
      likelihood = 'has not shown signs of real-world exploitation';
    }
    const rankPart = pctRank !== null
      ? ` — it sits in the top ${(100 - pctRank).toFixed(1)}% of all known CVEs by predicted exploit probability`
      : '';
    bits.push(
      `Based on real-world exploit signals, it ${likelihood}${rankPart}.`
    );
  } else if (!v.kev_flag && v.cve_id) {
    bits.push(
      'Threat-intel data has not been pulled yet — click Enrich on the right to fetch CISA KEV, EPSS, and NVD details.'
    );
  }

  // Asset / blast-radius sentence.
  const linkedCount = v.linked_assets?.length ?? 0;
  if (linkedCount > 0) {
    if (linkedCount === 1) {
      bits.push(`It affects one of your assets: ${v.linked_assets![0]}.`);
    } else {
      const sample = v.linked_assets!.slice(0, 3).join(', ');
      bits.push(
        `It affects ${linkedCount} of your assets${linkedCount > 3 ? ` (including ${sample})` : ` (${sample})`}.`
      );
    }
  } else if (v.affected_host) {
    bits.push(`It was detected on ${v.affected_host}.`);
  }

  // Priority + recommended action.
  let action = '';
  let tone: 'critical' | 'high' | 'medium' | 'low' | 'unknown' = 'unknown';
  const p = v.composite_priority;
  const hasPublicExploit = typeof v.public_exploit_count === 'number' && v.public_exploit_count > 0;
  if (v.kev_flag) {
    action = 'Treat this as drop-everything urgent. Patch or apply compensating controls immediately, even ahead of your normal SLA.';
    tone = 'critical';
  } else if (hasPublicExploit) {
    action = 'Public exploit code exists — treat as imminently exploitable. Patch within the next maintenance window at the latest, and consider compensating controls in the meantime.';
    tone = 'critical';
  } else if (typeof p === 'number') {
    if (p >= 9) {
      action = 'Top of the queue. Patch within days, not weeks. Confirm linked assets are inventoried and consider compensating controls until the patch lands.';
      tone = 'critical';
    } else if (p >= 7) {
      action = 'High priority. Schedule remediation within your standard SLA window. Monitor for new exploit signals — if EPSS climbs, escalate.';
      tone = 'high';
    } else if (p >= 4) {
      action = 'Standard priority. Patch in your regular maintenance window; no special escalation needed at this time.';
      tone = 'medium';
    } else {
      action = 'Low priority. Track and remediate during routine cycles. Re-evaluate if asset criticality or exploit signals change.';
      tone = 'low';
    }
  } else if (sev === 'critical' || sev === 'high') {
    action = 'Patch promptly via your normal severity-driven SLA. Click Enrich to add real-world exploit signals so the priority gets sharper.';
    tone = sev === 'critical' ? 'critical' : 'high';
  } else if (sev) {
    action = 'Track and patch in your regular cycle. Enrichment data may sharpen the urgency.';
    tone = sev === 'medium' ? 'medium' : 'low';
  } else {
    action = 'Triage this finding and assign an owner so it does not stall.';
  }

  return { paragraph: bits.join(' '), action, tone };
}

const NARRATIVE_TONE_STYLES: Record<string, { card: string; chip: string; label: string }> = {
  critical: { card: 'border-red-200 bg-red-50', chip: 'bg-red-100 text-red-800', label: 'CRITICAL — ACT NOW' },
  high:     { card: 'border-orange-200 bg-orange-50', chip: 'bg-orange-100 text-orange-800', label: 'HIGH PRIORITY' },
  medium:   { card: 'border-yellow-200 bg-yellow-50', chip: 'bg-yellow-100 text-yellow-800', label: 'STANDARD PRIORITY' },
  low:      { card: 'border-blue-200 bg-blue-50', chip: 'bg-blue-100 text-blue-700', label: 'LOW PRIORITY' },
  unknown:  { card: 'border-slate-200 bg-slate-50', chip: 'bg-slate-100 text-slate-700', label: 'NOT YET TRIAGED' },
};


// ---------------------------------------------------------------------------
// ThreatIntelPanel
// ---------------------------------------------------------------------------
// Renders NVD canonical metadata + EPSS exploit probability + CISA KEV
// flag, plus an "Enrich" button that triggers /vulnerabilities/{id}/enrich.
// All fields are optional — un-enriched rows show only the Enrich button.
// The panel is hidden entirely for vulns with no CVE-ID since there's
// nothing the enrichment service can look up.

function ThreatIntelPanel({
  vulnerability, onAddRemediation,
}: {
  vulnerability: VulnerabilityDetail;
  /** Open the parent's Add Mitigation modal pre-filled with the patch
   *  title + description. Operator picks Action Type / Priority / Due
   *  Date / Assigned To before the row is created. */
  onAddRemediation: (prefill: {
    title: string;
    description: string;
    priority?: string;
    action_type?: string;
  }) => void;
}) {
  const qc = useQueryClient();
  const [showAllRefs, setShowAllRefs] = useState(false);
  const enrichMutation = useMutation({
    mutationFn: () => vulnManagementApi.vulnerabilities.enrich(vulnerability.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vulnerability', vulnerability.id] });
    },
  });

  // Per-row click handler — generates the title/description from the patch
  // ref / advisory ID / remediation text and asks the parent to open the
  // Add Mitigation modal pre-filled. The parent owns the modal + the real
  // mutation; this panel just feeds it candidates. The previous "direct
  // POST with hard-coded high priority + remediate type" path is gone —
  // operators now choose Action Type / Priority (override) / Due Date /
  // Assigned To explicitly.
  const addPatchAsRemediation = (
    _key: string,
    title: string,
    description: string,
  ) => {
    onAddRemediation({
      title: title.slice(0, 255),
      description,
      // Vendor patches default to remediate + high priority — the operator
      // can override either in the modal before submitting.
      action_type: 'remediate',
      priority: 'high',
    });
  };

  // Phase 6 — vendor patch intelligence sync. Independent mutation so the
  // operator can refresh KB articles without re-pulling EPSS/KEV.
  // Tracks both success state AND a banner message so the user sees explicit
  // feedback after clicking Sync (previously: silent no-op when MSRC said
  // "not a Microsoft CVE", which read like a broken button).
  const [patchSyncBanner, setPatchSyncBanner] = useState<{
    tone: 'success' | 'info' | 'error';
    text: string;
  } | null>(null);

  const syncPatchMutation = useMutation({
    mutationFn: async () => {
      const res = await vulnManagementApi.vulnerabilities.syncPatchInfo(vulnerability.id);
      return res.data as {
        patch_references?: Array<{ source: string; id: string; url: string; type: string }>;
        vendor_advisory_ids?: string[];
        remediation_guidance?: string | null;
        psirt_source?: string | null;
      };
    },
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['vulnerability', vulnerability.id] });
      const patchCount = updated?.patch_references?.length ?? 0;
      const advisoryCount = updated?.vendor_advisory_ids?.length ?? 0;
      const hasRemediation = !!updated?.remediation_guidance;
      const source = updated?.psirt_source || '';
      if (patchCount > 0 || advisoryCount > 0) {
        const sourceLabel = source ? ` from ${source.toUpperCase().replace('_', ' ')}` : '';
        setPatchSyncBanner({
          tone: 'success',
          text: `Found ${patchCount} patch link${patchCount === 1 ? '' : 's'}${advisoryCount > 0 ? ` and ${advisoryCount} advisory${advisoryCount === 1 ? '' : ' IDs'}` : ''}${sourceLabel}.`,
        });
      } else if (hasRemediation) {
        setPatchSyncBanner({
          tone: 'success',
          text: source === 'cisa_kev'
            ? 'Pulled CISA KEV remediation guidance.'
            : 'Pulled vendor remediation guidance.',
        });
      } else {
        setPatchSyncBanner({
          tone: 'info',
          text: 'No vendor patches found for this CVE. Check NVD references in the Threat Intelligence panel — they often include the upstream advisory link.',
        });
      }
    },
    onError: (err: unknown) => {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setPatchSyncBanner({
        tone: 'error',
        text: detail || 'Patch sync failed. Check network / try again.',
      });
    },
  });

  // If there's no CVE-ID, enrichment can't do anything — skip the whole
  // panel. Keeps the right column compact for manual/internal findings.
  if (!vulnerability.cve_id) return null;

  const hasEnrichment =
    vulnerability.kev_flag ||
    typeof vulnerability.epss_score === 'number' ||
    !!vulnerability.nvd_last_synced_at ||
    (vulnerability.exploit_references && vulnerability.exploit_references.length > 0);

  const hasPatchIntel =
    (vulnerability.patch_references && vulnerability.patch_references.length > 0) ||
    (vulnerability.vendor_advisory_ids && vulnerability.vendor_advisory_ids.length > 0) ||
    !!vulnerability.remediation_guidance ||
    !!vulnerability.psirt_synced_at;

  const fmt = (iso?: string) =>
    iso ? new Date(iso).toLocaleDateString() : '—';

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard API can be denied in some browser sandboxes — silently
      // fall through. Operators can always copy from the visible badge.
    }
  };

  const refHostname = (url: string) => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url.replace(/^https?:\/\//, '').split('/')[0];
    }
  };
  const refTail = (url: string) => {
    try {
      const u = new URL(url);
      return (u.pathname + u.search).slice(0, 80);
    } catch {
      return url.replace(/^https?:\/\/[^/]+/, '').slice(0, 80);
    }
  };

  // Auto-trigger enrichment on first view when the vuln has a CVE but has
  // never been enriched. The narrative card and dashboard charts both rely
  // on these fields, so the operator shouldn't have to click anything for
  // them to populate. Idempotent — once nvd_last_synced_at is set, the
  // effect short-circuits.
  React.useEffect(() => {
    if (!vulnerability.cve_id) return;
    if (vulnerability.nvd_last_synced_at) return;
    if (enrichMutation.isPending || enrichMutation.isSuccess) return;
    enrichMutation.mutate();
    // We deliberately depend only on the vuln id + a flip-flag derived from
    // enrichment state to avoid re-firing on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vulnerability.id, vulnerability.nvd_last_synced_at]);

  const narrative = buildThreatNarrative(vulnerability);
  const narrativeStyle = NARRATIVE_TONE_STYLES[narrative.tone] ?? NARRATIVE_TONE_STYLES.unknown;

  return (
    <div className="space-y-4">
    {/* What this means — plain-English explanation of EPSS / KEV / NVD /
        priority signals. Generated client-side from the row's columns, so
        the user never has to know what these acronyms mean. Always visible
        when a CVE is present (it educates even before enrichment runs). */}
    <div className={`cw-card p-4 border ${narrativeStyle.card}`}>
      <div className="flex items-start gap-3 flex-wrap">
        <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${narrativeStyle.chip}`}>
          {narrativeStyle.label}
        </span>
        <div className="flex-1 min-w-0 space-y-1.5">
          <p className="text-sm text-slate-800 leading-relaxed">
            {narrative.paragraph}
          </p>
          <p className="text-sm font-medium text-slate-900 leading-relaxed">
            <strong>What to do:</strong> {narrative.action}
          </p>
          {enrichMutation.isPending && !vulnerability.nvd_last_synced_at && (
            <p className="text-xs text-slate-500 italic flex items-center gap-1.5">
              <Loader2 size={11} className="animate-spin" />
              Fetching threat intelligence in the background…
            </p>
          )}
        </div>
      </div>
    </div>

    <div className="grid gap-4 lg:grid-cols-2">
      {/* ── Threat Intelligence (left card) ───────────────────────────── */}
      <div className="cw-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold cw-text flex items-center gap-1.5">
            <Shield className="h-4 w-4 text-slate-600" />
            Threat Intelligence
          </h2>
          <button
            onClick={() => enrichMutation.mutate()}
            disabled={enrichMutation.isPending}
            className="inline-flex items-center gap-1.5 text-xs rounded-md border border-slate-300 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            title="Pull latest NVD + EPSS + CISA KEV for this CVE"
          >
            {enrichMutation.isPending ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            {hasEnrichment ? 'Re-enrich' : 'Enrich'}
          </button>
        </div>

        {!hasEnrichment && !enrichMutation.isSuccess && (
          <p className="text-xs text-slate-500 italic">
            Click <strong>Enrich</strong> to pull CISA KEV, EPSS, and NVD
            metadata for {vulnerability.cve_id}.
          </p>
        )}

        {hasEnrichment && (
          <div className="space-y-4">
            {/* CISA KEV — strongest signal, render first when present. */}
            {vulnerability.kev_flag && (
              <div className="rounded-md border border-red-300 bg-red-50 p-3">
                <div className="text-xs font-bold text-red-800 uppercase tracking-wider flex items-center gap-1.5">
                  <AlertCircle size={12} />
                  CISA Known Exploited
                </div>
                <div className="text-xs text-red-700 mt-1">
                  Listed in the CISA KEV catalogue — actively exploited in the wild.
                  {vulnerability.kev_date_added && (
                    <> Added <strong>{fmt(vulnerability.kev_date_added)}</strong>.</>
                  )}
                </div>
              </div>
            )}

            {/* Public exploit (GitHub PoC) — second-strongest signal after KEV.
                A non-zero count means an unskilled attacker can clone-and-run. */}
            {typeof vulnerability.public_exploit_count === 'number' && vulnerability.public_exploit_count > 0 && (
              <div className="rounded-md border border-rose-200 bg-rose-50 p-3">
                <div className="text-xs font-bold text-rose-800 uppercase tracking-wider flex items-center gap-1.5">
                  <AlertCircle size={12} />
                  Public Exploit Available
                </div>
                <div className="text-xs text-rose-700 mt-1">
                  <strong>{vulnerability.public_exploit_count}</strong>{' '}
                  public {vulnerability.public_exploit_count === 1 ? 'repository' : 'repositories'} on GitHub
                  reference this CVE — clone-and-run exploit code is in the wild.
                </div>
                {vulnerability.public_exploit_refs && vulnerability.public_exploit_refs.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {vulnerability.public_exploit_refs.slice(0, 4).map((ref) => (
                      <a
                        key={ref.full_name}
                        href={ref.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 text-[11px] text-rose-700 hover:text-rose-900 hover:underline"
                        title={ref.description || ref.full_name}
                      >
                        <ExternalLink size={10} className="flex-shrink-0" />
                        <span className="font-mono truncate flex-1 min-w-0">{ref.full_name}</span>
                        <span className="flex-shrink-0 text-rose-500">★ {ref.stars}</span>
                      </a>
                    ))}
                    {vulnerability.public_exploit_refs.length > 4 && (
                      <p className="text-[10px] text-rose-500 italic">
                        + {vulnerability.public_exploit_refs.length - 4} more
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Stat row — EPSS, Priority, NVD Published, Last Synced. */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {typeof vulnerability.epss_score === 'number' && (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">EPSS</div>
                  <div className="text-sm font-semibold text-slate-900 mt-0.5">
                    {vulnerability.epss_score.toFixed(4)}
                  </div>
                  {typeof vulnerability.epss_percentile === 'number' && (
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {(vulnerability.epss_percentile * 100).toFixed(1)}th pct
                    </div>
                  )}
                </div>
              )}
              {typeof vulnerability.composite_priority === 'number' && (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Priority</div>
                  <div className="text-sm font-semibold text-slate-900 mt-0.5">
                    {vulnerability.composite_priority.toFixed(2)} / 10
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    CVSS + EPSS + KEV + asset
                  </div>
                </div>
              )}
              {vulnerability.nvd_published_at && (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">NVD Published</div>
                  <div className="text-sm font-semibold text-slate-900 mt-0.5">
                    {fmt(vulnerability.nvd_published_at)}
                  </div>
                </div>
              )}
              {vulnerability.nvd_last_synced_at && (
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Last Synced</div>
                  <div className="text-xs font-medium text-slate-700 mt-0.5">
                    {new Date(vulnerability.nvd_last_synced_at).toLocaleDateString()}
                  </div>
                  <div className="text-[10px] text-slate-500 mt-0.5">
                    {new Date(vulnerability.nvd_last_synced_at).toLocaleTimeString()}
                  </div>
                </div>
              )}
            </div>

            {/* References — 2-column grid; toggle reveals the rest. */}
            {vulnerability.exploit_references && vulnerability.exploit_references.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    References ({vulnerability.exploit_references.length})
                  </div>
                  {vulnerability.exploit_references.length > 6 && (
                    <button
                      type="button"
                      onClick={() => setShowAllRefs((v) => !v)}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      {showAllRefs ? 'Show less' : `Show all`}
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                  {(showAllRefs
                    ? vulnerability.exploit_references
                    : vulnerability.exploit_references.slice(0, 6)
                  ).map((url, idx) => (
                    <a
                      key={idx}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:border-blue-300 hover:bg-blue-50 min-w-0"
                      title={url}
                    >
                      <ExternalLink size={11} className="text-slate-400 shrink-0 group-hover:text-blue-500" />
                      <span className="truncate">
                        <span className="font-medium text-slate-800">{refHostname(url)}</span>
                        <span className="text-slate-500">{refTail(url)}</span>
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Patch Information (right card) ────────────────────────────── */}
      <div className="cw-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold cw-text flex items-center gap-1.5">
            <FileCheck className="h-4 w-4 text-slate-600" />
            Patch Information
            {vulnerability.psirt_source && (
              <span className="ml-1 inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                {vulnerability.psirt_source}
              </span>
            )}
          </h2>
          <button
            onClick={() => syncPatchMutation.mutate()}
            disabled={syncPatchMutation.isPending}
            className="inline-flex items-center gap-1.5 text-xs rounded-md border border-slate-300 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            title="Pull KB articles + remediation from Microsoft Security Response Center"
          >
            {syncPatchMutation.isPending ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RefreshCw size={12} />
            )}
            {hasPatchIntel ? 'Re-sync' : 'Sync patch info'}
          </button>
        </div>

        {patchSyncBanner && (
          <div
            className={`mb-3 rounded-md border p-2.5 text-xs ${
              patchSyncBanner.tone === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : patchSyncBanner.tone === 'error'
                ? 'border-red-200 bg-red-50 text-red-700'
                : 'border-blue-200 bg-blue-50 text-blue-800'
            }`}
          >
            {patchSyncBanner.text}
          </div>
        )}

        {!hasPatchIntel && !syncPatchMutation.isSuccess && (
          <p className="text-xs text-slate-500 italic">
            Click <strong>Sync patch info</strong> to look up KB articles,
            vendor advisories, and CISA-published remediation guidance for {vulnerability.cve_id}.
          </p>
        )}

        {hasPatchIntel && (
          <div className="space-y-4">
            {vulnerability.patch_references && vulnerability.patch_references.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-1.5">
                  KB Articles & Patches ({vulnerability.patch_references.length})
                </div>
                <p className="text-[10px] text-slate-500 mb-2">
                  Click <strong>+ Add</strong> on any patch to open the Add Mitigation form, pre-filled with the patch details — set the action type, priority, due date and assignee before creating.
                </p>
                <div className="space-y-1.5">
                  {vulnerability.patch_references.map((ref, idx) => {
                    const key = `kb:${ref.source}:${ref.id}:${idx}`;
                    const title = ref.source === 'msrc'
                      ? `Apply Microsoft patch ${ref.id}`
                      : `Apply ${ref.source.replace('_', ' ')} update: ${ref.id}`;
                    const description = `Vendor patch/advisory: ${ref.id}\nSource: ${ref.source}\nURL: ${ref.url}`;
                    return (
                      <div
                        key={key}
                        className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2.5 py-1.5"
                      >
                        <a
                          href={ref.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={ref.url}
                          className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                            ref.type === 'kb'
                              ? 'text-blue-700 hover:text-blue-900'
                              : 'text-slate-700 hover:text-slate-900'
                          }`}
                        >
                          <ExternalLink size={11} />
                          {ref.id}
                        </a>
                        <span className="text-[10px] uppercase tracking-wide text-slate-400">{ref.source.replace('_', ' ')}</span>
                        <div className="flex-1" />
                        <button
                          type="button"
                          onClick={() => addPatchAsRemediation(key, title, description)}
                          className="inline-flex items-center gap-1 rounded border border-blue-300 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 transition-colors hover:bg-blue-100"
                          title="Open the Add Mitigation form pre-filled with this patch"
                        >
                          <Plus size={10} />
                          Add
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {vulnerability.vendor_advisory_ids && vulnerability.vendor_advisory_ids.length > 0 && (
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-600 mb-1.5">
                  Vendor Advisories
                </div>
                <div className="space-y-1.5">
                  {vulnerability.vendor_advisory_ids.map((adv) => {
                    const key = `advisory:${adv}`;
                    const title = `Follow vendor advisory ${adv}`;
                    const description = `Vendor advisory: ${adv}\nFor ${vulnerability.cve_id || vulnerability.title}.\nRefer to the linked KB articles for patch deployment steps.`;
                    return (
                      <div
                        key={key}
                        className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50/60 px-2.5 py-1.5"
                      >
                        <span className="inline-flex items-center text-xs font-medium text-amber-800">
                          {adv}
                        </span>
                        <div className="flex-1" />
                        <button
                          type="button"
                          onClick={() => addPatchAsRemediation(key, title, description)}
                          className="inline-flex items-center gap-1 rounded border border-amber-400 bg-white px-2 py-0.5 text-[10px] font-semibold text-amber-800 transition-colors hover:bg-amber-100"
                          title="Open the Add Mitigation form pre-filled with this advisory"
                        >
                          <Plus size={10} />
                          Add
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {vulnerability.remediation_guidance && (() => {
              const key = 'remediation_guidance';
              const guidance = vulnerability.remediation_guidance || '';
              const sourceTag = vulnerability.psirt_source ? ` (${vulnerability.psirt_source.toUpperCase()})` : '';
              return (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Remediation Guidance
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => copyToClipboard(guidance)}
                        className="text-[10px] text-slate-500 hover:text-slate-700"
                        title="Copy remediation text to clipboard"
                      >
                        Copy
                      </button>
                      <button
                        type="button"
                        onClick={() => addPatchAsRemediation(
                          key,
                          `Apply vendor remediation${sourceTag}`,
                          guidance,
                        )}
                        className="inline-flex items-center gap-1 rounded border border-blue-300 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 transition-colors hover:bg-blue-100"
                        title="Open the Add Mitigation form pre-filled with this guidance"
                      >
                        <Plus size={10} />
                        Add as Remediation
                      </button>
                    </div>
                  </div>
                  <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 whitespace-pre-wrap break-words">
                    {guidance}
                  </div>
                </div>
              );
            })()}

            {vulnerability.psirt_synced_at && (
              <div className="text-[11px] text-slate-500">
                Last PSIRT sync: {new Date(vulnerability.psirt_synced_at).toLocaleString()}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
// ExceptionWorkflowPanel  (Phase 8)
// ---------------------------------------------------------------------------
// State-aware UI for the request → approve|deny → revoke|expired FSM. The
// backend is the source of truth and rejects invalid moves with a 400, but
// we mirror the FSM client-side so the operator only sees the actions that
// are currently legal. Separation of duties is enforced server-side, so the
// requester cannot also approve or deny — we disable those buttons locally
// for the requester to keep the UX honest.

const EXCEPTION_STATE_STYLES: Record<string, string> = {
  none: 'border-slate-200 bg-slate-50 text-slate-600',
  requested: 'border-amber-200 bg-amber-50 text-amber-800',
  approved: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  denied: 'border-rose-200 bg-rose-50 text-rose-800',
  expired: 'border-orange-200 bg-orange-50 text-orange-800',
  revoked: 'border-slate-300 bg-slate-100 text-slate-700',
};

function ExceptionWorkflowPanel({
  vulnerability,
  currentUserId,
}: {
  vulnerability: VulnerabilityDetail;
  currentUserId: number | null;
}) {
  const qc = useQueryClient();
  const state = (vulnerability.exception_status || 'none') as string;
  const isRequester =
    currentUserId !== null &&
    vulnerability.exception_requested_by_id !== null &&
    vulnerability.exception_requested_by_id === currentUserId;

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<
    'request' | 'approve' | 'deny' | 'revoke' | null
  >(null);
  const [justification, setJustification] = useState('');
  const [compensatingControls, setCompensatingControls] = useState('');
  const [requestedExpiry, setRequestedExpiry] = useState('');
  const [approvalComment, setApprovalComment] = useState('');
  const [approvalExpiry, setApprovalExpiry] = useState('');
  const [denialReason, setDenialReason] = useState('');
  const [revocationReason, setRevocationReason] = useState('');

  const resetForm = () => {
    setErrorMessage(null);
    setActiveAction(null);
    setJustification('');
    setCompensatingControls('');
    setRequestedExpiry('');
    setApprovalComment('');
    setApprovalExpiry('');
    setDenialReason('');
    setRevocationReason('');
  };

  const onError = (e: unknown) => {
    const msg =
      (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail ||
      (e as { message?: string })?.message ||
      'Action failed';
    setErrorMessage(msg);
  };

  const requestMutation = useMutation({
    mutationFn: () =>
      vulnManagementApi.vulnerabilities.exceptionRequest(vulnerability.id, {
        justification: justification.trim(),
        compensating_controls: compensatingControls
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean),
        expires_at: requestedExpiry ? new Date(requestedExpiry).toISOString() : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vulnerability', vulnerability.id] });
      resetForm();
    },
    onError,
  });

  const approveMutation = useMutation({
    mutationFn: () =>
      vulnManagementApi.vulnerabilities.exceptionApprove(vulnerability.id, {
        comment: approvalComment.trim() || undefined,
        expires_at: approvalExpiry ? new Date(approvalExpiry).toISOString() : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vulnerability', vulnerability.id] });
      resetForm();
    },
    onError,
  });

  const denyMutation = useMutation({
    mutationFn: () =>
      vulnManagementApi.vulnerabilities.exceptionDeny(vulnerability.id, {
        denial_reason: denialReason.trim(),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vulnerability', vulnerability.id] });
      resetForm();
    },
    onError,
  });

  const revokeMutation = useMutation({
    mutationFn: () =>
      vulnManagementApi.vulnerabilities.exceptionRevoke(vulnerability.id, {
        reason: revocationReason.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vulnerability', vulnerability.id] });
      resetForm();
    },
    onError,
  });

  const fmt = (iso?: string | null) =>
    iso ? new Date(iso).toLocaleDateString() : '—';

  const canRequest = ['none', 'denied', 'expired'].includes(state);
  const canDecide = state === 'requested' && !isRequester;
  const canRevoke = state === 'approved';
  const stateStyle = EXCEPTION_STATE_STYLES[state] || EXCEPTION_STATE_STYLES.none;

  return (
    <div className="cw-card p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold cw-text flex items-center gap-1.5">
          <CheckCircle className="h-4 w-4 text-slate-600" />
          Exception Workflow
        </h2>
        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${stateStyle}`}>
          {state}
        </span>
      </div>

      {errorMessage && (
        <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
          {errorMessage}
        </div>
      )}

      {/* Read-only snapshot of the current exception state. */}
      {state !== 'none' && (
        <dl className="space-y-1.5 text-xs mb-3">
          {vulnerability.exception_requested_at && (
            <div>
              <dt className="text-slate-500">Requested</dt>
              <dd className="text-slate-700">
                {fmt(vulnerability.exception_requested_at)}
                {vulnerability.exception_requested_by_id != null && (
                  <span className="text-slate-500 ml-1">
                    (user #{vulnerability.exception_requested_by_id})
                  </span>
                )}
              </dd>
            </div>
          )}
          {vulnerability.exception_justification && (
            <div>
              <dt className="text-slate-500">Justification</dt>
              <dd className="text-slate-700 whitespace-pre-wrap">
                {vulnerability.exception_justification}
              </dd>
            </div>
          )}
          {vulnerability.exception_compensating_controls &&
            vulnerability.exception_compensating_controls.length > 0 && (
              <div>
                <dt className="text-slate-500">Compensating controls</dt>
                <dd className="flex flex-wrap gap-1 mt-0.5">
                  {vulnerability.exception_compensating_controls.map((c) => (
                    <span
                      key={c}
                      className="inline-flex items-center rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] text-slate-700"
                    >
                      {c}
                    </span>
                  ))}
                </dd>
              </div>
            )}
          {vulnerability.exception_approved_at && (
            <div>
              <dt className="text-slate-500">Approved</dt>
              <dd className="text-slate-700">
                {fmt(vulnerability.exception_approved_at)}
                {vulnerability.exception_expires_at && (
                  <span className="text-slate-500 ml-1">
                    · expires {fmt(vulnerability.exception_expires_at)}
                  </span>
                )}
              </dd>
            </div>
          )}
          {vulnerability.exception_denial_reason && (
            <div>
              <dt className="text-slate-500">Denial reason</dt>
              <dd className="text-rose-700 whitespace-pre-wrap">
                {vulnerability.exception_denial_reason}
              </dd>
            </div>
          )}
          {vulnerability.exception_revoked_at && (
            <div>
              <dt className="text-slate-500">Revoked</dt>
              <dd className="text-slate-700">
                {fmt(vulnerability.exception_revoked_at)}
                {vulnerability.exception_revocation_reason && (
                  <span className="text-slate-600 ml-1">
                    — {vulnerability.exception_revocation_reason}
                  </span>
                )}
              </dd>
            </div>
          )}
        </dl>
      )}

      {/* Action area — state-aware. We only render the form that matches
          the current state + the user's role. */}
      {!activeAction && (
        <div className="flex flex-wrap gap-2">
          {canRequest && (
            <button
              onClick={() => setActiveAction('request')}
              className="inline-flex items-center gap-1.5 text-xs rounded-md border border-blue-300 bg-blue-50 px-2.5 py-1 text-blue-700 hover:bg-blue-100"
            >
              {state === 'none' ? 'Request exception' : 'Re-request exception'}
            </button>
          )}
          {canDecide && (
            <>
              <button
                onClick={() => setActiveAction('approve')}
                className="inline-flex items-center gap-1.5 text-xs rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-emerald-700 hover:bg-emerald-100"
              >
                Approve
              </button>
              <button
                onClick={() => setActiveAction('deny')}
                className="inline-flex items-center gap-1.5 text-xs rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-rose-700 hover:bg-rose-100"
              >
                Deny
              </button>
            </>
          )}
          {state === 'requested' && isRequester && (
            <p className="text-xs text-slate-500 italic">
              Awaiting reviewer. You requested this exception, so separation of
              duties prevents you from approving or denying it.
            </p>
          )}
          {canRevoke && (
            <button
              onClick={() => setActiveAction('revoke')}
              className="inline-flex items-center gap-1.5 text-xs rounded-md border border-slate-300 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-50"
            >
              Revoke
            </button>
          )}
          {state === 'revoked' && (
            <p className="text-xs text-slate-500 italic">
              Revoked exceptions are terminal — request a new one if needed.
            </p>
          )}
        </div>
      )}

      {/* Forms — only one renders at a time. */}
      {activeAction === 'request' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!justification.trim()) {
              setErrorMessage('Justification is required.');
              return;
            }
            requestMutation.mutate();
          }}
          className="mt-3 space-y-2"
        >
          <div>
            <label className="block text-xs font-medium text-slate-600">Justification *</label>
            <textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Compensating controls <span className="text-slate-400">(comma-separated)</span>
            </label>
            <input
              value={compensatingControls}
              onChange={(e) => setCompensatingControls(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900"
              placeholder="WAF rule WAF-1023, IDS sig 5067, ..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">Desired expiry</label>
            <input
              type="date"
              value={requestedExpiry}
              onChange={(e) => setRequestedExpiry(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={resetForm}
              className="text-xs rounded-md border border-slate-300 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={requestMutation.isPending}
              className="inline-flex items-center gap-1.5 text-xs rounded-md bg-blue-600 px-2.5 py-1 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {requestMutation.isPending && <Loader2 size={12} className="animate-spin" />}
              Submit
            </button>
          </div>
        </form>
      )}

      {activeAction === 'approve' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            approveMutation.mutate();
          }}
          className="mt-3 space-y-2"
        >
          <div>
            <label className="block text-xs font-medium text-slate-600">Approval comment</label>
            <textarea
              value={approvalComment}
              onChange={(e) => setApprovalComment(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Override expiry <span className="text-slate-400">(optional)</span>
            </label>
            <input
              type="date"
              value={approvalExpiry}
              onChange={(e) => setApprovalExpiry(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={resetForm}
              className="text-xs rounded-md border border-slate-300 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={approveMutation.isPending}
              className="inline-flex items-center gap-1.5 text-xs rounded-md bg-emerald-600 px-2.5 py-1 text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {approveMutation.isPending && <Loader2 size={12} className="animate-spin" />}
              Approve exception
            </button>
          </div>
        </form>
      )}

      {activeAction === 'deny' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!denialReason.trim()) {
              setErrorMessage('A denial reason is required.');
              return;
            }
            denyMutation.mutate();
          }}
          className="mt-3 space-y-2"
        >
          <div>
            <label className="block text-xs font-medium text-slate-600">Denial reason *</label>
            <textarea
              value={denialReason}
              onChange={(e) => setDenialReason(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900"
              required
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={resetForm}
              className="text-xs rounded-md border border-slate-300 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={denyMutation.isPending}
              className="inline-flex items-center gap-1.5 text-xs rounded-md bg-rose-600 px-2.5 py-1 text-white hover:bg-rose-700 disabled:opacity-50"
            >
              {denyMutation.isPending && <Loader2 size={12} className="animate-spin" />}
              Deny exception
            </button>
          </div>
        </form>
      )}

      {activeAction === 'revoke' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            revokeMutation.mutate();
          }}
          className="mt-3 space-y-2"
        >
          <div>
            <label className="block text-xs font-medium text-slate-600">
              Revocation reason <span className="text-slate-400">(optional)</span>
            </label>
            <textarea
              value={revocationReason}
              onChange={(e) => setRevocationReason(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900"
              placeholder="Compensating control failed, new threat intelligence, ..."
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={resetForm}
              className="text-xs rounded-md border border-slate-300 bg-white px-2.5 py-1 text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={revokeMutation.isPending}
              className="inline-flex items-center gap-1.5 text-xs rounded-md bg-slate-700 px-2.5 py-1 text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {revokeMutation.isPending && <Loader2 size={12} className="animate-spin" />}
              Revoke
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
