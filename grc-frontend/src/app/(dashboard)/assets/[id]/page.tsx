'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePermissions } from '@/hooks/usePermissions';
import { apiClient, assetsApi, criticalityApi, ermApi, evidenceApi, vulnManagementApi } from '@/lib/api';
import type { IacaItem, IscaItem } from '@/lib/api';
import type { ITAsset } from '@/types';
import { SearchInput, InlineLinkPicker, PageLoader } from '@/components/ui';
import {
  ArrowLeft, Loader2, AlertCircle, Shield, DollarSign,
  Target, TrendingUp, FileCheck, AlertTriangle,
  ClipboardList, Plus, X, Trash2, Edit, RefreshCw,
  AppWindow, HardDrive, Database, Cloud, Building2,
  Lock, ShieldCheck, MapPin, User, Bug, Network,
  Gauge, PackageSearch,
} from 'lucide-react';
import Link from 'next/link';

import nextDynamic from 'next/dynamic';
import { CreateIssueButton } from '@/components/issue-management/CreateIssueButton';
import { RelatedIssuesPanel } from '@/components/issue-management/RelatedIssuesPanel';

const TrajectoryMap = nextDynamic(
  () => import('./_components/TrajectoryMap').then((m) => m.TrajectoryMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[500px] items-center justify-center rounded-xl border border-slate-200 bg-white">
        <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
      </div>
    ),
  },
);

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

