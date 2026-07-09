'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { vendorRiskApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  Shield,
  ShieldCheck,
  FileCheck,
  Clock,
  User,
  CheckCircle2,
  Plus,
  Trash2,
  Save,
  Play,
  Award,
  ClipboardList,
  BarChart3,
  Mail,
  AlertTriangle,
  Star,
  Paperclip,
  FileText,
} from 'lucide-react';
import Link from 'next/link';
import { MultiSelectDropdown, PageLoader } from '@/components/ui';
import EvidencePreviewButton from '@/components/evidence/EvidencePreviewButton';

interface Assessment {
  id: number;
  tenant_id: number;
  vendor_id: number;
  vendor_name?: string;
  assessment_type: string;
  template_id: number | null;
  template_name?: string;
  status: string;
  inherent_score: number | null;
  residual_score: number | null;
  risk_rating: string | null;
  findings: string[];
  recommendations: string[];
  gap_analysis?: Array<{ gap?: string; severity?: string; control_ref?: string; residual_after_controls?: string }>;
  linked_risk_id?: number | null;
  assessed_by: number | null;
  reviewed_by: number | null;
  assessor?: { id: number; full_name: string } | null;
  reviewer?: { id: number; full_name: string } | null;
  due_date: string | null;
  completed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  questionnaire_responses?: QuestionnaireResponse[];
}

interface TemplateQuestion {
  id: string;
  text: string;
  type: 'text' | 'yes_no' | 'multiple_choice' | 'rating';
  required: boolean;
  evidence_required: boolean;
  weight: number;
  options?: string[];
  category?: string;
}

interface EvidenceFile {
  id: number;
  file_name: string;
  file_type: string;
  file_size: number;
  // Backend now also surfaces the on-disk path so the evidence viewer
  // can fetch the bytes for in-browser preview.
  file_path?: string | null;
}

interface QuestionnaireResponse {
  id: number;
  respondent_name: string | null;
  respondent_email: string | null;
  responses: Record<string, unknown>;
  status: string;
  submitted_at: string | null;
  questions?: TemplateQuestion[];
  evidence?: Record<string, EvidenceFile[]>;
}

interface QuestionnaireTemplateLite {
  id: number;
  name: string;
  category: string;
  questions: TemplateQuestion[];
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const STATUS_FLOW = ['draft', 'in_progress', 'submitted', 'reviewed', 'approved'];
const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  in_progress: 'In Progress',
  submitted: 'Submitted',
  reviewed: 'Reviewed',
  approved: 'Approved',
};

const getStatusPill = (status: string) => {
  const styles: Record<string, string> = {
    draft: 'bg-gray-50 text-gray-700 border-gray-200',
    in_progress: 'bg-blue-50 text-blue-700 border-blue-200',
    submitted: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    reviewed: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    approved: 'bg-green-50 text-green-700 border-green-200',
  };
  return styles[status?.toLowerCase()] || 'bg-gray-50 text-gray-700 border-gray-200';
};

const getRatingPill = (rating: string) => {
  const styles: Record<string, string> = {
    critical: 'bg-red-50 text-red-700 border-red-200',
    high: 'bg-orange-50 text-orange-700 border-orange-200',
    medium: 'bg-yellow-50 text-yellow-700 border-yellow-200',
    low: 'bg-green-50 text-green-700 border-green-200',
  };
  return styles[rating?.toLowerCase()] || 'bg-gray-50 text-gray-700 border-gray-200';
};

const getRatingColor = (rating: string) => {
  const colors: Record<string, string> = {
    critical: 'text-red-600',
    high: 'text-orange-600',
    medium: 'text-yellow-600',
    low: 'text-green-600',
  };
  return colors[rating?.toLowerCase()] || 'text-gray-600';
};

const formatAssessmentType = (type: string) =>
  type?.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) || '-';

type TabType = 'overview' | 'questionnaire' | 'scoring';

const QUESTION_PREFIX_CATEGORY: Record<string, string> = {
  s: 'Security',
  p: 'Privacy',
  c: 'Compliance',
  o: 'Operational',
  f: 'Financial',
};

