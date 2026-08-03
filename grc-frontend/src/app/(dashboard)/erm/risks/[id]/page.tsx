'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { risksApi, controlsApi, assetsApi, evidenceApi, governanceApi, ermApi } from '@/lib/api';
import { RiskCategory, RiskStatus, NormalizedControl, ITAsset, Evidence, GovernanceObjective } from '@/types';
import { usePermissions } from '@/hooks/usePermissions';
import {
  ArrowLeft, Loader2, AlertCircle, AlertTriangle, Shield,
  Target, Calendar, User, FileText,
  Trash2, Edit, Save, Building2, ClipboardCheck,
  Activity, BarChart3, ExternalLink,
} from 'lucide-react';
import Link from 'next/link';
import clsx from 'clsx';
import InlineLinkPicker from '@/components/ui/InlineLinkPicker';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';
import { PageLoader } from '@/components/ui';
import { CreateIssueButton } from '@/components/issue-management/CreateIssueButton';
import { RelatedIssuesPanel } from '@/components/issue-management/RelatedIssuesPanel';
import type { ReactNode } from 'react';

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
  register_type?: string | null;
  template_fields?: Record<string, unknown> | null;
}

const RISK_CATEGORIES: Record<string, { label: string; color: string }> = {
  strategic: { label: 'Strategic', color: 'bg-primary-50 text-primary-700 border-primary-200' },
  operational: { label: 'Operational', color: 'bg-primary-50 text-primary-700 border-primary-200' },
  financial: { label: 'Financial', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  compliance: { label: 'Compliance', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  technology: { label: 'Technology', color: 'bg-primary-50 text-primary-700 border-primary-200' },
  third_party: { label: 'Third-Party', color: 'bg-orange-50 text-orange-700 border-orange-200' },
};

const RISK_STATUSES: Record<string, { label: string; color: string }> = {
  open: { label: 'Open', color: 'bg-rose-50 text-rose-700 border-rose-200' },
  in_treatment: { label: 'In Treatment', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  mitigating: { label: 'Mitigating', color: 'bg-amber-50 text-amber-700 border-amber-200' },
  mitigated: { label: 'Mitigated', color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  accepted: { label: 'Accepted', color: 'bg-primary-50 text-primary-700 border-primary-200' },
  closed: { label: 'Closed', color: 'bg-slate-100 text-slate-700 border-slate-200' },
};

const MITIGATION_EFFECTIVENESS = [
  { value: 'full', label: 'Full', color: 'text-emerald-700' },
  { value: 'partial', label: 'Partial', color: 'text-amber-700' },
  { value: 'minimal', label: 'Minimal', color: 'text-orange-700' },
  { value: 'none', label: 'None', color: 'text-rose-700' },
];

const IMPACT_LEVELS = [
  { value: 'high', label: 'High', color: 'text-rose-700' },
  { value: 'medium', label: 'Medium', color: 'text-amber-700' },
  { value: 'low', label: 'Low', color: 'text-emerald-700' },
];

type TabType = 'details' | 'treatment' | 'controls' | 'assets' | 'evidence' | 'governance';

export default function RiskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const riskId = Number(params.id);
  const queryClient = useQueryClient();
  
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('risks:risk_register:edit');
  const canDelete = hasPermission('risks:risk_register:delete');

  const [activeTab, setActiveTab] = useState<TabType>('details');
  const [isEditingTreatment, setIsEditingTreatment] = useState(false);
  const [treatmentPlan, setTreatmentPlan] = useState('');

  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showLinkFrameworkControlModal, setShowLinkFrameworkControlModal] = useState(false);
  const [showLinkGovernanceModal, setShowLinkGovernanceModal] = useState(false);
  const [sessionLinkedInternalIds, setSessionLinkedInternalIds] = useState<number[]>([]);

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
    enabled: activeTab === 'controls',
  });

  const { data: allInternalControls } = useQuery({
    queryKey: ['all-internal-controls-for-risk-link'],
    queryFn: async () => {
      const response = await ermApi.internalControls.getAll();
      const data: any = response.data;
      return Array.isArray(data) ? data : (data?.items || []);
    },
    enabled: activeTab === 'controls',
  });

  const { data: allFrameworkControls } = useQuery({
    queryKey: ['all-framework-controls'],
    queryFn: async () => {
      const response = await controlsApi.getAll();
      return response.data;
    },
    enabled: activeTab === 'controls' || showLinkFrameworkControlModal,
  });

  const { data: allAssets } = useQuery({
    queryKey: ['all-assets'],
    queryFn: async () => {
      const response = await assetsApi.getAll();
      return response.data;
    },
    enabled: activeTab === 'assets',
  });

  const { data: allEvidence } = useQuery({
    queryKey: ['all-evidence'],
    queryFn: async () => {
      const response = await evidenceApi.getAll();
      return response.data;
    },
    enabled: activeTab === 'evidence',
  });

  const { data: allGovernance } = useQuery({
    queryKey: ['all-governance-objectives'],
    queryFn: async () => {
      const response = await governanceApi.getObjectives();
      return response.data;
    },
    enabled: activeTab === 'governance' || showLinkGovernanceModal,
  });

  const { data: allDocuments } = useQuery({
    queryKey: ['all-governance-documents-for-risk-link'],
    queryFn: async () => {
      const response = await governanceApi.getDocuments({ limit: 500 });
      const data: any = response.data;
      return Array.isArray(data) ? data : (data?.items || []);
    },
    enabled: activeTab === 'governance',
  });

  const { data: linkedDocuments, refetch: refetchLinkedDocuments } = useQuery({
    queryKey: ['risk-linked-documents', riskId],
    queryFn: async () => {
      const response = await governanceApi.getDocumentsByRisk(riskId);
      const data: any = response.data;
      return data?.documents || [];
    },
    enabled: !!riskId,
  });

  const deleteMutation = useMutation({
    mutationFn: () => risksApi.delete(riskId),
    onSuccess: () => {
      router.push('/erm/risks');
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
    },
  });

  const linkInternalControlMutation = useMutation({
    mutationFn: (controlId: number) => ermApi.internalControls.linkRisk(controlId, { risk_id: riskId }),
    onSuccess: (_data, controlId) => {
      setSessionLinkedInternalIds((prev) => (prev.includes(controlId) ? prev : [...prev, controlId]));
      queryClient.invalidateQueries({ queryKey: ['risk-detail', riskId] });
      queryClient.invalidateQueries({ queryKey: ['all-internal-controls-for-risk-link'] });
    },
  });

  const unlinkSessionInternalControl = (controlId: number) => {
    setSessionLinkedInternalIds((prev) => prev.filter((id) => id !== controlId));
  };

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

  const linkDocumentToRiskMutation = useMutation({
    mutationFn: (documentId: number) =>
      governanceApi.linkDocumentToRisk({ document_id: documentId, risk_id: riskId, link_type: 'mitigates' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['risk-linked-documents', riskId] });
      refetchLinkedDocuments();
    },
  });

  const unlinkDocumentFromRiskMutation = useMutation({
    mutationFn: (linkId: number) => governanceApi.unlinkDocumentFromRisk(linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['risk-linked-documents', riskId] });
      refetchLinkedDocuments();
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
    if (score >= 20) return 'text-rose-700';
    if (score >= 12) return 'text-orange-700';
    if (score >= 6) return 'text-amber-700';
    return 'text-emerald-700';
  };

  const getScoreBgColor = (score: number | null | undefined) => {
    if (!score) return 'bg-slate-100';
    if (score >= 20) return 'bg-rose-500';
    if (score >= 12) return 'bg-orange-500';
    if (score >= 6) return 'bg-amber-500';
    return 'bg-emerald-500';
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
      return { label: 'Completed', color: 'text-emerald-700' };
    }
    if (risk.treatment_plan) {
      return { label: 'In Progress', color: 'text-amber-700' };
    }
    return { label: 'Not Started', color: 'text-rose-700' };
  };

  if (isLoading) {
    return (
      <PageLoader className="h-64" />
    );
  }

  if (error || !risk) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-rose-600">
        <AlertCircle className="mb-2 h-8 w-8" />
        <p>Failed to load risk details</p>
        <Link href="/erm/risks" className="mt-4 text-primary-600 hover:underline">
          Back to Risks
        </Link>
      </div>
    );
  }

  const tabs: { id: TabType; label: string; icon: React.ElementType; count?: number }[] = [
    { id: 'details', label: 'Overview', icon: ClipboardCheck },
    { id: 'treatment', label: 'Treatment', icon: Activity },
    { id: 'controls', label: 'Controls', icon: Shield, count: (risk.linked_controls?.length || 0) + (risk.linked_framework_controls?.length || 0) },
    { id: 'assets', label: 'Assets', icon: Building2, count: risk.linked_assets?.length || 0 },
    { id: 'evidence', label: 'Evidence', icon: FileText, count: risk.linked_evidence?.length || 0 },
    { id: 'governance', label: 'Documents', icon: Target, count: (risk.linked_governance?.length || 0) + (linkedDocuments?.length || 0) },
  ];

  const riskReduction = calculateRiskReduction();
  const treatmentStatus = getTreatmentStatus();
  const categoryStyle = getCategoryStyle(risk.risk_category || risk.category);
  const statusStyle = getStatusStyle(risk.status);

  return (
    <div className="risk-workspace -m-4 space-y-4 lg:-m-5">
      {/* Header */}
      <div className="border-b border-slate-200 px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Link
              href="/erm/risks"
              className="mt-0.5 rounded-md p-1.5 text-slate-600 hover:bg-slate-50 hover:text-slate-800"
              title="Back to risk register"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
            </Link>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
              <AlertTriangle className="h-5 w-5" strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  RISK-{risk.id}
                </span>
                {risk.register_type && (
                  <span className="text-[10px] text-slate-500">· {String(risk.register_type).replace(/_/g, ' ')}</span>
                )}
              </div>
              <h1 className="text-lg font-semibold leading-snug text-slate-800">{risk.title}</h1>
              {risk.description && (
                <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{risk.description}</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${categoryStyle.color}`}>
              {categoryStyle.label}
            </span>
            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${statusStyle.color}`}>
              {statusStyle.label}
            </span>
            <CreateIssueButton
              sourceType="risk"
              sourceId={risk.id}
              presetFields={{
                title: `RISK-${risk.id} — ${risk.title}`,
                description: risk.description || undefined,
                category: 'operations',
                issue_type: 'audit_finding',
              }}
            />
          </div>
        </div>
      </div>

      {/* D1 split */}
      <div className="mx-4 grid grid-cols-1 gap-4 pb-4 sm:mx-6 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <div className="space-y-3 lg:sticky lg:top-4">
            <RiskContextRail
              risk={risk}
              categoryStyle={categoryStyle}
              statusStyle={statusStyle}
              treatmentStatus={treatmentStatus}
              riskReduction={riskReduction}
              getScoreColor={getScoreColor}
              getScoreBgColor={getScoreBgColor}
              formatDate={formatDate}
              canEdit={canEdit}
              canDelete={canDelete}
              onEdit={() => router.push(`/erm/risks/list?edit=${risk.id}`)}
              onTreatment={() => { setActiveTab('treatment'); setIsEditingTreatment(true); }}
              onDelete={() => setShowDeleteConfirm(true)}
              controlCount={(risk.linked_controls?.length || 0) + (risk.linked_framework_controls?.length || 0)}
              assetCount={risk.linked_assets?.length || 0}
              evidenceCount={risk.linked_evidence?.length || 0}
            />
          </div>
        </div>

        <div className="min-w-0 space-y-4 lg:col-span-7">
          <RelatedIssuesPanel
            sourceType="risk"
            sourceId={risk.id}
            title="Issues"
            createFields={{
              title: `RISK-${risk.id} — ${risk.title}`,
              description: risk.description || undefined,
              category: 'operations',
              issue_type: 'audit_finding',
            }}
          />

          <div className="cw-card rounded-xl p-2">
            <nav className="flex flex-wrap gap-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                const on = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={clsx(
                      'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                      on ? 'bg-primary-50 text-primary-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                    {tab.label}
                    {tab.count != null && tab.count > 0 && (
                      <span className={clsx('rounded-full px-1.5 py-0.5 text-[10px] font-semibold', on ? 'bg-primary-100 text-primary-800' : 'bg-slate-100 text-slate-500')}>
                        {tab.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="cw-card rounded-xl p-4">
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
                allControls={allControls || []}
                allInternalControls={allInternalControls || []}
                sessionLinkedInternalIds={sessionLinkedInternalIds}
                onLinkControl={(controlId) => linkControlMutation.mutate({ normalized_control_id: controlId })}
                onLinkInternalControl={(controlId) => linkInternalControlMutation.mutate(controlId)}
                onLinkFrameworkControl={() => setShowLinkFrameworkControlModal(true)}
                onUnlinkControl={(linkId) => unlinkControlMutation.mutate(linkId)}
                onUnlinkFrameworkControl={(linkId) => unlinkFrameworkControlMutation.mutate(linkId)}
                onUnlinkSessionInternalControl={unlinkSessionInternalControl}
                isUnlinking={unlinkControlMutation.isPending || unlinkFrameworkControlMutation.isPending}
                canEdit={canEdit}
                canDelete={canDelete}
              />
            )}
            {activeTab === 'assets' && (
              <AssetsTab
                risk={risk}
                allAssets={allAssets || []}
                onLinkAsset={(assetId) => linkAssetMutation.mutate({ asset_id: assetId })}
                onUnlinkAsset={(linkId) => unlinkAssetMutation.mutate(linkId)}
                isUnlinking={unlinkAssetMutation.isPending}
                canEdit={canEdit}
                canDelete={canDelete}
              />
            )}
            {activeTab === 'evidence' && (
              <EvidenceTab
                risk={risk}
                allEvidence={allEvidence || []}
                onLinkEvidence={(evidenceId) => linkEvidenceMutation.mutate({ evidence_id: evidenceId })}
                onUnlinkEvidence={(linkId) => unlinkEvidenceMutation.mutate(linkId)}
                isUnlinking={unlinkEvidenceMutation.isPending}
                canEdit={canEdit}
                canDelete={canDelete}
              />
            )}
            {activeTab === 'governance' && (
              <GovernanceTab
                risk={risk}
                allGovernance={allGovernance || []}
                allDocuments={allDocuments || []}
                linkedDocuments={linkedDocuments || []}
                onLinkGovernance={(objectiveId) => linkGovernanceMutation.mutate({ governance_objective_id: objectiveId, impact_level: 'medium' })}
                onLinkDocument={(docId) => linkDocumentToRiskMutation.mutate(docId)}
                onUnlinkGovernance={(linkId) => unlinkGovernanceMutation.mutate(linkId)}
                onUnlinkDocument={(linkId) => unlinkDocumentFromRiskMutation.mutate(linkId)}
                isUnlinking={unlinkGovernanceMutation.isPending || unlinkDocumentFromRiskMutation.isPending}
                canEdit={canEdit}
                canDelete={canDelete}
              />
            )}
          </div>
        </div>
      </div>

      {showDeleteConfirm && (
        <DeleteConfirmModal
          riskTitle={risk.title}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={() => deleteMutation.mutate()}
          isDeleting={deleteMutation.isPending}
        />
      )}

      <LinkFrameworkControlModal
        isOpen={showLinkFrameworkControlModal}
        onClose={() => setShowLinkFrameworkControlModal(false)}
        onLink={(controlId, effectiveness, notes) => {
          linkFrameworkControlMutation.mutate({
            framework_control_id: controlId,
            mitigation_effectiveness: effectiveness,
            notes,
          });
        }}
        isLinking={linkFrameworkControlMutation.isPending}
        linkedControlIds={risk.linked_framework_controls?.map(c => c.framework_control_id) || []}
        allFrameworkControls={allFrameworkControls || []}
      />

      <LinkGovernanceModal
        isOpen={showLinkGovernanceModal}
        onClose={() => setShowLinkGovernanceModal(false)}
        onLink={(objectiveId, impactLevel) =>
          linkGovernanceMutation.mutate({ governance_objective_id: objectiveId, impact_level: impactLevel })
        }
        isLinking={linkGovernanceMutation.isPending}
        linkedGovernanceIds={risk.linked_governance?.map(g => g.governance_objective_id) || []}
        allGovernance={allGovernance || []}
      />
    </div>
  );
}

function RailStatRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-right text-sm font-medium text-slate-800">{children}</span>
    </div>
  );
}

