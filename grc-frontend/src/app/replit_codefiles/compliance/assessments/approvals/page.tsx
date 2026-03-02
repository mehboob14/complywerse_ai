'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import apiClient from '@/lib/api';
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
  };
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
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [actionType, setActionType] = useState<string | null>(null);
  const [comments, setComments] = useState('');
  const [processingId, setProcessingId] = useState<number | null>(null);

  const { data: pendingApprovals, isLoading, error } = useQuery<PendingApproval[]>({
    queryKey: ['pending-approvals'],
    queryFn: async () => {
      const response = await apiClient.get('/compliance/assessments/pending-approvals');
      const data = response.data?.pending_approvals || response.data || [];
      return Array.isArray(data) ? data.map((item: any) => ({
        id: item.id,
        assessment_item_id: item.assessment_item_id,
        evidence_id: item.evidence_id,
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
      })) : [];
    },
  });

  const approvalMutation = useMutation({
    mutationFn: async ({ evidenceLinkId, action, comments }: { evidenceLinkId: number; action: string; comments: string }) => {
      const response = await apiClient.post(`/compliance/assessments/evidence/${evidenceLinkId}/approval`, {
        action,
        comments: comments || undefined,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-approvals'] });
      setProcessingId(null);
      setActionType(null);
      setComments('');
    },
    onError: () => {
      setProcessingId(null);
    },
  });

  const handleAction = (id: number, action: string) => {
    if (action === 'approve') {
      setProcessingId(id);
      approvalMutation.mutate({ evidenceLinkId: id, action: 'approve', comments });
    } else {
      setExpandedId(id);
      setActionType(action);
    }
  };

  const submitAction = (id: number) => {
    if (!actionType) return;
    setProcessingId(id);
    approvalMutation.mutate({ evidenceLinkId: id, action: actionType, comments });
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
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/compliance/assessments"
          className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-white">Pending Approvals</h1>
          <p className="text-slate-400">
            Evidence submissions awaiting your review
          </p>
        </div>
      </div>

      {(!pendingApprovals || pendingApprovals.length === 0) ? (
        <div className="card p-12 text-center">
          <CheckCircle className="mx-auto h-12 w-12 text-emerald-400 mb-4" />
          <h3 className="text-lg font-semibold text-white mb-2">All Caught Up!</h3>
          <p className="text-slate-400">You have no pending evidence approvals.</p>
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
                      <Paperclip className="h-5 w-5 text-primary-400" />
                      <h3 className="font-semibold text-white">{approval.evidence.name}</h3>
                      <span className={`badge ${statusStyle.bg} ${statusStyle.text}`}>
                        {statusStyle.label} (Tier {approval.current_tier})
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-slate-400 mb-1">Assessment</p>
                        <Link 
                          href={`/compliance/assessments/${approval.assessment_item.assessment.id}`}
                          className="text-primary-400 hover:underline flex items-center gap-1"
                        >
                          {approval.assessment_item.assessment.name}
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </div>
                      <div>
                        <p className="text-slate-400 mb-1">Control/Requirement</p>
                        <p className="text-white text-xs line-clamp-2">
                          {approval.assessment_item.item_number && `${approval.assessment_item.item_number}: `}
                          {approval.assessment_item.control_description || 'N/A'}
                        </p>
                      </div>
                      <div>
                        <p className="text-slate-400 mb-1">File</p>
                        <p className="text-white">{approval.evidence.file_name}</p>
                      </div>
                      <div>
                        <p className="text-slate-400 mb-1">Submitted</p>
                        <p className="text-white flex items-center gap-2">
                          <User className="h-4 w-4" />
                          {approval.submitter?.full_name || 'Unknown'} • {formatDate(approval.submitted_at)}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2">
                    <button
                      onClick={() => handleAction(approval.id, 'approve')}
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
                    <button
                      onClick={() => handleAction(approval.id, 'reject')}
                      className="btn-danger flex items-center gap-2 text-sm"
                    >
                      <ThumbsDown className="h-4 w-4" />
                      Reject
                    </button>
                    <button
                      onClick={() => handleAction(approval.id, 'return')}
                      className="btn-secondary flex items-center gap-2 text-sm"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Return
                    </button>
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
                  <div className="mt-4 pt-4 border-t border-slate-700">
                    {actionType && (
                      <div className="mb-4 p-4 bg-slate-800/50 rounded-lg">
                        <p className="text-sm text-slate-300 mb-2">
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
                            onClick={() => submitAction(approval.id)}
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
                        <h4 className="text-sm font-medium text-slate-300 mb-3">Approval History</h4>
                        <div className="space-y-3">
                          {approval.approval_history.map((entry) => (
                            <div key={entry.id} className="flex items-start gap-3 text-sm">
                              <div className={`mt-1 h-2 w-2 rounded-full ${
                                entry.action === 'approved' ? 'bg-emerald-400' :
                                entry.action === 'rejected' ? 'bg-rose-400' :
                                entry.action === 'returned' ? 'bg-orange-400' :
                                'bg-blue-400'
                              }`} />
                              <div className="flex-1">
                                <p className="text-white">
                                  <span className="font-medium">{entry.performer?.full_name || 'Unknown'}</span>
                                  {' '}
                                  <span className="text-slate-400">
                                    {entry.action === 'submitted' ? 'submitted for review' :
                                     entry.action === 'approved' ? `approved at tier ${entry.tier_number}` :
                                     entry.action === 'rejected' ? 'rejected' :
                                     'returned for changes'}
                                  </span>
                                </p>
                                {entry.comments && (
                                  <p className="text-slate-400 mt-1 italic">"{entry.comments}"</p>
                                )}
                                <p className="text-slate-500 text-xs mt-1">{formatDate(entry.performed_at)}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-slate-400 text-sm">No approval history yet.</p>
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
