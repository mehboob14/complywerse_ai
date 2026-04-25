'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePermissions } from '@/hooks/usePermissions';
import { assetsApi, ermApi, evidenceApi, vulnManagementApi } from '@/lib/api';
import type { ITAsset } from '@/types';
import { 
  ArrowLeft, Loader2, AlertCircle, Shield, DollarSign, 
  Target, TrendingUp, Link as LinkIcon, FileCheck, AlertTriangle,
  ClipboardList, Plus, X, Trash2, Edit, RefreshCw,
  AppWindow, HardDrive, Database, Cloud, Building2,
  Lock, ShieldCheck, MapPin, User, Search, Bug
} from 'lucide-react';
import Link from 'next/link';

const ASSET_TYPE_ICONS: Record<string, React.ElementType> = {
  application: AppWindow,
  infrastructure: HardDrive,
  data: Database,
  cloud: Cloud,
  third_party: Building2,
};

const ASSET_TYPE_LABELS: Record<string, string> = {
  application: 'Application',
  infrastructure: 'Infrastructure',
  data: 'Data',
  cloud: 'Cloud Resource',
  third_party: 'Third-Party System',
};

type TabType = 'details' | 'controls' | 'evidence' | 'risks' | 'security-compliance' | 'vulnerabilities';

interface LinkedControl {
  id: number;
  control_id: number;
  code: string;
  name: string;
}

interface LinkedInternalControl {
  id: number;
  internal_control_id: number;
  code: string;
  name: string;
  category?: string;
  coverage_status?: string;
}

interface LinkedFrameworkControl {
  id: number;
  framework_control_id: number;
  code: string;
  name: string;
  coverage_status: string;
  notes?: string;
}

interface LinkedEvidence {
  id: number;
  evidence_id: number;
  name: string;
  relationship_type: string;
}

interface LinkedVulnerability {
  link_id?: number;
  vulnerability_id: number;
  vuln_id?: string | null;
  title?: string | null;
  severity?: string | null;
  status?: string | null;
  impact_on_asset?: string | null;
  notes?: string | null;
  created_at?: string | null;
}

interface RiskAssessment {
  id: number;
  assessment_date: string;
  risk_score: number;
  coverage_percentage: number;
  gaps?: Record<string, unknown>;
}

interface AssetDetailData {
  id: number;
  tenant_id: number;
  name: string;
  description?: string;
  asset_type: string;
  owner_id?: number;
  owner_name?: string;
  custodian?: string;
  host_name?: string;
  ip_address?: string;
  criticality: string;
  confidentiality_rating?: number;
  integrity_rating?: number;
  availability_rating?: number;
  valuation?: number;
  vendor?: string;
  location?: string;
  status: string;
  created_at: string;
  linked_controls: LinkedControl[];
  linked_internal_controls: LinkedInternalControl[];
  linked_framework_controls: LinkedFrameworkControl[];
  linked_risks: Array<{ risk_id: number; title?: string; status?: string }>;
  linked_evidence: LinkedEvidence[];
  linked_vulnerabilities: LinkedVulnerability[];
  risk_assessments: RiskAssessment[];
  coverage_percentage: number;
}

interface SecurityComplianceControl {
  control_id: string;
  ControlID?: string;
  Title?: string;
  Level?: string;
  Section?: string;
  Assessment?: string;
  selected: boolean;
  [key: string]: unknown;
}

interface SecurityComplianceControlsResponse {
  benchmark: string;
  version?: string;
  published?: string;
  total_controls_in_source: number;
  total: number;
  skip: number;
  limit: number;
  selected_count: number;
  controls: SecurityComplianceControl[];
}

type AssetUpdatePayload = Partial<
  Pick<
    ITAsset,
    | 'name'
    | 'description'
    | 'host_name'
    | 'ip_address'
    | 'criticality'
    | 'confidentiality_rating'
    | 'integrity_rating'
    | 'availability_rating'
    | 'valuation'
    | 'vendor'
    | 'location'
    | 'status'
  >
>;

