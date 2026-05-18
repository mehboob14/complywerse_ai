'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Loader2,
  Shield,
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  Download,
  Eye,
  AlertCircle,
  User,
  Calendar,
} from 'lucide-react';
import EvidenceViewer from '@/components/evidence/EvidenceViewer';

interface Evidence {
  id: number;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  uploaded_at: string;
  uploaded_by: { id: number; name: string; email: string };
  control: { id: number; control_id: string; title: string; description: string };
  review_status: 'pending' | 'approved' | 'rejected';
  reviewed_by?: { id: number; name: string };
  reviewed_at?: string;
  review_notes?: string;
  ai_confidence_score?: number;
  ai_assessment_notes?: string;
}

interface AuditorPortalData {
  framework: { id: number; name: string; version: string };
  evidence: Evidence[];
  stats: { total: number; pending: number; approved: number; rejected: number };
}

/**
 * Evidence tab — preserves the original /auditor-portal evidence view.
 * The endpoint and approval contract are unchanged from the pre-tab
 * version so we don't regress that flow while introducing the other
 * sections.
 */
export default function EvidenceTab({ frameworkId }: { frameworkId: string }) {
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canApprove = hasPermission('auditor_portal:evidence_review:approve');
  const canReject = hasPermission('auditor_portal:evidence_review:reject');

  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [selectedEvidence, setSelectedEvidence] = useState<Evidence | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [previewEvidence, setPreviewEvidence] = useState<Evidence | null>(null);

  const { data, isLoading, error } = useQuery<AuditorPortalData>({
    queryKey: ['auditor-evidence', frameworkId, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== 'all') {
        params.append('status_filter', statusFilter);
      }
      const response = await apiClient.get(`/certifications/frameworks/${frameworkId}/auditor-evidence?${params}`);
      return response.data;
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async ({ evidenceId, action, notes }: { evidenceId: number; action: 'approved' | 'rejected'; notes: string }) => {
      const response = await apiClient.post(`/certifications/evidence/${evidenceId}/review`, { action, notes });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auditor-evidence'] });
      queryClient.invalidateQueries({ queryKey: ['auditor-overview', frameworkId] });
      queryClient.invalidateQueries({ queryKey: ['auditor-audit-trail', frameworkId] });
      setSelectedEvidence(null);
      setReviewNotes('');
    },
  });

  const handleReview = (action: 'approved' | 'rejected') => {
    if (!selectedEvidence) return;
    reviewMutation.mutate({ evidenceId: selectedEvidence.id, action, notes: reviewNotes });
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'rejected': return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'pending': return 'bg-amber-50 text-amber-700 border-amber-200';
      default: return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'approved': return <CheckCircle2 className="h-4 w-4" />;
      case 'rejected': return <XCircle className="h-4 w-4" />;
      case 'pending': return <Clock className="h-4 w-4" />;
      default: return <AlertCircle className="h-4 w-4" />;
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return 'N/A';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
        Loading evidence…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-rose-50 border border-rose-200 p-4 text-rose-700 flex items-center gap-2">
        <AlertCircle className="h-5 w-5" />
        Failed to load evidence
      </div>
    );
  }

  const evidence = data?.evidence || [];

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-white border border-slate-200 p-3">
          <p className="text-xs text-slate-600">Total</p>
          <p className="text-xl font-semibold text-slate-900">{data?.stats.total || 0}</p>
        </div>
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
          <p className="text-xs text-amber-700">Pending</p>
          <p className="text-xl font-semibold text-amber-900">{data?.stats.pending || 0}</p>
        </div>
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
          <p className="text-xs text-emerald-700">Approved</p>
          <p className="text-xl font-semibold text-emerald-900">{data?.stats.approved || 0}</p>
        </div>
        <div className="rounded-lg bg-rose-50 border border-rose-200 p-3">
          <p className="text-xs text-rose-700">Rejected</p>
          <p className="text-xl font-semibold text-rose-900">{data?.stats.rejected || 0}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-2">
        {['all', 'pending', 'approved', 'rejected'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              statusFilter === s
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Evidence cards */}
      <div className="space-y-3">
        {evidence.length === 0 ? (
          <div className="rounded-lg bg-white border border-slate-200 p-10 text-center">
            <FileText className="mx-auto h-10 w-10 text-slate-400" />
            <h3 className="mt-3 text-sm font-semibold text-slate-900">No evidence found</h3>
            <p className="mt-1 text-xs text-slate-500">No evidence in this state.</p>
          </div>
        ) : (
          evidence.map((ev) => (
            <div key={ev.id} className="rounded-lg bg-white border border-slate-200 p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="text-base font-semibold text-slate-900">{ev.file_name}</h4>
                      <div className="mt-1 flex items-center gap-2 text-xs text-slate-600">
                        <Shield className="h-3.5 w-3.5" />
                        <span className="font-medium">{ev.control.control_id}</span>
                        <span>—</span>
                        <span className="line-clamp-1">{ev.control.title}</span>
                      </div>
                    </div>
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${getStatusColor(ev.review_status)}`}>
                      {getStatusIcon(ev.review_status)}
                      {ev.review_status.charAt(0).toUpperCase() + ev.review_status.slice(1)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-600">
                    <div className="flex items-center gap-1.5">
                      <User className="h-3.5 w-3.5" />
                      <span>{ev.uploaded_by.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Calendar className="h-3.5 w-3.5" />
                      <span>{new Date(ev.uploaded_at).toLocaleDateString()}</span>
                    </div>
                    <div>Size: <span className="font-medium text-slate-900">{formatFileSize(ev.file_size)}</span></div>
                    {ev.ai_confidence_score && (
                      <div>AI Confidence: <span className="font-medium text-slate-900">{Math.round(ev.ai_confidence_score * 100)}%</span></div>
                    )}
                  </div>

                  {ev.review_notes && (
                    <div className="rounded bg-slate-50 p-2 text-xs">
                      <span className="font-medium">Review notes:</span> {ev.review_notes}
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  {ev.file_path && (
                    <button
                      onClick={() => setPreviewEvidence(ev)}
                      className="flex items-center gap-2 rounded-lg bg-white border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      title="Preview file in-browser"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      Preview
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedEvidence(ev)}
                    className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Review
                  </button>
                  {ev.file_path && (
                    <a
                      href={`/api${ev.file_path}`}
                      download={ev.file_name}
                      className="flex items-center gap-2 rounded-lg bg-white border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Review modal */}
      {selectedEvidence && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-xl bg-white border border-slate-200 p-6 shadow-xl">
            <h2 className="text-lg font-bold text-slate-900">Review evidence</h2>
            <div className="mt-3 space-y-3">
              <div>
                <h3 className="font-semibold text-slate-900">{selectedEvidence.file_name}</h3>
                <p className="text-xs text-slate-600">{selectedEvidence.control.control_id} — {selectedEvidence.control.title}</p>
              </div>
              {selectedEvidence.control.description && (
                <div className="rounded bg-slate-50 p-3 text-xs text-slate-700">
                  <span className="font-medium">Control description:</span> {selectedEvidence.control.description}
                </div>
              )}
              <div>
                <label className="block text-sm font-medium text-slate-700">Review notes</label>
                <textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  rows={4}
                  className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="Add your review notes…"
                />
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleReview('approved')}
                  disabled={reviewMutation.isPending || !canApprove}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {reviewMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><CheckCircle2 className="h-4 w-4" /> Approve</>}
                </button>
                <button
                  onClick={() => handleReview('rejected')}
                  disabled={reviewMutation.isPending || !canReject}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  {reviewMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><XCircle className="h-4 w-4" /> Reject</>}
                </button>
                <button
                  onClick={() => { setSelectedEvidence(null); setReviewNotes(''); }}
                  disabled={reviewMutation.isPending}
                  className="rounded-lg bg-white border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Shared evidence viewer modal — renders the file inline based on
          its type (image / PDF / xlsx / csv / md / text), falling back to
          a download CTA for formats that can't be previewed in-browser. */}
      <EvidenceViewer
        evidence={previewEvidence ? {
          file_path: previewEvidence.file_path,
          file_name: previewEvidence.file_name,
          mime_type: previewEvidence.mime_type,
          file_size: previewEvidence.file_size,
        } : null}
        onClose={() => setPreviewEvidence(null)}
      />
    </div>
  );
}
