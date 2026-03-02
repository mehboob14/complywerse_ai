'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import apiClient from '@/lib/api';
import { 
  Loader2, 
  ArrowLeft,
  Shield,
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  Download,
  Eye,
  Filter,
  Search,
  AlertCircle,
  User,
  Calendar
} from 'lucide-react';

interface Evidence {
  id: number;
  file_name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  uploaded_at: string;
  uploaded_by: {
    id: number;
    name: string;
    email: string;
  };
  control: {
    id: number;
    control_id: string;
    title: string;
    description: string;
  };
  review_status: 'pending' | 'approved' | 'rejected';
  reviewed_by?: {
    id: number;
    name: string;
  };
  reviewed_at?: string;
  review_notes?: string;
  ai_confidence_score?: number;
  ai_assessment_notes?: string;
}

interface AuditorPortalData {
  framework: {
    id: number;
    name: string;
    version: string;
  };
  evidence: Evidence[];
  stats: {
    total: number;
    pending: number;
    approved: number;
    rejected: number;
  };
}

export default function AuditorPortalPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const frameworkId = params.frameworkId as string;

  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEvidence, setSelectedEvidence] = useState<Evidence | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');

  // Fetch auditor evidence
  const { data, isLoading, error } = useQuery<AuditorPortalData>({
    queryKey: ['auditor-evidence', frameworkId, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== 'all') {
        params.append('status_filter', statusFilter);
      }
      const response = await apiClient.get(`/certifications/frameworks/${frameworkId}/auditor-evidence?${params}`);
      return response.data;
    }
  });

  // Review mutation
  const reviewMutation = useMutation({
    mutationFn: async ({ evidenceId, action, notes }: { evidenceId: number; action: 'approve' | 'reject'; notes: string }) => {
      const response = await apiClient.post(`/certifications/evidence/${evidenceId}/review`, {
        action,
        notes
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['auditor-evidence', frameworkId] });
      setSelectedEvidence(null);
      setReviewNotes('');
    }
  });

  const handleReview = (action: 'approve' | 'reject') => {
    if (!selectedEvidence) return;
    reviewMutation.mutate({
      evidenceId: selectedEvidence.id,
      action,
      notes: reviewNotes
    });
  };

  const filteredEvidence = data?.evidence.filter(ev => {
    if (!searchQuery) return true;
    const search = searchQuery.toLowerCase();
    return (
      ev.file_name.toLowerCase().includes(search) ||
      ev.control.control_id.toLowerCase().includes(search) ||
      ev.control.title.toLowerCase().includes(search) ||
      ev.uploaded_by.name.toLowerCase().includes(search)
    );
  }) || [];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'rejected':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'pending':
        return 'bg-amber-50 text-amber-700 border-amber-200';
      default:
        return 'bg-gray-50 text-gray-700 border-gray-200';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'approved':
        return <CheckCircle2 className="h-4 w-4" />;
      case 'rejected':
        return <XCircle className="h-4 w-4" />;
      case 'pending':
        return <Clock className="h-4 w-4" />;
      default:
        return <AlertCircle className="h-4 w-4" />;
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
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg bg-rose-50 border border-rose-200 p-4 text-rose-700">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-5 w-5" />
          Failed to load auditor portal data
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.back()}
            className="rounded-lg bg-white border border-gray-300 p-2 hover:bg-gray-50 transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-black">Auditor Portal</h1>
            <p className="text-gray-600">{data?.framework.name} v{data?.framework.version}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Shield className="h-8 w-8 text-blue-600" />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="rounded-lg bg-white border border-gray-300 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Evidence</p>
              <p className="text-2xl font-bold text-black">{data?.stats.total || 0}</p>
            </div>
            <FileText className="h-8 w-8 text-gray-400" />
          </div>
        </div>
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-amber-700">Pending Review</p>
              <p className="text-2xl font-bold text-amber-900">{data?.stats.pending || 0}</p>
            </div>
            <Clock className="h-8 w-8 text-amber-600" />
          </div>
        </div>
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-emerald-700">Approved</p>
              <p className="text-2xl font-bold text-emerald-900">{data?.stats.approved || 0}</p>
            </div>
            <CheckCircle2 className="h-8 w-8 text-emerald-600" />
          </div>
        </div>
        <div className="rounded-lg bg-rose-50 border border-rose-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-rose-700">Rejected</p>
              <p className="text-2xl font-bold text-rose-900">{data?.stats.rejected || 0}</p>
            </div>
            <XCircle className="h-8 w-8 text-rose-600" />
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2">
          <button
            onClick={() => setStatusFilter('all')}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              statusFilter === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            All
          </button>
          <button
            onClick={() => setStatusFilter('pending')}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              statusFilter === 'pending'
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            Pending
          </button>
          <button
            onClick={() => setStatusFilter('approved')}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              statusFilter === 'approved'
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            Approved
          </button>
          <button
            onClick={() => setStatusFilter('rejected')}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              statusFilter === 'rejected'
                ? 'bg-blue-600 text-white'
                : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            Rejected
          </button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search evidence..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white pl-10 pr-4 py-2 text-black placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>
      </div>

      {/* Evidence List */}
      <div className="space-y-4">
        {filteredEvidence.length === 0 ? (
          <div className="rounded-lg bg-white border border-gray-300 p-12 text-center">
            <FileText className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-4 text-lg font-medium text-black">No evidence found</h3>
            <p className="mt-1 text-gray-600">
              {searchQuery ? 'Try adjusting your search criteria' : 'No evidence to review'}
            </p>
          </div>
        ) : (
          filteredEvidence.map((evidence) => (
            <div
              key={evidence.id}
              className="rounded-lg bg-white border border-gray-300 p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-black">{evidence.file_name}</h3>
                      <div className="mt-1 flex items-center gap-2 text-sm text-gray-600">
                        <Shield className="h-4 w-4" />
                        <span className="font-medium">{evidence.control.control_id}</span>
                        <span>-</span>
                        <span>{evidence.control.title}</span>
                      </div>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium ${getStatusColor(evidence.review_status)}`}>
                      {getStatusIcon(evidence.review_status)}
                      {evidence.review_status.charAt(0).toUpperCase() + evidence.review_status.slice(1)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div className="flex items-center gap-2 text-gray-600">
                      <User className="h-4 w-4" />
                      <span>Uploaded by: <span className="font-medium text-black">{evidence.uploaded_by.name}</span></span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-600">
                      <Calendar className="h-4 w-4" />
                      <span>{new Date(evidence.uploaded_at).toLocaleDateString()}</span>
                    </div>
                    <div className="text-gray-600">
                      <span>Size: <span className="font-medium text-black">{formatFileSize(evidence.file_size)}</span></span>
                    </div>
                    {evidence.ai_confidence_score && (
                      <div className="text-gray-600">
                        <span>AI Confidence: <span className="font-medium text-black">{Math.round(evidence.ai_confidence_score * 100)}%</span></span>
                      </div>
                    )}
                  </div>

                  {evidence.review_notes && (
                    <div className="rounded-lg bg-gray-50 p-3">
                      <p className="text-sm text-gray-700">
                        <span className="font-medium">Review Notes:</span> {evidence.review_notes}
                      </p>
                      {evidence.reviewed_by && (
                        <p className="mt-1 text-xs text-gray-600">
                          Reviewed by {evidence.reviewed_by.name} on {new Date(evidence.reviewed_at!).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  )}

                  {evidence.ai_assessment_notes && (
                    <div className="rounded-lg bg-blue-50 p-3">
                      <p className="text-sm text-blue-700">
                        <span className="font-medium">AI Assessment:</span> {evidence.ai_assessment_notes}
                      </p>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => setSelectedEvidence(evidence)}
                    className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
                  >
                    <Eye className="h-4 w-4" />
                    Review
                  </button>
                  {evidence.file_path && (
                    <a
                      href={`/api${evidence.file_path}`}
                      download={evidence.file_name}
                      className="flex items-center gap-2 rounded-lg bg-white border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      <Download className="h-4 w-4" />
                      Download
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Review Modal */}
      {selectedEvidence && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-2xl rounded-xl bg-white border border-gray-300 p-6 shadow-xl">
            <h2 className="text-xl font-bold text-black">Review Evidence</h2>
            <div className="mt-4 space-y-4">
              <div>
                <h3 className="font-semibold text-black">{selectedEvidence.file_name}</h3>
                <p className="text-sm text-gray-600">{selectedEvidence.control.control_id} - {selectedEvidence.control.title}</p>
              </div>

              {selectedEvidence.control.description && (
                <div className="rounded-lg bg-gray-50 p-4">
                  <p className="text-sm font-medium text-black">Control Description:</p>
                  <p className="mt-1 text-sm text-gray-700">{selectedEvidence.control.description}</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-black">Review Notes</label>
                <textarea
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  rows={4}
                  className="mt-1 w-full rounded-lg border border-gray-300 bg-white p-3 text-black placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  placeholder="Add your review notes here..."
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => handleReview('approve')}
                  disabled={reviewMutation.isPending}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                >
                  {reviewMutation.isPending ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      <CheckCircle2 className="h-5 w-5" />
                      Approve
                    </>
                  )}
                </button>
                <button
                  onClick={() => handleReview('reject')}
                  disabled={reviewMutation.isPending}
                  className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2 font-medium text-white hover:bg-rose-700 disabled:opacity-50 transition-colors"
                >
                  {reviewMutation.isPending ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      <XCircle className="h-5 w-5" />
                      Reject
                    </>
                  )}
                </button>
                <button
                  onClick={() => {
                    setSelectedEvidence(null);
                    setReviewNotes('');
                  }}
                  disabled={reviewMutation.isPending}
                  className="rounded-lg bg-white border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