const getAssessmentCategory = (assessmentType?: string): string => {
  const v = String(assessmentType || '').toLowerCase();
  if (v.includes('privacy')) return 'Privacy';
  if (v.includes('compliance')) return 'Compliance';
  if (v.includes('operational')) return 'Operational';
  if (v.includes('financial')) return 'Financial';
  if (v.includes('cyber') || v.includes('security')) return 'Security';
  return 'General';
};

const getQuestionCategory = (q: TemplateQuestion, assessmentType?: string): string => {
  const explicit = String(q.category || '').trim();
  if (explicit) return explicit.charAt(0).toUpperCase() + explicit.slice(1);
  const id = String(q.id || '').trim().toLowerCase();
  const prefix = id.charAt(0);
  if (QUESTION_PREFIX_CATEGORY[prefix]) return QUESTION_PREFIX_CATEGORY[prefix];
  return getAssessmentCategory(assessmentType);
};

// â”€â”€â”€ Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export default function AssessmentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const assessmentId = Number(params.id);
  const initialTab = (searchParams.get('tab') as TabType) || 'overview';

  const [activeTab, setActiveTab] = useState<TabType>(
    ['overview', 'questionnaire', 'scoring'].includes(initialTab) ? initialTab : 'overview'
  );
  const [editFindings, setEditFindings] = useState<string[] | null>(null);
  const [editRecommendations, setEditRecommendations] = useState<string[] | null>(null);
  const [newFinding, setNewFinding] = useState('');
  const [newRecommendation, setNewRecommendation] = useState('');
  const [approveRating, setApproveRating] = useState('');
  const [scoreResult, setScoreResult] = useState<{ inherent_score: number; residual_score: number; risk_rating: string } | null>(null);
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('vendor_risk:assessments:edit');

  // â”€â”€ Queries â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const { data: assessment, isLoading, error } = useQuery({
    queryKey: ['assessment', assessmentId],
    queryFn: async () => {
      const res = await vendorRiskApi.getAssessment(assessmentId);
      return res.data as Assessment;
    },
    enabled: !!assessmentId,
    placeholderData: keepPreviousData,
  });

  const { data: linkedTemplate } = useQuery({
    queryKey: ['assessment-linked-template', assessment?.template_id],
    queryFn: async () => {
      const res = await vendorRiskApi.getTemplates({ limit: 200 });
      const items = (Array.isArray(res.data) ? res.data : res.data?.items ?? []) as QuestionnaireTemplateLite[];
      return items.find((t) => t.id === assessment?.template_id) || null;
    },
    enabled: !!assessment?.template_id,
    placeholderData: keepPreviousData,
  });

  // â”€â”€ Mutations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const updateMutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await vendorRiskApi.updateAssessment(assessmentId, data);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assessment', assessmentId] });
      setEditFindings(null);
      setEditRecommendations(null);
    },
  });

  const scoreMutation = useMutation({
    mutationFn: async () => {
      const res = await vendorRiskApi.scoreAssessment(assessmentId);
      return res.data;
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['assessment', assessmentId] });
      setScoreResult({
        inherent_score: data.inherent_score,
        residual_score: data.residual_score,
        risk_rating: data.risk_rating,
      });
    },
  });

  // AI gap analysis — derives a real residual-vs-inherent delta + per-gap detail
  // (persisted on the assessment). Graceful: the endpoint never 503s.
  const [gapResult, setGapResult] = useState<{ residual_score?: number; summary?: string; source?: string } | null>(null);
  const gapMutation = useMutation({
    mutationFn: async () => (await vendorRiskApi.aiGapAnalysis(assessmentId)).data,
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['assessment', assessmentId] });
      setGapResult({ residual_score: data?.residual_score, summary: data?.summary, source: data?.source });
    },
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {};
      if (approveRating) payload.risk_rating = approveRating;
      if (editRecommendations) payload.recommendations = editRecommendations;
      const res = await vendorRiskApi.approveAssessment(assessmentId, payload);
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['assessment', assessmentId] });
      queryClient.invalidateQueries({ queryKey: ['assessments'] });
    },
  });

  // â”€â”€ Loading / Error states â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <PageLoader size="md" />
      </div>
    );
  }

  if (error || !assessment) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-gray-500">
        <AlertCircle className="h-8 w-8 mb-2" />
        <p>Assessment not found</p>
        <Link href="/vendor-risk/assessments" className="text-blue-600 hover:underline mt-2 text-sm">Back to assessments</Link>
      </div>
    );
  }

  // â”€â”€ Derived data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const findings = editFindings ?? assessment.findings ?? [];
  const recommendations = editRecommendations ?? assessment.recommendations ?? [];
  const currentStatusIdx = STATUS_FLOW.indexOf(assessment.status);
  const isApproved = assessment.status === 'approved';

  const tabs: { key: TabType; label: string; icon: typeof Shield }[] = [
    { key: 'overview', label: 'Overview', icon: FileCheck },
    { key: 'questionnaire', label: 'Questionnaire Responses', icon: ClipboardList },
    { key: 'scoring', label: 'Scoring & Approval', icon: BarChart3 },
  ];

  // â”€â”€ Handlers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const handleSaveFindings = () => {
    updateMutation.mutate({ findings: editFindings });
  };

  const handleSaveRecommendations = () => {
    updateMutation.mutate({ recommendations: editRecommendations });
  };

  const handleStatusChange = (newStatus: string) => {
    updateMutation.mutate({ status: newStatus });
  };

  const addFinding = () => {
    if (!newFinding.trim()) return;
    const updated = [...(editFindings ?? assessment.findings ?? []), newFinding.trim()];
    setEditFindings(updated);
    setNewFinding('');
  };

  const removeFinding = (idx: number) => {
    const updated = [...(editFindings ?? assessment.findings ?? [])];
    updated.splice(idx, 1);
    setEditFindings(updated);
  };

  const addRecommendation = () => {
    if (!newRecommendation.trim()) return;
    const updated = [...(editRecommendations ?? assessment.recommendations ?? []), newRecommendation.trim()];
    setEditRecommendations(updated);
    setNewRecommendation('');
  };

  const removeRecommendation = (idx: number) => {
    const updated = [...(editRecommendations ?? assessment.recommendations ?? [])];
    updated.splice(idx, 1);
    setEditRecommendations(updated);
  };

  // â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  return (
    <div className="p-6 space-y-4 sm:space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/vendor-risk/assessments')} aria-label="Back to assessments" className="text-gray-400 hover:text-gray-600">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-lg sm:text-xl font-semibold text-slate-900">{formatAssessmentType(assessment.assessment_type)}</h1>
            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStatusPill(assessment.status)}`}>
              {STATUS_LABELS[assessment.status] || assessment.status}
            </span>
            {assessment.risk_rating && (
              <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium capitalize border ${getRatingPill(assessment.risk_rating)}`}>
                {assessment.risk_rating} risk
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 mt-1 text-sm text-gray-500">
            <Link href={`/vendor-risk/vendors/${assessment.vendor_id}`} className="text-blue-600 hover:text-blue-800">
              {assessment.vendor_name || `Vendor #${assessment.vendor_id}`}
            </Link>
            {assessment.template_name && (
              <span>Template: {assessment.template_name}</span>
            )}
            <span>ID: #{assessment.id}</span>
          </div>
        </div>
      </div>

      {/* Status Flow */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4">
        <div className="flex items-center justify-between">
          {STATUS_FLOW.map((step, idx) => {
            const isCompleted = idx < currentStatusIdx;
            const isCurrent = idx === currentStatusIdx;
            return (
              <div key={step} className="flex items-center flex-1">
                <div className="flex flex-col items-center flex-1">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold ${
                    isCompleted ? 'bg-green-500 text-white' :
                    isCurrent ? 'bg-blue-600 text-white' :
                    'bg-gray-200 text-gray-500'
                  }`}>
                    {isCompleted ? <CheckCircle2 className="h-4 w-4" /> : idx + 1}
                  </div>
                  <span className={`text-xs mt-1 ${isCurrent ? 'font-semibold text-blue-600' : 'text-gray-500'}`}>
                    {STATUS_LABELS[step]}
                  </span>
                </div>
                {idx < STATUS_FLOW.length - 1 && (
                  <div className={`h-0.5 flex-1 mx-1 ${idx < currentStatusIdx ? 'bg-green-500' : 'bg-gray-200'}`} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-6" role="tablist" aria-label="Assessment sections">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              id={`assessment-tab-${tab.key}`}
              aria-selected={activeTab === tab.key}
              aria-controls={`assessment-panel-${tab.key}`}
              onClick={() => setActiveTab(tab.key)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* â•â•â• Overview Tab â•â•â• */}
      {activeTab === 'overview' && (
        <div className="space-y-4 sm:space-y-6" role="tabpanel" id="assessment-panel-overview" aria-labelledby="assessment-tab-overview">
          {/* Info Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { label: 'Inherent Score', value: assessment.inherent_score?.toFixed(1) ?? '-', icon: Shield, color: 'blue' },
              { label: 'Residual Score', value: assessment.residual_score?.toFixed(1) ?? '-', icon: ShieldCheck, color: 'indigo' },
              { label: 'Risk Rating', value: assessment.risk_rating ? assessment.risk_rating.charAt(0).toUpperCase() + assessment.risk_rating.slice(1) : '-', icon: AlertTriangle, color: assessment.risk_rating === 'critical' ? 'red' : assessment.risk_rating === 'high' ? 'orange' : assessment.risk_rating === 'medium' ? 'yellow' : 'green' },
              { label: 'Status', value: STATUS_LABELS[assessment.status] || assessment.status, icon: Clock, color: 'gray' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg bg-${color}-50`}>
                    <Icon className={`h-5 w-5 text-${color}-600`} />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">{label}</p>
                    <p className={`text-lg font-semibold ${label === 'Risk Rating' && assessment.risk_rating ? getRatingColor(assessment.risk_rating) : 'text-gray-900'}`}>{value}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Gap analysis & residual risk (stage 4) */}
          <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                <BarChart3 className="h-4 w-4 text-slate-500" /> Gap analysis &amp; residual risk
              </h3>
              <div className="flex items-center gap-2">
                {assessment.linked_risk_id && (
                  <Link href={`/erm/risks/${assessment.linked_risk_id}`} className="text-[11px] font-medium text-blue-600 hover:text-blue-800">
                    Linked risk #{assessment.linked_risk_id} →
                  </Link>
                )}
                {canEdit && (
                  <button
                    onClick={() => gapMutation.mutate()}
                    disabled={gapMutation.isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 disabled:opacity-50"
                  >
                    {gapMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Star className="h-3.5 w-3.5" />}
                    Run AI gap analysis
                  </button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
              <span>Inherent: <span className="font-semibold">{assessment.inherent_score?.toFixed(1) ?? '—'}</span></span>
              <span>Residual (after controls): <span className="font-semibold">{assessment.residual_score?.toFixed(1) ?? '—'}</span></span>
              {gapResult?.source === 'fallback' && <span className="text-[10px] italic text-slate-400">(heuristic — no AI key)</span>}
            </div>
            {gapResult?.summary && <p className="mt-1 text-[11px] text-slate-500">{gapResult.summary}</p>}
            {Array.isArray(assessment.gap_analysis) && assessment.gap_analysis.length > 0 ? (
              <div className="mt-2 space-y-1">
                {assessment.gap_analysis.map((g, idx) => (
                  <div key={idx} className="rounded-lg border border-gray-100 bg-gray-50 p-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium text-slate-800">{g.gap || 'Control gap'}</p>
                      {g.severity && <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize ${getRatingColor(g.severity)}`}>{g.severity}</span>}
                    </div>
                    {(g.control_ref || g.residual_after_controls) && (
                      <p className="mt-0.5 text-[10px] text-slate-500">
                        {g.control_ref ? `Control: ${g.control_ref}` : ''}
                        {g.control_ref && g.residual_after_controls ? ' · ' : ''}
                        {g.residual_after_controls ? `Residual: ${g.residual_after_controls}` : ''}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-gray-400">Run AI gap analysis to estimate the residual risk that remains after the vendor's existing controls and explain each gap.</p>
            )}
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Assessment Details */}
            <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">Assessment Details</h3>
              {[
                { label: 'Type', value: formatAssessmentType(assessment.assessment_type) },
                { label: 'Assessor', value: assessment.assessor ? (typeof assessment.assessor === 'object' ? assessment.assessor.full_name : assessment.assessor) : '-' },
                { label: 'Reviewer', value: assessment.reviewer ? (typeof assessment.reviewer === 'object' ? assessment.reviewer.full_name : assessment.reviewer) : '-' },
                { label: 'Due Date', value: assessment.due_date ? new Date(assessment.due_date).toLocaleDateString() : '-' },
                { label: 'Created', value: assessment.created_at ? new Date(assessment.created_at).toLocaleDateString() : '-' },
                { label: 'Completed', value: assessment.completed_at ? new Date(assessment.completed_at).toLocaleDateString() : '-' },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between py-1">
                  <span className="text-sm text-gray-500">{label}</span>
                  <span className="text-sm font-medium text-gray-900">{String(value)}</span>
                </div>
              ))}

              {/* Status Change */}
              {!isApproved && canEdit && (
                <div className="pt-3 border-t border-gray-100">
                  <label className="block text-sm font-medium text-gray-800 mb-1">Change Status</label>
                  <MultiSelectDropdown
                    title="Status"
                    multiSelect={false}
                    triggerVariant="input"
                    size="md"
                    placeholder="Select status..."
                    selectedValues={[assessment.status]}
                    onApply={(values) => {
                      const v = values[0];
                      if (v && v !== assessment.status) handleStatusChange(v);
                    }}
                    items={STATUS_FLOW.filter((s) => s !== 'approved').map((s) => ({
                      value: s,
                      label: STATUS_LABELS[s],
                    }))}
                  />
                </div>
              )}
            </div>

            {/* Vendor & Template */}
            <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">Linked Records</h3>
              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-gray-500">Vendor</span>
                <Link href={`/vendor-risk/vendors/${assessment.vendor_id}`} className="text-sm font-medium text-blue-600 hover:text-blue-800">
                  {assessment.vendor_name || `#${assessment.vendor_id}`}
                </Link>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-gray-500">Template</span>
                <span className="text-sm font-medium text-gray-900">{assessment.template_name || 'None'}</span>
              </div>
              <div className="flex items-center justify-between py-1">
                <span className="text-sm text-gray-500">Questionnaire Responses</span>
                <span className="text-sm font-medium text-gray-900">{assessment.questionnaire_responses?.length ?? 0}</span>
              </div>
            </div>
          </div>

          {/* Findings */}
          <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-900">Findings ({findings.length})</h3>
              {editFindings !== null && (
                <button
                  onClick={handleSaveFindings}
                  disabled={updateMutation.isPending}
                  className="cw-btn-primary inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                >
                  {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  Save
                </button>
              )}
            </div>
            {findings.length === 0 && editFindings === null ? (
              <p className="text-sm text-gray-400 italic">No findings recorded yet.</p>
            ) : (
              <ul className="space-y-2">
                {findings.map((f, idx) => (
                  <li key={idx} className="flex items-start gap-2 group">
                    <AlertTriangle className="h-4 w-4 text-orange-500 mt-0.5 shrink-0" />
                    <span className="text-sm text-gray-700 flex-1">{String(f)}</span>
                    {editFindings !== null && (
                      <button onClick={() => removeFinding(idx)} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!isApproved && canEdit && (
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Add a finding..."
                  value={newFinding}
                  onChange={(e) => setNewFinding(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { addFinding(); } }}
                  onFocus={() => { if (editFindings === null) setEditFindings([...(assessment.findings ?? [])]); }}
                  className="flex-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
                <button
                  onClick={addFinding}
                  className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm text-gray-600"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>

          {/* Recommendations */}
          <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-900">Recommendations ({recommendations.length})</h3>
              {editRecommendations !== null && (
                <button
                  onClick={handleSaveRecommendations}
                  disabled={updateMutation.isPending}
                  className="cw-btn-primary inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                >
                  {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                  Save
                </button>
              )}
            </div>
            {recommendations.length === 0 && editRecommendations === null ? (
              <p className="text-sm text-gray-400 italic">No recommendations recorded yet.</p>
            ) : (
              <ul className="space-y-2">
                {recommendations.map((r, idx) => (
                  <li key={idx} className="flex items-start gap-2 group">
                    <CheckCircle2 className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
                    <span className="text-sm text-gray-700 flex-1">{String(r)}</span>
                    {editRecommendations !== null && (
                      <button onClick={() => removeRecommendation(idx)} className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-600">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!isApproved && canEdit && (
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Add a recommendation..."
                  value={newRecommendation}
                  onChange={(e) => setNewRecommendation(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { addRecommendation(); } }}
                  onFocus={() => { if (editRecommendations === null) setEditRecommendations([...(assessment.recommendations ?? [])]); }}
                  className="flex-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
                <button
                  onClick={addRecommendation}
                  className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg text-sm text-gray-600"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* â•â•â• Questionnaire Tab â•â•â• */}
      {activeTab === 'questionnaire' && (
        <div className="space-y-4" role="tabpanel" id="assessment-panel-questionnaire" aria-labelledby="assessment-tab-questionnaire">
          {(assessment.questionnaire_responses ?? []).length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
              <ClipboardList className="h-10 w-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-500 mb-2">No questionnaire responses linked to this assessment.</p>
              <p className="text-xs text-gray-400">Send a questionnaire to the vendor from the Questionnaires page, then responses will appear here.</p>
              {linkedTemplate && (linkedTemplate.questions || []).length > 0 && (
                <div className="mt-6 text-left border border-gray-200 rounded-lg overflow-hidden">
                  <div className="px-4 py-3 bg-gray-50 border-b border-gray-200">
                    <p className="text-sm font-semibold text-slate-900">Questions linked to this assessment</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Template: {linkedTemplate.name} â€¢ Category: {linkedTemplate.category || getAssessmentCategory(assessment.assessment_type)}
                    </p>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {linkedTemplate.questions.map((q, idx) => (
                      <div key={q.id || String(idx)} className="px-4 py-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-xs text-gray-500">Q{idx + 1}</span>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                            {getQuestionCategory(q, assessment.assessment_type)}
                          </span>
                        </div>
                        <p className="text-sm text-gray-800">{q.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            (assessment.questionnaire_responses ?? []).map((qr) => {
              const questions = qr.questions || [];
              const qrResponses = qr.responses || {};
              const qrEvidence = qr.evidence || {};
              const answeredCount = questions.filter((q) => qrResponses[q.id] !== undefined && qrResponses[q.id] !== '').length;
              const evidenceRequired = questions.filter((q) => q.evidence_required).length;
              const evidenceProvided = questions.filter((q) => q.evidence_required && qrEvidence[q.id]?.length > 0).length;
              const groupedQuestions = questions.reduce((acc, q, idx) => {
                const category = getQuestionCategory(q, assessment.assessment_type);
                if (!acc[category]) acc[category] = [];
                acc[category].push({ question: q, index: idx });
                return acc;
              }, {} as Record<string, Array<{ question: TemplateQuestion; index: number }>>);
              const categoryEntries = Object.entries(groupedQuestions);

              return (
                <div key={qr.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  {/* Response Header */}
                  <div className="px-5 py-4 border-b border-gray-200">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">Response #{qr.id}</p>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                          {qr.respondent_name && (
                            <span className="flex items-center gap-1"><User className="h-3 w-3" />{qr.respondent_name}</span>
                          )}
                          {qr.respondent_email && (
                            <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{qr.respondent_email}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize border ${getStatusPill(qr.status)}`}>
                          {qr.status}
                        </span>
                        {qr.submitted_at && (
                          <span className="text-xs text-gray-400">
                            Submitted {new Date(qr.submitted_at).toLocaleDateString()}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Progress summary */}
                    {questions.length > 0 && (
                      <div className="mt-3 flex items-center gap-4 text-xs text-gray-500">
                        <span>{answeredCount}/{questions.length} answered</span>
                        <span>{questions.length} sent questions</span>
                        {evidenceRequired > 0 && (
                          <span className={evidenceProvided < evidenceRequired ? 'text-orange-500' : 'text-green-600'}>
                            <Paperclip className="h-3 w-3 inline mr-0.5" />
                            {evidenceProvided}/{evidenceRequired} evidence provided
                          </span>
                        )}
                        <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full bg-blue-600 rounded-full" style={{ width: `${questions.length > 0 ? (answeredCount / questions.length) * 100 : 0}%` }} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Questions + Answers */}
                  <div className="divide-y divide-gray-100">
                    {questions.length > 0 ? (
                      categoryEntries.map(([category, rows]) => (
                        <div key={category} className="border-t border-gray-100 first:border-t-0">
                          <div className="px-5 py-2 bg-gray-50 border-b border-gray-100">
                            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                              {category} ({rows.length})
                            </p>
                          </div>
                          {rows.map(({ question: q, index: idx }) => {
                            const answer = qrResponses[q.id];
                            const qEvFiles = qrEvidence[q.id] || [];
                            const isAnswered = answer !== undefined && answer !== '';

                            return (
                              <div key={`${category}-${q.id}-${idx}`} className="px-5 py-4 border-b border-gray-50 last:border-b-0">
                                <div className="flex items-start gap-3">
                                  <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${isAnswered ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-400'}`}>
                                    {isAnswered ? <CheckCircle2 className="h-3.5 w-3.5" /> : idx + 1}
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm text-gray-800">{q.text}</p>
                                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                                      <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded capitalize">{q.type.replace('_', '/')}</span>
                                      {q.weight > 3 && <span className="text-xs text-gray-400">Weight: {q.weight}/5</span>}
                                      {q.evidence_required && (
                                        <span className={`text-xs flex items-center gap-0.5 ${qEvFiles.length > 0 ? 'text-green-600' : 'text-orange-500'}`}>
                                          <Paperclip className="h-3 w-3" />
                                          {qEvFiles.length > 0 ? 'Evidence provided' : 'Evidence required'}
                                        </span>
                                      )}
                                    </div>

                                    <div className="mt-2">
                                      {!isAnswered ? (
                                        <p className="text-sm text-gray-300 italic">No answer provided</p>
                                      ) : q.type === 'yes_no' ? (
                                        <span className={`inline-flex px-3 py-1 rounded-full text-sm font-medium ${
                                          String(answer).toLowerCase() === 'yes' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                        }`}>
                                          {String(answer).charAt(0).toUpperCase() + String(answer).slice(1)}
                                        </span>
                                      ) : q.type === 'rating' ? (
                                        <div className="flex items-center gap-0.5">
                                          {[1, 2, 3, 4, 5].map((s) => (
                                            <Star key={s} className={`h-4 w-4 ${Number(answer) >= s ? 'text-yellow-500 fill-yellow-500' : 'text-gray-200'}`} />
                                          ))}
                                          <span className="text-sm text-gray-500 ml-1">{String(answer)}/5</span>
                                        </div>
                                      ) : q.type === 'multiple_choice' ? (
                                        <span className="inline-flex px-3 py-1 rounded-lg text-sm bg-blue-50 text-blue-700 border border-blue-200">
                                          {String(answer)}
                                        </span>
                                      ) : (
                                        <p className="text-sm text-gray-900 bg-gray-50 rounded-lg p-3">{String(answer)}</p>
                                      )}
                                    </div>

                                    {qEvFiles.length > 0 && (
                                      <div className="mt-2 space-y-1">
                                        {qEvFiles.map((ev) => (
                                          <div key={ev.id} className="flex items-center gap-2 text-xs text-gray-500">
                                            <FileText className="h-3 w-3 text-green-500" />
                                            <span className="truncate">{ev.file_name}</span>
                                            <span className="text-gray-300">({ev.file_type})</span>
                                            {ev.file_path && (
                                              <EvidencePreviewButton
                                                file={{
                                                  file_path: ev.file_path,
                                                  file_name: ev.file_name,
                                                  mime_type: ev.file_type,
                                                  file_size: ev.file_size,
                                                }}
                                                className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-blue-100"
                                                title="Preview file"
                                              />
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ))
                    ) : (
                      /* Fallback: raw response display when no template questions */
                      <div className="px-5 py-4">
                        {Object.keys(qrResponses).length === 0 ? (
                          <p className="text-sm text-gray-400 italic">No responses submitted yet.</p>
                        ) : (
                          <div className="space-y-3">
                            {Object.entries(qrResponses).map(([questionId, answer]) => (
                              <div key={questionId} className="border-b border-gray-100 pb-3 last:border-0 last:pb-0">
                                <p className="text-xs font-medium text-gray-500 mb-1">Question {questionId}</p>
                                <p className="text-sm text-gray-900">
                                  {typeof answer === 'object' && answer !== null ? JSON.stringify(answer) : String(answer)}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* â•â•â• Scoring & Approval Tab â•â•â• */}
      {activeTab === 'scoring' && (
        <div className="space-y-4 sm:space-y-6" role="tabpanel" id="assessment-panel-scoring" aria-labelledby="assessment-tab-scoring">
          {/* Current Scores */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 text-center">
              <p className="text-xs text-gray-500 mb-1">Inherent Score</p>
              <p className="text-3xl font-bold text-gray-900">{assessment.inherent_score?.toFixed(1) ?? '-'}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 text-center">
              <p className="text-xs text-gray-500 mb-1">Residual Score</p>
              <p className="text-3xl font-bold text-gray-900">{assessment.residual_score?.toFixed(1) ?? '-'}</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4 text-center">
              <p className="text-xs text-gray-500 mb-1">Risk Rating</p>
              <p className={`text-3xl font-bold capitalize ${assessment.risk_rating ? getRatingColor(assessment.risk_rating) : 'text-gray-400'}`}>
                {assessment.risk_rating || '-'}
              </p>
            </div>
          </div>

          {/* Score Result Banner */}
          {scoreResult && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-3 sm:p-4 flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
              <div>
                <p className="text-sm font-medium text-green-800">Scoring Complete</p>
                <p className="text-xs text-green-600">
                  Inherent: {scoreResult.inherent_score.toFixed(1)} | Residual: {scoreResult.residual_score.toFixed(1)} | Rating: {scoreResult.risk_rating}
                </p>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Calculate Score */}
            <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="h-5 w-5 text-blue-600" />
                <h3 className="text-sm font-semibold text-slate-900">Calculate Risk Score</h3>
              </div>
              <p className="text-xs text-gray-500 mb-4">
                Calculates a weighted risk score based on submitted questionnaire responses.
                Requires at least one submitted questionnaire response linked to this assessment.
              </p>
              {scoreMutation.isError && (
                <div className="mb-3 text-xs text-red-600 bg-red-50 p-2 rounded-lg">
                  {(scoreMutation.error as any)?.response?.data?.detail || 'Failed to calculate score. Ensure a submitted questionnaire response exists.'}
                </div>
              )}
              <button
                onClick={() => scoreMutation.mutate()}
                disabled={scoreMutation.isPending || isApproved || !canEdit}
                className="cw-btn-primary inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
              >
                {scoreMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                Calculate Score
              </button>
            </div>

            {/* Approve Assessment */}
            <div className="bg-white rounded-xl border border-gray-200 p-3 sm:p-4">
              <div className="flex items-center gap-2 mb-3">
                <Award className="h-5 w-5 text-green-600" />
                <h3 className="text-sm font-semibold text-slate-900">Approve Assessment</h3>
              </div>
              <p className="text-xs text-gray-500 mb-4">
                Approving finalizes this assessment and updates the vendor&apos;s risk scores.
                You can optionally override the risk rating before approving.
              </p>
              {isApproved ? (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="text-sm text-green-700 font-medium">This assessment has been approved</span>
                </div>
              ) : (
                <>
                  <div className="mb-3">
                    <label className="block text-sm font-medium text-gray-800 mb-1">Override Risk Rating (optional)</label>
                    <MultiSelectDropdown
                      title="Risk Rating"
                      multiSelect={false}
                      triggerVariant="input"
                      size="md"
                      placeholder="Use calculated rating"
                      selectedValues={approveRating ? [approveRating] : []}
                      onApply={(values) => setApproveRating(values[0] ?? '')}
                      items={[
                        { value: '', label: 'Use calculated rating' },
                        { value: 'critical', label: 'Critical' },
                        { value: 'high', label: 'High' },
                        { value: 'medium', label: 'Medium' },
                        { value: 'low', label: 'Low' },
                      ]}
                    />
                  </div>
                  {approveMutation.isError && (
                    <div className="mb-3 text-xs text-red-600 bg-red-50 p-2 rounded-lg">
                      {(approveMutation.error as any)?.response?.data?.detail || 'Failed to approve assessment.'}
                    </div>
                  )}
                  <button
                    onClick={() => approveMutation.mutate()}
                    disabled={approveMutation.isPending || !canEdit}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {approveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Award className="h-4 w-4" />}
                    Approve Assessment
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
