'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { vulnManagementApi, assetsApi, ermApi, controlsApi } from '@/lib/api';
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
  due_date?: string;
  assigned_to?: number;
  assigned_user_name?: string;
  report_id?: number;
  report_name?: string;
  ai_recommendation?: string;
  created_at: string;
  updated_at?: string;
}

interface Mitigation {
  id: number;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  due_date?: string;
  assigned_to?: number;
  assigned_user_name?: string;
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
  control_type: string;
  framework_control_id?: number;
  internal_control_id?: number;
  control_name?: string;
  control_id_display?: string;
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
  reason: string;
  status: string;
  approved_by?: number;
  approved_at?: string;
  expiry_date?: string;
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
  { id: 'retests', label: 'Retests', icon: RefreshCw },
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

export default function VulnerabilityDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const vulnId = Number(params.id);

  const [activeTab, setActiveTab] = useState('overview');
  const [showMitigationModal, setShowMitigationModal] = useState(false);
  const [showAssetModal, setShowAssetModal] = useState(false);
  const [showControlModal, setShowControlModal] = useState(false);
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

  const { data: exceptions } = useQuery({
    queryKey: ['vuln-exceptions', vulnId],
    queryFn: async () => {
      const response = await vulnManagementApi.exceptions.list(vulnId);
      return response.data as RiskException[];
    },
    enabled: activeTab === 'exception',
  });

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

  const { data: assets } = useQuery({
    queryKey: ['assets-list'],
    queryFn: async () => {
      const response = await assetsApi.getAll();
      return response.data;
    },
    enabled: showAssetModal,
  });

  const { data: frameworkControls } = useQuery({
    queryKey: ['framework-controls-list'],
    queryFn: async () => {
      const response = await controlsApi.getAll();
      return response.data;
    },
    enabled: showControlModal,
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
      setShowAssetModal(false);
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
      setShowControlModal(false);
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
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-600" />
      </div>
    );
  }

  if (error || !vulnerability) {
    return (
      <div className="rounded-xl border border-red-700 bg-red-900/20 p-6 text-center">
        <AlertCircle className="mx-auto h-8 w-8 text-red-600" />
        <p className="mt-2 text-red-600">Failed to load vulnerability details</p>
        <Link href="/vulnerabilities" className="mt-4 inline-flex items-center gap-2 text-primary-600 hover:text-primary-300">
          <ArrowLeft size={16} />
          Back to Vulnerabilities
        </Link>
      </div>
    );
  }

  const severityStyle = getSeverityStyle(vulnerability.severity);
  const statusStyle = getStatusStyle(vulnerability.status);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/vulnerabilities" className="text-slate-600 hover:text-slate-900 transition-colors">
          <ArrowLeft size={20} />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-black">{vulnerability.title}</h1>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${severityStyle.bg} ${severityStyle.text}`}>
              {severityStyle.label}
            </span>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
              {statusStyle.label}
            </span>
          </div>
          <p className="text-sm text-slate-600 mt-1">VULN-{vulnerability.id}</p>
        </div>
        <button onClick={() => setShowStatusModal(true)} className="btn-secondary">
          Change Status
        </button>
      </div>

      <div className="border-b border-slate-200">
        <nav className="flex gap-1 overflow-x-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'overview' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-black mb-4">Description</h2>
              <p className="text-slate-600 whitespace-pre-wrap">
                {vulnerability.description || 'No description provided.'}
              </p>
            </div>

