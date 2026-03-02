'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import apiClient from '@/lib/api';
import {
  FileText,
  Search,
  Upload,
  X,
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Calendar,
  User,
  CheckCircle,
  XCircle,
  Clock,
  Eye,
  Trash2,
} from 'lucide-react';

interface Assessment {
  id: number;
  name: string;
  assessment_type: string;
  source: string | null;
  file_name: string | null;
  status: string;
  due_date: string | null;
  assessor: string | null;
  overall_score: number | null;
  total_items: number | null;
  complied_count: number | null;
  partially_complied_count: number | null;
  not_complied_count: number | null;
  in_progress_count: number | null;
  na_count: number | null;
  created_at: string;
  updated_at: string | null;
}

interface AssessmentsResponse {
  assessments: Assessment[];
  total: number;
  summary: {
    total_assessments: number;
    total_items: number;
    total_complied: number;
    total_not_complied: number;
  };
}

const STATUS_OPTIONS = [
  { value: '', label: 'All Statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
];

const TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'gap_assessment', label: 'Gap Assessment' },
  { value: 'security_checklist', label: 'Security Checklist' },
  { value: 'internal_audit', label: 'Internal Audit' },
  { value: 'vendor_assessment', label: 'Vendor Assessment' },
  { value: 'compliance_review', label: 'Compliance Review' },
  { value: 'risk_assessment', label: 'Risk Assessment' },
  { value: 'other', label: 'Other' },
];

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-slate-500/20', text: 'text-slate-400', label: 'Draft' },
  in_progress: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'In Progress' },
  completed: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'Completed' },
  archived: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Archived' },
};

function getScoreColor(score: number | null): { bg: string; text: string } {
  if (score === null) return { bg: 'bg-slate-500/20', text: 'text-slate-400' };
  if (score >= 80) return { bg: 'bg-emerald-500/20', text: 'text-emerald-400' };
  if (score >= 50) return { bg: 'bg-amber-500/20', text: 'text-amber-400' };
  return { bg: 'bg-rose-500/20', text: 'text-rose-400' };
}

function getScoreBarColor(score: number | null): string {
  if (score === null) return 'bg-slate-600';
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 50) return 'bg-amber-500';
  return 'bg-rose-500';
}