type TabType = 'details' | 'controls' | 'evidence' | 'risks' | 'security-compliance' | 'vulnerabilities' | 'criticality' | 'trajectory';

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
  // Provenance — Phase 4 / Track B. Drives the Auto badge + source chip.
  link_source?: string | null;
  auto_linked?: boolean | null;
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
  // Phase 5 — Operational context. All optional; assets that pre-date the
  // migration simply render the relevant cells as "Not set".
  internet_facing?: boolean;
  network_segment?: string | null;
  data_classification?: string | null;
  business_function?: string | null;
  compliance_scope?: string[];
  primary_owner_id?: number | null;
  primary_owner_name?: string | null;
  secondary_owner_id?: number | null;
  secondary_owner_name?: string | null;
  owning_team?: string | null;
  owning_team_id?: number | null;
  owning_team_name?: string | null;
  escalation_contact_id?: number | null;
  escalation_contact_name?: string | null;
  business_owner_id?: number | null;
  business_owner_name?: string | null;
  lifecycle_state?: string | null;
  decommissioned_at?: string | null;
  retirement_reason?: string | null;
  replacement_asset_id?: number | null;
  replacement_asset_name?: string | null;
  criticality_score?: number | null;
  last_seen_at?: string | null;
  last_seen_source?: string | null;
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
    // Phase 5 — Operational context fields editable through the standard
    // PUT /assets/{id} endpoint. Lifecycle state is intentionally NOT here:
    // it transitions through its own POST /lifecycle-transition endpoint so
    // the FSM + auto-close hooks always run.
    | 'internet_facing'
    | 'network_segment'
    | 'data_classification'
    | 'business_function'
    | 'compliance_scope'
    | 'primary_owner_id'
    | 'secondary_owner_id'
    | 'owning_team'
    | 'owning_team_id'
    | 'escalation_contact_id'
    | 'business_owner_id'
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
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showLifecycleModal, setShowLifecycleModal] = useState(false);

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
      queryClient.invalidateQueries({ queryKey: ['asset-trajectory', assetId] });
    },
  });

  // Phase 5.3 — Move through the lifecycle state machine. Backend validates
  // the transition; we just surface the rejection or refresh the row.
  const lifecycleMutation = useMutation({
    mutationFn: (payload: { to_state: string; reason?: string; replacement_asset_id?: number }) =>
      assetsApi.transitionLifecycle(assetId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-detail', assetId] });
      queryClient.invalidateQueries({ queryKey: ['asset-coverage', assetId] });
      queryClient.invalidateQueries({ queryKey: ['asset-trajectory', assetId] });
      setShowLifecycleModal(false);
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
      queryClient.invalidateQueries({ queryKey: ['asset-trajectory', assetId] });
    },
  });

  const unlinkVulnerabilityMutation = useMutation({
    mutationFn: (vulnId: number) =>
      vulnManagementApi.assetLinks.delete(vulnId, assetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-detail', assetId] });
      queryClient.invalidateQueries({ queryKey: ['asset-trajectory', assetId] });
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
        <PageLoader size="md" />
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
    { id: 'criticality', label: 'Criticality Assessments', icon: ShieldCheck },
    { id: 'trajectory', label: 'Trajectory', icon: Network },
    { id: 'security-compliance', label: 'Security Compliance', icon: ShieldCheck },
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
            {canEdit && (
              <button
                onClick={() => setShowLifecycleModal(true)}
                className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
                title="Change lifecycle state — decommissioning auto-closes linked vulns"
              >
                <TrendingUp className="h-4 w-4" />
                Lifecycle
              </button>
            )}
            {/* Spec cross-links: every asset should be one click away from
                its CIS scan history and its composite risk posture. The
                backend endpoints already key off ITAsset.id; these just
                make the navigation discoverable. */}
            <Link
              href={`/compliance-plugins/asset/${assetId}`}
              className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
              title="View this asset's CIS plugin runs (Plugin Automation → per-asset)"
            >
              <PackageSearch className="h-4 w-4" />
              CIS scans
            </Link>
            <Link
              href={`/risk-posture/asset/${assetId}`}
              className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-100"
              title="View this asset's composite risk posture (5-dimension breakdown)"
            >
              <Gauge className="h-4 w-4" />
              Risk posture
            </Link>
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
            <CreateIssueButton
              sourceType="asset"
              sourceId={assetId}
              presetFields={{
                title: `Issue on ${asset.name}`,
                category: 'operations',
                issue_type: 'incident',
              }}
            />
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
          <div className="space-y-3">
            {/* v2: surface Issues that have been raised against this asset
                directly above the existing Risks list — gives the operator
                a single "what's broken" view alongside risk scoring. */}
            <RelatedIssuesPanel
              sourceType="asset"
              sourceId={assetId}
              title="Linked Issues"
              createFields={{
                title: `Issue on ${asset.name}`,
                category: 'operations',
                issue_type: 'incident',
              }}
            />
            <RisksTab asset={asset} />
          </div>
        )}
        {activeTab === 'criticality' && (
          <CriticalityAssessmentsTab assetId={assetId} />
        )}
        {activeTab === 'trajectory' && (
          <TrajectoryMap assetId={assetId} />
        )}
        {activeTab === 'security-compliance' && (
          <SecurityComplianceTab assetId={assetId} />
        )}
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

      {showLifecycleModal && (
        <LifecycleTransitionModal
          currentState={asset.lifecycle_state || 'active'}
          onClose={() => setShowLifecycleModal(false)}
          onSubmit={(payload) => lifecycleMutation.mutate(payload)}
          isSaving={lifecycleMutation.isPending}
          errorMessage={
            lifecycleMutation.error
              ? (lifecycleMutation.error as { response?: { data?: { detail?: string } }; message?: string })
                  ?.response?.data?.detail ||
                (lifecycleMutation.error as { message?: string })?.message ||
                'Transition failed'
              : null
          }
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
  // Tenant users — drives every "pick an owner" dropdown.
  const { data: tenantUsers } = useQuery({
    queryKey: ['tenant-users-for-asset-edit'],
    queryFn: () => assetsApi.getTenantUsers().then((r) => r.data),
    staleTime: 60 * 1000,
  });
  // Active org teams — drives the Owning Team dropdown.
  const { data: teams } = useQuery({
    queryKey: ['teams-for-asset-edit'],
    queryFn: () => apiClient.get('/admin/teams').then((r) => r.data as Array<{
      id: number; name: string; is_active: boolean;
    }>),
    staleTime: 60 * 1000,
  });

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
    // Phase 5 — Operational context fields.
    internet_facing: asset.internet_facing ?? false,
    network_segment: asset.network_segment || '',
    data_classification: asset.data_classification || '',
    business_function: asset.business_function || '',
    compliance_scope_text: (asset.compliance_scope || []).join(', '),
    primary_owner_id: asset.primary_owner_id ?? '',
    secondary_owner_id: asset.secondary_owner_id ?? '',
    // Two ways to record the owning team: a structured FK to grc_teams or
    // a free-text fallback for assets predating the Teams feature.
    owning_team_id: asset.owning_team_id ?? '',
    owning_team: asset.owning_team || '',
    escalation_contact_id: asset.escalation_contact_id ?? '',
    business_owner_id: asset.business_owner_id ?? '',
  });

  const parseId = (v: string | number): number | undefined => {
    if (v === '' || v === null || v === undefined) return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const scope = form.compliance_scope_text
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
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
      // Phase 5 — only included when the field actually has a value so the
      // backend stores null for clears rather than overwriting with empty strings.
      internet_facing: Boolean(form.internet_facing),
      network_segment: form.network_segment || undefined,
      data_classification: (form.data_classification || undefined) as ITAsset['data_classification'],
      business_function: form.business_function || undefined,
      compliance_scope: scope,
      primary_owner_id: parseId(form.primary_owner_id),
      secondary_owner_id: parseId(form.secondary_owner_id),
      // Both fields go through: FK for the picker-selected team, plain
      // text for the legacy fallback. Backend normalises on read.
      owning_team_id: parseId(form.owning_team_id),
      owning_team: form.owning_team || undefined,
      escalation_contact_id: parseId(form.escalation_contact_id),
      business_owner_id: parseId(form.business_owner_id),
    });
  };

  // Helper component — user-picker dropdown with email shown alongside.
  const UserPicker = ({ label, value, onChange }: {
    label: string;
    value: number | '';
    onChange: (v: number | '') => void;
  }) => (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
      <select
        value={value === '' ? '' : value}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
      >
        <option value="">— None —</option>
        {(tenantUsers || []).map((u) => (
          <option key={u.id} value={u.id}>
            {u.display_name} ({u.email})
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 p-4">
      {/*
        Layout: fixed-height column with sticky header + sticky footer.
        Body scrolls internally — the modal NEVER overflows the viewport,
        so the title and action buttons stay reachable on small screens.
      */}
      <div className="w-full max-w-4xl flex flex-col max-h-[90vh] rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
          <h2 className="text-base font-semibold text-slate-900">Edit Asset</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form
          id="edit-asset-form"
          onSubmit={handleSubmit}
          className="space-y-4 px-6 py-4 overflow-y-auto flex-1"
        >
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

          {/* ── Phase 5: Operational Context ──────────────────────────── */}
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
              Operational Context
            </h3>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean(form.internet_facing)}
                  onChange={(e) => setForm({ ...form, internet_facing: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                Internet-facing
              </label>

              <div>
                <label className="block text-xs font-medium text-slate-600">Data Classification</label>
                <select
                  value={form.data_classification}
                  onChange={(e) => setForm({ ...form, data_classification: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                >
                  <option value="">— Not set —</option>
                  <option value="public">Public</option>
                  <option value="internal">Internal</option>
                  <option value="confidential">Confidential</option>
                  <option value="restricted">Restricted</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600">Network Segment</label>
                <input
                  value={form.network_segment}
                  onChange={(e) => setForm({ ...form, network_segment: e.target.value })}
                  placeholder="dmz, prod-app-tier, ..."
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600">Business Function</label>
                <input
                  value={form.business_function}
                  onChange={(e) => setForm({ ...form, business_function: e.target.value })}
                  placeholder="Payments, HR Operations, ..."
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                />
              </div>

              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-600">
                  Compliance Scope <span className="text-slate-400">(comma-separated, e.g. PCI-DSS, HIPAA)</span>
                </label>
                <input
                  value={form.compliance_scope_text}
                  onChange={(e) => setForm({ ...form, compliance_scope_text: e.target.value })}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                />
              </div>
            </div>
          </div>

          {/* ── Phase 5.2: Ownership Chain ────────────────────────────── */}
          {/* Pickers feed off the existing /assets/tenant-users endpoint;
              the team picker uses the new /admin/teams endpoint. If no
              teams are configured yet, the user falls back to a free-text
              field — that legacy value still saves on the backend. */}
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-600">
              Ownership Chain
            </h3>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <UserPicker
                label="Primary Owner"
                value={form.primary_owner_id as number | ''}
                onChange={(v) => setForm({ ...form, primary_owner_id: v })}
              />
              <UserPicker
                label="Secondary Owner"
                value={form.secondary_owner_id as number | ''}
                onChange={(v) => setForm({ ...form, secondary_owner_id: v })}
              />
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Owning Team</label>
                {teams && teams.length > 0 ? (
                  <select
                    value={form.owning_team_id === '' ? '' : form.owning_team_id}
                    onChange={(e) => setForm({
                      ...form,
                      owning_team_id: e.target.value ? Number(e.target.value) : '',
                      // Mirror the team name into the legacy text field so
                      // older code paths that read `owning_team` see it too.
                      owning_team: e.target.value
                        ? (teams.find((t) => t.id === Number(e.target.value))?.name || '')
                        : '',
                    })}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  >
                    <option value="">— None —</option>
                    {teams.filter((t) => t.is_active).map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={form.owning_team}
                    onChange={(e) => setForm({ ...form, owning_team: e.target.value, owning_team_id: '' })}
                    placeholder="Create teams in Admin → Teams"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                )}
                {teams && teams.length === 0 && (
                  <p className="mt-1 text-[10px] text-slate-500">
                    No teams configured yet. <a href="/admin" className="text-blue-600 hover:underline">Manage teams →</a>
                  </p>
                )}
              </div>
              <UserPicker
                label="Escalation Contact"
                value={form.escalation_contact_id as number | ''}
                onChange={(v) => setForm({ ...form, escalation_contact_id: v })}
              />
              <div className="md:col-span-2">
                <UserPicker
                  label="Business Owner"
                  value={form.business_owner_id as number | ''}
                  onChange={(v) => setForm({ ...form, business_owner_id: v })}
                />
              </div>
            </div>
          </div>

        </form>

        {/* Sticky footer — always visible regardless of scroll position. */}
        <div className="px-6 py-3 border-t border-slate-200 flex justify-end gap-3 flex-shrink-0 bg-white rounded-b-lg">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="edit-asset-form"
            disabled={isSaving}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Phase 5 helpers ──────────────────────────────────────────────────────────

const LIFECYCLE_STYLES: Record<string, string> = {
  planned: 'border-slate-200 bg-slate-50 text-slate-600',
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  maintenance: 'border-amber-200 bg-amber-50 text-amber-700',
  decommissioned: 'border-orange-200 bg-orange-50 text-orange-700',
  retired: 'border-rose-200 bg-rose-50 text-rose-700',
};

const DATA_CLASSIFICATION_STYLES: Record<string, string> = {
  public: 'border-slate-200 bg-slate-50 text-slate-600',
  internal: 'border-blue-200 bg-blue-50 text-blue-700',
  confidential: 'border-amber-200 bg-amber-50 text-amber-700',
  restricted: 'border-rose-200 bg-rose-50 text-rose-700',
};

function ScoreBadge({ score }: { score?: number | null }) {
  if (score == null) {
    return <span className="text-sm text-slate-400">Not yet computed</span>;
  }
  // Match the priority_bucket thresholds on the backend so colour
  // semantics line up across the asset and vuln pages.
  let cls = 'border-slate-200 bg-slate-50 text-slate-700';
  if (score >= 9) cls = 'border-rose-200 bg-rose-50 text-rose-700';
  else if (score >= 7) cls = 'border-amber-200 bg-amber-50 text-amber-700';
  else if (score >= 4) cls = 'border-blue-200 bg-blue-50 text-blue-700';
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      {score.toFixed(1)} / 10
    </span>
  );
}

function StaleIndicator({ lastSeenAt }: { lastSeenAt?: string | null }) {
  if (!lastSeenAt) {
    return <span className="text-xs text-slate-400">Never observed</span>;
  }
  const seenDate = new Date(lastSeenAt);
  const ageDays = (Date.now() - seenDate.getTime()) / (1000 * 60 * 60 * 24);
  const stale = ageDays > 30;
  return (
    <div className="flex items-center gap-2">
      <span className="text-sm text-slate-700">{seenDate.toLocaleDateString()}</span>
      {stale && (
        <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
          Stale ({Math.round(ageDays)}d)
        </span>
      )}
    </div>
  );
}

function DetailsTab({ asset }: { asset: AssetDetailData }) {
  const lifecycle = (asset.lifecycle_state || 'active').toLowerCase();
  const lifecycleCls = LIFECYCLE_STYLES[lifecycle] || LIFECYCLE_STYLES.active;
  const classificationCls = asset.data_classification
    ? DATA_CLASSIFICATION_STYLES[asset.data_classification.toLowerCase()] || DATA_CLASSIFICATION_STYLES.internal
    : null;

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

      {/* ── Phase 5.1: Operational Context ─────────────────────────────── */}
      <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Target className="h-4 w-4 text-blue-600" />
          Operational Context
        </h3>
        <div className="space-y-3">
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Internet-facing</span>
            <p className="text-sm text-slate-700">
              {asset.internet_facing ? (
                <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">
                  Exposed
                </span>
              ) : (
                <span className="text-slate-700">Internal only</span>
              )}
            </p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Data Classification</span>
            <p className="text-sm">
              {asset.data_classification && classificationCls ? (
                <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${classificationCls}`}>
                  {asset.data_classification}
                </span>
              ) : (
                <span className="text-slate-400">Not set</span>
              )}
            </p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Network Segment</span>
            <p className="text-sm text-slate-700">{asset.network_segment || <span className="text-slate-400">Not set</span>}</p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Business Function</span>
            <p className="text-sm text-slate-700">{asset.business_function || <span className="text-slate-400">Not set</span>}</p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Compliance Scope</span>
            <div className="mt-1 flex flex-wrap gap-1">
              {asset.compliance_scope && asset.compliance_scope.length > 0 ? (
                asset.compliance_scope.map((scope) => (
                  <span key={scope} className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                    {scope}
                  </span>
                ))
              ) : (
                <span className="text-sm text-slate-400">None declared</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Phase 5.2: Ownership Chain ─────────────────────────────────── */}
      <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <User className="h-4 w-4 text-blue-600" />
          Ownership Chain
        </h3>
        <div className="space-y-3">
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Primary Owner</span>
            <p className="text-sm text-slate-700">
              {asset.primary_owner_name || (asset.primary_owner_id ? `User #${asset.primary_owner_id}` : asset.owner_name || <span className="text-slate-400">Not assigned</span>)}
            </p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Secondary Owner</span>
            <p className="text-sm text-slate-700">
              {asset.secondary_owner_name || (asset.secondary_owner_id ? `User #${asset.secondary_owner_id}` : <span className="text-slate-400">Not assigned</span>)}
            </p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Owning Team</span>
            <p className="text-sm text-slate-700">{asset.owning_team || <span className="text-slate-400">Not assigned</span>}</p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Escalation Contact</span>
            <p className="text-sm text-slate-700">
              {asset.escalation_contact_name || (asset.escalation_contact_id ? `User #${asset.escalation_contact_id}` : <span className="text-slate-400">Not assigned</span>)}
            </p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Business Owner</span>
            <p className="text-sm text-slate-700">
              {asset.business_owner_name || (asset.business_owner_id ? `User #${asset.business_owner_id}` : <span className="text-slate-400">Not assigned</span>)}
            </p>
          </div>
        </div>
      </div>

      {/* ── Phase 5.3 + 5.4 + 5.5: Lifecycle + Threat Score + Last-Seen ── */}
      <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
          <TrendingUp className="h-4 w-4 text-blue-600" />
          Lifecycle & Threat Score
        </h3>
        <div className="space-y-3">
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Lifecycle State</span>
            <p className="text-sm">
              <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${lifecycleCls}`}>
                {asset.lifecycle_state || 'active'}
              </span>
            </p>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Derived Criticality Score</span>
            <div className="mt-1"><ScoreBadge score={asset.criticality_score} /></div>
          </div>
          <div>
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Last Observed</span>
            <div className="mt-1"><StaleIndicator lastSeenAt={asset.last_seen_at} /></div>
            {asset.last_seen_source && (
              <p className="text-xs text-slate-500">via {asset.last_seen_source}</p>
            )}
          </div>
          {asset.decommissioned_at && (
            <div>
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Decommissioned</span>
              <p className="text-sm text-slate-700">{new Date(asset.decommissioned_at).toLocaleString()}</p>
            </div>
          )}
          {asset.retirement_reason && (
            <div>
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Retirement Reason</span>
              <p className="text-sm text-slate-700">{asset.retirement_reason}</p>
            </div>
          )}
          {asset.replacement_asset_id && (
            <div>
              <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Replacement Asset</span>
              <p className="text-sm text-slate-700">
                <Link href={`/assets/${asset.replacement_asset_id}`} className="text-blue-600 hover:underline">
                  {asset.replacement_asset_name || `Asset #${asset.replacement_asset_id}`}
                </Link>
              </p>
            </div>
          )}
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
                {/* Provenance chips — show how this link was created so
                    reviewers can spot auto-linked false positives. */}
                {vuln.link_source && vuln.link_source !== 'manual' && (
                  <span className="rounded-full border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-600">
                    {vuln.link_source.replace(/_/g, ' ')}
                  </span>
                )}
                {vuln.auto_linked && (
                  <span
                    className="rounded-full border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-700"
                    title="Linked automatically by scanner / sync / matcher — review for accuracy"
                  >
                    Auto
                  </span>
                )}
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
        <div className="flex-1">
          <SearchInput
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Search control ID, title, level, section..."
            size="md"
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
          <PageLoader size="sm" />
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

// ── Phase 5.3: Lifecycle transition modal ────────────────────────────────────
// Encodes the FSM client-side as well so the user only sees moves the backend
// will accept. The backend is still the source of truth and will reject any
// invalid transition with a 400 — the client copy is purely UX.
const ALLOWED_LIFECYCLE_MOVES: Record<string, string[]> = {
  planned: ['active'],
  active: ['maintenance', 'decommissioned'],
  maintenance: ['active', 'decommissioned'],
  decommissioned: ['retired'],
  retired: [],
};

function LifecycleTransitionModal({
  currentState,
  onClose,
  onSubmit,
  isSaving,
  errorMessage,
}: {
  currentState: string;
  onClose: () => void;
  onSubmit: (payload: { to_state: string; reason?: string; replacement_asset_id?: number }) => void;
  isSaving: boolean;
  errorMessage: string | null;
}) {
  const cur = (currentState || 'active').toLowerCase();
  const options = ALLOWED_LIFECYCLE_MOVES[cur] || [];
  const [toState, setToState] = useState<string>(options[0] || '');
  const [reason, setReason] = useState('');
  const [replacementId, setReplacementId] = useState<string>('');

  const isTerminal = toState === 'decommissioned' || toState === 'retired';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!toState) return;
    const payload: { to_state: string; reason?: string; replacement_asset_id?: number } = {
      to_state: toState,
    };
    if (isTerminal && reason.trim()) payload.reason = reason.trim();
    if (isTerminal && replacementId.trim()) {
      const id = Number(replacementId);
      if (!Number.isNaN(id) && id > 0) payload.replacement_asset_id = id;
    }
    onSubmit(payload);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 p-4">
      <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Change Lifecycle State</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-4 text-xs text-slate-600">
          Current state: <span className="font-semibold capitalize text-slate-900">{cur}</span>.
          {isTerminal && (
            <span className="mt-1 block rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
              Moving to <span className="font-semibold capitalize">{toState}</span> will auto-close
              any open vulnerabilities linked to this asset.
            </span>
          )}
        </p>

        {errorMessage && (
          <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
            {errorMessage}
          </div>
        )}

        {options.length === 0 ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            No further lifecycle transitions are permitted from <span className="font-semibold capitalize">{cur}</span>.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600">Move to</label>
              <select
                value={toState}
                onChange={(e) => setToState(e.target.value)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm capitalize text-slate-900"
              >
                {options.map((opt) => (
                  <option key={opt} value={opt} className="capitalize">{opt}</option>
                ))}
              </select>
            </div>

            {isTerminal && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-600">Reason (optional)</label>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={2}
                    placeholder="e.g. Replaced by new ERP rollout"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600">Replacement asset ID (optional)</label>
                  <input
                    type="number"
                    min={1}
                    value={replacementId}
                    onChange={(e) => setReplacementId(e.target.value)}
                    placeholder="e.g. 482"
                    className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                </div>
              </>
            )}

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
                disabled={isSaving || !toState}
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isSaving && <Loader2 className="h-4 w-4 animate-spin" />}
                Apply transition
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Criticality Assessments tab ─────────────────────────────────────────
// Surfaces the ISCA + IACA items linked to this asset. Each card links
// through to /assets/criticality-assessments with a deep-link so the
// operator can open the assessment drawer directly from here.

function CriticalityAssessmentsTab({ assetId }: { assetId: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['criticality.byAsset', assetId],
    queryFn: async () => (await criticalityApi.byAsset(assetId)).data,
    enabled: !!assetId,
  });

  if (isLoading) {
    return <PageLoader size="md" className="h-32" />;
  }
  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-700">
        Failed to load criticality assessments.
      </div>
    );
  }

  const iscas = data?.isca ?? [];
  const iacas = data?.iaca ?? [];
  const empty = iscas.length === 0 && iacas.length === 0;

  const bandColors: Record<string, string> = {
    mission_critical: 'bg-rose-50 text-rose-700 border-rose-200',
    high: 'bg-orange-50 text-orange-700 border-orange-200',
    moderate: 'bg-amber-50 text-amber-700 border-amber-200',
    low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
  const statusColors: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-700 border-slate-200',
    submitted: 'bg-blue-50 text-blue-700 border-blue-200',
    business_owner_review: 'bg-amber-50 text-amber-700 border-amber-200',
    ciso_review: 'bg-violet-50 text-violet-700 border-violet-200',
    approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    rejected: 'bg-rose-50 text-rose-700 border-rose-200',
    returned: 'bg-orange-50 text-orange-700 border-orange-200',
  };

  const renderRow = (
    item: IscaItem | IacaItem,
    kind: 'isca' | 'iaca',
  ) => (
    <tr key={`${kind}-${item.id}`} className="hover:bg-slate-50">
      <td className="px-3 py-2 align-top">
        <p className="text-sm font-medium text-slate-900">{item.name}</p>
      </td>
      <td className="px-3 py-2 align-top text-right font-mono text-sm text-slate-900">
        {typeof item.total_score === 'number'
          ? (kind === 'iaca' ? item.total_score.toFixed(2) : item.total_score)
          : '—'}
      </td>
      <td className="px-3 py-2 align-top">
        {item.criticality_level ? (
          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${bandColors[item.criticality_level] ?? 'border-slate-200'}`}>
            {item.criticality_level.replace('_', ' ')}
          </span>
        ) : <span className="text-xs text-slate-400">—</span>}
      </td>
      <td className="px-3 py-2 align-top">
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${statusColors[item.approval_status || 'draft'] ?? 'border-slate-200'}`}>
          {(item.approval_status || 'draft').replace('_', ' ')}
        </span>
      </td>
      <td className="px-3 py-2 align-top text-right">
        <Link
          href={`/assets/criticality-assessments?open=${kind}:${item.id}`}
          className="text-xs font-medium text-blue-600 hover:underline"
        >
          Open →
        </Link>
      </td>
    </tr>
  );

  return (
    <div className="space-y-4">
      {empty ? (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm text-slate-600">No criticality assessments linked to this asset yet.</p>
          <p className="mt-1 text-xs text-slate-500">
            Use the buttons below to create one — the new assessment will be pre-linked to this asset.
          </p>
          <div className="mt-4 inline-flex items-center gap-2">
            <Link
              href={`/assets/criticality-assessments?create=isca&asset=${assetId}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              + New Information System assessment
            </Link>
            <Link
              href={`/assets/criticality-assessments?create=iaca&asset=${assetId}`}
              className="inline-flex items-center gap-1.5 rounded-md border border-blue-300 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50"
            >
              + New Infrastructure Asset assessment
            </Link>
          </div>
        </div>
      ) : (
        <>
          {iscas.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <header className="bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                Information System Criticality Assessments ({iscas.length})
              </header>
              <table className="min-w-full text-sm">
                <thead className="bg-white border-b border-slate-100 text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Information System</th>
                    <th className="px-3 py-2 text-right">Total</th>
                    <th className="px-3 py-2">Criticality</th>
                    <th className="px-3 py-2">Approval</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {iscas.map((i) => renderRow(i, 'isca'))}
                </tbody>
              </table>
            </section>
          )}

          {iacas.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <header className="bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                Infrastructure Asset Criticality Assessments ({iacas.length})
              </header>
              <table className="min-w-full text-sm">
                <thead className="bg-white border-b border-slate-100 text-left text-[10px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Infrastructure Asset</th>
                    <th className="px-3 py-2 text-right">Score</th>
                    <th className="px-3 py-2">Criticality</th>
                    <th className="px-3 py-2">Approval</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {iacas.map((i) => renderRow(i, 'iaca'))}
                </tbody>
              </table>
            </section>
          )}

          <div className="flex items-center gap-2">
            <Link
              href={`/assets/criticality-assessments?create=isca&asset=${assetId}`}
              className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
            >
              + New ISCA
            </Link>
            <Link
              href={`/assets/criticality-assessments?create=iaca&asset=${assetId}`}
              className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-100"
            >
              + New IACA
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