            {vulnerability.ai_recommendation && (
              <div className="rounded-xl border border-primary-200 bg-primary-50 p-6">
                <h2 className="text-lg font-semibold text-black mb-4 flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary-600" />
                  AI Recommendation
                </h2>
                <p className="text-slate-600 whitespace-pre-wrap">{vulnerability.ai_recommendation}</p>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-black mb-4">Details</h2>
              <dl className="space-y-3">
                {vulnerability.cvss_score && (
                  <div>
                    <dt className="text-sm text-slate-600">CVSS Score</dt>
                    <dd className="text-black font-medium">{vulnerability.cvss_score}</dd>
                  </div>
                )}
                {vulnerability.cve_id && (
                  <div>
                    <dt className="text-sm text-slate-600">CVE ID</dt>
                    <dd className="text-black font-mono">{vulnerability.cve_id}</dd>
                  </div>
                )}
                {vulnerability.cwe_id && (
                  <div>
                    <dt className="text-sm text-slate-600">CWE ID</dt>
                    <dd className="text-black font-mono">{vulnerability.cwe_id}</dd>
                  </div>
                )}
                {vulnerability.affected_component && (
                  <div>
                    <dt className="text-sm text-slate-600">Affected Component</dt>
                    <dd className="text-black">{vulnerability.affected_component}</dd>
                  </div>
                )}
                {vulnerability.affected_host && (
                  <div>
                    <dt className="text-sm text-slate-600">Affected Host</dt>
                    <dd className="text-black">{vulnerability.affected_host}</dd>
                  </div>
                )}
                {vulnerability.due_date && (
                  <div>
                    <dt className="text-sm text-slate-600">Due Date</dt>
                    <dd className="text-black flex items-center gap-1.5">
                      <Calendar size={14} className="text-slate-600" />
                      {new Date(vulnerability.due_date).toLocaleDateString()}
                    </dd>
                  </div>
                )}
                {vulnerability.assigned_user_name && (
                  <div>
                    <dt className="text-sm text-slate-600">Assigned To</dt>
                    <dd className="text-black flex items-center gap-1.5">
                      <User size={14} className="text-slate-600" />
                      {vulnerability.assigned_user_name}
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-sm text-slate-600">Created</dt>
                  <dd className="text-black">{new Date(vulnerability.created_at).toLocaleString()}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'mitigations' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-black">Mitigations</h2>
            <button onClick={() => setShowMitigationModal(true)} className="btn-primary flex items-center gap-2">
              <Plus size={16} />
              Add Mitigation
            </button>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
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
                <tbody className="divide-y divide-slate-700">
                  {mitigations.map((m) => (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-black">{m.title}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                          m.status === 'completed' ? 'bg-green-50 text-green-700' : 'bg-yellow-50 text-yellow-700'
                        }`}>
                          {m.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{m.due_date ? new Date(m.due_date).toLocaleDateString() : '-'}</td>
                      <td className="px-4 py-3 text-slate-600">{m.assigned_user_name || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeTab === 'assets' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-black">Linked Assets</h2>
            <button onClick={() => setShowAssetModal(true)} className="btn-primary flex items-center gap-2">
              <Plus size={16} />
              Link Asset
            </button>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
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
                <tbody className="divide-y divide-slate-700">
                  {assetLinks.map((link) => (
                    <tr key={link.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-black">{link.asset_name}</td>
                      <td className="px-4 py-3 text-slate-600">{link.asset_type || '-'}</td>
                      <td className="px-4 py-3 text-slate-600">{link.relationship_type || 'affected'}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => deleteAssetLinkMutation.mutate(link.id)}
                          className="text-slate-600 hover:text-red-600"
                        >
                          <Trash2 size={16} />
                        </button>
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
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-black">Linked Controls</h2>
            <button onClick={() => setShowControlModal(true)} className="btn-primary flex items-center gap-2">
              <Plus size={16} />
              Link Control
            </button>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
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
                <tbody className="divide-y divide-slate-700">
                  {controlLinks.map((link) => (
                    <tr key={link.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-black">{link.control_name || '-'}</td>
                      <td className="px-4 py-3 text-slate-600 capitalize">{link.control_type}</td>
                      <td className="px-4 py-3 text-slate-600 font-mono">{link.control_id_display || '-'}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => deleteControlLinkMutation.mutate(link.id)}
                          className="text-slate-600 hover:text-red-600"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeTab === 'departments' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-black">Department Assignments</h2>
            <button onClick={() => setShowDeptAssignModal(true)} className="btn-primary flex items-center gap-2">
              <Plus size={16} />
              Assign Department
            </button>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
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
                <tbody className="divide-y divide-slate-700">
                  {departmentAssignments.map((assignment) => (
                    <tr key={assignment.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-50">
                            <Users size={14} className="text-primary-600" />
                          </div>
                          <div>
                            <span className="text-black font-medium">{assignment.department_name || `Department ${assignment.department_id}`}</span>
                            {assignment.department_code && (
                              <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-slate-200 text-slate-500 font-mono">
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
                        <button
                          onClick={() => removeDepartmentAssignmentMutation.mutate(assignment.id)}
                          className="text-slate-600 hover:text-red-600"
                        >
                          <Trash2 size={16} />
                        </button>
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
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-black mb-4 flex items-center gap-2">
                <GitBranch className="h-5 w-5 text-primary-600" />
                Current State
              </h2>
              <div className="flex items-center gap-3 mb-6">
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
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-sm font-medium text-black hover:bg-slate-600 transition-colors"
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

            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h2 className="text-lg font-semibold text-black mb-4 flex items-center gap-2">
                <Clock className="h-5 w-5 text-slate-600" />
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
                          <span className="text-sm font-medium text-black">{item.transition_name || 'State Change'}</span>
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
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-black">Escalation History</h2>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
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
                <tbody className="divide-y divide-slate-700">
                  {escalationsData.map((esc) => (
                    <tr key={esc.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Bell size={14} className="text-orange-600" />
                          <span className="text-black">{esc.rule_name}</span>
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

      {activeTab === 'retests' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-black">Retest History</h2>
            <button onClick={() => setShowRetestModal(true)} className="btn-primary flex items-center gap-2">
              <Plus size={16} />
              Add Retest
            </button>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            {(!retests || retests.length === 0) ? (
              <div className="p-8 text-center text-slate-600">No retests recorded yet</div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-50/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Result</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Tester</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-slate-600">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {retests.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-black">{new Date(r.test_date).toLocaleDateString()}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                          r.result === 'pass' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                        }`}>
                          {r.result}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{r.tester_name || '-'}</td>
                      <td className="px-4 py-3 text-slate-600 truncate max-w-xs">{r.notes || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeTab === 'ai' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-black mb-4 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary-600" />
              AI-Powered Analysis
            </h2>
            <p className="text-slate-600 mb-4">
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
                <p className="text-slate-600 whitespace-pre-wrap">{vulnerability.ai_recommendation}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'exception' && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-lg font-semibold text-black">Risk Exception</h2>
            <button onClick={() => setShowExceptionModal(true)} className="btn-primary flex items-center gap-2">
              <Plus size={16} />
              Create Exception
            </button>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
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
                <tbody className="divide-y divide-slate-700">
                  {exceptions.map((ex) => (
                    <tr key={ex.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-black">{ex.reason}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                          ex.status === 'approved' ? 'bg-green-50 text-green-700' :
                          ex.status === 'rejected' ? 'bg-red-50 text-red-700' :
                          'bg-yellow-50 text-yellow-700'
                        }`}>
                          {ex.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {ex.expiry_date ? new Date(ex.expiry_date).toLocaleDateString() : '-'}
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
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-black">Change Status</h2>
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
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-black">Add Mitigation</h2>
              <button onClick={() => setShowMitigationModal(false)} className="text-slate-600 hover:text-slate-900">
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                createMitigationMutation.mutate({
                  title: formData.get('title'),
                  description: formData.get('description') || undefined,
                  due_date: formData.get('due_date') || undefined,
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

      {showAssetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-black">Link Asset</h2>
              <button onClick={() => setShowAssetModal(false)} className="text-slate-600 hover:text-slate-900">
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                createAssetLinkMutation.mutate({
                  asset_id: parseInt(formData.get('asset_id') as string),
                  relationship_type: formData.get('relationship_type') as string || undefined,
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Asset *</label>
                <select name="asset_id" required className="input-field w-full">
                  <option value="">Select an asset</option>
                  {assets?.map((asset: { id: number; name: string }) => (
                    <option key={asset.id} value={asset.id}>{asset.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Relationship Type</label>
                <select name="relationship_type" className="input-field w-full">
                  <option value="affected">Affected</option>
                  <option value="related">Related</option>
                  <option value="hosting">Hosting</option>
                </select>
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setShowAssetModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={createAssetLinkMutation.isPending} className="btn-primary">
                  {createAssetLinkMutation.isPending ? 'Linking...' : 'Link Asset'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showControlModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-black">Link Control</h2>
              <button onClick={() => setShowControlModal(false)} className="text-slate-600 hover:text-slate-900">
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const controlType = formData.get('control_type') as string;
                const data: { control_type: string; framework_control_id?: number; internal_control_id?: number } = {
                  control_type: controlType,
                };
                if (controlType === 'framework') {
                  data.framework_control_id = parseInt(formData.get('control_id') as string);
                } else {
                  data.internal_control_id = parseInt(formData.get('control_id') as string);
                }
                createControlLinkMutation.mutate(data);
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Control Type *</label>
                <select name="control_type" required className="input-field w-full">
                  <option value="framework">Framework Control</option>
                  <option value="internal">Internal Control</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Control *</label>
                <select name="control_id" required className="input-field w-full">
                  <option value="">Select a control</option>
                  {frameworkControls?.map((ctrl: { id: number; control_id: string; title: string }) => (
                    <option key={ctrl.id} value={ctrl.id}>{ctrl.control_id} - {ctrl.title}</option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setShowControlModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={createControlLinkMutation.isPending} className="btn-primary">
                  {createControlLinkMutation.isPending ? 'Linking...' : 'Link Control'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showRetestModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-black">Add Retest</h2>
              <button onClick={() => setShowRetestModal(false)} className="text-slate-600 hover:text-slate-900">
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                createRetestMutation.mutate({
                  test_date: formData.get('test_date'),
                  result: formData.get('result'),
                  tester_name: formData.get('tester_name') || undefined,
                  notes: formData.get('notes') || undefined,
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Test Date *</label>
                <input type="date" name="test_date" required className="input-field w-full" defaultValue={new Date().toISOString().split('T')[0]} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Result *</label>
                <select name="result" required className="input-field w-full">
                  <option value="pass">Pass - Vulnerability Remediated</option>
                  <option value="fail">Fail - Still Vulnerable</option>
                  <option value="partial">Partial - Partially Remediated</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Tester Name</label>
                <input type="text" name="tester_name" className="input-field w-full" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Notes</label>
                <textarea name="notes" rows={3} className="input-field w-full" />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setShowRetestModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={createRetestMutation.isPending} className="btn-primary">
                  {createRetestMutation.isPending ? 'Adding...' : 'Add Retest'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showExceptionModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-black">Create Exception</h2>
              <button onClick={() => setShowExceptionModal(false)} className="text-slate-600 hover:text-slate-900">
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                createExceptionMutation.mutate({
                  reason: formData.get('reason'),
                  expiry_date: formData.get('expiry_date') || undefined,
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Reason *</label>
                <textarea name="reason" rows={4} required className="input-field w-full" placeholder="Explain why this vulnerability should be excepted from remediation..." />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">Expiry Date</label>
                <input type="date" name="expiry_date" className="input-field w-full" />
              </div>
              <div className="flex justify-end gap-3">
                <button type="button" onClick={() => setShowExceptionModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" disabled={createExceptionMutation.isPending} className="btn-primary">
                  {createExceptionMutation.isPending ? 'Creating...' : 'Submit Exception'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDeptAssignModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-black">Assign Department</h2>
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
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-black">{selectedTransition.name}</h2>
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
                Transition to <span className="text-black font-medium">{selectedTransition.to_state_name}</span>
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
