'use client';

import { useEffect, useState } from 'react';
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

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Draft' },
  pending_approval: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Pending Approval' },
  approved: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'Approved' },
  rejected: { bg: 'bg-rose-500/20', text: 'text-rose-400', label: 'Rejected' },
  expired: { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'Expired' },
  revoked: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Revoked' },
};

const PRIORITY_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  low: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Low' },
  medium: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'Medium' },
  high: { bg: 'bg-amber-500/20', text: 'text-amber-400', label: 'High' },
  critical: { bg: 'bg-rose-500/20', text: 'text-rose-400', label: 'Critical' },
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
  const [lastAutofillKey, setLastAutofillKey] = useState('');

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

  const suggestContentMutation = useMutation({
    mutationFn: async (data: { title: string; document_id: number }) => {
      const response = await policyExceptionApi.suggestContent(data);
      return response.data as {
        justification?: string;
        risk_assessment?: string;
        compensating_controls?: string;
      };
    },
    onSuccess: (data) => {
      setFormData((prev) => ({
        ...prev,
        justification: prev.justification?.trim() ? prev.justification : (data.justification || ''),
        risk_assessment: prev.risk_assessment?.trim() ? prev.risk_assessment : (data.risk_assessment || ''),
        compensating_controls: prev.compensating_controls?.trim() ? prev.compensating_controls : (data.compensating_controls || ''),
      }));
    },
  });

  const resetForm = () => {
    setLastAutofillKey('');
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
    setLastAutofillKey('');
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
  const selectedDocumentId = formData.document_id ? Number(formData.document_id) : 0;
  const normalizedTitle = formData.title.trim();

  useEffect(() => {
    if (!showCreateModal || editingException) return;
    if (!selectedDocumentId || !normalizedTitle) return;

    const key = `${selectedDocumentId}:${normalizedTitle.toLowerCase()}`;
    if (lastAutofillKey === key) return;

    setLastAutofillKey(key);
    suggestContentMutation.mutate({ title: normalizedTitle, document_id: selectedDocumentId });
  }, [
    showCreateModal,
    editingException,
    selectedDocumentId,
    normalizedTitle,
    lastAutofillKey,
    suggestContentMutation,
  ]);

  return (
    <div className="governance-exceptions space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-black flex items-center gap-3">
            <Shield className="h-7 w-7 text-primary-400" />
            Policy Exception Management
          </h1>
          <p className="text-gray-600 mt-1">
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
            <div className="rounded-xl bg-gradient-to-br from-yellow-500/20 to-yellow-600/10 p-3">
              <Clock className="h-6 w-6 text-yellow-400" />
            </div>
          </div>
          <p className="stat-value">{summary?.pending_approval || 0}</p>
          <p className="stat-label">Pending Approval</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between mb-4">
            <div className="rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 p-3">
              <CheckCircle className="h-6 w-6 text-emerald-400" />
            </div>
          </div>
          <p className="stat-value">{summary?.approved || 0}</p>
          <p className="stat-label">Active (Approved)</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between mb-4">
            <div className="rounded-xl bg-gradient-to-br from-orange-500/20 to-orange-600/10 p-3">
              <AlertTriangle className="h-6 w-6 text-orange-400" />
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
                  <Shield className="h-12 w-12 text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-700">No exceptions found</p>
                  <p className="text-sm text-gray-600 mt-1">Create a new exception request to get started</p>
                </td>
              </tr>
            ) : (
              exceptionList.map((exc) => {
                const statusStyle = STATUS_STYLES[exc.status] || STATUS_STYLES.draft;
                const priorityStyle = PRIORITY_STYLES[exc.priority] || PRIORITY_STYLES.medium;

                return (
                  <tr key={exc.id} className="hover:bg-gray-50">
                    <td>
                      <span className="font-medium text-black">{exc.title}</span>
                    </td>
                    <td className="text-gray-700">
                      {exc.document_title || exc.policy_name || '-'}
                    </td>
                    <td>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                        {statusStyle.label}
                      </span>
                    </td>
                    <td>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${priorityStyle.bg} ${priorityStyle.text}`}>
                        {priorityStyle.label}
                      </span>
                    </td>
                    <td className="text-gray-700">{exc.requested_by_name || exc.requested_by || '-'}</td>
                    <td className="text-gray-700">{formatDate(exc.created_at)}</td>
                    <td className="text-gray-700">{formatDate(exc.expiry_date)}</td>
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
                              className="btn-ghost btn-sm text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                              title="Submit for Approval"
                            >
                              <Send className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {exc.status === 'pending_approval' && (
                          <>
                            <button
                              onClick={() => setApproveModal(exc)}
                              className="btn-ghost btn-sm text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                              title="Approve"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setRejectModal(exc)}
                              className="btn-ghost btn-sm text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                              title="Reject"
                            >
                              <XCircle className="h-4 w-4" />
                            </button>
                          </>
                        )}
                        {exc.status === 'approved' && (
                          <button
                            onClick={() => setRevokeModal(exc)}
                            className="btn-ghost btn-sm text-gray-400 hover:text-gray-300 hover:bg-gray-500/10"
                            title="Revoke"
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-gray-300">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-semibold text-black">
                  {editingException ? 'Edit Exception Request' : 'New Exception Request'}
                </h2>
                <p className="text-sm text-gray-600">
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
                {showCreateModal && !editingException && suggestContentMutation.isPending && (
                  <p className="mt-2 text-xs text-gray-600">Generating suggested justification and risk details...</p>
                )}
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
            <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200">
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto border border-gray-300">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-semibold text-black">{viewingException.title}</h2>
                <div className="flex items-center gap-2 mt-1">
                  {(() => {
                    const ss = STATUS_STYLES[viewingException.status] || STATUS_STYLES.draft;
                    return (
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${ss.bg} ${ss.text}`}>
                        {ss.label}
                      </span>
                    );
                  })()}
                  {(() => {
                    const ps = PRIORITY_STYLES[viewingException.priority] || PRIORITY_STYLES.medium;
                    return (
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${ps.bg} ${ps.text}`}>
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
                  <label className="text-xs text-gray-600 uppercase tracking-wide">Policy</label>
                  <p className="text-black mt-1">{viewingException.document_title || viewingException.policy_name || '-'}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-600 uppercase tracking-wide">Requested By</label>
                  <p className="text-black mt-1">{viewingException.requested_by_name || viewingException.requested_by || '-'}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-600 uppercase tracking-wide">Effective Date</label>
                  <p className="text-black mt-1">{formatDate(viewingException.effective_date)}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-600 uppercase tracking-wide">Expiry Date</label>
                  <p className="text-black mt-1">{formatDate(viewingException.expiry_date)}</p>
                </div>
                <div>
                  <label className="text-xs text-gray-600 uppercase tracking-wide">Created</label>
                  <p className="text-black mt-1">{formatDate(viewingException.created_at)}</p>
                </div>
                {viewingException.approved_by_name && (
                  <div>
                    <label className="text-xs text-gray-600 uppercase tracking-wide">Approved By</label>
                    <p className="text-black mt-1">{viewingException.approved_by_name}</p>
                  </div>
                )}
              </div>

              <div>
                <label className="text-xs text-gray-600 uppercase tracking-wide">Justification</label>
                <p className="text-gray-800 mt-1 whitespace-pre-wrap">{viewingException.justification || '-'}</p>
              </div>

              <div>
                <label className="text-xs text-gray-600 uppercase tracking-wide">Risk Assessment</label>
                <p className="text-gray-800 mt-1 whitespace-pre-wrap">{viewingException.risk_assessment || '-'}</p>
              </div>

              <div>
                <label className="text-xs text-gray-600 uppercase tracking-wide">Compensating Controls</label>
                <p className="text-gray-800 mt-1 whitespace-pre-wrap">{viewingException.compensating_controls || '-'}</p>
              </div>

              {viewingException.rejection_reason && (
                <div className="bg-rose-500/10 border border-rose-500/30 rounded-lg p-4">
                  <label className="text-xs text-rose-400 uppercase tracking-wide">Rejection Reason</label>
                  <p className="text-rose-300 mt-1">{viewingException.rejection_reason}</p>
                </div>
              )}

              {viewingException.approval_comments && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
                  <label className="text-xs text-emerald-400 uppercase tracking-wide">Approval Comments</label>
                  <p className="text-emerald-300 mt-1">{viewingException.approval_comments}</p>
                </div>
              )}

              <div className="border-t border-gray-200 pt-4">
                <h3 className="text-sm font-semibold text-black flex items-center gap-2 mb-4">
                  <MessageSquare className="h-4 w-4 text-gray-600" />
                  Comments
                </h3>
                {commentsLoading ? (
                  <div className="flex justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-primary-400" />
                  </div>
                ) : (
                  <div className="space-y-3 mb-4">
                    {(!comments || comments.length === 0) && (
                      <p className="text-sm text-gray-600 text-center py-2">No comments yet</p>
                    )}
                    {(comments || []).map((comment) => (
                      <div key={comment.id} className="bg-gray-100 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-black">{comment.user_name}</span>
                          <span className="text-xs text-gray-600">{formatDate(comment.created_at)}</span>
                        </div>
                        <p className="text-sm text-gray-800">{comment.comment}</p>
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
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md border border-gray-300">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-black flex items-center gap-2">
                <CheckCircle className="h-5 w-5 text-emerald-400" />
                Approve Exception
              </h2>
              <p className="text-sm text-gray-600 mt-1">
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
            <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200">
              <button onClick={() => { setApproveModal(null); setApproveComments(''); }} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => approveMutation.mutate({ id: approveModal.id, data: approveComments ? { comments: approveComments } : undefined })}
                disabled={approveMutation.isPending}
                className="btn-primary flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700"
              >
                {approveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Approve
              </button>
            </div>
          </div>
        </div>
      )}

      {rejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md border border-gray-300">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-black flex items-center gap-2">
                <XCircle className="h-5 w-5 text-rose-400" />
                Reject Exception
              </h2>
              <p className="text-sm text-gray-600 mt-1">
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
            <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200">
              <button onClick={() => { setRejectModal(null); setRejectReason(''); }} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => rejectMutation.mutate({ id: rejectModal.id, data: { rejection_reason: rejectReason } })}
                disabled={!rejectReason.trim() || rejectMutation.isPending}
                className="btn-primary flex items-center gap-2 bg-rose-600 hover:bg-rose-700"
              >
                {rejectMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {revokeModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-md border border-gray-300">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-black flex items-center gap-2">
                <Ban className="h-5 w-5 text-gray-400" />
                Revoke Exception
              </h2>
              <p className="text-sm text-gray-600 mt-1">
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
            <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200">
              <button onClick={() => { setRevokeModal(null); setRevokeReason(''); }} className="btn-secondary">
                Cancel
              </button>
              <button
                onClick={() => revokeMutation.mutate({ id: revokeModal.id, data: revokeReason ? { reason: revokeReason } : undefined })}
                disabled={revokeMutation.isPending}
                className="btn-primary flex items-center gap-2 bg-gray-600 hover:bg-gray-700"
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
