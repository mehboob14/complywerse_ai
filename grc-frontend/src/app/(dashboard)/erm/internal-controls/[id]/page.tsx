'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ermApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Shield,
  Loader2,
  ArrowLeft,
  Edit2,
  Key,
  CheckCircle,
  Clock,
  XCircle,
  Plus,
  Trash2,
  AlertTriangle,
  Link as LinkIcon,
  FileText,
  ClipboardCheck,
  Send,
  ThumbsUp,
  ThumbsDown,
  Calendar,
  User,
  Building2,
} from 'lucide-react';
import Link from 'next/link';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';
import { PageLoader } from '@/components/ui';

interface InternalControlDetail {
  id: number;
  tenant_id: number;
  control_id: string;
  name: string;
  description?: string;
  category?: string;
  sub_category?: string;
  control_type?: string;
  control_nature?: string;
  department_id?: number;
  owner_id?: number;
  backup_owner_id?: number;
  frequency?: string;
  regulatory_source?: string;
  effective_date?: string;
  review_date?: string;
  status: string;
  workflow_status?: string;
  design_effectiveness?: string;
  operating_effectiveness?: string;
  last_tested_at?: string;
  next_test_date?: string;
  priority?: string;
  is_key_control: boolean;
  created_at: string;
  updated_at: string;
  created_by?: number;
  approved_by?: number;
  approved_at?: string;
  owner_name?: string;
  backup_owner_name?: string;
  department_name?: string;
  tests?: ControlTest[];
  risk_links?: RiskLink[];
  framework_links?: FrameworkLink[];
  escalations?: Escalation[];
}

interface ControlTest {
  id: number;
  test_type: string;
  test_date?: string;
  result?: string;
  status: string;
  exceptions_found?: number;
  findings?: string;
  recommendations?: string;
  tester_name?: string;
  reviewer_name?: string;
}

interface RiskLink {
  id: number;
  risk_id: number;
  risk_title?: string;
  link_type?: string;
  effectiveness_rating?: string;
}

interface FrameworkLink {
  id: number;
  framework_control_id?: number;
  normalized_control_id?: number;
  mapping_type?: string;
  coverage_percentage?: number;
}

interface Escalation {
  id: number;
  escalation_level: number;
  escalation_name: string;
  trigger_condition?: string;
  is_active: boolean;
}

interface WorkflowAction {
  id: number;
  control_id: number;
  action: string;
  action_by?: number;
  action_at: string;
  from_status?: string;
  to_status?: string;
  comments?: string;
  actor_name?: string;
}

const TABS = [
  { id: 'details', label: 'Details', icon: FileText },
  { id: 'testing', label: 'Testing', icon: ClipboardCheck },
  { id: 'risks', label: 'Risks', icon: AlertTriangle },
  { id: 'escalations', label: 'Escalations', icon: Shield },
  { id: 'framework', label: 'Framework Mappings', icon: LinkIcon },
  { id: 'workflow', label: 'Workflow', icon: Clock },
];

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Draft' },
  pending_approval: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Pending Approval' },
  active: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Active' },
  inactive: { bg: 'bg-rose-50', text: 'text-rose-700', label: 'Inactive' },
  rejected: { bg: 'bg-rose-50', text: 'text-rose-700', label: 'Rejected' },
};

const EFFECTIVENESS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  effective: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Effective' },
  partially_effective: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Partially Effective' },
  ineffective: { bg: 'bg-rose-50', text: 'text-rose-700', label: 'Ineffective' },
  not_tested: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Not Tested' },
};

const TEST_RESULT_STYLES: Record<string, { bg: string; text: string }> = {
  effective: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  partially_effective: { bg: 'bg-amber-50', text: 'text-amber-700' },
  ineffective: { bg: 'bg-rose-50', text: 'text-rose-700' },
};

function getStatusStyle(status: string) {
  return STATUS_STYLES[status] || STATUS_STYLES.draft;
}

function getEffectivenessStyle(effectiveness?: string) {
  if (!effectiveness) return EFFECTIVENESS_STYLES.not_tested;
  return EFFECTIVENESS_STYLES[effectiveness] || EFFECTIVENESS_STYLES.not_tested;
}

