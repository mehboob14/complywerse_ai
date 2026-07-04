'use client';

export const dynamic = 'force-dynamic';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePermissions } from '@/hooks/usePermissions';
import { apiClient, assetsApi, compliancePluginsApi, criticalityApi, ermApi, evidenceApi, vulnManagementApi } from '@/lib/api';
import type { IacaItem, IscaItem } from '@/lib/api';
import type { ITAsset } from '@/types';
import { SearchInput, InlineLinkPicker, PageLoader } from '@/components/ui';
import {
  ArrowLeft, Loader2, AlertCircle, Shield, DollarSign,
  Target, TrendingUp, FileCheck, AlertTriangle,
  ClipboardList, Plus, X, Trash2, Edit, RefreshCw,
  AppWindow, HardDrive, Database, Cloud, Building2,
  Lock, ShieldCheck, MapPin, User, Bug, Network,
  Gauge, PackageSearch, Sparkles, Layers, Filter,
  // CIS Module Updated drop — ComplianceTab + NoMappingCallout + ScanSessions
  Cpu, Play, ChevronDown, ChevronRight, Zap,
} from 'lucide-react';
import Link from 'next/link';

import nextDynamic from 'next/dynamic';
import { CreateIssueButton } from '@/components/issue-management/CreateIssueButton';
import { RelatedIssuesPanel } from '@/components/issue-management/RelatedIssuesPanel';
// Updated_CIS_Assests migration: host applications "room-and-chair" panel
// rendered above the existing ComplianceTab content.
import HostApplicationsPanel from './_host-applications-panel';
import { RoomScanProvider, useRoomScan } from './_room-scan-context';

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

