'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { integrationsApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  AlertTriangle,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  Shield,
  ExternalLink,
  Filter,
} from 'lucide-react';

interface ExceptionRequest {
  id: number;
  vulnerability_id: number;
  connection_id: number;
  exception_type: string;
  reason: string;
  justification: string;
  status: string;
  requested_by_user_id: number;
  reviewed_by_user_id: number | null;
  reviewed_at: string | null;
  push_status: string | null;
  nexpose_exception_id: string | null;
  expires_at: string | null;
  created_at: string;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  pending_approval: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Pending Approval' },
  approved: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Approved' },
  rejected: { bg: 'bg-rose-50', text: 'text-rose-700', label: 'Rejected' },
  revoked: { bg: 'bg-slate-50', text: 'text-slate-700', label: 'Revoked' },
  withdrawn: { bg: 'bg-slate-50', text: 'text-slate-500', label: 'Withdrawn' },
};

const TYPE_LABELS: Record<string, string> = {
  false_positive: 'False Positive',
  risk_accepted: 'Risk Accepted',
  deferred: 'Deferred',
};

const REASON_LABELS: Record<string, string> = {
  compensating_control: 'Compensating Control',
  not_applicable: 'Not Applicable',
  accepted_risk: 'Accepted Risk',
  false_positive_confirmed: 'False Positive Confirmed',
  deferred_to_next_cycle: 'Deferred to Next Cycle',
  other: 'Other',
};