export default function AssessmentsPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize] = useState(10);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadForm, setUploadForm] = useState({
    name: '',
    assessment_type: 'gap_assessment',
    source: '',
    due_date: '',
    assessor: '',
    notes: '',
  });
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [assessmentToDelete, setAssessmentToDelete] = useState<Assessment | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['compliance-assessments', statusFilter, typeFilter, sourceFilter, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string | number> = {
        skip: page * pageSize,
        limit: pageSize,
      };
      if (statusFilter) params.status_filter = statusFilter;
      if (typeFilter) params.assessment_type = typeFilter;
      if (sourceFilter) params.source = sourceFilter;

      const response = await apiClient.get('/compliance/assessments', { params });
      return response.data as AssessmentsResponse;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const response = await fetch('/api/compliance/assessments/upload', {
        method: 'POST',
        body: formData,
        credentials: 'include',
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Upload failed' }));
        throw new Error(errorData.detail || 'Failed to upload assessment');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compliance-assessments'] });
      setIsUploadModalOpen(false);
      resetUploadForm();
    },
    onError: (error: any) => {
      setUploadError(error.message || 'Failed to upload assessment');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (assessmentId: number) => {
      await apiClient.delete(`/compliance/assessments/${assessmentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['compliance-assessments'] });
      setDeleteModalOpen(false);
      setAssessmentToDelete(null);
      setDeleteError(null);
    },
    onError: (error: any) => {
      setDeleteError(error.response?.data?.detail || 'Failed to delete assessment');
    },
  });

  const handleDeleteClick = (assessment: Assessment) => {
    setAssessmentToDelete(assessment);
    setDeleteModalOpen(true);
    setDeleteError(null);
  };

  const confirmDelete = () => {
    if (assessmentToDelete) {
      deleteMutation.mutate(assessmentToDelete.id);
    }
  };

  const resetUploadForm = () => {
    setUploadForm({
      name: '',
      assessment_type: 'gap_assessment',
      source: '',
      due_date: '',
      assessor: '',
      notes: '',
    });
    setUploadFile(null);
    setUploadError(null);
  };

  const handleUploadSubmit = () => {
    if (!uploadFile || !uploadForm.name) {
      setUploadError('Please provide a name and select a file');
      return;
    }

    const formData = new FormData();
    formData.append('file', uploadFile);
    formData.append('name', uploadForm.name);
    formData.append('assessment_type', uploadForm.assessment_type);
    if (uploadForm.source) formData.append('source', uploadForm.source);
    if (uploadForm.due_date) formData.append('due_date', uploadForm.due_date);
    if (uploadForm.assessor) formData.append('assessor', uploadForm.assessor);
    if (uploadForm.notes) formData.append('notes', uploadForm.notes);

    uploadMutation.mutate(formData);
  };

  const assessments = data?.assessments || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize);

  const filteredAssessments = searchTerm
    ? assessments.filter(
        (a) =>
          a.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          a.source?.toLowerCase().includes(searchTerm.toLowerCase()) ||
          a.assessor?.toLowerCase().includes(searchTerm.toLowerCase())
      )
    : assessments;

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getDueDateStatus = (dueDate: string | null) => {
    if (!dueDate) return null;
    const due = new Date(dueDate);
    const now = new Date();
    const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays < 0) return { text: 'Overdue', color: 'text-rose-400' };
    if (diffDays <= 7) return { text: 'Due Soon', color: 'text-amber-400' };
    return null;
  };

  if (error) {
    return (
      <div className="card">
        <div className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="h-12 w-12 text-rose-400 mb-4" />
          <p className="text-slate-400">Failed to load assessments</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search assessments..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="input pl-10"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(0);
            }}
            className="select min-w-[150px]"
          >
            {TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(0);
            }}
            className="select min-w-[130px]"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <Link
            href="/compliance/assessments/approvals"
            className="btn-secondary flex items-center gap-2"
          >
            <Clock className="h-4 w-4" />
            Pending Approvals
          </Link>
          <button
            onClick={() => setIsUploadModalOpen(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Upload className="h-4 w-4" />
            Upload Assessment
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-primary-500/20 to-primary-600/10 p-3">
              <FileText className="h-6 w-6 text-primary-400" />
            </div>
          </div>
          <p className="stat-value">{data?.summary?.total_assessments || 0}</p>
          <p className="stat-label">Total Assessments</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-600/10 p-3">
              <Clock className="h-6 w-6 text-blue-400" />
            </div>
          </div>
          <p className="stat-value">{data?.summary?.total_items || 0}</p>
          <p className="stat-label">Total Items</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 p-3">
              <CheckCircle className="h-6 w-6 text-emerald-400" />
            </div>
          </div>
          <p className="stat-value">{data?.summary?.total_complied || 0}</p>
          <p className="stat-label">Complied Items</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-rose-500/20 to-rose-600/10 p-3">
              <XCircle className="h-6 w-6 text-rose-400" />
            </div>
          </div>
          <p className="stat-value">{data?.summary?.total_not_complied || 0}</p>
          <p className="stat-label">Non-Complied Items</p>
        </div>
      </div>

      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Source</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Due Date</th>
              <th>Assessor</th>
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
            ) : filteredAssessments.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center py-8">
                  <FileText className="h-12 w-12 text-slate-500 mx-auto mb-3" />
                  <p className="text-slate-400">No assessments found</p>
                  <p className="text-sm text-slate-500 mt-1">
                    Upload an Excel or CSV file to create a new assessment
                  </p>
                </td>
              </tr>
            ) : (
              filteredAssessments.map((assessment) => {
                const statusStyle = STATUS_STYLES[assessment.status] || STATUS_STYLES.draft;
                const scoreColor = getScoreColor(assessment.overall_score);
                const dueDateStatus = getDueDateStatus(assessment.due_date);

                return (
                  <tr key={assessment.id}>
                    <td>
                      <Link
                        href={`/compliance/assessments/${assessment.id}`}
                        className="font-medium text-white hover:text-primary-400 transition-colors"
                      >
                        {assessment.name}
                      </Link>
                      <p className="text-xs text-slate-500">{assessment.file_name}</p>
                    </td>
                    <td>
                      <span className="text-sm capitalize">
                        {assessment.assessment_type.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td>
                      <span className="text-sm text-slate-400">
                        {assessment.source || '-'}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${statusStyle.bg} ${statusStyle.text}`}>
                        {statusStyle.label}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-2 min-w-[120px]">
                        <div className="flex-1 h-2 bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full ${getScoreBarColor(assessment.overall_score)} transition-all`}
                            style={{ width: `${assessment.overall_score || 0}%` }}
                          />
                        </div>
                        <span className={`text-sm font-medium ${scoreColor.text}`}>
                          {assessment.overall_score !== null
                            ? `${Math.round(assessment.overall_score)}%`
                            : '-'}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-col">
                        <span className="text-sm">{formatDate(assessment.due_date)}</span>
                        {dueDateStatus && (
                          <span className={`text-xs ${dueDateStatus.color}`}>
                            {dueDateStatus.text}
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <User className="h-4 w-4 text-slate-500" />
                        <span className="text-sm text-slate-400">
                          {assessment.assessor || '-'}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="flex items-center gap-1">
                        <Link
                          href={`/compliance/assessments/${assessment.id}`}
                          className="btn-ghost btn-sm"
                          title="View Assessment"
                        >
                          <Eye className="h-4 w-4" />
                        </Link>
                        <button
                          onClick={() => handleDeleteClick(assessment)}
                          className="btn-ghost btn-sm text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                          title="Delete Assessment"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-400">
            Showing {page * pageSize + 1} to {Math.min((page + 1) * pageSize, total)} of{' '}
            {total} assessments
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="btn-secondary btn-sm"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm text-slate-400">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="btn-secondary btn-sm"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {isUploadModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-slate-700">
              <div>
                <h2 className="text-lg font-semibold text-white">Upload Assessment</h2>
                <p className="text-sm text-slate-400">
                  Upload an Excel or CSV file with assessment data
                </p>
              </div>
              <button
                onClick={() => {
                  setIsUploadModalOpen(false);
                  resetUploadForm();
                }}
                className="btn-ghost btn-sm"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {uploadError && (
                <div className="bg-rose-500/20 border border-rose-500/30 rounded-lg p-3 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-rose-400" />
                  <p className="text-sm text-rose-300">{uploadError}</p>
                </div>
              )}

              <div>
                <label className="label">Assessment Name *</label>
                <input
                  type="text"
                  value={uploadForm.name}
                  onChange={(e) => setUploadForm({ ...uploadForm, name: e.target.value })}
                  className="input"
                  placeholder="e.g., Q1 2026 Security Assessment"
                />
              </div>

              <div>
                <label className="label">Assessment Type *</label>
                <select
                  value={uploadForm.assessment_type}
                  onChange={(e) =>
                    setUploadForm({ ...uploadForm, assessment_type: e.target.value })
                  }
                  className="select"
                >
                  {TYPE_OPTIONS.filter((o) => o.value).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="label">Source</label>
                <input
                  type="text"
                  value={uploadForm.source}
                  onChange={(e) => setUploadForm({ ...uploadForm, source: e.target.value })}
                  className="input"
                  placeholder="e.g., External Auditor, Internal Team"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Due Date</label>
                  <input
                    type="date"
                    value={uploadForm.due_date}
                    onChange={(e) =>
                      setUploadForm({ ...uploadForm, due_date: e.target.value })
                    }
                    className="input"
                  />
                </div>
                <div>
                  <label className="label">Assessor</label>
                  <input
                    type="text"
                    value={uploadForm.assessor}
                    onChange={(e) =>
                      setUploadForm({ ...uploadForm, assessor: e.target.value })
                    }
                    className="input"
                    placeholder="Assessor name"
                  />
                </div>
              </div>

              <div>
                <label className="label">Notes</label>
                <textarea
                  value={uploadForm.notes}
                  onChange={(e) => setUploadForm({ ...uploadForm, notes: e.target.value })}
                  className="input min-h-[80px]"
                  placeholder="Additional notes about this assessment"
                />
              </div>

              <div>
                <label className="label">Assessment File *</label>
                <div className="border-2 border-dashed border-slate-600 rounded-lg p-6 text-center hover:border-slate-500 transition-colors">
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                    className="hidden"
                    id="file-upload"
                  />
                  <label htmlFor="file-upload" className="cursor-pointer">
                    <Upload className="h-8 w-8 text-slate-500 mx-auto mb-2" />
                    {uploadFile ? (
                      <p className="text-white">{uploadFile.name}</p>
                    ) : (
                      <>
                        <p className="text-slate-400">Click to upload or drag and drop</p>
                        <p className="text-sm text-slate-500">Excel (.xlsx, .xls) or CSV</p>
                      </>
                    )}
                  </label>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-700">
              <button
                onClick={() => {
                  setIsUploadModalOpen(false);
                  resetUploadForm();
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleUploadSubmit}
                disabled={uploadMutation.isPending || !uploadFile || !uploadForm.name}
                className="btn-primary flex items-center gap-2"
              >
                {uploadMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4" />
                )}
                Upload Assessment
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteModalOpen && assessmentToDelete && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl w-full max-w-md">
            <div className="flex items-center justify-between p-6 border-b border-slate-700">
              <h2 className="text-lg font-semibold text-white">Delete Assessment</h2>
              <button
                onClick={() => {
                  setDeleteModalOpen(false);
                  setAssessmentToDelete(null);
                }}
                className="btn-ghost btn-sm"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6">
              {deleteError && (
                <div className="bg-rose-500/20 border border-rose-500/30 rounded-lg p-3 flex items-center gap-2 mb-4">
                  <AlertCircle className="h-4 w-4 text-rose-400 flex-shrink-0" />
                  <p className="text-sm text-rose-300">{deleteError}</p>
                </div>
              )}
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-shrink-0 w-10 h-10 bg-rose-500/20 rounded-full flex items-center justify-center">
                  <AlertCircle className="h-5 w-5 text-rose-400" />
                </div>
                <div>
                  <p className="text-white">Are you sure you want to delete this assessment?</p>
                  <p className="text-sm text-slate-400 mt-1">
                    <strong>{assessmentToDelete.name}</strong>
                  </p>
                </div>
              </div>
              <p className="text-sm text-slate-400">
                This will permanently delete the assessment and all its items. This action cannot be undone.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 p-6 border-t border-slate-700">
              <button
                onClick={() => {
                  setDeleteModalOpen(false);
                  setAssessmentToDelete(null);
                }}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleteMutation.isPending}
                className="bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 disabled:opacity-50"
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Delete Assessment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