export default function AssetDetailPage() {
  const params = useParams();
  const router = useRouter();
  const assetId = Number(params.id);
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('assets:asset_inventory:edit');
  const canDelete = hasPermission('assets:asset_inventory:delete');
  const [activeTab, setActiveTab] = useState<TabType>('details');
  const [showLinkControlModal, setShowLinkControlModal] = useState(false);
  const [showLinkEvidenceModal, setShowLinkEvidenceModal] = useState(false);
  const [showLinkVulnerabilityModal, setShowLinkVulnerabilityModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  const { data: asset, isLoading, error } = useQuery<AssetDetailData>({
    queryKey: ['asset-detail', assetId],
    queryFn: async () => {
      const response = await assetsApi.getDetail(assetId);
      return response.data;
    },
  });

  const { data: coverage } = useQuery({
    queryKey: ['asset-coverage', assetId],
    queryFn: async () => {
      const response = await assetsApi.getCoverageAnalysis(assetId);
      return response.data;
    },
  });

  const { data: allControls, isLoading: controlsLoading } = useQuery({
    queryKey: ['asset-internal-controls'],
    queryFn: async () => {
      const response = await ermApi.internalControls.getAll();
      return response.data as Array<{ id: number; control_id?: string; name: string; category?: string }>;
    },
    enabled: showLinkControlModal,
  });

  const { data: allEvidence } = useQuery({
    queryKey: ['all-evidence'],
    queryFn: async () => {
      const response = await evidenceApi.getAll();
      return response.data;
    },
    enabled: showLinkEvidenceModal,
  });

  const { data: allVulnerabilities } = useQuery({
    queryKey: ['all-vulnerabilities'],
    queryFn: async () => {
      const response = await vulnManagementApi.vulnerabilities.getAll();
      return response.data as Array<{ id: number; vuln_id?: string; title?: string; severity?: string; status?: string }>;
    },
    enabled: showLinkVulnerabilityModal,
  });

  const assessRiskMutation = useMutation({
    mutationFn: () => assetsApi.assessRisk(assetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-detail', assetId] });
      queryClient.invalidateQueries({ queryKey: ['asset-coverage', assetId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => assetsApi.delete(assetId),
    onSuccess: () => {
      router.push('/assets');
    },
  });

  const unlinkInternalControlMutation = useMutation({
    mutationFn: (linkId: number) => assetsApi.unlinkInternalControl(assetId, linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-detail', assetId] });
      queryClient.invalidateQueries({ queryKey: ['asset-coverage', assetId] });
    },
  });

  const unlinkFrameworkControlMutation = useMutation({
    mutationFn: (linkId: number) => assetsApi.unlinkFrameworkControl(assetId, linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-detail', assetId] });
      queryClient.invalidateQueries({ queryKey: ['asset-coverage', assetId] });
    },
  });

  const unlinkEvidenceMutation = useMutation({
    mutationFn: (linkId: number) => assetsApi.unlinkEvidence(assetId, linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-detail', assetId] });
    },
  });

  const linkControlMutation = useMutation({
    mutationFn: (data: { internal_control_id: number; coverage_status?: string }) => 
      assetsApi.linkInternalControl(assetId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-detail', assetId] });
      queryClient.invalidateQueries({ queryKey: ['asset-coverage', assetId] });
      setShowLinkControlModal(false);
    },
  });

  const linkEvidenceMutation = useMutation({
    mutationFn: (data: { evidence_id: number; relationship_type?: string }) => 
      assetsApi.linkEvidence(assetId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-detail', assetId] });
      setShowLinkEvidenceModal(false);
    },
  });

  const linkVulnerabilityMutation = useMutation({
    mutationFn: (vulnId: number) =>
      vulnManagementApi.assetLinks.create(vulnId, { asset_id: assetId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-detail', assetId] });
      setShowLinkVulnerabilityModal(false);
    },
  });

  const unlinkVulnerabilityMutation = useMutation({
    mutationFn: (vulnId: number) =>
      vulnManagementApi.assetLinks.delete(vulnId, assetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-detail', assetId] });
    },
  });

  const updateAssetMutation = useMutation({
    mutationFn: (data: AssetUpdatePayload) => assetsApi.update(assetId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-detail', assetId] });
      queryClient.invalidateQueries({ queryKey: ['assets'] });
      setShowEditModal(false);
    },
  });

  const getAssetIcon = (type: string) => {
    const Icon = ASSET_TYPE_ICONS[type] || AppWindow;
    return <Icon className="h-6 w-6" />;
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      active: 'bg-green-50 text-green-700 border-green-200',
      inactive: 'bg-yellow-50 text-yellow-700 border-yellow-200',
      decommissioned: 'bg-slate-100 text-slate-600 border-slate-200',
    };
    return (
      <span className={`rounded-full border px-3 py-1 text-sm font-medium ${colors[status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const getCriticalityBadge = (criticality: string) => {
    const colors: Record<string, string> = {
      critical: 'bg-red-50 text-red-600 border-red-200',
      high: 'bg-orange-50 text-orange-600 border-orange-200',
      medium: 'bg-yellow-50 text-yellow-700 border-yellow-200',
      low: 'bg-green-50 text-green-600 border-green-200',
    };
    return (
      <span className={`rounded-full border px-3 py-1 text-sm font-medium ${colors[criticality] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
        {criticality.charAt(0).toUpperCase() + criticality.slice(1)}
      </span>
    );
  };

  const formatCurrency = (value: number | undefined) => {
    if (!value) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const CIARatingBar = ({ rating, label, color }: { rating: number; label: string; color: string }) => {
    const value = rating || 0;
    return (
      <div className="flex items-center gap-3">
        <span className="w-32 text-xs text-slate-600">{label}</span>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className={`h-4 w-6 rounded ${i <= value ? color : 'bg-slate-200'}`}
            />
          ))}
        </div>
        <span className="text-xs text-slate-700">{value}/5</span>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-slate-200 bg-white">
        <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
      </div>
    );
  }

  if (error || !asset) {
    return (
      <div className="flex h-64 flex-col items-center justify-center rounded-lg border border-red-200 bg-red-50 text-red-600">
        <AlertCircle className="mb-2 h-8 w-8" />
        <p>Failed to load asset details</p>
        <Link href="/assets" className="mt-4 text-blue-600 hover:underline">
          Back to Assets
        </Link>
      </div>
    );
  }

  const latestAssessment = asset.risk_assessments?.length > 0 
    ? asset.risk_assessments.sort((a, b) => new Date(b.assessment_date).getTime() - new Date(a.assessment_date).getTime())[0]
    : null;

  const displayName = (() => {
    const isAutoName = asset.name === asset.ip_address || asset.name?.startsWith('Nessus-Host-');
    if (isAutoName) {
      const locationName = asset.location
        ? asset.location.split(',')[0].trim()
        : '';
      return asset.host_name || locationName || asset.name;
    }
    return asset.name;
  })();

  const tabs: { id: TabType; label: string; icon: React.ElementType }[] = [
    { id: 'details', label: 'Details', icon: ClipboardList },
    { id: 'controls', label: 'Controls', icon: Shield },
    { id: 'evidence', label: 'Evidence', icon: FileCheck },
    { id: 'vulnerabilities', label: 'Vulnerabilities', icon: Bug },
    { id: 'risks', label: 'Risks', icon: AlertTriangle },
    { id: 'security-compliance', label: 'Security Compliance', icon: ShieldCheck },
  ];

  return (
    <div className="assets-light min-h-full space-y-4 bg-slate-50 p-4 md:p-6">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center">
          <div className="flex items-center gap-4">
            <Link
              href="/assets"
              className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                {getAssetIcon(asset.asset_type)}
              </div>
              <div>
                <h1 className="text-lg font-semibold text-slate-900">{displayName}</h1>
                <p className="text-xs text-slate-600">{asset.description || 'No description'}</p>
              </div>
            </div>
          </div>
          <div className="flex flex-1 flex-wrap items-center gap-2 xl:justify-end">
            <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs text-blue-700">
              {ASSET_TYPE_LABELS[asset.asset_type] || asset.asset_type}
            </span>
            {getStatusBadge(asset.status)}
            {getCriticalityBadge(asset.criticality)}
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            {canEdit && (
              <button
                onClick={() => setShowEditModal(true)}
                className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
                title="Edit Asset"
              >
                <Edit className="h-4 w-4" />
                Edit
              </button>
            )}
            <button
              onClick={() => assessRiskMutation.mutate()}
              disabled={assessRiskMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700 disabled:opacity-50"
              title="Assess Risk"
            >
              {assessRiskMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Assess Risk
            </button>
            {canDelete && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-600 hover:bg-red-100"
                title="Delete Asset"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2 text-slate-600">
            <Lock className="h-4 w-4" />
            <span className="text-sm font-medium">CIA Ratings</span>
          </div>
          <div className="space-y-2">
            <CIARatingBar rating={asset.confidentiality_rating || 0} label="Confidentiality" color="bg-blue-500" />
            <CIARatingBar rating={asset.integrity_rating || 0} label="Integrity" color="bg-green-500" />
            <CIARatingBar rating={asset.availability_rating || 0} label="Availability" color="bg-yellow-500" />
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2 text-slate-600">
            <DollarSign className="h-4 w-4" />
            <span className="text-sm font-medium">Valuation</span>
          </div>
          <div className="text-3xl font-bold text-green-600">
            {formatCurrency(asset.valuation)}
          </div>
          <p className="mt-2 text-sm text-slate-500">Estimated asset value</p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2 text-slate-600">
            <Target className="h-4 w-4" />
            <span className="text-sm font-medium">Control Coverage</span>
          </div>
          <div className="text-3xl font-bold text-blue-600">
            {coverage?.coverage_percentage ?? asset.coverage_percentage ?? 0}%
          </div>
          <div className="mt-2">
            <div className="h-2 w-full rounded-full bg-slate-200">
              <div 
                className="h-2 rounded-full bg-blue-500 transition-all"
                style={{ width: `${coverage?.coverage_percentage ?? asset.coverage_percentage ?? 0}%` }}
              />
            </div>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            {(asset.linked_controls?.length || 0) + (asset.linked_internal_controls?.length || 0) + (asset.linked_framework_controls?.length || 0)} controls linked
          </p>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center gap-2 text-slate-600">
            <TrendingUp className="h-4 w-4" />
            <span className="text-sm font-medium">Risk Score</span>
          </div>
          {latestAssessment ? (
            <>
              <div className={`text-3xl font-bold ${
                latestAssessment.risk_score >= 7 ? 'text-red-600' :
                latestAssessment.risk_score >= 4 ? 'text-yellow-600' : 'text-green-600'
              }`}>
                {latestAssessment.risk_score.toFixed(1)}
              </div>
              <p className="mt-2 text-sm text-slate-500">
                Last assessed: {formatDate(latestAssessment.assessment_date)}
              </p>
            </>
          ) : (
            <>
              <div className="text-3xl font-bold text-slate-500">-</div>
              <p className="mt-2 text-sm text-slate-500">No assessment yet</p>
            </>
          )}
        </div>
      </div>

      <div className="border-b border-slate-200 px-1">
        <nav className="flex gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-900'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        {activeTab === 'details' && (
          <DetailsTab asset={asset} />
        )}
        {activeTab === 'controls' && (
          <ControlsTab
            asset={asset}
            onLinkControl={() => setShowLinkControlModal(true)}
            onUnlinkInternalControl={(linkId) => unlinkInternalControlMutation.mutate(linkId)}
            onUnlinkFrameworkControl={(linkId) => unlinkFrameworkControlMutation.mutate(linkId)}
            isUnlinkingInternal={unlinkInternalControlMutation.isPending}
            isUnlinkingFramework={unlinkFrameworkControlMutation.isPending}
          />
        )}
        {activeTab === 'evidence' && (
          <EvidenceTab
            asset={asset}
            onLinkEvidence={() => setShowLinkEvidenceModal(true)}
            onUnlinkEvidence={(linkId) => unlinkEvidenceMutation.mutate(linkId)}
            isUnlinking={unlinkEvidenceMutation.isPending}
          />
        )}
        {activeTab === 'vulnerabilities' && (
          <VulnerabilitiesTab
            asset={asset}
            onLinkVulnerability={() => setShowLinkVulnerabilityModal(true)}
            onUnlinkVulnerability={(vulnId) => unlinkVulnerabilityMutation.mutate(vulnId)}
            isUnlinking={unlinkVulnerabilityMutation.isPending}
          />
        )}
        {activeTab === 'risks' && (
          <RisksTab asset={asset} />
        )}
        {activeTab === 'security-compliance' && (
          <SecurityComplianceTab assetId={assetId} />
        )}
      </div>

      {showLinkControlModal && (
        <LinkControlModal
          onClose={() => setShowLinkControlModal(false)}
          onLink={(controlId, coverageStatus) => linkControlMutation.mutate({ 
            internal_control_id: controlId, 
            coverage_status: coverageStatus 
          })}
          isLinking={linkControlMutation.isPending}
          isLoading={controlsLoading}
          linkedControlIds={asset.linked_internal_controls?.map((c) => c.internal_control_id) || []}
          allControls={(allControls || []).map((c) => ({
            id: c.id,
            internal_id: (c as any).control_id,
            name: c.name,
            category: (c as any).category,
          }))}
        />
      )}

      {showLinkEvidenceModal && (
        <LinkEvidenceModal
          onClose={() => setShowLinkEvidenceModal(false)}
          onLink={(evidenceId, relationshipType) => linkEvidenceMutation.mutate({ 
            evidence_id: evidenceId, 
            relationship_type: relationshipType 
          })}
          isLinking={linkEvidenceMutation.isPending}
          linkedEvidenceIds={asset.linked_evidence?.map(e => e.evidence_id) || []}
          allEvidence={allEvidence || []}
        />
      )}

      {showLinkVulnerabilityModal && (
        <LinkVulnerabilityModal
          onClose={() => setShowLinkVulnerabilityModal(false)}
          onLink={(vulnId) => linkVulnerabilityMutation.mutate(vulnId)}
          isLinking={linkVulnerabilityMutation.isPending}
          linkedVulnerabilityIds={asset.linked_vulnerabilities?.map((v) => v.vulnerability_id) || []}
          allVulnerabilities={allVulnerabilities || []}
        />
      )}

      {showDeleteConfirm && (
        <DeleteConfirmModal
          assetName={asset.name}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={() => deleteMutation.mutate()}
          isDeleting={deleteMutation.isPending}
        />
      )}

      {showEditModal && (
        <EditAssetModal
          asset={asset}
          onClose={() => setShowEditModal(false)}
          onSave={(data) => updateAssetMutation.mutate(data)}
          isSaving={updateAssetMutation.isPending}
        />
      )}
    </div>
  );
}

function EditAssetModal({
  asset,
  onClose,
  onSave,
  isSaving,
}: {
  asset: AssetDetailData;
  onClose: () => void;
  onSave: (data: AssetUpdatePayload) => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState({
    name: asset.name || '',
    description: asset.description || '',
    host_name: asset.host_name || '',
    ip_address: asset.ip_address || '',
    criticality: asset.criticality || 'medium',
    confidentiality_rating: asset.confidentiality_rating || 0,
    integrity_rating: asset.integrity_rating || 0,
    availability_rating: asset.availability_rating || 0,
    valuation: asset.valuation || 0,
    vendor: asset.vendor || '',
    location: asset.location || '',
    status: asset.status || 'active',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name: form.name,
      description: form.description || undefined,
      host_name: form.host_name || undefined,
      ip_address: form.ip_address || undefined,
      criticality: form.criticality as ITAsset['criticality'],
      confidentiality_rating: Number(form.confidentiality_rating) || 0,
      integrity_rating: Number(form.integrity_rating) || 0,
      availability_rating: Number(form.availability_rating) || 0,
      valuation: Number(form.valuation) || 0,
      vendor: form.vendor || undefined,
      location: form.location || undefined,
      status: form.status as ITAsset['status'],
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 p-4">
      <div className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Edit Asset</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600">Asset Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600">Description</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-600">Primary Component</label>
              <input
                value={form.host_name}
                onChange={(e) => setForm({ ...form, host_name: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">IP Address</label>
              <input
                value={form.ip_address}
                onChange={(e) => setForm({ ...form, ip_address: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-600">Criticality</label>
              <select
                value={form.criticality}
                onChange={(e) => setForm({ ...form, criticality: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="decommissioned">Decommissioned</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-slate-600">Confidentiality (0-5)</label>
              <input
                type="number"
                min={0}
                max={5}
                value={form.confidentiality_rating}
                onChange={(e) => setForm({ ...form, confidentiality_rating: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">Integrity (0-5)</label>
              <input
                type="number"
                min={0}
                max={5}
                value={form.integrity_rating}
                onChange={(e) => setForm({ ...form, integrity_rating: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">Availability (0-5)</label>
              <input
                type="number"
                min={0}
                max={5}
                value={form.availability_rating}
                onChange={(e) => setForm({ ...form, availability_rating: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-slate-600">Valuation</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.valuation}
                onChange={(e) => setForm({ ...form, valuation: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600">Vendor</label>
              <input
                value={form.vendor}
                onChange={(e) => setForm({ ...form, vendor: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600">Location</label>
            <input
              value={form.location}
              onChange={(e) => setForm({ ...form, location: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DetailsTab({ asset }: { asset: AssetDetailData }) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <ClipboardList className="h-4 w-4 text-blue-600" />
          Basic Information
        </h3>
        <div className="space-y-3">
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Asset Name</span>
            <p className="text-sm text-slate-900">{asset.name}</p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Description</span>
            <p className="text-sm text-slate-700">{asset.description || 'No description provided'}</p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Asset Type</span>
            <p className="text-sm text-slate-700">{ASSET_TYPE_LABELS[asset.asset_type] || asset.asset_type}</p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Primary Component</span>
            <p className="text-sm text-slate-700">{asset.host_name || 'Not specified'}</p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Sub-components</span>
            <p className="text-sm text-slate-700">{asset.custodian || 'Not specified'}</p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Criticality</span>
            <p className="text-sm capitalize text-slate-700">{asset.criticality}</p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Status</span>
            <p className="text-sm capitalize text-slate-700">{asset.status}</p>
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <User className="h-4 w-4 text-blue-600" />
          Ownership & Vendor
        </h3>
        <div className="space-y-3">
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Owner</span>
            <p className="text-sm text-slate-700">{asset.owner_name || 'Not assigned'}</p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Vendor</span>
            <p className="text-sm text-slate-700">{asset.vendor || 'N/A'}</p>
          </div>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <MapPin className="h-4 w-4 text-blue-600" />
          Location & Timestamps
        </h3>
        <div className="space-y-3">
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Location</span>
            <p className="text-sm text-slate-700">{asset.location || 'Unknown'}</p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">IP Address</span>
            <p className="text-sm text-slate-700">{asset.ip_address || 'N/A'}</p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Created</span>
            <p className="text-sm text-slate-700">
              {new Date(asset.created_at).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ControlsTab({ 
  asset, 
  onLinkControl,
  onUnlinkInternalControl,
  onUnlinkFrameworkControl,
  isUnlinkingInternal,
  isUnlinkingFramework,
}: { 
  asset: AssetDetailData; 
  onLinkControl: () => void;
  onUnlinkInternalControl: (linkId: number) => void;
  onUnlinkFrameworkControl: (linkId: number) => void;
  isUnlinkingInternal: boolean;
  isUnlinkingFramework: boolean;
}) {
  const totalControls =
    (asset.linked_controls?.length || 0) +
    (asset.linked_internal_controls?.length || 0) +
    (asset.linked_framework_controls?.length || 0);

  const coverageBadgeClass = (status?: string) => {
    if (status === 'full') return 'border-green-200 bg-green-50 text-green-700';
    if (status === 'partial') return 'border-yellow-200 bg-yellow-50 text-yellow-700';
    return 'border-slate-200 bg-slate-100 text-slate-600';
  };
  
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Shield className="h-4 w-4 text-blue-600" />
          Linked Controls ({totalControls})
        </h3>
        <button
          onClick={onLinkControl}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          Link Control
        </button>
      </div>

      {asset.linked_internal_controls && asset.linked_internal_controls.length > 0 && (
        <div>
          <h4 className="mb-3 text-sm font-medium text-slate-600">Risk Management Internal Controls</h4>
          <div className="space-y-2">
            {asset.linked_internal_controls.map((control) => (
              <div key={control.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center gap-3">
                  <ShieldCheck className="h-5 w-5 text-blue-600" />
                  <div>
                    <span className="text-xs font-medium text-blue-600">{control.code || `IC-${control.internal_control_id}`}</span>
                    <p className="text-sm font-medium text-slate-900">{control.name}</p>
                    {control.category && (
                      <span className="text-xs text-slate-500">{control.category}</span>
                    )}
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${coverageBadgeClass(control.coverage_status)}`}>
                    {control.coverage_status || 'Not set'}
                  </span>
                </div>
                <button
                  onClick={() => onUnlinkInternalControl(control.id)}
                  disabled={isUnlinkingInternal}
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600 disabled:opacity-50"
                  title="Unlink Control"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {asset.linked_framework_controls && asset.linked_framework_controls.length > 0 && (
        <div>
          <h4 className="mb-3 text-sm font-medium text-slate-600">Framework Controls</h4>
          <div className="space-y-2">
            {asset.linked_framework_controls.map((control) => (
              <div key={control.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center gap-3">
                  <Shield className="h-5 w-5 text-blue-600" />
                  <div>
                    <span className="text-xs font-medium text-blue-600">{control.code}</span>
                    <p className="text-sm font-medium text-slate-900">{control.name}</p>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-xs ${coverageBadgeClass(control.coverage_status)}`}>
                    {control.coverage_status || 'Not set'}
                  </span>
                </div>
                <button
                  onClick={() => onUnlinkFrameworkControl(control.id)}
                  disabled={isUnlinkingFramework}
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600 disabled:opacity-50"
                  title="Unlink Control"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {asset.linked_controls && asset.linked_controls.length > 0 && (
        <div>
          <h4 className="mb-3 text-sm font-medium text-slate-600">Legacy Normalized Controls</h4>
          <div className="space-y-2">
            {asset.linked_controls.map((control) => (
              <div key={control.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center gap-3">
                  <ShieldCheck className="h-5 w-5 text-blue-600" />
                  <div>
                    <span className="text-xs font-medium text-blue-600">{control.code}</span>
                    <p className="text-sm font-medium text-slate-900">{control.name}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {totalControls === 0 && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 py-12 text-center">
          <Shield className="mb-4 h-12 w-12 text-slate-400" />
          <h4 className="text-base font-medium text-slate-900">No Controls Linked</h4>
          <p className="mt-1 text-sm text-slate-600">Link controls to this asset for compliance tracking</p>
          <button
            onClick={onLinkControl}
            className="mt-4 flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Link First Control
          </button>
        </div>
      )}
    </div>
  );
}

function EvidenceTab({ 
  asset, 
  onLinkEvidence, 
  onUnlinkEvidence,
  isUnlinking 
}: { 
  asset: AssetDetailData; 
  onLinkEvidence: () => void;
  onUnlinkEvidence: (linkId: number) => void;
  isUnlinking: boolean;
}) {
  const relationshipColors: Record<string, string> = {
    supports: 'border-green-200 bg-green-50 text-green-700',
    validates: 'border-blue-200 bg-blue-50 text-blue-700',
    documents: 'border-purple-200 bg-purple-50 text-purple-700',
  };
  
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <FileCheck className="h-4 w-4 text-blue-600" />
          Linked Evidence ({asset.linked_evidence?.length || 0})
        </h3>
        <button
          onClick={onLinkEvidence}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-1.5 text-xs text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          Link Evidence
        </button>
      </div>

      {asset.linked_evidence && asset.linked_evidence.length > 0 ? (
        <div className="space-y-2">
          {asset.linked_evidence.map((evidence) => (
            <div key={evidence.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center gap-3">
                <FileCheck className="h-5 w-5 text-emerald-600" />
                <div>
                  <p className="text-sm font-medium text-slate-900">{evidence.name}</p>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${relationshipColors[evidence.relationship_type] || 'border-slate-200 bg-slate-100 text-slate-600'}`}>
                  {evidence.relationship_type}
                </span>
              </div>
              <button
                onClick={() => onUnlinkEvidence(evidence.id)}
                disabled={isUnlinking}
                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600 disabled:opacity-50"
                title="Unlink Evidence"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 py-12 text-center">
          <FileCheck className="mb-4 h-12 w-12 text-slate-400" />
          <h4 className="text-base font-medium text-slate-900">No Evidence Linked</h4>
          <p className="mt-1 text-sm text-slate-600">Link evidence items to document this asset</p>
          <button
            onClick={onLinkEvidence}
            className="mt-4 flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Link First Evidence
          </button>
        </div>
      )}
    </div>
  );
}

function VulnerabilitiesTab({
  asset,
  onLinkVulnerability,
  onUnlinkVulnerability,
  isUnlinking,
}: {
  asset: AssetDetailData;
  onLinkVulnerability: () => void;
  onUnlinkVulnerability: (vulnId: number) => void;
  isUnlinking: boolean;
}) {
  const severityColors: Record<string, string> = {
    critical: 'border-red-200 bg-red-50 text-red-600',
    high: 'border-orange-200 bg-orange-50 text-orange-600',
    medium: 'border-yellow-200 bg-yellow-50 text-yellow-700',
    low: 'border-green-200 bg-green-50 text-green-600',
    info: 'border-slate-200 bg-slate-100 text-slate-600',
  };

  const statusColors: Record<string, string> = {
    open: 'border-blue-200 bg-blue-50 text-blue-600',
    in_progress: 'border-purple-200 bg-purple-50 text-purple-600',
    resolved: 'border-green-200 bg-green-50 text-green-600',
    accepted: 'border-slate-200 bg-slate-100 text-slate-600',
    false_positive: 'border-slate-200 bg-slate-100 text-slate-600',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Bug className="h-5 w-5 text-blue-600" />
          Linked Vulnerabilities ({asset.linked_vulnerabilities?.length || 0})
        </h3>
        <button
          onClick={onLinkVulnerability}
          className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          Link Vulnerability
        </button>
      </div>

      {asset.linked_vulnerabilities && asset.linked_vulnerabilities.length > 0 ? (
        <div className="space-y-2">
          {asset.linked_vulnerabilities.map((vuln) => (
            <div key={`${vuln.vulnerability_id}-${vuln.link_id || 'link'}`} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center gap-3">
                <Bug className="h-5 w-5 text-red-500" />
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {vuln.title || `Vulnerability #${vuln.vulnerability_id}`}
                  </p>
                  <p className="text-xs text-slate-500">
                    {vuln.vuln_id ? `${vuln.vuln_id} • ` : ''}{vuln.status || 'status unknown'}
                  </p>
                </div>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${severityColors[(vuln.severity || '').toLowerCase()] || 'border-slate-200 bg-slate-100 text-slate-600'}`}>
                  {vuln.severity || 'unknown'}
                </span>
                <span className={`rounded-full border px-2 py-0.5 text-xs ${statusColors[(vuln.status || '').toLowerCase()] || 'border-slate-200 bg-slate-100 text-slate-600'}`}>
                  {(vuln.status || 'unknown').replace(/_/g, ' ')}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Link
                  href={`/vulnerabilities/${vuln.vulnerability_id}`}
                  className="text-sm text-blue-600 hover:underline"
                >
                  View
                </Link>
                <button
                  onClick={() => onUnlinkVulnerability(vuln.vulnerability_id)}
                  disabled={isUnlinking}
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600 disabled:opacity-50"
                  title="Unlink Vulnerability"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 py-12 text-center">
          <Bug className="mb-4 h-12 w-12 text-slate-400" />
          <h4 className="text-base font-medium text-slate-900">No Vulnerabilities Linked</h4>
          <p className="mt-1 text-sm text-slate-600">Link vulnerabilities to track asset exposure</p>
          <button
            onClick={onLinkVulnerability}
            className="mt-4 flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Link First Vulnerability
          </button>
        </div>
      )}
    </div>
  );
}

function RisksTab({ asset }: { asset: AssetDetailData }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <AlertTriangle className="h-5 w-5 text-blue-600" />
          Associated Risks ({asset.linked_risks?.length || 0})
        </h3>
      </div>

      {asset.linked_risks && asset.linked_risks.length > 0 ? (
        <div className="space-y-2">
          {asset.linked_risks.map((risk) => (
            <div key={risk.risk_id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-orange-500" />
                <div>
                  <p className="text-sm font-medium text-slate-900">{risk.title || `Risk #${risk.risk_id}`}</p>
                  <p className="text-xs text-slate-500">Risk ID: {risk.risk_id}{risk.status ? ` • ${risk.status}` : ''}</p>
                </div>
              </div>
              <Link 
                href={`/risks/${risk.risk_id}`}
                className="text-sm text-blue-600 hover:underline"
              >
                View Details
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 py-12 text-center">
          <AlertTriangle className="mb-4 h-12 w-12 text-slate-400" />
          <h4 className="text-base font-medium text-slate-900">No Associated Risks</h4>
          <p className="mt-1 text-sm text-slate-600">No risks have been linked to this asset</p>
        </div>
      )}
    </div>
  );
}

function SecurityComplianceTab({ assetId }: { assetId: number }) {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<'control_id' | 'title' | 'level' | 'section'>('control_id');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchTerm(searchInput.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const { data, isLoading, isFetching, error } = useQuery<SecurityComplianceControlsResponse>({
    queryKey: ['asset-security-compliance-controls', assetId, searchTerm, sortBy, sortOrder, page],
    queryFn: async () => {
      const response = await assetsApi.getSecurityComplianceControls(assetId, {
        search: searchTerm || undefined,
        sort_by: sortBy,
        sort_order: sortOrder,
        skip: (page - 1) * pageSize,
        limit: pageSize,
      });
      return response.data;
    },
    enabled: Number.isFinite(assetId) && assetId > 0,
  });

  const addSelectionsMutation = useMutation({
    mutationFn: (controlIds: string[]) => assetsApi.addSecurityComplianceSelections(assetId, controlIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-security-compliance-controls', assetId] });
    },
  });

  const removeSelectionMutation = useMutation({
    mutationFn: (controlId: string) => assetsApi.removeSecurityComplianceSelection(assetId, controlId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-security-compliance-controls', assetId] });
    },
  });

  const controls = data?.controls || [];
  const total = data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selectedVisible = controls.filter((item) => item.selected).map((item) => item.control_id);
  const unselectedVisible = controls.filter((item) => !item.selected).map((item) => item.control_id);

  const toggleSelection = (control: SecurityComplianceControl) => {
    if (control.selected) {
      removeSelectionMutation.mutate(control.control_id);
      return;
    }
    addSelectionsMutation.mutate([control.control_id]);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Security Compliance Plugin</h3>
            <p className="text-xs text-slate-600">
              {data?.benchmark || 'CIS_WS2012R2'} {data?.version ? `v${data.version}` : ''} | Selected: {data?.selected_count || 0}
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            {isFetching && <Loader2 className="h-4 w-4 animate-spin" />}
            <span>{total} controls</span>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 md:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search control ID, title, level, section..."
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-3 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none"
          />
        </div>
        <select
          value={sortBy}
          onChange={(e) => {
            setSortBy(e.target.value as 'control_id' | 'title' | 'level' | 'section');
            setPage(1);
          }}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
        >
          <option value="control_id">Sort: Control ID</option>
          <option value="title">Sort: Title</option>
          <option value="level">Sort: Level</option>
          <option value="section">Sort: Section</option>
        </select>
        <select
          value={sortOrder}
          onChange={(e) => {
            setSortOrder(e.target.value as 'asc' | 'desc');
            setPage(1);
          }}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
        >
          <option value="asc">Ascending</option>
          <option value="desc">Descending</option>
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={unselectedVisible.length === 0 || addSelectionsMutation.isPending}
          onClick={() => addSelectionsMutation.mutate(unselectedVisible)}
          className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50"
        >
          Select Visible ({unselectedVisible.length})
        </button>
        <button
          type="button"
          disabled={selectedVisible.length === 0 || removeSelectionMutation.isPending}
          onClick={() => selectedVisible.forEach((controlId) => removeSelectionMutation.mutate(controlId))}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          Unselect Visible ({selectedVisible.length})
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center rounded-lg border border-slate-200 bg-white py-10">
          <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        </div>
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Failed to load security compliance controls.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 bg-white text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Select</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Control ID</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Title</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Level</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Section</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Assessment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {controls.length > 0 ? controls.map((control) => (
                <tr key={control.control_id} className={control.selected ? 'bg-blue-50/40' : 'bg-white'}>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={control.selected}
                      onChange={() => toggleSelection(control)}
                      className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                  </td>
                  <td className="px-3 py-2 font-medium text-slate-900">{control.ControlID || control.control_id}</td>
                  <td className="px-3 py-2 text-slate-700">{String(control.Title || '-')}</td>
                  <td className="px-3 py-2 text-slate-700">{String(control.Level || '-')}</td>
                  <td className="px-3 py-2 text-slate-700">{String(control.Section || '-')}</td>
                  <td className="px-3 py-2 text-slate-600">{String(control.Assessment || '-')}</td>
                </tr>
              )) : (
                <tr>
                  <td className="px-3 py-6 text-center text-slate-500" colSpan={6}>
                    No controls found for the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
        <span>
          Showing {controls.length === 0 ? 0 : (page - 1) * pageSize + 1}-{(page - 1) * pageSize + controls.length} of {total}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((prev) => Math.max(1, prev - 1))}
            disabled={page <= 1}
            className="rounded border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Previous
          </button>
          <span>Page {page} / {totalPages}</span>
          <button
            type="button"
            onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
            disabled={page >= totalPages}
            className="rounded border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Next
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
  isLoading,
  linkedControlIds,
  allControls,
}: {
  onClose: () => void;
  onLink: (controlId: number, coverageStatus: string) => void;
  isLinking: boolean;
  isLoading?: boolean;
  linkedControlIds: number[];
  allControls: Array<{ id: number | string; internal_id?: string; name: string; category?: string }>;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedControl, setSelectedControl] = useState<number | null>(null);
  const [coverageStatus, setCoverageStatus] = useState('partial');

  const filteredControls = allControls.filter((control) => {
    const matchesSearch = 
      control.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (control.internal_id && control.internal_id.toLowerCase().includes(searchTerm.toLowerCase()));
    const notLinked = !linkedControlIds.includes(Number(control.id));
    return matchesSearch && notLinked;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 p-4">
      <div className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Link Internal Control</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search internal controls..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="mb-4 max-h-64 overflow-y-auto rounded-lg border border-slate-200">
          {filteredControls.length > 0 ? (
            filteredControls.map((control) => (
              <button
                key={control.id}
                onClick={() => setSelectedControl(Number(control.id))}
                className={`flex w-full items-center gap-3 border-b border-slate-200 p-3 text-left last:border-0 ${
                  selectedControl === Number(control.id) ? 'bg-blue-50' : 'hover:bg-slate-50'
                }`}
              >
                <Shield className={`h-5 w-5 ${selectedControl === Number(control.id) ? 'text-blue-600' : 'text-slate-400'}`} />
                <div>
                  <span className="text-xs font-medium text-blue-600">{control.internal_id || control.id}</span>
                  <p className="text-sm font-medium text-slate-900">{control.name}</p>
                  {control.category && (
                    <span className="text-xs text-slate-500">{control.category}</span>
                  )}
                </div>
              </button>
            ))
          ) : (
            <div className="p-4 text-center text-sm text-slate-500">
              {isLoading ? (
                <span className="flex items-center justify-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading controls...</span>
              ) : allControls.length === 0 ? 'No controls available' : 'No controls found'}
            </div>
          )}
        </div>

        {selectedControl && (
          <div className="mb-4">
            <label className="mb-2 block text-xs font-medium text-slate-600">Coverage Status</label>
            <select
              value={coverageStatus}
              onChange={(e) => setCoverageStatus(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              <option value="full">Full Coverage</option>
              <option value="partial">Partial Coverage</option>
              <option value="planned">Planned</option>
            </select>
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={() => selectedControl && onLink(selectedControl, coverageStatus)}
            disabled={!selectedControl || isLinking}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isLinking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LinkIcon className="h-4 w-4" />
            )}
            Link Control
          </button>
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
  onLink: (evidenceId: number, relationshipType: string) => void;
  isLinking: boolean;
  linkedEvidenceIds: number[];
  allEvidence: Array<{ id: number | string; title?: string; name?: string; evidence_type?: string }>;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEvidence, setSelectedEvidence] = useState<number | null>(null);
  const [relationshipType, setRelationshipType] = useState('supports');

  const filteredEvidence = allEvidence.filter((evidence) => {
    const name = evidence.title || evidence.name || '';
    const matchesSearch = name.toLowerCase().includes(searchTerm.toLowerCase());
    const notLinked = !linkedEvidenceIds.includes(Number(evidence.id));
    return matchesSearch && notLinked;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 p-4">
      <div className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Link Evidence</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search evidence..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="mb-4 max-h-64 overflow-y-auto rounded-lg border border-slate-200">
          {filteredEvidence.length > 0 ? (
            filteredEvidence.map((evidence) => (
              <button
                key={evidence.id}
                onClick={() => setSelectedEvidence(Number(evidence.id))}
                className={`flex w-full items-center gap-3 border-b border-slate-200 p-3 text-left last:border-0 ${
                  selectedEvidence === Number(evidence.id) ? 'bg-blue-50' : 'hover:bg-slate-50'
                }`}
              >
                <FileCheck className={`h-5 w-5 ${selectedEvidence === Number(evidence.id) ? 'text-blue-600' : 'text-slate-400'}`} />
                <div>
                  <p className="text-sm font-medium text-slate-900">{evidence.title || evidence.name}</p>
                  {evidence.evidence_type && (
                    <span className="text-xs text-slate-500">{evidence.evidence_type}</span>
                  )}
                </div>
              </button>
            ))
          ) : (
            <div className="p-4 text-center text-sm text-slate-500">
              {allEvidence.length === 0 ? 'Loading evidence...' : 'No evidence found'}
            </div>
          )}
        </div>

        {selectedEvidence && (
          <div className="mb-4">
            <label className="mb-2 block text-xs font-medium text-slate-600">Relationship Type</label>
            <select
              value={relationshipType}
              onChange={(e) => setRelationshipType(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              <option value="supports">Supports</option>
              <option value="validates">Validates</option>
              <option value="documents">Documents</option>
            </select>
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={() => selectedEvidence && onLink(selectedEvidence, relationshipType)}
            disabled={!selectedEvidence || isLinking}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isLinking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LinkIcon className="h-4 w-4" />
            )}
            Link Evidence
          </button>
        </div>
      </div>
    </div>
  );
}

function LinkVulnerabilityModal({
  onClose,
  onLink,
  isLinking,
  linkedVulnerabilityIds,
  allVulnerabilities,
}: {
  onClose: () => void;
  onLink: (vulnId: number) => void;
  isLinking: boolean;
  linkedVulnerabilityIds: number[];
  allVulnerabilities: Array<{ id: number; vuln_id?: string; title?: string; severity?: string; status?: string }>;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedVulnId, setSelectedVulnId] = useState<number | null>(null);

  const filteredVulns = allVulnerabilities.filter((vuln) => {
    const name = `${vuln.vuln_id || ''} ${vuln.title || ''}`.toLowerCase();
    const matchesSearch = name.includes(searchTerm.toLowerCase());
    const notLinked = !linkedVulnerabilityIds.includes(vuln.id);
    return matchesSearch && notLinked;
  });

  const severityColors: Record<string, string> = {
    critical: 'text-red-400',
    high: 'text-orange-400',
    medium: 'text-yellow-400',
    low: 'text-green-400',
    info: 'text-slate-400',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 p-4">
      <div className="w-full max-w-2xl rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Link Vulnerability</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search vulnerabilities..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-4 text-sm text-slate-900 placeholder-slate-400 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="mb-4 max-h-64 overflow-y-auto rounded-lg border border-slate-200">
          {filteredVulns.length > 0 ? (
            filteredVulns.map((vuln) => (
              <button
                key={vuln.id}
                onClick={() => setSelectedVulnId(vuln.id)}
                className={`flex w-full items-center gap-3 border-b border-slate-200 p-3 text-left last:border-0 ${
                  selectedVulnId === vuln.id ? 'bg-blue-50' : 'hover:bg-slate-50'
                }`}
              >
                <Bug className={`h-5 w-5 ${selectedVulnId === vuln.id ? 'text-blue-600' : 'text-slate-400'}`} />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-blue-600">{vuln.vuln_id || `VULN-${vuln.id}`}</span>
                    <span className={`text-xs ${severityColors[(vuln.severity || '').toLowerCase()] || 'text-slate-500'}`}>
                      {vuln.severity || 'unknown'}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-slate-900">{vuln.title || 'Untitled vulnerability'}</p>
                  {vuln.status && (
                    <span className="text-xs text-slate-500">{vuln.status.replace(/_/g, ' ')}</span>
                  )}
                </div>
              </button>
            ))
          ) : (
            <div className="p-4 text-center text-sm text-slate-500">
              {allVulnerabilities.length === 0 ? 'Loading vulnerabilities...' : 'No vulnerabilities found'}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={() => selectedVulnId && onLink(selectedVulnId)}
            disabled={!selectedVulnId || isLinking}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isLinking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <LinkIcon className="h-4 w-4" />
            )}
            Link Vulnerability
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmModal({
  assetName,
  onClose,
  onConfirm,
  isDeleting,
}: {
  assetName: string;
  onClose: () => void;
  onConfirm: () => void;
  isDeleting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-50">
            <AlertTriangle className="h-5 w-5 text-red-600" />
          </div>
          <h2 className="text-sm font-semibold text-slate-900">Delete Asset</h2>
        </div>

        <p className="mb-6 text-sm text-slate-600">
          Are you sure you want to delete <strong className="text-slate-900">{assetName}</strong>? This action cannot be undone. All linked controls, evidence, and assessments will be unlinked.
        </p>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm text-white hover:bg-red-700 disabled:opacity-50"
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Delete Asset
          </button>
        </div>
      </div>
    </div>
  );
}
