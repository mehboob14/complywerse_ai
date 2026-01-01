'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { assetsApi, controlsApi, evidenceApi } from '@/lib/api';
import { 
  ArrowLeft, Loader2, AlertCircle, Shield, DollarSign, 
  Target, TrendingUp, Link as LinkIcon, FileCheck, AlertTriangle,
  ClipboardList, History, Plus, X, Trash2, Edit, RefreshCw,
  AppWindow, HardDrive, Database, Cloud, Building2,
  Lock, ShieldCheck, Zap, Calendar, MapPin, User, Building, Search
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

type TabType = 'details' | 'controls' | 'evidence' | 'risks' | 'assessments';

interface LinkedControl {
  id: number;
  control_id: number;
  code: string;
  name: string;
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
  linked_framework_controls: LinkedFrameworkControl[];
  linked_risks: Array<{ risk_id: number }>;
  linked_evidence: LinkedEvidence[];
  risk_assessments: RiskAssessment[];
  coverage_percentage: number;
}

export default function AssetDetailPage() {
  const params = useParams();
  const router = useRouter();
  const assetId = Number(params.id);
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabType>('details');
  const [showLinkControlModal, setShowLinkControlModal] = useState(false);
  const [showLinkEvidenceModal, setShowLinkEvidenceModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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

  const { data: allControls } = useQuery({
    queryKey: ['all-normalized-controls'],
    queryFn: async () => {
      const response = await controlsApi.getNormalized();
      return response.data;
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

  const unlinkControlMutation = useMutation({
    mutationFn: (linkId: number) => assetsApi.unlinkFrameworkControl(assetId, linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-detail', assetId] });
    },
  });

  const unlinkEvidenceMutation = useMutation({
    mutationFn: (linkId: number) => assetsApi.unlinkEvidence(assetId, linkId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-detail', assetId] });
    },
  });

  const linkControlMutation = useMutation({
    mutationFn: (data: { framework_control_id: number; coverage_status?: string }) => 
      assetsApi.linkFrameworkControl(assetId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-detail', assetId] });
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

  const getAssetIcon = (type: string) => {
    const Icon = ASSET_TYPE_ICONS[type] || AppWindow;
    return <Icon className="h-6 w-6" />;
  };

  const getStatusBadge = (status: string) => {
    const colors: Record<string, string> = {
      active: 'bg-green-900/50 text-green-400 border-green-700',
      inactive: 'bg-yellow-900/50 text-yellow-400 border-yellow-700',
      decommissioned: 'bg-slate-700 text-slate-400 border-slate-600',
    };
    return (
      <span className={`rounded-full border px-3 py-1 text-sm ${colors[status] || 'bg-slate-700 text-slate-400 border-slate-600'}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
  };

  const getCriticalityBadge = (criticality: string) => {
    const colors: Record<string, string> = {
      critical: 'bg-red-900/50 text-red-400 border-red-700',
      high: 'bg-orange-900/50 text-orange-400 border-orange-700',
      medium: 'bg-yellow-900/50 text-yellow-400 border-yellow-700',
      low: 'bg-green-900/50 text-green-400 border-green-700',
    };
    return (
      <span className={`rounded-full border px-3 py-1 text-sm ${colors[criticality] || 'bg-slate-700 text-slate-400 border-slate-600'}`}>
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
        <span className="w-32 text-sm text-slate-400">{label}</span>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className={`h-4 w-6 rounded ${i <= value ? color : 'bg-slate-700'}`}
            />
          ))}
        </div>
        <span className="text-sm text-white">{value}/5</span>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (error || !asset) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-red-400">
        <AlertCircle className="mb-2 h-8 w-8" />
        <p>Failed to load asset details</p>
        <Link href="/assets" className="mt-4 text-primary-400 hover:underline">
          Back to Assets
        </Link>
      </div>
    );
  }

  const latestAssessment = asset.risk_assessments?.length > 0 
    ? asset.risk_assessments.sort((a, b) => new Date(b.assessment_date).getTime() - new Date(a.assessment_date).getTime())[0]
    : null;

  const tabs: { id: TabType; label: string; icon: React.ElementType }[] = [
    { id: 'details', label: 'Details', icon: ClipboardList },
    { id: 'controls', label: 'Controls', icon: Shield },
    { id: 'evidence', label: 'Evidence', icon: FileCheck },
    { id: 'risks', label: 'Risks', icon: AlertTriangle },
    { id: 'assessments', label: 'Assessments', icon: History },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/assets"
          className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-900/50 text-primary-400">
              {getAssetIcon(asset.asset_type)}
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">{asset.name}</h1>
              <p className="text-slate-400">{asset.description || 'No description'}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full bg-primary-900/50 px-3 py-1 text-sm text-primary-400">
            {ASSET_TYPE_LABELS[asset.asset_type] || asset.asset_type}
          </span>
          {getStatusBadge(asset.status)}
          {getCriticalityBadge(asset.criticality)}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="flex items-center gap-2 rounded-lg bg-slate-700 px-4 py-2 text-white hover:bg-slate-600"
            title="Edit Asset"
          >
            <Edit className="h-4 w-4" />
            Edit
          </button>
          <button
            onClick={() => assessRiskMutation.mutate()}
            disabled={assessRiskMutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-white hover:bg-primary-700 disabled:opacity-50"
            title="Assess Risk"
          >
            {assessRiskMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Assess Risk
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-2 rounded-lg bg-red-900/50 px-4 py-2 text-red-400 hover:bg-red-900/80"
            title="Delete Asset"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <div className="mb-3 flex items-center gap-2 text-slate-400">
            <Lock className="h-4 w-4" />
            <span className="text-sm font-medium">CIA Ratings</span>
          </div>
          <div className="space-y-2">
            <CIARatingBar rating={asset.confidentiality_rating || 0} label="Confidentiality" color="bg-blue-500" />
            <CIARatingBar rating={asset.integrity_rating || 0} label="Integrity" color="bg-green-500" />
            <CIARatingBar rating={asset.availability_rating || 0} label="Availability" color="bg-yellow-500" />
          </div>
        </div>

        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <div className="mb-3 flex items-center gap-2 text-slate-400">
            <DollarSign className="h-4 w-4" />
            <span className="text-sm font-medium">Valuation</span>
          </div>
          <div className="text-3xl font-bold text-green-400">
            {formatCurrency(asset.valuation)}
          </div>
          <p className="mt-2 text-sm text-slate-500">Estimated asset value</p>
        </div>

        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <div className="mb-3 flex items-center gap-2 text-slate-400">
            <Target className="h-4 w-4" />
            <span className="text-sm font-medium">Control Coverage</span>
          </div>
          <div className="text-3xl font-bold text-primary-400">
            {coverage?.coverage_percentage ?? asset.coverage_percentage ?? 0}%
          </div>
          <div className="mt-2">
            <div className="h-2 w-full rounded-full bg-slate-700">
              <div 
                className="h-2 rounded-full bg-primary-500 transition-all"
                style={{ width: `${coverage?.coverage_percentage ?? asset.coverage_percentage ?? 0}%` }}
              />
            </div>
          </div>
          <p className="mt-2 text-sm text-slate-500">
            {(asset.linked_controls?.length || 0) + (asset.linked_framework_controls?.length || 0)} controls linked
          </p>
        </div>

        <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
          <div className="mb-3 flex items-center gap-2 text-slate-400">
            <TrendingUp className="h-4 w-4" />
            <span className="text-sm font-medium">Risk Score</span>
          </div>
          {latestAssessment ? (
            <>
              <div className={`text-3xl font-bold ${
                latestAssessment.risk_score >= 7 ? 'text-red-400' :
                latestAssessment.risk_score >= 4 ? 'text-yellow-400' : 'text-green-400'
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

      <div className="border-b border-slate-700">
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
                    : 'border-transparent text-slate-400 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="rounded-lg border border-slate-700 bg-slate-800 p-6">
        {activeTab === 'details' && (
          <DetailsTab asset={asset} />
        )}
        {activeTab === 'controls' && (
          <ControlsTab
            asset={asset}
            onLinkControl={() => setShowLinkControlModal(true)}
            onUnlinkControl={(linkId) => unlinkControlMutation.mutate(linkId)}
            isUnlinking={unlinkControlMutation.isPending}
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
        {activeTab === 'risks' && (
          <RisksTab asset={asset} />
        )}
        {activeTab === 'assessments' && (
          <AssessmentsTab 
            asset={asset} 
            onAssess={() => assessRiskMutation.mutate()}
            isAssessing={assessRiskMutation.isPending}
          />
        )}
      </div>

      {showLinkControlModal && (
        <LinkControlModal
          onClose={() => setShowLinkControlModal(false)}
          onLink={(controlId, coverageStatus) => linkControlMutation.mutate({ 
            framework_control_id: controlId, 
            coverage_status: coverageStatus 
          })}
          isLinking={linkControlMutation.isPending}
          linkedControlIds={asset.linked_framework_controls?.map(c => c.framework_control_id) || []}
          allControls={allControls || []}
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

      {showDeleteConfirm && (
        <DeleteConfirmModal
          assetName={asset.name}
          onClose={() => setShowDeleteConfirm(false)}
          onConfirm={() => deleteMutation.mutate()}
          isDeleting={deleteMutation.isPending}
        />
      )}
    </div>
  );
}

function DetailsTab({ asset }: { asset: AssetDetailData }) {
  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
          <ClipboardList className="h-5 w-5 text-primary-400" />
          Basic Information
        </h3>
        <div className="space-y-3">
          <div>
            <span className="text-sm text-slate-400">Asset Name</span>
            <p className="text-white">{asset.name}</p>
          </div>
          <div>
            <span className="text-sm text-slate-400">Description</span>
            <p className="text-white">{asset.description || 'No description provided'}</p>
          </div>
          <div>
            <span className="text-sm text-slate-400">Asset Type</span>
            <p className="text-white">{ASSET_TYPE_LABELS[asset.asset_type] || asset.asset_type}</p>
          </div>
          <div>
            <span className="text-sm text-slate-400">Criticality</span>
            <p className="text-white capitalize">{asset.criticality}</p>
          </div>
          <div>
            <span className="text-sm text-slate-400">Status</span>
            <p className="text-white capitalize">{asset.status}</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
          <User className="h-5 w-5 text-primary-400" />
          Ownership & Vendor
        </h3>
        <div className="space-y-3">
          <div>
            <span className="text-sm text-slate-400">Owner</span>
            <p className="text-white">{asset.owner_name || 'Not assigned'}</p>
          </div>
          <div>
            <span className="text-sm text-slate-400">Vendor</span>
            <p className="text-white">{asset.vendor || 'N/A'}</p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
          <MapPin className="h-5 w-5 text-primary-400" />
          Location & Timestamps
        </h3>
        <div className="space-y-3">
          <div>
            <span className="text-sm text-slate-400">Location</span>
            <p className="text-white">{asset.location || 'Unknown'}</p>
          </div>
          <div>
            <span className="text-sm text-slate-400">Created</span>
            <p className="text-white">
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
  onUnlinkControl,
  isUnlinking 
}: { 
  asset: AssetDetailData; 
  onLinkControl: () => void;
  onUnlinkControl: (linkId: number) => void;
  isUnlinking: boolean;
}) {
  const totalControls = (asset.linked_controls?.length || 0) + (asset.linked_framework_controls?.length || 0);
  
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
          <Shield className="h-5 w-5 text-primary-400" />
          Linked Controls ({totalControls})
        </h3>
        <button
          onClick={onLinkControl}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700"
        >
          <Plus className="h-4 w-4" />
          Link Control
        </button>
      </div>

      {asset.linked_controls && asset.linked_controls.length > 0 && (
        <div>
          <h4 className="mb-3 text-sm font-medium text-slate-400">Normalized Controls</h4>
          <div className="space-y-2">
            {asset.linked_controls.map((control) => (
              <div key={control.id} className="flex items-center justify-between rounded-lg bg-slate-900 p-3">
                <div className="flex items-center gap-3">
                  <ShieldCheck className="h-5 w-5 text-primary-400" />
                  <div>
                    <span className="text-sm font-medium text-primary-400">{control.code}</span>
                    <p className="text-white">{control.name}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {asset.linked_framework_controls && asset.linked_framework_controls.length > 0 && (
        <div>
          <h4 className="mb-3 text-sm font-medium text-slate-400">Framework Controls</h4>
          <div className="space-y-2">
            {asset.linked_framework_controls.map((control) => (
              <div key={control.id} className="flex items-center justify-between rounded-lg bg-slate-900 p-3">
                <div className="flex items-center gap-3">
                  <Shield className="h-5 w-5 text-blue-400" />
                  <div>
                    <span className="text-sm font-medium text-blue-400">{control.code}</span>
                    <p className="text-white">{control.name}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${
                    control.coverage_status === 'full' ? 'bg-green-900/50 text-green-400' :
                    control.coverage_status === 'partial' ? 'bg-yellow-900/50 text-yellow-400' :
                    'bg-slate-700 text-slate-400'
                  }`}>
                    {control.coverage_status || 'Not set'}
                  </span>
                </div>
                <button
                  onClick={() => onUnlinkControl(control.id)}
                  disabled={isUnlinking}
                  className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-red-400 disabled:opacity-50"
                  title="Unlink Control"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {totalControls === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Shield className="mb-4 h-12 w-12 text-slate-600" />
          <h4 className="text-lg font-medium text-white">No Controls Linked</h4>
          <p className="mt-1 text-slate-400">Link controls to this asset for compliance tracking</p>
          <button
            onClick={onLinkControl}
            className="mt-4 flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700"
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
    supports: 'bg-green-900/50 text-green-400',
    validates: 'bg-blue-900/50 text-blue-400',
    documents: 'bg-purple-900/50 text-purple-400',
  };
  
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
          <FileCheck className="h-5 w-5 text-primary-400" />
          Linked Evidence ({asset.linked_evidence?.length || 0})
        </h3>
        <button
          onClick={onLinkEvidence}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700"
        >
          <Plus className="h-4 w-4" />
          Link Evidence
        </button>
      </div>

      {asset.linked_evidence && asset.linked_evidence.length > 0 ? (
        <div className="space-y-2">
          {asset.linked_evidence.map((evidence) => (
            <div key={evidence.id} className="flex items-center justify-between rounded-lg bg-slate-900 p-3">
              <div className="flex items-center gap-3">
                <FileCheck className="h-5 w-5 text-emerald-400" />
                <div>
                  <p className="text-white">{evidence.name}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs ${relationshipColors[evidence.relationship_type] || 'bg-slate-700 text-slate-400'}`}>
                  {evidence.relationship_type}
                </span>
              </div>
              <button
                onClick={() => onUnlinkEvidence(evidence.id)}
                disabled={isUnlinking}
                className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-red-400 disabled:opacity-50"
                title="Unlink Evidence"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <FileCheck className="mb-4 h-12 w-12 text-slate-600" />
          <h4 className="text-lg font-medium text-white">No Evidence Linked</h4>
          <p className="mt-1 text-slate-400">Link evidence items to document this asset</p>
          <button
            onClick={onLinkEvidence}
            className="mt-4 flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700"
          >
            <Plus className="h-4 w-4" />
            Link First Evidence
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
        <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
          <AlertTriangle className="h-5 w-5 text-primary-400" />
          Associated Risks ({asset.linked_risks?.length || 0})
        </h3>
      </div>

      {asset.linked_risks && asset.linked_risks.length > 0 ? (
        <div className="space-y-2">
          {asset.linked_risks.map((risk, idx) => (
            <div key={idx} className="flex items-center justify-between rounded-lg bg-slate-900 p-3">
              <div className="flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-orange-400" />
                <p className="text-white">Risk ID: {risk.risk_id}</p>
              </div>
              <Link 
                href={`/risks/${risk.risk_id}`}
                className="text-sm text-primary-400 hover:underline"
              >
                View Details
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <AlertTriangle className="mb-4 h-12 w-12 text-slate-600" />
          <h4 className="text-lg font-medium text-white">No Associated Risks</h4>
          <p className="mt-1 text-slate-400">No risks have been linked to this asset</p>
        </div>
      )}
    </div>
  );
}

function AssessmentsTab({ 
  asset, 
  onAssess,
  isAssessing 
}: { 
  asset: AssetDetailData; 
  onAssess: () => void;
  isAssessing: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-lg font-semibold text-white">
          <History className="h-5 w-5 text-primary-400" />
          Risk Assessment History ({asset.risk_assessments?.length || 0})
        </h3>
        <button
          onClick={onAssess}
          disabled={isAssessing}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {isAssessing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          New Assessment
        </button>
      </div>

      {asset.risk_assessments && asset.risk_assessments.length > 0 ? (
        <div className="space-y-3">
          {asset.risk_assessments
            .sort((a, b) => new Date(b.assessment_date).getTime() - new Date(a.assessment_date).getTime())
            .map((assessment) => (
              <div key={assessment.id} className="rounded-lg bg-slate-900 p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${
                      assessment.risk_score >= 7 ? 'bg-red-900/50 text-red-400' :
                      assessment.risk_score >= 4 ? 'bg-yellow-900/50 text-yellow-400' : 
                      'bg-green-900/50 text-green-400'
                    }`}>
                      <span className="text-lg font-bold">{assessment.risk_score.toFixed(1)}</span>
                    </div>
                    <div>
                      <p className="font-medium text-white">
                        {new Date(assessment.assessment_date).toLocaleDateString('en-US', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                      <p className="text-sm text-slate-400">
                        Coverage: {assessment.coverage_percentage.toFixed(0)}%
                      </p>
                    </div>
                  </div>
                  {assessment.gaps && (
                    <div className="text-right">
                      <p className="text-sm text-slate-400">
                        Missing Controls: {(assessment.gaps as Record<string, number>).missing_controls || 0}
                      </p>
                    </div>
                  )}
                </div>
                {assessment.gaps && (assessment.gaps as Record<string, string[]>).recommendations?.length > 0 && (
                  <div className="mt-3 border-t border-slate-800 pt-3">
                    <p className="mb-2 text-sm font-medium text-slate-400">Recommendations</p>
                    <ul className="space-y-1">
                      {((assessment.gaps as Record<string, string[]>).recommendations || []).map((rec: string, idx: number) => (
                        <li key={idx} className="flex items-center gap-2 text-sm text-slate-300">
                          <Zap className="h-3 w-3 text-yellow-400" />
                          {rec}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <History className="mb-4 h-12 w-12 text-slate-600" />
          <h4 className="text-lg font-medium text-white">No Assessments Yet</h4>
          <p className="mt-1 text-slate-400">Run a risk assessment to evaluate this asset</p>
          <button
            onClick={onAssess}
            disabled={isAssessing}
            className="mt-4 flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {isAssessing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Run First Assessment
          </button>
        </div>
      )}
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
  onLink: (controlId: number, coverageStatus: string) => void;
  isLinking: boolean;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl rounded-lg border border-slate-700 bg-slate-900 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Link Control</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search controls..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-slate-600 bg-slate-800 py-2 pl-10 pr-4 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none"
          />
        </div>

        <div className="mb-4 max-h-64 overflow-y-auto rounded-lg border border-slate-700">
          {filteredControls.length > 0 ? (
            filteredControls.map((control) => (
              <button
                key={control.id}
                onClick={() => setSelectedControl(Number(control.id))}
                className={`flex w-full items-center gap-3 border-b border-slate-700 p-3 text-left last:border-0 ${
                  selectedControl === Number(control.id) ? 'bg-primary-900/30' : 'hover:bg-slate-800'
                }`}
              >
                <Shield className={`h-5 w-5 ${selectedControl === Number(control.id) ? 'text-primary-400' : 'text-slate-400'}`} />
                <div>
                  <span className="text-sm font-medium text-primary-400">{control.internal_id || control.id}</span>
                  <p className="text-white">{control.name}</p>
                  {control.category && (
                    <span className="text-xs text-slate-400">{control.category}</span>
                  )}
                </div>
              </button>
            ))
          ) : (
            <div className="p-4 text-center text-slate-400">
              {allControls.length === 0 ? 'Loading controls...' : 'No controls found'}
            </div>
          )}
        </div>

        {selectedControl && (
          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium text-slate-300">Coverage Status</label>
            <select
              value={coverageStatus}
              onChange={(e) => setCoverageStatus(e.target.value)}
              className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
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
            className="rounded-lg border border-slate-600 px-4 py-2 text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            onClick={() => selectedControl && onLink(selectedControl, coverageStatus)}
            disabled={!selectedControl || isLinking}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-white hover:bg-primary-700 disabled:opacity-50"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl rounded-lg border border-slate-700 bg-slate-900 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-white">Link Evidence</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
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
            className="w-full rounded-lg border border-slate-600 bg-slate-800 py-2 pl-10 pr-4 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none"
          />
        </div>

        <div className="mb-4 max-h-64 overflow-y-auto rounded-lg border border-slate-700">
          {filteredEvidence.length > 0 ? (
            filteredEvidence.map((evidence) => (
              <button
                key={evidence.id}
                onClick={() => setSelectedEvidence(Number(evidence.id))}
                className={`flex w-full items-center gap-3 border-b border-slate-700 p-3 text-left last:border-0 ${
                  selectedEvidence === Number(evidence.id) ? 'bg-primary-900/30' : 'hover:bg-slate-800'
                }`}
              >
                <FileCheck className={`h-5 w-5 ${selectedEvidence === Number(evidence.id) ? 'text-primary-400' : 'text-slate-400'}`} />
                <div>
                  <p className="text-white">{evidence.title || evidence.name}</p>
                  {evidence.evidence_type && (
                    <span className="text-xs text-slate-400">{evidence.evidence_type}</span>
                  )}
                </div>
              </button>
            ))
          ) : (
            <div className="p-4 text-center text-slate-400">
              {allEvidence.length === 0 ? 'Loading evidence...' : 'No evidence found'}
            </div>
          )}
        </div>

        {selectedEvidence && (
          <div className="mb-4">
            <label className="mb-2 block text-sm font-medium text-slate-300">Relationship Type</label>
            <select
              value={relationshipType}
              onChange={(e) => setRelationshipType(e.target.value)}
              className="w-full rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
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
            className="rounded-lg border border-slate-600 px-4 py-2 text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            onClick={() => selectedEvidence && onLink(selectedEvidence, relationshipType)}
            disabled={!selectedEvidence || isLinking}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-white hover:bg-primary-700 disabled:opacity-50"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 p-6">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-900/50">
            <AlertTriangle className="h-5 w-5 text-red-400" />
          </div>
          <h2 className="text-xl font-bold text-white">Delete Asset</h2>
        </div>

        <p className="mb-6 text-slate-300">
          Are you sure you want to delete <strong className="text-white">{assetName}</strong>? This action cannot be undone. All linked controls, evidence, and assessments will be unlinked.
        </p>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-600 px-4 py-2 text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-white hover:bg-red-700 disabled:opacity-50"
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
