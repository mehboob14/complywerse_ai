'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { risksApi, controlsApi, assetsApi, evidenceApi, governanceApi } from '@/lib/api';
import { RiskCategory, RiskStatus, NormalizedControl, ITAsset, Evidence, GovernanceObjective } from '@/types';
import { 
  ArrowLeft, Loader2, AlertCircle, AlertTriangle, Shield, 
  Target, TrendingDown, Calendar, User, FileText, Link as LinkIcon,
  Plus, X, Trash2, Edit, Save, Building2, ClipboardCheck, Search,
  Activity, BarChart3, Settings
} from 'lucide-react';
import Link from 'next/link';

interface RiskDetailData {
  id: number;
  tenant_id: number;
  title: string;
  description?: string;
  category?: string;
  risk_category: RiskCategory;
  owner_id?: number;
  owner_name?: string;
  inherent_likelihood?: number;
  inherent_impact?: number;
  inherent_score?: number;
  residual_likelihood?: number;
  residual_impact?: number;
  residual_score?: number;
  risk_appetite?: string;
  status: RiskStatus;
  treatment_plan?: string;
  due_date?: string;
  review_date?: string;
  created_at: string;
  updated_at: string;
  linked_controls: Array<{id: number; control_id: number; code: string; name: string}>;
  linked_framework_controls: Array<{id: number; framework_control_id: number; code: string; name: string; mitigation_effectiveness?: string; notes?: string}>;
  linked_assets: Array<{id: number; asset_id: number; name: string; asset_type: string}>;
  linked_evidence: Array<{id: number; evidence_id: number; name: string; status: string}>;
  linked_governance: Array<{id: number; governance_objective_id: number; name: string; impact_level: string}>;
}

