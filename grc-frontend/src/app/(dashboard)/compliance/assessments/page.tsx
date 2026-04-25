'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePermissions } from '@/hooks/usePermissions';
import Link from 'next/link';
import apiClient, { AdminUser, adminApi } from '@/lib/api';
import { SearchInput, MultiSelectDropdown } from '@/components/ui';
import {
  FileText,
  Upload,
  X,
  Loader2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  User,
  Eye,
  Trash2,
  Sparkles,
  LayoutDashboard,
  ClipboardCheck,
} from 'lucide-react';
import {
  ResponsiveContainer,
  RadialBarChart,
  RadialBar,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Legend,
  BarChart,
  Bar,
  Sankey,
} from 'recharts';

interface Assessment {
  id: number;
  name: string;
  assessment_type: string;
  assessment_format?: string;
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
    total_partial?: number;
    total_not_complied: number;
    total_in_progress?: number;
    total_na?: number;
    average_overall_score?: number | null;
    overdue_count?: number;
    due_soon_count?: number;
    by_type?: Record<string, number>;
    by_status?: Record<string, number>;
    by_format?: Record<string, number>;
  };
}

interface TenantUserOption {
  id: number;
  display_name: string;
  email: string;
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
  draft: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'Draft' },
  in_progress: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'In Progress' },
  completed: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Completed' },
  archived: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Archived' },
};

const REQUIREMENT_STATUS_COLORS: Record<string, string> = {
  not_started: '#64748b',
  not_compliant: '#ef4444',
  partial_compliant: '#f59e0b',
  fully_compliant: '#22c55e',
  out_of_scope: '#cbd5e1',
};

const ASSESSMENT_TYPE_COLORS = [
  '#0284c7',
  '#7c3aed',
  '#0d9488',
  '#ea580c',
  '#db2777',
  '#059669',
  '#4f46e5',
];

const ASSESSMENT_STATUS_COLORS: Record<string, string> = {
  draft: '#94a3b8',
  in_progress: '#3b82f6',
  completed: '#22c55e',
  archived: '#64748b',
};

const chartTooltipStyle = {
  borderRadius: '0.5rem',
  border: '1px solid #e2e8f0',
  fontSize: '12px',
  color: '#0f172a',
};

function getScoreColor(score: number | null): { bg: string; text: string } {
  if (score === null) return { bg: 'bg-slate-100', text: 'text-slate-600' };
  if (score >= 80) return { bg: 'bg-emerald-100', text: 'text-emerald-700' };
  if (score >= 50) return { bg: 'bg-amber-100', text: 'text-amber-700' };
  return { bg: 'bg-rose-100', text: 'text-rose-700' };
}

function getScoreBarColor(score: number | null): string {
  if (score === null) return 'bg-slate-300';
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 50) return 'bg-amber-500';
  return 'bg-rose-500';
}

