'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { policyExceptionApi, governanceApi } from '@/lib/api';
import {
  Shield,
  Plus,
  Clock,
  CheckCircle,
  AlertTriangle,
  X,
  Loader2,
  AlertCircle,
  Eye,
  Edit,
  Send,
  Check,
  XCircle,
  Ban,
  MessageSquare,
  Calendar,
  FileText,
} from 'lucide-react';

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'pending_approval', label: 'Pending Approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' },
  { value: 'revoked', label: 'Revoked' },
];

const PRIORITY_OPTIONS = [
  { value: '', label: 'All Priorities' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  draft: { bg: 'var(--color-subtle)', color: 'var(--color-muted)', label: 'Draft' },
  pending_approval: { bg: 'rgba(146, 87, 14, 0.1)', color: 'var(--color-warning)', label: 'Pending Approval' },
  approved: { bg: 'rgba(45, 106, 79, 0.1)', color: 'var(--color-success)', label: 'Approved' },
  rejected: { bg: 'rgba(155, 28, 28, 0.1)', color: 'var(--color-danger)', label: 'Rejected' },
  expired: { bg: 'rgba(146, 87, 14, 0.1)', color: 'var(--color-warning)', label: 'Expired' },
  revoked: { bg: 'var(--color-subtle)', color: 'var(--color-muted)', label: 'Revoked' },
};

const PRIORITY_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  low: { bg: 'var(--color-subtle)', color: 'var(--color-muted)', label: 'Low' },
  medium: { bg: 'rgba(28, 43, 58, 0.08)', color: 'var(--color-base)', label: 'Medium' },
  high: { bg: 'rgba(146, 87, 14, 0.1)', color: 'var(--color-warning)', label: 'High' },
  critical: { bg: 'rgba(155, 28, 28, 0.1)', color: 'var(--color-danger)', label: 'Critical' },
};

interface ExceptionItem {
  id: number;
  title: string;
  document_id: number | null;
  document_title?: string;
  policy_name?: string;
  status: string;
  priority: string;
  justification: string;
  risk_assessment: string;
  compensating_controls: string;
  requested_by: string;
  requested_by_name?: string;
  effective_date: string | null;
  expiry_date: string | null;
  created_at: string;
  updated_at: string | null;
  rejection_reason?: string;
  approval_comments?: string;
  approved_by_name?: string;
  approved_at?: string;
}

interface ExceptionComment {
  id: number;
  comment: string;
  user_name: string;
  created_at: string;
}

