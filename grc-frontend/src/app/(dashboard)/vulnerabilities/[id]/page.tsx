'use client';

import React, { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vulnManagementApi, assetsApi, ermApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { InlineLinkPicker, PageLoader } from '@/components/ui';
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
  Link as LinkIcon,
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
}

interface Mitigation {
  id: number;
  action_title: string;
  action_description?: string;
  status: string;
  priority?: string;
  target_date?: string;
  owner_id?: number;
  owner_name?: string;
  completed_at?: string;
}

interface AssetLink {
  id: number;
  asset_id: number;
  asset_name: string;
  asset_type?: string;
  relationship_type?: string;
}

interface ControlLink {
  id: number;
  framework_control_id?: number;
  normalized_control_id?: number;
  internal_control_id?: number;
  compliance_impact?: string;
  notes?: string;
  framework_control_code?: string;
  framework_control_name?: string;
  normalized_control_code?: string;
  normalized_control_name?: string;
  internal_control_name?: string;
}

interface Retest {
  id: number;
  test_date: string;
  result: string;
  tester_name?: string;
  notes?: string;
}

interface RiskException {
  id: number;
  vuln_id?: string;
  title?: string;
  severity?: string;
  is_exception: boolean;
  exception_reason?: string;
  exception_approved_by?: number;
  exception_expiry?: string;
  exception_approver_name?: string;
  days_until_expiry?: number;
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

const TABS = [
  { id: 'overview', label: 'Overview', icon: FileText },
  { id: 'mitigations', label: 'Mitigations', icon: CheckCircle },
  { id: 'assets', label: 'Assets', icon: Server },
  { id: 'controls', label: 'Controls', icon: Shield },
  { id: 'departments', label: 'Departments', icon: Users },
  { id: 'workflow', label: 'Workflow', icon: GitBranch },
  { id: 'escalations', label: 'Escalations', icon: Bell },
  { id: 'ai', label: 'AI Analysis', icon: Sparkles },
  { id: 'exception', label: 'Exception', icon: AlertCircle },
];

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

function getSeverityStyle(severity: string) {
  return SEVERITY_STYLES[severity?.toLowerCase()] || SEVERITY_STYLES.info;
}

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

  const [activeTab, setActiveTab] = useState('overview');
  const [showMitigationModal, setShowMitigationModal] = useState(false);
  const [showRetestModal, setShowRetestModal] = useState(false);
  const [showExceptionModal, setShowExceptionModal] = useState(false);
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

  const { data: mitigations } = useQuery({
    queryKey: ['vuln-mitigations', vulnId],
    queryFn: async () => {
      const response = await vulnManagementApi.mitigations.list(vulnId);
      return response.data as Mitigation[];
    },
    enabled: activeTab === 'mitigations',
  });

  const { data: assetLinks } = useQuery({
    queryKey: ['vuln-assets', vulnId],
    queryFn: async () => {
      const response = await vulnManagementApi.assetLinks.list(vulnId);
      return response.data as AssetLink[];
    },
    enabled: activeTab === 'assets',
  });

  const { data: controlLinks } = useQuery({
    queryKey: ['vuln-controls', vulnId],
    queryFn: async () => {
      const response = await vulnManagementApi.controlLinks.list(vulnId);
      return response.data as ControlLink[];
    },
    enabled: activeTab === 'controls',
  });

  const { data: retests } = useQuery({
    queryKey: ['vuln-retests', vulnId],
    queryFn: async () => {
      const response = await vulnManagementApi.retests.list(vulnId);
      return response.data as Retest[];
    },
    enabled: activeTab === 'retests',
  });

  const { data: exceptionsRaw } = useQuery({
    queryKey: ['vuln-exceptions', vulnId],
    queryFn: async () => {
      const response = await vulnManagementApi.exceptions.list();
      return response.data as RiskException[];
    },
    enabled: activeTab === 'exception',
  });

  const exceptions = exceptionsRaw?.filter((ex) => ex.id === vulnId);

  const { data: departmentAssignments } = useQuery({
    queryKey: ['vuln-departments', vulnId],
    queryFn: async () => {
      const response = await vulnManagementApi.departments.getVulnerabilityDepartments(vulnId);
      return response.data as DepartmentAssignment[];
    },
    enabled: activeTab === 'departments',
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
    enabled: activeTab === 'workflow',
  });

