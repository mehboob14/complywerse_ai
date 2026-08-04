'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'wouter'
import { useRouter } from '@/lib/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePermissions } from '@/hooks/usePermissions';
import { assetsApi, ermApi, evidenceApi, vulnManagementApi, compliancePluginsApi, riskPostureApi, apiClient } from '@/lib/api';
import type { ITAsset } from '@/types';
import { SearchInput, InlineLinkPicker } from '@/components/ui';
import HostApplicationsPanel from './_host-applications-panel';
import {
  ArrowLeft, Loader2, AlertCircle, Shield, DollarSign,
  Target, TrendingUp, FileCheck, AlertTriangle,
  ClipboardList, Plus, X, Trash2, Edit, RefreshCw,
  AppWindow, HardDrive, Database, Cloud, Building2,
  Lock, ShieldCheck, MapPin, User, Bug, Cpu, Play, ChevronDown, ChevronRight,
  Globe, Eye, Save, ShieldAlert, Plug
} from 'lucide-react';
import { Link } from 'wouter';

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

type TabType = 'details' | 'compliance' | 'controls' | 'evidence' | 'risks' | 'vulnerabilities';

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
  os_family?: string | null;
  os_version?: string | null;
  os_normalized?: string | null;
  asset_role?: string | null;
  parent_asset_id?: number | null;
  is_customer_facing?: boolean;
  is_internet_facing?: boolean;
  regulated_data_type?: string;
  operational_dependency?: string;
  business_impact_notes?: string | null;
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
> & {
  is_customer_facing?: boolean;
  is_internet_facing?: boolean;
  regulated_data_type?: string;
  operational_dependency?: string;
  business_impact_notes?: string | null;
};

// Map an app-asset's os_normalized (software_key) to the Connect Wizard
// platform card that handles its credential type.
// Returns null for app types that don't yet have a wizard card or that
// share the parent host's connection (e.g. unknown process-based apps).
function appOsToWizardPlatform(osNormalized: string | null | undefined): string | null {
  if (!osNormalized) return null;
  const k = osNormalized.toLowerCase();
  if (k.startsWith('postgresql')) return 'postgres';
  if (k.startsWith('mysql') || k.startsWith('mariadb')) return 'mysql';
  if (k.startsWith('mssql') || k.startsWith('sql-server')) return 'mssql';
  if (k.startsWith('oracle')) return 'oracle';
  if (k.startsWith('mongodb')) return 'mongodb';
  // Web servers / config-file scanners share the parent host's WinRM/SSH:
  // route to the appropriate host platform card.
  if (k.startsWith('iis')) return 'windows';
  if (k.startsWith('apache') || k.startsWith('nginx') || k.startsWith('tomcat')) return 'linux';
  return null;
}