export default function InternalControlDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('erm:internal_controls:create');
  const controlId = Number(params.id);

  const [activeTab, setActiveTab] = useState('details');
  const [showTestModal, setShowTestModal] = useState(false);
  const [showRiskModal, setShowRiskModal] = useState(false);
  const [showEscalationModal, setShowEscalationModal] = useState(false);
  const [showWorkflowModal, setShowWorkflowModal] = useState<'submit' | 'approve' | 'reject' | null>(null);
  const [workflowComments, setWorkflowComments] = useState('');

  const { data: control, isLoading, error } = useQuery({
    queryKey: ['internal-control', controlId],
    queryFn: async () => {
      const response = await ermApi.internalControls.getById(controlId);
      return response.data as InternalControlDetail;
    },
  });

  const { data: workflowHistory } = useQuery({
    queryKey: ['internal-control-workflow', controlId],
    queryFn: async () => {
      const response = await ermApi.internalControls.getWorkflowHistory(controlId);
      return response.data as WorkflowAction[];
    },
    enabled: activeTab === 'workflow',
  });

  const { data: risks } = useQuery({
    queryKey: ['erm-risks-list'],
    queryFn: async () => {
      const response = await ermApi.risks.getAll();
      return response.data;
    },
    enabled: activeTab === 'risks' || showRiskModal,
  });

  const submitMutation = useMutation({
    mutationFn: () => ermApi.internalControls.submit(controlId, workflowComments),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['internal-control', controlId] });
      queryClient.invalidateQueries({ queryKey: ['internal-control-workflow', controlId] });
      setShowWorkflowModal(null);
      setWorkflowComments('');
    },
  });

  const approveMutation = useMutation({
    mutationFn: () => ermApi.internalControls.approve(controlId, workflowComments),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['internal-control', controlId] });
      queryClient.invalidateQueries({ queryKey: ['internal-control-workflow', controlId] });
      setShowWorkflowModal(null);
      setWorkflowComments('');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: () => ermApi.internalControls.reject(controlId, workflowComments),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['internal-control', controlId] });
      queryClient.invalidateQueries({ queryKey: ['internal-control-workflow', controlId] });
      setShowWorkflowModal(null);
      setWorkflowComments('');
    },
  });

  const createTestMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => ermApi.internalControls.createTest(controlId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['internal-control', controlId] });
      setShowTestModal(false);
    },
  });

  const linkRiskMutation = useMutation({
    mutationFn: (data: { risk_id: number; link_type?: string; effectiveness_rating?: string }) =>
      ermApi.internalControls.linkRisk(controlId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['internal-control', controlId] });
      setShowRiskModal(false);
    },
  });

  const unlinkRiskMutation = useMutation({
    mutationFn: (linkId: number) => ermApi.internalControls.unlinkRisk(controlId, linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['internal-control', controlId] });
    },
  });

  const createEscalationMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      ermApi.internalControls.createEscalation(controlId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['internal-control', controlId] });
      setShowEscalationModal(false);
    },
  });

  const deleteEscalationMutation = useMutation({
    mutationFn: (escId: number) => ermApi.internalControls.deleteEscalation(controlId, escId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['internal-control', controlId] });
    },
  });

  if (isLoading) {
    return (
      <PageLoader className="h-64" />
    );
  }

  if (error || !control) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center">
        <XCircle className="mx-auto h-8 w-8 text-rose-500" />
        <p className="mt-2 text-rose-600">Failed to load control details</p>
        <Link href="/erm/internal-controls" className="mt-4 inline-block text-primary-600 hover:underline">
          Back to Controls
        </Link>
      </div>
    );
  }

  const statusStyle = getStatusStyle(control.status);
  const designStyle = getEffectivenessStyle(control.design_effectiveness);
  const operatingStyle = getEffectivenessStyle(control.operating_effectiveness);

  const canSubmit = control.status === 'draft' || control.status === 'rejected';
  const canApproveReject = control.status === 'pending_approval';

  return (
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6">
      <div className="flex items-center gap-4">
        <Link
          href="/erm/internal-controls"
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-lg sm:text-xl font-semibold text-slate-900">{control.name}</h1>
            {control.is_key_control && (
              <span className="flex items-center gap-1 rounded bg-primary-50 px-2 py-1 text-xs font-medium text-primary-700">
                <Key className="h-3 w-3" />
                Key Control
              </span>
            )}
            <span className={`rounded-full px-3 py-1 text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
              {statusStyle.label}
            </span>
          </div>
          <p className="mt-1 font-mono text-sm text-slate-600">{control.control_id}</p>
        </div>
        <div className="flex items-center gap-2">
          {canSubmit && (
            <button
              onClick={() => setShowWorkflowModal('submit')}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-[#0a0a0a] hover:bg-primary-700"
            >
              <Send className="h-4 w-4" />
              Submit for Approval
            </button>
          )}
          {canApproveReject && (
            <>
              <button
                onClick={() => setShowWorkflowModal('approve')}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
              >
                <ThumbsUp className="h-4 w-4" />
                Approve
              </button>
              <button
                onClick={() => setShowWorkflowModal('reject')}
                className="flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500"
              >
                <ThumbsDown className="h-4 w-4" />
                Reject
              </button>
            </>
          )}
          <Link
            href={`/erm/internal-controls`}
            onClick={(e) => {
              e.preventDefault();
              router.push(`/erm/internal-controls?edit=${control.id}`);
            }}
            className="flex items-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            <Edit2 className="h-4 w-4" />
            Edit
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors -mb-px ${
              activeTab === tab.id
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            <tab.icon className="h-4 w-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'details' && (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-6">
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="mb-4 text-lg font-semibold text-slate-900">Control Information</h3>
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-sm text-slate-600">Category</dt>
                  <dd className="mt-1 text-slate-900">{control.category || '-'}</dd>
                </div>
                <div>
                  <dt className="text-sm text-slate-600">Sub-Category</dt>
                  <dd className="mt-1 text-slate-900">{control.sub_category || '-'}</dd>
                </div>
                <div>
                  <dt className="text-sm text-slate-600">Control Type</dt>
                  <dd className="mt-1 capitalize text-slate-900">{control.control_type || '-'}</dd>
                </div>
                <div>
                  <dt className="text-sm text-slate-600">Control Nature</dt>
                  <dd className="mt-1 capitalize text-slate-900">
                    {control.control_nature?.replace('_', ' ') || '-'}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-slate-600">Frequency</dt>
                  <dd className="mt-1 capitalize text-slate-900">{control.frequency || '-'}</dd>
                </div>
                <div>
                  <dt className="text-sm text-slate-600">Priority</dt>
                  <dd className="mt-1 capitalize text-slate-900">{control.priority || '-'}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-sm text-slate-600">Description</dt>
                  <dd className="mt-1 text-slate-900">{control.description || 'No description provided'}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-sm text-slate-600">Regulatory Source</dt>
                  <dd className="mt-1 text-slate-900">{control.regulatory_source || '-'}</dd>
                </div>
              </dl>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="mb-4 text-lg font-semibold text-slate-900">Effectiveness</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-300 bg-slate-100/50 p-4">
                  <p className="text-sm text-slate-600">Design Effectiveness</p>
                  <span
                    className={`mt-2 inline-block rounded-full px-3 py-1 text-sm font-medium ${designStyle.bg} ${designStyle.text}`}
                  >
                    {designStyle.label}
                  </span>
                </div>
                <div className="rounded-lg border border-slate-300 bg-slate-100/50 p-4">
                  <p className="text-sm text-slate-600">Operating Effectiveness</p>
                  <span
                    className={`mt-2 inline-block rounded-full px-3 py-1 text-sm font-medium ${operatingStyle.bg} ${operatingStyle.text}`}
                  >
                    {operatingStyle.label}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="mb-4 text-lg font-semibold text-slate-900">Ownership</h3>
              <dl className="space-y-4">
                <div className="flex items-start gap-3">
                  <User className="mt-1 h-4 w-4 text-slate-600" />
                  <div>
                    <dt className="text-sm text-slate-600">Owner</dt>
                    <dd className="text-slate-900">{control.owner_name || 'Not assigned'}</dd>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <User className="mt-1 h-4 w-4 text-slate-600" />
                  <div>
                    <dt className="text-sm text-slate-600">Backup Owner</dt>
                    <dd className="text-slate-900">{control.backup_owner_name || 'Not assigned'}</dd>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Building2 className="mt-1 h-4 w-4 text-slate-600" />
                  <div>
                    <dt className="text-sm text-slate-600">Department</dt>
                    <dd className="text-slate-900">{control.department_name || 'Not assigned'}</dd>
                  </div>
                </div>
              </dl>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-6">
              <h3 className="mb-4 text-lg font-semibold text-slate-900">Dates</h3>
              <dl className="space-y-4">
                <div className="flex items-start gap-3">
                  <Calendar className="mt-1 h-4 w-4 text-slate-600" />
                  <div>
                    <dt className="text-sm text-slate-600">Effective Date</dt>
                    <dd className="text-slate-900">
                      {control.effective_date
                        ? new Date(control.effective_date).toLocaleDateString()
                        : '-'}
                    </dd>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Calendar className="mt-1 h-4 w-4 text-slate-600" />
                  <div>
                    <dt className="text-sm text-slate-600">Review Date</dt>
                    <dd className="text-slate-900">
                      {control.review_date ? new Date(control.review_date).toLocaleDateString() : '-'}
                    </dd>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Clock className="mt-1 h-4 w-4 text-slate-600" />
                  <div>
                    <dt className="text-sm text-slate-600">Last Tested</dt>
                    <dd className="text-slate-900">
                      {control.last_tested_at
                        ? new Date(control.last_tested_at).toLocaleDateString()
                        : 'Never'}
                    </dd>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Clock className="mt-1 h-4 w-4 text-slate-600" />
                  <div>
                    <dt className="text-sm text-slate-600">Next Test Date</dt>
                    <dd className="text-slate-900">
                      {control.next_test_date
                        ? new Date(control.next_test_date).toLocaleDateString()
                        : '-'}
                    </dd>
                  </div>
                </div>
              </dl>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'testing' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900">Control Tests</h3>
            {canCreate && (
            <button
              onClick={() => setShowTestModal(true)}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-[#0a0a0a] hover:bg-primary-700"
            >
              <Plus className="h-4 w-4" />
              Add Test
            </button>
            )}
          </div>
          {(!control.tests || control.tests.length === 0) ? (
            <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
              <ClipboardCheck className="mx-auto h-12 w-12 text-slate-500" />
              <p className="mt-4 text-lg font-medium text-slate-900">No tests recorded</p>
              <p className="mt-1 text-sm text-slate-600">Add a test to evaluate control effectiveness</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Type</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Date</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Result</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Exceptions</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Tester</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {control.tests?.map((test) => {
                    const resultStyle = TEST_RESULT_STYLES[test.result || ''] || {
                      bg: 'bg-slate-500/20',
                      text: 'text-slate-600',
                    };
                    return (
                      <tr key={test.id} className="hover:bg-slate-100/50">
                        <td className="px-4 py-3 capitalize text-slate-900">{test.test_type}</td>
                        <td className="px-4 py-3 text-slate-700">
                          {test.test_date ? new Date(test.test_date).toLocaleDateString() : '-'}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex rounded-lg px-2 py-1 text-xs font-medium whitespace-nowrap capitalize ${resultStyle.bg} ${resultStyle.text}`}
                          >
                            {test.result?.replace('_', ' ') || 'Pending'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-700">{test.exceptions_found ?? '-'}</td>
                        <td className="px-4 py-3 text-slate-700">{test.tester_name || '-'}</td>
                        <td className="px-4 py-3 capitalize text-slate-700">{test.status}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'risks' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900">Linked Risks</h3>
            {canCreate && (
            <button
              onClick={() => setShowRiskModal(true)}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-[#0a0a0a] hover:bg-primary-700"
            >
              <Plus className="h-4 w-4" />
              Link Risk
            </button>
            )}
          </div>
          {(!control.risk_links || control.risk_links.length === 0) ? (
            <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
              <AlertTriangle className="mx-auto h-12 w-12 text-slate-500" />
              <p className="mt-4 text-lg font-medium text-slate-900">No risks linked</p>
              <p className="mt-1 text-sm text-slate-600">Link risks that this control mitigates</p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {control.risk_links?.map((link) => (
                <div
                  key={link.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <Link
                        href={`/erm/risks/${link.risk_id}`}
                        className="font-medium text-slate-900 hover:text-primary-600"
                      >
                        {link.risk_title || `Risk #${link.risk_id}`}
                      </Link>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {link.link_type && (
                          <span className="rounded bg-primary-50 px-2 py-0.5 text-xs text-primary-700">
                            {link.link_type}
                          </span>
                        )}
                        {link.effectiveness_rating && (
                          <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs capitalize text-emerald-700">
                            {link.effectiveness_rating.replace('_', ' ')}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => unlinkRiskMutation.mutate(link.id)}
                      className="rounded p-1 text-slate-600 hover:bg-rose-50 hover:text-rose-600"
                      title="Unlink"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'escalations' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-slate-900">Escalation Rules</h3>
            {canCreate && (
            <button
              onClick={() => setShowEscalationModal(true)}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-[#0a0a0a] hover:bg-primary-700"
            >
              <Plus className="h-4 w-4" />
              Add Escalation
            </button>
            )}
          </div>
          {(!control.escalations || control.escalations.length === 0) ? (
            <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
              <Shield className="mx-auto h-12 w-12 text-slate-500" />
              <p className="mt-4 text-lg font-medium text-slate-900">No escalation rules</p>
              <p className="mt-1 text-sm text-slate-600">Define escalation rules for control failures</p>
            </div>
          ) : (
            <div className="space-y-3">
              {control.escalations?.map((esc) => (
                <div
                  key={esc.id}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-50 text-lg font-bold text-primary-700">
                      {esc.escalation_level}
                    </div>
                    <div>
                      <p className="font-medium text-slate-900">{esc.escalation_name}</p>
                      {esc.trigger_condition && (
                        <p className="text-sm text-slate-600">{esc.trigger_condition}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded-lg px-2 py-1 text-xs ${
                        esc.is_active
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {esc.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <button
                      onClick={() => deleteEscalationMutation.mutate(esc.id)}
                      className="rounded p-1 text-slate-600 hover:bg-rose-50 hover:text-rose-600"
                      title="Delete"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'framework' && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-slate-900">Framework Mappings</h3>
          {(!control.framework_links || control.framework_links.length === 0) ? (
            <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
              <LinkIcon className="mx-auto h-12 w-12 text-slate-500" />
              <p className="mt-4 text-lg font-medium text-slate-900">No framework mappings</p>
              <p className="mt-1 text-sm text-slate-600">
                Link this control to framework controls or normalized controls
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Type</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">ID</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Mapping Type</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-slate-600">Coverage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {control.framework_links?.map((link) => (
                    <tr key={link.id} className="hover:bg-slate-100/50">
                      <td className="px-4 py-3 text-slate-900">
                        {link.framework_control_id ? 'Framework Control' : 'Normalized Control'}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {link.framework_control_id || link.normalized_control_id || '-'}
                      </td>
                      <td className="px-4 py-3 capitalize text-slate-700">{link.mapping_type || '-'}</td>
                      <td className="px-4 py-3 text-slate-700">
                        {link.coverage_percentage !== undefined ? `${link.coverage_percentage}%` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'workflow' && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-slate-900">Workflow History</h3>
          {!workflowHistory || workflowHistory.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
              <Clock className="mx-auto h-12 w-12 text-slate-500" />
              <p className="mt-4 text-lg font-medium text-slate-900">No workflow actions</p>
              <p className="mt-1 text-sm text-slate-600">Workflow actions will appear here</p>
            </div>
          ) : (
            <div className="space-y-4">
              {workflowHistory.map((action, index) => (
                <div key={action.id} className="relative flex gap-4">
                  {index < workflowHistory.length - 1 && (
                    <div className="absolute left-5 top-10 h-full w-0.5 bg-slate-100" />
                  )}
                  <div
                    className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-full ${
                      action.action === 'approve'
                        ? 'bg-emerald-600'
                        : action.action === 'reject'
                        ? 'bg-rose-600'
                        : 'bg-primary-600'
                    }`}
                  >
                    {action.action === 'approve' ? (
                      <CheckCircle className="h-5 w-5 text-white" />
                    ) : action.action === 'reject' ? (
                      <XCircle className="h-5 w-5 text-white" />
                    ) : (
                      <Send className="h-5 w-5 text-[#0a0a0a]" />
                    )}
                  </div>
                  <div className="flex-1 rounded-xl border border-slate-200 bg-white p-4">
                    <div className="flex items-center justify-between">
                      <p className="font-medium capitalize text-slate-900">{action.action}</p>
                      <p className="text-sm text-slate-600">
                        {new Date(action.action_at).toLocaleString()}
                      </p>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">
                      by {action.actor_name || 'Unknown'} · {action.from_status} → {action.to_status}
                    </p>
                    {action.comments && <p className="mt-2 text-sm text-slate-700">{action.comments}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <RightSlidePanel
        isOpen={showTestModal}
        onClose={() => setShowTestModal(false)}
        title="Add Test"
      >
        <form
          id="control-test-form"
          onSubmit={(e) => {
            e.preventDefault();
            const formData = new FormData(e.currentTarget);
            createTestMutation.mutate({
              test_type: formData.get('test_type'),
              test_period_start: formData.get('test_period_start') || undefined,
              test_period_end: formData.get('test_period_end') || undefined,
              sample_size: formData.get('sample_size')
                ? Number(formData.get('sample_size'))
                : undefined,
              exceptions_found: formData.get('exceptions_found')
                ? Number(formData.get('exceptions_found'))
                : undefined,
              result: formData.get('result') || undefined,
              findings: formData.get('findings') || undefined,
              recommendations: formData.get('recommendations') || undefined,
            });
          }}
          className="space-y-4"
        >
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Test Type</label>
                <select
                  name="test_type"
                  required
                  className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
                >
                  <option value="design">Design</option>
                  <option value="operating">Operating</option>
                </select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Period Start</label>
                  <input
                    name="test_period_start"
                    type="date"
                    className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Period End</label>
                  <input
                    name="test_period_end"
                    type="date"
                    className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Sample Size</label>
                  <input
                    name="sample_size"
                    type="number"
                    min="0"
                    className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Exceptions Found</label>
                  <input
                    name="exceptions_found"
                    type="number"
                    min="0"
                    className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Result</label>
                <select
                  name="result"
                  className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
                >
                  <option value="">Select result</option>
                  <option value="effective">Effective</option>
                  <option value="partially_effective">Partially Effective</option>
                  <option value="ineffective">Ineffective</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Findings</label>
                <textarea
                  name="findings"
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Recommendations</label>
                <textarea
                  name="recommendations"
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
                />
              </div>
        </form>
        <div className="mt-4 flex justify-end gap-3 border-t border-slate-200 pt-4">
          <button
            type="button"
            onClick={() => setShowTestModal(false)}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="control-test-form"
            disabled={createTestMutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50"
          >
            {createTestMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Add Test
          </button>
        </div>
      </RightSlidePanel>

      <RightSlidePanel
        isOpen={showRiskModal}
        onClose={() => setShowRiskModal(false)}
        title="Link Risk"
      >
            <form
              id="control-risk-form"
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                linkRiskMutation.mutate({
                  risk_id: Number(formData.get('risk_id')),
                  link_type: (formData.get('link_type') as string) || undefined,
                  effectiveness_rating: (formData.get('effectiveness_rating') as string) || undefined,
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Risk</label>
                <select
                  name="risk_id"
                  required
                  className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
                >
                  <option value="">Select risk</option>
                  {risks?.map((risk: { id: number; title: string }) => (
                    <option key={risk.id} value={risk.id}>
                      {risk.title}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Link Type</label>
                <select
                  name="link_type"
                  className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
                >
                  <option value="">Select type</option>
                  <option value="mitigates">Mitigates</option>
                  <option value="monitors">Monitors</option>
                  <option value="prevents">Prevents</option>
                  <option value="detects">Detects</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Effectiveness Rating
                </label>
                <select
                  name="effectiveness_rating"
                  className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
                >
                  <option value="">Select rating</option>
                  <option value="effective">Effective</option>
                  <option value="partially_effective">Partially Effective</option>
                  <option value="ineffective">Ineffective</option>
                </select>
              </div>
            </form>
            <div className="mt-4 flex justify-end gap-3 border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={() => setShowRiskModal(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="control-risk-form"
                disabled={linkRiskMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50"
              >
                {linkRiskMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Link Risk
              </button>
            </div>
      </RightSlidePanel>

      <RightSlidePanel
        isOpen={showEscalationModal}
        onClose={() => setShowEscalationModal(false)}
        title="Add Escalation Rule"
      >
            <form
              id="control-esc-form"
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                createEscalationMutation.mutate({
                  escalation_level: Number(formData.get('escalation_level')),
                  escalation_name: formData.get('escalation_name'),
                  trigger_condition: formData.get('trigger_condition') || undefined,
                  is_active: formData.get('is_active') === 'true',
                });
              }}
              className="space-y-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Level</label>
                  <input
                    name="escalation_level"
                    type="number"
                    min="1"
                    max="5"
                    required
                    className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Name</label>
                  <input
                    name="escalation_name"
                    type="text"
                    required
                    className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
                    placeholder="e.g., Manager Review"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Trigger Condition</label>
                <textarea
                  name="trigger_condition"
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
                  placeholder="Describe when this escalation should trigger..."
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  name="is_active"
                  type="checkbox"
                  value="true"
                  defaultChecked
                  className="h-4 w-4 rounded border-slate-300 bg-slate-100 text-primary-600"
                />
                <label className="text-sm font-medium text-slate-700">Active</label>
              </div>
            </form>
            <div className="mt-4 flex justify-end gap-3 border-t border-slate-200 pt-4">
              <button
                type="button"
                onClick={() => setShowEscalationModal(false)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="control-esc-form"
                disabled={createEscalationMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:opacity-50"
              >
                {createEscalationMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Add Escalation
              </button>
            </div>
      </RightSlidePanel>

      <RightSlidePanel
        isOpen={!!showWorkflowModal}
        onClose={() => {
          setShowWorkflowModal(null);
          setWorkflowComments('');
        }}
        width="w-full max-w-md"
        title={
          showWorkflowModal === 'submit'
            ? 'Submit for Approval'
            : showWorkflowModal === 'approve'
            ? 'Approve Control'
            : 'Reject Control'
        }
        footer={
          <div className="flex justify-end gap-3">
            <button
              onClick={() => {
                setShowWorkflowModal(null);
                setWorkflowComments('');
              }}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (showWorkflowModal === 'submit') {
                  submitMutation.mutate();
                } else if (showWorkflowModal === 'approve') {
                  approveMutation.mutate();
                } else {
                  rejectMutation.mutate();
                }
              }}
              disabled={
                submitMutation.isPending || approveMutation.isPending || rejectMutation.isPending
              }
              className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 ${
                showWorkflowModal === 'reject'
                  ? 'bg-rose-600 text-white hover:bg-rose-500'
                  : showWorkflowModal === 'approve'
                  ? 'bg-emerald-600 text-white hover:bg-emerald-500'
                  : 'bg-primary-600 text-[#0a0a0a] hover:bg-primary-700'
              }`}
            >
              {(submitMutation.isPending ||
                approveMutation.isPending ||
                rejectMutation.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}
              {showWorkflowModal === 'submit'
                ? 'Submit'
                : showWorkflowModal === 'approve'
                ? 'Approve'
                : 'Reject'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">Comments</label>
            <textarea
              value={workflowComments}
              onChange={(e) => setWorkflowComments(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900 placeholder:text-slate-600"
              placeholder="Add comments (optional)..."
            />
          </div>
        </div>
      </RightSlidePanel>
    </div>
  );
}