  const { data: workflowHistory } = useQuery({
    queryKey: ['vuln-workflow-history', vulnId],
    queryFn: async () => {
      const response = await vulnManagementApi.workflows.getHistory(vulnId);
      return response.data as WorkflowHistoryItem[];
    },
    enabled: activeTab === 'workflow',
  });

  const { data: escalationsData } = useQuery({
    queryKey: ['vuln-escalations', vulnId],
    queryFn: async () => {
      const response = await vulnManagementApi.escalations.getVulnerabilityEscalations(vulnId);
      return response.data as Escalation[];
    },
    enabled: activeTab === 'escalations',
  });

  const { data: assets, isLoading: assetsLoading } = useQuery({
    queryKey: ['assets-list'],
    queryFn: async () => {
      const response = await assetsApi.getAll();
      return response.data;
    },
    enabled: activeTab === 'assets',
  });

  const { data: internalControls, isLoading: internalControlsLoading } = useQuery({
    queryKey: ['internal-controls-list'],
    queryFn: async () => {
      const response = await ermApi.internalControls.getAll();
      return response.data;
    },
    enabled: activeTab === 'controls',
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
    mutationFn: () => vulnManagementApi.ai.suggestFix(vulnId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vulnerability', vulnId] });
    },
  });

  const createMitigationMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => vulnManagementApi.mitigations.create(vulnId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vuln-mitigations', vulnId] });
      setShowMitigationModal(false);
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

  const createRetestMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => vulnManagementApi.retests.create(vulnId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vuln-retests', vulnId] });
      setShowRetestModal(false);
    },
  });

  const createExceptionMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => vulnManagementApi.exceptions.create(vulnId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vuln-exceptions', vulnId] });
      setShowExceptionModal(false);
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

  const severityStyle = getSeverityStyle(vulnerability.severity);
  const statusStyle = getStatusStyle(vulnerability.status);

  return (
    <div className="min-h-full space-y-4 bg-white p-4 md:p-6">
      <div className="flex items-center gap-3">
        <Link href="/vulnerabilities" className="text-slate-600 hover:text-slate-900 transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-base font-semibold text-slate-900">{vulnerability.title}</h1>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${severityStyle.bg} ${severityStyle.text}`}>
              {severityStyle.label}
            </span>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
              {statusStyle.label}
            </span>
          </div>
          <p className="text-xs text-slate-500">VULN-{vulnerability.id}</p>
        </div>
        <button onClick={() => setShowStatusModal(true)} className="btn-secondary text-xs py-1 px-2.5">
          Change Status
        </button>
      </div>

      <div className="border-b border-slate-200">
        <nav className="flex gap-0 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <tab.icon size={13} />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <div className="cw-card p-4">
              <h2 className="text-sm font-semibold cw-text mb-2">Description</h2>
              <p className="text-sm text-slate-600 whitespace-pre-wrap">
                {vulnerability.description || 'No description provided.'}
              </p>
            </div>

            {/* NCA Template Fields — verbatim register data preserved on the bridge */}
            {vulnerability.template_type === 'NCA Template' && vulnerability.template_fields && Object.keys(vulnerability.template_fields).length > 0 && (
              <div className="cw-card p-4">
                <h2 className="text-sm font-semibold cw-text mb-3 flex items-center gap-1.5">
                  <FileText className="h-4 w-4 text-blue-600" />
                  NCA Template Fields
                </h2>
                <p className="text-xs text-slate-500 mb-3">All fields from the NCA Saudi vulnerability register template. Owner and assets are managed via platform pickers in the other tabs.</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  {Object.entries(vulnerability.template_fields).filter(([, v]) => v !== null && v !== '' && v !== undefined).map(([k, v]) => (
                    <div key={k}>
                      <p className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-0.5">{k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</p>
                      <p className="text-sm text-slate-800 whitespace-pre-wrap break-words">{String(v)}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {vulnerability.ai_recommendation && (
              <div className="rounded-xl border border-primary-200 bg-primary-50 p-4">
                <h2 className="text-sm font-semibold cw-text mb-2 flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-primary-600" />
                  AI Recommendation
                </h2>
                {formatAIText(vulnerability.ai_recommendation)}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className="cw-card p-4">
              <h2 className="text-sm font-semibold cw-text mb-2">Details</h2>
              <dl className="space-y-2">
                {vulnerability.cvss_score && (
                  <div>
                    <dt className="text-sm text-slate-600">CVSS Score</dt>
                    <dd className="cw-text font-medium">{vulnerability.cvss_score}</dd>
                  </div>
                )}
                {vulnerability.cve_id && (
                  <div>
                    <dt className="text-sm text-slate-600">CVE ID</dt>
                    <dd className="cw-text font-mono">{vulnerability.cve_id}</dd>
                  </div>
                )}
                {vulnerability.cwe_id && (
                  <div>
                    <dt className="text-sm text-slate-600">CWE ID</dt>
                    <dd className="cw-text font-mono">{vulnerability.cwe_id}</dd>
                  </div>
                )}
                {vulnerability.affected_component && (
                  <div>
                    <dt className="text-sm text-slate-600">Affected Component</dt>
                    <dd className="cw-text">{vulnerability.affected_component}</dd>
                  </div>
                )}
                {(vulnerability.linked_assets && vulnerability.linked_assets.length > 0) && (
                  <div>
                    <dt className="text-sm text-slate-600">Linked Assets</dt>
                    <dd className="cw-text">{vulnerability.linked_assets.join(', ')}</dd>
                  </div>
                )}
                {(!vulnerability.linked_assets || vulnerability.linked_assets.length === 0) && vulnerability.affected_host && (
                  <div>
                    <dt className="text-sm text-slate-600">Linked Assets</dt>
                    <dd className="cw-text">{vulnerability.affected_host}</dd>
                  </div>
                )}
                {vulnerability.due_date && (
                  <div>
                    <dt className="text-sm text-slate-600">Due Date</dt>
                    <dd className="cw-text flex items-center gap-1.5">
                      <Calendar size={14} className="text-slate-600" />
                      {new Date(vulnerability.due_date).toLocaleDateString()}
                    </dd>
                  </div>
                )}
                {vulnerability.assigned_user_name && (
                  <div>
                    <dt className="text-sm text-slate-600">Assigned To</dt>
                    <dd className="cw-text flex items-center gap-1.5">
                      <User size={14} className="text-slate-600" />
                      {vulnerability.assigned_user_name}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-sm text-slate-600">Created</dt>
                  <dd className="cw-text">{new Date(vulnerability.created_at).toLocaleString()}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'mitigations' && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h2 className="text-sm font-semibold cw-text">Mitigations</h2>
            <button onClick={() => setShowMitigationModal(true)} className="btn-primary flex items-center gap-1.5 text-sm py-1 px-3">
              <Plus size={14} />
              Add Mitigation
            </button>
          </div>
          <div className="cw-card overflow-hidden">
            {(!mitigations || mitigations.length === 0) ? (
              <div className="p-8 text-center text-slate-600">No mitigations added yet</div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-50/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Title</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Due Date</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Assigned To</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {mitigations.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 cw-text">{m.action_title}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                          m.status === 'completed' ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'
                        }`}>
                          {m.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{m.target_date ? new Date(m.target_date).toLocaleDateString() : '-'}</td>
                      <td className="px-4 py-3 text-slate-600">{m.owner_name || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeTab === 'assets' && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h2 className="text-sm font-semibold cw-text">Linked Assets</h2>
            {canEdit && (
              <InlineLinkPicker
                triggerLabel="Link Asset"
                triggerClassName="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
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
          <div className="cw-card overflow-hidden">
            {(!assetLinks || assetLinks.length === 0) ? (
              <div className="p-8 text-center text-slate-600">No assets linked yet</div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-50/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Asset</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Relationship</th>
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
                        {canDelete && (
                        <button
                          onClick={() => deleteAssetLinkMutation.mutate(link.id)}
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
        </div>
      )}

      {activeTab === 'controls' && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h2 className="text-sm font-semibold cw-text">Linked Controls</h2>
            {canEdit && (
              <InlineLinkPicker
                triggerLabel="Link Control"
                triggerClassName="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
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
          <div className="cw-card overflow-hidden">
            {(!controlLinks || controlLinks.length === 0) ? (
              <div className="p-8 text-center text-slate-600">No controls linked yet</div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-50/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Control</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Type</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">ID</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {controlLinks.map((link) => {
                    const displayName = link.internal_control_name || link.framework_control_name || link.normalized_control_name || '-';
                    const displayCode = link.framework_control_code || link.normalized_control_code || (link.internal_control_id ? `IC-${link.internal_control_id}` : '-');
                    const displayType = link.internal_control_id ? 'Internal' : link.framework_control_id ? 'Framework' : link.normalized_control_id ? 'Normalized' : '-';
                    return (
                    <tr key={link.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 cw-text">{displayName}</td>
                      <td className="px-4 py-3 text-slate-600">{displayType}</td>
                      <td className="px-4 py-3 text-slate-600 font-mono text-xs">{displayCode}</td>
                      <td className="px-4 py-3">
                        {canDelete && (
                        <button
                          onClick={() => deleteControlLinkMutation.mutate(link.id)}
                          className="text-slate-600 hover:text-red-600"
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
        </div>
      )}

      {activeTab === 'departments' && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h2 className="text-sm font-semibold cw-text">Department Assignments</h2>
            {canEdit && (
            <button onClick={() => setShowDeptAssignModal(true)} className="btn-primary flex items-center gap-1.5 text-sm py-1 px-3">
              <Plus size={14} />
              Assign Department
            </button>
            )}
          </div>
          <div className="cw-card overflow-hidden">
            {(!departmentAssignments || departmentAssignments.length === 0) ? (
              <div className="p-8 text-center text-slate-600">No departments assigned yet</div>
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
        </div>
      )}

      {activeTab === 'workflow' && (
        <div className="space-y-3">
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="cw-card p-4">
              <h2 className="text-sm font-semibold cw-text mb-2 flex items-center gap-1.5">
                <GitBranch className="h-4 w-4 text-primary-600" />
                Current State
              </h2>
              <div className="flex items-center gap-3 mb-4">
                <span className={`inline-flex items-center rounded-full px-3 py-1.5 text-sm font-medium ${
                  getStatusStyle(vulnerability.status).bg
                } ${getStatusStyle(vulnerability.status).text}`}>
                  {getStatusStyle(vulnerability.status).label}
                </span>
              </div>
              
              <h3 className="text-sm font-medium text-slate-600 mb-3">Available Actions</h3>
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
                      className="inline-flex items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-subtle)] px-3 py-2 text-sm font-medium cw-text hover:bg-[var(--color-hover)] transition-colors"
                    >
                      <ChevronRight size={14} />
                      {transition.name}
                      {transition.requires_comment && (
                        <MessageSquare size={12} className="text-slate-600" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="cw-card p-4">
              <h2 className="text-sm font-semibold cw-text mb-2 flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-slate-600" />
                Workflow History
              </h2>
              {(!workflowHistory || workflowHistory.length === 0) ? (
                <p className="text-slate-500 text-sm">No workflow history available</p>
              ) : (
                <div className="space-y-4 max-h-80 overflow-y-auto">
                  {workflowHistory.map((item, index) => (
                    <div key={item.id} className="relative pl-6 pb-4">
                      {index < workflowHistory.length - 1 && (
                        <div className="absolute left-2 top-4 bottom-0 w-0.5 bg-slate-600" />
                      )}
                      <div className="absolute left-0 top-1 w-4 h-4 rounded-full bg-primary-50 border-2 border-primary-500" />
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium cw-text">{item.transition_name || 'State Change'}</span>
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
          </div>
        </div>
      )}

      {activeTab === 'escalations' && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h2 className="text-sm font-semibold cw-text">Escalation History</h2>
          </div>
          <div className="cw-card overflow-hidden">
            {(!escalationsData || escalationsData.length === 0) ? (
              <div className="p-8 text-center text-slate-600">No escalations triggered</div>
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
                          <Bell size={14} className="text-orange-600" />
                          <span className="cw-text">{esc.rule_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{esc.escalated_to || '-'}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {new Date(esc.escalated_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                          esc.status === 'acknowledged' ? 'bg-green-50 text-green-700' :
                          esc.status === 'pending' ? 'bg-yellow-50 text-yellow-700' :
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
      )}


      {activeTab === 'ai' && (
        <div className="space-y-3">
          <div className="cw-card p-4">
            <h2 className="text-sm font-semibold cw-text mb-2 flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-primary-600" />
              AI-Powered Analysis
            </h2>
            <p className="text-sm text-slate-600 mb-3">
              Get AI-powered recommendations for fixing this vulnerability based on the description, severity, and affected components.
            </p>
            <button
              onClick={() => suggestFixMutation.mutate()}
              disabled={suggestFixMutation.isPending}
              className="btn-primary flex items-center gap-2"
            >
              {suggestFixMutation.isPending ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  Get AI Recommendation
                </>
              )}
            </button>
            {vulnerability.ai_recommendation && (
              <div className="mt-6 p-4 rounded-lg bg-primary-50 border border-primary-200">
                <h3 className="text-sm font-medium text-primary-600 mb-2">Recommendation</h3>
                {formatAIText(vulnerability.ai_recommendation)}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'exception' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-sm font-semibold text-slate-900">Risk Exception</h2>
            <button onClick={() => setShowExceptionModal(true)} className="btn-primary flex items-center gap-2 text-sm">
              <Plus size={16} />
              Create Exception
            </button>
          </div>
          <div className="cw-card overflow-hidden">
            {(!exceptions || exceptions.length === 0) ? (
              <div className="p-8 text-center text-slate-600">No exception requests</div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-50/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Reason</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Expiry</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {exceptions.map((ex) => (
                    <tr key={ex.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 cw-text">{ex.exception_reason}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                          ex.days_until_expiry !== undefined && ex.days_until_expiry !== null && ex.days_until_expiry < 0
                            ? 'bg-red-50 text-red-700'
                            : ex.days_until_expiry !== undefined && ex.days_until_expiry !== null && ex.days_until_expiry <= 30
                            ? 'bg-yellow-50 text-yellow-700'
                            : 'bg-green-50 text-green-700'
                        }`}>
                          {ex.days_until_expiry !== undefined && ex.days_until_expiry !== null && ex.days_until_expiry < 0
                            ? 'Expired'
                            : 'Active'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {ex.exception_expiry ? new Date(ex.exception_expiry).toLocaleDateString() : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

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
          <div className="cw-card w-full max-w-md p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold cw-text">Add Mitigation</h2>
              <button onClick={() => setShowMitigationModal(false)} className="text-slate-600 hover:text-slate-900">
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                createMitigationMutation.mutate({
                  action_title: formData.get('title'),
                  action_description: formData.get('description') || undefined,
                  target_date: formData.get('due_date') ? new Date(`${formData.get('due_date')}T00:00:00Z`).toISOString() : undefined,
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Title *</label>
                <input type="text" name="title" required className="input-field w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Description</label>
                <textarea name="description" rows={3} className="input-field w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Due Date</label>
                <input type="date" name="due_date" className="input-field w-full" />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setShowMitigationModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={createMitigationMutation.isPending} className="btn-primary">
                  {createMitigationMutation.isPending ? 'Creating...' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showExceptionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="cw-card w-full max-w-lg p-6 shadow-xl">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-xl font-bold cw-text">Create Exception</h2>
                <p className="text-sm text-slate-500 mt-0.5">
                  {vulnerability.title} &middot; VULN-{vulnId}
                </p>
              </div>
              <button onClick={() => setShowExceptionModal(false)} className="text-slate-400 hover:text-slate-700 mt-0.5">
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const exceptionType = formData.get('exception_type') as string;
                const reason = formData.get('reason') as string;
                const exceptionReason = exceptionType
                  ? `[${exceptionType}] ${reason}`
                  : reason;
                createExceptionMutation.mutate({
                  exception_reason: exceptionReason,
                  exception_expiry: (formData.get('exception_expiry') as string) || undefined,
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Exception Type *</label>
                <select name="exception_type" required
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500">
                  <option value="">Select a type...</option>
                  <option value="Risk Accepted">Risk Accepted</option>
                  <option value="False Positive">False Positive</option>
                  <option value="Deferred">Deferred</option>
                  <option value="Compensating Control">Compensating Control</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Reason *</label>
                <textarea name="reason" rows={4} required
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 resize-none"
                  placeholder="Explain why this vulnerability should be excepted from remediation..." />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Expiry Date</label>
                <input type="date" name="exception_expiry"
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500" />
              </div>
              <div className="flex justify-end gap-3 pt-1">
                <button type="button" onClick={() => setShowExceptionModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={createExceptionMutation.isPending} className="btn-primary">
                  {createExceptionMutation.isPending ? 'Submitting...' : 'Submit Exception'}
                </button>
              </div>
            </form>
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
