'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { governanceApi } from '@/lib/api';
import { GovernanceActionReviewItem } from '@/types';
import { SearchInput, MultiSelectDropdown, RightSlidePanel } from '@/components/ui';
import {
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  FileText,
  Loader2,
  Forward,
  Eye,
  Calendar,
  User,
  ChevronRight,
} from 'lucide-react';

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';

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

  const handleSubmit = () => {
    if (actionType === 'reject' && !comments.trim()) {
      return;
    }
    onConfirm(comments);
    setComments('');
  };

  return (
    <RightSlidePanel
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      width="w-full max-w-md"
      footer={
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="rounded-lg border border-gray-300 px-4 py-2 font-medium text-gray-800 hover:bg-gray-100 disabled:opacity-50"
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
      }
    >
      <p className="mb-4 text-sm text-gray-800">
        {actionType === 'approve'
          ? `You are about to approve "${documentTitle}".`
          : `You are about to reject "${documentTitle}". Please provide a reason.`}
      </p>

      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium text-gray-800">
          Comments {actionType === 'reject' && <span className="text-red-400">*</span>}
        </label>
        <textarea
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          placeholder={actionType === 'approve' ? 'Optional comments...' : 'Reason for rejection...'}
          className="h-24 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-black placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
        {actionType === 'reject' && !comments.trim() && (
          <p className="mt-1 text-xs text-red-400">Comments are required when rejecting</p>
        )}
      </div>
    </RightSlidePanel>
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

  const handleSubmit = () => {
    if (!userId) return;
    onConfirm(parseInt(userId), reason);
    setUserId('');
    setReason('');
  };

  return (
    <RightSlidePanel
      isOpen={isOpen}
      onClose={onClose}
      title="Delegate Approval"
      width="w-full max-w-md"
      footer={
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="rounded-lg border border-gray-300 px-4 py-2 font-medium text-gray-800 hover:bg-gray-100 disabled:opacity-50"
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
      }
    >
      <p className="mb-4 text-sm text-gray-800">
        Forward the approval of &ldquo;{documentTitle}&rdquo; to another user.
      </p>

      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium text-gray-800">
          Delegate to User ID <span className="text-red-400">*</span>
        </label>
        <input
          type="number"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="Enter user ID..."
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-black placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
      </div>

      <div className="mb-4">
        <label className="mb-1 block text-sm font-medium text-gray-800">Reason</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Optional reason for delegation..."
          className="h-20 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-black placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
        />
      </div>
    </RightSlidePanel>
  );
}

interface DocumentPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  item: GovernanceActionReviewItem | null;
  onApprove: () => void;
  onReject: () => void;
  onDelegate: () => void;
}