const RISK_CATEGORIES: Record<string, { label: string; color: string }> = {
  strategic: { label: 'Strategic', color: 'bg-purple-100 text-purple-800 border-purple-200' },
  operational: { label: 'Operational', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  financial: { label: 'Financial', color: 'bg-green-100 text-green-800 border-green-200' },
  compliance: { label: 'Compliance', color: 'bg-amber-100 text-amber-800 border-amber-200' },
  technology: { label: 'Technology', color: 'bg-cyan-100 text-cyan-800 border-cyan-200' },
  third_party: { label: 'Third-Party', color: 'bg-orange-100 text-orange-800 border-orange-200' },
};

const RISK_STATUSES: Record<string, { label: string; color: string }> = {
  open: { label: 'Open', color: 'bg-red-100 text-red-800 border-red-200' },
  in_treatment: { label: 'In Treatment', color: 'bg-amber-100 text-amber-800 border-amber-200' },
  mitigating: { label: 'Mitigating', color: 'bg-amber-100 text-amber-800 border-amber-200' },
  mitigated: { label: 'Mitigated', color: 'bg-green-100 text-green-800 border-green-200' },
  accepted: { label: 'Accepted', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  closed: { label: 'Closed', color: 'bg-slate-100 text-slate-700 border-slate-200' },
};

const MITIGATION_EFFECTIVENESS = [
  { value: 'full', label: 'Full', color: 'text-green-700' },
  { value: 'partial', label: 'Partial', color: 'text-amber-700' },
  { value: 'minimal', label: 'Minimal', color: 'text-orange-700' },
  { value: 'none', label: 'None', color: 'text-red-700' },
];

const IMPACT_LEVELS = [
  { value: 'high', label: 'High', color: 'text-red-700' },
  { value: 'medium', label: 'Medium', color: 'text-amber-700' },
  { value: 'low', label: 'Low', color: 'text-green-700' },
];

type TabType = 'details' | 'treatment' | 'controls' | 'assets' | 'evidence' | 'governance';

export default function RiskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const riskId = Number(params.id);
  const queryClient = useQueryClient();
  
  const [activeTab, setActiveTab] = useState<TabType>('details');
  const [isEditingTreatment, setIsEditingTreatment] = useState(false);
  const [treatmentPlan, setTreatmentPlan] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showLinkControlModal, setShowLinkControlModal] = useState(false);
  const [showLinkFrameworkControlModal, setShowLinkFrameworkControlModal] = useState(false);
  const [showLinkAssetModal, setShowLinkAssetModal] = useState(false);
  const [showLinkEvidenceModal, setShowLinkEvidenceModal] = useState(false);
  const [showLinkGovernanceModal, setShowLinkGovernanceModal] = useState(false);

  const { data: risk, isLoading, error } = useQuery<RiskDetailData>({
    queryKey: ['risk-detail', riskId],
    queryFn: async () => {
      const response = await risksApi.getDetail(riskId);
      return response.data;
    },
  });

  useEffect(() => {
    if (risk?.treatment_plan) {
      setTreatmentPlan(risk.treatment_plan);
    }
  }, [risk?.treatment_plan]);

  const { data: allControls } = useQuery({
    queryKey: ['all-normalized-controls'],
    queryFn: async () => {
      const response = await controlsApi.getNormalized();
      return response.data;
    },
    enabled: showLinkControlModal,
  });

  const { data: allAssets } = useQuery({
    queryKey: ['all-assets'],
    queryFn: async () => {
      const response = await assetsApi.getAll();
      return response.data;
    },
    enabled: showLinkAssetModal,
  });

  const { data: allEvidence } = useQuery({
    queryKey: ['all-evidence'],
    queryFn: async () => {
      const response = await evidenceApi.getAll();
      return response.data;
    },
    enabled: showLinkEvidenceModal,
  });

  const { data: allGovernance } = useQuery({
    queryKey: ['all-governance-objectives'],
    queryFn: async () => {
      const response = await governanceApi.getObjectives();
      return response.data;
    },
    enabled: showLinkGovernanceModal,
  });

  const deleteMutation = useMutation({
    mutationFn: () => risksApi.delete(riskId),
    onSuccess: () => {
      router.push('/risks');
    },
  });

  const updateTreatmentMutation = useMutation({
    mutationFn: (plan: string) => risksApi.updateTreatment(riskId, plan),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['risk-detail', riskId] });
      setIsEditingTreatment(false);
    },
  });

  const linkControlMutation = useMutation({
    mutationFn: (data: { normalized_control_id: number }) => risksApi.linkControl(riskId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['risk-detail', riskId] });
      setShowLinkControlModal(false);
    },
  });

  const unlinkControlMutation = useMutation({
    mutationFn: (linkId: number) => risksApi.unlinkControl(riskId, linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['risk-detail', riskId] });
    },
  });

  const linkFrameworkControlMutation = useMutation({
    mutationFn: (data: { framework_control_id: number; mitigation_effectiveness: string; notes?: string }) => 
      risksApi.linkFrameworkControl(riskId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['risk-detail', riskId] });
      setShowLinkFrameworkControlModal(false);
    },
  });

  const unlinkFrameworkControlMutation = useMutation({
    mutationFn: (linkId: number) => risksApi.unlinkFrameworkControl(riskId, linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['risk-detail', riskId] });
    },
  });

  const linkAssetMutation = useMutation({
    mutationFn: (data: { asset_id: number }) => risksApi.linkAsset(riskId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['risk-detail', riskId] });
      setShowLinkAssetModal(false);
    },
  });

  const unlinkAssetMutation = useMutation({
    mutationFn: (linkId: number) => risksApi.unlinkAsset(riskId, linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['risk-detail', riskId] });
    },
  });

  const linkEvidenceMutation = useMutation({
    mutationFn: (data: { evidence_id: number }) => risksApi.linkEvidence(riskId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['risk-detail', riskId] });
      setShowLinkEvidenceModal(false);
    },
  });

  const unlinkEvidenceMutation = useMutation({
    mutationFn: (linkId: number) => risksApi.unlinkEvidence(riskId, linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['risk-detail', riskId] });
    },
  });

  const linkGovernanceMutation = useMutation({
    mutationFn: (data: { governance_objective_id: number; impact_level: string }) => 
      risksApi.linkGovernance(riskId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['risk-detail', riskId] });
      setShowLinkGovernanceModal(false);
    },
  });

  const unlinkGovernanceMutation = useMutation({
    mutationFn: (linkId: number) => risksApi.unlinkGovernance(riskId, linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['risk-detail', riskId] });
    },
  });

  const getScoreColor = (score: number | null | undefined) => {
    if (!score) return 'text-slate-600';
    if (score >= 20) return 'text-red-700';
    if (score >= 12) return 'text-orange-700';
    if (score >= 6) return 'text-amber-700';
    return 'text-green-700';
  };

  const getScoreBgColor = (score: number | null | undefined) => {
    if (!score) return 'bg-slate-100';
    if (score >= 20) return 'bg-red-500';
    if (score >= 12) return 'bg-orange-500';
    if (score >= 6) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getCategoryStyle = (category?: string) => {
    return RISK_CATEGORIES[category || 'operational'] || RISK_CATEGORIES.operational;
  };

  const getStatusStyle = (status?: string) => {
    return RISK_STATUSES[status || 'open'] || RISK_STATUSES.open;
  };

  const calculateRiskReduction = () => {
    if (!risk?.inherent_score || !risk?.residual_score) return null;
    const reduction = ((risk.inherent_score - risk.residual_score) / risk.inherent_score) * 100;
    return Math.round(reduction);
  };

  const getTreatmentStatus = () => {
    if (!risk) return { label: 'Not Set', color: 'text-slate-600' };
    if (risk.treatment_plan && risk.status === 'mitigated') {
      return { label: 'Completed', color: 'text-green-700' };
    }
    if (risk.treatment_plan) {
      return { label: 'In Progress', color: 'text-amber-700' };
    }
    return { label: 'Not Started', color: 'text-red-700' };
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (error || !risk) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-red-400">
        <AlertCircle className="mb-2 h-8 w-8" />
        <p>Failed to load risk details</p>
        <Link href="/risks" className="mt-4 text-primary-400 hover:underline">
          Back to Risks
        </Link>
      </div>
    );
  }

  const tabs: { id: TabType; label: string; icon: React.ElementType }[] = [
    { id: 'details', label: 'Details', icon: ClipboardCheck },
    { id: 'treatment', label: 'Treatment', icon: Activity },
    { id: 'controls', label: 'Controls', icon: Shield },
    { id: 'assets', label: 'Assets', icon: Building2 },
    { id: 'evidence', label: 'Evidence', icon: FileText },
    { id: 'governance', label: 'Governance', icon: Target },
  ];

  const riskReduction = calculateRiskReduction();
  const treatmentStatus = getTreatmentStatus();
  const categoryStyle = getCategoryStyle(risk.risk_category || risk.category);
  const statusStyle = getStatusStyle(risk.status);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/risks"
          className="rounded-lg p-2 text-slate-600 hover:bg-white hover:text-slate-900"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-900">{risk.title}</h1>
          <p className="text-slate-600">{risk.description || 'No description'}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`rounded-full border px-3 py-1 text-sm ${categoryStyle.color}`}>
            {categoryStyle.label}
          </span>
          <span className={`rounded-full border px-3 py-1 text-sm ${statusStyle.color}`}>
            {statusStyle.label}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2 text-slate-900 hover:bg-slate-200"
          >
            <Edit className="h-4 w-4" />
            Edit
          </button>
          <button
            onClick={() => {
              setActiveTab('treatment');
              setIsEditingTreatment(true);
            }}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-white hover:bg-primary-700"
          >
            <Activity className="h-4 w-4" />
            Update Treatment
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-red-700 hover:bg-red-100"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2 text-slate-600">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm font-medium">Inherent Risk Score</span>
          </div>
          <div className={`text-3xl font-bold ${getScoreColor(risk.inherent_score)}`}>
            {risk.inherent_score ?? '-'}
          </div>
          <p className="mt-2 text-sm text-slate-500">
            Likelihood: {risk.inherent_likelihood ?? '-'} × Impact: {risk.inherent_impact ?? '-'}
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2 text-slate-600">
            <TrendingDown className="h-4 w-4" />
            <span className="text-sm font-medium">Residual Risk Score</span>
          </div>
          <div className={`text-3xl font-bold ${getScoreColor(risk.residual_score)}`}>
            {risk.residual_score ?? '-'}
          </div>
          <p className="mt-2 text-sm text-slate-500">
            Likelihood: {risk.residual_likelihood ?? '-'} × Impact: {risk.residual_impact ?? '-'}
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2 text-slate-600">
            <Settings className="h-4 w-4" />
            <span className="text-sm font-medium">Treatment Status</span>
          </div>
          <div className={`text-xl font-bold ${treatmentStatus.color}`}>
            {treatmentStatus.label}
          </div>
          <p className="mt-2 text-sm text-slate-500">
            {risk.treatment_plan ? 'Treatment plan exists' : 'No treatment plan'}
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2 text-slate-600">
            <User className="h-4 w-4" />
            <span className="text-sm font-medium">Owner / Due Date</span>
          </div>
          <div className="text-lg font-medium text-slate-900">
            {risk.owner_name || 'Unassigned'}
          </div>
          <p className="mt-2 flex items-center gap-1 text-sm text-slate-500">
            <Calendar className="h-3 w-3" />
            Due: {formatDate(risk.due_date)}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">Risk Score Comparison</h3>
        <div className="grid gap-6 md:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm text-slate-600">Inherent Risk</span>
              <span className={`font-bold ${getScoreColor(risk.inherent_score)}`}>
                {risk.inherent_score ?? 0}/25
              </span>
            </div>
            <div className="h-4 w-full rounded-full bg-slate-100">
              <div
                className={`h-4 rounded-full transition-all ${getScoreBgColor(risk.inherent_score)}`}
                style={{ width: `${((risk.inherent_score || 0) / 25) * 100}%` }}
              />
            </div>
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm text-slate-600">Residual Risk</span>
              <span className={`font-bold ${getScoreColor(risk.residual_score)}`}>
                {risk.residual_score ?? 0}/25
              </span>
            </div>
            <div className="h-4 w-full rounded-full bg-slate-100">
              <div
                className={`h-4 rounded-full transition-all ${getScoreBgColor(risk.residual_score)}`}
                style={{ width: `${((risk.residual_score || 0) / 25) * 100}%` }}
              />
            </div>
          </div>
        </div>
        {riskReduction !== null && (
          <div className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-white p-3">
            <BarChart3 className="h-5 w-5 text-green-700" />
            <span className="text-slate-700">Risk Reduction:</span>
            <span className="text-xl font-bold text-green-700">{riskReduction}%</span>
          </div>
        )}
      </div>

      <div className="border-b border-slate-200">
        <nav className="flex gap-1">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'border-primary-500 text-primary-400'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-6">
        {activeTab === 'details' && (
          <DetailsTab risk={risk} formatDate={formatDate} />
        )}
        {activeTab === 'treatment' && (
          <TreatmentTab
            risk={risk}
            treatmentPlan={treatmentPlan}
            setTreatmentPlan={setTreatmentPlan}
            isEditing={isEditingTreatment}
            setIsEditing={setIsEditingTreatment}
            onSave={() => updateTreatmentMutation.mutate(treatmentPlan)}
            isSaving={updateTreatmentMutation.isPending}
          />
        )}
        {activeTab === 'controls' && (
          <ControlsTab
            risk={risk}
            onLinkControl={() => setShowLinkControlModal(true)}
            onLinkFrameworkControl={() => setShowLinkFrameworkControlModal(true)}
            onUnlinkControl={(linkId) => unlinkControlMutation.mutate(linkId)}
            onUnlinkFrameworkControl={(linkId) => unlinkFrameworkControlMutation.mutate(linkId)}
            isUnlinking={unlinkControlMutation.isPending || unlinkFrameworkControlMutation.isPending}
          />
        )}
        {activeTab === 'assets' && (
          <AssetsTab
            risk={risk}
            onLinkAsset={() => setShowLinkAssetModal(true)}
            onUnlinkAsset={(linkId) => unlinkAssetMutation.mutate(linkId)}
            isUnlinking={unlinkAssetMutation.isPending}
          />
        )}
        {activeTab === 'evidence' && (
          <EvidenceTab
            risk={risk}
            onLinkEvidence={() => setShowLinkEvidenceModal(true)}
            onUnlinkEvidence={(linkId) => unlinkEvidenceMutation.mutate(linkId)}
            isUnlinking={unlinkEvidenceMutation.isPending}
          />
        )}
        {activeTab === 'governance' && (
          <GovernanceTab
            risk={risk}
            onLinkGovernance={() => setShowLinkGovernanceModal(true)}
            onUnlinkGovernance={(linkId) => unlinkGovernanceMutation.mutate(linkId)}
            isUnlinking={unlinkGovernanceMutation.isPending}
          />
        )}
      </div>

      {showDeleteConfirm && (
        <DeleteConfirmModal
          riskTitle={risk.title}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={() => deleteMutation.mutate()}
          isDeleting={deleteMutation.isPending}
        />
      )}

      {showLinkControlModal && (
        <LinkControlModal
          onClose={() => setShowLinkControlModal(false)}
          onLink={(controlId) => linkControlMutation.mutate({ normalized_control_id: controlId })}
          isLinking={linkControlMutation.isPending}
          linkedControlIds={risk.linked_controls?.map(c => c.control_id) || []}
          allControls={allControls || []}
        />
      )}

      {showLinkFrameworkControlModal && (
        <LinkFrameworkControlModal
          onClose={() => setShowLinkFrameworkControlModal(false)}
          onLink={(controlId, effectiveness, notes) => 
            linkFrameworkControlMutation.mutate({ 
              framework_control_id: controlId, 
              mitigation_effectiveness: effectiveness,
              notes 
            })
          }
          isLinking={linkFrameworkControlMutation.isPending}
          linkedControlIds={risk.linked_framework_controls?.map(c => c.framework_control_id) || []}
        />
      )}

      {showLinkAssetModal && (
        <LinkAssetModal
          onClose={() => setShowLinkAssetModal(false)}
          onLink={(assetId) => linkAssetMutation.mutate({ asset_id: assetId })}
          isLinking={linkAssetMutation.isPending}
          linkedAssetIds={risk.linked_assets?.map(a => a.asset_id) || []}
          allAssets={allAssets || []}
        />
      )}

      {showLinkEvidenceModal && (
        <LinkEvidenceModal
          onClose={() => setShowLinkEvidenceModal(false)}
          onLink={(evidenceId) => linkEvidenceMutation.mutate({ evidence_id: evidenceId })}
          isLinking={linkEvidenceMutation.isPending}
          linkedEvidenceIds={risk.linked_evidence?.map(e => e.evidence_id) || []}
          allEvidence={allEvidence || []}
        />
      )}

      {showLinkGovernanceModal && (
        <LinkGovernanceModal
          onClose={() => setShowLinkGovernanceModal(false)}
          onLink={(objectiveId, impactLevel) => 
            linkGovernanceMutation.mutate({ governance_objective_id: objectiveId, impact_level: impactLevel })
          }
          isLinking={linkGovernanceMutation.isPending}
          linkedGovernanceIds={risk.linked_governance?.map(g => g.governance_objective_id) || []}
          allGovernance={allGovernance || []}
        />
      )}
    </div>
  );
}