function LinkEntityRow({
  href, icon: Icon, title, subtitle, badge, onUnlink, canDelete, isUnlinking,
}: {
  href?: string;
  icon: React.ElementType;
  title: string;
  subtitle?: ReactNode;
  badge?: ReactNode;
  onUnlink?: () => void;
  canDelete?: boolean;
  isUnlinking?: boolean;
}) {
  const body = (
    <div className="flex min-w-0 flex-1 items-center gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-500">
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium text-slate-900">{title}</p>
          {badge}
        </div>
        {subtitle && <div className="mt-0.5 text-xs text-slate-500">{subtitle}</div>}
      </div>
    </div>
  );

  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/60 p-3 hover:bg-slate-50">
      {href ? (
        <Link href={href} className="group flex min-w-0 flex-1 items-center gap-2 hover:opacity-90">
          {body}
          <ExternalLink className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-primary-600" strokeWidth={1.75} />
        </Link>
      ) : body}
      {canDelete && onUnlink && (
        <button
          type="button"
          onClick={onUnlink}
          disabled={isUnlinking}
          className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
          title="Unlink"
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      )}
    </div>
  );
}

function EmptyLinkState({ icon: Icon, title, hint }: { icon: React.ElementType; title: string; hint: string }) {
  return (
    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-4 py-10 text-center">
      <Icon className="mx-auto mb-2 h-8 w-8 text-slate-300" strokeWidth={1.5} />
      <p className="text-sm font-medium text-slate-600">{title}</p>
      <p className="mt-1 text-xs text-slate-400">{hint}</p>
    </div>
  );
}

