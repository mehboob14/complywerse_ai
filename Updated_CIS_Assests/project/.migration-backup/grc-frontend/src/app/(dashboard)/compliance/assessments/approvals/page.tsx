'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import apiClient from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  ArrowLeft,
  FileText,
  Loader2,
  AlertCircle,
  CheckCircle,
  XCircle,
  RotateCcw,
  Clock,
  User,
  Calendar,
  Paperclip,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Send,
  ThumbsUp,
  ThumbsDown,
  ExternalLink,
} from 'lucide-react';

interface PendingApproval {
  id: number;
  assessment_item_id: number;
  evidence_id: number;
  source: 'compliance' | 'evidence';
  status: string;
  current_tier: number;
  submitted_at: string | null;
  created_at: string;
  assessment_item: {
    id: number;
    item_number: string;
    area_domain: string | null;
    control_description: string | null;
    assessment: {
      id: number;
      name: string;
      assessment_type: string;
    };
  } | null;
  evidence: {
    id: number;
    name: string;
    file_name: string;
    file_type: string;
    description: string | null;
    uploaded_at: string;
    uploader?: { full_name: string };
  };
  submitter?: { full_name: string };
  approval_history?: Array<{
    id: number;
    action: string;
    tier_number: number;
    comments: string | null;
    performed_at: string;
    performer?: { full_name: string };
  }>;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending_review: { bg: 'bg-amber-500/20', text: 'text-amber-400', label: 'Pending Review' },
  in_approval: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'In Approval' },
};

