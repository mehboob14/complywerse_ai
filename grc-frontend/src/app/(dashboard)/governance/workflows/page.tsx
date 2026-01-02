'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { governanceApi } from '@/lib/api';
import { WorkflowDashboard, PendingApprovalItem } from '@/types';
import {
  FileCheck,
  Loader2,
  AlertCircle,
  Clock,
  CheckCircle,
  XCircle,
  AlertTriangle,
  X,
  FileText,
} from 'lucide-react';

type TabType = 'pending' | 'approved' | 'rejected' | 'all';

const DOC_TYPE_STYLES: Record<string, { label: string; color: string; bgColor: string }> = {
  policy: { label: 'Policy', color: 'text-blue-400', bgColor: 'bg-blue-500/20' },
  procedure: { label: 'Procedure', color: 'text-green-400', bgColor: 'bg-green-500/20' },
  standard: { label: 'Standard', color: 'text-purple-400', bgColor: 'bg-purple-500/20' },
  guideline: { label: 'Guideline', color: 'text-yellow-400', bgColor: 'bg-yellow-500/20' },
  template: { label: 'Template', color: 'text-cyan-400', bgColor: 'bg-cyan-500/20' },
  other: { label: 'Other', color: 'text-slate-400', bgColor: 'bg-slate-500/20' },
};

const getDocTypeStyle = (docType: string) => {
  return DOC_TYPE_STYLES[docType] || DOC_TYPE_STYLES.other;
};

const formatDate = (dateString?: string) => {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
};

const formatDateTime = (dateString?: string) => {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

interface ApprovalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (comments: string) => void;
  title: string;
  actionType: 'approve' | 'reject';
  isLoading: boolean;
}