function DetailsTab({ risk, formatDate }: { risk: RiskDetailData; formatDate: (d?: string) => string }) {
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <ClipboardCheck className="h-5 w-5 text-primary-400" />
          Description
        </h3>
        <p className="text-slate-700">{risk.description || 'No description provided'}</p>
      </div>

      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <Calendar className="h-5 w-5 text-primary-400" />
          Important Dates
        </h3>
        <div className="space-y-3">
          <div>
            <span className="text-sm text-slate-600">Created</span>
            <p className="text-slate-900">{formatDate(risk.created_at)}</p>
          </div>
          <div>
            <span className="text-sm text-slate-600">Due Date</span>
            <p className="text-slate-900">{formatDate(risk.due_date)}</p>
          </div>
          <div>
            <span className="text-sm text-slate-600">Review Date</span>
            <p className="text-slate-900">{formatDate(risk.review_date)}</p>
          </div>
          <div>
            <span className="text-sm text-slate-600">Last Updated</span>
            <p className="text-slate-900">{formatDate(risk.updated_at)}</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <Target className="h-5 w-5 text-primary-400" />
          Risk Appetite
        </h3>
        <p className="text-slate-700">{risk.risk_appetite || 'Not defined'}</p>
      </div>
    </div>
  );
}

function TreatmentTab({
  risk,
  treatmentPlan,
  setTreatmentPlan,
  isEditing,
  setIsEditing,
  onSave,
  isSaving,
}: {
  risk: RiskDetailData;
  treatmentPlan: string;
  setTreatmentPlan: (plan: string) => void;
  isEditing: boolean;
  setIsEditing: (editing: boolean) => void;
  onSave: () => void;
  isSaving: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <Activity className="h-5 w-5 text-primary-400" />
          Treatment Plan
        </h3>
        {!isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-900 hover:bg-slate-200"
          >
            <Edit className="h-4 w-4" />
            Edit Treatment
          </button>
        )}
      </div>

      {isEditing ? (
        <div className="space-y-4">
          <textarea
            value={treatmentPlan}
            onChange={(e) => setTreatmentPlan(e.target.value)}
            placeholder="Enter treatment plan details..."
            className="h-48 w-full rounded-lg border border-slate-300 bg-white p-4 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          <div className="flex justify-end gap-3">
            <button
              onClick={() => {
                setTreatmentPlan(risk.treatment_plan || '');
                setIsEditing(false);
              }}
              className="rounded-lg bg-slate-100 px-4 py-2 text-slate-900 hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              disabled={isSaving}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save Treatment Plan
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg bg-white p-4">
          {risk.treatment_plan ? (
            <p className="whitespace-pre-wrap text-slate-700">{risk.treatment_plan}</p>
          ) : (
            <p className="text-slate-500 italic">No treatment plan defined. Click "Edit Treatment" to add one.</p>
          )}
        </div>
      )}
    </div>
  );
}

