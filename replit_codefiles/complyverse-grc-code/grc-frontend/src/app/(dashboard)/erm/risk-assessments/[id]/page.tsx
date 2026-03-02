'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { riskAssessmentApi, ermApi } from '@/lib/api';
import {
  ArrowLeft, Save, Plus, Trash2, Loader2, AlertTriangle, Activity,
  AlertCircle, FileText, ChevronDown, ChevronUp, CheckCircle, XCircle,
  Shield, Edit2, X, ClipboardCheck, Link2, Sparkles, Server, ExternalLink,
} from 'lucide-react';

type AssessmentStatus = 'draft' | 'in_progress' | 'under_review' | 'approved' | 'closed';
type AssessmentType = 'periodic' | 'annual' | 'ad_hoc' | 'triggered';
type Methodology = 'qualitative' | 'quantitative' | 'semi_quantitative';

const STATUS_CONFIG: Record<AssessmentStatus, { label: string; color: string; bgColor: string }> = {
  draft: { label: 'Draft', color: 'text-slate-300', bgColor: 'bg-slate-500/20' },
  in_progress: { label: 'In Progress', color: 'text-blue-400', bgColor: 'bg-blue-500/20' },
  under_review: { label: 'Under Review', color: 'text-amber-400', bgColor: 'bg-amber-500/20' },
  approved: { label: 'Approved', color: 'text-emerald-400', bgColor: 'bg-emerald-500/20' },
  closed: { label: 'Closed', color: 'text-purple-400', bgColor: 'bg-purple-500/20' },
};

const getScoreColor = (score: number | null | undefined) => {
  if (!score) return { text: 'text-slate-400', bg: 'bg-slate-500/20' };
  if (score >= 21) return { text: 'text-red-400', bg: 'bg-red-500/20' };
  if (score >= 13) return { text: 'text-orange-400', bg: 'bg-orange-500/20' };
  if (score >= 6) return { text: 'text-amber-400', bg: 'bg-amber-500/20' };
  return { text: 'text-green-400', bg: 'bg-green-500/20' };
};

const getRatingStyle = (rating: string | null | undefined) => {
  switch (rating) {
    case 'critical': return { label: 'Critical', color: 'text-red-400', bg: 'bg-red-500/20' };
    case 'high': return { label: 'High', color: 'text-orange-400', bg: 'bg-orange-500/20' };
    case 'medium': return { label: 'Medium', color: 'text-amber-400', bg: 'bg-amber-500/20' };
    case 'low': return { label: 'Low', color: 'text-green-400', bg: 'bg-green-500/20' };
    default: return { label: 'Unrated', color: 'text-slate-400', bg: 'bg-slate-500/20' };
  }
};

const computeRating = (score: number | null) => {
  if (!score) return null;
  if (score >= 21) return 'critical';
  if (score >= 13) return 'high';
  if (score >= 6) return 'medium';
  return 'low';
};

const formatDate = (dateStr?: string | null) => {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

interface AssessedRisk {
  id: number;
  risk_id: number;
  risk_title: string;
  risk_category: string;
  inherent_likelihood: number | null;
  inherent_impact: number | null;
  inherent_score: number | null;
  residual_likelihood: number | null;
  residual_impact: number | null;
  residual_score: number | null;
  risk_rating: string | null;
  treatment_decision: string | null;
  rationale: string | null;
  control_effectiveness: string | null;
  notes: string | null;
  linked_kris: any[];
  linked_kris_count: number;
  linked_incidents: any[];
  linked_incidents_count: number;
  linked_rcsa_findings: any[];
  linked_rcsa_findings_count: number;
}

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
  lead_assessor_name?: string;
  notes?: string;
  created_at: string;
  updated_at?: string;
  assessed_risks: AssessedRisk[];
  assessed_risks_count: number;
}

interface SummaryData {
  total_risks_assessed: number;
  by_risk_rating: Record<string, number>;
  avg_inherent_score: number;
  avg_residual_score: number;
}