export default function AssetDetailPage() {
  const params = useParams();
  const router = useRouter();
  const assetId = Number(params.id);
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('assets:asset_inventory:edit');
  const canDelete = hasPermission('assets:asset_inventory:delete');
  const [activeTab, setActiveTab] = useState<TabType>('details');
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

  // IP group composite score — live CIS compliance score for this asset's group
  const { data: ipPeers } = useQuery({
    queryKey: ['ip-peers', assetId],
    queryFn: async () => (await assetsApi.getIPPeers(assetId)).data,
    enabled: assetId > 0,
  });

  const { data: allControls, isLoading: controlsLoading } = useQuery({
    queryKey: ['asset-internal-controls'],
    queryFn: async () => {
      const response = await ermApi.internalControls.getAll();
      return response.data as Array<{ id: number; control_id?: string; name: string; category?: string }>;
    },
    enabled: activeTab === 'controls',
  });

  const { data: allEvidence, isLoading: evidenceLoading } = useQuery({
    queryKey: ['all-evidence'],
    queryFn: async () => {
      const response = await evidenceApi.getAll();
      return response.data;
    },
    enabled: activeTab === 'evidence',
  });

  const { data: allVulnerabilities, isLoading: vulnsLoading } = useQuery({
    queryKey: ['all-vulnerabilities'],
    queryFn: async () => {
      const response = await vulnManagementApi.vulnerabilities.getAll();
      return response.data as Array<{ id: number; vuln_id?: string; title?: string; severity?: string; status?: string }>;
    },
    enabled: activeTab === 'vulnerabilities',
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
    },
  });

  const linkEvidenceMutation = useMutation({
    mutationFn: (data: { evidence_id: number; relationship_type?: string }) =>
      assetsApi.linkEvidence(assetId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-detail', assetId] });
    },
  });

  const linkVulnerabilityMutation = useMutation({
    mutationFn: (vulnId: number) =>
      vulnManagementApi.assetLinks.create(vulnId, { asset_id: assetId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-detail', assetId] });
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
    { id: 'compliance', label: 'Compliance', icon: Cpu },
    { id: 'controls', label: 'Controls', icon: Shield },
    { id: 'evidence', label: 'Evidence', icon: FileCheck },
    { id: 'vulnerabilities', label: 'Vulnerabilities', icon: Bug },
    { id: 'risks', label: 'Risks', icon: AlertTriangle },
    // 'security-compliance' tab removed — it was wired to a static seed file
    // (CIS Windows Server 2012 R2) that ignored the strict matcher and showed
    // the same 363 controls on every asset regardless of OS. Real per-asset
    // benchmark view lives on /compliance/plugins/library and on the
    // Compliance tab above.
  ];

  return (
    <div className="assets-light space-y-4">
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
            {/* Connect button — only on app-assets (room-and-chair model).
                Routes to the Connect Wizard pre-selecting the right platform
                card for this app type (PostgreSQL → postgres card, etc.). */}
            {asset.asset_role === 'application' && (() => {
              const wizPlatform = appOsToWizardPlatform(asset.os_normalized);
              if (!wizPlatform) return null;
              const href = `/integrations/connect?platform=${wizPlatform}&asset_id=${asset.id}`;
              return (
                <Link
                  href={href}
                  className="flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs text-white hover:bg-emerald-700"
                  title={`Connect ${asset.name} — opens the Connect Wizard for ${wizPlatform}`}
                >
                  <Plug className="h-4 w-4" />
                  Connect
                </Link>
              );
            })()}
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
            <span className="text-sm font-medium">CIS Compliance</span>
          </div>
          {(() => {
            const composite = ipPeers?.composite;
            const ownScore = ipPeers?.group?.find((g: any) => g.is_self)?.score;
            const effective = composite?.effective_score;
            const hostScore = composite?.host_score;
            // Show individual score if available, effective if in a group
            const displayScore = effective ?? ownScore;
            if (displayScore == null) {
              return (
                <>
                  <div className="text-3xl font-bold text-slate-500">—</div>
                  <p className="mt-1 text-xs text-slate-500">Not yet scanned</p>
                  <Link href={`/risk-posture/asset/${assetId}`} className="mt-2 block text-xs text-blue-600 hover:underline">
                    Open risk posture →
                  </Link>
                </>
              );
            }
            const color = displayScore >= 80 ? 'text-green-600' : displayScore >= 60 ? 'text-yellow-600' : 'text-red-600';
            return (
              <>
                <div className={`text-3xl font-bold ${color}`}>{displayScore.toFixed(1)}%</div>
                {effective != null && hostScore != null && (
                  <p className="mt-1 text-xs text-slate-500">
                    Group effective · host {hostScore}%
                  </p>
                )}
                {composite?.weakest && composite.weakest.id !== assetId && (
                  <p className="mt-0.5 text-xs text-amber-600">
                    Weakest: {composite.weakest.name.split(' ')[0]} {composite.weakest.score}%
                  </p>
                )}
                <Link href={`/risk-posture/asset/${assetId}`} className="mt-2 block text-xs text-blue-600 hover:underline">
                  Full risk posture →
                </Link>
              </>
            );
          })()}
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
        {activeTab === 'compliance' && (
          <ComplianceTab asset={asset} />
        )}
        {activeTab === 'controls' && (
          <ControlsTab
            asset={asset}
            allControls={(allControls || []).map((c) => ({
              id: c.id,
              internal_id: c.control_id,
              name: c.name,
              category: c.category,
            }))}
            controlsLoading={controlsLoading}
            onLinkControl={(controlId) => linkControlMutation.mutate({
              internal_control_id: controlId,
              coverage_status: 'partial',
            })}
            isLinkingControl={linkControlMutation.isPending}
            onUnlinkInternalControl={(linkId) => unlinkInternalControlMutation.mutate(linkId)}
            onUnlinkFrameworkControl={(linkId) => unlinkFrameworkControlMutation.mutate(linkId)}
            isUnlinkingInternal={unlinkInternalControlMutation.isPending}
            isUnlinkingFramework={unlinkFrameworkControlMutation.isPending}
          />
        )}
        {activeTab === 'evidence' && (
          <EvidenceTab
            asset={asset}
            allEvidence={allEvidence || []}
            evidenceLoading={evidenceLoading}
            onLinkEvidence={(evidenceId) => linkEvidenceMutation.mutate({
              evidence_id: evidenceId,
              relationship_type: 'supports',
            })}
            isLinking={linkEvidenceMutation.isPending}
            onUnlinkEvidence={(linkId) => unlinkEvidenceMutation.mutate(linkId)}
            isUnlinking={unlinkEvidenceMutation.isPending}
          />
        )}
        {activeTab === 'vulnerabilities' && (
          <VulnerabilitiesTab
            asset={asset}
            allVulnerabilities={allVulnerabilities || []}
            vulnsLoading={vulnsLoading}
            onLinkVulnerability={(vulnId) => linkVulnerabilityMutation.mutate(vulnId)}
            isLinking={linkVulnerabilityMutation.isPending}
            onUnlinkVulnerability={(vulnId) => unlinkVulnerabilityMutation.mutate(vulnId)}
            isUnlinking={unlinkVulnerabilityMutation.isPending}
          />
        )}
        {activeTab === 'risks' && (
          <RisksTab asset={asset} />
        )}
        {/* 'security-compliance' tab removed — see comment above */}
      </div>

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

function ComplianceTab({ asset }: { asset: AssetDetailData }) {
  // Compliverse onboards assets via the bank's CMDB API (we do not do
  // network discovery). For each onboarded asset we DO run CIS compliance
  // rules — that's our core job. This tab combines four blocks:
  //   1. AI Classification — OS profile from the asset feed
  //   2. AI verdict — how many of the 4854 library rules apply
  //   3. Funnel visualization — regex stage → AI stage → applicable
  //   4. Scan controls + Recent runs — execute the applicable rules,
  //      see pass/fail history

  const queryClient = useQueryClient();
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);

  const previewQuery = useQuery({
    queryKey: ['compliance-plugins', 'match-preview', asset.id],
    queryFn: () => compliancePluginsApi.matchPreview(asset.id).then((r: any) => r.data),
    // Benchmark library is stable — cache for 15 min so returning to this
    // tab doesn't re-scan all 4855 plugins on every visit.
    staleTime: 15 * 60 * 1000,
  });

  const reDetectMut = useMutation({
    mutationFn: () => compliancePluginsApi.reDetectAssetOs(asset.id).then((r: any) => r.data),
    onSuccess: (data: any) => {
      const changed = data?.any_changed;
      const a = data?.after || {};
      setToast({
        kind: 'success',
        message: changed
          ? `OS refreshed. Normalized: ${a.os_normalized || 'unknown'}${a.os_build ? ' (' + a.os_build + ')' : ''}${a.os_edition ? ' ' + a.os_edition : ''}`
          : `OS already up to date: ${a.os_normalized || 'unknown'}`,
      });
      queryClient.invalidateQueries({ queryKey: ['compliance-plugins', 'match-preview', asset.id] });
      queryClient.invalidateQueries({ queryKey: ['assets', asset.id] });
    },
    onError: (e: any) => setToast({ kind: 'error', message: e?.response?.data?.detail || e?.message || 'Re-detect failed' }),
  });

  const runsQuery = useQuery({
    queryKey: ['compliance-plugins', 'runs', asset.id],
    // 1000 covers 2+ full scan sessions even for assets with 400+ CIS rules.
    // Reduced from 3000 — the UI only shows the latest sessions anyway.
    queryFn: () => compliancePluginsApi.listRuns({ asset_id: asset.id, limit: 1000 }).then((r: any) => r.data),
    // 1-minute stale window — re-visits within the same minute are instant.
    staleTime: 60 * 1000,
  });

  // Live progress polling — scan-all is synchronous on the backend so
  // the response only comes back after every rule has run. While it's
  // blocked, we poll /runs every 2s and count new rows since scan start
  // to surface "X of Y rules done" instead of a blank spinner.
  const [scanProgress, setScanProgress] = useState<{
    running: boolean;
    startedAt?: number;
    done: number;
    total: number;
  }>({ running: false, done: 0, total: 0 });

  const scanMutation = useMutation({
    mutationFn: async () => {
      const total = applicable.count ?? 0;
      const startedAt = Date.now();
      // Capture the max run-id BEFORE we kick off the scan so we can
      // count "runs created since scan start" by simple subtraction.
      // Timezone-safe (no Date string parsing).
      let baselineMaxId = 0;
      try {
        const pre = await compliancePluginsApi.listRuns({ asset_id: asset.id, limit: 1 });
        const preList = Array.isArray(pre.data) ? pre.data : (pre.data?.runs || []);
        baselineMaxId = preList[0]?.id ?? 0;
      } catch { /* first-ever scan — baseline stays 0 */ }
      setScanProgress({ running: true, startedAt, done: 0, total });

      const interval = setInterval(async () => {
        try {
          // Fetch just the single most-recent run; sequential IDs let us
          // approximate "done = currentMaxId - baselineMaxId" without
          // pulling hundreds of rows every 2 s.
          const r = await compliancePluginsApi.listRuns({ asset_id: asset.id, limit: 1 });
          const list = Array.isArray(r.data) ? r.data : (r.data?.runs || []);
          const currentMaxId = list[0]?.id ?? baselineMaxId;
          const done = Math.max(0, currentMaxId - baselineMaxId);
          setScanProgress((prev) => prev.running ? { ...prev, done } : prev);
        } catch { /* transient — ignore */ }
      }, 2000);
      try {
        // Fire-and-forget push to any installed agent bound to this asset
        // so its long-poll returns immediately. Server-side scan-all
        // continues in parallel — whichever path produces results first
        // wins. (Backend dedupes by plugin_id + asset + timestamp.)
        apiClient.post(`/agents/scan-now-push/${asset.id}`).catch(() => { /* no agent installed — fine */ });
        const resp = await compliancePluginsApi.scanAll({ asset_id: asset.id });
        return resp.data;
      } finally {
        clearInterval(interval);
        setScanProgress((prev) => ({ ...prev, running: false }));
      }
    },
    onSuccess: (data: any) => {
      const executed = data?.runs?.length ?? data?.executed ?? 0;
      const skippedVer = data?.skipped_wrong_os_version ?? 0;
      const skippedAi = data?.skipped_ai_refinement ?? 0;
      setToast({
        kind: 'success',
        message: `Scan complete. ${executed} run(s) finished. Skipped ${skippedVer} wrong-OS, ${skippedAi} AI-refined.`,
      });
      queryClient.invalidateQueries({ queryKey: ['compliance-plugins', 'runs', asset.id] });
      queryClient.invalidateQueries({ queryKey: ['compliance-plugins', 'match-preview', asset.id] });
    },
    onError: (e: any) => setToast({ kind: 'error', message: e?.response?.data?.detail || e?.message || 'Scan failed' }),
  });

  const runs = Array.isArray(runsQuery.data) ? runsQuery.data : (runsQuery.data?.runs || []);
  const lastRun = runs[0];
  const formatTime = (iso?: string | null) => {
    if (!iso) return '-';
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  };
  // Each run = ONE CIS check executed. Backend stores its outcome as
  // `status` (passed | failed | error | running) — not a pass/fail count.
  const passFailBadge = (run: any) => {
    const status = (run.status || '').toLowerCase();
    if (status === 'running' || status === 'pending') {
      return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700"><Loader2 className="h-3 w-3 animate-spin" />Running</span>;
    }
    if (status === 'passed') {
      return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">✓ Passed</span>;
    }
    if (status === 'failed') {
      return <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">✗ Failed</span>;
    }
    if (status === 'error') {
      return <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-xs text-orange-700">⚠ Error</span>;
    }
    return <span className="inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-0.5 text-xs text-gray-700">{status || 'unknown'}</span>;
  };

  // Map run-shape → plugin label / duration. Backend returns plugin_title,
  // plugin_key, duration_ms — not the names my old code guessed.
  const pluginLabel = (run: any): string => {
    if (run.plugin_title) return run.plugin_title;
    if (run.plugin_name) return run.plugin_name;
    if (run.plugin?.title) return run.plugin.title;
    if (run.plugin_key) return run.plugin_key;
    return `#${run.plugin_id}`;
  };

  const fmtDuration = (run: any): string => {
    const ms = run.duration_ms ?? (run.duration_seconds ? run.duration_seconds * 1000 : null);
    if (ms == null) return '-';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const preview = previewQuery.data || {};
  const stage1 = preview.stage1_regex || {};
  const stage2 = preview.stage2_ai || {};
  const applicable = preview.applicable || {};
  const total = preview.total_plugins ?? 0;

  const osFamily = asset.os_family || preview.asset?.os_family || null;
  const osVersion = asset.os_version || preview.asset?.os_version || null;
  const osNormalized = asset.os_normalized || preview.asset?.os_normalized || null;
  const criticality = asset.criticality || null;

  const Pct = ({ num, denom }: { num: number; denom: number }) => {
    if (!denom) return <span className="text-slate-400">-</span>;
    return <span className="text-[10px] text-slate-500">({Math.round((num / denom) * 100)}%)</span>;
  };

  const ExampleList = ({ items, emptyText }: { items?: Array<any>; emptyText: string }) => {
    if (!items || items.length === 0) return <div className="text-xs italic text-slate-400">{emptyText}</div>;
    return (
      <ul className="space-y-1">
        {items.map((it: any, i: number) => (
          <li key={i} className="text-xs text-slate-600">
            <span className="font-mono text-[10px] text-slate-500">{it.rule_id}</span>{' '}
            <span>{it.title}</span>
            {it.benchmark && <div className="ml-0 mt-0.5 truncate text-[10px] text-slate-400">{it.benchmark}</div>}
          </li>
        ))}
      </ul>
    );
  };

  if (previewQuery.isLoading) {
    return <div className="flex items-center gap-2 p-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Running AI rule classification…</div>;
  }

  if (previewQuery.isError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        Couldn't load the rule classification. Try refreshing.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Host → Applications ("room and chair"): composite posture,
          protected children, detected software awaiting promotion.
          Renders nothing for assets with no children + no inventory. */}
      <HostApplicationsPanel assetId={asset.id} />

      {/* AI Classification panel — OS data from the asset API. */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Cpu className="h-4 w-4 text-blue-600" /> AI Classification
              </h3>
              <p className="mt-1 text-xs text-slate-500">
                {preview.asset?.os_knowledge?.display_name || 'OS profile received from your asset feed'}
              </p>
            </div>
            <button
              onClick={() => reDetectMut.mutate()}
              disabled={reDetectMut.isPending}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              title="Re-probe this asset's OS via its stored connection"
            >
              {reDetectMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Cpu className="h-3 w-3" />}
              Re-detect OS
            </button>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-slate-500">Family</dt>
              <dd className="mt-0.5 font-medium text-slate-900">{preview.asset?.os_knowledge?.family || osFamily || <span className="text-slate-400">unknown</span>}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Product</dt>
              <dd className="mt-0.5 font-medium text-slate-900">{preview.asset?.os_knowledge?.product || <span className="text-slate-400">-</span>}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Build</dt>
              <dd className="mt-0.5 font-medium text-slate-900">
                {preview.asset?.os_knowledge?.build || <span className="text-slate-400">family-level</span>}
              </dd>
            </div>
            <div>
              <dt className="text-slate-500">Criticality</dt>
              <dd className="mt-0.5 font-medium capitalize text-slate-900">{criticality || '-'}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-slate-500">Version string</dt>
              <dd className="mt-0.5 text-slate-800">{osVersion || <span className="text-slate-400">unknown</span>}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-slate-500">Normalized key</dt>
              <dd className="mt-0.5 font-mono text-xs text-slate-700">{osNormalized || <span className="font-sans text-slate-400">unknown</span>}</dd>
            </div>
            {preview.asset?.os_knowledge?.eol_year && (
              <div className="col-span-2">
                <dt className="text-slate-500">Support window</dt>
                <dd className={`mt-0.5 text-xs ${preview.asset.os_knowledge.is_supported ? 'text-emerald-700' : 'text-red-700'}`}>
                  {preview.asset.os_knowledge.is_supported ? 'Supported' : 'End-of-life'} · EOL {preview.asset.os_knowledge.eol_year}
                </dd>
              </div>
            )}
          </dl>
        </div>

        <div className="rounded-lg border border-slate-200 bg-gradient-to-br from-indigo-50 to-blue-50 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <ClipboardList className="h-4 w-4 text-indigo-600" /> Matched benchmark
          </h3>
          <p className="mt-1 text-xs text-slate-500">Of {total.toLocaleString()} CIS rules in the library</p>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-4xl font-bold text-slate-900">{applicable.count ?? 0}</span>
            <span className="text-xs text-slate-600">apply to this asset</span>
          </div>
          {stage2.primary_benchmark ? (
            <div className="mt-2 rounded-md border border-indigo-200 bg-white px-2 py-1.5 text-xs">
              <div className="text-slate-500">Primary benchmark</div>
              <div className="mt-0.5 font-medium text-slate-900">{stage2.primary_benchmark}</div>
            </div>
          ) : !osNormalized ? (
            <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
              OS not in feed yet. Once the asset API delivers OS data, the matcher will populate.
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Benchmark resolution trace ────────────────────────────────────
          Single-stage strict matcher. Shows the actual decision: asset OS
          key → mapped pattern → benchmark name, with the mapping row's
          provenance (scope, priority, mapping_id). Replaces the legacy
          two-stage "Regex / AI router" funnel — there is only one stage
          now and the previous UI was lying about the second one.        */}
      {(() => {
        const mm = preview.matcher_mapping || {};
        const mode = preview.matcher_mode || '';
        const isStrict = mode === 'strict_single_stage';
        const benchmark = mm.benchmark_name || stage2.primary_benchmark || null;
        const pattern = mm.os_pattern || null;
        const scope = mm.scope || null;
        const mappingId = mm.mapping_id || null;
        const candidates = stage1.kept ?? 0;
        const skipped = stage1.skipped ?? 0;
        const applicableN = applicable.count ?? 0;

        return (
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                  <Cpu className="h-4 w-4 text-indigo-600" /> Benchmark resolution
                </h3>
                <p className="mt-0.5 text-xs text-slate-500">
                  {isStrict
                    ? 'Strict single-stage match: asset OS → operator-confirmed mapping → benchmark. No family-walk, no AI guess.'
                    : 'Mode: ' + (mode || 'unknown')}
                </p>
              </div>
              {isStrict && (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">
                  Strict
                </span>
              )}
            </div>

            {/* Mapping chain */}
            {benchmark ? (
              <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded border border-slate-300 bg-white px-2 py-1 font-mono text-slate-800">
                    {osNormalized || '—'}
                  </span>
                  <span className="text-slate-400">matches pattern</span>
                  <span className="rounded border border-slate-300 bg-white px-2 py-1 font-mono text-slate-800">
                    {pattern || '—'}
                  </span>
                  <span className="text-slate-400">→</span>
                  <span className="rounded border border-indigo-200 bg-white px-2 py-1 font-medium text-indigo-900">
                    {benchmark}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                  {scope && (
                    <span>
                      <span className="text-slate-400">scope</span>{' '}
                      <span className="font-medium text-slate-700">{scope}</span>
                    </span>
                  )}
                  {mappingId && (
                    <span>
                      <span className="text-slate-400">mapping_id</span>{' '}
                      <span className="font-mono text-slate-700">#{mappingId}</span>
                    </span>
                  )}
                  <span>
                    <span className="text-slate-400">archived benchmarks</span>{' '}
                    <span className="font-medium text-slate-700">never picked</span>
                  </span>
                </div>
              </div>
            ) : (
              // Gap B — actionable no-mapping callout. Three distinct
              // failure modes get distinct copy so the operator knows
              // which lever to pull:
              //   (a) OS is unknown — asset has no os_normalized at all
              //       (manual create with no os_version, or AI normaliser
              //       returned null). Suggest "Re-detect OS" or edit.
              //   (b) OS is known but no mapping row covers it — operator
              //       hasn't wired this OS family to a benchmark yet.
              //       Offer "Suggest mapping (AI)" + "Add mapping manually".
              <NoMappingCallout
                osNormalized={osNormalized}
                assetId={asset.id}
              />
            )}

            {/* Numbers strip */}
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <div className="rounded border border-slate-200 bg-white p-2.5">
                <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Library total</div>
                <div className="mt-0.5 text-xl font-semibold text-slate-900">{total.toLocaleString()}</div>
                <p className="text-[11px] text-slate-500">approved CIS plugins</p>
              </div>
              <div className="rounded border border-indigo-200 bg-indigo-50/40 p-2.5">
                <div className="text-[10px] font-medium uppercase tracking-wide text-indigo-700">From matched benchmark</div>
                <div className="mt-0.5 text-xl font-semibold text-indigo-900">{candidates.toLocaleString()}</div>
                <p className="text-[11px] text-slate-500">{skipped.toLocaleString()} from other benchmarks skipped</p>
              </div>
              <div className="rounded border border-emerald-200 bg-emerald-50/40 p-2.5">
                <div className="text-[10px] font-medium uppercase tracking-wide text-emerald-700">Applicable to scan</div>
                <div className="mt-0.5 text-xl font-semibold text-emerald-900">{applicableN.toLocaleString()}</div>
                <p className="text-[11px] text-slate-500">
                  {total > 0 ? `${Math.round((applicableN / total) * 100)}% of library` : '—'}
                </p>
              </div>
            </div>

            {/* Sample rules from the matched benchmark */}
            {Array.isArray(stage1.examples_kept) && stage1.examples_kept.length > 0 && (
              <div className="mt-3 border-t border-slate-200 pt-3">
                <div className="mb-1 flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  <span>Sample rules from this benchmark</span>
                  <span className="text-slate-400">{stage1.examples_kept.length}</span>
                </div>
                <div className="max-h-72 overflow-y-auto pr-1">
                  <ExampleList items={stage1.examples_kept} emptyText="—" />
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Final applicable list */}
      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Applicable rules</h3>
            <p className="text-xs text-slate-500">Sample of what will appear when scan results arrive via the asset API</p>
          </div>
          <span className="text-xs font-medium text-slate-700">{applicable.count ?? 0} total</span>
        </div>
        {/* Scroll container so a 449-rule list doesn't extend off-screen.
            max-h-96 ≈ 24rem fits ~15 rules comfortably; the rest scroll. */}
        <div className="max-h-96 overflow-y-auto p-4">
          <ExampleList items={applicable.examples} emptyText="No applicable rules until OS data lands." />
        </div>
      </div>

      {toast && (
        <div className={`rounded-lg border p-3 text-xs ${toast.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-red-200 bg-red-50 text-red-800'}`}>
          {toast.message}
          <button onClick={() => setToast(null)} className="float-right text-xs underline">dismiss</button>
        </div>
      )}

      {/* Scan controls — execute the applicable rules (the ones the AI funnel above kept). */}
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Play className="h-4 w-4 text-emerald-600" /> Compliance scan
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              {applicable.count ?? 0} applicable rules. Last scan: {formatTime(lastRun?.started_at || lastRun?.created_at)}.
              {' '}Scans run automatically — agent every 30s when installed, or via your scheduled cron.
              {' '}You can also force one immediately with the button on the right.
            </p>
          </div>
          {/* Manual "Scan now" trigger — the auto-cadence above is the
              steady state, but operators want a button when investigating
              a specific issue or after a config change. Gated by applicable
              count (zero rules → button disabled with explanation). */}
          <button
            type="button"
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending || scanProgress.running || (applicable.count ?? 0) === 0}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
            title={
              (applicable.count ?? 0) === 0
                ? 'No applicable CIS rules yet — onboard OS data first.'
                : scanProgress.running
                  ? 'A scan is already running on this asset.'
                  : `Run all ${applicable.count} applicable rules against this asset now.`
            }
          >
            {scanProgress.running || scanMutation.isPending ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Scanning…
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" />
                Scan now
              </>
            )}
          </button>
        </div>

        {/* Live progress bar — polls /runs every 2s while scan-all is in flight */}
        {scanProgress.running && scanProgress.total > 0 && (() => {
          const shown = Math.min(scanProgress.done, scanProgress.total);
          const pct = Math.min(100, Math.round((shown / scanProgress.total) * 100));
          return (
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-slate-700">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3 w-3 animate-spin text-blue-600" />
                  Scanning <strong>{shown}</strong> of <strong>{scanProgress.total}</strong> rules…
                </span>
                <span className="font-mono text-slate-500">
                  {pct}%
                  {scanProgress.startedAt && (
                    <span className="ml-2 text-slate-400">
                      {Math.round((Date.now() - scanProgress.startedAt) / 1000)}s elapsed
                    </span>
                  )}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-[10px] text-slate-500">
                Backend opens a WinRM/SSH session per rule and stores each result. You can leave this tab — runs continue server-side.
              </p>
            </div>
          );
        })()}
      </div>

      {/* Scan sessions — group runs by time proximity into expandable sessions */}
      <ScanSessions
        runs={runs}
        isLoading={runsQuery.isLoading}
        passFailBadge={passFailBadge}
        pluginLabel={pluginLabel}
        fmtDuration={fmtDuration}
        formatTime={formatTime}
      />
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
        Compliverse onboards assets through the bank's CMDB API — we don't probe the network. Once an asset is here, the AI classifier above picks the right CIS rules and they execute automatically on the next agent tick (or scheduled cron).
      </div>
    </div>
  );
}

// ── Gap B — actionable "no mapping" callout ────────────────────────────
// Replaces the previous dead-end amber strip. Distinguishes the two
// reasons a benchmark didn't resolve and offers the right next step for
// each. Suggestions come from the AI mapping suggester via the existing
// /benchmark-mappings/suggest-for-asset/{id} endpoint.
function NoMappingCallout({
  osNormalized,
  assetId,
}: {
  osNormalized: string | null;
  assetId: number;
}) {
  const [suggestion, setSuggestion] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchSuggestion = async () => {
    setLoading(true);
    setErr(null);
    try {
      const { compliancePluginsApi } = await import('@/lib/api');
      const r = await compliancePluginsApi.suggestMappingForAsset(assetId);
      setSuggestion(r.data || null);
    } catch (e: any) {
      setErr(e?.response?.data?.detail || e?.message || 'Suggestion failed');
    } finally {
      setLoading(false);
    }
  };

  // Case 1 — OS itself is unknown. Nothing for the mapping suggester to
  // chew on. Direct the operator at OS classification first.
  if (!osNormalized) {
    return (
      <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3">
        <div className="text-xs font-semibold text-amber-900">
          OS not classified
        </div>
        <p className="mt-1 text-xs text-amber-800">
          This asset has no normalized OS key, so the strict matcher can't
          resolve a benchmark. Use{' '}
          <strong>Re-detect OS</strong> on the AI Classification panel
          above (requires a stored connection), or open the asset Edit
          dialog and set <code className="font-mono">os_version</code> +{' '}
          <code className="font-mono">os_normalized</code> manually.
        </p>
      </div>
    );
  }

  // Case 2 — OS known but no mapping row covers it. Offer AI suggestion.
  return (
    <div className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold text-amber-900">
            No benchmark mapped for{' '}
            <span className="font-mono">{osNormalized}</span>
          </div>
          <p className="mt-1 text-xs text-amber-800">
            The strict matcher needs an{' '}
            <code className="font-mono">os_pattern → benchmark_name</code>{' '}
            row covering this OS. Add one in admin, or have AI suggest one
            from the ingested benchmark library.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={fetchSuggestion}
            disabled={loading}
            className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
          >
            {loading ? 'Asking AI…' : 'Suggest mapping (AI)'}
          </button>
          <Link
            href="/compliance/plugins/library?tab=mappings"
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Add manually
          </Link>
        </div>
      </div>

      {err && (
        <div className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700">
          {err}
        </div>
      )}

      {suggestion && (
        <div className="mt-3 rounded-md border border-amber-200 bg-white p-2.5">
          <div className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
            AI suggestion · confidence{' '}
            <span className="font-semibold">
              {suggestion.confidence || '?'}
            </span>
          </div>
          {suggestion.benchmark_name ? (
            <>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded border border-slate-300 bg-slate-50 px-2 py-1 font-mono text-slate-800">
                  {osNormalized}
                </span>
                <span className="text-slate-400">→</span>
                <span className="rounded border border-indigo-200 bg-indigo-50 px-2 py-1 font-medium text-indigo-900">
                  {suggestion.benchmark_name}
                </span>
              </div>
              {suggestion.reasoning && (
                <p className="mt-1.5 text-[11px] italic text-slate-600">
                  {suggestion.reasoning}
                </p>
              )}
              <p className="mt-2 text-[11px] text-slate-500">
                Review and accept this mapping in{' '}
                <Link
                  href="/compliance/plugins/library?tab=mappings"
                  className="text-indigo-600 underline"
                >
                  admin → mappings
                </Link>
                . Per anti-hallucination policy, AI never auto-applies — an
                operator must confirm.
              </p>
            </>
          ) : (
            <p className="mt-1 text-xs text-slate-700">
              AI couldn't pick a benchmark with confidence. Most likely the
              required benchmark PDF hasn't been ingested yet — upload it
              via{' '}
              <Link
                href="/compliance/plugins/library?tab=ingest"
                className="text-indigo-600 underline"
              >
                Rules library → Ingest
              </Link>{' '}
              and the suggester will pick it up next time.
            </p>
          )}
        </div>
      )}
    </div>
  );
}


function DetailsTab({ asset }: { asset: AssetDetailData }) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-3 text-xs text-slate-700">
        Business Context lives on the asset's dedicated risk page —{' '}
        <Link href={`/risk-posture/asset/${asset.id}`} className="font-medium text-blue-700 hover:underline">
          open Risk Posture →
        </Link>
      </div>
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
    </div>
  );
}

function ControlsTab({
  asset,
  allControls,
  controlsLoading,
  onLinkControl,
  isLinkingControl,
  onUnlinkInternalControl,
  onUnlinkFrameworkControl,
  isUnlinkingInternal,
  isUnlinkingFramework,
}: {
  asset: AssetDetailData;
  allControls: Array<{ id: number | string; internal_id?: string; name: string; category?: string }>;
  controlsLoading: boolean;
  onLinkControl: (controlId: number) => void;
  isLinkingControl: boolean;
  onUnlinkInternalControl: (linkId: number) => void;
  onUnlinkFrameworkControl: (linkId: number) => void;
  isUnlinkingInternal: boolean;
  isUnlinkingFramework: boolean;
}) {
  const linkedControlIds = asset.linked_internal_controls?.map((c) => c.internal_control_id) || [];
  const controlPickerItems = allControls
    .filter((c) => !linkedControlIds.includes(Number(c.id)))
    .map((c) => ({
      value: String(c.id),
      label: c.internal_id ? `${c.internal_id} — ${c.name}` : c.name,
      subLabel: c.category,
    }));
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
        <InlineLinkPicker
          triggerLabel="Link Control"
          items={controlPickerItems}
          isLoading={controlsLoading || isLinkingControl}
          emptyText="No controls available"
          searchPlaceholder="Search controls"
          onSelect={(value) => onLinkControl(Number(value))}
        />
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
          <div className="mt-4">
            <InlineLinkPicker
              triggerLabel="Link First Control"
              triggerClassName="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
              items={controlPickerItems}
              isLoading={controlsLoading || isLinkingControl}
              emptyText="No controls available"
              searchPlaceholder="Search controls"
              onSelect={(value) => onLinkControl(Number(value))}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function EvidenceTab({
  asset,
  allEvidence,
  evidenceLoading,
  onLinkEvidence,
  isLinking,
  onUnlinkEvidence,
  isUnlinking,
}: {
  asset: AssetDetailData;
  allEvidence: Array<{ id: number | string; title?: string; name?: string; evidence_type?: string }>;
  evidenceLoading: boolean;
  onLinkEvidence: (evidenceId: number) => void;
  isLinking: boolean;
  onUnlinkEvidence: (linkId: number) => void;
  isUnlinking: boolean;
}) {
  const relationshipColors: Record<string, string> = {
    supports: 'border-green-200 bg-green-50 text-green-700',
    validates: 'border-blue-200 bg-blue-50 text-blue-700',
    documents: 'border-purple-200 bg-purple-50 text-purple-700',
  };

  const linkedEvidenceIds = asset.linked_evidence?.map((e) => e.evidence_id) || [];
  const evidencePickerItems = allEvidence
    .filter((e) => !linkedEvidenceIds.includes(Number(e.id)))
    .map((e) => ({
      value: String(e.id),
      label: e.title || e.name || `Evidence #${e.id}`,
      subLabel: e.evidence_type,
    }));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <FileCheck className="h-4 w-4 text-blue-600" />
          Linked Evidence ({asset.linked_evidence?.length || 0})
        </h3>
        <InlineLinkPicker
          triggerLabel="Link Evidence"
          items={evidencePickerItems}
          isLoading={evidenceLoading || isLinking}
          emptyText="No evidence available"
          searchPlaceholder="Search evidence"
          onSelect={(value) => onLinkEvidence(Number(value))}
        />
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
          <div className="mt-4">
            <InlineLinkPicker
              triggerLabel="Link First Evidence"
              triggerClassName="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
              items={evidencePickerItems}
              isLoading={evidenceLoading || isLinking}
              emptyText="No evidence available"
              searchPlaceholder="Search evidence"
              onSelect={(value) => onLinkEvidence(Number(value))}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function VulnerabilitiesTab({
  asset,
  allVulnerabilities,
  vulnsLoading,
  onLinkVulnerability,
  isLinking,
  onUnlinkVulnerability,
  isUnlinking,
}: {
  asset: AssetDetailData;
  allVulnerabilities: Array<{ id: number; vuln_id?: string; title?: string; severity?: string; status?: string }>;
  vulnsLoading: boolean;
  onLinkVulnerability: (vulnId: number) => void;
  isLinking: boolean;
  onUnlinkVulnerability: (vulnId: number) => void;
  isUnlinking: boolean;
}) {
  const linkedVulnIds = asset.linked_vulnerabilities?.map((v) => v.vulnerability_id) || [];
  const vulnPickerItems = allVulnerabilities
    .filter((v) => !linkedVulnIds.includes(v.id))
    .map((v) => {
      const code = v.vuln_id || `VULN-${v.id}`;
      const title = v.title || 'Untitled vulnerability';
      const sev = v.severity ? ` · ${v.severity}` : '';
      return {
        value: String(v.id),
        label: `${code} — ${title}`,
        subLabel: `${(v.status || '').replace(/_/g, ' ')}${sev}`.trim() || undefined,
      };
    });
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
        <InlineLinkPicker
          triggerLabel="Link Vulnerability"
          triggerClassName="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
          items={vulnPickerItems}
          isLoading={vulnsLoading || isLinking}
          emptyText="No vulnerabilities available"
          searchPlaceholder="Search vulnerabilities"
          onSelect={(value) => onLinkVulnerability(Number(value))}
          popoverWidth={380}
        />
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
          <div className="mt-4">
            <InlineLinkPicker
              triggerLabel="Link First Vulnerability"
              triggerClassName="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
              items={vulnPickerItems}
              isLoading={vulnsLoading || isLinking}
              emptyText="No vulnerabilities available"
              searchPlaceholder="Search vulnerabilities"
              onSelect={(value) => onLinkVulnerability(Number(value))}
              popoverWidth={380}
            />
          </div>
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

// SecurityComplianceTab removed — its backend was hardcoded to a static
// WS2012R2 seed JSON and ignored the strict OS→benchmark matcher, so every
// asset showed the same 363 Windows Server 2012 R2 controls regardless of
// OS. Real per-asset rule view now lives only at /compliance/plugins/library
// and on the Compliance tab above. Selection state for the removed surface
// was never written to (operators used /compliance/plugins/library instead).


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

// --- ScanSessions: group runs into scan sessions ---
function ScanSessions({
  runs, isLoading, passFailBadge, pluginLabel, fmtDuration, formatTime,
}: {
  runs: any[];
  isLoading: boolean;
  passFailBadge: (r: any) => React.ReactNode;
  pluginLabel: (r: any) => string;
  fmtDuration: (r: any) => string;
  formatTime: (iso?: string | null) => string;
}) {
  const [openSessions, setOpenSessions] = useState<Set<string>>(new Set([]));
  const [hasInteracted, setHasInteracted] = useState(false);
  const [filter, setFilter] = useState<'all' | 'failed' | 'error' | 'passed' | 'running'>('all');

  const sessions = useMemo(() => {
    if (!runs || runs.length === 0) return [];
    const sorted = [...runs].sort((a, b) => {
      const ta = new Date(a.started_at || a.created_at || 0).getTime() || (a.id ?? 0);
      const tb = new Date(b.started_at || b.created_at || 0).getTime() || (b.id ?? 0);
      return tb - ta;
    });
    // 5-minute gap between consecutive runs starts a new session. The
    // earlier code compared against `current.startedAt` (the first run in
    // the group) and used a 60s threshold, which capped every session at
    // 60s of wall-clock — slicing one 12-minute Scan-all into 12 fake
    // sessions. Compare against the previously-added run instead.
    const GAP_MS = 5 * 60 * 1000;
    const groups: { id: string; runs: any[]; startedAt: number; endedAt: number }[] = [];
    let current: typeof groups[0] | null = null;
    let prevT = 0;
    for (const r of sorted) {
      const t = new Date(r.started_at || r.created_at || 0).getTime();
      if (!current || (prevT - t) > GAP_MS) {
        current = { id: 's-' + r.id, runs: [r], startedAt: t, endedAt: t };
        groups.push(current);
      } else {
        current.runs.push(r);
        current.endedAt = Math.min(current.endedAt, t);
        current.startedAt = Math.max(current.startedAt, t);
      }
      prevT = t;
    }
    return groups;
  }, [runs]);

  const toggle = (id: string) => {
    setOpenSessions(prev => {
      // First click after mount: prev is empty (initial useState) but
      // `effectiveOpen` is auto-opening the first session. Toggle from
      // the user's POV, which is what they SEE — so on first interaction
      // we seed from {firstId} (matches effectiveOpen) before flipping.
      // Otherwise the first click on the auto-opened session is a
      // no-op (would re-add firstId to an empty set).
      const startingSet = hasInteracted
        ? prev
        : (firstId ? new Set<string>([firstId]) : new Set<string>());
      const next = new Set(startingSet);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setHasInteracted(true);
  };

  if (isLoading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 text-xs text-slate-500">
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading runs...
      </div>
    );
  }
  if (sessions.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-xs text-slate-500">
        No scans yet. Results will appear here on the next agent tick or scheduled scan.
      </div>
    );
  }

  const firstId = sessions[0]?.id;
  // Auto-open the first session on initial render only. Once the user
  // clicks anything, respect their open set verbatim — otherwise closing
  // the first card would immediately re-open it (size===0 trigger).
  const effectiveOpen = !hasInteracted && firstId ? new Set([firstId]) : openSessions;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Scan sessions</h3>
          <p className="text-[11px] text-slate-500">Each session = one Scan-all invocation. Click to expand and see individual rule outcomes.</p>
        </div>
        <div className="flex items-center gap-1 text-[10px]">
          {(['all', 'failed', 'error', 'passed', 'running'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={'rounded-full border px-2 py-0.5 ' + (filter === f ? 'border-blue-400 bg-blue-50 text-blue-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}
            >{f}</button>
          ))}
        </div>
      </div>

      {sessions.map((session) => {
        const isOpen = effectiveOpen.has(session.id);
        const totals = session.runs.reduce(
          (a: any, r: any) => {
            const s = (r.status || '').toLowerCase();
            a.total += 1;
            if (s === 'passed') a.passed += 1;
            else if (s === 'failed') a.failed += 1;
            else if (s === 'error') a.error += 1;
            else if (s === 'running' || s === 'pending') a.running += 1;
            else a.other += 1;
            return a;
          },
          { total: 0, passed: 0, failed: 0, error: 0, running: 0, other: 0 },
        );
        const span = Math.max(0, session.endedAt ? (session.startedAt - session.endedAt) : 0);
        const spanSec = Math.round(span / 1000);
        const passRate = totals.total ? Math.round((totals.passed / totals.total) * 100) : 0;
        const filteredRuns = session.runs.filter((r: any) => filter === 'all' ? true : (r.status || '').toLowerCase() === filter);

        return (
          <div key={session.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <button
              onClick={() => toggle(session.id)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50"
            >
              {isOpen ? <ChevronDown className="h-4 w-4 text-slate-500" /> : <ChevronRight className="h-4 w-4 text-slate-500" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-semibold text-slate-900">
                    Scan at {formatTime(new Date(session.startedAt).toISOString())}
                  </span>
                  <span className="text-[10px] text-slate-500">{totals.total} rules &middot; {spanSec}s elapsed</span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">PASS {totals.passed}</span>
                  <span className="rounded-full bg-red-50 px-1.5 py-0.5 font-medium text-red-700">FAIL {totals.failed}</span>
                  {totals.error > 0 && <span className="rounded-full bg-orange-50 px-1.5 py-0.5 font-medium text-orange-700">ERR {totals.error}</span>}
                  {totals.running > 0 && <span className="rounded-full bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">RUN {totals.running}</span>}
                  <span className="ml-auto font-mono text-slate-600">Pass rate: <strong>{passRate}%</strong></span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400" style={{ width: passRate + '%' }} />
                </div>
              </div>
            </button>

            {isOpen && (
              <div className="border-t border-slate-200 bg-slate-50/30">
                {filteredRuns.length === 0 ? (
                  <div className="p-3 text-center text-[11px] text-slate-500">
                    No runs match filter <strong>{filter}</strong>.
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-1.5 text-left font-medium">Rule</th>
                        <th className="px-3 py-1.5 text-left font-medium w-32">Started</th>
                        <th className="px-3 py-1.5 text-left font-medium w-24">Result</th>
                        <th className="px-3 py-1.5 text-left font-medium w-16">Duration</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredRuns.slice(0, 100).map((run: any) => (
                        <tr key={run.id} className="hover:bg-white">
                          <td className="px-3 py-1.5 align-top text-slate-800">
                            <div className="font-medium leading-snug">{pluginLabel(run)}</div>
                            {run.result_summary && (
                              <div className="mt-0.5 text-[10px] text-slate-500 line-clamp-2">{run.result_summary}</div>
                            )}
                          </td>
                          <td className="px-3 py-1.5 align-top text-[10px] text-slate-500">{formatTime(run.started_at || run.created_at)}</td>
                          <td className="px-3 py-1.5 align-top">{passFailBadge(run)}</td>
                          <td className="px-3 py-1.5 align-top text-[11px] text-slate-600">{fmtDuration(run)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {filteredRuns.length > 100 && (
                  <div className="border-t border-slate-200 bg-slate-50 px-3 py-1.5 text-[10px] text-slate-500">
                    Showing first 100 of {filteredRuns.length} runs.
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