function ControlsTab({
  risk,
  onLinkControl,
  onLinkFrameworkControl,
  onUnlinkControl,
  onUnlinkFrameworkControl,
  isUnlinking,
}: {
  risk: RiskDetailData;
  onLinkControl: () => void;
  onLinkFrameworkControl: () => void;
  onUnlinkControl: (linkId: number) => void;
  onUnlinkFrameworkControl: (linkId: number) => void;
  isUnlinking: boolean;
}) {
  const getMitigationColor = (effectiveness?: string) => {
    const item = MITIGATION_EFFECTIVENESS.find(m => m.value === effectiveness);
    return item?.color || 'text-slate-600';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <Shield className="h-5 w-5 text-primary-400" />
          Linked Controls
        </h3>
        <div className="flex gap-2">
          <button
            onClick={onLinkControl}
            className="flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-900 hover:bg-slate-200"
          >
            <Plus className="h-4 w-4" />
            Link Normalized Control
          </button>
          <button
            onClick={onLinkFrameworkControl}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700"
          >
            <Plus className="h-4 w-4" />
            Link Framework Control
          </button>
        </div>
      </div>

      {risk.linked_controls && risk.linked_controls.length > 0 && (
        <div>
          <h4 className="mb-3 text-sm font-medium text-slate-600">Normalized Controls</h4>
          <div className="space-y-2">
            {risk.linked_controls.map((control) => (
              <div key={control.id} className="flex items-center justify-between rounded-lg bg-white p-3">
                <div className="flex items-center gap-3">
                  <Shield className="h-5 w-5 text-primary-400" />
                  <div>
                    <span className="text-sm font-medium text-primary-400">{control.code}</span>
                    <p className="text-slate-900">{control.name}</p>
                  </div>
                </div>
                <button
                  onClick={() => onUnlinkControl(control.id)}
                  disabled={isUnlinking}
                  className="rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {risk.linked_framework_controls && risk.linked_framework_controls.length > 0 && (
        <div>
          <h4 className="mb-3 text-sm font-medium text-slate-600">Framework Controls</h4>
          <div className="space-y-2">
            {risk.linked_framework_controls.map((control) => (
              <div key={control.id} className="flex items-center justify-between rounded-lg bg-white p-3">
                <div className="flex items-center gap-3">
                  <Shield className="h-5 w-5 text-blue-400" />
                  <div>
                    <span className="text-sm font-medium text-blue-400">{control.code}</span>
                    <p className="text-slate-900">{control.name}</p>
                    {control.mitigation_effectiveness && (
                      <span className={`text-xs ${getMitigationColor(control.mitigation_effectiveness)}`}>
                        Effectiveness: {control.mitigation_effectiveness}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => onUnlinkFrameworkControl(control.id)}
                  disabled={isUnlinking}
                  className="rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {(!risk.linked_controls || risk.linked_controls.length === 0) &&
       (!risk.linked_framework_controls || risk.linked_framework_controls.length === 0) && (
        <div className="rounded-lg bg-white p-8 text-center">
          <Shield className="mx-auto mb-3 h-12 w-12 text-slate-600" />
          <p className="text-slate-600">No controls linked to this risk</p>
          <p className="text-sm text-slate-500">Link controls to track mitigation measures</p>
        </div>
      )}
    </div>
  );
}

function AssetsTab({
  risk,
  onLinkAsset,
  onUnlinkAsset,
  isUnlinking,
}: {
  risk: RiskDetailData;
  onLinkAsset: () => void;
  onUnlinkAsset: (linkId: number) => void;
  isUnlinking: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <Building2 className="h-5 w-5 text-primary-400" />
          Linked IT Assets ({risk.linked_assets?.length || 0})
        </h3>
        <button
          onClick={onLinkAsset}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700"
        >
          <Plus className="h-4 w-4" />
          Link Asset
        </button>
      </div>

      {risk.linked_assets && risk.linked_assets.length > 0 ? (
        <div className="space-y-2">
          {risk.linked_assets.map((asset) => (
            <div key={asset.id} className="flex items-center justify-between rounded-lg bg-white p-3">
              <div className="flex items-center gap-3">
                <Building2 className="h-5 w-5 text-cyan-400" />
                <div>
                  <p className="text-slate-900">{asset.name}</p>
                  <span className="text-sm text-slate-600">{asset.asset_type}</span>
                </div>
              </div>
              <button
                onClick={() => onUnlinkAsset(asset.id)}
                disabled={isUnlinking}
                className="rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg bg-white p-8 text-center">
          <Building2 className="mx-auto mb-3 h-12 w-12 text-slate-600" />
          <p className="text-slate-600">No assets linked to this risk</p>
          <p className="text-sm text-slate-500">Link IT assets that are affected by this risk</p>
        </div>
      )}
    </div>
  );
}

function EvidenceTab({
  risk,
  onLinkEvidence,
  onUnlinkEvidence,
  isUnlinking,
}: {
  risk: RiskDetailData;
  onLinkEvidence: () => void;
  onUnlinkEvidence: (linkId: number) => void;
  isUnlinking: boolean;
}) {
  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'approved': return 'text-green-700 bg-green-100';
      case 'pending': return 'text-amber-700 bg-amber-100';
      case 'rejected': return 'text-red-700 bg-red-100';
      default: return 'text-slate-600 bg-slate-100';
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <FileText className="h-5 w-5 text-primary-400" />
          Linked Evidence ({risk.linked_evidence?.length || 0})
        </h3>
        <button
          onClick={onLinkEvidence}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700"
        >
          <Plus className="h-4 w-4" />
          Link Evidence
        </button>
      </div>

      {risk.linked_evidence && risk.linked_evidence.length > 0 ? (
        <div className="space-y-2">
          {risk.linked_evidence.map((evidence) => (
            <div key={evidence.id} className="flex items-center justify-between rounded-lg bg-white p-3">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 text-purple-400" />
                <div>
                  <p className="text-slate-900">{evidence.name}</p>
                  <span className={`rounded px-2 py-0.5 text-xs ${getStatusColor(evidence.status)}`}>
                    {evidence.status}
                  </span>
                </div>
              </div>
              <button
                onClick={() => onUnlinkEvidence(evidence.id)}
                disabled={isUnlinking}
                className="rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg bg-white p-8 text-center">
          <FileText className="mx-auto mb-3 h-12 w-12 text-slate-600" />
          <p className="text-slate-600">No evidence linked to this risk</p>
          <p className="text-sm text-slate-500">Link evidence items to support risk assessment</p>
        </div>
      )}
    </div>
  );
}

function GovernanceTab({
  risk,
  onLinkGovernance,
  onUnlinkGovernance,
  isUnlinking,
}: {
  risk: RiskDetailData;
  onLinkGovernance: () => void;
  onUnlinkGovernance: (linkId: number) => void;
  isUnlinking: boolean;
}) {
  const getImpactColor = (level?: string) => {
    const item = IMPACT_LEVELS.find(i => i.value === level);
    return item?.color || 'text-slate-600';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <Target className="h-5 w-5 text-primary-400" />
          Linked Governance Objectives ({risk.linked_governance?.length || 0})
        </h3>
        <button
          onClick={onLinkGovernance}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700"
        >
          <Plus className="h-4 w-4" />
          Link Objective
        </button>
      </div>

      {risk.linked_governance && risk.linked_governance.length > 0 ? (
        <div className="space-y-2">
          {risk.linked_governance.map((objective) => (
            <div key={objective.id} className="flex items-center justify-between rounded-lg bg-white p-3">
              <div className="flex items-center gap-3">
                <Target className="h-5 w-5 text-yellow-400" />
                <div>
                  <p className="text-slate-900">{objective.name}</p>
                  <span className={`text-sm ${getImpactColor(objective.impact_level)}`}>
                    Impact: {objective.impact_level}
                  </span>
                </div>
              </div>
              <button
                onClick={() => onUnlinkGovernance(objective.id)}
                disabled={isUnlinking}
                className="rounded-lg p-2 text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg bg-white p-8 text-center">
          <Target className="mx-auto mb-3 h-12 w-12 text-slate-600" />
          <p className="text-slate-600">No governance objectives linked to this risk</p>
          <p className="text-sm text-slate-500">Link governance objectives affected by this risk</p>
        </div>
      )}
    </div>
  );
}

function DeleteConfirmModal({
  riskTitle,
  onClose,
  onConfirm,
  isDeleting,
}: {
  riskTitle: string;
  onClose: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">Delete Risk</h3>
        <p className="mb-6 text-slate-700">
          Are you sure you want to delete <span className="font-medium text-slate-900">&quot;{riskTitle}&quot;</span>? 
          This action cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-100 px-4 py-2 text-slate-900 hover:bg-slate-200"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function LinkControlModal({
  onClose,
  onLink,
  isLinking,
  linkedControlIds,
  allControls,
}: {
  onClose: () => void;
  onLink: (controlId: number) => void;
  isLinking: boolean;
  linkedControlIds: number[];
  allControls: NormalizedControl[];
}) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredControls = allControls.filter(
    (control) =>
      !linkedControlIds.includes(Number(control.id)) &&
      (control.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        control.internal_id?.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <h3 className="text-lg font-semibold text-slate-900">Link Normalized Control</h3>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
            <input
              type="text"
              placeholder="Search controls..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-4 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none"
            />
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {filteredControls.length === 0 ? (
              <p className="py-4 text-center text-slate-600">No controls found</p>
            ) : (
              filteredControls.map((control) => (
                <button
                  key={control.id}
                  onClick={() => onLink(Number(control.id))}
                  disabled={isLinking}
                  className="flex w-full items-center justify-between rounded-lg bg-white p-3 text-left hover:bg-slate-100 disabled:opacity-50"
                >
                  <div>
                    <span className="text-sm font-medium text-primary-400">{control.internal_id}</span>
                    <p className="text-slate-900">{control.name}</p>
                  </div>
                  <Plus className="h-4 w-4 text-slate-600" />
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function LinkFrameworkControlModal({
  onClose,
  onLink,
  isLinking,
  linkedControlIds,
}: {
  onClose: () => void;
  onLink: (controlId: number, effectiveness: string, notes?: string) => void;
  isLinking: boolean;
  linkedControlIds: number[];
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedControlId, setSelectedControlId] = useState<number | null>(null);
  const [effectiveness, setEffectiveness] = useState('partial');
  const [notes, setNotes] = useState('');

  const { data: frameworkControls } = useQuery({
    queryKey: ['all-framework-controls'],
    queryFn: async () => {
      const response = await controlsApi.getAll();
      return response.data;
    },
  });

  const filteredControls = (frameworkControls || []).filter(
    (control) =>
      !linkedControlIds.includes(Number(control.id)) &&
      (control.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        control.reference_code?.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const handleLink = () => {
    if (selectedControlId) {
      onLink(selectedControlId, effectiveness, notes || undefined);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <h3 className="text-lg font-semibold text-slate-900">Link Framework Control</h3>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
            <input
              type="text"
              placeholder="Search framework controls..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-4 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none"
            />
          </div>
          
          <div className="mb-4 max-h-48 space-y-2 overflow-y-auto">
            {filteredControls.length === 0 ? (
              <p className="py-4 text-center text-slate-600">No controls found</p>
            ) : (
              filteredControls.map((control) => (
                <button
                  key={control.id}
                  onClick={() => setSelectedControlId(Number(control.id))}
                  className={`flex w-full items-center justify-between rounded-lg p-3 text-left ${
                    selectedControlId === Number(control.id)
                      ? 'bg-primary-600/30 border border-primary-500'
                      : 'bg-white hover:bg-slate-100'
                  }`}
                >
                  <div>
                    <span className="text-sm font-medium text-blue-400">{control.reference_code}</span>
                    <p className="text-slate-900">{control.name}</p>
                  </div>
                </button>
              ))
            )}
          </div>

          {selectedControlId && (
            <>
              <div className="mb-4">
                <label className="mb-2 block text-sm text-slate-600">Mitigation Effectiveness</label>
                <select
                  value={effectiveness}
                  onChange={(e) => setEffectiveness(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none"
                >
                  {MITIGATION_EFFECTIVENESS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mb-4">
                <label className="mb-2 block text-sm text-slate-600">Notes (optional)</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Add notes about this control..."
                  className="h-20 w-full rounded-lg border border-slate-300 bg-white p-3 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none"
                />
              </div>
            </>
          )}

          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              className="rounded-lg bg-slate-100 px-4 py-2 text-slate-900 hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              onClick={handleLink}
              disabled={!selectedControlId || isLinking}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {isLinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <LinkIcon className="h-4 w-4" />}
              Link Control
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LinkAssetModal({
  onClose,
  onLink,
  isLinking,
  linkedAssetIds,
  allAssets,
}: {
  onClose: () => void;
  onLink: (assetId: number) => void;
  isLinking: boolean;
  linkedAssetIds: number[];
  allAssets: ITAsset[];
}) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredAssets = allAssets.filter(
    (asset) =>
      !linkedAssetIds.includes(asset.id) &&
      (asset.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        asset.asset_type?.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <h3 className="text-lg font-semibold text-slate-900">Link IT Asset</h3>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
            <input
              type="text"
              placeholder="Search assets..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-4 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none"
            />
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {filteredAssets.length === 0 ? (
              <p className="py-4 text-center text-slate-600">No assets found</p>
            ) : (
              filteredAssets.map((asset) => (
                <button
                  key={asset.id}
                  onClick={() => onLink(asset.id)}
                  disabled={isLinking}
                  className="flex w-full items-center justify-between rounded-lg bg-white p-3 text-left hover:bg-slate-100 disabled:opacity-50"
                >
                  <div>
                    <p className="text-slate-900">{asset.name}</p>
                    <span className="text-sm text-slate-600">{asset.asset_type}</span>
                  </div>
                  <Plus className="h-4 w-4 text-slate-600" />
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function LinkEvidenceModal({
  onClose,
  onLink,
  isLinking,
  linkedEvidenceIds,
  allEvidence,
}: {
  onClose: () => void;
  onLink: (evidenceId: number) => void;
  isLinking: boolean;
  linkedEvidenceIds: number[];
  allEvidence: Evidence[];
}) {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredEvidence = allEvidence.filter(
    (evidence) =>
      !linkedEvidenceIds.includes(Number(evidence.id)) &&
      evidence.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <h3 className="text-lg font-semibold text-slate-900">Link Evidence</h3>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
            <input
              type="text"
              placeholder="Search evidence..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-4 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none"
            />
          </div>
          <div className="max-h-64 space-y-2 overflow-y-auto">
            {filteredEvidence.length === 0 ? (
              <p className="py-4 text-center text-slate-600">No evidence found</p>
            ) : (
              filteredEvidence.map((evidence) => (
                <button
                  key={evidence.id}
                  onClick={() => onLink(Number(evidence.id))}
                  disabled={isLinking}
                  className="flex w-full items-center justify-between rounded-lg bg-white p-3 text-left hover:bg-slate-100 disabled:opacity-50"
                >
                  <div>
                    <p className="text-slate-900">{evidence.title}</p>
                    <span className="text-sm text-slate-600">{evidence.evidence_type}</span>
                  </div>
                  <Plus className="h-4 w-4 text-slate-600" />
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function LinkGovernanceModal({
  onClose,
  onLink,
  isLinking,
  linkedGovernanceIds,
  allGovernance,
}: {
  onClose: () => void;
  onLink: (objectiveId: number, impactLevel: string) => void;
  isLinking: boolean;
  linkedGovernanceIds: number[];
  allGovernance: GovernanceObjective[];
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedObjectiveId, setSelectedObjectiveId] = useState<number | null>(null);
  const [impactLevel, setImpactLevel] = useState('medium');

  const filteredGovernance = allGovernance.filter(
    (objective) =>
      !linkedGovernanceIds.includes(Number(objective.id)) &&
      objective.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleLink = () => {
    if (selectedObjectiveId) {
      onLink(selectedObjectiveId, impactLevel);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <h3 className="text-lg font-semibold text-slate-900">Link Governance Objective</h3>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4">
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
            <input
              type="text"
              placeholder="Search governance objectives..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-4 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none"
            />
          </div>
          
          <div className="mb-4 max-h-48 space-y-2 overflow-y-auto">
            {filteredGovernance.length === 0 ? (
              <p className="py-4 text-center text-slate-600">No governance objectives found</p>
            ) : (
              filteredGovernance.map((objective) => (
                <button
                  key={objective.id}
                  onClick={() => setSelectedObjectiveId(Number(objective.id))}
                  className={`flex w-full items-center justify-between rounded-lg p-3 text-left ${
                    selectedObjectiveId === Number(objective.id)
                      ? 'bg-primary-600/30 border border-primary-500'
                      : 'bg-white hover:bg-slate-100'
                  }`}
                >
                  <div>
                    <p className="text-slate-900">{objective.title}</p>
                    <span className="text-sm text-slate-600">{objective.category}</span>
                  </div>
                </button>
              ))
            )}
          </div>

          {selectedObjectiveId && (
            <div className="mb-4">
              <label className="mb-2 block text-sm text-slate-600">Impact Level</label>
              <select
                value={impactLevel}
                onChange={(e) => setImpactLevel(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-primary-500 focus:outline-none"
              >
                {IMPACT_LEVELS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              className="rounded-lg bg-slate-100 px-4 py-2 text-slate-900 hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              onClick={handleLink}
              disabled={!selectedObjectiveId || isLinking}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {isLinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <LinkIcon className="h-4 w-4" />}
              Link Objective
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
