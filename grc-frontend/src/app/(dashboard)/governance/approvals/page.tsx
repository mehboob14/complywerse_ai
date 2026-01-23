'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { governanceApi } from '@/lib/api';
import { PendingApprovalItem } from '@/types';
import {
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  FileText,
  Loader2,
  X,
  Forward,
  Eye,
  Filter,
  Search,
  Calendar,
  User,
  ChevronRight,
} from 'lucide-react';

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';

const DOC_TYPE_STYLES: Record<string, { label: string; color: string; bgColor: string }> = {
  policy: { label: 'Policy', color: 'text-blue-400', bgColor: 'bg-blue-500/20' },
  procedure: { label: 'Procedure', color: 'text-green-400', bgColor: 'bg-green-500/20' },
  standard: { label: 'Standard', color: 'text-purple-400', bgColor: 'bg-purple-500/20' },
  guideline: { label: 'Guideline', color: 'text-yellow-400', bgColor: 'bg-yellow-500/20' },
  template: { label: 'Template', color: 'text-cyan-400', bgColor: 'bg-cyan-500/20' },
  charter: { label: 'Charter', color: 'text-amber-400', bgColor: 'bg-amber-500/20' },
  framework: { label: 'Framework', color: 'text-rose-400', bgColor: 'bg-rose-500/20' },
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

interface ActionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (comments: string) => void;
  title: string;
  documentTitle: string;
  actionType: 'approve' | 'reject';
  isLoading: boolean;
}