function formatAssessmentType(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatDate(dateString: string | null) {
  if (!dateString) return '-';
  return new Date(dateString).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function getDueDateStatus(dueDate: string | null) {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  const now = new Date();
  const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { text: 'Overdue', color: 'text-rose-600' };
  if (diffDays <= 7) return { text: 'Due Soon', color: 'text-amber-600' };
  return null;
}

function shortMonthLabel(dateString: string) {
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return dateString;
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

export default function AssessmentsPage() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('compliance:assessments:create');
  const canDelete = hasPermission('compliance:assessments:delete');

  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize] = useState(12);
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
  const [chartsReady, setChartsReady] = useState(false);
  const [activeView, setActiveView] = useState<'overview' | 'assessment'>('overview');

  const queryClient = useQueryClient();

  useEffect(() => {
    setChartsReady(true);
  }, []);

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

  const { data: assessorUsers = [] } = useQuery<TenantUserOption[]>({
    queryKey: ['compliance-assessment-assessor-users'],
    queryFn: async () => {
      try {
        const response = await apiClient.get('/assets/tenant-users');
        const users = Array.isArray(response.data) ? response.data : [];
        return users
          .map((user: any) => ({
            id: Number(user?.id),
            display_name: String(user?.display_name || user?.username || '').trim(),
            email: String(user?.email || '').trim(),
          }))
          .filter((user: TenantUserOption) => Number.isFinite(user.id) && user.id > 0 && !!user.display_name);
      } catch {
        try {
          const fallback = await adminApi.getUsers();
          const users = Array.isArray(fallback.data) ? fallback.data : [];
          return users
            .map((user: AdminUser) => ({
              id: Number(user.id),
              display_name: String(user.display_name || user.username || '').trim(),
              email: String(user.email || '').trim(),
            }))
            .filter((user: TenantUserOption) => Number.isFinite(user.id) && user.id > 0 && !!user.display_name);
        } catch {
          return [];
        }
      }
    },
    enabled: isUploadModalOpen && canCreate,
    staleTime: 5 * 60 * 1000,
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
    onError: (err: any) => {
      setUploadError(err.message || 'Failed to upload assessment');
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
    onError: (err: any) => {
      setDeleteError(err.response?.data?.detail || 'Failed to delete assessment');
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
    onSuccess: (responseData) => {
      setAiContext(responseData);
    },
    onError: () => {
      setUploadError('Failed to generate AI context. Please try again.');
    },
  });

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

  const assessments = data?.assessments || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / pageSize);

  const filteredAssessments = useMemo(() => {
    if (!searchTerm.trim()) return assessments;
    const q = searchTerm.toLowerCase();
    return assessments.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.source || '').toLowerCase().includes(q) ||
        (a.assessor || '').toLowerCase().includes(q) ||
      (a.file_name || '').toLowerCase().includes(q),
    );
  }, [assessments, searchTerm]);

  const recentAssessments = useMemo(() => {
    return [...assessments]
      .sort((a, b) => {
        const aTime = new Date(a.created_at).getTime();
        const bTime = new Date(b.created_at).getTime();
        return bTime - aTime;
      })
      .slice(0, 4);
  }, [assessments]);

  const summary = data?.summary;

  const sourceOptions = useMemo(() => {
    const uniq = new Set<string>();
    assessments.forEach((a) => {
      if (a.source && a.source.trim()) uniq.add(a.source.trim());
    });
    return Array.from(uniq).sort((a, b) => a.localeCompare(b));
  }, [assessments]);

  const requirementStatusData = useMemo(() => {
    const fromSummary = {
      not_started: summary?.total_in_progress || 0,
      not_compliant: summary?.total_not_complied || 0,
      partial_compliant: summary?.total_partial || 0,
      fully_compliant: summary?.total_complied || 0,
      out_of_scope: summary?.total_na || 0,
    };
    const summaryTotal = Object.values(fromSummary).reduce((acc, value) => acc + value, 0);
    if (summaryTotal > 0) return fromSummary;

    return filteredAssessments.reduce(
      (acc, assessment) => {
        acc.not_started += assessment.in_progress_count || 0;
        acc.not_compliant += assessment.not_complied_count || 0;
        acc.partial_compliant += assessment.partially_complied_count || 0;
        acc.fully_compliant += assessment.complied_count || 0;
        acc.out_of_scope += assessment.na_count || 0;
        return acc;
      },
      { not_started: 0, not_compliant: 0, partial_compliant: 0, fully_compliant: 0, out_of_scope: 0 },
    );
  }, [summary, filteredAssessments]);

  const statusRingData = useMemo(() => {
    const rows = [
      { key: 'not_started', label: 'Not Started', value: requirementStatusData.not_started },
      { key: 'not_compliant', label: 'Not Compliant', value: requirementStatusData.not_compliant },
      { key: 'partial_compliant', label: 'Partial Compliant', value: requirementStatusData.partial_compliant },
      { key: 'fully_compliant', label: 'Fully Compliant', value: requirementStatusData.fully_compliant },
      { key: 'out_of_scope', label: 'Out of Scope', value: requirementStatusData.out_of_scope },
    ];
    return rows.map((row) => ({
      ...row,
      color: REQUIREMENT_STATUS_COLORS[row.key] || '#94a3b8',
    }));
  }, [requirementStatusData]);

  const totalRequirements = useMemo(
    () => statusRingData.reduce((acc, row) => acc + row.value, 0),
    [statusRingData],
  );

  const complianceHealthPercent = useMemo(() => {
    if (totalRequirements <= 0) return 0;
    const weightedCompliant =
      requirementStatusData.fully_compliant + requirementStatusData.partial_compliant * 0.5;
    return Math.round((weightedCompliant / totalRequirements) * 100);
  }, [totalRequirements, requirementStatusData]);

  const passedRequirementsPercent = useMemo(() => {
    if (totalRequirements <= 0) return 0;
    return Math.round((requirementStatusData.fully_compliant / totalRequirements) * 100);
  }, [totalRequirements, requirementStatusData.fully_compliant]);

  const assessedRequirementsPercent = useMemo(() => {
    if (totalRequirements <= 0) return 0;
    const assessed =
      requirementStatusData.fully_compliant +
      requirementStatusData.partial_compliant +
      requirementStatusData.not_compliant +
      requirementStatusData.out_of_scope;
    return Math.round((assessed / totalRequirements) * 100);
  }, [totalRequirements, requirementStatusData]);

  const healthEquivalentCount = useMemo(() => {
    if (totalRequirements <= 0) return 0;
    return Math.round((complianceHealthPercent / 100) * totalRequirements);
  }, [complianceHealthPercent, totalRequirements]);

  const monthlyTrendData = useMemo(() => {
    const buckets = new Map<
      string,
      { key: string; month: string; total: number; completed: number; in_progress: number; draft: number; archived: number }
    >();

    filteredAssessments.forEach((assessment) => {
      const created = new Date(assessment.created_at);
      if (Number.isNaN(created.getTime())) return;
      const key = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}`;
      if (!buckets.has(key)) {
        buckets.set(key, {
          key,
          month: shortMonthLabel(created.toISOString()),
          total: 0,
          completed: 0,
          in_progress: 0,
          draft: 0,
          archived: 0,
        });
      }
      const bucket = buckets.get(key)!;
      bucket.total += 1;
      const statusKey = assessment.status as 'draft' | 'in_progress' | 'completed' | 'archived';
      if (statusKey in bucket) {
        bucket[statusKey] += 1;
      }
    });

    return Array.from(buckets.values())
      .sort((a, b) => a.key.localeCompare(b.key))
      .slice(-8)
      .map(({ key, ...row }) => row);
  }, [filteredAssessments]);

  const typeStatusMatrix = useMemo(() => {
    const matrix: Record<string, Record<string, number>> = {};
    filteredAssessments.forEach((assessment) => {
      const typeLabel = formatAssessmentType(assessment.assessment_type || 'other');
      const statusKey = assessment.status || 'draft';
      if (!matrix[typeLabel]) {
        matrix[typeLabel] = { draft: 0, in_progress: 0, completed: 0, archived: 0 };
      }
      matrix[typeLabel][statusKey] = (matrix[typeLabel][statusKey] || 0) + 1;
    });
    return matrix;
  }, [filteredAssessments]);

  const sankeyFlowData = useMemo(() => {
    const typeLabels = Object.keys(typeStatusMatrix);
    const statusLabels = ['draft', 'in_progress', 'completed', 'archived']
      .filter((statusKey) => typeLabels.some((type) => (typeStatusMatrix[type]?.[statusKey] || 0) > 0))
      .map((statusKey) => ({ key: statusKey, name: STATUS_STYLES[statusKey]?.label || statusKey }));

    const nodes = [
      ...typeLabels.map((type) => ({ name: type })),
      ...statusLabels.map((status) => ({ name: status.name })),
    ];

    const links: Array<{ source: number; target: number; value: number }> = [];
    typeLabels.forEach((type, typeIndex) => {
      statusLabels.forEach((status, statusIndex) => {
        const value = typeStatusMatrix[type]?.[status.key] || 0;
        if (value > 0) {
          links.push({
            source: typeIndex,
            target: typeLabels.length + statusIndex,
            value,
          });
        }
      });
    });

    return { nodes, links };
  }, [typeStatusMatrix]);

  const timelineData = useMemo(() => {
    const now = new Date();
    const dayMs = 1000 * 60 * 60 * 24;

    return filteredAssessments
      .filter((assessment) => !!assessment.due_date)
      .map((assessment) => {
        const created = new Date(assessment.created_at);
        const due = new Date(assessment.due_date as string);
        const totalDays = Math.max(Math.round((due.getTime() - created.getTime()) / dayMs), 1);
        const elapsed = Math.min(Math.max(Math.round((now.getTime() - created.getTime()) / dayMs), 0), totalDays);
        const remaining = Math.max(Math.round((due.getTime() - now.getTime()) / dayMs), 0);
        const overdue = Math.max(Math.round((now.getTime() - due.getTime()) / dayMs), 0);
        return {
          name: assessment.name.length > 24 ? `${assessment.name.slice(0, 24)}...` : assessment.name,
          elapsed: Math.max(elapsed, 0),
          remaining: Math.max(remaining, 0),
          overdue: Math.max(overdue, 0),
          due: formatDate(assessment.due_date),
        };
      })
      .sort((a, b) => a.remaining - b.remaining)
      .slice(0, 8);
  }, [filteredAssessments]);

  const sunburstInnerData = useMemo(() => {
    const byType: Record<string, number> = {};
    filteredAssessments.forEach((assessment) => {
      const typeLabel = formatAssessmentType(assessment.assessment_type || 'other');
      byType[typeLabel] = (byType[typeLabel] || 0) + 1;
    });
    return Object.entries(byType).map(([name, value], index) => ({
      name,
      value,
      color: ASSESSMENT_TYPE_COLORS[index % ASSESSMENT_TYPE_COLORS.length],
    }));
  }, [filteredAssessments]);

  const sunburstOuterData = useMemo(() => {
    const rows: Array<{ name: string; value: number; color: string }> = [];
    Object.entries(typeStatusMatrix).forEach(([type, statusMap]) => {
      Object.entries(statusMap).forEach(([status, value]) => {
        if (value > 0) {
          rows.push({
            name: `${type} • ${STATUS_STYLES[status]?.label || status}`,
            value,
            color: ASSESSMENT_STATUS_COLORS[status] || '#94a3b8',
          });
        }
      });
    });
    return rows;
  }, [typeStatusMatrix]);

  const renderChart = (chart: ReactNode) => {
    if (chartsReady) return chart;
    return (
      <div className="flex h-full items-center justify-center text-xs text-slate-400">
        Loading chart...
      </div>
    );
  };

  if (error) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8">
        <div className="flex flex-col items-center justify-center py-10">
          <AlertCircle className="mb-3 h-10 w-10 text-rose-600" />
          <p className="text-sm text-slate-600">Failed to load compliance assessments.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="border-b border-gray-200 overflow-x-auto">
        <div className="flex items-center gap-0 min-w-max">
          {[
            { id: 'overview' as const, label: 'Overview', icon: LayoutDashboard },
            { id: 'assessment' as const, label: 'Assessment', icon: ClipboardCheck },
          ].map(({ id, label, icon: Icon }) => {
            const isActive = activeView === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveView(id)}
                className={`inline-flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Icon size={14} />
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {activeView === 'assessment' && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1 min-w-[180px] sm:min-w-[260px]">
            <SearchInput
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search by name, source, assessor, file..."
              size="md"
            />
          </div>
          <MultiSelectDropdown
            title="Type"
            items={TYPE_OPTIONS.filter((o) => o.value).map((o) => ({ value: o.value, label: o.label }))}
            selectedValues={typeFilter ? [typeFilter] : []}
            onApply={(v) => { setTypeFilter(v[0] || ''); setPage(0); }}
            multiSelect={false}
            autoApply
            placeholder="All Types"
            size="md"
          />
          <MultiSelectDropdown
            title="Status"
            items={STATUS_OPTIONS.filter((o) => o.value).map((o) => ({ value: o.value, label: o.label }))}
            selectedValues={statusFilter ? [statusFilter] : []}
            onApply={(v) => { setStatusFilter(v[0] || ''); setPage(0); }}
            multiSelect={false}
            autoApply
            placeholder="All Statuses"
            size="md"
          />
          <MultiSelectDropdown
            title="Source"
            items={sourceOptions.map((s) => ({ value: s, label: s }))}
            selectedValues={sourceFilter ? [sourceFilter] : []}
            onApply={(v) => { setSourceFilter(v[0] || ''); setPage(0); }}
            multiSelect={false}
            autoApply
            placeholder="All Sources"
            size="md"
          />
          {canCreate && (
            <button
              onClick={() => setIsUploadModalOpen(true)}
              className="ml-auto inline-flex shrink-0 items-center gap-2 rounded-lg bg-blue-600 px-3 sm:px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
            >
              <Upload className="h-4 w-4" />
              <span className="hidden sm:inline">Upload Assessment</span>
              <span className="sm:hidden">Upload</span>
            </button>
          )}
        </div>
      )}

      {activeView === 'overview' && (
        <>
        <section className="grid grid-cols-1 gap-3 xl:grid-cols-12">
        <div className="rounded-xl border border-slate-200 bg-white p-4 xl:col-span-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Compliance Health</p>
          <div className="relative h-52">
            {renderChart(
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart
                  data={[{ name: 'health', value: complianceHealthPercent, fill: 'url(#complianceHealthGradient)' }]}
                  startAngle={180}
                  endAngle={0}
                  innerRadius="65%"
                  outerRadius="95%"
                  barSize={16}
                >
                  <defs>
                    <linearGradient id="complianceHealthGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#ef4444" />
                      <stop offset="52%" stopColor="#f59e0b" />
                      <stop offset="100%" stopColor="#22c55e" />
                    </linearGradient>
                  </defs>
                  <RadialBar
                    dataKey="value"
                    cornerRadius={12}
                    fill="url(#complianceHealthGradient)"
                    background={{ fill: '#e2e8f0' }}
                  />
                  <Tooltip contentStyle={chartTooltipStyle} />
                </RadialBarChart>
              </ResponsiveContainer>,
            )}
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <p className="text-4xl font-semibold text-slate-900">{complianceHealthPercent}%</p>
              <p className="text-sm text-slate-600">
                {healthEquivalentCount} out of {totalRequirements} total
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 xl:col-span-6">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Requirement Status Mix</p>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="h-56">
              {renderChart(
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={statusRingData.filter((row) => row.value > 0)}
                      dataKey="value"
                      nameKey="label"
                      cx="50%"
                      cy="50%"
                      innerRadius={68}
                      outerRadius={92}
                      paddingAngle={2}
                      stroke="#ffffff"
                      strokeWidth={2}
                    >
                      {statusRingData
                        .filter((row) => row.value > 0)
                        .map((row) => (
                          <Cell key={row.key} fill={row.color} />
                        ))}
                    </Pie>
                    <Tooltip contentStyle={chartTooltipStyle} />
                  </PieChart>
                </ResponsiveContainer>,
              )}
            </div>
            <div className="flex flex-col justify-center">
              <div className="space-y-2">
                {statusRingData.map((row) => (
                  <div key={row.key} className="flex items-center justify-between rounded-lg border border-slate-100 px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: row.color }} />
                      <span className="text-sm text-slate-700">{row.label}</span>
                    </div>
                    <span className="text-sm font-semibold text-slate-900">{row.value}</span>
                  </div>
                ))}
              </div>
              <div className="mt-3 border-t border-slate-200 pt-2">
                <div className="flex items-center justify-between">
                  <span className="text-lg font-semibold text-slate-800">Total</span>
                  <span className="text-2xl font-bold text-slate-900">{totalRequirements}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4 xl:col-span-3">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Stats</p>
          <div className="h-52">
            {renderChart(
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart
                  data={[
                    {
                      name: 'stats',
                      assessed: assessedRequirementsPercent,
                      passed: passedRequirementsPercent,
                    },
                  ]}
                  startAngle={90}
                  endAngle={-270}
                  innerRadius="28%"
                  outerRadius="96%"
                  barSize={10}
                >
                  <RadialBar
                    dataKey="assessed"
                    cornerRadius={10}
                    fill="#3b82f6"
                    background={{ fill: '#e2e8f0' }}
                  />
                  <RadialBar
                    dataKey="passed"
                    cornerRadius={10}
                    fill="#22c55e"
                    background={{ fill: '#e2e8f0' }}
                  />
                  <Tooltip contentStyle={chartTooltipStyle} />
                </RadialBarChart>
              </ResponsiveContainer>,
            )}
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-lg border border-slate-100 px-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                <span className="text-sm text-slate-700">Total Requirements Assessed</span>
              </div>
              <span className="text-sm font-semibold text-slate-900">{assessedRequirementsPercent}%</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-100 px-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-green-500" />
                <span className="text-sm text-slate-700">Total Passed Requirements</span>
              </div>
              <span className="text-sm font-semibold text-slate-900">{passedRequirementsPercent}%</span>
            </div>
          </div>
        </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-900">Recent Assessments</p>
              <p className="text-xs text-slate-500">Last 4 uploaded assessments</p>
            </div>
            <button
              type="button"
              onClick={() => setActiveView('assessment')}
              className="text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              View all
            </button>
          </div>
          {recentAssessments.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center text-sm text-slate-500">
              No assessments available yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
              {recentAssessments.map((assessment) => {
                const statusStyle = STATUS_STYLES[assessment.status] || STATUS_STYLES.draft;
                return (
                  <Link
                    key={assessment.id}
                    href={`/compliance/assessments/${assessment.id}`}
                    className="rounded-lg border border-slate-200 bg-white p-3 transition hover:border-blue-300 hover:shadow-sm"
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <p className="line-clamp-2 text-sm font-medium text-slate-900">{assessment.name}</p>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                        {statusStyle.label}
                      </span>
                    </div>
                    <p className="mb-1 text-xs text-slate-600">{formatAssessmentType(assessment.assessment_type)}</p>
                    <p className="text-[11px] text-slate-500">Created {formatDate(assessment.created_at)}</p>
                  </Link>
                );
              })}
            </div>
          )}
        </section>
        </>
      )}

      {activeView === 'assessment' && (
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px]">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Assessment</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Type</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Status</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Progress</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Due Date</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Assessor</th>
                <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center">
                    <Loader2 className="mx-auto h-5 w-5 animate-spin text-blue-600" />
                  </td>
                </tr>
              ) : filteredAssessments.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center">
                    <FileText className="mx-auto mb-2 h-10 w-10 text-slate-300" />
                    <p className="text-sm text-slate-600">No assessments found.</p>
                    <p className="mt-1 text-xs text-slate-500">
                      Upload Excel/CSV, CIS or Saudi NCA PDF, or UBL Audit Master Tracking workbook.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredAssessments.map((assessment) => {
                  const statusStyle = STATUS_STYLES[assessment.status] || STATUS_STYLES.draft;
                  const dueDateStatus = getDueDateStatus(assessment.due_date);
                  const scoreColor = getScoreColor(assessment.overall_score);
                  return (
                    <tr key={assessment.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2 align-top">
                        <Link href={`/compliance/assessments/${assessment.id}`} className="block text-sm font-medium text-slate-900 hover:text-blue-700 transition-colors">
                          {assessment.name}
                        </Link>
                        {assessment.file_name && (
                          <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-slate-600">
                            <FileText className="h-3 w-3 text-slate-400" />
                            <span className="truncate max-w-[260px]" title={assessment.file_name}>{assessment.file_name}</span>
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <p className="text-xs text-slate-700">{formatAssessmentType(assessment.assessment_type)}</p>
                        <p className="text-[11px] text-slate-500">{(assessment.assessment_format || 'standard').replace(/_/g, ' ')}</p>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusStyle.bg} ${statusStyle.text}`}>
                          {statusStyle.label}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="flex min-w-[120px] items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={`h-full ${getScoreBarColor(assessment.overall_score)} transition-all`}
                              style={{ width: `${assessment.overall_score || 0}%` }}
                            />
                          </div>
                          <span className={`text-xs font-medium ${scoreColor.text}`}>
                            {assessment.overall_score !== null ? `${Math.round(assessment.overall_score)}%` : '-'}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <p className="text-xs text-slate-700">{formatDate(assessment.due_date)}</p>
                        {dueDateStatus && <p className={`text-[11px] font-medium ${dueDateStatus.color}`}>{dueDateStatus.text}</p>}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="flex items-center gap-1.5">
                          <User className="h-3 w-3 text-slate-400" />
                          <span className="text-xs text-slate-600">{assessment.assessor || '-'}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <div className="flex items-center justify-end gap-1">
                          <Link
                            href={`/compliance/assessments/${assessment.id}`}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-blue-50 hover:text-blue-600"
                            title="View"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Link>
                          {canDelete && (
                            <button
                              onClick={() => handleDeleteClick(assessment)}
                              className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                              title="Delete"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
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
      </section>
      )}

      {activeView === 'assessment' && totalPages > 1 && (
        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
          <p className="text-xs text-slate-500">
            Showing {page * pageSize + 1}-{Math.min((page + 1) * pageSize, total)} of {total} assessments
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-xs font-medium text-slate-700">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {isUploadModalOpen && (
        <div className="fixed inset-0 z-50">
          <button
            type="button"
            aria-label="Close upload panel"
            className="absolute inset-0 bg-black/40"
            onClick={() => {
              setIsUploadModalOpen(false);
              resetUploadForm();
            }}
          />
          <div className="absolute inset-y-0 right-0 z-10 flex h-full w-full max-w-2xl flex-col border-l border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Upload Assessment</h2>
                <p className="text-xs text-slate-500">Excel/CSV/CIS or Saudi NCA PDF + UBL Audit Master Tracking supported</p>
              </div>
              <button
                onClick={() => {
                  setIsUploadModalOpen(false);
                  resetUploadForm();
                }}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {uploadError && (
                <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3">
                  <AlertCircle className="h-4 w-4 text-rose-600" />
                  <p className="text-sm text-rose-700">{uploadError}</p>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-700">Assessment Name *</label>
                  <input
                    type="text"
                    value={uploadForm.name}
                    onChange={(e) => setUploadForm({ ...uploadForm, name: e.target.value })}
                    placeholder="e.g., Q2 2026 Internal Audit Tracking"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Assessment Type *</label>
                  <select
                    value={uploadForm.assessment_type}
                    onChange={(e) => setUploadForm({ ...uploadForm, assessment_type: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                  >
                    {TYPE_OPTIONS.filter((o) => o.value).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Source</label>
                  <input
                    type="text"
                    value={uploadForm.source}
                    onChange={(e) => setUploadForm({ ...uploadForm, source: e.target.value })}
                    placeholder="e.g., External Auditor"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Due Date</label>
                  <input
                    type="date"
                    value={uploadForm.due_date}
                    onChange={(e) => setUploadForm({ ...uploadForm, due_date: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Assessor</label>
                  <select
                    value={uploadForm.assessor}
                    onChange={(e) => setUploadForm({ ...uploadForm, assessor: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                  >
                    <option value="">Select assessor</option>
                    {assessorUsers.map((user) => (
                      <option key={user.id} value={user.display_name}>
                        {user.display_name}
                        {user.email ? ` (${user.email})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-medium text-slate-700">Notes</label>
                  <textarea
                    value={uploadForm.notes}
                    onChange={(e) => setUploadForm({ ...uploadForm, notes: e.target.value })}
                    placeholder="Additional context for this upload"
                    className="min-h-[84px] w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">AI Context</p>
                    <p className="mt-1 text-xs text-slate-600">Generate an executive summary and risk/compliance perspective for this upload.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => aiContextMutation.mutate()}
                    disabled={aiContextMutation.isPending || !uploadForm.name.trim()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {aiContextMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    Generate
                  </button>
                </div>
                {aiContext && (
                  <div className="mt-3 space-y-2 rounded-lg border border-blue-200 bg-white p-3">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Summary</p>
                      <p className="text-sm text-slate-700">{aiContext.summary}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Risk Perspective</p>
                      <p className="text-sm text-slate-700">{aiContext.risk_perspective}</p>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">Compliance Perspective</p>
                      <p className="text-sm text-slate-700">{aiContext.compliance_perspective}</p>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Assessment File *</label>
                <div className="rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center hover:border-slate-400">
                  <input
                    id="assessment-upload-file"
                    type="file"
                    accept=".xlsx,.xls,.csv,.pdf"
                    onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                    className="hidden"
                  />
                  <label htmlFor="assessment-upload-file" className="cursor-pointer">
                    <Upload className="mx-auto mb-2 h-7 w-7 text-slate-400" />
                    {uploadFile ? (
                      <p className="text-sm font-medium text-slate-800">{uploadFile.name}</p>
                    ) : (
                      <>
                        <p className="text-sm text-slate-700">Click to upload file</p>
                        <p className="text-xs text-slate-500">
                          Excel (.xlsx/.xls), CSV, CIS/Saudi NCA PDF, UBL Audit Master Tracking Sheet
                        </p>
                      </>
                    )}
                  </label>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
              <button
                onClick={() => {
                  setIsUploadModalOpen(false);
                  resetUploadForm();
                }}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleUploadSubmit}
                disabled={uploadMutation.isPending || !uploadFile || !uploadForm.name}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {uploadMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Upload Assessment
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteModalOpen && assessmentToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-base font-semibold text-slate-900">Delete Assessment</h2>
              <button
                onClick={() => {
                  setDeleteModalOpen(false);
                  setAssessmentToDelete(null);
                }}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3 px-5 py-4">
              {deleteError && (
                <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3">
                  <AlertCircle className="h-4 w-4 text-rose-600" />
                  <p className="text-sm text-rose-700">{deleteError}</p>
                </div>
              )}
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-rose-50 p-2.5">
                  <AlertCircle className="h-4 w-4 text-rose-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-800">Delete this assessment permanently?</p>
                  <p className="mt-1 text-sm font-medium text-slate-900">{assessmentToDelete.name}</p>
                  <p className="mt-2 text-xs text-slate-500">This will remove all associated assessment items and cannot be undone.</p>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4">
              <button
                onClick={() => {
                  setDeleteModalOpen(false);
                  setAssessmentToDelete(null);
                }}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleteMutation.isPending}
                className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