function RiskContextRail({
  risk, categoryStyle, statusStyle, treatmentStatus, riskReduction,
  getScoreColor, getScoreBgColor, formatDate,
  canEdit, canDelete, onEdit, onTreatment, onDelete,
  controlCount, assetCount, evidenceCount,
}: {
  risk: RiskDetailData;
  categoryStyle: { label: string; color: string };
  statusStyle: { label: string; color: string };
  treatmentStatus: { label: string; color: string };
  riskReduction: number | null;
  getScoreColor: (s?: number | null) => string;
  getScoreBgColor: (s?: number | null) => string;
  formatDate: (d?: string) => string;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onTreatment: () => void;
  onDelete: () => void;
  controlCount: number;
  assetCount: number;
  evidenceCount: number;
}) {
  return (
    <>
      <div className="cw-card flex flex-wrap items-center gap-2 rounded-xl p-3">
        {canEdit && (
          <button type="button" onClick={onEdit} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
            <Edit className="h-3.5 w-3.5" strokeWidth={1.75} /> Edit
          </button>
        )}
        {canEdit && (
          <button type="button" onClick={onTreatment} className="inline-flex items-center gap-1.5 rounded-md bg-primary-500 px-2.5 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-600">
            <Activity className="h-3.5 w-3.5" strokeWidth={1.75} /> Treatment
          </button>
        )}
        <CreateIssueButton
          sourceType="risk"
          sourceId={risk.id}
          presetFields={{
            title: `RISK-${risk.id} — ${risk.title}`,
            description: risk.description || undefined,
            category: 'operations',
            issue_type: 'audit_finding',
          }}
        />
        {canDelete && (
          <button type="button" onClick={onDelete} className="inline-flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-100">
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} /> Delete
          </button>
        )}
      </div>

      <div className="cw-card rounded-xl p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
            <AlertTriangle className="h-5 w-5" strokeWidth={1.75} />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-800">{risk.title}</h2>
            <p className="text-xs text-slate-500">{categoryStyle.label} risk</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${categoryStyle.color}`}>{categoryStyle.label}</span>
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusStyle.color}`}>{statusStyle.label}</span>
          <span className={`inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium ${treatmentStatus.color}`}>
            {treatmentStatus.label}
          </span>
        </div>
      </div>

      <div className="cw-card rounded-xl p-4">
        <div className="mb-3 flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <BarChart3 className="h-3.5 w-3.5" strokeWidth={1.75} /> Risk scores
        </div>
        <div className="space-y-3">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-slate-500">Inherent</span>
              <span className={`text-sm font-bold tabular-nums ${getScoreColor(risk.inherent_score)}`}>
                {risk.inherent_score ?? '—'}<span className="font-normal text-slate-400"> / 25</span>
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-100">
              <div className={`h-1.5 rounded-full transition-all ${getScoreBgColor(risk.inherent_score)}`} style={{ width: `${Math.min(100, ((risk.inherent_score || 0) / 25) * 100)}%` }} />
            </div>
            <p className="mt-1 text-[11px] text-slate-400">L {risk.inherent_likelihood ?? '—'} × I {risk.inherent_impact ?? '—'}</p>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs text-slate-500">Residual</span>
              <span className={`text-sm font-bold tabular-nums ${getScoreColor(risk.residual_score)}`}>
                {risk.residual_score ?? '—'}<span className="font-normal text-slate-400"> / 25</span>
              </span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-slate-100">
              <div className={`h-1.5 rounded-full transition-all ${getScoreBgColor(risk.residual_score)}`} style={{ width: `${Math.min(100, ((risk.residual_score || 0) / 25) * 100)}%` }} />
            </div>
            <p className="mt-1 text-[11px] text-slate-400">L {risk.residual_likelihood ?? '—'} × I {risk.residual_impact ?? '—'}</p>
          </div>
          {riskReduction != null && (
            <div className="flex items-center justify-between rounded-lg border border-emerald-100 bg-emerald-50/60 px-2.5 py-1.5">
              <span className="text-xs text-emerald-800">Risk reduction</span>
              <span className="text-sm font-bold text-emerald-700">{riskReduction}%</span>
            </div>
          )}
        </div>
      </div>

      <div className="cw-card rounded-xl p-4">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <User className="h-3.5 w-3.5" strokeWidth={1.75} /> Ownership &amp; coverage
        </div>
        <div className="divide-y divide-slate-100">
          <RailStatRow label="Owner">{risk.owner_name || <span className="font-normal text-slate-400">Unassigned</span>}</RailStatRow>
          <RailStatRow label="Appetite">{risk.risk_appetite || <span className="font-normal text-slate-400">Not set</span>}</RailStatRow>
          <RailStatRow label="Controls"><span className="tabular-nums">{controlCount}</span></RailStatRow>
          <RailStatRow label="Assets"><span className="tabular-nums">{assetCount}</span></RailStatRow>
          <RailStatRow label="Evidence"><span className="tabular-nums">{evidenceCount}</span></RailStatRow>
        </div>
      </div>

      <div className="cw-card rounded-xl p-4">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <Calendar className="h-3.5 w-3.5" strokeWidth={1.75} /> Timeline
        </div>
        <div className="divide-y divide-slate-100">
          <RailStatRow label="Due">{formatDate(risk.due_date)}</RailStatRow>
          <RailStatRow label="Review">{formatDate(risk.review_date)}</RailStatRow>
          <RailStatRow label="Created">{formatDate(risk.created_at)}</RailStatRow>
          <RailStatRow label="Updated">{formatDate(risk.updated_at)}</RailStatRow>
        </div>
      </div>
    </>
  );
}

