'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient, { evidenceApprovalApi } from '@/lib/api';
import {
  FileCheck,
  Loader2,
  AlertCircle,
  CheckCircle,
  Clock,
  XCircle,
  X,
  Eye,
  Plus,
  Trash2,
  MessageSquare,
  AlertTriangle,
  ArrowRight,
  ChevronUp,
  ChevronDown,
  ClipboardList,
  RotateCcw,
  Send,
  Users,
  GitBranch,
} from 'lucide-react';

interface WorkflowStep {
  id: number;
  workflow_id: number;
  step_number: number;
  reviewer_id: number;
  reviewer_name?: string;
  status: string;
  comments?: string;
  reviewed_at?: string;
  created_at?: string;
}

interface Workflow {
  id: number;
  evidence_id: number;
  evidence_name?: string;
  evidence_description?: string;
  status: string;
  created_by: number;
  created_by_name?: string;
  created_at: string;
  updated_at?: string;
  steps?: WorkflowStep[];
  total_steps?: number;
  completed_steps?: number;
}

interface PendingReview {
  step_id: number;
  step_number: number;
  workflow_id: number;
  workflow_status: string;
  evidence_id: number;
  evidence_name: string;
  evidence_description?: string;
  created_at: string;
  status: string;
}

interface EvidenceItem {
  id: number;
  name: string;
  description?: string;
  status: string;
}

interface TenantUser {
  id: number;
  user_id: number;
  tenant_id: number;
  is_primary: boolean;
  user: {
    id: number;
    username: string;
    email: string;
    display_name?: string;
  };
}

interface CurrentUser {
  authenticated: boolean;
  user?: {
    id: number;
    primary_tenant_id: number;
  };
}

type ActiveTab = 'all' | 'my-reviews';
type StatusFilter = 'all' | 'pending' | 'in_progress' | 'approved' | 'rejected';
type ModalType = 'approve' | 'reject' | 'request-changes' | 'detail' | 'create' | null;

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Pending' },
  in_progress: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'In Progress' },
  approved: { bg: 'bg-green-500/20', text: 'text-green-400', label: 'Approved' },
  rejected: { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Rejected' },
  cancelled: { bg: 'bg-slate-500/20', text: 'text-slate-400', label: 'Cancelled' },
  changes_requested: { bg: 'bg-amber-500/20', text: 'text-amber-400', label: 'Changes Requested' },
};

const STEP_STATUS_CONFIG: Record<string, { icon: typeof CheckCircle; color: string; bgColor: string; borderColor: string }> = {
  approved: { icon: CheckCircle, color: 'text-green-400', bgColor: 'bg-green-500/20', borderColor: 'border-green-500' },
  rejected: { icon: XCircle, color: 'text-red-400', bgColor: 'bg-red-500/20', borderColor: 'border-red-500' },
  changes_requested: { icon: AlertTriangle, color: 'text-amber-400', bgColor: 'bg-amber-500/20', borderColor: 'border-amber-500' },
  pending: { icon: Clock, color: 'text-slate-400', bgColor: 'bg-slate-500/20', borderColor: 'border-slate-600' },
  in_progress: { icon: ArrowRight, color: 'text-blue-400', bgColor: 'bg-blue-500/20', borderColor: 'border-blue-500' },
};