function ApprovalModal({ isOpen, onClose, onConfirm, title, actionType, isLoading }: ApprovalModalProps) {
  const [comments, setComments] = useState('');

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (actionType === 'reject' && !comments.trim()) {
      return;
    }
    onConfirm(comments);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">
            {actionType === 'approve' ? 'Approve Document' : 'Reject Document'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <p className="mb-4 text-sm text-slate-300">
          {actionType === 'approve'
            ? `You are about to approve "${title}".`
            : `You are about to reject "${title}". Please provide a reason.`}
        </p>

        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-slate-300">
            Comments {actionType === 'reject' && <span className="text-red-400">*</span>}
          </label>
          <textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder={actionType === 'approve' ? 'Optional comments...' : 'Reason for rejection...'}
            className="h-24 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          {actionType === 'reject' && !comments.trim() && (
            <p className="mt-1 text-xs text-red-400">Comments are required when rejecting</p>
          )}
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="rounded-lg border border-slate-600 px-4 py-2 font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isLoading || (actionType === 'reject' && !comments.trim())}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 font-medium text-white disabled:opacity-50 ${
              actionType === 'approve'
                ? 'bg-green-600 hover:bg-green-700'
                : 'bg-red-600 hover:bg-red-700'
            }`}
          >
            {isLoading && <Loader2 size={16} className="animate-spin" />}
            {actionType === 'approve' ? 'Approve' : 'Reject'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function GovernanceWorkflowsPage() {
  const [activeTab, setActiveTab] = useState<TabType>('pending');
  const [modalState, setModalState] = useState<{
    isOpen: boolean;
    stepId: number | null;
    title: string;
    actionType: 'approve' | 'reject';
  }>({ isOpen: false, stepId: null, title: '', actionType: 'approve' });

  const queryClient = useQueryClient();

  const { data: dashboard, isLoading: dashboardLoading } = useQuery({
    queryKey: ['workflow-dashboard'],
    queryFn: async () => {
      const response = await governanceApi.getWorkflowDashboard();
      return response.data as WorkflowDashboard;
    },
  });

  const { data: pendingData, isLoading: pendingLoading } = useQuery({
    queryKey: ['pending-approvals'],
    queryFn: async () => {
      const response = await governanceApi.getPendingApprovals();
      return response.data as { items: PendingApprovalItem[]; total: number };
    },
  });

  const { data: overdueData } = useQuery({
    queryKey: ['overdue-approvals'],
    queryFn: async () => {
      const response = await governanceApi.getOverdueApprovals();
      return response.data as { items: PendingApprovalItem[]; total: number };
    },
  });

  const approveMutation = useMutation({
    mutationFn: ({ stepId, comments }: { stepId: number; comments: string }) =>
      governanceApi.approveStep(stepId, comments),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['pending-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['overdue-approvals'] });
      setModalState({ isOpen: false, stepId: null, title: '', actionType: 'approve' });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ stepId, comments }: { stepId: number; comments: string }) =>
      governanceApi.rejectStep(stepId, comments),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['pending-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['overdue-approvals'] });
      setModalState({ isOpen: false, stepId: null, title: '', actionType: 'reject' });
    },
  });

  const pendingApprovals = useMemo(() => {
    return pendingData?.items || [];
  }, [pendingData]);

  const overdueApprovals = useMemo(() => {
    return overdueData?.items || [];
  }, [overdueData]);

  const filteredApprovals = useMemo(() => {
    if (activeTab === 'pending') {
      return pendingApprovals.filter((item) => !item.is_overdue);
    }
    if (activeTab === 'approved' || activeTab === 'rejected') {
      return [];
    }
    return pendingApprovals;
  }, [activeTab, pendingApprovals]);

  const handleApprove = (stepId: number, title: string) => {
    setModalState({ isOpen: true, stepId, title, actionType: 'approve' });
  };

  const handleReject = (stepId: number, title: string) => {
    setModalState({ isOpen: true, stepId, title, actionType: 'reject' });
  };

  const handleConfirmAction = (comments: string) => {
    if (!modalState.stepId) return;

    if (modalState.actionType === 'approve') {
      approveMutation.mutate({ stepId: modalState.stepId, comments });
    } else {
      rejectMutation.mutate({ stepId: modalState.stepId, comments });
    }
  };

  const isLoading = dashboardLoading || pendingLoading;

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Approval Workflows</h1>
          <p className="mt-1 text-sm text-slate-400">
            Manage document approvals and review pending requests
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-yellow-500/20 p-2">
              <Clock className="h-5 w-5 text-yellow-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Pending Approvals</p>
              <p className="text-2xl font-bold text-white">{dashboard?.pending_my_approval || 0}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-500/20 p-2">
              <CheckCircle className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Approved Today</p>
              <p className="text-2xl font-bold text-white">{dashboard?.approved_today || 0}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-red-500/20 p-2">
              <XCircle className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Rejected Today</p>
              <p className="text-2xl font-bold text-white">{dashboard?.rejected_today || 0}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-orange-500/20 p-2">
              <AlertTriangle className="h-5 w-5 text-orange-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Overdue</p>
              <p className="text-2xl font-bold text-white">{dashboard?.overdue || 0}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800">
        <div className="border-b border-slate-700">
          <nav className="flex gap-1 p-2">
            {(['pending', 'approved', 'rejected', 'all'] as TabType[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? 'bg-primary-600 text-white'
                    : 'text-slate-400 hover:bg-slate-700 hover:text-white'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
                {tab === 'pending' && pendingApprovals.length > 0 && (
                  <span className="ml-2 rounded-full bg-yellow-500/20 px-2 py-0.5 text-xs text-yellow-400">
                    {pendingApprovals.length}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        <div className="p-4">
          {activeTab === 'approved' || activeTab === 'rejected' ? (
            <div className="flex h-48 flex-col items-center justify-center text-slate-400">
              <FileCheck className="mb-2 h-12 w-12 opacity-50" />
              <p className="text-lg font-medium">No {activeTab} items to display</p>
              <p className="text-sm">Historical {activeTab} approvals will appear here</p>
            </div>
          ) : (
            <>
              {activeTab === 'pending' && overdueApprovals.length > 0 && (
                <div className="mb-4">
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-red-400">
                    <AlertTriangle size={16} />
                    Overdue Approvals ({overdueApprovals.length})
                  </h3>
                  <div className="space-y-3">
                    {overdueApprovals.map((item) => (
                      <ApprovalCard
                        key={`overdue-${item.step_id}`}
                        item={item}
                        onApprove={handleApprove}
                        onReject={handleReject}
                        isOverdue
                      />
                    ))}
                  </div>
                </div>
              )}

              {(activeTab === 'pending' ? filteredApprovals : pendingApprovals).length > 0 ? (
                <div className="space-y-3">
                  {activeTab === 'pending' && overdueApprovals.length > 0 && filteredApprovals.length > 0 && (
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-slate-400">
                      <Clock size={16} />
                      Pending Approvals ({filteredApprovals.length})
                    </h3>
                  )}
                  {(activeTab === 'pending' ? filteredApprovals : pendingApprovals).map((item) => (
                    <ApprovalCard
                      key={item.step_id}
                      item={item}
                      onApprove={handleApprove}
                      onReject={handleReject}
                    />
                  ))}
                </div>
              ) : (
                activeTab !== 'pending' || (filteredApprovals.length === 0 && overdueApprovals.length === 0) ? (
                  <div className="flex h-48 flex-col items-center justify-center text-slate-400">
                    <FileCheck className="mb-2 h-12 w-12 opacity-50" />
                    <p className="text-lg font-medium">No pending approvals</p>
                    <p className="text-sm">All caught up! No documents awaiting your approval.</p>
                  </div>
                ) : null
              )}
            </>
          )}
        </div>
      </div>

      <ApprovalModal
        isOpen={modalState.isOpen}
        onClose={() => setModalState({ isOpen: false, stepId: null, title: '', actionType: 'approve' })}
        onConfirm={handleConfirmAction}
        title={modalState.title}
        actionType={modalState.actionType}
        isLoading={approveMutation.isPending || rejectMutation.isPending}
      />
    </div>
  );
}

interface ApprovalCardProps {
  item: PendingApprovalItem;
  onApprove: (stepId: number, title: string) => void;
  onReject: (stepId: number, title: string) => void;
  isOverdue?: boolean;
}

function ApprovalCard({ item, onApprove, onReject, isOverdue }: ApprovalCardProps) {
  const docTypeStyle = getDocTypeStyle(item.doc_type);

  return (
    <div
      className={`rounded-lg border p-4 ${
        isOverdue
          ? 'border-red-500/50 bg-red-500/5'
          : 'border-slate-700 bg-slate-800/50'
      }`}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-slate-400" />
            <h4 className="font-medium text-white">{item.document_title}</h4>
            {item.document_code && (
              <span className="text-sm text-slate-400">({item.document_code})</span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <span className={`rounded px-2 py-0.5 ${docTypeStyle.bgColor} ${docTypeStyle.color}`}>
              {docTypeStyle.label}
            </span>
            <span className="text-slate-400">
              Requested: {formatDateTime(item.requested_at)}
            </span>
            <span className={isOverdue || item.is_overdue ? 'text-red-400' : 'text-slate-400'}>
              Due: {formatDate(item.due_date)}
              {(isOverdue || item.is_overdue) && item.days_overdue && (
                <span className="ml-1 font-medium">
                  ({item.days_overdue} day{item.days_overdue > 1 ? 's' : ''} overdue)
                </span>
              )}
            </span>
          </div>
          <div className="mt-2 flex items-center gap-3 text-sm text-slate-400">
            <span>Requester: {item.owner_name || 'Unknown'}</span>
            <span>•</span>
            <span>Step: {item.step_name}</span>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => onReject(item.step_id, item.document_title)}
            className="rounded-lg border border-red-500/50 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/10"
          >
            Reject
          </button>
          <button
            onClick={() => onApprove(item.step_id, item.document_title)}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
          >
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}