export default function ExceptionsPage() {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('integrations:exceptions:edit');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [reviewNotes, setReviewNotes] = useState<Record<number, string>>({});
  const [selectedDetail, setSelectedDetail] = useState<number | null>(null);

  const { data: exceptionsData, isLoading, isError } = useQuery({
    queryKey: ['exceptions', statusFilter],
    queryFn: () => integrationsApi.listExceptions({ status: statusFilter || undefined }),
  });

  const exceptions: ExceptionRequest[] = exceptionsData?.data?.records || [];
  const total: number = exceptionsData?.data?.total || 0;

  const { data: detailData } = useQuery({
    queryKey: ['exception-detail', selectedDetail],
    queryFn: () => integrationsApi.getException(selectedDetail!),
    enabled: !!selectedDetail,
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, notes }: { id: number; notes: string }) =>
      integrationsApi.approveException(id, { review_notes: notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exceptions'] });
      queryClient.invalidateQueries({ queryKey: ['exception-detail'] });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, notes }: { id: number; notes: string }) =>
      integrationsApi.rejectException(id, { review_notes: notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exceptions'] });
      queryClient.invalidateQueries({ queryKey: ['exception-detail'] });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      integrationsApi.revokeException(id, { revoke_reason: reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exceptions'] });
      queryClient.invalidateQueries({ queryKey: ['exception-detail'] });
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: (id: number) => integrationsApi.withdrawException(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exceptions'] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-primary-600" size={32} />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-500">
        <AlertTriangle size={32} className="text-rose-400 mb-2" strokeWidth={1.75} />
        <p className="text-sm">Failed to load exceptions. Please try again later.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900" style={{ fontFamily: 'Poppins, sans-serif' }}>
            Exception Requests
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Approval workflow for false positive, risk accepted, and deferred exceptions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-slate-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            <option value="">All Status</option>
            <option value="pending_approval">Pending Approval</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="revoked">Revoked</option>
            <option value="withdrawn">Withdrawn</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-amber-50 rounded-xl border border-amber-200 p-4 text-center">
          <div className="text-2xl font-bold text-amber-700">
            {exceptions.filter(e => e.status === 'pending_approval').length}
          </div>
          <div className="text-xs text-amber-600">Pending Review</div>
        </div>
        <div className="bg-emerald-50 rounded-xl border border-emerald-200 p-4 text-center">
          <div className="text-2xl font-bold text-emerald-700">
            {exceptions.filter(e => e.status === 'approved').length}
          </div>
          <div className="text-xs text-emerald-600">Approved</div>
        </div>
        <div className="bg-rose-50 rounded-xl border border-rose-200 p-4 text-center">
          <div className="text-2xl font-bold text-rose-700">
            {exceptions.filter(e => e.status === 'rejected').length}
          </div>
          <div className="text-xs text-rose-600">Rejected</div>
        </div>
      </div>

      <div className="space-y-3">
        {exceptions.map((exc) => {
          const statusStyle = STATUS_STYLES[exc.status] || STATUS_STYLES.pending_approval;
          return (
            <div key={exc.id} className="bg-white rounded-xl border border-slate-200 p-5">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                      {statusStyle.label}
                    </span>
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-xs text-slate-600">
                      {TYPE_LABELS[exc.exception_type] || exc.exception_type}
                    </span>
                    <span className="text-xs text-slate-400">#{exc.id}</span>
                  </div>
                  <div className="text-sm text-slate-700 mb-1">
                    <span className="font-medium">Vulnerability ID:</span> {exc.vulnerability_id}
                    <span className="mx-2 text-slate-300">|</span>
                    <span className="font-medium">Reason:</span> {REASON_LABELS[exc.reason] || exc.reason}
                  </div>
                  <p className="text-sm text-slate-500">{exc.justification}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                    <span>Requested: {new Date(exc.created_at).toLocaleDateString()}</span>
                    {exc.expires_at && <span>Expires: {new Date(exc.expires_at).toLocaleDateString()}</span>}
                    {exc.push_status && (
                      <span className={
                        exc.push_status === 'pushed' ? 'text-emerald-600' :
                        exc.push_status === 'local_only' ? 'text-amber-600' :
                        'text-rose-600'
                      }>
                        Push: {exc.push_status === 'pushed' ? 'Synced to Scanner' : exc.push_status === 'local_only' ? 'Local Only' : exc.push_status}
                      </span>
                    )}
                    {exc.nexpose_exception_id && (
                      <span className="text-primary-600 flex items-center gap-1">
                        <ExternalLink size={10} /> Nexpose: {exc.nexpose_exception_id}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {exc.status === 'pending_approval' && (
                <div className="mt-4 pt-3 border-t border-slate-100">
                  <div className="flex items-end gap-3">
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-slate-600 mb-1">Review Notes</label>
                      <input
                        type="text"
                        value={reviewNotes[exc.id] || ''}
                        onChange={(e) => setReviewNotes({ ...reviewNotes, [exc.id]: e.target.value })}
                        placeholder="Optional review notes..."
                        className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    </div>
                    <button
                      onClick={() => approveMutation.mutate({ id: exc.id, notes: reviewNotes[exc.id] || '' })}
                      disabled={approveMutation.isPending}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <CheckCircle size={16} /> Approve
                    </button>
                    <button
                      onClick={() => rejectMutation.mutate({ id: exc.id, notes: reviewNotes[exc.id] || '' })}
                      disabled={rejectMutation.isPending}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50"
                    >
                      <XCircle size={16} /> Reject
                    </button>
                  </div>
                </div>
              )}

              {exc.status === 'approved' && canEdit && (
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-end gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-slate-600 mb-1">Revoke Reason</label>
                    <input
                      type="text"
                      value={reviewNotes[exc.id] || ''}
                      onChange={(e) => setReviewNotes({ ...reviewNotes, [exc.id]: e.target.value })}
                      placeholder="Reason for revoking this exception..."
                      className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <button
                    onClick={() => revokeMutation.mutate({ id: exc.id, reason: reviewNotes[exc.id] || '' })}
                    disabled={revokeMutation.isPending}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-slate-600 rounded-lg hover:bg-slate-700 disabled:opacity-50"
                  >
                    <XCircle size={16} /> Revoke
                  </button>
                </div>
              )}

              {exc.status === 'pending_approval' && canEdit && (
                <div className="mt-2">
                  <button
                    onClick={() => withdrawMutation.mutate(exc.id)}
                    disabled={withdrawMutation.isPending}
                    className="text-xs text-slate-500 hover:text-slate-700 underline"
                  >
                    Withdraw Request
                  </button>
                </div>
              )}

              {exc.reviewed_at && (
                <div className="mt-3 text-xs text-slate-400">
                  Reviewed: {new Date(exc.reviewed_at).toLocaleString()} by User #{exc.reviewed_by_user_id}
                </div>
              )}
            </div>
          );
        })}

        {exceptions.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
            <Shield size={40} className="text-slate-300 mx-auto mb-3" />
            <h3 className="text-lg font-medium text-slate-700 mb-1">No Exception Requests</h3>
            <p className="text-sm text-slate-500">
              Exception requests for false positives, risk accepted, and deferred vulnerabilities will appear here for approval
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