export default function RiskAssessmentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const assessmentId = Number(params.id);

  const [expandedRisks, setExpandedRisks] = useState<Set<number>>(new Set());
  const [editingScores, setEditingScores] = useState<Record<number, Record<string, unknown>>>({});
  const [showAddRisksModal, setShowAddRisksModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedRiskIds, setSelectedRiskIds] = useState<Set<number>>(new Set());
  const [linkModal, setLinkModal] = useState<{ type: 'kri' | 'incident' | 'rcsa'; arId: number } | null>(null);
  const [showCDESection, setShowCDESection] = useState(false);

  const { data: assessment, isLoading, error } = useQuery({
    queryKey: ['risk-assessment', assessmentId],
    queryFn: async () => {
      const res = await riskAssessmentApi.getById(assessmentId);
      return res.data as Assessment;
    },
  });

  const { data: summary } = useQuery({
    queryKey: ['risk-assessment-summary', assessmentId],
    queryFn: async () => {
      const res = await riskAssessmentApi.getSummary(assessmentId);
      return res.data as SummaryData;
    },
  });

  const { data: availableRisks, refetch: refetchAvailable } = useQuery({
    queryKey: ['risk-assessment-available', assessmentId],
    queryFn: async () => {
      const res = await riskAssessmentApi.getAvailableRisks(assessmentId);
      return res.data as Array<{ id: number; title: string; category: string; inherent_score: number | null; residual_score: number | null }>;
    },
    enabled: showAddRisksModal,
  });

  const { data: allKRIs } = useQuery({
    queryKey: ['all-kris'],
    queryFn: async () => { const res = await ermApi.kris.getAll(); return res.data; },
    enabled: linkModal?.type === 'kri',
  });

  const { data: allIncidents } = useQuery({
    queryKey: ['all-incidents'],
    queryFn: async () => { const res = await ermApi.incidents.getAll(); return res.data; },
    enabled: linkModal?.type === 'incident',
  });

  const { data: cdeData } = useQuery({
    queryKey: ['risk-assessment-cde', assessmentId],
    queryFn: async () => {
      const res = await riskAssessmentApi.getCDEAssets(assessmentId);
      return res.data as {
        assessment_id: number;
        assessment_name: string;
        cde_assets: Array<{
          id: number;
          name: string;
          asset_type: string;
          description: string | null;
          criticality: string;
          vendor: string | null;
          location: string | null;
          status: string;
          owner_name: string | null;
        }>;
        total_cde_assets: number;
        assessed_risks_count: number;
        risks_summary: Array<{ id: number; title: string; category: string; risk_category: string | null }>;
      };
    },
    enabled: showCDESection,
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['risk-assessment', assessmentId] });
    queryClient.invalidateQueries({ queryKey: ['risk-assessment-summary', assessmentId] });
    queryClient.invalidateQueries({ queryKey: ['risk-assessment-available', assessmentId] });
  };

  const statusMutation = useMutation({
    mutationFn: (newStatus: string) => riskAssessmentApi.updateStatus(assessmentId, { status: newStatus }),
    onSuccess: invalidateAll,
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => riskAssessmentApi.update(assessmentId, data),
    onSuccess: () => { invalidateAll(); setShowEditModal(false); },
  });

  const deleteMutation = useMutation({
    mutationFn: () => riskAssessmentApi.delete(assessmentId),
    onSuccess: () => router.push('/erm/risk-assessments'),
  });

  const bulkAddMutation = useMutation({
    mutationFn: (riskIds: number[]) => riskAssessmentApi.bulkAddRisks(assessmentId, riskIds),
    onSuccess: () => { invalidateAll(); setShowAddRisksModal(false); setSelectedRiskIds(new Set()); },
  });

  const updateRiskMutation = useMutation({
    mutationFn: ({ arId, data }: { arId: number; data: Record<string, unknown> }) =>
      riskAssessmentApi.updateRisk(assessmentId, arId, data),
    onSuccess: (_, vars) => {
      invalidateAll();
      setEditingScores(prev => { const n = { ...prev }; delete n[vars.arId]; return n; });
    },
  });

  const removeRiskMutation = useMutation({
    mutationFn: (arId: number) => riskAssessmentApi.removeRisk(assessmentId, arId),
    onSuccess: invalidateAll,
  });

  const linkKRIMutation = useMutation({
    mutationFn: ({ arId, data }: { arId: number; data: Record<string, unknown> }) =>
      riskAssessmentApi.linkKRI(assessmentId, arId, data),
    onSuccess: () => { invalidateAll(); setLinkModal(null); },
  });

  const unlinkKRIMutation = useMutation({
    mutationFn: ({ arId, linkId }: { arId: number; linkId: number }) =>
      riskAssessmentApi.unlinkKRI(assessmentId, arId, linkId),
    onSuccess: invalidateAll,
  });

  const linkIncidentMutation = useMutation({
    mutationFn: ({ arId, data }: { arId: number; data: Record<string, unknown> }) =>
      riskAssessmentApi.linkIncident(assessmentId, arId, data),
    onSuccess: () => { invalidateAll(); setLinkModal(null); },
  });

  const unlinkIncidentMutation = useMutation({
    mutationFn: ({ arId, linkId }: { arId: number; linkId: number }) =>
      riskAssessmentApi.unlinkIncident(assessmentId, arId, linkId),
    onSuccess: invalidateAll,
  });

  const linkRCSAMutation = useMutation({
    mutationFn: ({ arId, data }: { arId: number; data: Record<string, unknown> }) =>
      riskAssessmentApi.linkRCSAFinding(assessmentId, arId, data),
    onSuccess: () => { invalidateAll(); setLinkModal(null); },
  });

  const unlinkRCSAMutation = useMutation({
    mutationFn: ({ arId, linkId }: { arId: number; linkId: number }) =>
      riskAssessmentApi.unlinkRCSAFinding(assessmentId, arId, linkId),
    onSuccess: invalidateAll,
  });

  const [aiLoadingRiskId, setAiLoadingRiskId] = useState<number | null>(null);

  const aiSuggestMutation = useMutation({
    mutationFn: (arId: number) => riskAssessmentApi.aiSuggestRisk(assessmentId, arId),
    onSuccess: (res, arId) => {
      const suggestion = res.data;
      setEditingScores(prev => {
        const ar = assessment?.assessed_risks.find(r => r.id === arId);
        const base = ar ? {
          inherent_likelihood: ar.inherent_likelihood,
          inherent_impact: ar.inherent_impact,
          residual_likelihood: ar.residual_likelihood,
          residual_impact: ar.residual_impact,
          risk_rating: ar.risk_rating,
          treatment_decision: ar.treatment_decision,
          control_effectiveness: ar.control_effectiveness,
          rationale: ar.rationale || '',
          notes: ar.notes || '',
        } : {};
        const existing = prev[arId] || {};
        return {
          ...prev,
          [arId]: {
            ...base,
            ...existing,
            treatment_decision: suggestion.treatment_decision,
            control_effectiveness: suggestion.control_effectiveness,
            rationale: suggestion.rationale,
            notes: suggestion.notes,
          },
        };
      });
      setAiLoadingRiskId(null);
    },
    onError: () => {
      setAiLoadingRiskId(null);
    },
  });

  const isEditable = assessment?.status === 'draft' || assessment?.status === 'in_progress';

  const toggleExpand = (arId: number) => {
    setExpandedRisks(prev => {
      const next = new Set(prev);
      next.has(arId) ? next.delete(arId) : next.add(arId);
      return next;
    });
  };

  const getEditingData = (ar: AssessedRisk) => {
    return editingScores[ar.id] || {
      inherent_likelihood: ar.inherent_likelihood,
      inherent_impact: ar.inherent_impact,
      residual_likelihood: ar.residual_likelihood,
      residual_impact: ar.residual_impact,
      risk_rating: ar.risk_rating,
      treatment_decision: ar.treatment_decision,
      control_effectiveness: ar.control_effectiveness,
      rationale: ar.rationale || '',
      notes: ar.notes || '',
    };
  };

  const setEditField = (arId: number, field: string, value: unknown) => {
    setEditingScores(prev => {
      const existing = prev[arId] || {};
      const ar = assessment?.assessed_risks.find(r => r.id === arId);
      const base = ar ? {
        inherent_likelihood: ar.inherent_likelihood,
        inherent_impact: ar.inherent_impact,
        residual_likelihood: ar.residual_likelihood,
        residual_impact: ar.residual_impact,
        risk_rating: ar.risk_rating,
        treatment_decision: ar.treatment_decision,
        control_effectiveness: ar.control_effectiveness,
        rationale: ar.rationale || '',
        notes: ar.notes || '',
      } : {};
      return { ...prev, [arId]: { ...base, ...existing, [field]: value } };
    });
  };

  const handleSaveRisk = (arId: number) => {
    const data = editingScores[arId];
    if (!data) return;
    const il = Number(data.inherent_likelihood) || null;
    const ii = Number(data.inherent_impact) || null;
    const rl = Number(data.residual_likelihood) || null;
    const ri = Number(data.residual_impact) || null;
    const residualScore = rl && ri ? rl * ri : null;
    const payload: Record<string, unknown> = {
      ...data,
      inherent_likelihood: il,
      inherent_impact: ii,
      residual_likelihood: rl,
      residual_impact: ri,
      risk_rating: data.risk_rating || computeRating(residualScore),
    };
    updateRiskMutation.mutate({ arId, data: payload });
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (error || !assessment) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-red-400">
        <AlertCircle className="mb-2 h-8 w-8" />
        <p>Failed to load risk assessment</p>
        <Link href="/erm/risk-assessments" className="mt-4 text-sm text-primary-400 hover:underline">
          Back to Assessments
        </Link>
      </div>
    );
  }

  const statusStyle = STATUS_CONFIG[assessment.status] || STATUS_CONFIG.draft;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <Link
            href="/erm/risk-assessments"
            className="mt-1 rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <ArrowLeft size={20} />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-white">{assessment.name}</h1>
              <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle.bgColor} ${statusStyle.color}`}>
                {statusStyle.label}
              </span>
            </div>
            {assessment.description && (
              <p className="mt-1 text-sm text-slate-400">{assessment.description}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-4 text-xs text-slate-500">
              {assessment.methodology && <span>Methodology: {assessment.methodology.replace('_', '-')}</span>}
              {assessment.assessment_period_start && (
                <span>Period: {formatDate(assessment.assessment_period_start)} – {formatDate(assessment.assessment_period_end)}</span>
              )}
              {assessment.lead_assessor_name && <span>Lead: {assessment.lead_assessor_name}</span>}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {isEditable && (
            <button
              onClick={() => setShowEditModal(true)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-700"
            >
              <Edit2 size={14} />
              Edit
            </button>
          )}
          {assessment.status === 'draft' && (
            <>
              <button
                onClick={() => statusMutation.mutate('in_progress')}
                disabled={statusMutation.isPending}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {statusMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />}
                Start Assessment
              </button>
              <button
                onClick={() => { if (confirm('Delete this assessment?')) deleteMutation.mutate(); }}
                className="flex items-center gap-1.5 rounded-lg border border-red-500/50 px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/20"
              >
                <Trash2 size={14} />
              </button>
            </>
          )}
          {assessment.status === 'in_progress' && (
            <button
              onClick={() => statusMutation.mutate('under_review')}
              disabled={statusMutation.isPending}
              className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {statusMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <ClipboardCheck size={14} />}
              Submit for Review
            </button>
          )}
          {assessment.status === 'under_review' && (
            <>
              <button
                onClick={() => statusMutation.mutate('approved')}
                disabled={statusMutation.isPending}
                className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                <CheckCircle size={14} />
                Approve
              </button>
              <button
                onClick={() => statusMutation.mutate('in_progress')}
                disabled={statusMutation.isPending}
                className="flex items-center gap-1.5 rounded-lg border border-amber-500/50 px-3 py-1.5 text-sm text-amber-400 hover:bg-amber-500/20 disabled:opacity-50"
              >
                <XCircle size={14} />
                Send Back
              </button>
            </>
          )}
          {assessment.status === 'approved' && (
            <button
              onClick={() => statusMutation.mutate('closed')}
              disabled={statusMutation.isPending}
              className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
            >
              <CheckCircle size={14} />
              Close
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
          <p className="text-xs text-slate-400">Risks Assessed</p>
          <p className="mt-1 text-2xl font-bold text-white">{summary?.total_risks_assessed ?? assessment.assessed_risks_count}</p>
        </div>
        {['critical', 'high', 'medium', 'low'].map(rating => {
          const style = getRatingStyle(rating);
          const count = summary?.by_risk_rating?.[rating] || 0;
          return (
            <div key={rating} className="rounded-xl border border-slate-700 bg-slate-800 p-4">
              <div className="flex items-center gap-2">
                <div className={`h-2.5 w-2.5 rounded-full ${style.bg.replace('/20', '')}`} />
                <p className="text-xs text-slate-400">{style.label}</p>
              </div>
              <p className={`mt-1 text-2xl font-bold ${style.color}`}>{count}</p>
            </div>
          );
        })}
      </div>

      {summary && (
        <div className="flex gap-6 text-sm text-slate-400">
          <span>Avg Inherent Score: <strong className="text-white">{summary.avg_inherent_score.toFixed(1)}</strong></span>
          <span>Avg Residual Score: <strong className="text-white">{summary.avg_residual_score.toFixed(1)}</strong></span>
        </div>
      )}

      <div className="rounded-xl border border-slate-700 bg-slate-800">
        <button
          onClick={() => setShowCDESection(!showCDESection)}
          className="flex w-full items-center justify-between p-4"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/20">
              <Server size={18} className="text-blue-400" />
            </div>
            <div className="text-left">
              <h3 className="text-sm font-semibold text-white">CDE Systems (Cardholder Data Environment)</h3>
              <p className="text-xs text-slate-400">IT assets flagged as part of the cardholder data environment for PCI-DSS scope</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {cdeData && (
              <span className="rounded-full bg-blue-500/20 px-2.5 py-0.5 text-xs font-medium text-blue-400">
                {cdeData.total_cde_assets} asset{cdeData.total_cde_assets !== 1 ? 's' : ''}
              </span>
            )}
            {showCDESection ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
          </div>
        </button>

        {showCDESection && (
          <div className="border-t border-slate-700 p-4">
            {!cdeData ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : cdeData.cde_assets.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8">
                <Server className="mb-3 h-10 w-10 text-slate-500" />
                <p className="text-sm font-medium text-slate-300">No CDE assets found</p>
                <p className="mt-1 text-xs text-slate-400">Mark IT assets as CDE in the Asset Inventory to see them here.</p>
                <Link
                  href="/assets"
                  className="mt-3 flex items-center gap-1.5 rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-600"
                >
                  <ExternalLink size={12} />
                  Go to IT Assets
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-slate-600 bg-slate-700/50 p-3">
                    <p className="text-xs text-slate-400">Total CDE Assets</p>
                    <p className="mt-0.5 text-xl font-bold text-blue-400">{cdeData.total_cde_assets}</p>
                  </div>
                  <div className="rounded-lg border border-slate-600 bg-slate-700/50 p-3">
                    <p className="text-xs text-slate-400">Critical Assets</p>
                    <p className="mt-0.5 text-xl font-bold text-red-400">
                      {cdeData.cde_assets.filter(a => a.criticality === 'critical').length}
                    </p>
                  </div>
                  <div className="rounded-lg border border-slate-600 bg-slate-700/50 p-3">
                    <p className="text-xs text-slate-400">Assessed Risks</p>
                    <p className="mt-0.5 text-xl font-bold text-amber-400">{cdeData.assessed_risks_count}</p>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-lg border border-slate-600">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-600 bg-slate-700/50">
                        <th className="px-3 py-2 text-xs font-medium text-slate-400">Asset Name</th>
                        <th className="px-3 py-2 text-xs font-medium text-slate-400">Type</th>
                        <th className="px-3 py-2 text-xs font-medium text-slate-400">Criticality</th>
                        <th className="px-3 py-2 text-xs font-medium text-slate-400">Vendor</th>
                        <th className="px-3 py-2 text-xs font-medium text-slate-400">Owner</th>
                        <th className="px-3 py-2 text-xs font-medium text-slate-400">Status</th>
                        <th className="px-3 py-2 text-xs font-medium text-slate-400"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-700">
                      {cdeData.cde_assets.map(asset => {
                        const critColor = asset.criticality === 'critical' ? 'text-red-400 bg-red-500/20'
                          : asset.criticality === 'high' ? 'text-orange-400 bg-orange-500/20'
                          : asset.criticality === 'medium' ? 'text-amber-400 bg-amber-500/20'
                          : 'text-green-400 bg-green-500/20';
                        const statusColor = asset.status === 'active' ? 'text-emerald-400'
                          : asset.status === 'decommissioned' ? 'text-red-400'
                          : 'text-slate-400';
                        return (
                          <tr key={asset.id} className="hover:bg-slate-700/30">
                            <td className="px-3 py-2.5">
                              <div className="flex items-center gap-2">
                                <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-bold text-blue-400">CDE</span>
                                <span className="font-medium text-white">{asset.name}</span>
                              </div>
                              {asset.description && (
                                <p className="mt-0.5 text-xs text-slate-500 line-clamp-1">{asset.description}</p>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-slate-300 capitalize">{asset.asset_type?.replace(/_/g, ' ') || '—'}</td>
                            <td className="px-3 py-2.5">
                              <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${critColor}`}>
                                {asset.criticality || 'N/A'}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 text-slate-300">{asset.vendor || '—'}</td>
                            <td className="px-3 py-2.5 text-slate-300">{asset.owner_name || '—'}</td>
                            <td className={`px-3 py-2.5 capitalize ${statusColor}`}>{asset.status || '—'}</td>
                            <td className="px-3 py-2.5">
                              <Link
                                href={`/assets?highlight=${asset.id}`}
                                className="text-blue-400 hover:text-blue-300"
                                title="View asset"
                              >
                                <ExternalLink size={14} />
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {cdeData.risks_summary.length > 0 && (
                  <div className="mt-2 rounded-lg border border-slate-600 bg-slate-700/30 p-3">
                    <p className="mb-2 text-xs font-medium text-slate-400">Risks Being Assessed</p>
                    <div className="flex flex-wrap gap-2">
                      {cdeData.risks_summary.map(r => (
                        <span key={r.id} className="rounded-lg border border-slate-600 bg-slate-700 px-2.5 py-1 text-xs text-slate-300">
                          {r.title}
                          {r.category && <span className="ml-1.5 text-slate-500">({r.category})</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex items-center gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                  <AlertCircle size={14} className="shrink-0 text-blue-400" />
                  <p className="text-xs text-blue-300">
                    CDE assets are managed in the IT Asset Inventory. Toggle the CDE flag on any asset to include or exclude it from PCI-DSS scope.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Assessed Risks</h2>
        {isEditable && (
          <button
            onClick={() => { setShowAddRisksModal(true); refetchAvailable(); }}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
          >
            <Plus size={16} />
            Add Risks
          </button>
        )}
      </div>

      {assessment.assessed_risks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-700 bg-slate-800 py-16">
          <Shield className="mb-4 h-12 w-12 text-slate-500" />
          <h3 className="text-lg font-medium text-white">No risks assessed yet</h3>
          <p className="mt-1 text-sm text-slate-400">Add risks from the risk register to begin assessment.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {assessment.assessed_risks.map(ar => {
            const isExpanded = expandedRisks.has(ar.id);
            const editing = getEditingData(ar);
            const hasEdits = !!editingScores[ar.id];
            const il = Number(editing.inherent_likelihood) || 0;
            const ii = Number(editing.inherent_impact) || 0;
            const rl = Number(editing.residual_likelihood) || 0;
            const ri = Number(editing.residual_impact) || 0;
            const inherentScore = il && ii ? il * ii : ar.inherent_score;
            const residualScore = rl && ri ? rl * ri : ar.residual_score;
            const inherentColor = getScoreColor(inherentScore);
            const residualColor = getScoreColor(residualScore);
            const ratingStyle = getRatingStyle(editing.risk_rating as string || computeRating(residualScore));
            const categoryColors: Record<string, string> = {
              strategic: 'bg-purple-500/20 text-purple-400',
              operational: 'bg-blue-500/20 text-blue-400',
              financial: 'bg-green-500/20 text-green-400',
              compliance: 'bg-yellow-500/20 text-yellow-400',
              technology: 'bg-cyan-500/20 text-cyan-400',
              third_party: 'bg-orange-500/20 text-orange-400',
            };

            return (
              <div key={ar.id} className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
                <div className="p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-white">{ar.risk_title || `Risk #${ar.risk_id}`}</h3>
                        {ar.risk_category && (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${categoryColors[ar.risk_category] || 'bg-slate-500/20 text-slate-400'}`}>
                            {ar.risk_category.replace('_', ' ')}
                          </span>
                        )}
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ratingStyle.bg} ${ratingStyle.color}`}>
                          {ratingStyle.label}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {isEditable && (
                        <button
                          onClick={() => { setAiLoadingRiskId(ar.id); aiSuggestMutation.mutate(ar.id); }}
                          disabled={aiLoadingRiskId === ar.id}
                          className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 px-2 py-1 text-xs font-medium text-white hover:from-purple-700 hover:to-blue-700 disabled:opacity-50"
                          title="AI Assist"
                        >
                          {aiLoadingRiskId === ar.id ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                          AI Assist
                        </button>
                      )}
                      {isEditable && (
                        <button
                          onClick={() => { if (confirm('Remove this risk from assessment?')) removeRiskMutation.mutate(ar.id); }}
                          className="rounded p-1 text-slate-500 hover:bg-red-500/20 hover:text-red-400"
                          title="Remove risk"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => toggleExpand(ar.id)}
                        className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-white"
                      >
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">Inherent L</label>
                      <select
                        value={editing.inherent_likelihood as number || ''}
                        onChange={e => setEditField(ar.id, 'inherent_likelihood', e.target.value ? Number(e.target.value) : null)}
                        disabled={!isEditable}
                        className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-white disabled:opacity-60"
                      >
                        <option value="">—</option>
                        {[1,2,3,4,5].map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">Inherent I</label>
                      <select
                        value={editing.inherent_impact as number || ''}
                        onChange={e => setEditField(ar.id, 'inherent_impact', e.target.value ? Number(e.target.value) : null)}
                        disabled={!isEditable}
                        className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-white disabled:opacity-60"
                      >
                        <option value="">—</option>
                        {[1,2,3,4,5].map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">Inherent Score</label>
                      <div className={`rounded px-2 py-1.5 text-sm font-bold text-center ${inherentColor.bg} ${inherentColor.text}`}>
                        {inherentScore ?? '—'}
                      </div>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">Residual L</label>
                      <select
                        value={editing.residual_likelihood as number || ''}
                        onChange={e => setEditField(ar.id, 'residual_likelihood', e.target.value ? Number(e.target.value) : null)}
                        disabled={!isEditable}
                        className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-white disabled:opacity-60"
                      >
                        <option value="">—</option>
                        {[1,2,3,4,5].map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">Residual I</label>
                      <select
                        value={editing.residual_impact as number || ''}
                        onChange={e => setEditField(ar.id, 'residual_impact', e.target.value ? Number(e.target.value) : null)}
                        disabled={!isEditable}
                        className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-white disabled:opacity-60"
                      >
                        <option value="">—</option>
                        {[1,2,3,4,5].map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">Residual Score</label>
                      <div className={`rounded px-2 py-1.5 text-sm font-bold text-center ${residualColor.bg} ${residualColor.text}`}>
                        {residualScore ?? '—'}
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">Treatment Decision</label>
                      <select
                        value={editing.treatment_decision as string || ''}
                        onChange={e => setEditField(ar.id, 'treatment_decision', e.target.value || null)}
                        disabled={!isEditable}
                        className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-white disabled:opacity-60"
                      >
                        <option value="">Select...</option>
                        <option value="accept">Accept</option>
                        <option value="mitigate">Mitigate</option>
                        <option value="transfer">Transfer</option>
                        <option value="avoid">Avoid</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">Control Effectiveness</label>
                      <select
                        value={editing.control_effectiveness as string || ''}
                        onChange={e => setEditField(ar.id, 'control_effectiveness', e.target.value || null)}
                        disabled={!isEditable}
                        className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-white disabled:opacity-60"
                      >
                        <option value="">Select...</option>
                        <option value="effective">Effective</option>
                        <option value="partially_effective">Partially Effective</option>
                        <option value="ineffective">Ineffective</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">Rationale</label>
                      <textarea
                        value={editing.rationale as string || ''}
                        onChange={e => setEditField(ar.id, 'rationale', e.target.value)}
                        disabled={!isEditable}
                        rows={1}
                        className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-white placeholder-slate-500 disabled:opacity-60"
                        placeholder="Scoring rationale..."
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-slate-500">Notes</label>
                      <textarea
                        value={editing.notes as string || ''}
                        onChange={e => setEditField(ar.id, 'notes', e.target.value)}
                        disabled={!isEditable}
                        rows={1}
                        className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-sm text-white placeholder-slate-500 disabled:opacity-60"
                        placeholder="Additional notes..."
                      />
                    </div>
                  </div>

                  {isEditable && hasEdits && (
                    <div className="mt-3 flex justify-end">
                      <button
                        onClick={() => handleSaveRisk(ar.id)}
                        disabled={updateRiskMutation.isPending}
                        className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                      >
                        {updateRiskMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        Save Scoring
                      </button>
                    </div>
                  )}

                  <div className="mt-2 flex gap-4 text-xs text-slate-500">
                    <span className="flex items-center gap-1"><Activity size={12} /> {ar.linked_kris_count} KRIs</span>
                    <span className="flex items-center gap-1"><AlertTriangle size={12} /> {ar.linked_incidents_count} Incidents</span>
                    <span className="flex items-center gap-1"><FileText size={12} /> {ar.linked_rcsa_findings_count} RCSA</span>
                  </div>
                </div>

                {isExpanded && (
                  <ExpandedRiskSection
                    ar={ar}
                    isEditable={isEditable}
                    onLinkKRI={() => setLinkModal({ type: 'kri', arId: ar.id })}
                    onLinkIncident={() => setLinkModal({ type: 'incident', arId: ar.id })}
                    onLinkRCSA={() => setLinkModal({ type: 'rcsa', arId: ar.id })}
                    onUnlinkKRI={(linkId) => unlinkKRIMutation.mutate({ arId: ar.id, linkId })}
                    onUnlinkIncident={(linkId) => unlinkIncidentMutation.mutate({ arId: ar.id, linkId })}
                    onUnlinkRCSA={(linkId) => unlinkRCSAMutation.mutate({ arId: ar.id, linkId })}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {showAddRisksModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-2xl rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
              <h2 className="text-lg font-semibold text-white">Add Risks to Assessment</h2>
              <button onClick={() => { setShowAddRisksModal(false); setSelectedRiskIds(new Set()); }} className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-6 py-4">
              {!availableRisks ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-primary-400" /></div>
              ) : availableRisks.length === 0 ? (
                <p className="py-8 text-center text-slate-400">All risks have been added to this assessment.</p>
              ) : (
                <div className="space-y-2">
                  {availableRisks.map(risk => (
                    <label key={risk.id} className="flex items-center gap-3 rounded-lg border border-slate-700 p-3 cursor-pointer hover:bg-slate-800">
                      <input
                        type="checkbox"
                        checked={selectedRiskIds.has(risk.id)}
                        onChange={e => {
                          const next = new Set(selectedRiskIds);
                          e.target.checked ? next.add(risk.id) : next.delete(risk.id);
                          setSelectedRiskIds(next);
                        }}
                        className="rounded border-slate-500"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{risk.title}</p>
                        <div className="flex gap-3 mt-1 text-xs text-slate-400">
                          {risk.category && <span className="capitalize">{risk.category.replace('_', ' ')}</span>}
                          {risk.inherent_score != null && (
                            <span className={getScoreColor(risk.inherent_score).text}>Inherent: {risk.inherent_score}</span>
                          )}
                          {risk.residual_score != null && (
                            <span className={getScoreColor(risk.residual_score).text}>Residual: {risk.residual_score}</span>
                          )}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center justify-between border-t border-slate-700 px-6 py-4">
              <span className="text-sm text-slate-400">{selectedRiskIds.size} selected</span>
              <div className="flex gap-3">
                <button
                  onClick={() => { setShowAddRisksModal(false); setSelectedRiskIds(new Set()); }}
                  className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  onClick={() => bulkAddMutation.mutate(Array.from(selectedRiskIds))}
                  disabled={selectedRiskIds.size === 0 || bulkAddMutation.isPending}
                  className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {bulkAddMutation.isPending && <Loader2 size={14} className="animate-spin" />}
                  Add Selected ({selectedRiskIds.size})
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showEditModal && <EditAssessmentModal assessment={assessment} onClose={() => setShowEditModal(false)} onSave={(data) => updateMutation.mutate(data)} isPending={updateMutation.isPending} />}

      {linkModal && (
        <LinkModal
          type={linkModal.type}
          arId={linkModal.arId}
          kris={allKRIs}
          incidents={allIncidents}
          onClose={() => setLinkModal(null)}
          onLinkKRI={(data) => linkKRIMutation.mutate({ arId: linkModal.arId, data })}
          onLinkIncident={(data) => linkIncidentMutation.mutate({ arId: linkModal.arId, data })}
          onLinkRCSA={(data) => linkRCSAMutation.mutate({ arId: linkModal.arId, data })}
          isPending={linkKRIMutation.isPending || linkIncidentMutation.isPending || linkRCSAMutation.isPending}
        />
      )}
    </div>
  );
}

function ExpandedRiskSection({
  ar, isEditable,
  onLinkKRI, onLinkIncident, onLinkRCSA,
  onUnlinkKRI, onUnlinkIncident, onUnlinkRCSA,
}: {
  ar: AssessedRisk;
  isEditable: boolean;
  onLinkKRI: () => void;
  onLinkIncident: () => void;
  onLinkRCSA: () => void;
  onUnlinkKRI: (linkId: number) => void;
  onUnlinkIncident: (linkId: number) => void;
  onUnlinkRCSA: (linkId: number) => void;
}) {
  const [tab, setTab] = useState<'kris' | 'incidents' | 'rcsa'>('kris');

  const linkedKRIs = ar.linked_kris || [];
  const linkedIncidents = ar.linked_incidents || [];
  const linkedRCSA = ar.linked_rcsa_findings || [];

  const tabs = [
    { key: 'kris' as const, label: `KRIs (${linkedKRIs.length})`, icon: Activity },
    { key: 'incidents' as const, label: `Incidents (${linkedIncidents.length})`, icon: AlertTriangle },
    { key: 'rcsa' as const, label: `RCSA (${linkedRCSA.length})`, icon: FileText },
  ];

  return (
    <div className="border-t border-slate-700 bg-slate-850 px-4 pb-4">
      <div className="flex gap-1 border-b border-slate-700 pt-3">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 rounded-t px-3 py-2 text-xs font-medium transition-colors ${
              tab === t.key ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            <t.icon size={12} />
            {t.label}
          </button>
        ))}
      </div>

      <div className="pt-3">
        {tab === 'kris' && (
          <div className="space-y-2">
            {isEditable && (
              <button onClick={onLinkKRI} className="flex items-center gap-1.5 rounded bg-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-600">
                <Link2 size={12} /> Link KRI
              </button>
            )}
            {linkedKRIs.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">No KRIs linked yet.</p>
            ) : (
              linkedKRIs.map((kri: any) => (
                <div key={kri.id} className="flex items-center justify-between rounded bg-slate-700/50 px-3 py-2">
                  <div>
                    <p className="text-sm text-white">{kri.kri_name || `KRI #${kri.kri_id}`}</p>
                    <div className="flex gap-3 text-xs text-slate-400">
                      {kri.observed_value != null && <span>Value: {kri.observed_value}</span>}
                      {kri.threshold_status && <span className={kri.threshold_status === 'breached' ? 'text-red-400' : kri.threshold_status === 'warning' ? 'text-amber-400' : 'text-green-400'}>{kri.threshold_status}</span>}
                    </div>
                  </div>
                  {isEditable && (
                    <button onClick={() => onUnlinkKRI(kri.id)} className="rounded p-1 text-slate-500 hover:text-red-400"><X size={14} /></button>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'incidents' && (
          <div className="space-y-2">
            {isEditable && (
              <button onClick={onLinkIncident} className="flex items-center gap-1.5 rounded bg-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-600">
                <Link2 size={12} /> Link Incident
              </button>
            )}
            {linkedIncidents.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">No incidents linked yet.</p>
            ) : (
              linkedIncidents.map((inc: any) => (
                <div key={inc.id} className="flex items-center justify-between rounded bg-slate-700/50 px-3 py-2">
                  <div>
                    <p className="text-sm text-white">{inc.incident_title || `Incident #${inc.incident_id}`}</p>
                    {inc.impact_on_rating && <p className="text-xs text-slate-400">Impact: {inc.impact_on_rating}</p>}
                  </div>
                  {isEditable && (
                    <button onClick={() => onUnlinkIncident(inc.id)} className="rounded p-1 text-slate-500 hover:text-red-400"><X size={14} /></button>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'rcsa' && (
          <div className="space-y-2">
            {isEditable && (
              <button onClick={onLinkRCSA} className="flex items-center gap-1.5 rounded bg-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-600">
                <Link2 size={12} /> Link RCSA Finding
              </button>
            )}
            {linkedRCSA.length === 0 ? (
              <p className="text-xs text-slate-500 py-2">No RCSA findings linked yet.</p>
            ) : (
              linkedRCSA.map((f: any) => (
                <div key={f.id} className="flex items-center justify-between rounded bg-slate-700/50 px-3 py-2">
                  <div>
                    <p className="text-sm text-white">{f.finding_title || `Finding #${f.rcsa_finding_id}`}</p>
                    {f.relevance_notes && <p className="text-xs text-slate-400">{f.relevance_notes}</p>}
                  </div>
                  {isEditable && (
                    <button onClick={() => onUnlinkRCSA(f.id)} className="rounded p-1 text-slate-500 hover:text-red-400"><X size={14} /></button>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function EditAssessmentModal({
  assessment, onClose, onSave, isPending,
}: {
  assessment: Assessment;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState({
    name: assessment.name,
    description: assessment.description || '',
    assessment_type: assessment.assessment_type,
    methodology: assessment.methodology,
    scope: assessment.scope || '',
    assessment_period_start: assessment.assessment_period_start?.split('T')[0] || '',
    assessment_period_end: assessment.assessment_period_end?.split('T')[0] || '',
    notes: assessment.notes || '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = { name: form.name };
    if (form.description) payload.description = form.description;
    if (form.assessment_type) payload.assessment_type = form.assessment_type;
    if (form.methodology) payload.methodology = form.methodology;
    if (form.scope) payload.scope = form.scope;
    if (form.assessment_period_start) payload.assessment_period_start = form.assessment_period_start;
    if (form.assessment_period_end) payload.assessment_period_end = form.assessment_period_end;
    if (form.notes) payload.notes = form.notes;
    onSave(payload);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">Edit Assessment</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-4 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Name <span className="text-red-400">*</span></label>
            <input type="text" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white focus:border-primary-500 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Description</label>
            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white focus:border-primary-500 focus:outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Type</label>
              <select value={form.assessment_type} onChange={e => setForm({ ...form, assessment_type: e.target.value as AssessmentType })} className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white focus:border-primary-500 focus:outline-none">
                <option value="periodic">Periodic</option>
                <option value="annual">Annual</option>
                <option value="ad_hoc">Ad Hoc</option>
                <option value="triggered">Triggered</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Methodology</label>
              <select value={form.methodology} onChange={e => setForm({ ...form, methodology: e.target.value as Methodology })} className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white focus:border-primary-500 focus:outline-none">
                <option value="qualitative">Qualitative</option>
                <option value="quantitative">Quantitative</option>
                <option value="semi_quantitative">Semi-Quantitative</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Scope</label>
            <textarea value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value })} rows={2} className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white focus:border-primary-500 focus:outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Period Start</label>
              <input type="date" value={form.assessment_period_start} onChange={e => setForm({ ...form, assessment_period_start: e.target.value })} className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white focus:border-primary-500 focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Period End</label>
              <input type="date" value={form.assessment_period_end} onChange={e => setForm({ ...form, assessment_period_end: e.target.value })} className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white focus:border-primary-500 focus:outline-none" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Notes</label>
            <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white focus:border-primary-500 focus:outline-none" />
          </div>
          <div className="flex justify-end gap-3 border-t border-slate-700 pt-4">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700">Cancel</button>
            <button type="submit" disabled={isPending || !form.name.trim()} className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
              {isPending && <Loader2 size={14} className="animate-spin" />}
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function LinkModal({
  type, arId, kris, incidents, onClose,
  onLinkKRI, onLinkIncident, onLinkRCSA, isPending,
}: {
  type: 'kri' | 'incident' | 'rcsa';
  arId: number;
  kris?: any[];
  incidents?: any[];
  onClose: () => void;
  onLinkKRI: (data: Record<string, unknown>) => void;
  onLinkIncident: (data: Record<string, unknown>) => void;
  onLinkRCSA: (data: Record<string, unknown>) => void;
  isPending: boolean;
}) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [notes, setNotes] = useState('');

  const title = type === 'kri' ? 'Link KRI' : type === 'incident' ? 'Link Incident' : 'Link RCSA Finding';

  const handleLink = () => {
    if (!selectedId) return;
    if (type === 'kri') onLinkKRI({ kri_id: selectedId, notes: notes || undefined });
    else if (type === 'incident') onLinkIncident({ incident_id: selectedId, impact_on_rating: notes || undefined });
    else onLinkRCSA({ rcsa_finding_id: selectedId, relevance_notes: notes || undefined });
  };

  const items = type === 'kri' ? (kris || []) : type === 'incident' ? (incidents || []) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"><X size={20} /></button>
        </div>
        <div className="space-y-4 px-6 py-4 max-h-[60vh] overflow-y-auto">
          {type === 'rcsa' ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">RCSA Finding ID</label>
              <input type="number" value={selectedId || ''} onChange={e => setSelectedId(Number(e.target.value) || null)} placeholder="Enter finding ID" className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white focus:border-primary-500 focus:outline-none" />
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Select {type === 'kri' ? 'KRI' : 'Incident'}</label>
              {items.length === 0 ? (
                <p className="text-sm text-slate-400 py-4">No {type === 'kri' ? 'KRIs' : 'incidents'} available.</p>
              ) : (
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {items.map((item: any) => (
                    <label key={item.id} className={`flex items-center gap-2 rounded px-3 py-2 cursor-pointer ${selectedId === item.id ? 'bg-primary-600/20 border border-primary-500/50' : 'hover:bg-slate-800 border border-transparent'}`}>
                      <input type="radio" name="linkItem" checked={selectedId === item.id} onChange={() => setSelectedId(item.id)} className="accent-primary-500" />
                      <div>
                        <p className="text-sm text-white">{item.name || item.title}</p>
                        {item.severity && <span className="text-xs text-slate-400">{item.severity}</span>}
                        {item.status && <span className="ml-2 text-xs text-slate-400">{item.status}</span>}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">
              {type === 'incident' ? 'Impact on Rating' : 'Notes'}
            </label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder={type === 'incident' ? 'How does this incident impact the risk rating?' : 'Optional notes...'} className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white focus:border-primary-500 focus:outline-none" />
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-slate-700 px-6 py-4">
          <button onClick={onClose} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700">Cancel</button>
          <button onClick={handleLink} disabled={!selectedId || isPending} className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            {isPending && <Loader2 size={14} className="animate-spin" />}
            Link
          </button>
        </div>
      </div>
    </div>
  );
}
