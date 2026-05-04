'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { riskAssessmentApi, ermApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  ClipboardCheck,
  Plus,
  Loader2,
  Calendar,
  Users,
  Trash2,
  AlertTriangle,
  X,
  Filter,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SearchInput } from '@/components/ui/SearchInput';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';
import { PageLoader } from '@/components/ui';

type AssessmentStatus = 'draft' | 'in_progress' | 'under_review' | 'approved' | 'closed';
type AssessmentType = 'periodic' | 'annual' | 'ad_hoc' | 'triggered';
type Methodology = 'qualitative' | 'quantitative' | 'semi_quantitative';

const STATUS_CONFIG: Record<AssessmentStatus, { label: string; color: string; bgColor: string }> = {
  draft: { label: 'Draft', color: 'text-white', bgColor: 'bg-slate-500' },
  in_progress: { label: 'In Progress', color: 'text-white', bgColor: 'bg-blue-600' },
  under_review: { label: 'Under Review', color: 'text-white', bgColor: 'bg-amber-600' },
  approved: { label: 'Approved', color: 'text-white', bgColor: 'bg-emerald-600' },
  closed: { label: 'Closed', color: 'text-white', bgColor: 'bg-purple-600' },
};

const TYPE_CONFIG: Record<AssessmentType, { label: string; color: string; bgColor: string }> = {
  periodic: { label: 'Periodic', color: 'text-white', bgColor: 'bg-cyan-600' },
  annual: { label: 'Annual', color: 'text-white', bgColor: 'bg-indigo-600' },
  ad_hoc: { label: 'Ad Hoc', color: 'text-white', bgColor: 'bg-orange-600' },
  triggered: { label: 'Triggered', color: 'text-white', bgColor: 'bg-rose-600' },
};

const METHODOLOGY_LABELS: Record<Methodology, string> = {
  qualitative: 'Qualitative',
  quantitative: 'Quantitative',
  semi_quantitative: 'Semi-Quantitative',
};

const STATUS_TABS: { value: AssessmentStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'under_review', label: 'Under Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'closed', label: 'Closed' },
];

interface Assessment {
  id: number;
  name: string;
  description?: string;
  assessment_type: AssessmentType;
  status: AssessmentStatus;
  methodology: Methodology;
  scope?: string;
  assessment_period_start?: string;
  assessment_period_end?: string;
  lead_assessor_id?: number;
  lead_assessor_name?: string;
  assessed_risks_count?: number;
  notes?: string;
  created_at: string;
  updated_at?: string;
}

interface FrameworkAssessment {
  id: number;
  name: string;
  description?: string | null;
  status: string;
  framework_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  questions_count?: number;
}

type CombinedAssessment =
  | (Assessment & { source: 'risk' })
  | (FrameworkAssessment & { source: 'framework' });

const FRAMEWORK_STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  in_progress: { label: 'In Progress', color: 'text-white', bgColor: 'bg-blue-600' },
  completed: { label: 'Completed', color: 'text-white', bgColor: 'bg-emerald-600' },
  archived: { label: 'Archived', color: 'text-white', bgColor: 'bg-slate-700' },
  not_started: { label: 'Not Started', color: 'text-white', bgColor: 'bg-slate-500' },
  blocked: { label: 'Blocked', color: 'text-white', bgColor: 'bg-rose-600' },
};

const FRAMEWORK_STATUS_TO_STANDARD: Partial<Record<string, AssessmentStatus>> = {
  in_progress: 'in_progress',
  completed: 'approved',
  archived: 'closed',
  not_started: 'draft',
};