export default function PendingApprovalsPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('compliance:assessments:edit');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [actionType, setActionType] = useState<string | null>(null);
  const [comments, setComments] = useState('');
  const [processingId, setProcessingId] = useState<number | null>(null);

  const { data: pendingApprovals, isLoading, error } = useQuery<PendingApproval[]>({
    queryKey: ['pending-approvals'],
    queryFn: async () => {
      const [complianceResult, evidenceResult] = await Promise.allSettled([
        apiClient.get('/compliance/assessments/pending-approvals'),
        apiClient.get('/evidence-mgmt/items', { params: { status: 'pending_review', limit: 100, skip: 0 } }),
      ]);

      const complianceItems = complianceResult.status === 'fulfilled'
        ? ((complianceResult.value.data?.pending_approvals || complianceResult.value.data || []) as any[]).map((item: any) => ({
            id: item.id,
            assessment_item_id: item.assessment_item_id,
            evidence_id: item.evidence_id,
            source: 'compliance' as const,
            status: item.status,
            current_tier: item.current_tier,
            submitted_at: item.submitted_at,
            created_at: item.created_at,
            assessment_item: {
              id: item.assessment_id,
              item_number: item.item_number,
              area_domain: null,
              control_description: item.control_description,
              assessment: {
                id: item.assessment_id,
                name: item.assessment_name,
                assessment_type: '',
              },
            },
            evidence: {
              id: item.evidence_id,
              name: item.evidence_name,
              file_name: item.evidence_file_name,
              file_type: '',
              description: null,
              uploaded_at: item.submitted_at,
            },
          }))
        : [];

      const evidenceItems = evidenceResult.status === 'fulfilled'
        ? (((evidenceResult.value.data?.items || []) as any[]).map((item: any) => ({
            id: item.id,
            assessment_item_id: 0,
            evidence_id: item.id,
            source: 'evidence' as const,
            status: item.status,
            current_tier: 1,
            submitted_at: item.submitted_at || item.uploaded_at,
            created_at: item.uploaded_at || item.submitted_at || new Date().toISOString(),
            assessment_item: null,
            evidence: {
              id: item.id,
              name: item.name,
              file_name: item.file_name || 'No file',
              file_type: item.file_type || '',
              description: item.description || null,
              uploaded_at: item.uploaded_at,
              uploader: { full_name: item.uploader_name || 'Unknown' },
            },
            submitter: { full_name: item.uploader_name || 'Unknown' },
          })))
        : [];

      return [...evidenceItems, ...complianceItems];
    },
  });

  const approvalMutation = useMutation({
    mutationFn: async ({ approval, action, comments }: { approval: PendingApproval; action: string; comments: string }) => {
      if (approval.source === 'evidence') {
        const response = await apiClient.post(`/evidence-mgmt/lifecycle/${approval.evidence_id}/review`, {
          action: action === 'return' ? 'reject' : action,
          comments: comments || undefined,
        });
        return response.data;
      }

      const response = await apiClient.post(`/compliance/assessments/evidence/${approval.id}/approval`, {
        action,
        comments: comments || undefined,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-approvals'] });
      queryClient.invalidateQueries({ queryKey: ['evidence-items'] });
      setProcessingId(null);
      setActionType(null);
      setComments('');
    },
    onError: () => {
      setProcessingId(null);
    },
  });

  const handleAction = (approval: PendingApproval, action: string) => {
    if (action === 'approve') {
      setProcessingId(approval.id);
      approvalMutation.mutate({ approval, action: 'approve', comments });
    } else {
      setExpandedId(approval.id);
      setActionType(action);
    }
  };

  const submitAction = (approval: PendingApproval) => {
    if (!actionType) return;
    setProcessingId(approval.id);
    approvalMutation.mutate({ approval, action: actionType, comments });
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-red-400">
        <AlertCircle className="mb-2 h-8 w-8" />
        <p>Failed to load pending approvals</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center gap-3">
        <Link
          href="/compliance/assessments"
          className="rounded-lg p-2 text-gray-600 hover:bg-gray-50 hover:text-black flex-shrink-0"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-semibold text-black tracking-tight">Pending Approvals</h1>
          <p className="mt-1 text-sm text-slate-600">
            Evidence submissions awaiting your review
          </p>
        </div>
      </div>

      {(!pendingApprovals || pendingApprovals.length === 0) ? (
        <div className="card p-12 text-center">
          <CheckCircle className="mx-auto h-12 w-12 text-emerald-600 mb-4" />
          <h3 className="text-lg font-semibold text-black mb-2">All Caught Up!</h3>
          <p className="text-gray-600">You have no pending approvals.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {pendingApprovals.map((approval) => {
            const statusStyle = STATUS_STYLES[approval.status] || STATUS_STYLES.pending_review;
            const isExpanded = expandedId === approval.id;
            
            return (
              <div key={approval.id} className="card">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <Paperclip className="h-5 w-5 text-blue-600" />
                      <h3 className="font-semibold text-black">{approval.evidence.name}</h3>
                      <span className={`badge ${statusStyle.bg} ${statusStyle.text}`}>
                        {statusStyle.label} (Tier {approval.current_tier})
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-gray-600 mb-1">Assessment</p>
                        {approval.assessment_item ? (
                          <Link 
                            href={`/compliance/assessments/${approval.assessment_item.assessment.id}`}
                            className="text-blue-600 hover:underline flex items-center gap-1"
                          >
                            {approval.assessment_item.assessment.name}
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        ) : (
                          <Link href={`/evidence/${approval.evidence.id}`} className="text-blue-600 hover:underline flex items-center gap-1">
                            Evidence Library
                            <ExternalLink className="h-3 w-3" />
                          </Link>
                        )}
                      </div>
                      <div>
                        <p className="text-gray-600 mb-1">Control/Requirement</p>
                        <p className="text-black text-xs line-clamp-2">
                          {approval.assessment_item ? (
                            <>
                              {approval.assessment_item.item_number && `${approval.assessment_item.item_number}: `}
                              {approval.assessment_item.control_description || 'N/A'}
                            </>
                          ) : (
                            <>Evidence submitted from the library for manual review</>
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-gray-600 mb-1">File</p>
                        <p className="text-black">{approval.evidence.file_name}</p>
                      </div>
                      <div>
                        <p className="text-gray-600 mb-1">Submitted</p>
                        <p className="text-black flex items-center gap-2">
                          <User className="h-4 w-4" />
                          {approval.submitter?.full_name || 'Unknown'} • {formatDate(approval.submitted_at)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    {canEdit && (
                    <button
                      onClick={() => handleAction(approval, 'approve')}
                      disabled={processingId === approval.id}
                      className="btn-primary flex items-center gap-2 text-sm"
                    >
                      {processingId === approval.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ThumbsUp className="h-4 w-4" />
                      )}
                      Approve
                    </button>
                    )}
                    {canEdit && (
                    <button
                      onClick={() => handleAction(approval, 'reject')}
                      className="btn-danger flex items-center gap-2 text-sm"
                    >
                      <ThumbsDown className="h-4 w-4" />
                      Reject
                    </button>
                    )}
                    {canEdit && (
                    <button
                      onClick={() => handleAction(approval, 'return')}
                      className="btn-secondary flex items-center gap-2 text-sm"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Return
                    </button>
                    )}
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : approval.id)}
                      className="btn-ghost text-sm flex items-center gap-1"
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      History
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div className="mt-4 pt-4 border-t border-gray-200">
                    {actionType && (
                      <div className="mb-4 p-4 bg-gray-50 rounded-lg">
                        <p className="text-sm text-gray-700 mb-2">
                          {actionType === 'reject' ? 'Reason for rejection:' : 'Comments for return:'}
                        </p>
                        <textarea
                          value={comments}
                          onChange={(e) => setComments(e.target.value)}
                          className="input w-full h-20 text-sm"
                          placeholder="Enter your comments..."
                          required={actionType === 'reject'}
                        />
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={() => submitAction(approval)}
                            disabled={processingId === approval.id || (actionType === 'reject' && !comments.trim())}
                            className="btn-primary flex items-center gap-2 text-sm"
                          >
                            {processingId === approval.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Send className="h-4 w-4" />
                            )}
                            Submit {actionType === 'reject' ? 'Rejection' : 'Return'}
                          </button>
                          <button
                            onClick={() => { setActionType(null); setComments(''); }}
                            className="btn-ghost text-sm"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {approval.approval_history && approval.approval_history.length > 0 ? (
                      <div>
                        <h4 className="text-sm font-medium text-gray-700 mb-3">Approval History</h4>
                        <div className="space-y-3">
                          {approval.approval_history.map((entry) => (
                            <div key={entry.id} className="flex items-start gap-3 text-sm">
                              <div className={`mt-1 h-2 w-2 rounded-full ${
                                entry.action === 'approved' ? 'bg-emerald-600' :
                                entry.action === 'rejected' ? 'bg-rose-600' :
                                entry.action === 'returned' ? 'bg-orange-600' :
                                'bg-blue-600'
                              }`} />
                              <div className="flex-1">
                                <p className="text-black">
                                  <span className="font-medium">{entry.performer?.full_name || 'Unknown'}</span>
                                  {' '}
                                  <span className="text-gray-600">
                                    {entry.action === 'submitted' ? 'submitted for review' :
                                     entry.action === 'approved' ? `approved at tier ${entry.tier_number}` :
                                     entry.action === 'rejected' ? 'rejected' :
                                     'returned for changes'}
                                  </span>
                                </p>
                                {entry.comments && (
                                  <p className="text-gray-600 mt-1 italic">"{entry.comments}"</p>
                                )}
                                <p className="text-gray-500 text-xs mt-1">{formatDate(entry.performed_at)}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-gray-600 text-sm">No approval history yet.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