function ActionModal({ isOpen, onClose, onConfirm, title, documentTitle, actionType, isLoading }: ActionModalProps) {
  const [comments, setComments] = useState('');

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (actionType === 'reject' && !comments.trim()) {
      return;
    }
    onConfirm(comments);
    setComments('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <p className="mb-4 text-sm text-slate-300">
          {actionType === 'approve'
            ? `You are about to approve "${documentTitle}".`
            : `You are about to reject "${documentTitle}". Please provide a reason.`}
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

interface DelegateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (userId: number, reason: string) => void;
  documentTitle: string;
  isLoading: boolean;
}

function DelegateModal({ isOpen, onClose, onConfirm, documentTitle, isLoading }: DelegateModalProps) {
  const [userId, setUserId] = useState('');
  const [reason, setReason] = useState('');

  if (!isOpen) return null;

  const handleSubmit = () => {
    if (!userId) return;
    onConfirm(parseInt(userId), reason);
    setUserId('');
    setReason('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-800 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Delegate Approval</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <p className="mb-4 text-sm text-slate-300">
          Forward the approval of "{documentTitle}" to another user.
        </p>

        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-slate-300">
            Delegate to User ID <span className="text-red-400">*</span>
          </label>
          <input
            type="number"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="Enter user ID..."
            className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>

        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium text-slate-300">Reason</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Optional reason for delegation..."
            className="h-20 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
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
            disabled={isLoading || !userId}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {isLoading && <Loader2 size={16} className="animate-spin" />}
            Delegate
          </button>
        </div>
      </div>
    </div>
  );
}

interface DocumentPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: PendingApprovalItem | null;
  onApprove: () => void;
  onReject: () => void;
  onDelegate: () => void;
}

function DocumentPreviewModal({ isOpen, onClose, item, onApprove, onReject, onDelegate }: DocumentPreviewModalProps) {
  if (!isOpen || !item) return null;

  const docTypeStyle = getDocTypeStyle(item.doc_type);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-800 p-6 max-h-[90vh] overflow-y-auto">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h3 className="text-xl font-semibold text-white">{item.document_title}</h3>
            <p className="text-sm text-slate-400 mt-1">{item.document_code}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
            <p className="text-xs text-slate-400 mb-1">Document Type</p>
            <span className={`inline-flex items-center gap-1.5 rounded-full ${docTypeStyle.bgColor} px-2.5 py-1 text-xs font-medium ${docTypeStyle.color}`}>
              {docTypeStyle.label}
            </span>
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
            <p className="text-xs text-slate-400 mb-1">Owner</p>
            <div className="flex items-center gap-2">
              <User size={14} className="text-slate-400" />
              <span className="text-sm text-white">{item.owner_name || 'Unknown'}</span>
            </div>
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
            <p className="text-xs text-slate-400 mb-1">Requested</p>
            <div className="flex items-center gap-2">
              <Calendar size={14} className="text-slate-400" />
              <span className="text-sm text-white">{formatDateTime(item.requested_at)}</span>
            </div>
          </div>
          <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4">
            <p className="text-xs text-slate-400 mb-1">Due Date</p>
            <div className="flex items-center gap-2">
              {item.is_overdue ? (
                <AlertTriangle size={14} className="text-red-400" />
              ) : (
                <Clock size={14} className="text-slate-400" />
              )}
              <span className={`text-sm ${item.is_overdue ? 'text-red-400' : 'text-white'}`}>
                {formatDate(item.due_date)}
                {item.is_overdue && ' (Overdue)'}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-4 mb-6">
          <p className="text-xs text-slate-400 mb-2">Approval Step</p>
          <p className="text-sm text-white">{item.step_name}</p>
          <p className="text-xs text-slate-400 mt-1">Step {item.step_sequence}</p>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-slate-700">
          <button
            onClick={onDelegate}
            className="flex items-center gap-2 rounded-lg border border-slate-600 px-4 py-2 font-medium text-slate-300 hover:bg-slate-700"
          >
            <Forward size={16} />
            Delegate
          </button>
          <button
            onClick={onReject}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 font-medium text-white hover:bg-red-700"
          >
            <XCircle size={16} />
            Reject
          </button>
          <button
            onClick={onApprove}
            className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 font-medium text-white hover:bg-green-700"
          >
            <CheckCircle size={16} />
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ApprovalsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<PendingApprovalItem | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [actionModal, setActionModal] = useState<{
    isOpen: boolean;
    type: 'approve' | 'reject';
    item: PendingApprovalItem | null;
  }>({ isOpen: false, type: 'approve', item: null });
  const [delegateModal, setDelegateModal] = useState<{
    isOpen: boolean;
    item: PendingApprovalItem | null;
  }>({ isOpen: false, item: null });

  const { data: pendingApprovals, isLoading, error } = useQuery({
    queryKey: ['governance-pending-approvals', statusFilter],
    queryFn: async () => {
      const response = await governanceApi.getPendingApprovals({ include_delegated: true });
      return response.data;
    },
  });

  const approveMutation = useMutation({
    mutationFn: async ({ stepId, comments }: { stepId: number; comments: string }) => {
      return governanceApi.approveStep(stepId, comments);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['governance-pending-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['governance-dashboard'] });
      setActionModal({ isOpen: false, type: 'approve', item: null });
      setShowPreview(false);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ stepId, comments }: { stepId: number; comments: string }) => {
      return governanceApi.rejectStep(stepId, comments);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['governance-pending-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['governance-dashboard'] });
      setActionModal({ isOpen: false, type: 'reject', item: null });
      setShowPreview(false);
    },
  });

  const delegateMutation = useMutation({
    mutationFn: async ({ stepId, userId, reason }: { stepId: number; userId: number; reason: string }) => {
      return governanceApi.delegateStep(stepId, userId, reason);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['governance-pending-approvals'] });
      setDelegateModal({ isOpen: false, item: null });
      setShowPreview(false);
    },
  });

  const items = pendingApprovals?.items || [];

  const filteredItems = useMemo(() => {
    let result = items;
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (item: PendingApprovalItem) =>
          item.document_title.toLowerCase().includes(query) ||
          item.document_code?.toLowerCase().includes(query) ||
          item.doc_type.toLowerCase().includes(query)
      );
    }

    return result;
  }, [items, searchQuery]);

  const handleApprove = (item: PendingApprovalItem) => {
    setActionModal({ isOpen: true, type: 'approve', item });
  };

  const handleReject = (item: PendingApprovalItem) => {
    setActionModal({ isOpen: true, type: 'reject', item });
  };

  const handleDelegate = (item: PendingApprovalItem) => {
    setDelegateModal({ isOpen: true, item });
  };

  const handleRowClick = (item: PendingApprovalItem) => {
    setSelectedItem(item);
    setShowPreview(true);
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="mx-auto h-12 w-12 text-red-400" />
          <h3 className="mt-4 text-lg font-medium text-white">Error loading approvals</h3>
          <p className="mt-2 text-sm text-slate-400">Please try again later</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">My Approvals</h2>
          <p className="text-sm text-slate-400">Documents waiting for your approval</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/20 px-3 py-1 text-sm font-medium text-amber-400">
            <Clock size={14} />
            {items.length} Pending
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search documents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-800 py-2 pl-10 pr-4 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-slate-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-12 text-center">
          <FileText className="mx-auto h-12 w-12 text-slate-500" />
          <h3 className="mt-4 text-lg font-medium text-white">No pending approvals</h3>
          <p className="mt-2 text-sm text-slate-400">
            {searchQuery
              ? 'No documents match your search criteria'
              : 'You have no documents waiting for your approval'}
          </p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-700 bg-slate-900/50">
                  <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    Document
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    Type
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    Owner
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    Requested
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-slate-400">
                    Due Date
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-medium uppercase tracking-wider text-slate-400">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {filteredItems.map((item: PendingApprovalItem) => {
                  const docTypeStyle = getDocTypeStyle(item.doc_type);
                  return (
                    <tr
                      key={item.step_id}
                      className="hover:bg-slate-700/50 cursor-pointer transition-colors"
                      onClick={() => handleRowClick(item)}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="rounded-lg bg-primary-500/20 p-2">
                            <FileText className="h-5 w-5 text-primary-400" />
                          </div>
                          <div>
                            <p className="font-medium text-white">{item.document_title}</p>
                            <p className="text-xs text-slate-400">{item.document_code || `Step ${item.step_sequence}`}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center rounded-full ${docTypeStyle.bgColor} px-2.5 py-1 text-xs font-medium ${docTypeStyle.color}`}>
                          {docTypeStyle.label}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-slate-300">{item.owner_name || '-'}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm text-slate-300">{formatDate(item.requested_at)}</span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          {item.is_overdue && (
                            <AlertTriangle size={14} className="text-red-400" />
                          )}
                          <span className={`text-sm ${item.is_overdue ? 'text-red-400 font-medium' : 'text-slate-300'}`}>
                            {formatDate(item.due_date)}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => handleDelegate(item)}
                            className="rounded-lg p-2 text-slate-400 hover:bg-slate-700 hover:text-white transition-colors"
                            title="Delegate"
                          >
                            <Forward size={16} />
                          </button>
                          <button
                            onClick={() => handleReject(item)}
                            className="rounded-lg p-2 text-red-400 hover:bg-red-500/20 transition-colors"
                            title="Reject"
                          >
                            <XCircle size={16} />
                          </button>
                          <button
                            onClick={() => handleApprove(item)}
                            className="rounded-lg p-2 text-green-400 hover:bg-green-500/20 transition-colors"
                            title="Approve"
                          >
                            <CheckCircle size={16} />
                          </button>
                          <ChevronRight size={16} className="text-slate-500" />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ActionModal
        isOpen={actionModal.isOpen}
        onClose={() => setActionModal({ isOpen: false, type: 'approve', item: null })}
        onConfirm={(comments) => {
          if (actionModal.item) {
            if (actionModal.type === 'approve') {
              approveMutation.mutate({ stepId: actionModal.item.step_id, comments });
            } else {
              rejectMutation.mutate({ stepId: actionModal.item.step_id, comments });
            }
          }
        }}
        title={actionModal.type === 'approve' ? 'Approve Document' : 'Reject Document'}
        documentTitle={actionModal.item?.document_title || ''}
        actionType={actionModal.type}
        isLoading={approveMutation.isPending || rejectMutation.isPending}
      />

      <DelegateModal
        isOpen={delegateModal.isOpen}
        onClose={() => setDelegateModal({ isOpen: false, item: null })}
        onConfirm={(userId, reason) => {
          if (delegateModal.item) {
            delegateMutation.mutate({ stepId: delegateModal.item.step_id, userId, reason });
          }
        }}
        documentTitle={delegateModal.item?.document_title || ''}
        isLoading={delegateMutation.isPending}
      />

      <DocumentPreviewModal
        isOpen={showPreview}
        onClose={() => {
          setShowPreview(false);
          setSelectedItem(null);
        }}
        item={selectedItem}
        onApprove={() => {
          if (selectedItem) {
            setShowPreview(false);
            handleApprove(selectedItem);
          }
        }}
        onReject={() => {
          if (selectedItem) {
            setShowPreview(false);
            handleReject(selectedItem);
          }
        }}
        onDelegate={() => {
          if (selectedItem) {
            setShowPreview(false);
            handleDelegate(selectedItem);
          }
        }}
      />
    </div>
  );
}