export default function RiskAssessmentsPage() {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('risks:risk_assessment:create');
  const canDelete = hasPermission('risks:risk_assessment:delete');
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<AssessmentStatus | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadFormData, setUploadFormData] = useState({
    name: '',
    assessment_type: 'ad_hoc' as AssessmentType,
    methodology: 'qualitative' as Methodology,
    scope: '',
  });
  const [uploadResult, setUploadResult] = useState<{
    assessment_id: number;
    assessment_name: string;
    risks_created: number;
    rows_skipped: number;
    rows_errored: number;
  } | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    assessment_type: 'periodic' as AssessmentType,
    methodology: 'qualitative' as Methodology,
    scope: '',
    assessment_period_start: '',
    assessment_period_end: '',
    notes: '',
  });

  const { data: assessments, isLoading, error } = useQuery({
    queryKey: ['risk-assessments', statusFilter],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (statusFilter !== 'all') params.status = statusFilter;
      const response = await riskAssessmentApi.getAll(params);
      return response.data as Assessment[];
    },
  });

  const { data: frameworkAssessments } = useQuery({
    queryKey: ['framework-risk-assessments-for-risk-assessments-page'],
    queryFn: async () => {
      const response = await ermApi.frameworkRiskAssessments.getAll();
      return response.data as FrameworkAssessment[];
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => riskAssessmentApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['risk-assessments'] });
      setIsModalOpen(false);
      resetForm();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => riskAssessmentApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['risk-assessments'] });
      queryClient.invalidateQueries({ queryKey: ['framework-risk-assessments-for-risk-assessments-page'] });
    },
  });

  const deleteFrameworkMutation = useMutation({
    mutationFn: (id: number) => ermApi.frameworkRiskAssessments.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['risk-assessments'] });
      queryClient.invalidateQueries({ queryKey: ['framework-risk-assessments-for-risk-assessments-page'] });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (uploadData: FormData) => riskAssessmentApi.uploadExcel(uploadData),
    onSuccess: (response) => {
      queryClient.invalidateQueries({ queryKey: ['risk-assessments'] });
      setUploadResult({
        assessment_id: response.data.assessment_id,
        assessment_name: response.data.assessment_name,
        risks_created: response.data.risks_created,
        rows_skipped: response.data.rows_skipped,
        rows_errored: response.data.rows_errored,
      });
    },
  });

  const handleUpload = () => {
    if (!uploadFile) return;
    const payload = new FormData();
    payload.append('file', uploadFile);
    if (uploadFormData.name) payload.append('name', uploadFormData.name);
    payload.append('assessment_type', uploadFormData.assessment_type);
    payload.append('methodology', uploadFormData.methodology);
    if (uploadFormData.scope) payload.append('scope', uploadFormData.scope);
    uploadMutation.mutate(payload);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadFile(file);
      setUploadResult(null);
      if (!uploadFormData.name) {
        setUploadFormData((prev) => ({
          ...prev,
          name: file.name.replace(/\.(xlsx|xls)$/i, ''),
        }));
      }
    }
  };

  const resetUploadForm = () => {
    setUploadFile(null);
    setUploadFormData({ name: '', assessment_type: 'ad_hoc', methodology: 'qualitative', scope: '' });
    setUploadResult(null);
    uploadMutation.reset();
  };

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      assessment_type: 'periodic',
      methodology: 'qualitative',
      scope: '',
      assessment_period_start: '',
      assessment_period_end: '',
      notes: '',
    });
  };

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      name: formData.name,
      assessment_type: formData.assessment_type,
      methodology: formData.methodology,
    };
    if (formData.description) payload.description = formData.description;
    if (formData.scope) payload.scope = formData.scope;
    if (formData.assessment_period_start) payload.assessment_period_start = formData.assessment_period_start;
    if (formData.assessment_period_end) payload.assessment_period_end = formData.assessment_period_end;
    if (formData.notes) payload.notes = formData.notes;
    createMutation.mutate(payload);
  };

  const handleDelete = (e: React.MouseEvent, assessment: CombinedAssessment) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this assessment?')) {
      if (assessment.source === 'framework') {
        deleteFrameworkMutation.mutate(assessment.id);
        return;
      }
      deleteMutation.mutate(assessment.id);
    }
  };

  const combinedAssessments: CombinedAssessment[] = [
    ...((assessments || []).map((a) => ({ ...a, source: 'risk' as const }))),
    ...((frameworkAssessments || []).map((a) => ({ ...a, source: 'framework' as const }))),
  ].sort((a, b) => {
    const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bDate - aDate;
  });

  const filteredAssessments = combinedAssessments.filter((a) => {
    if (statusFilter !== 'all') {
      if (a.source === 'framework') {
        const mapped = FRAMEWORK_STATUS_TO_STANDARD[a.status];
        if (a.status !== statusFilter && mapped !== statusFilter) return false;
      } else if (a.status !== statusFilter) {
        return false;
      }
    }

    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase();
    if (a.source === 'framework') {
      return (
        a.name.toLowerCase().includes(term) ||
        a.description?.toLowerCase().includes(term) ||
        a.framework_name?.toLowerCase().includes(term)
      );
    }
    return a.name.toLowerCase().includes(term) || a.description?.toLowerCase().includes(term) || a.scope?.toLowerCase().includes(term);
  });

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  if (isLoading) {
    return (
      <PageLoader className="h-64" />
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-red-400">
        <AlertTriangle className="mb-2 h-8 w-8" />
        <p>Failed to load risk assessments</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg sm:text-xl font-semibold text-slate-900">Risk Assessments</h2>
          <p className="text-sm text-slate-600">
            Manage and track risk assessment activities
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/erm/risk-assessments/framework"
            className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 font-medium text-slate-700 hover:bg-slate-50"
          >
            <ClipboardCheck size={18} />
            Framework Risk Assessment
          </Link>
          {canCreate && (
          <button
            onClick={() => {
              resetUploadForm();
              setIsUploadModalOpen(true);
            }}
            className="flex items-center gap-2 rounded-lg border border-blue-300 bg-white px-4 py-2 font-medium text-blue-700 hover:bg-blue-50"
          >
            <Upload size={18} />
            Upload Risk Assessment
          </button>
          )}
          {canCreate && (
          <button
            onClick={() => {
              resetForm();
              setIsModalOpen(true);
            }}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
          >
            <Plus size={18} />
            New Assessment
          </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-slate-200">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setStatusFilter(tab.value)}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors -mb-px ${
              statusFilter === tab.value
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-slate-600 hover:text-slate-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <SearchInput
        value={searchTerm}
        onChange={setSearchTerm}
        placeholder="Search assessments..."
      />

      {filteredAssessments.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white py-16">
          <ClipboardCheck className="mb-4 h-12 w-12 text-slate-500" />
          <h3 className="text-lg font-medium text-slate-900">No assessments found</h3>
          <p className="mt-1 text-sm text-slate-600">
            {statusFilter !== 'all'
              ? `No ${STATUS_CONFIG[statusFilter as AssessmentStatus]?.label.toLowerCase()} assessments found.`
              : 'Get started by creating your first risk assessment.'}
          </p>
          {statusFilter === 'all' && (
            <button
              onClick={() => {
                resetForm();
                setIsModalOpen(true);
              }}
              className="mt-4 flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              <Plus size={16} />
              Create Assessment
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredAssessments.map((assessment) => {
            const isFrameworkAssessment = assessment.source === 'framework';
            const statusStyle = isFrameworkAssessment
              ? (FRAMEWORK_STATUS_CONFIG[assessment.status] || FRAMEWORK_STATUS_CONFIG.in_progress)
              : (STATUS_CONFIG[assessment.status] || STATUS_CONFIG.draft);
            const typeStyle = isFrameworkAssessment
              ? { label: 'Framework', color: 'text-violet-400', bgColor: 'bg-violet-500/20' }
              : (TYPE_CONFIG[assessment.assessment_type] || TYPE_CONFIG.periodic);
            const destination = isFrameworkAssessment
              ? `/erm/risk-assessments/framework/${assessment.id}`
              : `/erm/risk-assessments/${assessment.id}`;

            return (
              <div
                key={assessment.id}
                onClick={() => router.push(destination)}
                className="group cursor-pointer rounded-xl border border-slate-200 bg-white p-5 transition-all hover:border-slate-300 hover:bg-slate-750 hover:shadow-lg"
              >
                <div className="mb-3 flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="truncate text-base font-semibold text-slate-900 group-hover:text-primary-400 transition-colors">
                      {assessment.name}
                    </h3>
                    {assessment.description && (
                      <p className="mt-1 text-sm text-slate-600 line-clamp-2">
                        {assessment.description}
                      </p>
                    )}
                  </div>
                  <button
                      onClick={(e) => handleDelete(e, assessment)}
                      className="ml-2 rounded p-1 text-slate-500 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
                      title="Delete assessment"
                    >
                      <Trash2 size={16} />
                    </button>
                </div>

                <div className="mb-3 flex flex-wrap gap-2">
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle.bgColor} ${statusStyle.color}`}>
                    {statusStyle.label}
                  </span>
                  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${typeStyle.bgColor} ${typeStyle.color}`}>
                    {typeStyle.label}
                  </span>
                </div>

                <div className="space-y-2 text-sm">
                  {!isFrameworkAssessment && assessment.methodology && (
                    <div className="flex items-center gap-2 text-slate-600">
                      <Filter size={14} className="shrink-0" />
                      <span>{METHODOLOGY_LABELS[assessment.methodology] || assessment.methodology}</span>
                    </div>
                  )}

                  {!isFrameworkAssessment && (assessment.assessment_period_start || assessment.assessment_period_end) && (
                    <div className="flex items-center gap-2 text-slate-600">
                      <Calendar size={14} className="shrink-0" />
                      <span>
                        {formatDate(assessment.assessment_period_start)} – {formatDate(assessment.assessment_period_end)}
                      </span>
                    </div>
                  )}

                  {!isFrameworkAssessment && assessment.lead_assessor_name && (
                    <div className="flex items-center gap-2 text-slate-600">
                      <Users size={14} className="shrink-0" />
                      <span>{assessment.lead_assessor_name}</span>
                    </div>
                  )}
                  {isFrameworkAssessment && assessment.framework_name && (
                    <div className="flex items-center gap-2 text-slate-600">
                      <ClipboardCheck size={14} className="shrink-0" />
                      <span>{assessment.framework_name}</span>
                    </div>
                  )}

                  <div className="flex items-center justify-between border-t border-slate-200 pt-2 mt-2">
                    <div className="flex items-center gap-1 text-slate-500">
                      <AlertTriangle size={14} />
                      <span className="text-xs">
                        {isFrameworkAssessment
                          ? `${assessment.questions_count ?? 0} questions`
                          : `${assessment.assessed_risks_count ?? 0} risks assessed`}
                      </span>
                    </div>
                    <span className="text-xs text-slate-500">
                      {formatDate(assessment.created_at || undefined)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <RightSlidePanel
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        title={
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-100">
              <FileSpreadsheet size={18} className="text-blue-600" />
            </div>
            <span>Upload Risk Assessment</span>
          </div>
        }
      >
            <div className="space-y-4">
              {uploadResult ? (
                <div className="space-y-4">
                  <div className="flex flex-col items-center gap-3 rounded-lg border border-green-300 bg-green-50 p-6">
                    <CheckCircle2 size={40} className="text-green-600" />
                    <h3 className="text-lg font-semibold text-slate-900">Import Successful</h3>
                    <p className="text-center text-sm text-slate-700">
                      Created assessment &quot;{uploadResult.assessment_name}&quot; with {uploadResult.risks_created} risks imported.
                    </p>
                    <div className="flex gap-4 text-sm">
                      <span className="text-green-600">{uploadResult.risks_created} created</span>
                      {uploadResult.rows_skipped > 0 && (
                        <span className="text-amber-600">{uploadResult.rows_skipped} skipped</span>
                      )}
                      {uploadResult.rows_errored > 0 && (
                        <span className="text-red-600">{uploadResult.rows_errored} errors</span>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
                    <button
                      type="button"
                      onClick={() => {
                        setIsUploadModalOpen(false);
                        resetUploadForm();
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsUploadModalOpen(false);
                        router.push(`/erm/risk-assessments/${uploadResult.assessment_id}`);
                      }}
                      className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
                    >
                      View Assessment
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Excel File <span className="text-red-500">*</span>
                    </label>
                    <div
                      className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors ${
                        uploadFile
                          ? 'border-blue-300 bg-blue-50'
                          : 'border-slate-300 bg-slate-50 hover:border-slate-400'
                      }`}
                    >
                      {uploadFile ? (
                        <div className="flex items-center gap-3">
                          <FileSpreadsheet size={24} className="text-blue-600" />
                          <div>
                            <p className="text-sm font-medium text-slate-900">{uploadFile.name}</p>
                            <p className="text-xs text-slate-600">{(uploadFile.size / 1024).toFixed(1)} KB</p>
                          </div>
                          <button
                            onClick={() => {
                              setUploadFile(null);
                              setUploadFormData((prev) => ({ ...prev, name: '' }));
                            }}
                            className="ml-2 rounded p-1 text-slate-500 hover:bg-slate-200 hover:text-slate-900"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ) : (
                        <>
                          <Upload size={32} className="mb-2 text-slate-500" />
                          <p className="text-sm text-slate-700">Click to select or drag an Excel file</p>
                          <p className="mt-1 text-xs text-slate-500">Supports .xlsx and .xls files</p>
                        </>
                      )}
                      <input
                        type="file"
                        accept=".xlsx,.xls"
                        onChange={handleFileSelect}
                        className="absolute inset-0 cursor-pointer opacity-0"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Assessment Name</label>
                    <input
                      type="text"
                      value={uploadFormData.name}
                      onChange={(e) => setUploadFormData({ ...uploadFormData, name: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none"
                      placeholder="Auto-generated from filename if empty"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Assessment Type</label>
                      <select
                        value={uploadFormData.assessment_type}
                        onChange={(e) => setUploadFormData({ ...uploadFormData, assessment_type: e.target.value as AssessmentType })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none"
                      >
                        <option value="periodic">Periodic</option>
                        <option value="annual">Annual</option>
                        <option value="ad_hoc">Ad Hoc</option>
                        <option value="triggered">Triggered</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">Methodology</label>
                      <select
                        value={uploadFormData.methodology}
                        onChange={(e) => setUploadFormData({ ...uploadFormData, methodology: e.target.value as Methodology })}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none"
                      >
                        <option value="qualitative">Qualitative</option>
                        <option value="quantitative">Quantitative</option>
                        <option value="semi_quantitative">Semi-Quantitative</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">Scope</label>
                    <input
                      type="text"
                      value={uploadFormData.scope}
                      onChange={(e) => setUploadFormData({ ...uploadFormData, scope: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none"
                      placeholder="Define the scope of this assessment"
                    />
                  </div>

                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-xs text-slate-600">
                      Expected columns for assessment import: Risk ID, Risk Category, Risk Title, Risk Description, Risk Owner,
                      Inherent Likelihood/Impact/Score, Controls, Control Effectiveness,
                      Residual Likelihood/Impact/Score, Status, Mitigation Actions, Target Date
                    </p>
                  </div>

                  {uploadMutation.isError && (
                    <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-600">
                      {(uploadMutation.error as Error & { response?: { data?: { detail?: string } } })?.response?.data?.detail || 'Failed to upload file. Please check the format and try again.'}
                    </div>
                  )}

                  <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
                    <button
                      type="button"
                      onClick={() => setIsUploadModalOpen(false)}
                      className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleUpload}
                      disabled={!uploadFile || uploadMutation.isPending}
                      className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {uploadMutation.isPending ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          Importing Risks...
                        </>
                      ) : (
                        <>
                          <Upload size={16} />
                          Upload &amp; Create Assessment
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </div>
      </RightSlidePanel>

      <RightSlidePanel
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title="New Risk Assessment"
      >
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Name <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none"
                  placeholder="e.g., Q1 2026 Risk Assessment"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Description</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={2}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none"
                  placeholder="Brief description of the assessment"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Assessment Type</label>
                  <select
                    value={formData.assessment_type}
                    onChange={(e) => setFormData({ ...formData, assessment_type: e.target.value as AssessmentType })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none"
                  >
                    <option value="periodic">Periodic</option>
                    <option value="annual">Annual</option>
                    <option value="ad_hoc">Ad Hoc</option>
                    <option value="triggered">Triggered</option>
                  </select>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Methodology</label>
                  <select
                    value={formData.methodology}
                    onChange={(e) => setFormData({ ...formData, methodology: e.target.value as Methodology })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none"
                  >
                    <option value="qualitative">Qualitative</option>
                    <option value="quantitative">Quantitative</option>
                    <option value="semi_quantitative">Semi-Quantitative</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Scope</label>
                <textarea
                  value={formData.scope}
                  onChange={(e) => setFormData({ ...formData, scope: e.target.value })}
                  rows={2}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none"
                  placeholder="Define the scope of this assessment"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Period Start</label>
                  <input
                    type="date"
                    value={formData.assessment_period_start}
                    onChange={(e) => setFormData({ ...formData, assessment_period_start: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">Period End</label>
                  <input
                    type="date"
                    value={formData.assessment_period_end}
                    onChange={(e) => setFormData({ ...formData, assessment_period_end: e.target.value })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={2}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none"
                  placeholder="Additional notes"
                />
              </div>

              {createMutation.isError && (
                <div className="rounded-lg border border-red-500/50 bg-red-500/10 px-4 py-2 text-sm text-red-400">
                  Failed to create assessment. Please try again.
                </div>
              )}

              <div className="flex justify-end gap-3 border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || !formData.name.trim()}
                  className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {createMutation.isPending && <Loader2 size={16} className="animate-spin" />}
                  Create Assessment
                </button>
              </div>
            </form>
      </RightSlidePanel>
    </div>
  );
}