interface SummaryData {
  total: number;
  pending_approval: number;
  approved: number;
  expiring_soon: number;
}

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function PolicyExceptionsPage() {
  const [statusFilter, setStatusFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingException, setEditingException] = useState<ExceptionItem | null>(null);
  const [viewingException, setViewingException] = useState<ExceptionItem | null>(null);
  const [approveModal, setApproveModal] = useState<ExceptionItem | null>(null);
  const [rejectModal, setRejectModal] = useState<ExceptionItem | null>(null);
  const [revokeModal, setRevokeModal] = useState<ExceptionItem | null>(null);
  const [approveComments, setApproveComments] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [revokeReason, setRevokeReason] = useState('');
  const [newComment, setNewComment] = useState('');

  const [formData, setFormData] = useState({
    title: '',
    document_id: '' as string | number,
    justification: '',
    risk_assessment: '',
    compensating_controls: '',
    priority: 'medium',
    effective_date: '',
    expiry_date: '',
  });

  const queryClient = useQueryClient();

  const { data: summary } = useQuery({
    queryKey: ['policy-exceptions-summary'],
    queryFn: async () => {
      const response = await policyExceptionApi.getSummary();
      return response.data as SummaryData;
    },
  });

  const { data: exceptions, isLoading } = useQuery({
    queryKey: ['policy-exceptions', statusFilter, priorityFilter],
    queryFn: async () => {
      const params: Record<string, string | number> = {};
      if (statusFilter) params.status = statusFilter;
      if (priorityFilter) params.priority = priorityFilter;
      const response = await policyExceptionApi.getAll(params);
      return (response.data?.items || response.data || []) as ExceptionItem[];
    },
  });

  const { data: documents } = useQuery({
    queryKey: ['governance-documents-list'],
    queryFn: async () => {
      const response = await governanceApi.getDocuments({ limit: 200 });
      const data = response.data as any;
      return Array.isArray(data) ? data : (data?.items || []);
    },
  });

  const { data: comments, isLoading: commentsLoading } = useQuery({
    queryKey: ['exception-comments', viewingException?.id],
    queryFn: async () => {
      if (!viewingException) return [];
      const response = await policyExceptionApi.getComments(viewingException.id);
      return response.data as ExceptionComment[];
    },
    enabled: !!viewingException,
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      await policyExceptionApi.create(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policy-exceptions'] });
      queryClient.invalidateQueries({ queryKey: ['policy-exceptions-summary'] });
      setShowCreateModal(false);
      resetForm();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
      await policyExceptionApi.update(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policy-exceptions'] });
      queryClient.invalidateQueries({ queryKey: ['policy-exceptions-summary'] });
      setEditingException(null);
      resetForm();
    },
  });

  const submitMutation = useMutation({
    mutationFn: async (id: number) => {
      await policyExceptionApi.submit(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policy-exceptions'] });
      queryClient.invalidateQueries({ queryKey: ['policy-exceptions-summary'] });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data?: { comments?: string } }) => {
      await policyExceptionApi.approve(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policy-exceptions'] });
      queryClient.invalidateQueries({ queryKey: ['policy-exceptions-summary'] });
      setApproveModal(null);
      setApproveComments('');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { rejection_reason: string } }) => {
      await policyExceptionApi.reject(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policy-exceptions'] });
      queryClient.invalidateQueries({ queryKey: ['policy-exceptions-summary'] });
      setRejectModal(null);
      setRejectReason('');
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data?: { reason?: string } }) => {
      await policyExceptionApi.revoke(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['policy-exceptions'] });
      queryClient.invalidateQueries({ queryKey: ['policy-exceptions-summary'] });
      setRevokeModal(null);
      setRevokeReason('');
    },
  });

  const addCommentMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { comment: string } }) => {
      await policyExceptionApi.addComment(id, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exception-comments', viewingException?.id] });
      setNewComment('');
    },
  });

  const resetForm = () => {
    setFormData({
      title: '',
      document_id: '',
      justification: '',
      risk_assessment: '',
      compensating_controls: '',
      priority: 'medium',
      effective_date: '',
      expiry_date: '',
    });
  };

  const openEditModal = (exception: ExceptionItem) => {
    setFormData({
      title: exception.title,
      document_id: exception.document_id || '',
      justification: exception.justification || '',
      risk_assessment: exception.risk_assessment || '',
      compensating_controls: exception.compensating_controls || '',
      priority: exception.priority || 'medium',
      effective_date: exception.effective_date || '',
      expiry_date: exception.expiry_date || '',
    });
    setEditingException(exception);
  };

  const handleSubmitForm = () => {
    const payload: Record<string, unknown> = {
      title: formData.title,
      justification: formData.justification,
      risk_assessment: formData.risk_assessment,
      compensating_controls: formData.compensating_controls,
      priority: formData.priority,
    };
    if (formData.document_id) payload.document_id = Number(formData.document_id);
    if (formData.effective_date) payload.effective_date = formData.effective_date;
    if (formData.expiry_date) payload.expiry_date = formData.expiry_date;

    if (editingException) {
      updateMutation.mutate({ id: editingException.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const exceptionList = Array.isArray(exceptions) ? exceptions : [];

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3" style={{ color: 'var(--color-text)' }}>
            <Shield className="h-7 w-7 text-primary-400" />
            Policy Exception Management
          </h1>
          <p className="mt-1" style={{ color: 'var(--color-muted)' }}>
            Request, review, and manage policy exceptions
          </p>
        </div>
        <button
          onClick={() => { resetForm(); setShowCreateModal(true); }}
          className="btn-primary flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          New Exception Request
        </button>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="stat-card">
          <div className="flex items-start justify-between mb-4">
            <div className="rounded-xl bg-gradient-to-br from-primary-500/20 to-primary-600/10 p-3">
              <FileText className="h-6 w-6 text-primary-400" />
            </div>
          </div>
          <p className="stat-value">{summary?.total || 0}</p>
          <p className="stat-label">Total Exceptions</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between mb-4">
            <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(146, 87, 14, 0.1)' }}>
              <Clock className="h-6 w-6" style={{ color: 'var(--color-warning)' }} />
            </div>
          </div>
          <p className="stat-value">{summary?.pending_approval || 0}</p>
          <p className="stat-label">Pending Approval</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between mb-4">
            <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(45, 106, 79, 0.1)' }}>
              <CheckCircle className="h-6 w-6" style={{ color: 'var(--color-success)' }} />
            </div>
          </div>
          <p className="stat-value">{summary?.approved || 0}</p>
          <p className="stat-label">Active (Approved)</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between mb-4">
            <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(146, 87, 14, 0.1)' }}>
              <AlertTriangle className="h-6 w-6" style={{ color: 'var(--color-warning)' }} />
            </div>
          </div>
          <p className="stat-value">{summary?.expiring_soon || 0}</p>
          <p className="stat-label">Expiring Soon (30 days)</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="select min-w-[160px]"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <select
          value={priorityFilter}
          onChange={(e) => setPriorityFilter(e.target.value)}
          className="select min-w-[140px]"
        >
          {PRIORITY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Policy</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Requested By</th>
              <th>Requested Date</th>
              <th>Expiry Date</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} className="text-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary-400" />
                </td>
              </tr>
            ) : exceptionList.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-12">
                  <Shield className="h-12 w-12 mx-auto mb-3" style={{ color: 'var(--color-muted)' }} />
                  <p style={{ color: 'var(--color-muted)' }}>No exceptions found</p>
                  <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>Create a new exception request to get started</p>
                </td>
              </tr>
            ) : (
              exceptionList.map((exc) => {
                const statusStyle = STATUS_STYLES[exc.status] || STATUS_STYLES.draft;
                const priorityStyle = PRIORITY_STYLES[exc.priority] || PRIORITY_STYLES.medium;

                return (
                  <tr key={exc.id}>
                    <td>
                      <span className="font-medium" style={{ color: 'var(--color-text)' }}>{exc.title}</span>
                    </td>
                    <td style={{ color: 'var(--color-muted)' }}>
                      {exc.document_title || exc.policy_name || '-'}
                    </td>
                    <td>
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: statusStyle.bg, color: statusStyle.color }}>
                        {statusStyle.label}
                      </span>
                    </td>
                    <td>
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: priorityStyle.bg, color: priorityStyle.color }}>
                        {priorityStyle.label}
                      </span>
                    </td>
                    <td style={{ color: 'var(--color-muted)' }}>{exc.requested_by_name || exc.requested_by || '-'}</td>
                    <td style={{ color: 'var(--color-muted)' }}>{formatDate(exc.created_at)}</td>
                    <td style={{ color: 'var(--color-muted)' }}>{formatDate(exc.expiry_date)}</td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setViewingException(exc)}
                          className="btn-ghost btn-sm"
                          title="View Details"
                        >
                          <Eye className="h-4 w-4" />
                        </button>
                        {exc.status === 'draft' && (
                          <>
                            <button
                              onClick={() => openEditModal(exc)}
                              className="btn-ghost btn-sm"
                              title="Edit"
                            >
                              <Edit className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => submitMutation.mutate(exc.id)}
                              disabled={submitMutation.isPending}
                              className="btn-ghost btn-sm"
                              title="Submit for Approval"
                              style={{ color: 'var(--color-base)' }}
                            >
                              <Send className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {exc.status === 'pending_approval' && (
                          <>
                            <button
                              onClick={() => setApproveModal(exc)}
                              className="btn-ghost btn-sm"
                              title="Approve"
                              style={{ color: 'var(--color-success)' }}
                            >
                              <Check className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setRejectModal(exc)}
                              className="btn-ghost btn-sm"
                              title="Reject"
                              style={{ color: 'var(--color-danger)' }}
                            >
                              <XCircle className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {exc.status === 'approved' && (
                          <button
                            onClick={() => setRevokeModal(exc)}
                            className="btn-ghost btn-sm"
                            title="Revoke"
                            style={{ color: 'var(--color-muted)' }}
                          >
                            <Ban className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {(showCreateModal || editingException) && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" style={{ backgroundColor: 'var(--color-surface)' }}>
            <div className="flex items-center justify-between p-6" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <div>
                <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
                  {editingException ? 'Edit Exception Request' : 'New Exception Request'}
                </h2>
                <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
                  {editingException ? 'Update the exception details' : 'Create a new policy exception request'}
                </p>
              </div>
              <button
                onClick={() => { setShowCreateModal(false); setEditingException(null); resetForm(); }}
                className="btn-ghost btn-sm"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="label">Title *</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="input"
                  placeholder="Exception request title"
                />
              </div>

              <div>
                <label className="label">Policy</label>
                <select
                  value={formData.document_id}
                  onChange={(e) => setFormData({ ...formData, document_id: e.target.value })}
                  className="select"
                >
                  <option value="">Select a policy...</option>
                  {(documents || []).map((doc: any) => (
                    <option key={doc.id} value={doc.id}>
                      {doc.title} ({doc.document_code || doc.doc_type})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">Justification *</label>
                <textarea
                  value={formData.justification}
                  onChange={(e) => setFormData({ ...formData, justification: e.target.value })}
                  className="input min-h-[100px]"
                  placeholder="Explain why this exception is needed"
                />
              </div>

              <div>
                <label className="label">Risk Assessment</label>
                <textarea
                  value={formData.risk_assessment}
                  onChange={(e) => setFormData({ ...formData, risk_assessment: e.target.value })}
                  className="input min-h-[80px]"
                  placeholder="Describe the risk associated with this exception"
                />
              </div>

              <div>
                <label className="label">Compensating Controls</label>
                <textarea
                  value={formData.compensating_controls}
                  onChange={(e) => setFormData({ ...formData, compensating_controls: e.target.value })}
                  className="input min-h-[80px]"
                  placeholder="Describe compensating controls in place"
                />
              </div>

              <div>
                <label className="label">Priority</label>
                <select
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                  className="select"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Effective Date</label>
                  <input
                    type="date"
                    value={formData.effective_date}
                    onChange={(e) => setFormData({ ...formData, effective_date: e.target.value })}
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">Expiry Date</label>
                  <input
                    type="date"
                    value={formData.expiry_date}
                    onChange={(e) => setFormData({ ...formData, expiry_date: e.target.value })}
                    className="input"
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-6" style={{ borderTop: '1px solid var(--color-border)' }}>
              <button
                onClick={() => { setShowCreateModal(false); setEditingException(null); resetForm(); }}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitForm}
                disabled={!formData.title || !formData.justification || createMutation.isPending || updateMutation.isPending}
                className="btn-primary flex items-center gap-2"
              >
                {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingException ? 'Update Exception' : 'Create Exception'}
              </button>
            </div>
          </div>
        </div>
      )}

      {viewingException && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" style={{ backgroundColor: 'var(--color-surface)' }}>
            <div className="flex items-center justify-between p-6" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <div>
                <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>{viewingException.title}</h2>
                <div className="flex items-center gap-2 mt-1">
                  {(() => {
                    const ss = STATUS_STYLES[viewingException.status] || STATUS_STYLES.draft;
                    return (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: ss.bg, color: ss.color }}>
                        {ss.label}
                      </span>
                    );
                  })()}
                  {(() => {
                    const ps = PRIORITY_STYLES[viewingException.priority] || PRIORITY_STYLES.medium;
                    return (
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ backgroundColor: ps.bg, color: ps.color }}>
                        {ps.label} Priority
                      </span>
                    );
                  })()}
                </div>
              </div>
              <button
                onClick={() => setViewingException(null)}
                className="btn-ghost btn-sm"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Policy</label>
                  <p className="mt-1" style={{ color: 'var(--color-text)' }}>{viewingException.document_title || viewingException.policy_name || '-'}</p>
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Requested By</label>
                  <p className="mt-1" style={{ color: 'var(--color-text)' }}>{viewingException.requested_by_name || viewingException.requested_by || '-'}</p>
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Effective Date</label>
                  <p className="mt-1" style={{ color: 'var(--color-text)' }}>{formatDate(viewingException.effective_date)}</p>
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Expiry Date</label>
                  <p className="mt-1" style={{ color: 'var(--color-text)' }}>{formatDate(viewingException.expiry_date)}</p>
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Created</label>
                  <p className="mt-1" style={{ color: 'var(--color-text)' }}>{formatDate(viewingException.created_at)}</p>
                </div>
                {viewingException.approved_by_name && (
                  <div>
                    <label className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Approved By</label>
                    <p className="mt-1" style={{ color: 'var(--color-text)' }}>{viewingException.approved_by_name}</p>
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Justification</label>
                <p className="mt-1 whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>{viewingException.justification || '-'}</p>
              </div>

              <div>
                <label className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Risk Assessment</label>
                <p className="mt-1 whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>{viewingException.risk_assessment || '-'}</p>
              </div>

              <div>
                <label className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Compensating Controls</label>
                <p className="mt-1 whitespace-pre-wrap" style={{ color: 'var(--color-text)' }}>{viewingException.compensating_controls || '-'}</p>
              </div>

              {viewingException.rejection_reason && (
                <div className="rounded-lg p-4" style={{ backgroundColor: 'rgba(155, 28, 28, 0.05)', border: '1px solid rgba(155, 28, 28, 0.3)' }}>
                  <label className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-danger)' }}>Rejection Reason</label>
                  <p className="mt-1" style={{ color: 'var(--color-danger)' }}>{viewingException.rejection_reason}</p>
                </div>
              )}

              {viewingException.approval_comments && (
                <div className="rounded-lg p-4" style={{ backgroundColor: 'rgba(45, 106, 79, 0.05)', border: '1px solid rgba(45, 106, 79, 0.3)' }}>
                  <label className="text-xs uppercase tracking-wide" style={{ color: 'var(--color-success)' }}>Approval Comments</label>
                  <p className="mt-1" style={{ color: 'var(--color-success)' }}>{viewingException.approval_comments}</p>
                </div>
              )}

              <div className="pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
                <h3 className="text-sm font-semibold flex items-center gap-2 mb-4" style={{ color: 'var(--color-text)' }}>
                  <MessageSquare className="h-4 w-4" style={{ color: 'var(--color-muted)' }} />
                  Comments
                </h3>
                {commentsLoading ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-primary-400" />
                  </div>
                ) : (
                  <div className="space-y-3 mb-4">
                    {(!comments || comments.length === 0) && (
                      <p className="text-sm text-center py-2" style={{ color: 'var(--color-muted)' }}>No comments yet</p>
                    )}
                    {(comments || []).map((comment) => (
                      <div key={comment.id} className="rounded-lg p-3" style={{ backgroundColor: 'var(--color-subtle)' }}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{comment.user_name}</span>
                          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{formatDate(comment.created_at)}</span>
                        </div>
                        <p className="text-sm" style={{ color: 'var(--color-text)' }}>{comment.comment}</p>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    className="input flex-1"
                    placeholder="Add a comment..."
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newComment.trim()) {
                        addCommentMutation.mutate({ id: viewingException.id, data: { comment: newComment.trim() } });
                      }
                    }}
                  />
                  <button
                    onClick={() => {
                      if (newComment.trim()) {
                        addCommentMutation.mutate({ id: viewingException.id, data: { comment: newComment.trim() } });
                      }
                    }}
                    disabled={!newComment.trim() || addCommentMutation.isPending}
                    className="btn-primary"
                  >
                    {addCommentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {approveModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="rounded-xl w-full max-w-md" style={{ backgroundColor: 'var(--color-surface)' }}>
            <div className="p-6" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <h2 className="text-lg font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                <CheckCircle className="h-5 w-5" style={{ color: 'var(--color-success)' }} />
                Approve Exception
              </h2>
              <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
                Approve &quot;{approveModal.title}&quot;
              </p>
            </div>
            <div className="p-6">
              <label className="label">Comments (optional)</label>
              <textarea
                value={approveComments}
                onChange={(e) => setApproveComments(e.target.value)}
                className="input min-h-[80px]"
                placeholder="Add approval comments..."
              />
            </div>
            <div className="flex items-center justify-end gap-3 p-6" style={{ borderTop: '1px solid var(--color-border)' }}>
              <button onClick={() => { setApproveModal(null); setApproveComments(''); }} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => approveMutation.mutate({ id: approveModal.id, data: approveComments ? { comments: approveComments } : undefined })}
                disabled={approveMutation.isPending}
                className="btn-primary flex items-center gap-2 bg-green-600 hover:bg-green-700"
              >
                {approveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Approve
              </button>
            </div>
          </div>
        </div>
      )}

      {rejectModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="rounded-xl w-full max-w-md" style={{ backgroundColor: 'var(--color-surface)' }}>
            <div className="p-6" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <h2 className="text-lg font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                <XCircle className="h-5 w-5" style={{ color: 'var(--color-danger)' }} />
                Reject Exception
              </h2>
              <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
                Reject &quot;{rejectModal.title}&quot;
              </p>
            </div>
            <div className="p-6">
              <label className="label">Rejection Reason *</label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                className="input min-h-[100px]"
                placeholder="Explain why this exception is being rejected..."
              />
            </div>
            <div className="flex items-center justify-end gap-3 p-6" style={{ borderTop: '1px solid var(--color-border)' }}>
              <button onClick={() => { setRejectModal(null); setRejectReason(''); }} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => rejectMutation.mutate({ id: rejectModal.id, data: { rejection_reason: rejectReason } })}
                disabled={!rejectReason.trim() || rejectMutation.isPending}
                className="btn-primary flex items-center gap-2 bg-red-600 hover:bg-red-700"
              >
                {rejectMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {revokeModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="rounded-xl w-full max-w-md" style={{ backgroundColor: 'var(--color-surface)' }}>
            <div className="p-6" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <h2 className="text-lg font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
                <Ban className="h-5 w-5" style={{ color: 'var(--color-muted)' }} />
                Revoke Exception
              </h2>
              <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
                Revoke &quot;{revokeModal.title}&quot;
              </p>
            </div>
            <div className="p-6">
              <label className="label">Reason (optional)</label>
              <textarea
                value={revokeReason}
                onChange={(e) => setRevokeReason(e.target.value)}
                className="input min-h-[80px]"
                placeholder="Reason for revoking this exception..."
              />
            </div>
            <div className="flex items-center justify-end gap-3 p-6" style={{ borderTop: '1px solid var(--color-border)' }}>
              <button onClick={() => { setRevokeModal(null); setRevokeReason(''); }} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => revokeMutation.mutate({ id: revokeModal.id, data: revokeReason ? { reason: revokeReason } : undefined })}
                disabled={revokeMutation.isPending}
                className="btn-primary flex items-center gap-2"
                style={{ backgroundColor: 'var(--color-muted)' }}
              >
                {revokeMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Revoke
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