function DetailsTab({ risk, formatDate }: { risk: RiskDetailData; formatDate: (d?: string) => string }) {
  const isNca = (risk.register_type || '').toLowerCase().includes('nca');
  const ncaFields = risk.template_fields && typeof risk.template_fields === 'object'
    ? Object.entries(risk.template_fields).filter(([, v]) => v !== null && v !== '' && v !== undefined)
    : [];
  return (
    <div className="space-y-4">
      {isNca && ncaFields.length > 0 && (
        <div className="rounded-xl border border-primary-200 bg-primary-50/40 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
            <ClipboardCheck className="h-4 w-4 text-primary-600" strokeWidth={1.75} />
            NCA template fields
          </h3>
          <div className="grid grid-cols-1 gap-3 text-xs md:grid-cols-2">
            {ncaFields.map(([k, v]) => (
              <div key={k} className="rounded-lg border border-white/60 bg-white/70 p-2.5">
                <p className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{k.replace(/_/g, ' ')}</p>
                <p className="whitespace-pre-wrap break-words text-sm text-slate-800">{String(v)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <ClipboardCheck className="h-4 w-4 text-slate-400" strokeWidth={1.75} />
          Description
        </h3>
        <p className="text-sm leading-relaxed text-slate-700">{risk.description || <span className="italic text-slate-400">No description provided</span>}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
          <h3 className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-500">
            <Target className="h-3.5 w-3.5" strokeWidth={1.75} /> Risk appetite
          </h3>
          <p className="text-sm text-slate-800">{risk.risk_appetite || <span className="text-slate-400">Not defined</span>}</p>
        </div>
        <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-3">
          <h3 className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-500">
            <Calendar className="h-3.5 w-3.5" strokeWidth={1.75} /> Key dates
          </h3>
          <dl className="space-y-1.5 text-xs">
            <div className="flex justify-between gap-2"><dt className="text-slate-500">Due</dt><dd className="font-medium text-slate-800">{formatDate(risk.due_date)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-500">Review</dt><dd className="font-medium text-slate-800">{formatDate(risk.review_date)}</dd></div>
            <div className="flex justify-between gap-2"><dt className="text-slate-500">Updated</dt><dd className="font-medium text-slate-800">{formatDate(risk.updated_at)}</dd></div>
          </dl>
        </div>
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Activity className="h-4 w-4 text-slate-400" strokeWidth={1.75} />
          Treatment plan
        </h3>
        {!isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            <Edit className="h-3.5 w-3.5" strokeWidth={1.75} />
            Edit
          </button>
        )}
      </div>

      {isEditing ? (
        <div className="space-y-3">
          <textarea
            value={treatmentPlan}
            onChange={(e) => setTreatmentPlan(e.target.value)}
            placeholder="Enter treatment plan details…"
            className="h-48 w-full rounded-lg border border-slate-200 bg-white p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => {
                setTreatmentPlan(risk.treatment_plan || '');
                setIsEditing(false);
              }}
              className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary-500 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-600 disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" strokeWidth={1.75} />}
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-slate-100 bg-slate-50/50 p-4">
          {risk.treatment_plan ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{risk.treatment_plan}</p>
          ) : (
            <p className="text-sm italic text-slate-400">No treatment plan yet. Click Edit to add one.</p>
          )}
        </div>
      )}
    </div>
  );
}

function ControlsTab({
  risk,
  allControls,
  allInternalControls,
  sessionLinkedInternalIds,
  onLinkControl,
  onLinkInternalControl,
  onLinkFrameworkControl,
  onUnlinkControl,
  onUnlinkFrameworkControl,
  onUnlinkSessionInternalControl,
  isUnlinking,
  canEdit,
  canDelete,
}: {
  risk: RiskDetailData;
  allControls: NormalizedControl[];
  allInternalControls: any[];
  sessionLinkedInternalIds: number[];
  onLinkControl: (controlId: number) => void;
  onLinkInternalControl: (controlId: number) => void;
  onLinkFrameworkControl: () => void;
  onUnlinkControl: (linkId: number) => void;
  onUnlinkFrameworkControl: (linkId: number) => void;
  onUnlinkSessionInternalControl: (controlId: number) => void;
  isUnlinking: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const getMitigationColor = (effectiveness?: string) => {
    const item = MITIGATION_EFFECTIVENESS.find(m => m.value === effectiveness);
    return item?.color || 'text-slate-600';
  };

  const linkedControlIds = risk.linked_controls?.map(c => c.control_id) || [];
  const normalizedItems = allControls
    .filter(c => !linkedControlIds.includes(Number(c.id)))
    .map(c => ({
      value: `n-${c.id}`,
      label: c.name || `Control ${c.internal_id || c.id}`,
      subLabel: c.internal_id ? `Normalized • ${c.internal_id}` : 'Normalized',
    }));
  const internalItems = (allInternalControls || [])
    .filter((c: any) => !sessionLinkedInternalIds.includes(Number(c.id)))
    .map((c: any) => ({
      value: `i-${c.id}`,
      label: c.name || c.title || `Control #${c.id}`,
      subLabel: c.control_id ? `Internal • ${c.control_id}` : 'Internal',
    }));
  const combinedControlItems = [...internalItems, ...normalizedItems];

  const sessionLinkedInternalControls = (allInternalControls || []).filter((c: any) =>
    sessionLinkedInternalIds.includes(Number(c.id))
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Shield className="h-4 w-4 text-primary-400" />
          Internal Controls
        </h3>
        <div className="flex gap-2 flex-wrap">
          {canEdit && (
            <InlineLinkPicker
              triggerLabel="Link Internal Control"
              triggerClassName="flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-1.5 text-sm text-white hover:bg-primary-700"
              items={combinedControlItems}
              onSelect={(value) => {
                if (value.startsWith('i-')) {
                  onLinkInternalControl(Number(value.slice(2)));
                } else if (value.startsWith('n-')) {
                  onLinkControl(Number(value.slice(2)));
                }
              }}
              searchPlaceholder="Search internal controls..."
              emptyText="No controls available"
            />
          )}
        </div>
      </div>

      {((risk.linked_controls && risk.linked_controls.length > 0) || sessionLinkedInternalControls.length > 0) && (
        <div>
          <h4 className="mb-2 text-xs font-medium text-slate-600">Internal Controls</h4>
          <div className="space-y-2">
            {sessionLinkedInternalControls.map((control: any) => (
              <LinkEntityRow
                key={`session-i-${control.id}`}
                href={`/erm/internal-controls/${control.id}`}
                icon={Shield}
                title={control.name || control.title || `Control #${control.id}`}
                subtitle={control.control_id || `IC-${control.id}`}
                onUnlink={() => onUnlinkSessionInternalControl(Number(control.id))}
                canDelete={canDelete}
                isUnlinking={isUnlinking}
              />
            ))}
            {(risk.linked_controls || []).map((control) => (
              <LinkEntityRow
                key={control.id}
                href={`/control-library/${control.control_id}`}
                icon={Shield}
                title={control.name}
                subtitle={control.code}
                onUnlink={() => onUnlinkControl(control.id)}
                canDelete={canDelete}
                isUnlinking={isUnlinking}
              />
            ))}
          </div>
        </div>
      )}

      {risk.linked_framework_controls && risk.linked_framework_controls.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-medium text-slate-600">Framework Controls</h4>
          <div className="space-y-2">
            {risk.linked_framework_controls.map((control) => (
              <LinkEntityRow
                key={control.id}
                icon={Shield}
                title={control.name}
                subtitle={
                  <>
                    <span>{control.code}</span>
                    {control.mitigation_effectiveness && (
                      <span className={`ml-2 ${getMitigationColor(control.mitigation_effectiveness)}`}>
                        · {control.mitigation_effectiveness}
                      </span>
                    )}
                  </>
                }
                onUnlink={() => onUnlinkFrameworkControl(control.id)}
                canDelete={canDelete}
                isUnlinking={isUnlinking}
              />
            ))}
          </div>
        </div>
      )}

      {(!risk.linked_controls || risk.linked_controls.length === 0) &&
       (!risk.linked_framework_controls || risk.linked_framework_controls.length === 0) &&
       sessionLinkedInternalControls.length === 0 && (
        <EmptyLinkState icon={Shield} title="No controls linked" hint="Link controls to track mitigation measures" />
      )}
    </div>
  );
}

function AssetsTab({
  risk,
  allAssets,
  onLinkAsset,
  onUnlinkAsset,
  isUnlinking,
  canEdit,
  canDelete,
}: {
  risk: RiskDetailData;
  allAssets: ITAsset[];
  onLinkAsset: (assetId: number) => void;
  onUnlinkAsset: (linkId: number) => void;
  isUnlinking: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const linkedAssetIds = risk.linked_assets?.map(a => a.asset_id) || [];
  const availableAssets = allAssets
    .filter(a => !linkedAssetIds.includes(a.id))
    .map(a => ({
      value: String(a.id),
      label: a.name,
      subLabel: a.asset_type || undefined,
    }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Building2 className="h-4 w-4 text-primary-400" />
          Linked IT Assets ({risk.linked_assets?.length || 0})
        </h3>
        {canEdit && (
          <InlineLinkPicker
            triggerLabel="Link Asset"
            items={availableAssets}
            onSelect={(value) => onLinkAsset(Number(value))}
            searchPlaceholder="Search assets..."
            emptyText="No assets available"
          />
        )}
      </div>

      {risk.linked_assets && risk.linked_assets.length > 0 ? (
        <div className="space-y-2">
          {risk.linked_assets.map((asset) => (
            <LinkEntityRow
              key={asset.id}
              href={`/assets/${asset.asset_id}`}
              icon={Building2}
              title={asset.name}
              subtitle={asset.asset_type}
              onUnlink={() => onUnlinkAsset(asset.id)}
              canDelete={canDelete}
              isUnlinking={isUnlinking}
            />
          ))}
        </div>
      ) : (
        <EmptyLinkState icon={Building2} title="No assets linked" hint="Link IT assets affected by this risk" />
      )}
    </div>
  );
}

function EvidenceTab({
  risk,
  allEvidence,
  onLinkEvidence,
  onUnlinkEvidence,
  isUnlinking,
  canEdit,
  canDelete,
}: {
  risk: RiskDetailData;
  allEvidence: Evidence[];
  onLinkEvidence: (evidenceId: number) => void;
  onUnlinkEvidence: (linkId: number) => void;
  isUnlinking: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const getStatusColor = (status?: string) => {
    switch (status) {
      case 'approved': return 'text-emerald-700 bg-emerald-100';
      case 'pending': return 'text-amber-700 bg-amber-100';
      case 'rejected': return 'text-rose-700 bg-rose-100';
      default: return 'text-slate-600 bg-slate-100';
    }
  };

  const linkedEvidenceIds = risk.linked_evidence?.map(e => e.evidence_id) || [];
  const availableEvidence = allEvidence
    .filter(e => !linkedEvidenceIds.includes(Number(e.id)))
    .map((e: any) => ({
      value: String(e.id),
      label: e.name || e.title || `Evidence #${e.id}`,
      subLabel: e.evidence_type || e.status || undefined,
    }));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <FileText className="h-4 w-4 text-primary-400" />
          Linked Evidence ({risk.linked_evidence?.length || 0})
        </h3>
        {canEdit && (
          <InlineLinkPicker
            triggerLabel="Link Evidence"
            triggerClassName="flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-1.5 text-sm text-white hover:bg-primary-700"
            items={availableEvidence}
            onSelect={(value) => onLinkEvidence(Number(value))}
            searchPlaceholder="Search evidence..."
            emptyText="No evidence available"
          />
        )}
      </div>

      {risk.linked_evidence && risk.linked_evidence.length > 0 ? (
        <div className="space-y-2">
          {risk.linked_evidence.map((evidence) => (
            <LinkEntityRow
              key={evidence.id}
              href={`/evidence/${evidence.evidence_id}`}
              icon={FileText}
              title={evidence.name}
              badge={
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${getStatusColor(evidence.status)}`}>
                  {evidence.status}
                </span>
              }
              onUnlink={() => onUnlinkEvidence(evidence.id)}
              canDelete={canDelete}
              isUnlinking={isUnlinking}
            />
          ))}
        </div>
      ) : (
        <EmptyLinkState icon={FileText} title="No evidence linked" hint="Link evidence that supports this risk assessment" />
      )}
    </div>
  );
}

function GovernanceTab({
  risk,
  allGovernance,
  allDocuments,
  linkedDocuments,
  onLinkGovernance,
  onLinkDocument,
  onUnlinkGovernance,
  onUnlinkDocument,
  isUnlinking,
  canEdit,
  canDelete,
}: {
  risk: RiskDetailData;
  allGovernance: any[];
  allDocuments: any[];
  linkedDocuments: any[];
  onLinkGovernance: (objectiveId: number) => void;
  onLinkDocument: (documentId: number) => void;
  onUnlinkGovernance: (linkId: number) => void;
  onUnlinkDocument: (linkId: number) => void;
  isUnlinking: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const getImpactColor = (level?: string) => {
    const item = IMPACT_LEVELS.find(i => i.value === level);
    return item?.color || 'text-slate-600';
  };

  const linkedDocumentIds = (linkedDocuments || []).map((d: any) => Number(d.document_id || d.id));
  const linkedObjectiveIds = risk.linked_governance?.map((g: any) => g.governance_objective_id || g.objective_id) || [];

  const documentItems = (allDocuments || [])
    .filter((d: any) => !linkedDocumentIds.includes(Number(d.id)))
    .map((d: any) => ({
      value: `d-${d.id}`,
      label: d.title || d.name || `Document #${d.id}`,
      subLabel: d.doc_type || d.document_type || d.status || 'Document',
    }));
  const objectiveItems = (allGovernance || [])
    .filter((g: any) => !linkedObjectiveIds.includes(Number(g.id)))
    .map((g: any) => ({
      value: `o-${g.id}`,
      label: g.title || g.name || `Objective #${g.id}`,
      subLabel: g.category ? `Objective • ${g.category}` : 'Objective',
    }));
  const combinedDocItems = [...documentItems, ...objectiveItems];

  const totalLinkedCount = (linkedDocuments?.length || 0) + (risk.linked_governance?.length || 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Target className="h-4 w-4 text-primary-400" />
          Linked Documents ({totalLinkedCount})
        </h3>
        {canEdit && (
          <InlineLinkPicker
            triggerLabel="Link Document"
            triggerClassName="flex items-center gap-2 rounded-lg bg-primary-600 px-3 py-1.5 text-sm text-white hover:bg-primary-700"
            items={combinedDocItems}
            onSelect={(value) => {
              if (value.startsWith('d-')) {
                onLinkDocument(Number(value.slice(2)));
              } else if (value.startsWith('o-')) {
                onLinkGovernance(Number(value.slice(2)));
              }
            }}
            searchPlaceholder="Search documents..."
            emptyText="No documents available"
          />
        )}
      </div>

      {totalLinkedCount > 0 ? (
        <div className="space-y-2">
          {(linkedDocuments || []).map((doc: any) => (
            <LinkEntityRow
              key={`d-${doc.link_id || doc.id}`}
              href={`/governance/documents/${doc.document_id || doc.id}`}
              icon={FileText}
              title={doc.title || doc.document_title || doc.name || `Document #${doc.document_id || doc.id}`}
              subtitle={`${doc.doc_type || doc.document_type || 'Document'}${doc.link_type ? ` · ${doc.link_type}` : ''}`}
              onUnlink={() => onUnlinkDocument(doc.link_id || doc.id)}
              canDelete={canDelete}
              isUnlinking={isUnlinking}
            />
          ))}
          {(risk.linked_governance || []).map((objective) => (
            <LinkEntityRow
              key={`o-${objective.id}`}
              icon={Target}
              title={objective.name}
              subtitle={<span className={getImpactColor(objective.impact_level)}>Impact: {objective.impact_level}</span>}
              onUnlink={() => onUnlinkGovernance(objective.id)}
              canDelete={canDelete}
              isUnlinking={isUnlinking}
            />
          ))}
        </div>
      ) : (
        <EmptyLinkState icon={Target} title="No documents linked" hint="Link governance documents affected by this risk" />
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
            className="flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

function LinkFrameworkControlModal({
  isOpen,
  onClose,
  onLink,
  isLinking,
  linkedControlIds,
  allFrameworkControls,
}: {
  isOpen: boolean;
  onClose: () => void;
  onLink: (controlId: number, effectiveness: string, notes?: string) => void;
  isLinking: boolean;
  linkedControlIds: number[];
  allFrameworkControls: { id: number | string; name: string; reference_code?: string }[];
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedControlId, setSelectedControlId] = useState<number | null>(null);
  const [effectiveness, setEffectiveness] = useState('partial');
  const [notes, setNotes] = useState('');

  const filteredControls = allFrameworkControls.filter(
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
    <RightSlidePanel
      isOpen={isOpen}
      onClose={onClose}
      title="Link Framework Control"
    >
      <div className="space-y-4">
        <input
          type="text"
          placeholder="Search framework controls..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white py-2 px-3 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none"
        />

        <div className="max-h-64 space-y-2 overflow-y-auto">
          {filteredControls.length === 0 ? (
            <p className="py-4 text-center text-slate-600">No controls found</p>
          ) : (
            filteredControls.map((control) => (
              <button
                key={control.id}
                onClick={() => setSelectedControlId(Number(control.id))}
                className={`flex w-full items-center justify-between rounded-lg p-3 text-left ${
                  selectedControlId === Number(control.id)
                    ? 'bg-primary-50 border border-primary-500'
                    : 'bg-white hover:bg-slate-100'
                }`}
              >
                <div>
                  <span className="text-sm font-medium text-primary-600">{control.reference_code}</span>
                  <p className="text-slate-900">{control.name}</p>
                </div>
              </button>
            ))
          )}
        </div>

        {selectedControlId && (
          <>
            <div>
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
            <div>
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

        <div className="flex justify-end gap-3 pt-2">
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
            {isLinking && <Loader2 className="h-4 w-4 animate-spin" />}
            Link Control
          </button>
        </div>
      </div>
    </RightSlidePanel>
  );
}

function LinkGovernanceModal({
  isOpen,
  onClose,
  onLink,
  isLinking,
  linkedGovernanceIds,
  allGovernance,
}: {
  isOpen: boolean;
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
    <RightSlidePanel
      isOpen={isOpen}
      onClose={onClose}
      title="Link Document"
    >
      <div className="space-y-4">
        <input
          type="text"
          placeholder="Search documents..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full rounded-lg border border-slate-300 bg-white py-2 px-3 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none"
        />

        <div className="max-h-64 space-y-2 overflow-y-auto">
          {filteredGovernance.length === 0 ? (
            <p className="py-4 text-center text-slate-600">No documents found</p>
          ) : (
            filteredGovernance.map((objective) => (
              <button
                key={objective.id}
                onClick={() => setSelectedObjectiveId(Number(objective.id))}
                className={`flex w-full items-center justify-between rounded-lg p-3 text-left ${
                  selectedObjectiveId === Number(objective.id)
                    ? 'bg-primary-50 border border-primary-500'
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
          <div>
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

        <div className="flex justify-end gap-3 pt-2">
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
            {isLinking && <Loader2 className="h-4 w-4 animate-spin" />}
            Link Document
          </button>
        </div>
      </div>
    </RightSlidePanel>
  );
}