function DocumentPreviewModal({ isOpen, onClose, item, onApprove, onReject, onDelegate }: DocumentPreviewModalProps) {
  if (!item) return null;

  return (
    <RightSlidePanel
      isOpen={isOpen}
      onClose={onClose}
      title={item.document_title || item.action_description}
      subtitle={item.document_code || `Action #${item.id}`}
      width="w-full max-w-2xl"
      footer={
        <div className="flex justify-end gap-3">
          <button
            onClick={onDelegate}
            className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 font-medium text-gray-800 hover:bg-gray-100"
            disabled
            title="Delegation not available for action reviews"
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
      }
    >
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="rounded-lg border border-gray-300 bg-white/50 p-4">
          <p className="text-xs text-gray-600 mb-1">Action Type</p>
          <span className="text-sm text-black capitalize">{item.action_type.replace(/_/g, ' ')}</span>
        </div>
        <div className="rounded-lg border border-gray-300 bg-white/50 p-4">
          <p className="text-xs text-gray-600 mb-1">Submitted By</p>
          <div className="flex items-center gap-2">
            <User size={14} className="text-gray-600" />
            <span className="text-sm text-black">{item.action_user_name || 'Unknown'}</span>
          </div>
        </div>
        <div className="rounded-lg border border-gray-300 bg-white/50 p-4">
          <p className="text-xs text-gray-600 mb-1">Submitted At</p>
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-gray-600" />
            <span className="text-sm text-black">{formatDateTime(item.action_date)}</span>
          </div>
        </div>
        <div className="rounded-lg border border-gray-300 bg-white/50 p-4">
          <p className="text-xs text-gray-600 mb-1">Status</p>
          <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
            item.review_status === 'pending_review' ? 'bg-amber-500/20 text-amber-400' :
            item.review_status === 'approved' ? 'bg-green-500/20 text-green-400' :
            item.review_status === 'rejected' ? 'bg-red-500/20 text-red-400' :
            'bg-gray-500/20 text-gray-400'
          }`}>
            {item.review_status.replace(/_/g, ' ').toUpperCase()}
          </span>
        </div>
      </div>

      <div className="rounded-lg border border-gray-300 bg-white/50 p-4 mb-6">
        <p className="text-xs text-gray-600 mb-2">Description</p>
        <p className="text-sm text-black">{item.action_description}</p>
      </div>
    </RightSlidePanel>
  );
}

export default function ApprovalsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<GovernanceActionReviewItem | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [actionModal, setActionModal] = useState<{
    isOpen: boolean;
    type: 'approve' | 'reject';
    item: GovernanceActionReviewItem | null;
  }>({ isOpen: false, type: 'approve', item: null });
  const [delegateModal, setDelegateModal] = useState<{
    isOpen: boolean;
    item: GovernanceActionReviewItem | null;
  }>({ isOpen: false, item: null });

  const { data: pendingApprovals, isLoading, error } = useQuery({
    queryKey: ['my-pending-approvals', statusFilter],
    queryFn: async () => {
      // Use the new endpoint that gets items needing approval by current user
      const response = await governanceApi.getMyPendingApprovals({});
      return response.data;
    },
    placeholderData: keepPreviousData,
  });

  const approveMutation = useMutation({
    mutationFn: async ({ reviewId, comments }: { reviewId: number; comments: string }) => {
      return governanceApi.updateGovernanceAction(reviewId, {
        review_status: 'approved',
        review_notes: comments
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-pending-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['governance-dashboard'] });
      setActionModal({ isOpen: false, type: 'approve', item: null });
      setShowPreview(false);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ reviewId, comments }: { reviewId: number; comments: string }) => {
      return governanceApi.updateGovernanceAction(reviewId, {
        review_status: 'rejected',
        review_notes: comments
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-pending-approvals'] });
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
      queryClient.invalidateQueries({ queryKey: ['my-pending-approvals'] });
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
        (item: GovernanceActionReviewItem) =>
          item.document_title?.toLowerCase().includes(query) ||
          item.document_code?.toLowerCase().includes(query) ||
          item.doc_type?.toLowerCase().includes(query) ||
          item.action_description.toLowerCase().includes(query)
      );
    }

    return result;
  }, [items, searchQuery]);

  const handleApprove = (item: GovernanceActionReviewItem) => {
    setActionModal({ isOpen: true, type: 'approve', item });
  };

  const handleReject = (item: GovernanceActionReviewItem) => {
    setActionModal({ isOpen: true, type: 'reject', item });
  };

  const handleDelegate = (item: GovernanceActionReviewItem) => {
    setDelegateModal({ isOpen: true, item });
  };

  const handleRowClick = (item: GovernanceActionReviewItem) => {
    setSelectedItem(item);
    setShowPreview(true);
  };

  if (error) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="text-center">
          <AlertTriangle className="mx-auto h-7 w-7 text-red-400" />
          <h3 className="mt-2 text-xs font-medium text-black">Error loading approvals</h3>
          <p className="mt-1 text-xs text-gray-600">Please try again later</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold text-black">My Approvals</h2>
          <p className="text-xs text-gray-600">Documents waiting for your approval</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">
            <Clock size={14} />
            {items.length} Pending
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex-1">
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search documents..."
            size="md"
          />
        </div>
        <div className="flex items-center gap-2">
          <MultiSelectDropdown
            title="Status"
            items={[
              { value: 'pending', label: 'Pending' },
              { value: 'approved', label: 'Approved' },
              { value: 'rejected', label: 'Rejected' },
              { value: 'all', label: 'All' },
            ]}
            selectedValues={[statusFilter]}
            onApply={(vals) => setStatusFilter((vals[0] as StatusFilter) || 'pending')}
            multiSelect={false}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Loader2 className="h-5 w-5 animate-spin text-primary-500" />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-lg border border-gray-300 bg-white/50 py-10 text-center">
          <FileText className="mx-auto h-7 w-7 text-gray-400" />
          <h3 className="mt-2 text-xs font-medium text-black">No pending approvals</h3>
          <p className="mt-2 text-sm text-gray-600">
            {searchQuery
              ? 'No documents match your search criteria'
              : 'You have no documents waiting for your approval'}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-300 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-slate-50">
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    Action
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    Type
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    Submitted By
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    Date
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    Status
                  </th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredItems.map((item: GovernanceActionReviewItem) => {
                  const actionDate = new Date(item.action_date);
                  const isRecent = (Date.now() - actionDate.getTime()) / (1000 * 60 * 60 * 24) < 7; // Less than 7 days
                  
                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-gray-100/50 cursor-pointer transition-colors"
                      onClick={() => handleRowClick(item)}
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="rounded bg-primary-500/10 p-1">
                            <FileText className="h-3.5 w-3.5 text-primary-500" />
                          </div>
                          <div>
                            <p className="text-xs font-medium text-black">{item.document_title || item.action_description}</p>
                            <p className="text-[10px] text-gray-500">{item.document_code || `Action #${item.id}`}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-xs text-gray-700 capitalize">
                          {item.action_type.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-xs text-gray-700">{item.action_user_name || 'Unknown'}</span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          {isRecent && <Clock size={12} className="text-amber-500" />}
                          <span className="text-xs text-gray-700">{formatDate(item.action_date)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium ${
                          item.review_status === 'pending_review' ? 'bg-amber-100 text-amber-700' :
                          item.review_status === 'approved' ? 'bg-green-100 text-green-700' :
                          item.review_status === 'rejected' ? 'bg-red-100 text-red-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {item.review_status.replace(/_/g, ' ').toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => handleRowClick(item)}
                            className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-black transition-colors"
                            title="View"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelegate(item)}
                            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-black transition-colors"
                            title="Delegate"
                            disabled
                          >
                            <Forward className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleReject(item)}
                            className="rounded p-1 text-red-500 hover:bg-red-50 transition-colors"
                            title="Reject"
                          >
                            <XCircle className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleApprove(item)}
                            className="rounded p-1 text-green-600 hover:bg-green-50 transition-colors"
                            title="Approve"
                          >
                            <CheckCircle className="h-4 w-4" />
                          </button>
                          <ChevronRight size={13} className="text-gray-400" />
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
              approveMutation.mutate({ reviewId: actionModal.item.id, comments });
            } else {
              rejectMutation.mutate({ reviewId: actionModal.item.id, comments });
            }
          }
        }}
        title={actionModal.type === 'approve' ? 'Approve Action' : 'Reject Action'}
        documentTitle={actionModal.item?.document_title || actionModal.item?.action_description || ''}
        actionType={actionModal.type}
        isLoading={approveMutation.isPending || rejectMutation.isPending}
      />

      <DelegateModal
        isOpen={delegateModal.isOpen}
        onClose={() => setDelegateModal({ isOpen: false, item: null })}
        onConfirm={(userId, reason) => {
          if (delegateModal.item) {
            delegateMutation.mutate({ stepId: delegateModal.item.id, userId, reason });
          }
        }}
        documentTitle={delegateModal.item?.document_title || delegateModal.item?.action_description || ''}
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
