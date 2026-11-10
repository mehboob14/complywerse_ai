'use client';

import { AlertTriangle, CheckCircle, Clock, MessageSquare, UserCheck, XCircle } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { workflowEngineApi } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { parseUtc } from '@/lib/serverTime';
import { ErrorState, useNotify } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';

type ApprovalRequest = {
  id: number;
  workflow_instance_id: number;
  node_key: string;
  approver_user_id?: number;
  status: string;
  requested_at: string;
  decided_at?: string;
  due_at?: string;
  comment?: string;
  workflow_name?: string;
  step_name?: string;
  requested_by?: string;
};

function formatDate(iso: string): string {
  return formatDateTime(iso);
}

function isOverdue(due: string): boolean {
  const at = parseUtc(due);
  return !!at && at.getTime() < Date.now();
}

type Filter = 'pending' | 'mine' | 'all';

export function ApprovalsTab() {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const notify = useNotify();
  const [error, setError] = useState<{ message: string; retry: boolean } | null>(null);
  const [filter, setFilter] = useState<Filter>('pending');
  const [deciding, setDeciding] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [commentFor, setCommentFor] = useState<{ id: number; action: 'approved' | 'rejected' } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const inbox = await workflowEngineApi.executions.inbox();
      const items = (inbox.data?.items ?? inbox.data ?? []) as ApprovalRequest[];
      const mapped: ApprovalRequest[] = (Array.isArray(items) ? items : []).map((a: any) => ({
        id: a.id,
        workflow_instance_id: a.workflow_instance_id,
        node_key: a.step_name || '',
        approver_user_id: a.approver_user_id,
        status: a.status,
        requested_at: a.requested_at || a.created_at,
        due_at: a.due_at,
        workflow_name: a.workflow_name,
        step_name: a.step_name,
      }));
      setApprovals(mapped);
    } catch (e) {
      setApprovals([]);
      setError({ message: errorMessage(e, 'The approvals could not be loaded.'), retry: canRetry(e) });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const decide = async (approvalId: number, decision: 'approved' | 'rejected', msg: string) => {
    setDeciding(approvalId);
    try {
      await workflowEngineApi.executions.decideApproval(approvalId, {
        decision: decision === 'approved' ? 'approve' : 'reject',
        comment: msg,
      });
      notify.success(decision === 'approved' ? 'Approved' : 'Rejected');
      await load();
    } catch (e) {
      notify.error(e, { title: decision === 'approved' ? "The approval wasn't recorded" : "The rejection wasn't recorded", fallback: 'Nothing was changed. Try again.' });
    } finally {
      setDeciding(null);
      setCommentFor(null);
      setComment('');
    }
  };

  const filtered = approvals.filter((a) => {
    if (filter === 'pending') return a.status === 'pending';
    return true;
  });

  return (
    <div className="flex flex-col h-full">
      {/* Filter bar */}
      <div className="flex items-center gap-3 px-5 py-3 bg-white border-b border-gray-200 shrink-0">
        <div className="flex gap-1">
          {([
            { key: 'pending', label: 'Pending' },
            { key: 'all', label: 'All' },
          ] as { key: Filter; label: string }[]).map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors ${
                filter === f.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <span className="text-xs text-gray-500">
          {approvals.filter(a => a.status === 'pending').length} pending approvals
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {loading ? (
          <div role="status" className="text-center py-16 text-xs text-gray-500">Loading approvals...</div>
        ) : error ? (
          <ErrorState title="Couldn't load the approvals" message={error.message} onRetry={error.retry ? () => { void load(); } : undefined} />
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-xs text-gray-400">
            <UserCheck size={32} className="mx-auto mb-3 text-gray-200" />
            <p className="text-[13px] font-medium">No {filter === 'pending' ? 'pending' : ''} approvals</p>
            <p className="text-[12px] text-gray-500 mt-1">Workflow approval requests will appear here</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((a) => (
              <div
                key={a.id}
                className={`bg-white rounded-xl border shadow-sm p-4 ${
                  a.due_at && isOverdue(a.due_at) && a.status === 'pending'
                    ? 'border-red-200'
                    : 'border-gray-200'
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-bold text-gray-800 truncate">
                        {a.workflow_name || `Approval #${a.id}`}
                      </span>
                      {a.status === 'pending' ? (
                        <span className="text-[12px] bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full font-semibold shrink-0">
                          Pending
                        </span>
                      ) : a.status === 'approved' ? (
                        <span className="text-[12px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-semibold shrink-0">
                          Approved
                        </span>
                      ) : (
                        <span className="text-[12px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-semibold shrink-0">
                          Rejected
                        </span>
                      )}
                      {a.due_at && isOverdue(a.due_at) && a.status === 'pending' && (
                        <span className="flex items-center gap-1 text-[12px] bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-semibold shrink-0">
                          <AlertTriangle size={9} />
                          Overdue
                        </span>
                      )}
                    </div>
                    <div className="text-[12px] text-gray-500 space-y-0.5">
                      {a.step_name && <p className="text-[12px]">Step: <span className="text-gray-700 font-medium">{a.step_name}</span></p>}
                      {a.requested_by && <p className="text-[12px]">Requested by: <span className="text-gray-700">{a.requested_by}</span></p>}
                      <p className="flex items-center gap-1 text-[12px]">
                        <Clock size={12} />
                        Requested: {formatDate(a.requested_at)}
                      </p>
                      {a.due_at && (
                        <p className={`flex items-center gap-1 text-[12px] ${isOverdue(a.due_at) ? 'text-red-500 font-semibold' : ''}`}>
                          <Clock size={12} />
                          Due: {formatDate(a.due_at)}
                        </p>
                      )}
                      {a.comment && (
                        <p className="flex items-center gap-1 text-[12px] italic">
                          <MessageSquare size={12} />
                          &ldquo;{a.comment}&rdquo;
                        </p>
                      )}
                    </div>
                  </div>

                  {a.status === 'pending' && (
                    <div className="flex flex-col gap-2 shrink-0">
                      {commentFor?.id === a.id ? (
                        <div className="flex flex-col gap-2 w-56">
                          <textarea
                            className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none h-16"
                            placeholder="Optional comment..."
                            value={comment}
                            onChange={(e) => setComment(e.target.value)}
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={() => decide(a.id, commentFor.action, comment)}
                              disabled={deciding === a.id}
                              className={`flex-1 text-[12px] font-bold py-1.5 rounded-lg transition-colors ${
                                commentFor.action === 'approved'
                                  ? 'bg-green-600 hover:bg-green-700 text-white'
                                  : 'bg-red-600 hover:bg-red-700 text-white'
                              }`}
                            >
                              {deciding === a.id ? '...' : commentFor.action === 'approved' ? 'Confirm Approve' : 'Confirm Reject'}
                            </button>
                            <button
                              onClick={() => { setCommentFor(null); setComment(''); }}
                              className="text-[12px] px-2 py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600"
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <button
                            onClick={() => setCommentFor({ id: a.id, action: 'approved' })}
                            className="flex items-center gap-1.5 text-[12px] font-semibold bg-green-50 hover:bg-green-100 border border-green-300 text-green-700 px-3 py-1.5 rounded-lg transition-colors"
                          >
                            <CheckCircle size={12} />
                            Approve
                          </button>
                          <button
                            onClick={() => setCommentFor({ id: a.id, action: 'rejected' })}
                            className="flex items-center gap-1.5 text-[12px] font-semibold bg-red-50 hover:bg-red-100 border border-red-300 text-red-700 px-3 py-1.5 rounded-lg transition-colors"
                          >
                            <XCircle size={12} />
                            Reject
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
