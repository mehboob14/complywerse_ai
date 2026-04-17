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
  Sparkles,
} from 'lucide-react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';

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
  draft: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Draft' },
  in_progress: { bg: 'bg-blue-50', text: 'text-blue-700', label: 'In Progress' },
  completed: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Completed' },
  archived: { bg: 'bg-gray-100', text: 'text-gray-500', label: 'Archived' },
};

const STATUS_CHART_COLORS: Record<string, string> = {
  draft: '#94A3B8',
  in_progress: '#3B82F6',
  completed: '#10B981',
  archived: '#6B7280',
};

function getScoreColor(score: number | null): { bg: string; text: string } {
  if (score === null) return { bg: 'bg-gray-100', text: 'text-gray-500' };
  if (score >= 80) return { bg: 'bg-emerald-50', text: 'text-emerald-700' };
  if (score >= 50) return { bg: 'bg-amber-50', text: 'text-amber-700' };
  return { bg: 'bg-red-50', text: 'text-red-700' };
}

function getScoreBarColor(score: number | null): string {
  if (score === null) return 'bg-gray-200';
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 50) return 'bg-amber-500';
  return 'bg-red-500';
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
  const [aiContext, setAiContext] = useState<{
    summary: string;
    risk_perspective: string;
    compliance_perspective: string;
    generated_by?: string;
  } | null>(null);
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

  const aiContextMutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.post('/compliance/assessments/ai-context', {
        name: uploadForm.name,
        assessment_type: uploadForm.assessment_type,
        source: uploadForm.source || undefined,
        notes: uploadForm.notes || undefined,
      });
      return response.data as {
        summary: string;
        risk_perspective: string;
        compliance_perspective: string;
        generated_by?: string;
      };
    },
    onSuccess: (data) => {
      setAiContext(data);
    },
    onError: () => {
      setUploadError('Failed to generate AI context. Please try again.');
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
    setAiContext(null);
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

  const statusChartData = Object.entries(
    filteredAssessments.reduce<Record<string, number>>((acc, assessment) => {
      acc[assessment.status] = (acc[assessment.status] || 0) + 1;
      return acc;
    }, {})
  )
    .map(([status, value]) => ({
      name: STATUS_STYLES[status]?.label || status.replace(/_/g, ' '),
      status,
      value,
      color: STATUS_CHART_COLORS[status] || '#64748B',
    }))
    .sort((a, b) => b.value - a.value);

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
    if (diffDays < 0) return { text: 'Overdue', color: 'text-rose-600' };
    if (diffDays <= 7) return { text: 'Due Soon', color: 'text-amber-600' };
    return null;
  };

  if (error) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
        <div className="flex flex-col items-center justify-center py-12">
          <AlertCircle className="h-12 w-12 text-rose-600 mb-4" />
          <p className="text-gray-600">Failed to load assessments</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search assessments..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-white border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-black placeholder-gray-400"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <select
            value={typeFilter}
            onChange={(e) => {
              setTypeFilter(e.target.value);
              setPage(0);
            }}
            className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-black focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[150px]"
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
            className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-black focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-w-[130px]"
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <Link
            href="/compliance/assessments/approvals"
            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-2 font-medium"
          >
            <Clock className="h-4 w-4" />
            Pending Approvals
          </Link>
          <button
            onClick={() => setIsUploadModalOpen(true)}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 font-medium"
          >
            <Upload className="h-4 w-4" />
            Upload Assessment
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm hover:shadow-md hover:border-gray-300 transition-all duration-200">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-blue-50 p-3">
              <FileText className="h-6 w-6 text-blue-600" />
            </div>
          </div>
          <p className="text-3xl font-bold text-black mt-4">{data?.summary?.total_assessments || 0}</p>
          <p className="text-sm text-gray-600 mt-1">Total Assessments</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm hover:shadow-md hover:border-gray-300 transition-all duration-200">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-purple-50 p-3">
              <Clock className="h-6 w-6 text-purple-600" />
            </div>
          </div>
          <p className="text-3xl font-bold text-black mt-4">{data?.summary?.total_items || 0}</p>
          <p className="text-sm text-gray-600 mt-1">Total Items</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm hover:shadow-md hover:border-gray-300 transition-all duration-200">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-emerald-50 p-3">
              <CheckCircle className="h-6 w-6 text-emerald-600" />
            </div>
          </div>
          <p className="text-3xl font-bold text-black mt-4">{data?.summary?.total_complied || 0}</p>
          <p className="text-sm text-gray-600 mt-1">Complied Items</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm hover:shadow-md hover:border-gray-300 transition-all duration-200">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-rose-50 p-3">
              <XCircle className="h-6 w-6 text-rose-600" />
            </div>
          </div>
          <p className="text-3xl font-bold text-black mt-4">{data?.summary?.total_not_complied || 0}</p>
          <p className="text-sm text-gray-600 mt-1">Non-Complied Items</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Status Distribution Donut with inline legend */}
        <div className="rounded-xl border border-gray-200 bg-white p-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-black">Assessment Status Distribution</h3>
            <p className="text-xs text-gray-500">Breakdown of assessments by current status</p>
          </div>
          {statusChartData.length === 0 ? (
            <div className="flex h-52 items-center justify-center text-sm text-gray-400">
              No assessments loaded yet
            </div>
          ) : (
            <div className="flex items-center gap-6">
              <div className="h-44 w-44 flex-shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusChartData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={44}
                      outerRadius={66}
                      stroke="none"
                      paddingAngle={2}
                    >
                      {statusChartData.map((entry) => (
                        <Cell key={entry.status} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: '#fff',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        color: '#111827',
                        fontSize: 12,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex-1 space-y-2.5">
                {statusChartData.map((item) => (
                  <div key={item.status} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                      <span className="text-sm text-gray-700">{item.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-bold text-black">{item.value}</span>
                      <span className="text-xs text-gray-400">
                        {statusChartData.reduce((s, d) => s + d.value, 0) > 0
                          ? Math.round((item.value / statusChartData.reduce((s, d) => s + d.value, 0)) * 100)
                          : 0}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Compliance Items Breakdown – stacked bar */}
        {(() => {
          const totalComplied = filteredAssessments.reduce((s, a) => s + (a.complied_count || 0), 0);
          const totalPartial = filteredAssessments.reduce((s, a) => s + (a.partially_complied_count || 0), 0);
          const totalNotComplied = filteredAssessments.reduce((s, a) => s + (a.not_complied_count || 0), 0);
          const totalNA = filteredAssessments.reduce((s, a) => s + (a.na_count || 0), 0);
          const grandTotal = totalComplied + totalPartial + totalNotComplied + totalNA;
          const breakdownData = [
            { name: 'Complied', value: totalComplied, color: '#22c55e' },
            { name: 'Partial', value: totalPartial, color: '#eab308' },
            { name: 'Not Complied', value: totalNotComplied, color: '#ef4444' },
            { name: 'N/A', value: totalNA, color: '#94a3b8' },
          ].filter((d) => d.value > 0);

          return (
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-black">Compliance Items Breakdown</h3>
                <p className="text-xs text-gray-500">Total items by compliance outcome across all assessments</p>
              </div>
              {grandTotal === 0 ? (
                <div className="flex h-52 items-center justify-center text-sm text-gray-400">
                  No items data available
                </div>
              ) : (
                <div className="space-y-5">
                  {/* Stacked proportion bar */}
                  <div>
                    <div className="flex h-6 w-full overflow-hidden rounded-lg">
                      {breakdownData.map((d) => (
                        <div
                          key={d.name}
                          style={{ width: `${(d.value / grandTotal) * 100}%`, backgroundColor: d.color }}
                          title={`${d.name}: ${d.value}`}
                        />
                      ))}
                    </div>
                    <div className="mt-1 flex justify-between text-[10px] text-gray-400">
                      <span>0</span>
                      <span>{grandTotal.toLocaleString()} items</span>
                    </div>
                  </div>
                  {/* Legend with counts */}
                  <div className="grid grid-cols-2 gap-3">
                    {breakdownData.map((d) => (
                      <div key={d.name} className="flex items-center gap-2.5 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
                        <span className="h-3 w-3 flex-shrink-0 rounded-sm" style={{ backgroundColor: d.color }} />
                        <div>
                          <p className="text-xs text-gray-500">{d.name}</p>
                          <p className="text-sm font-bold text-black">{d.value.toLocaleString()}</p>
                          <p className="text-[10px] text-gray-400">{Math.round((d.value / grandTotal) * 100)}%</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Source</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Progress</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Due Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Assessor</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="text-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-blue-600" />
                  </td>
                </tr>
              ) : filteredAssessments.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8">
                    <FileText className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                    <p className="text-gray-600">No assessments found</p>
                    <p className="text-sm text-gray-500 mt-1">
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
                    <tr key={assessment.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <Link
                          href={`/compliance/assessments/${assessment.id}`}
                          className="font-medium text-blue-600 hover:text-blue-700 transition-colors"
                        >
                          {assessment.name}
                        </Link>
                        <p className="text-xs text-gray-500">{assessment.file_name}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm capitalize text-gray-700">
                          {assessment.assessment_type.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-sm text-gray-600">
                          {assessment.source || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 text-xs font-medium rounded ${statusStyle.bg} ${statusStyle.text}`}>
                          {statusStyle.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 min-w-[120px]">
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
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
                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="text-sm text-gray-700">{formatDate(assessment.due_date)}</span>
                          {dueDateStatus && (
                            <span className={`text-xs font-medium ${dueDateStatus.color}`}>
                              {dueDateStatus.text}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <User className="h-4 w-4 text-gray-400" />
                          <span className="text-sm text-gray-600">
                            {assessment.assessor || '-'}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <Link
                            href={`/compliance/assessments/${assessment.id}`}
                            className="p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="View Assessment"
                          >
                            <Eye className="h-4 w-4" />
                          </Link>
                          <button
                            onClick={() => handleDeleteClick(assessment)}
                            className="p-2 text-gray-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
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
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between bg-white border border-gray-200 rounded-lg px-4 py-3 shadow-sm">
          <p className="text-sm text-gray-600">
            Showing {page * pageSize + 1} to {Math.min((page + 1) * pageSize, total)} of{' '}
            {total} assessments
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm text-gray-700 font-medium">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {isUploadModalOpen && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <div>
                <h2 className="text-lg font-semibold text-black">Upload Assessment</h2>
                <p className="text-sm text-gray-600">
                  Upload an Excel or CSV file with assessment data
                </p>
              </div>
              <button
                onClick={() => {
                  setIsUploadModalOpen(false);
                  resetUploadForm();
                }}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {uploadError && (
                <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-rose-600" />
                  <p className="text-sm text-rose-700">{uploadError}</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Assessment Name *</label>
                <input
                  type="text"
                  value={uploadForm.name}
                  onChange={(e) => setUploadForm({ ...uploadForm, name: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g., Q1 2026 Security Assessment"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Assessment Type *</label>
                <select
                  value={uploadForm.assessment_type}
                  onChange={(e) =>
                    setUploadForm({ ...uploadForm, assessment_type: e.target.value })
                  }
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-black focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  {TYPE_OPTIONS.filter((o) => o.value).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Source</label>
                <input
                  type="text"
                  value={uploadForm.source}
                  onChange={(e) => setUploadForm({ ...uploadForm, source: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="e.g., External Auditor, Internal Team"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
                  <input
                    type="date"
                    value={uploadForm.due_date}
                    onChange={(e) =>
                      setUploadForm({ ...uploadForm, due_date: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-black focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Assessor</label>
                  <input
                    type="text"
                    value={uploadForm.assessor}
                    onChange={(e) =>
                      setUploadForm({ ...uploadForm, assessor: e.target.value })
                    }
                    className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="Assessor name"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={uploadForm.notes}
                  onChange={(e) => setUploadForm({ ...uploadForm, notes: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-black placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 min-h-[80px] resize-none"
                  placeholder="Additional notes about this assessment"
                />
              </div>

              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-blue-700">AI Assessment Context</p>
                    <p className="text-xs text-gray-600 mt-0.5">Generate what this assessment covers and how it helps risk and compliance outcomes.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => aiContextMutation.mutate()}
                    disabled={aiContextMutation.isPending || !uploadForm.name.trim()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {aiContextMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    Generate
                  </button>
                </div>
                {aiContext && (
                  <div className="mt-3 space-y-2 rounded-lg border border-blue-200 bg-white p-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Assessment Summary</p>
                      <p className="text-sm text-gray-700">{aiContext.summary}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Risk Perspective</p>
                      <p className="text-sm text-gray-700">{aiContext.risk_perspective}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-600">Compliance Perspective</p>
                      <p className="text-sm text-gray-700">{aiContext.compliance_perspective}</p>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Assessment File *</label>
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-gray-400 transition-colors bg-gray-50">
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                    className="hidden"
                    id="file-upload"
                  />
                  <label htmlFor="file-upload" className="cursor-pointer">
                    <Upload className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                    {uploadFile ? (
                      <p className="text-black font-medium">{uploadFile.name}</p>
                    ) : (
                      <>
                        <p className="text-gray-600">Click to upload or drag and drop</p>
                        <p className="text-sm text-gray-500">Excel (.xlsx, .xls) or CSV</p>
                      </>
                    )}
                  </label>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 bg-gray-50">
              <button
                onClick={() => {
                  setIsUploadModalOpen(false);
                  resetUploadForm();
                }}
                className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleUploadSubmit}
                disabled={uploadMutation.isPending || !uploadFile || !uploadForm.name}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
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
          <div className="bg-white rounded-xl w-full max-w-md shadow-xl">
            <div className="flex items-center justify-between p-6 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-black">Delete Assessment</h2>
              <button
                onClick={() => {
                  setDeleteModalOpen(false);
                  setAssessmentToDelete(null);
                }}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6">
              {deleteError && (
                <div className="bg-rose-50 border border-rose-200 rounded-lg p-3 flex items-center gap-2 mb-4">
                  <AlertCircle className="h-4 w-4 text-rose-600 flex-shrink-0" />
                  <p className="text-sm text-rose-700">{deleteError}</p>
                </div>
              )}
              <div className="flex items-center gap-3 mb-4">
                <div className="flex-shrink-0 w-10 h-10 bg-rose-50 rounded-full flex items-center justify-center">
                  <AlertCircle className="h-5 w-5 text-rose-600" />
                </div>
                <div>
                  <p className="text-black">Are you sure you want to delete this assessment?</p>
                  <p className="text-sm text-gray-600 mt-1">
                    <strong>{assessmentToDelete.name}</strong>
                  </p>
                </div>
              </div>
              <p className="text-sm text-gray-600">
                This will permanently delete the assessment and all its items. This action cannot be undone.
              </p>
            </div>

            <div className="flex items-center justify-end gap-3 p-6 border-t border-gray-200 bg-gray-50">
              <button
                onClick={() => {
                  setDeleteModalOpen(false);
                  setAssessmentToDelete(null);
                }}
                className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 font-medium hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleteMutation.isPending}
                className="bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-lg font-medium flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