export default function EvidenceApprovalsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<ActiveTab>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [modalType, setModalType] = useState<ModalType>(null);
  const [selectedStepId, setSelectedStepId] = useState<number | null>(null);
  const [selectedWorkflow, setSelectedWorkflow] = useState<Workflow | null>(null);
  const [comments, setComments] = useState('');
  const [selectedEvidenceIds, setSelectedEvidenceIds] = useState<number[]>([]);
  const [reviewerIds, setReviewerIds] = useState<number[]>([]);
  const [newReviewerId, setNewReviewerId] = useState('');

  const { data: workflowsData, isLoading: workflowsLoading } = useQuery({
    queryKey: ['evidence-approval-workflows', statusFilter],
    queryFn: async () => {
      const params: { status?: string; limit?: number } = { limit: 100 };
      if (statusFilter !== 'all') params.status = statusFilter;
      const response = await evidenceApprovalApi.getAllWorkflows(params);
      return response.data;
    },
  });

  const { data: myReviews, isLoading: reviewsLoading } = useQuery({
    queryKey: ['evidence-approval-my-reviews'],
    queryFn: async () => {
      const response = await evidenceApprovalApi.getMyReviews();
      return response.data;
    },
    enabled: activeTab === 'my-reviews',
  });

  const { data: evidenceList } = useQuery({
    queryKey: ['evidence-list-for-approval'],
    queryFn: async () => {
      const response = await apiClient.get('/evidence-mgmt/items', { params: { limit: 200 } });
      return response.data?.items || response.data || [];
    },
    enabled: modalType === 'create',
  });

  const { data: currentUser } = useQuery({
    queryKey: ['current-user'],
    queryFn: async () => {
      const response = await apiClient.get<CurrentUser>('/auth/me');
      return response.data;
    },
  });

  const tenantId = currentUser?.user?.primary_tenant_id;

  const { data: tenantUsers } = useQuery({
    queryKey: ['tenant-users-for-approval', tenantId],
    queryFn: async () => {
      const response = await apiClient.get(`/tenants/${tenantId}/users`);
      return response.data as TenantUser[];
    },
    enabled: modalType === 'create' && !!tenantId,
  });

  const approveMutation = useMutation({
    mutationFn: ({ stepId, data }: { stepId: number; data?: { comments?: string } }) =>
      evidenceApprovalApi.approveStep(stepId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evidence-approval-workflows'] });
      queryClient.invalidateQueries({ queryKey: ['evidence-approval-my-reviews'] });
      closeModal();
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ stepId, data }: { stepId: number; data: { comments: string } }) =>
      evidenceApprovalApi.rejectStep(stepId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evidence-approval-workflows'] });
      queryClient.invalidateQueries({ queryKey: ['evidence-approval-my-reviews'] });
      closeModal();
    },
  });

  const requestChangesMutation = useMutation({
    mutationFn: ({ stepId, data }: { stepId: number; data: { comments: string } }) =>
      evidenceApprovalApi.requestChanges(stepId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evidence-approval-workflows'] });
      queryClient.invalidateQueries({ queryKey: ['evidence-approval-my-reviews'] });
      closeModal();
    },
  });

  const createWorkflowMutation = useMutation({
    mutationFn: ({ evidenceId, data }: { evidenceId: number; data: { reviewer_ids: number[] } }) =>
      evidenceApprovalApi.createWorkflow(evidenceId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evidence-approval-workflows'] });
      closeModal();
    },
  });

  const cancelWorkflowMutation = useMutation({
    mutationFn: (workflowId: number) => evidenceApprovalApi.cancelWorkflow(workflowId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evidence-approval-workflows'] });
      setSelectedWorkflow(null);
      setModalType(null);
    },
  });

  const closeModal = () => {
    setModalType(null);
    setSelectedStepId(null);
    setSelectedWorkflow(null);
    setComments('');
    setSelectedEvidenceIds([]);
    setReviewerIds([]);
    setNewReviewerId('');
  };

  const openActionModal = (type: 'approve' | 'reject' | 'request-changes', stepId: number) => {
    setModalType(type);
    setSelectedStepId(stepId);
    setComments('');
  };

  const handleViewWorkflow = async (workflowId: number) => {
    try {
      const response = await evidenceApprovalApi.getWorkflowById(workflowId);
      setSelectedWorkflow(response.data);
      setModalType('detail');
    } catch {
      const workflow = workflows?.find((w: Workflow) => w.id === workflowId);
      if (workflow) {
        setSelectedWorkflow(workflow);
        setModalType('detail');
      }
    }
  };

  const handleApprove = () => {
    if (selectedStepId === null) return;
    approveMutation.mutate({ stepId: selectedStepId, data: comments ? { comments } : undefined });
  };

  const handleReject = () => {
    if (selectedStepId === null || !comments.trim()) return;
    rejectMutation.mutate({ stepId: selectedStepId, data: { comments: comments.trim() } });
  };

  const handleRequestChanges = () => {
    if (selectedStepId === null || !comments.trim()) return;
    requestChangesMutation.mutate({ stepId: selectedStepId, data: { comments: comments.trim() } });
  };

  const handleCreateWorkflow = async () => {
    if (selectedEvidenceIds.length === 0 || reviewerIds.length === 0) return;
    try {
      for (const evidenceId of selectedEvidenceIds) {
        await createWorkflowMutation.mutateAsync({ evidenceId, data: { reviewer_ids: reviewerIds } });
      }
    } catch {
    }
  };

  const addReviewer = () => {
    const id = parseInt(newReviewerId);
    if (!isNaN(id) && id > 0 && !reviewerIds.includes(id)) {
      setReviewerIds([...reviewerIds, id]);
      setNewReviewerId('');
    }
  };

  const addReviewerFromSelect = (userIdNum: number) => {
    if (!reviewerIds.includes(userIdNum)) {
      setReviewerIds([...reviewerIds, userIdNum]);
    }
  };

  const removeReviewer = (id: number) => {
    setReviewerIds(reviewerIds.filter(r => r !== id));
  };

  const moveReviewer = (index: number, direction: 'up' | 'down') => {
    const newIds = [...reviewerIds];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newIds.length) return;
    [newIds[index], newIds[swapIndex]] = [newIds[swapIndex], newIds[index]];
    setReviewerIds(newIds);
  };

  const workflows: Workflow[] = workflowsData?.workflows || workflowsData || [];
  const pendingReviews: PendingReview[] = myReviews?.reviews || myReviews || [];

  const workflowStats = {
    total: workflows.length,
    pending: workflows.filter((w: Workflow) => w.status === 'pending').length,
    in_progress: workflows.filter((w: Workflow) => w.status === 'in_progress').length,
    completed: workflows.filter((w: Workflow) => w.status === 'approved').length,
  };

  const getStatusBadge = (status: string) => {
    const style = STATUS_STYLES[status] || STATUS_STYLES.pending;
    return (
      <span className={`inline-flex items-center gap-1 rounded-full ${style.bg} px-2.5 py-1 text-xs font-medium ${style.text}`}>
        {status === 'approved' && <CheckCircle size={12} />}
        {status === 'pending' && <Clock size={12} />}
        {status === 'in_progress' && <ArrowRight size={12} />}
        {status === 'rejected' && <XCircle size={12} />}
        {status === 'cancelled' && <X size={12} />}
        {status === 'changes_requested' && <AlertTriangle size={12} />}
        {style.label}
      </span>
    );
  };

  const getStepProgress = (workflow: Workflow) => {
    const total = workflow.total_steps || workflow.steps?.length || 0;
    const completed = workflow.completed_steps || workflow.steps?.filter(s => s.status === 'approved').length || 0;
    return { total, completed };
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Evidence Approval Workflows</h1>
          <p className="text-slate-400">Manage evidence review and approval processes</p>
        </div>
        <button
          onClick={() => setModalType('create')}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 transition-colors"
        >
          <Plus size={18} />
          Create Workflow
        </button>
      </div>

      <div className="flex border-b border-slate-700">
        <button
          onClick={() => setActiveTab('all')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'all'
              ? 'border-primary-500 text-primary-400'
              : 'border-transparent text-slate-400 hover:text-white hover:border-slate-600'
          }`}
        >
          <GitBranch size={16} />
          All Workflows
          {workflowStats.total > 0 && (
            <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs">{workflowStats.total}</span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('my-reviews')}
          className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'my-reviews'
              ? 'border-primary-500 text-primary-400'
              : 'border-transparent text-slate-400 hover:text-white hover:border-slate-600'
          }`}
        >
          <ClipboardList size={16} />
          My Pending Reviews
          {pendingReviews.length > 0 && (
            <span className="rounded-full bg-amber-500/20 text-amber-400 px-2 py-0.5 text-xs">{pendingReviews.length}</span>
          )}
        </button>
      </div>

      {activeTab === 'all' && (
        <>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="rounded-xl bg-gradient-to-br from-primary-500/20 to-primary-600/10 p-3">
                  <GitBranch className="h-5 w-5 text-primary-400" />
                </div>
              </div>
              <p className="text-2xl font-bold text-white">{workflowStats.total}</p>
              <p className="text-sm text-slate-400">Total Workflows</p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="rounded-xl bg-gradient-to-br from-yellow-500/20 to-yellow-600/10 p-3">
                  <Clock className="h-5 w-5 text-yellow-400" />
                </div>
              </div>
              <p className="text-2xl font-bold text-white">{workflowStats.pending}</p>
              <p className="text-sm text-slate-400">Pending</p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-600/10 p-3">
                  <ArrowRight className="h-5 w-5 text-blue-400" />
                </div>
              </div>
              <p className="text-2xl font-bold text-white">{workflowStats.in_progress}</p>
              <p className="text-sm text-slate-400">In Progress</p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="rounded-xl bg-gradient-to-br from-green-500/20 to-green-600/10 p-3">
                  <CheckCircle className="h-5 w-5 text-green-400" />
                </div>
              </div>
              <p className="text-2xl font-bold text-white">{workflowStats.completed}</p>
              <p className="text-sm text-slate-400">Completed</p>
            </div>
          </div>

          {workflowsLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
            </div>
          ) : workflows.length === 0 ? (
            <div className="rounded-xl border border-slate-700 bg-slate-800 flex flex-col items-center justify-center py-12 text-center">
              <GitBranch className="mb-4 h-12 w-12 text-slate-600" />
              <h3 className="text-lg font-medium text-white">No workflows found</h3>
              <p className="mt-1 text-slate-400">Create a new approval workflow to get started</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-700">
              <table className="w-full">
                <thead className="bg-slate-800/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Evidence</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Created By</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Created At</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Progress</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700 bg-slate-800">
                  {workflows.map((workflow: Workflow) => {
                    const progress = getStepProgress(workflow);
                    return (
                      <tr key={workflow.id} className="hover:bg-slate-700/50 transition-colors">
                        <td className="px-4 py-3">
                          <div>
                            <p className="text-sm font-medium text-white">{workflow.evidence_name || `Evidence #${workflow.evidence_id}`}</p>
                            {workflow.evidence_description && (
                              <p className="text-xs text-slate-400 truncate max-w-xs">{workflow.evidence_description}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {getStatusBadge(workflow.status)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-slate-300">{workflow.created_by_name || `User #${workflow.created_by}`}</span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-slate-300">
                            {new Date(workflow.created_at).toLocaleDateString()}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-20 overflow-hidden rounded-full bg-slate-600">
                              <div
                                className="h-full bg-green-500 transition-all"
                                style={{ width: `${progress.total > 0 ? (progress.completed / progress.total) * 100 : 0}%` }}
                              />
                            </div>
                            <span className="text-xs text-slate-400">
                              {progress.completed}/{progress.total} approved
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => handleViewWorkflow(workflow.id)}
                              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white transition-colors"
                              title="View Details"
                            >
                              <Eye size={16} />
                            </button>
                            {(workflow.status === 'pending' || workflow.status === 'in_progress') && (
                              <button
                                onClick={() => {
                                  if (confirm('Are you sure you want to cancel this workflow?')) {
                                    cancelWorkflowMutation.mutate(workflow.id);
                                  }
                                }}
                                className="rounded-lg p-1.5 text-slate-400 hover:bg-red-500/20 hover:text-red-400 transition-colors"
                                title="Cancel Workflow"
                              >
                                <Trash2 size={16} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {activeTab === 'my-reviews' && (
        <>
          {reviewsLoading ? (
            <div className="flex h-64 items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
            </div>
          ) : pendingReviews.length === 0 ? (
            <div className="rounded-xl border border-slate-700 bg-slate-800 flex flex-col items-center justify-center py-12 text-center">
              <CheckCircle className="mb-4 h-12 w-12 text-green-500/50" />
              <h3 className="text-lg font-medium text-white">No pending reviews</h3>
              <p className="mt-1 text-slate-400">You have no evidence items awaiting your review</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pendingReviews.map((review: PendingReview) => (
                <div
                  key={review.step_id}
                  className="rounded-xl border border-slate-700 bg-slate-800 p-4 hover:border-slate-600 transition-colors"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                      <div className="rounded-lg bg-amber-500/20 p-2.5 mt-0.5">
                        <FileCheck className="h-5 w-5 text-amber-400" />
                      </div>
                      <div>
                        <h3 className="text-sm font-medium text-white">{review.evidence_name || `Evidence #${review.evidence_id}`}</h3>
                        {review.evidence_description && (
                          <p className="text-xs text-slate-400 mt-0.5">{review.evidence_description}</p>
                        )}
                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-xs text-slate-500">Step {review.step_number}</span>
                          <span className="text-xs text-slate-600">•</span>
                          {getStatusBadge(review.workflow_status || review.status)}
                          <span className="text-xs text-slate-600">•</span>
                          <span className="text-xs text-slate-500">
                            {new Date(review.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => openActionModal('approve', review.step_id)}
                        className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 transition-colors"
                      >
                        <CheckCircle size={14} />
                        Approve
                      </button>
                      <button
                        onClick={() => openActionModal('reject', review.step_id)}
                        className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
                      >
                        <XCircle size={14} />
                        Reject
                      </button>
                      <button
                        onClick={() => openActionModal('request-changes', review.step_id)}
                        className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 transition-colors"
                      >
                        <RotateCcw size={14} />
                        Request Changes
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {(modalType === 'approve' || modalType === 'reject' || modalType === 'request-changes') && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
              <h3 className="text-lg font-semibold text-white">
                {modalType === 'approve' && 'Approve Step'}
                {modalType === 'reject' && 'Reject Step'}
                {modalType === 'request-changes' && 'Request Changes'}
              </h3>
              <button onClick={closeModal} className="rounded-lg p-1 text-slate-400 hover:bg-slate-700 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Comments {modalType !== 'approve' && <span className="text-red-400">*</span>}
                </label>
                <textarea
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  placeholder={
                    modalType === 'approve'
                      ? 'Optional comments...'
                      : modalType === 'reject'
                      ? 'Provide reason for rejection...'
                      : 'Describe the changes needed...'
                  }
                  rows={4}
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white placeholder-slate-500 focus:border-primary-500 focus:outline-none resize-none"
                />
                {modalType !== 'approve' && !comments.trim() && (
                  <p className="text-xs text-red-400 mt-1">Comments are required</p>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-700 px-6 py-4">
              <button
                onClick={closeModal}
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (modalType === 'approve') handleApprove();
                  else if (modalType === 'reject') handleReject();
                  else if (modalType === 'request-changes') handleRequestChanges();
                }}
                disabled={
                  (modalType !== 'approve' && !comments.trim()) ||
                  approveMutation.isPending ||
                  rejectMutation.isPending ||
                  requestChangesMutation.isPending
                }
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  modalType === 'approve'
                    ? 'bg-green-600 hover:bg-green-700'
                    : modalType === 'reject'
                    ? 'bg-red-600 hover:bg-red-700'
                    : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                {(approveMutation.isPending || rejectMutation.isPending || requestChangesMutation.isPending) && (
                  <Loader2 size={14} className="animate-spin" />
                )}
                {modalType === 'approve' && 'Confirm Approval'}
                {modalType === 'reject' && 'Confirm Rejection'}
                {modalType === 'request-changes' && 'Request Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalType === 'detail' && selectedWorkflow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-800 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700 px-6 py-4 sticky top-0 bg-slate-800 z-10">
              <h3 className="text-lg font-semibold text-white">Workflow Details</h3>
              <button onClick={closeModal} className="rounded-lg p-1 text-slate-400 hover:bg-slate-700 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <div className="px-6 py-4 space-y-6">
              <div className="rounded-lg border border-slate-700 bg-slate-900 p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="text-sm font-medium text-white">
                      {selectedWorkflow.evidence_name || `Evidence #${selectedWorkflow.evidence_id}`}
                    </h4>
                    {selectedWorkflow.evidence_description && (
                      <p className="text-xs text-slate-400 mt-1">{selectedWorkflow.evidence_description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2">
                      {getStatusBadge(selectedWorkflow.status)}
                      <span className="text-xs text-slate-500">
                        Created {new Date(selectedWorkflow.created_at).toLocaleDateString()}
                      </span>
                      {selectedWorkflow.created_by_name && (
                        <>
                          <span className="text-xs text-slate-600">•</span>
                          <span className="text-xs text-slate-500">by {selectedWorkflow.created_by_name}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-semibold text-white mb-4">Approval Steps</h4>
                <div className="relative">
                  {(selectedWorkflow.steps || []).map((step: WorkflowStep, index: number) => {
                    const config = STEP_STATUS_CONFIG[step.status] || STEP_STATUS_CONFIG.pending;
                    const StepIcon = config.icon;
                    const isLast = index === (selectedWorkflow.steps?.length || 0) - 1;
                    const isActive = step.status === 'pending' && (index === 0 || selectedWorkflow.steps?.[index - 1]?.status === 'approved');

                    return (
                      <div key={step.id} className="relative flex gap-4">
                        <div className="flex flex-col items-center">
                          <div className={`flex h-10 w-10 items-center justify-center rounded-full border-2 ${
                            isActive ? 'border-blue-500 bg-blue-500/20' : config.borderColor
                          } ${isActive ? 'bg-blue-500/20' : config.bgColor} transition-all`}>
                            {isActive ? (
                              <ArrowRight className="h-5 w-5 text-blue-400" />
                            ) : (
                              <StepIcon className={`h-5 w-5 ${config.color}`} />
                            )}
                          </div>
                          {!isLast && (
                            <div className={`w-0.5 flex-1 min-h-[2rem] ${
                              step.status === 'approved' ? 'bg-green-500/50' : 'bg-slate-700'
                            }`} />
                          )}
                        </div>
                        <div className={`flex-1 pb-6 ${isLast ? 'pb-0' : ''}`}>
                          <div className={`rounded-lg border p-3 ${
                            isActive
                              ? 'border-blue-500/50 bg-blue-500/5'
                              : 'border-slate-700 bg-slate-900/50'
                          }`}>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-semibold text-slate-500">Step {step.step_number}</span>
                                <span className="text-sm font-medium text-white">
                                  {step.reviewer_name || `Reviewer #${step.reviewer_id}`}
                                </span>
                              </div>
                              {getStatusBadge(isActive ? 'in_progress' : step.status)}
                            </div>
                            {step.comments && (
                              <div className="mt-2 flex items-start gap-2">
                                <MessageSquare size={12} className="text-slate-500 mt-0.5 flex-shrink-0" />
                                <p className="text-xs text-slate-400">{step.comments}</p>
                              </div>
                            )}
                            {step.reviewed_at && (
                              <p className="text-xs text-slate-500 mt-1">
                                Reviewed on {new Date(step.reviewed_at).toLocaleDateString()} at{' '}
                                {new Date(step.reviewed_at).toLocaleTimeString()}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  {(!selectedWorkflow.steps || selectedWorkflow.steps.length === 0) && (
                    <div className="text-center py-6">
                      <Clock className="mx-auto h-8 w-8 text-slate-600 mb-2" />
                      <p className="text-sm text-slate-400">No approval steps found</p>
                    </div>
                  )}
                </div>
              </div>

              {(selectedWorkflow.status === 'pending' || selectedWorkflow.status === 'in_progress') && (
                <div className="border-t border-slate-700 pt-4">
                  <button
                    onClick={() => {
                      if (confirm('Are you sure you want to cancel this workflow?')) {
                        cancelWorkflowMutation.mutate(selectedWorkflow.id);
                      }
                    }}
                    disabled={cancelWorkflowMutation.isPending}
                    className="flex items-center gap-2 rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                  >
                    {cancelWorkflowMutation.isPending ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Trash2 size={14} />
                    )}
                    Cancel Workflow
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {modalType === 'create' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl border border-slate-700 bg-slate-800 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700 px-6 py-4 sticky top-0 bg-slate-800 z-10">
              <h3 className="text-lg font-semibold text-white">Create Approval Workflow</h3>
              <button onClick={closeModal} className="rounded-lg p-1 text-slate-400 hover:bg-slate-700 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <div className="px-6 py-4 space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Select Evidence <span className="text-red-400">*</span>
                </label>
                <p className="text-xs text-slate-500 mb-3">Select one or more evidence items. A separate workflow will be created for each.</p>

                {selectedEvidenceIds.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-3">
                    {selectedEvidenceIds.map((eid) => {
                      const item = (evidenceList || []).find((e: EvidenceItem) => e.id === eid);
                      return (
                        <span
                          key={eid}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-sm text-white"
                        >
                          {item ? item.name : `Evidence #${eid}`}
                          <button
                            onClick={() => setSelectedEvidenceIds(selectedEvidenceIds.filter(id => id !== eid))}
                            className="rounded p-0.5 text-slate-400 hover:text-red-400"
                          >
                            <X size={14} />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}

                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) {
                      const val = parseInt(e.target.value);
                      if (!selectedEvidenceIds.includes(val)) {
                        setSelectedEvidenceIds([...selectedEvidenceIds, val]);
                      }
                    }
                  }}
                  className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
                >
                  <option value="">Add evidence item...</option>
                  {(evidenceList || [])
                    .filter((item: EvidenceItem) => !selectedEvidenceIds.includes(item.id))
                    .map((item: EvidenceItem) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">
                  Reviewers (in order) <span className="text-red-400">*</span>
                </label>
                <p className="text-xs text-slate-500 mb-3">Add reviewers in the order they should review. The first reviewer will be asked first.</p>

                {reviewerIds.length > 0 && (
                  <div className="space-y-2 mb-3">
                    {reviewerIds.map((id, index) => {
                      const tu = tenantUsers?.find(u => u.user_id === id || u.user?.id === id);
                      return (
                        <div
                          key={id}
                          className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2"
                        >
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-500/20 text-xs font-semibold text-primary-400">
                            {index + 1}
                          </span>
                          <span className="flex-1 text-sm text-white">
                            {tu ? `${tu.user.display_name || tu.user.username} (${tu.user.email})` : `User #${id}`}
                          </span>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => moveReviewer(index, 'up')}
                              disabled={index === 0}
                              className="rounded p-0.5 text-slate-400 hover:text-white disabled:opacity-30"
                            >
                              <ChevronUp size={14} />
                            </button>
                            <button
                              onClick={() => moveReviewer(index, 'down')}
                              disabled={index === reviewerIds.length - 1}
                              className="rounded p-0.5 text-slate-400 hover:text-white disabled:opacity-30"
                            >
                              <ChevronDown size={14} />
                            </button>
                            <button
                              onClick={() => removeReviewer(id)}
                              className="rounded p-0.5 text-slate-400 hover:text-red-400"
                            >
                              <X size={14} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {tenantUsers && tenantUsers.length > 0 ? (
                  <div className="flex items-center gap-2">
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) addReviewerFromSelect(parseInt(e.target.value));
                      }}
                      className="flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
                    >
                      <option value="">Select reviewer...</option>
                      {tenantUsers
                        .filter(u => !reviewerIds.includes(u.user_id || u.user?.id))
                        .map(tu => (
                          <option key={tu.user_id || tu.user?.id} value={tu.user_id || tu.user?.id}>
                            {tu.user?.display_name || tu.user?.username} ({tu.user?.email})
                          </option>
                        ))}
                    </select>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={newReviewerId}
                      onChange={(e) => setNewReviewerId(e.target.value)}
                      placeholder="Enter user ID..."
                      className="flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white placeholder-slate-500 focus:border-primary-500 focus:outline-none"
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addReviewer(); } }}
                    />
                    <button
                      onClick={addReviewer}
                      className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-white hover:bg-slate-600 transition-colors"
                    >
                      <Plus size={16} />
                    </button>
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-700 px-6 py-4">
              <button
                onClick={closeModal}
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateWorkflow}
                disabled={selectedEvidenceIds.length === 0 || reviewerIds.length === 0 || createWorkflowMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {createWorkflowMutation.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Send size={14} />
                )}
                Create Workflow
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}