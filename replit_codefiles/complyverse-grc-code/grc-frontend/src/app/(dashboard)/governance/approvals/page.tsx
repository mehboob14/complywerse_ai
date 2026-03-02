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

const DOC_TYPE_STYLES: Record<string, { label: string; style: { color: string; backgroundColor: string } }> = {
  policy: { label: 'Policy', style: { color: 'var(--color-base)', backgroundColor: 'rgba(28, 43, 58, 0.08)' } },
  procedure: { label: 'Procedure', style: { color: 'var(--color-success)', backgroundColor: 'rgba(45, 106, 79, 0.1)' } },
  standard: { label: 'Standard', style: { color: 'var(--color-base)', backgroundColor: 'rgba(28, 43, 58, 0.06)' } },
  guideline: { label: 'Guideline', style: { color: 'var(--color-warning)', backgroundColor: 'rgba(146, 87, 14, 0.1)' } },
  template: { label: 'Template', style: { color: 'var(--color-base)', backgroundColor: 'rgba(28, 43, 58, 0.08)' } },
  charter: { label: 'Charter', style: { color: 'var(--color-warning)', backgroundColor: 'rgba(146, 87, 14, 0.1)' } },
  framework: { label: 'Framework', style: { color: 'var(--color-danger)', backgroundColor: 'rgba(155, 28, 28, 0.1)' } },
  other: { label: 'Other', style: { color: 'var(--color-muted)', backgroundColor: 'var(--color-subtle)' } },
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
      <div className="w-full max-w-md rounded-xl p-6" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h3>
          <button onClick={onClose} style={{ color: 'var(--color-muted)' }}>
            <X size={20} />
          </button>
        </div>

        <p className="mb-4 text-sm" style={{ color: 'var(--color-text)' }}>
          {actionType === 'approve'
            ? `You are about to approve "${documentTitle}".`
            : `You are about to reject "${documentTitle}". Please provide a reason.`}
        </p>

        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Comments {actionType === 'reject' && <span style={{ color: 'var(--color-danger)' }}>*</span>}
          </label>
          <textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            placeholder={actionType === 'approve' ? 'Optional comments...' : 'Reason for rejection...'}
            className="h-24 w-full rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary-500"
            style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          />
          {actionType === 'reject' && !comments.trim() && (
            <p className="mt-1 text-xs" style={{ color: 'var(--color-danger)' }}>Comments are required when rejecting</p>
          )}
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="rounded-lg px-4 py-2 font-medium disabled:opacity-50"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
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
      <div className="w-full max-w-md rounded-xl p-6" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Delegate Approval</h3>
          <button onClick={onClose} style={{ color: 'var(--color-muted)' }}>
            <X size={20} />
          </button>
        </div>

        <p className="mb-4 text-sm" style={{ color: 'var(--color-text)' }}>
          Forward the approval of &quot;{documentTitle}&quot; to another user.
        </p>

        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>
            Delegate to User ID <span style={{ color: 'var(--color-danger)' }}>*</span>
          </label>
          <input
            type="number"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="Enter user ID..."
            className="w-full rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary-500"
            style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          />
        </div>

        <div className="mb-4">
          <label className="mb-1 block text-sm font-medium" style={{ color: 'var(--color-text)' }}>Reason</label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Optional reason for delegation..."
            className="h-20 w-full rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary-500"
            style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          />
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="rounded-lg px-4 py-2 font-medium disabled:opacity-50"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
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
      <div className="w-full max-w-2xl rounded-xl p-6 max-h-[90vh] overflow-y-auto" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h3 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>{item.document_title}</h3>
            <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>{item.document_code}</p>
          </div>
          <button onClick={onClose} style={{ color: 'var(--color-muted)' }}>
            <X size={20} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="rounded-lg p-4" style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}>
            <p className="text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Document Type</p>
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium" style={docTypeStyle.style}>
              {docTypeStyle.label}
            </span>
          </div>
          <div className="rounded-lg p-4" style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}>
            <p className="text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Owner</p>
            <div className="flex items-center gap-2">
              <User size={14} style={{ color: 'var(--color-muted)' }} />
              <span className="text-sm" style={{ color: 'var(--color-text)' }}>{item.owner_name || 'Unknown'}</span>
            </div>
          </div>
          <div className="rounded-lg p-4" style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}>
            <p className="text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Requested</p>
            <div className="flex items-center gap-2">
              <Calendar size={14} style={{ color: 'var(--color-muted)' }} />
              <span className="text-sm" style={{ color: 'var(--color-text)' }}>{formatDateTime(item.requested_at)}</span>
            </div>
          </div>
          <div className="rounded-lg p-4" style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}>
            <p className="text-xs mb-1" style={{ color: 'var(--color-muted)' }}>Due Date</p>
            <div className="flex items-center gap-2">
              {item.is_overdue ? (
                <AlertTriangle size={14} style={{ color: 'var(--color-danger)' }} />
              ) : (
                <Clock size={14} style={{ color: 'var(--color-muted)' }} />
              )}
              <span className="text-sm" style={{ color: item.is_overdue ? 'var(--color-danger)' : 'var(--color-text)' }}>
                {formatDate(item.due_date)}
                {item.is_overdue && ' (Overdue)'}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-lg p-4 mb-6" style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}>
          <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>Approval Step</p>
          <p className="text-sm" style={{ color: 'var(--color-text)' }}>{item.step_name}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Step {item.step_sequence}</p>
        </div>

        <div className="flex justify-end gap-3 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
          <button
            onClick={onDelegate}
            className="flex items-center gap-2 rounded-lg px-4 py-2 font-medium"
            style={{ border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
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
          <AlertTriangle className="mx-auto h-12 w-12" style={{ color: 'var(--color-danger)' }} />
          <h3 className="mt-4 text-lg font-medium" style={{ color: 'var(--color-text)' }}>Error loading approvals</h3>
          <p className="mt-2 text-sm" style={{ color: 'var(--color-muted)' }}>Please try again later</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>My Approvals</h2>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Documents waiting for your approval</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium" style={{ backgroundColor: 'rgba(146, 87, 14, 0.1)', color: 'var(--color-warning)' }}>
            <Clock size={14} />
            {items.length} Pending
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--color-muted)' }} />
          <input
            type="text"
            placeholder="Search documents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg py-2 pl-10 pr-4 focus:outline-none focus:ring-1 focus:ring-primary-500"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={16} style={{ color: 'var(--color-muted)' }} />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded-lg px-3 py-2 text-sm focus:outline-none"
            style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
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
        <div className="rounded-xl p-12 text-center" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <FileText className="mx-auto h-12 w-12" style={{ color: 'var(--color-muted)' }} />
          <h3 className="mt-4 text-lg font-medium" style={{ color: 'var(--color-text)' }}>No pending approvals</h3>
          <p className="mt-2 text-sm" style={{ color: 'var(--color-muted)' }}>
            {searchQuery
              ? 'No documents match your search criteria'
              : 'You have no documents waiting for your approval'}
          </p>
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ backgroundColor: 'var(--color-subtle)', borderBottom: '1px solid var(--color-border)' }}>
                  <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                    Document
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                    Type
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                    Owner
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                    Requested
                  </th>
                  <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                    Due Date
                  </th>
                  <th className="px-6 py-4 text-right text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item: PendingApprovalItem, idx: number) => {
                  const docTypeStyle = getDocTypeStyle(item.doc_type);
                  return (
                    <tr
                      key={item.step_id}
                      className="cursor-pointer transition-colors"
                      onClick={() => handleRowClick(item)}
                      style={{ borderBottom: idx < filteredItems.length - 1 ? '1px solid var(--color-border)' : undefined }}
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
                            <FileText className="h-5 w-5 text-primary-400" />
                          </div>
                          <div>
                            <p className="font-medium" style={{ color: 'var(--color-text)' }}>{item.document_title}</p>
                            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{item.document_code || `Step ${item.step_sequence}`}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium" style={docTypeStyle.style}>
                          {docTypeStyle.label}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm" style={{ color: 'var(--color-text)' }}>{item.owner_name || '-'}</span>
                      </td>
                      <td className="px-6 py-4">
                        <span className="text-sm" style={{ color: 'var(--color-text)' }}>{formatDate(item.requested_at)}</span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          {item.is_overdue && (
                            <AlertTriangle size={14} style={{ color: 'var(--color-danger)' }} />
                          )}
                          <span className="text-sm" style={{ color: item.is_overdue ? 'var(--color-danger)' : 'var(--color-text)', fontWeight: item.is_overdue ? 500 : undefined }}>
                            {formatDate(item.due_date)}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => handleDelegate(item)}
                            className="rounded-lg p-2 transition-colors"
                            title="Delegate"
                            style={{ color: 'var(--color-muted)' }}
                          >
                            <Forward size={16} />
                          </button>
                          <button
                            onClick={() => handleReject(item)}
                            className="rounded-lg p-2 transition-colors"
                            title="Reject"
                            style={{ color: 'var(--color-danger)' }}
                          >
                            <XCircle size={16} />
                          </button>
                          <button
                            onClick={() => handleApprove(item)}
                            className="rounded-lg p-2 transition-colors"
                            title="Approve"
                            style={{ color: 'var(--color-success)' }}
                          >
                            <CheckCircle size={16} />
                          </button>
                          <ChevronRight size={16} style={{ color: 'var(--color-muted)' }} />
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