type TabType = 'details' | 'compliance' | 'controls' | 'evidence' | 'risks' | 'vulnerabilities' | 'criticality' | 'trajectory' | 'mapping-recommendations';

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
  // CIS Module Updated drop — OS profile fields consumed by the
  // Compliance tab (AI Classification + Matched benchmark panels).
  // All optional; the panel handles "unknown" gracefully when missing.
  os_family?: string | null;
  os_version?: string | null;
  os_normalized?: string | null;
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
  // D1 layout: the right column starts on the promoted Trajectory graph — the
  // asset's core risk narrative — rather than the old Details tab (which is now
  // dissolved into the pinned left context rail).
  const [activeTab, setActiveTab] = useState<TabType>('trajectory');
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

  // Updated_CIS_Assests migration: IP-group composite scoring feed for the
  // CIS Compliance header tile. Returns the group, composite, and weakest
  // link from /assets/{id}/ip-peers.
  const { data: ipPeers } = useQuery<{
    composite?: {
      effective_score?: number | null;
      host_score?: number | null;
      weakest?: { id: number; name: string; score: number } | null;
    };
    group?: Array<{ id: number; is_self: boolean; score?: number | null }>;
  }>({
    queryKey: ['asset-ip-peers', assetId],
    queryFn: async () => {
      try {
        const response = await assetsApi.getIPPeers(assetId);
        return response.data as Record<string, unknown> as never;
      } catch {
        // Endpoint is new in this migration; if it 404s for any reason the
        // tile falls back to "Not yet scanned" rather than crashing.
        return {};
      }
    },
    staleTime: 60000,
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
    return (
      <span className={`rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${STATUS_TONES[status] || 'border-slate-200 bg-slate-100 text-slate-600'}`}>
        {status}
      </span>
    );
  };

  const getCriticalityBadge = (criticality: string) => {
    return (
      <span className={`rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${CRITICALITY_TONES[criticality] || 'border-slate-200 bg-slate-100 text-slate-600'}`}>
        {criticality}
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

  // Right-column work sections. The old top tab-strip is replaced by an
  // in-column secondary nav so the LEFT context rail never scrolls away.
  // Trajectory is PROMOTED to first — it's the asset's core risk narrative.
  const sections: { id: TabType; label: string; icon: React.ElementType }[] = [
    { id: 'trajectory', label: 'Trajectory', icon: Network },
    { id: 'vulnerabilities', label: 'Vulnerabilities', icon: Bug },
    { id: 'risks', label: 'Risks', icon: AlertTriangle },
    { id: 'controls', label: 'Controls', icon: Shield },
    { id: 'evidence', label: 'Evidence', icon: FileCheck },
    // CIS Module Updated drop — Compliance / room scan (HostApplicationsPanel + ComplianceTab).
    { id: 'compliance', label: 'Compliance', icon: Cpu },
    { id: 'criticality', label: 'Criticality Assessments', icon: ShieldCheck },
    { id: 'mapping-recommendations', label: 'Mapping Recommendations', icon: Sparkles },
  ];

  return (
    <div className="assets-light risk-workspace -m-4 space-y-4 lg:-m-5">
      {/* Header bar — identity + status pills. Actions live in the left rail. */}
      <div className="border-b border-slate-200 px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-start gap-3">
            <Link
              href="/assets"
              className="mt-0.5 rounded-md p-1.5 text-slate-600 hover:bg-slate-50 hover:text-slate-800"
              title="Back to Assets"
            >
              <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
            </Link>
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
              {getAssetIcon(asset.asset_type)}
            </div>
            <div>
              <h1 className="text-lg font-semibold text-slate-800">{displayName}</h1>
              <p className="text-xs text-slate-600">{asset.description || 'No description'}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 xl:justify-end">
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
              {ASSET_TYPE_LABELS[asset.asset_type] || asset.asset_type}
            </span>
            {getStatusBadge(asset.status)}
            {getCriticalityBadge(asset.criticality)}
          </div>
        </div>
      </div>

      {/* D1 split: pinned left context column + scrolling right work column.
          Every tab component is reused unchanged — only its placement changed. */}
      <div className="mx-4 grid grid-cols-1 gap-4 pb-4 sm:mx-6 lg:grid-cols-12">
        {/* ── LEFT: authoritative context — stays on screen ─────────────── */}
        <div className="lg:col-span-5">
          <div className="space-y-3 lg:sticky lg:top-4">
            <AssetContextRail
              asset={asset}
              displayName={displayName}
              assetId={assetId}
              coverage={coverage}
              ipPeers={ipPeers}
              latestAssessment={latestAssessment}
              canEdit={canEdit}
              canDelete={canDelete}
              onEdit={() => setShowEditModal(true)}
              onLifecycle={() => setShowLifecycleModal(true)}
              onDelete={() => setShowDeleteConfirm(true)}
              onAssessRisk={() => assessRiskMutation.mutate()}
              isAssessing={assessRiskMutation.isPending}
              getAssetIcon={getAssetIcon}
              formatDate={formatDate}
            />
          </div>
        </div>

        {/* ── RIGHT: scrolling work column ──────────────────────────────── */}
        <div className="space-y-4 lg:col-span-7">
          {/* Lightweight in-column section switcher */}
          <div className="cw-card rounded-xl px-2 py-2">
            <nav className="flex flex-wrap gap-1">
              {sections.map((s) => {
                const Icon = s.icon;
                const active = activeTab === s.id;
                return (
                  <button
                    key={s.id}
                    onClick={() => setActiveTab(s.id)}
                    className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                      active
                        ? 'bg-primary-50 text-primary-700'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                    {s.label}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="cw-card rounded-xl p-4 sm:p-5">
            {activeTab === 'trajectory' && (
              <div className="space-y-2">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <Network className="h-4 w-4 text-primary-600" strokeWidth={1.75} />
                  Risk trajectory
                </h2>
                <p className="text-xs text-slate-500">
                  Asset → Vulnerability → Risk. Click a node to trace its sub-chain.
                </p>
                <TrajectoryMap assetId={assetId} />
              </div>
            )}
            {activeTab === 'compliance' && (
              <RoomScanProvider>
                <div className="space-y-4">
                  <HostApplicationsPanel assetId={assetId} />
                  <ComplianceTab asset={asset} />
                </div>
              </RoomScanProvider>
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
            {activeTab === 'mapping-recommendations' && (
              <MappingRecommendationsTab assetId={assetId} />
            )}
          </div>
        </div>
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

// ── D1 left rail ─────────────────────────────────────────────────────────────
// The single authoritative context card stack. Everything that used to live in
// the page header + KPI band + the Details tab's identity cards now pins here
// on the left so it never scrolls away while the operator works the right column.
// Reuses the module-level ScoreBadge / StaleIndicator helpers unchanged.

function RailStatRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-800 text-right">{children}</span>
    </div>
  );
}

function RailCIABar({ rating, label, tone }: { rating: number; label: string; tone: string }) {
  const value = rating || 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 text-xs text-slate-500">{label}</span>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className={`h-3.5 w-5 rounded ${i <= value ? tone : 'bg-slate-200'}`} />
        ))}
      </div>
      <span className="ml-auto text-xs text-slate-600">{value}/5</span>
    </div>
  );
}

function AssetContextRail({
  asset,
  displayName,
  assetId,
  coverage,
  ipPeers,
  latestAssessment,
  canEdit,
  canDelete,
  onEdit,
  onLifecycle,
  onDelete,
  onAssessRisk,
  isAssessing,
  getAssetIcon,
  formatDate,
}: {
  asset: AssetDetailData;
  displayName: string;
  assetId: number;
  coverage: { coverage_percentage?: number } | undefined;
  ipPeers: {
    composite?: {
      effective_score?: number | null;
      host_score?: number | null;
      weakest?: { id: number; name: string; score: number } | null;
    };
    group?: Array<{ id: number; is_self: boolean; score?: number | null }>;
  } | undefined;
  latestAssessment: RiskAssessment | null;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onLifecycle: () => void;
  onDelete: () => void;
  onAssessRisk: () => void;
  isAssessing: boolean;
  getAssetIcon: (type: string) => React.ReactNode;
  formatDate: (d: string) => string;
}) {
  const lifecycle = (asset.lifecycle_state || 'active').toLowerCase();
  const lifecycleCls = LIFECYCLE_STYLES[lifecycle] || LIFECYCLE_STYLES.active;
  const classificationCls = asset.data_classification
    ? DATA_CLASSIFICATION_STYLES[asset.data_classification.toLowerCase()] || DATA_CLASSIFICATION_STYLES.internal
    : null;

  const coveragePct = coverage?.coverage_percentage ?? asset.coverage_percentage ?? 0;
  const totalControls =
    (asset.linked_controls?.length || 0) +
    (asset.linked_internal_controls?.length || 0) +
    (asset.linked_framework_controls?.length || 0);

  // CIS composite — same resolution as the old KPI tile.
  const composite = ipPeers?.composite;
  const ownScore = ipPeers?.group?.find((g) => g.is_self)?.score;
  const cisScore = composite?.effective_score ?? ownScore;
  const cisColor = cisScore == null
    ? 'text-slate-400'
    : cisScore >= 80 ? 'text-emerald-700' : cisScore >= 60 ? 'text-amber-700' : 'text-rose-700';

  const riskScore = latestAssessment?.risk_score ?? null;
  const riskColor = riskScore == null
    ? 'text-slate-400'
    : riskScore >= 7 ? 'text-rose-700' : riskScore >= 4 ? 'text-amber-700' : 'text-emerald-700';

  return (
    <>
      {/* Actions — top of the rail */}
      <div className="cw-card flex flex-wrap items-center gap-2 rounded-xl p-3">
        {canEdit && (
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
            title="Edit Asset"
          >
            <Edit className="h-3.5 w-3.5" strokeWidth={1.75} /> Edit
          </button>
        )}
        {canEdit && (
          <button
            onClick={onLifecycle}
            className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
            title="Change lifecycle state — decommissioning auto-closes linked vulns"
          >
            <TrendingUp className="h-3.5 w-3.5" strokeWidth={1.75} /> Lifecycle
          </button>
        )}
        <button
          onClick={onAssessRisk}
          disabled={isAssessing}
          className="flex items-center gap-1.5 rounded-md bg-primary-600 px-2.5 py-1.5 text-xs text-white hover:bg-primary-700 disabled:opacity-50"
          title="Assess Risk"
        >
          {isAssessing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />}
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
        {/* Spec cross-links: one click to CIS scan history + composite risk posture. */}
        <Link
          href={`/compliance-plugins/asset/${assetId}`}
          className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
          title="View this asset's CIS plugin runs (Plugin Automation → per-asset)"
        >
          <PackageSearch className="h-3.5 w-3.5" strokeWidth={1.75} /> CIS scans
        </Link>
        <Link
          href={`/risk-posture/asset/${assetId}`}
          className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
          title="View this asset's composite risk posture (5-dimension breakdown)"
        >
          <Gauge className="h-3.5 w-3.5" strokeWidth={1.75} /> Risk posture
        </Link>
        {canDelete && (
          <button
            onClick={onDelete}
            className="flex items-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs text-rose-600 hover:bg-rose-100"
            title="Delete Asset"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} /> Delete
          </button>
        )}
      </div>

      {/* Identity + posture pills */}
      <div className="cw-card rounded-xl p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600">
            {getAssetIcon(asset.asset_type)}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-800">{displayName}</h2>
            <p className="text-xs text-slate-500">{ASSET_TYPE_LABELS[asset.asset_type] || asset.asset_type}</p>
          </div>
        </div>
        {asset.description && (
          <p className="mt-2 text-xs leading-relaxed text-slate-600">{asset.description}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5">
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${CRITICALITY_TONES[asset.criticality] || 'border-slate-200 bg-slate-50 text-slate-600'}`}>
            {asset.criticality}
          </span>
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_TONES[asset.status] || 'border-slate-200 bg-slate-50 text-slate-600'}`}>
            {asset.status}
          </span>
          {asset.internet_facing ? (
            <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-700">
              Internet-facing
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
              Internal only
            </span>
          )}
          {asset.data_classification && classificationCls && (
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${classificationCls}`}>
              {asset.data_classification}
            </span>
          )}
        </div>
      </div>

      {/* CIA ratings */}
      <div className="cw-card rounded-xl p-4">
        <div className="mb-3 flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <Lock className="h-3.5 w-3.5" strokeWidth={1.75} /> CIA Ratings
        </div>
        <div className="space-y-2">
          <RailCIABar rating={asset.confidentiality_rating || 0} label="Confidentiality" tone="bg-primary-500" />
          <RailCIABar rating={asset.integrity_rating || 0} label="Integrity" tone="bg-emerald-500" />
          <RailCIABar rating={asset.availability_rating || 0} label="Availability" tone="bg-amber-500" />
        </div>
      </div>

      {/* Posture stats — Coverage / CIS composite / Risk score */}
      <div className="cw-card rounded-xl p-4">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <Target className="h-3.5 w-3.5" strokeWidth={1.75} /> Posture
        </div>
        <div className="divide-y divide-slate-100">
          <RailStatRow label="Control coverage">
            <span className="text-slate-800">{coveragePct}%</span>
            <span className="ml-1 text-xs font-normal text-slate-400">· {totalControls} linked</span>
          </RailStatRow>
          <RailStatRow label="CIS composite">
            {cisScore == null ? (
              <span className="text-slate-400">Not scanned</span>
            ) : (
              <span className={cisColor}>{cisScore.toFixed(1)}%</span>
            )}
          </RailStatRow>
          <RailStatRow label="Risk score">
            {riskScore == null ? (
              <span className="text-slate-400">No assessment</span>
            ) : (
              <span className={riskColor}>{riskScore.toFixed(1)}</span>
            )}
          </RailStatRow>
          <RailStatRow label="Derived criticality">
            <ScoreBadge score={asset.criticality_score} />
          </RailStatRow>
        </div>
        {latestAssessment && (
          <p className="mt-2 text-[11px] text-slate-400">
            Last assessed {formatDate(latestAssessment.assessment_date)}
          </p>
        )}
      </div>

      {/* Ownership chain */}
      <div className="cw-card rounded-xl p-4">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <User className="h-3.5 w-3.5" strokeWidth={1.75} /> Ownership
        </div>
        <div className="divide-y divide-slate-100">
          <RailStatRow label="Primary owner">
            {asset.primary_owner_name || (asset.primary_owner_id ? `User #${asset.primary_owner_id}` : asset.owner_name) || <span className="text-slate-400 font-normal">Not assigned</span>}
          </RailStatRow>
          <RailStatRow label="Secondary owner">
            {asset.secondary_owner_name || (asset.secondary_owner_id ? `User #${asset.secondary_owner_id}` : <span className="text-slate-400 font-normal">Not assigned</span>)}
          </RailStatRow>
          <RailStatRow label="Business owner">
            {asset.business_owner_name || (asset.business_owner_id ? `User #${asset.business_owner_id}` : <span className="text-slate-400 font-normal">Not assigned</span>)}
          </RailStatRow>
          <RailStatRow label="Owning team">
            {asset.owning_team || <span className="text-slate-400 font-normal">Not assigned</span>}
          </RailStatRow>
          <RailStatRow label="Escalation">
            {asset.escalation_contact_name || (asset.escalation_contact_id ? `User #${asset.escalation_contact_id}` : <span className="text-slate-400 font-normal">Not assigned</span>)}
          </RailStatRow>
        </div>
      </div>

      {/* Lifecycle & operational context */}
      <div className="cw-card rounded-xl p-4">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-slate-500">
          <TrendingUp className="h-3.5 w-3.5" strokeWidth={1.75} /> Lifecycle & context
        </div>
        <div className="divide-y divide-slate-100">
          <RailStatRow label="Lifecycle state">
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${lifecycleCls}`}>
              {asset.lifecycle_state || 'active'}
            </span>
          </RailStatRow>
          <RailStatRow label="Data classification">
            {asset.data_classification && classificationCls ? (
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize ${classificationCls}`}>
                {asset.data_classification}
              </span>
            ) : (
              <span className="text-slate-400 font-normal">Not set</span>
            )}
          </RailStatRow>
          <RailStatRow label="Network segment">
            {asset.network_segment || <span className="text-slate-400 font-normal">Not set</span>}
          </RailStatRow>
          <RailStatRow label="Last observed">
            <StaleIndicator lastSeenAt={asset.last_seen_at} />
          </RailStatRow>
        </div>
      </div>
    </>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
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

// Shared light status-tone scale — one place for criticality / severity /
// status pills so the whole page reads with one colour language.
const CRITICALITY_TONES: Record<string, string> = {
  critical: 'border-rose-200 bg-rose-50 text-rose-700',
  high: 'border-orange-200 bg-orange-50 text-orange-700',
  medium: 'border-amber-200 bg-amber-50 text-amber-700',
  low: 'border-emerald-200 bg-emerald-50 text-emerald-700',
};

const STATUS_TONES: Record<string, string> = {
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  inactive: 'border-amber-200 bg-amber-50 text-amber-700',
  decommissioned: 'border-slate-200 bg-slate-100 text-slate-600',
};

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
  
  // Risk Posture uses target=12 as the "full coverage" threshold for an
  // asset. Anything less is treated as a gap that contributes to the
  // asset's risk score. We surface this here so operators understand
  // why linking 1 of 12 controls still shows the dimension as "low".
  const CTRL_TARGET = 12;
  const coveragePct = Math.min(100, Math.round((totalControls / CTRL_TARGET) * 100));
  const coverageTone =
    coveragePct >= 75 ? { bar: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', label: 'Solid coverage' } :
    coveragePct >= 33 ? { bar: 'bg-amber-500',   text: 'text-amber-700',   bg: 'bg-amber-50',   border: 'border-amber-200',   label: 'Partial coverage' } :
                        { bar: 'bg-red-500',     text: 'text-red-700',     bg: 'bg-red-50',     border: 'border-red-200',     label: 'Low coverage' };
  const fullCount  = [...(asset.linked_internal_controls || []), ...(asset.linked_framework_controls || []), ...(asset.linked_controls || [])]
                       .filter((c: any) => c.coverage_status === 'full').length;
  const partialCount = [...(asset.linked_internal_controls || []), ...(asset.linked_framework_controls || []), ...(asset.linked_controls || [])]
                       .filter((c: any) => c.coverage_status === 'partial').length;

  return (
    <div className="space-y-6">
      {/* Header card — coverage summary + Link Control CTA */}
      <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="flex items-center gap-2 text-base font-semibold text-slate-900">
              <Shield className="h-5 w-5 text-blue-600" />
              Linked Controls
              <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-semibold text-blue-800">
                {totalControls}
              </span>
            </h3>
            <p className="mt-1 text-xs text-slate-600">
              Controls applied to this asset across Internal Controls, Framework Controls,
              and the Normalized Control Library. Linking more controls reduces this
              asset's contribution to the tenant's risk score.
            </p>
          </div>
          <InlineLinkPicker
            triggerLabel="+ Link Control"
            items={controlPickerItems}
            isLoading={controlsLoading || isLinkingControl}
            emptyText="No controls available"
            searchPlaceholder="Search controls"
            onSelect={(value) => onLinkControl(Number(value))}
          />
        </div>

        {/* Coverage progress + breakdown */}
        <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-700">Coverage</span>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${coverageTone.text} ${coverageTone.bg} ${coverageTone.border}`}>
                {coverageTone.label}
              </span>
            </div>
            <span className="font-mono font-semibold text-slate-700">
              {totalControls} <span className="text-slate-400">of {CTRL_TARGET} target</span> · {coveragePct}%
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full transition-all ${coverageTone.bar}`} style={{ width: `${coveragePct}%` }} />
          </div>
          {totalControls > 0 && (
            <div className="mt-2 flex gap-4 text-[11px] text-slate-600">
              {fullCount > 0 && <span><span className="inline-block h-2 w-2 rounded-full bg-green-500 mr-1" />{fullCount} fully covered</span>}
              {partialCount > 0 && <span><span className="inline-block h-2 w-2 rounded-full bg-yellow-500 mr-1" />{partialCount} partial</span>}
              {totalControls > fullCount + partialCount && (
                <span><span className="inline-block h-2 w-2 rounded-full bg-slate-400 mr-1" />{totalControls - fullCount - partialCount} not rated</span>
              )}
            </div>
          )}
          {totalControls === 0 && (
            <p className="mt-2 text-[11px] italic text-slate-500">
              No controls linked yet — risk posture treats this dimension as
              unmeasured and excludes it from the score. Link at least one to start scoring.
            </p>
          )}
          {totalControls > 0 && coveragePct < 75 && (
            <p className="mt-2 text-[11px] text-amber-700">
              View the asset's Risk Posture page for a per-dimension contribution
              breakdown — adding more controls reduces the coverage gap and the score.
            </p>
          )}
        </div>
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

// ── Mapping Recommendations tab ──────────────────────────────────────────────
// Regex-driven recommender (no LLM). Backend scores every framework control
// against this asset's profile (OS family, asset type, network exposure, data
// class, criticality, business function, vendor) and returns a ranked list of
// suggested links, grouped by confidence.

interface MatchedSignal {
  key: string;
  label: string;
  weight: number;
}

interface MappingRecommendation {
  framework_control_id: number;
  framework_id: number | null;
  framework_name: string | null;
  framework_short_code: string | null;
  code: string;
  name: string;
  statement: string | null;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  matched_signals: MatchedSignal[];
  negative_notes: string[];
}

interface MappingRecommendationsResponse {
  recommendations: MappingRecommendation[];
  total_controls_scanned: number;
  total_already_linked: number;
  asset_profile: Record<string, unknown>;
}

// Tailwind's JIT only ships CSS for class strings it can see as literals at
// build time. Earlier this code interpolated `bg-${bandColor}-50` — those
// strings never landed in the generated CSS, so the confidence-band headers
// rendered with no color at all. Map keeps every class string literal.
const BAND_CLASSES = {
  high:   { headerBg: 'bg-emerald-50', pillBg: 'bg-emerald-100', pillText: 'text-emerald-800' },
  medium: { headerBg: 'bg-amber-50',   pillBg: 'bg-amber-100',   pillText: 'text-amber-800'   },
  low:    { headerBg: 'bg-slate-50',   pillBg: 'bg-slate-100',   pillText: 'text-slate-800'   },
} as const;

// Each signal in the backend recommender has an `applies(asset)` predicate
// that gates whether the signal can fire. When the asset's underlying field
// is null/empty, the signal is silently skipped — leading to the empty tab
// the user reported. This map lets the empty-state UI tell the operator
// which fields, if filled in, would unlock more recommendations.
const PROFILE_FIELDS_FOR_SIGNALS: Array<{ key: string; label: string; explain: string }> = [
  { key: 'os_family',           label: 'OS family',         explain: 'Windows / Linux / macOS signals' },
  { key: 'vendor',              label: 'Vendor',            explain: 'Microsoft / Red Hat / Cisco / Oracle / AWS signals' },
  { key: 'business_function',   label: 'Business function', explain: 'Payments / Email / Identity / Backup signals' },
  { key: 'data_classification', label: 'Data classification', explain: 'Sensitive-data signals (only fires for confidential / restricted)' },
  { key: 'network_segment',     label: 'Network segment',   explain: 'DMZ / edge / internet-facing exposure signal' },
];

function MappingRecommendationsTab({ assetId }: { assetId: number }) {
  const queryClient = useQueryClient();
  const [frameworkFilter, setFrameworkFilter] = useState<number | ''>('');
  const [minScore, setMinScore] = useState<number>(1);
  const [includeLinked, setIncludeLinked] = useState<boolean>(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [coverageStatus, setCoverageStatus] = useState<'partial' | 'full' | 'minimal'>('partial');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);

  const recsQuery = useQuery<MappingRecommendationsResponse>({
    queryKey: ['asset-mapping-recommendations', assetId, frameworkFilter, minScore, includeLinked],
    queryFn: async () => {
      const params: Record<string, unknown> = { min_score: minScore, limit: 200 };
      if (frameworkFilter !== '') params.framework_id = frameworkFilter;
      if (includeLinked) params.include_linked = true;
      const r = await assetsApi.getMappingRecommendations(assetId, params);
      return r.data;
    },
    enabled: Number.isFinite(assetId) && assetId > 0,
  });

  const acceptMutation = useMutation({
    mutationFn: (ids: number[]) =>
      assetsApi.acceptMappingRecommendations(assetId, ids, coverageStatus),
    onSuccess: (response: { data: { linked: number; skipped_existing: number; skipped_missing: number } }) => {
      const { linked, skipped_existing } = response.data;
      setBannerMessage(
        `Linked ${linked} control${linked === 1 ? '' : 's'}` +
          (skipped_existing ? ` (${skipped_existing} already linked)` : '') +
          '.'
      );
      setSelectedIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['asset-mapping-recommendations', assetId] });
      queryClient.invalidateQueries({ queryKey: ['asset-detail', assetId] });
    },
  });

  const data = recsQuery.data;
  const recs = data?.recommendations || [];

  const frameworkOptions = useMemo(() => {
    const seen = new Map<number, string>();
    recs.forEach((r) => {
      if (r.framework_id != null && r.framework_name && !seen.has(r.framework_id)) {
        seen.set(r.framework_id, r.framework_name);
      }
    });
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [recs]);

  const groups = useMemo(() => {
    const buckets = { high: [] as MappingRecommendation[], medium: [] as MappingRecommendation[], low: [] as MappingRecommendation[] };
    recs.forEach((r) => buckets[r.confidence].push(r));
    return buckets;
  }, [recs]);

  const toggle = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllOfConfidence = (confidence: 'high' | 'medium' | 'low') => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      groups[confidence].forEach((r) => next.add(r.framework_control_id));
      return next;
    });
  };

  const acceptSelected = () => {
    if (selectedIds.size === 0) return;
    acceptMutation.mutate(Array.from(selectedIds));
  };

  const acceptOne = (id: number) => acceptMutation.mutate([id]);

  if (recsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center rounded-lg border border-slate-200 bg-white py-12">
        <PageLoader size="sm" />
      </div>
    );
  }

  if (recsQuery.error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        Failed to load mapping recommendations.
      </div>
    );
  }

  const profile = (data?.asset_profile as Record<string, unknown>) || {};
  const profileChip = (label: string, value: unknown) => {
    const s = value == null || value === '' ? null : Array.isArray(value) ? value.join(', ') : String(value);
    if (!s) return null;
    return (
      <span key={label} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700">
        <span className="font-medium text-slate-500">{label}:</span>
        <span>{s}</span>
      </span>
    );
  };

  return (
    <div className="space-y-4">
      {bannerMessage && (
        <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          <span>{bannerMessage}</span>
          <button
            type="button"
            onClick={() => setBannerMessage(null)}
            className="text-emerald-700 hover:text-emerald-900"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Sparkles className="h-4 w-4 text-amber-500" />
              Auto-suggested framework controls
            </h3>
            <p className="mt-1 text-xs text-slate-600">
              Scanned {data?.total_controls_scanned ?? 0} controls across {frameworkOptions.length} framework{frameworkOptions.length === 1 ? '' : 's'}.{' '}
              {data?.total_already_linked ?? 0} already linked.
            </p>
          </div>
          <div className="text-right text-xs text-slate-500">
            <span className="rounded bg-slate-100 px-2 py-0.5">No LLM · regex-only</span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {profileChip('OS', profile.os_family)}
          {profileChip('Type', profile.asset_type)}
          {profileChip('Vendor', profile.vendor)}
          {profileChip('Criticality', profile.criticality)}
          {profile.internet_facing ? profileChip('Exposure', 'internet-facing') : null}
          {profileChip('Segment', profile.network_segment)}
          {profileChip('Data class', profile.data_classification)}
          {profileChip('Business function', profile.business_function)}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <Filter className="h-3.5 w-3.5 text-slate-500" />
            Framework
            <select
              value={frameworkFilter}
              onChange={(e) => setFrameworkFilter(e.target.value === '' ? '' : Number(e.target.value))}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
            >
              <option value="">All</option>
              {frameworkOptions.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-700">
            Min score
            <input
              type="range"
              min={1}
              max={12}
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="h-1 w-32"
            />
            <span className="w-6 text-center font-medium text-slate-800">{minScore}</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-slate-700">
            <input
              type="checkbox"
              checked={includeLinked}
              onChange={(e) => setIncludeLinked(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            Include already-linked
          </label>
          <div className="ml-auto flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-slate-700">
              Link as
              <select
                value={coverageStatus}
                onChange={(e) => setCoverageStatus(e.target.value as 'partial' | 'full' | 'minimal')}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:border-blue-500 focus:outline-none"
              >
                <option value="partial">Partial</option>
                <option value="full">Full</option>
                <option value="minimal">Minimal</option>
              </select>
            </label>
            <button
              type="button"
              disabled={selectedIds.size === 0 || acceptMutation.isPending}
              onClick={acceptSelected}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {acceptMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Link {selectedIds.size} selected
            </button>
          </div>
        </div>
      </div>

      {recs.length === 0 ? (
        (() => {
          // Surface exactly which signal categories couldn't fire because the
          // backing asset attribute is empty — so the operator sees a concrete
          // checklist instead of generic advice.
          const missing = PROFILE_FIELDS_FOR_SIGNALS.filter((f) => {
            const v = profile[f.key];
            return v == null || v === '' || (Array.isArray(v) && v.length === 0);
          });
          const allLinked = !!data?.total_already_linked
            && (data?.total_controls_scanned ?? 0) > 0;
          return (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 py-10 px-4 text-center">
              <ShieldCheck className="mb-3 h-10 w-10 text-slate-400" />
              <h4 className="text-base font-medium text-slate-900">No new recommendations</h4>
              <p className="mt-1 text-sm text-slate-600 max-w-xl">
                {allLinked
                  ? 'All matched controls are already linked. Toggle "Include already-linked" above to see them.'
                  : 'No framework controls scored above the current threshold. The matcher only fires signals when the asset has the relevant attribute set.'}
              </p>
              {!allLinked && missing.length > 0 && (
                <div className="mt-4 w-full max-w-xl rounded-md border border-slate-200 bg-white p-3 text-left">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    Profile fields to fill in
                  </div>
                  <ul className="mt-2 space-y-1.5">
                    {missing.map((f) => (
                      <li key={f.key} className="flex items-start gap-2 text-xs">
                        <span className="mt-0.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-amber-400" />
                        <div>
                          <span className="font-medium text-slate-800">{f.label}</span>
                          <span className="text-slate-600"> — unlocks {f.explain}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-[11px] text-slate-500">
                    Edit the asset from the Details tab to fill these in — every signal that fires adds its weight to the score.
                  </p>
                </div>
              )}
              {!allLinked && missing.length === 0 && (
                <p className="mt-3 text-xs text-slate-500">
                  Profile looks complete. Try lowering Min score, or check whether seeded frameworks contain controls relevant to this asset type.
                </p>
              )}
            </div>
          );
        })()
      ) : (
        (['high', 'medium', 'low'] as const).map((band) => {
          const list = groups[band];
          if (list.length === 0) return null;
          // Literal class names so Tailwind's JIT can extract them at build
          // time. Template-literal interpolation like `bg-${color}-50` never
          // appears in the generated CSS — that's why the bands were rendering
          // uncolored before. Keep this map literal; no dynamic interpolation.
          const cls = BAND_CLASSES[band];
          return (
            <div key={band} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <div className={`flex items-center justify-between border-b border-slate-200 ${cls.headerBg} px-3 py-2`}>
                <div className="flex items-center gap-2">
                  <span className={`inline-flex h-5 items-center rounded-full ${cls.pillBg} px-2 text-xs font-medium ${cls.pillText} capitalize`}>
                    {band} confidence
                  </span>
                  <span className="text-xs text-slate-600">{list.length} control{list.length === 1 ? '' : 's'}</span>
                </div>
                <button
                  type="button"
                  onClick={() => selectAllOfConfidence(band)}
                  className="text-xs text-blue-700 hover:underline"
                >
                  Select all
                </button>
              </div>
              <ul className="divide-y divide-slate-100">
                {list.map((r) => {
                  const isSelected = selectedIds.has(r.framework_control_id);
                  const isExpanded = expandedId === r.framework_control_id;
                  return (
                    <li key={r.framework_control_id} className={isSelected ? 'bg-blue-50/40' : ''}>
                      <div className="flex items-start gap-3 px-3 py-2.5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggle(r.framework_control_id)}
                          className="mt-1 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700">{r.code}</span>
                            <span className="text-sm font-medium text-slate-900">{r.name}</span>
                            {r.framework_short_code && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-[11px] text-slate-600">
                                <Layers className="h-3 w-3" />
                                {r.framework_short_code}
                              </span>
                            )}
                            <span className={`ml-auto inline-flex items-center rounded-full ${cls.pillBg} px-2 py-0.5 text-[11px] font-medium ${cls.pillText}`}>
                              Score {r.score}
                            </span>
                          </div>
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {r.matched_signals.map((s) => (
                              <span
                                key={s.key}
                                title={`+${s.weight}`}
                                className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-[11px] text-blue-800"
                              >
                                {s.label}
                              </span>
                            ))}
                            {r.negative_notes.map((n, i) => (
                              <span
                                key={`n-${i}`}
                                className="inline-flex items-center rounded-full bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700"
                              >
                                {n}
                              </span>
                            ))}
                          </div>
                          {isExpanded && r.statement && (
                            <p className="mt-2 rounded-md bg-slate-50 p-2 text-xs leading-relaxed text-slate-700">
                              {r.statement}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedId(isExpanded ? null : r.framework_control_id)
                            }
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                            title={isExpanded ? 'Collapse' : 'Show statement'}
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4" />
                            ) : (
                              <ChevronRight className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            disabled={acceptMutation.isPending}
                            onClick={() => acceptOne(r.framework_control_id)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                          >
                            <Plus className="h-3 w-3" /> Link
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })
      )}
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4">
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


// CIS Module Updated drop -- ComplianceTab + NoMappingCallout + ScanSessions
// Ported verbatim from the package so the new Compliance tab on the
// asset page shows AI Classification, Matched benchmark resolution and
// run history. All API calls go through compliancePluginsApi.

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

  // Room-scan selection from the shared context (filled by
  // HostApplicationsPanel as the user ticks peer checkboxes). The existing
  // "Scan now" button below folds these peers into its scan call, and the
  // "X apply to this asset" count adds their rule counts in real time.
  const roomScan = useRoomScan();

  // ip-peers — already cached by HostApplicationsPanel (same key), so this is
  // a free read used only to know whether THIS asset has an integration yet.
  // Drives the "Connect this asset" CTA below for manually-added assets that
  // haven't been onboarded via the Connect Wizard yet.
  const selfIpPeersQ = useQuery({
    queryKey: ['assets', asset.id, 'ip-peers'],
    queryFn: () => assetsApi.getIPPeers(asset.id).then((r: any) => r.data),
  });
  const selfPeerEntry = (selfIpPeersQ.data?.group ?? []).find((g: any) => g.is_self);
  const selfIsConnected: boolean = selfPeerEntry?.is_connected ?? false;
  // Compute the wizard URL: pre-fill hostname + asset_id, and platform when
  // the asset's os_normalized maps cleanly to one of the supported wizard
  // platforms. The wizard auto-advances into the right credential form when
  // platform is set; otherwise it shows the platform-picker first.
  // Browser assets are scanned through the parent host's WinRM/SSH
  // connection (registry-read GPO settings on Windows, preferences-file
  // read on Linux/macOS). They don't have a wizard form of their own —
  // the operator must connect the HOST first and then room-scan from
  // there. The CTA banner adapts when this returns true.
  const isBrowserAsset = (() => {
    const k = (asset.os_normalized || '').toLowerCase();
    if (k.startsWith('firefox') || k.startsWith('edge') || k.startsWith('chrome')) return true;
    const v = ((asset as any).vendor as string | undefined || '').toLowerCase();
    return v === 'mozilla' || v === 'google' || v === 'microsoft edge';
  })();

  const wizPlatformForSelf = (() => {
    if (isBrowserAsset) return null;  // no wizard for browsers — scanned via host
    // Try os_normalized first — that's the canonical signal.
    const k = (asset.os_normalized || '').toLowerCase();
    if (k) {
      if (k.startsWith('windows')) return 'windows';
      if (['ubuntu','linux','debian','centos','rhel','amazon-linux','rocky','almalinux','oraclelinux'].some(p => k.startsWith(p))) return 'linux';
      if (k.startsWith('postgresql') || k.startsWith('postgres')) return 'postgres';
      if (k.startsWith('mysql') || k.startsWith('mariadb')) return 'mysql';
      if (k.startsWith('mssql') || k.startsWith('sql-server')) return 'mssql';
      if (k.startsWith('oracle-db') || k.startsWith('oracle')) return 'oracle';
      if (k.startsWith('iis')) return 'windows';
      if (k.startsWith('tomcat') || k.startsWith('apache') || k.startsWith('nginx')) return 'linux';
    }
    // Fallback to vendor — set when the operator categorised the asset on
    // manual create (e.g. picked PostgreSQL from the vendor dropdown) but
    // didn't fill the OS Profile dropdown. The Add-Asset form's vendor list
    // uses these canonical values so the mapping is direct.
    const v = ((asset as any).vendor as string | undefined || '').toLowerCase();
    if (v) {
      if (v === 'postgresql') return 'postgres';
      if (v === 'mysql') return 'mysql';
      if (v === 'oracle') return 'oracle';
      if (v === 'microsoft' && (asset.asset_type === 'application')) return 'mssql';  // Microsoft + application asset → likely MSSQL
      if (v === 'iis') return 'windows';
      if (v === 'apache' || v === 'nginx' || v === 'tomcat') return 'linux';
      if (v === 'red hat') return 'linux';
      if (v === 'aws') return 'aws';
    }
    return null;
  })();
  const connectWizardHref = (() => {
    const params = new URLSearchParams();
    params.set('asset_id', String(asset.id));
    // Prefer host_name (FQDN) over ip_address — wizard's pre-flight prefers
    // hostnames. Fall back to ip_address so manually-added assets that only
    // have an IP still pre-fill the wizard's Host field instead of starting
    // blank. (`asset` may not carry ip_address on the typed payload, so cast
    // through any.)
    const hostCandidate = (
      asset.host_name
      || ((asset as any).ip_address as string | undefined)
      || ''
    ).trim();
    if (hostCandidate) params.set('hostname', hostCandidate);
    // Pre-fill the wizard's "Friendly label" with the asset's name so the
    // operator doesn't have to retype "postgress" or whatever they called
    // it during manual create. Falls back to the host if name is blank.
    const labelCandidate = (asset.name || hostCandidate || '').trim();
    if (labelCandidate) params.set('label', labelCandidate);
    if (wizPlatformForSelf) params.set('platform', wizPlatformForSelf);
    return `/admin/integrations/connect?${params.toString()}`;
  })();


  const previewQuery = useQuery({
    queryKey: ['compliance-plugins', 'match-preview', asset.id],
    queryFn: () => compliancePluginsApi.matchPreview(asset.id).then((r: any) => r.data),
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
    // Fetch a wide window of runs (~3000) so ScanSessions can group
    // multiple historical scans, not just the last 10 runs.
    queryFn: () => compliancePluginsApi.listRuns({ asset_id: asset.id, limit: 3000 }).then((r: any) => r.data),
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
      const startedAt = Date.now();
      // Capture the max run-id BEFORE we kick off the scan so we can
      // count "runs created since scan start" by simple subtraction.
      // For room-scans we baseline the GLOBAL max — runs land on peer asset
      // ids too, and a per-this-asset baseline would miss them, stalling
      // the progress bar at the opened asset's slice of the union.
      let baselineMaxId = 0;
      try {
        const pre = await compliancePluginsApi.listRuns({ limit: 1 });
        const preList = Array.isArray(pre.data) ? pre.data : (pre.data?.runs || []);
        baselineMaxId = preList[0]?.id ?? 0;
      } catch { /* first-ever scan — baseline stays 0 */ }

      // Fire-and-forget agent push (no-op if no agent installed).
      apiClient.post(`/agents/scan-now-push/${asset.id}`).catch(() => {});

      // Kick off scan-all. New backend behaviour: returns IMMEDIATELY
      // with {queued: true, total: N}. Previously it blocked for
      // minutes which timed out the proxy + browser → spurious 500.
      //
      // Room-scan composition:
      //   - asset_id = the asset the user is currently viewing (the "opened
      //     asset"). Its benchmark is automatically the scan's anchor.
      //   - include_peer_asset_ids = peers the user has ticked. Their
      //     benchmarks are unioned in, and their runs are attributed to
      //     them (so each peer's compliance history reflects the scan).
      // The backend finds the actual connection by walking the IP group
      // from `asset_id` — if the opened asset doesn't have its own
      // integration (e.g. Oracle DB on the demo cluster), the host on the
      // same IP supplies the connection automatically.
      const ticked = roomScan.selectedPeerIds;
      // Capture the post-scan breakdown BEFORE the scan completes, while
      // selection state and peer info are still in scope. This is what the
      // toast renders so the user sees "Oracle 296 + SQL 74 + IIS 51"
      // landed in their respective pages.
      const breakdown: Array<{ id: number; name: string; ruleCount: number }> = [
        { id: asset.id, name: asset.name, ruleCount: applicable.count ?? 0 },
        ...ticked.map(id => ({
          id,
          name: roomScan.peerName(id) ?? `Asset ${id}`,
          ruleCount: roomScan.peerRuleCount(id),
        })),
      ].filter(item => item.ruleCount > 0);
      const resp = await compliancePluginsApi.scanAll({
        asset_id: asset.id,
        include_peer_asset_ids: ticked,
      });
      const scanData = resp.data || {};
      const projectedTotal = scanData.total ?? scanData.executed ?? ((applicable.count ?? 0) + roomScan.selectedPeerRuleSum);
      setScanProgress({ running: true, startedAt, done: 0, total: projectedTotal });

      // Now poll /runs every 2s until either:
      //   a) `done` reaches `projectedTotal` — scan complete
      //   b) 5 minutes elapsed with no new runs — scan stalled
      //   c) 30 minutes total — hard cap
      // The backend's scan_lock is held by the worker thread the whole
      // time, so any spurious "already running" comes from the real
      // scan still in flight.
      const POLL_INTERVAL_MS = 2000;
      const STALL_TIMEOUT_MS = 5 * 60 * 1000;
      const HARD_TIMEOUT_MS = 30 * 60 * 1000;
      let lastDone = 0;
      let lastChangeAt = Date.now();
      const startTime = Date.now();

      // Count runs across the scan's full attribution set (opened asset +
      // each ticked peer), not just the opened one, so room-scans don't
      // stall at the opened asset's slice of the union.
      const attribIds = new Set<number>([asset.id, ...ticked]);
      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        let done = 0;
        try {
          const r = await compliancePluginsApi.listRuns({ limit: 5000 });
          const list = Array.isArray(r.data) ? r.data : (r.data?.runs || []);
          done = list.filter((run: any) =>
            (run.id ?? 0) > baselineMaxId && attribIds.has(run.asset_id)
          ).length;
        } catch { /* transient — keep polling */ }

        setScanProgress((prev) => prev.running ? { ...prev, done } : prev);

        if (done > lastDone) {
          lastDone = done;
          lastChangeAt = Date.now();
        }
        if (projectedTotal > 0 && done >= projectedTotal) break;     // complete
        if (Date.now() - lastChangeAt > STALL_TIMEOUT_MS) break;     // stalled
        if (Date.now() - startTime > HARD_TIMEOUT_MS) break;         // hard cap
      }

      setScanProgress((prev) => ({ ...prev, running: false }));
      // Return a synthetic summary so onSuccess can show a clean toast.
      return { executed: lastDone, projectedTotal, breakdown };
    },
    onSuccess: (data: any) => {
      const executed = data?.executed ?? 0;
      const projected = data?.projectedTotal ?? 0;
      const bd: Array<{ id: number; name: string; ruleCount: number }> = data?.breakdown ?? [];
      // When the scan fanned to multiple assets, lead the toast with the
      // per-asset breakdown so the user can see "Oracle 296 + SQL 74 +
      // IIS 51" — and remember that each peer's runs are also visible on
      // its own asset page. When it was just the opened asset, fall back
      // to the original "X of Y" line.
      const isRoomScan = bd.length > 1;
      const breakdownLine = isRoomScan
        ? bd.map(b => `${b.name} (${b.ruleCount})`).join(' + ')
        : '';
      const headline = projected && executed >= projected
        ? `Scan complete. ${executed} of ${projected} rule(s) finished.`
        : `Scan finished. ${executed} run(s) created${projected ? ` (${projected} projected)` : ''}.`;
      setToast({
        kind: 'success',
        message: isRoomScan
          ? `${headline} Fanned to ${bd.length} assets: ${breakdownLine}. Each asset's runs are visible on its own page.`
          : headline,
      });
      queryClient.invalidateQueries({ queryKey: ['compliance-plugins', 'runs', asset.id] });
      queryClient.invalidateQueries({ queryKey: ['compliance-plugins', 'match-preview', asset.id] });
      // ip-peers feeds the room-scan panel; invalidate so peer rows refresh
      // their scores (transitioning from "Not scanned" to a fresh number)
      // immediately after a room-scan completes.
      queryClient.invalidateQueries({ queryKey: ['assets', asset.id, 'ip-peers'] });
      // Clear the room-scan selection so a fresh tick set is required for
      // the next scan — otherwise stale selections would be silently reused.
      roomScan.clearSelection();
    },
    onError: (e: any) => {
      setScanProgress((prev) => ({ ...prev, running: false }));
      setToast({ kind: 'error', message: e?.response?.data?.detail || e?.message || 'Scan failed' });
    },
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
      {/* "Connect this asset" CTA — top of tab, only when self has no
          integration connection yet. Covers the manual-add case where the
          operator created the asset in IT Assets but never ran the Connect
          Wizard, so nothing can actually scan it. The button opens the
          wizard with platform / hostname / asset_id pre-filled so the
          handshake binds back to THIS asset, not a duplicate row. */}
      {selfIpPeersQ.data && !selfIsConnected && isBrowserAsset && (() => {
        // Find the host (asset_type='infrastructure') that shares the same IP
        // as this browser. ip-peers already returned the group, so just pick
        // it from there. When present, surface a one-click "Open host" link
        // so the operator doesn't have to navigate the inventory manually.
        const peers: any[] = selfIpPeersQ.data?.group ?? [];
        const hostInGroup = peers.find((g: any) => g.is_host_os && !g.is_self);
        return (
          <div className="rounded-xl border border-purple-200 bg-gradient-to-br from-purple-50 to-indigo-50 p-4">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-100 text-purple-700">
                <Network className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-slate-900">
                  Browser asset — scans run through the host (no separate wizard form)
                </h3>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                  A browser has no credentials to enter, so it doesn&apos;t get its own Connect Wizard form.
                  CIS browser benchmarks (Edge / Firefox / Chrome) read browser settings via the parent host&apos;s
                  connection — WinRM-reads registry / GPO on Windows, SSH-reads preferences files on Linux.
                </p>
                <div className="mt-3 rounded-md border border-purple-100 bg-white px-3 py-2.5 text-xs">
                  <p className="font-semibold text-slate-800 mb-1.5">How to scan this browser (3 steps):</p>
                  <ol className="space-y-1 text-slate-600 list-decimal pl-4">
                    <li>Open the <strong>host asset</strong> at IP <code className="font-mono text-slate-700">{asset.ip_address || '—'}</code> (the Windows / Linux machine where this browser is installed).</li>
                    <li>If the host isn&apos;t connected yet, run the <strong>wizard from there</strong> (Windows or Linux platform).</li>
                    <li>On the host&apos;s Compliance tab, this browser will appear in the <strong>Co-located assets</strong> list. Tick it, click <strong>Scan now</strong> — the {(asset as any).os_normalized?.startsWith?.('firefox') ? '90 Firefox' : (asset as any).os_normalized?.startsWith?.('edge') ? '60 Edge' : (asset as any).os_normalized?.startsWith?.('chrome') ? '80 Chrome' : 'browser'} rules fold in and the score writes back to this asset page.</li>
                  </ol>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {hostInGroup ? (
                    <Link
                      href={`/assets/${hostInGroup.id}?tab=compliance`}
                      className="inline-flex items-center gap-1.5 rounded-md bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-purple-700"
                    >
                      <Network className="h-3.5 w-3.5" />
                      Go to host: {hostInGroup.name}
                    </Link>
                  ) : asset.ip_address ? (
                    <Link
                      href={`/assets?ip_address=${encodeURIComponent(asset.ip_address)}`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-purple-300 bg-white px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-50"
                      title="Find the host asset that shares this IP"
                    >
                      Find host at IP {asset.ip_address}
                    </Link>
                  ) : (
                    <span className="text-[11px] text-amber-700">
                      Set this browser&apos;s <strong>IP address</strong> (via Edit) to the host&apos;s IP so the room-scan can group them.
                    </span>
                  )}
                  <Link
                    href="/admin/integrations/connect"
                    className="text-[11px] text-slate-500 hover:text-slate-700 underline"
                    title="Open the Connect Wizard fresh — you'll connect the HOST, not this browser"
                  >
                    Open wizard (to connect the host)
                  </Link>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
      {selfIpPeersQ.data && !selfIsConnected && !isBrowserAsset && (
        <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-100 text-blue-700">
              <Network className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold text-slate-900">
                This asset isn&apos;t connected yet
              </h3>
              <p className="mt-1 text-xs text-slate-600 leading-relaxed">
                Manually-added assets need an integration before they can be scanned.
                Connect via the wizard to pick <strong>Agent</strong> (script the host runs once, then scans itself) or
                {' '}<strong>Agentless</strong> (your backend reaches out over WinRM / SSH / DB protocol with stored credentials).
                {' '}{wizPlatformForSelf
                  ? <>Detected platform: <code className="font-mono text-slate-700">{wizPlatformForSelf}</code> — wizard will jump straight to its credential form.</>
                  : <>OS isn&apos;t set on this asset, so the wizard will start at the platform picker.</>}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Link
                  href={connectWizardHref}
                  className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700"
                >
                  <Zap className="h-3.5 w-3.5" />
                  Connect this asset
                </Link>
                {asset.host_name && (
                  <span className="text-[11px] text-slate-500">
                    will pre-fill hostname <code className="font-mono text-slate-700">{asset.host_name}</code>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

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
            <span className="text-4xl font-bold text-slate-900">
              {(applicable.count ?? 0) + roomScan.selectedPeerRuleSum}
            </span>
            <span className="text-xs text-slate-600">
              {roomScan.selectedPeerIds.length > 0
                ? <>apply to this scan <span className="font-medium text-teal-700">({applicable.count ?? 0} this asset + {roomScan.selectedPeerRuleSum} from {roomScan.selectedPeerIds.length} ticked peer{roomScan.selectedPeerIds.length === 1 ? '' : 's'})</span></>
                : 'apply to this asset'}
            </span>
          </div>
          {stage2.primary_benchmark ? (
            <div className="mt-2 rounded-md border border-indigo-200 bg-white px-2 py-1.5 text-xs">
              <div className="text-slate-500">Primary benchmark</div>
              <div className="mt-0.5 font-medium text-slate-900">{stage2.primary_benchmark}</div>
            </div>
          ) : !osNormalized ? (
            <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-2 text-xs text-amber-900">
              <div className="font-semibold">No OS classified for this asset yet.</div>
              <div className="mt-1">Pick any of the below to populate:</div>
              <ul className="mt-1 list-disc pl-4 space-y-0.5">
                <li>Click <strong>Re-detect OS</strong> above (needs an active credential for this host).</li>
                <li>Onboard via <Link href="/admin/integrations/connect" className="underline">Connect Wizard</Link> — handshake stamps the OS automatically.</li>
                <li>Open <strong>Edit</strong> on this asset and set the OS family / version manually.</li>
              </ul>
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
        // source is 'strict' when an operator-owned BenchmarkOsMapping row
        // resolved this asset, 'soft' when the family-walk fallback picked
        // a benchmark from CompliancePlugin.os_keys, null when neither.
        const mappingSource = mm.source || null;
        const isSoftMatch = mappingSource === 'soft';
        // Room-scan: when peers are ticked, fold their rule counts into the
        // "From matched benchmark" and "Applicable to scan" tiles so the
        // numbers strip agrees with the big "X apply to this scan" header.
        const peerExtra = roomScan.selectedPeerRuleSum;
        const peerCount = roomScan.selectedPeerIds.length;
        const baseCandidates = stage1.kept ?? 0;
        const candidates = baseCandidates + peerExtra;
        const skipped = stage1.skipped ?? 0;
        const baseApplicableN = applicable.count ?? 0;
        const applicableN = baseApplicableN + peerExtra;

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
              {isStrict && !isSoftMatch && (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">
                  Strict
                </span>
              )}
              {isSoftMatch && (
                <span
                  className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-700"
                  title="No operator-owned OS→benchmark mapping exists for this OS. The library family-walk picked the closest benchmark so scans can still run. Add a mapping in admin → mappings to make this explicit."
                >
                  Soft match
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
                  <span className="text-slate-400">{isSoftMatch ? 'family-walk to' : 'matches pattern'}</span>
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
                <p className="text-[11px] text-slate-500">
                  {peerCount > 0
                    ? <>{baseCandidates.toLocaleString()} this asset + <span className="font-medium text-teal-700">{peerExtra.toLocaleString()} from {peerCount} ticked peer{peerCount === 1 ? '' : 's'}</span></>
                    : <>{skipped.toLocaleString()} from other benchmarks skipped</>}
                </p>
              </div>
              <div className="rounded border border-emerald-200 bg-emerald-50/40 p-2.5">
                <div className="text-[10px] font-medium uppercase tracking-wide text-emerald-700">Applicable to scan</div>
                <div className="mt-0.5 text-xl font-semibold text-emerald-900">{applicableN.toLocaleString()}</div>
                <p className="text-[11px] text-slate-500">
                  {total > 0 ? `${Math.round((applicableN / total) * 100)}% of library` : '—'}
                  {peerCount > 0 && <span className="ml-1 text-teal-700">(incl. {peerExtra.toLocaleString()} peer rule{peerExtra === 1 ? '' : 's'})</span>}
                </p>
              </div>
            </div>

            {/* Sample rules from the matched benchmark */}
            {Array.isArray(stage1.examples_kept) && stage1.examples_kept.length > 0 && (
              <div className="mt-3 border-t border-slate-200 pt-3">
                <div className="mb-1 flex items-center gap-2 text-[10px] font-medium uppercase tracking-wide text-slate-500">
                  Sample rules from this benchmark
                  {peerCount > 0 && (
                    <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-medium normal-case text-teal-700 ring-1 ring-teal-200">
                      + {peerExtra.toLocaleString()} more rules from {peerCount} ticked peer{peerCount === 1 ? '' : 's'} (not shown)
                    </span>
                  )}
                </div>
                <ExampleList items={stage1.examples_kept} emptyText="—" />
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
        <div className="p-4">
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
              {(applicable.count ?? 0) + roomScan.selectedPeerRuleSum} applicable rules
              {roomScan.selectedPeerIds.length > 0 && (
                <span className="ml-1 text-teal-700">
                  ({applicable.count ?? 0} this asset + {roomScan.selectedPeerRuleSum} from {roomScan.selectedPeerIds.length} peer{roomScan.selectedPeerIds.length === 1 ? '' : 's'})
                </span>
              )}
              {'. '}Last scan: {formatTime(lastRun?.started_at || lastRun?.created_at)}.
              {' '}Scans also run automatically — agent every 30s when installed, or via your scheduled cron.
            </p>
          </div>
          {/* Scan now — manual trigger. Disabled when:
              - 0 applicable rules (nothing to run — usually means no OS classified)
              - a scan is already in flight (scanProgress.running or scanMutation.isPending)
              The backend rejects with a clear 400 when the asset has no
              integration connection, so we let the click fire and surface
              the error in the toast instead of trying to pre-detect here. */}
          <button
            type="button"
            onClick={() => scanMutation.mutate()}
            disabled={
              ((applicable.count ?? 0) + roomScan.selectedPeerRuleSum) === 0 ||
              scanMutation.isPending ||
              scanProgress.running
            }
            className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 transition-colors hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
            title={
              ((applicable.count ?? 0) + roomScan.selectedPeerRuleSum) === 0
                ? 'No applicable rules. Classify the OS first (Re-detect OS or Edit the asset).'
                : scanProgress.running || scanMutation.isPending
                ? 'A scan is already running.'
                : roomScan.selectedPeerIds.length > 0
                  ? `Scan ${applicable.count ?? 0} rules for this asset + ${roomScan.selectedPeerRuleSum} from ${roomScan.selectedPeerIds.length} ticked peer(s). Results fan out to each.`
                  : `Scan ${applicable.count ?? 0} rules now`
            }
          >
            {scanMutation.isPending || scanProgress.running ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Scanning…
              </>
            ) : roomScan.selectedPeerIds.length > 0 ? (
              <>
                <Play className="h-3.5 w-3.5" /> Scan now (+{roomScan.selectedPeerIds.length} peer{roomScan.selectedPeerIds.length === 1 ? '' : 's'})
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" /> Scan now
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
            href="/compliance-plugins/os-registry"
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
                  href="/compliance-plugins/os-registry"
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
                href="/compliance-plugins/ingest"
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

      {sessions.map((session: any) => {
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
