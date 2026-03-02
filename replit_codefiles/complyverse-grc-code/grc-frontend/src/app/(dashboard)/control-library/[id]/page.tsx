'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient, { frameworksApi, controlsApi } from '@/lib/api';
import { 
  ArrowLeft, Loader2, AlertCircle, Shield, Calendar, Tag,
  Edit2, Sparkles, Trash2, Plus, X, Search, Layers, GitMerge,
  FileCheck, Link2, Eye, RefreshCw, Brain, ChevronDown, ChevronRight,
  CheckCircle, Clock, AlertTriangle, Filter, Lightbulb, Info
} from 'lucide-react';
import Link from 'next/link';

type TabType = 'controls' | 'similarity' | 'evidence' | 'inheritance';

interface NormalizedControlItem {
  mapping_id: number;
  control_id: number;
  code: string;
  name: string;
  statement: string | null;
  mapping_confidence: number | null;
  mapping_source: string | null;
}

interface FrameworkControlItem {
  mapping_id: number;
  control_id: number;
  code: string;
  name: string;
  statement: string | null;
  framework_id: number | null;
  framework_name: string | null;
  framework_code: string | null;
  mapping_confidence: number | null;
  mapping_source: string | null;
}

interface ParsedControlItem {
  mapping_id: number;
  control_id: number;
  code: string;
  name: string;
  statement: string | null;
  framework_id: number | null;
  framework_name: string | null;
  mapping_confidence: number | null;
  mapping_source: string | null;
}

interface ControlGroupDetail {
  id: number;
  tenant_id: number;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  domain: string | null;
  keywords: string[];
  ai_summary: string | null;
  evidence_types: string[];
  normalized_control_count: number;
  framework_control_count: number;
  parsed_control_count: number;
  total_control_count: number;
  created_at: string | null;
  updated_at: string | null;
  created_by: number | null;
  normalized_controls: NormalizedControlItem[];
  framework_controls: FrameworkControlItem[];
  parsed_controls: ParsedControlItem[];
}

interface FrameworkBreakdown {
  framework_id: number;
  framework_name: string;
  framework_code: string;
  control_count: number;
}

interface FrameworksResponse {
  group_id: number;
  group_name: string;
  normalized_control_count: number;
  frameworks: FrameworkBreakdown[];
}

interface EvidenceRecommendation {
  id: number;
  tenant_id: number;
  group_id: number | null;
  normalized_control_id: number | null;
  framework_control_id: number | null;
  evidence_type: string;
  evidence_description: string | null;
  priority: string;
  ai_confidence: number | null;
  ai_reasoning: string | null;
  sample_evidence_names: string[];
  created_at: string;
  control_name: string | null;
  control_code: string | null;
  framework_name: string | null;
  group_name: string | null;
}

interface InheritanceItem {
  inheritance_id: number;
  inheritance_type: string;
  coverage_percentage: number;
  condition_description: string | null;
  control: {
    id: number;
    type: string;
    code: string;
    name: string;
    statement: string | null;
    framework_id?: number;
    framework_name?: string;
    framework_code?: string;
  };
}

interface SimilarityItem {
  id: number;
  control1_type: string;
  control1_id: number;
  control1_code: string;
  control1_name: string;
  control2_type: string;
  control2_id: number;
  control2_code: string;
  control2_name: string;
  control1_framework: string;
  control2_framework: string;
  similarity_score: number;
  ai_reasoning: string | null;
}

const PRIORITY_STYLES: Record<string, { bg: string; text: string }> = {
  critical: { bg: 'bg-red-500/20', text: 'text-red-400' },
  high: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
  medium: { bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
  low: { bg: 'bg-green-500/20', text: 'text-green-400' },
};

const SOURCE_STYLES: Record<string, { bg: string; text: string }> = {
  manual: { bg: 'bg-slate-500/20', text: 'text-slate-400' },
  ai: { bg: 'bg-purple-500/20', text: 'text-purple-400' },
  import: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
};

export default function ControlGroupDetailPage() {
  const params = useParams();
  const router = useRouter();
  const groupId = Number(params.id);
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabType>('controls');
  const [frameworkFilter, setFrameworkFilter] = useState<number | null>(null);
  const [groupByFramework, setGroupByFramework] = useState(false);
  const [showAddControlsModal, setShowAddControlsModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  const { data: group, isLoading, error } = useQuery<ControlGroupDetail>({
    queryKey: ['control-group-detail', groupId],
    queryFn: async () => {
      const response = await apiClient.get(`/control-library/groups/${groupId}`);
      return response.data;
    },
  });

  const { data: frameworksData } = useQuery<FrameworksResponse>({
    queryKey: ['control-group-frameworks', groupId],
    queryFn: async () => {
      const response = await apiClient.get(`/control-library/groups/${groupId}/frameworks`);
      return response.data;
    },
  });

  const { data: evidenceRecs, refetch: refetchEvidence } = useQuery<{ recommendations: EvidenceRecommendation[] }>({
    queryKey: ['control-group-evidence-recs', groupId],
    queryFn: async () => {
      const response = await apiClient.get(`/control-library/evidence-recs/for-group/${groupId}`);
      return response.data;
    },
    enabled: activeTab === 'evidence',
  });

  const { data: similarities } = useQuery<{ items: SimilarityItem[] }>({
    queryKey: ['control-group-similarities', groupId],
    queryFn: async () => {
      const response = await apiClient.get(`/control-library/groups/${groupId}/similarities`);
      return response.data;
    },
    enabled: activeTab === 'similarity',
  });

  const generateSummaryMutation = useMutation({
    mutationFn: () => apiClient.post(`/control-library/groups/${groupId}/generate-summary`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['control-group-detail', groupId] });
    },
  });

  const updateGroupMutation = useMutation({
    mutationFn: (data: Partial<ControlGroupDetail>) =>
      apiClient.put(`/control-library/groups/${groupId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['control-group-detail', groupId] });
      setShowEditModal(false);
    },
  });

  const removeControlMutation = useMutation({
    mutationFn: (mappingId: number) =>
      apiClient.delete(`/control-library/groups/${groupId}/controls/${mappingId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['control-group-detail', groupId] });
      queryClient.invalidateQueries({ queryKey: ['control-group-frameworks', groupId] });
    },
  });

  const generateEvidenceRecsMutation = useMutation({
    mutationFn: () => apiClient.post(`/control-library/evidence-recs/generate-for-group/${groupId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['control-group-evidence-recs', groupId] });
      refetchEvidence();
    },
  });

  const populateFromFrameworksMutation = useMutation({
    mutationFn: () => apiClient.post(`/control-library/groups/${groupId}/populate-from-frameworks`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['control-group-detail', groupId] });
      queryClient.invalidateQueries({ queryKey: ['control-group-frameworks', groupId] });
    },
  });

  const formatDate = (dateString?: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const getPriorityStyle = (priority: string) => {
    return PRIORITY_STYLES[priority] || PRIORITY_STYLES.medium;
  };

  const getSourceStyle = (source: string | null) => {
    return SOURCE_STYLES[source || 'manual'] || SOURCE_STYLES.manual;
  };

  const getConfidenceBadge = (confidence: number | null) => {
    if (confidence === null) return null;
    const percent = Math.round(confidence * 100);
    let color = 'text-green-400';
    if (percent < 60) color = 'text-red-400';
    else if (percent < 80) color = 'text-yellow-400';
    return (
      <span className={`text-xs ${color}`}>
        {percent}%
      </span>
    );
  };

  const getFilteredControls = () => {
    if (!group) return { normalized: [], framework: [], parsed: [] };
    let normalized = group.normalized_controls || [];
    let framework = group.framework_controls || [];
    let parsed = group.parsed_controls || [];
    if (frameworkFilter !== null) {
      framework = framework.filter(c => c.framework_id === frameworkFilter);
      parsed = parsed.filter(c => c.framework_id === frameworkFilter);
      normalized = [];
    }
    return { normalized, framework, parsed };
  };

  const groupControlsByFramework = () => {
    if (!group) return {};
    const groups: Record<string, (FrameworkControlItem | ParsedControlItem)[]> = {};
    for (const control of group.framework_controls || []) {
      const key = control.framework_name || 'Unknown Framework';
      if (!groups[key]) groups[key] = [];
      groups[key].push(control);
    }
    for (const control of group.parsed_controls || []) {
      const key = control.framework_name || 'Unknown Framework';
      if (!groups[key]) groups[key] = [];
      groups[key].push(control);
    }
    return groups;
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (error || !group) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-red-400">
        <AlertCircle className="mb-2 h-8 w-8" />
        <p>Failed to load control group details</p>
        <Link href="/control-library" className="mt-4 text-primary-400 hover:underline">
          Back to Control Library
        </Link>
      </div>
    );
  }

  const tabs: { id: TabType; label: string; icon: React.ElementType }[] = [
    { id: 'controls', label: 'Mapped Controls', icon: Shield },
    { id: 'similarity', label: 'Similarity Analysis', icon: GitMerge },
    { id: 'evidence', label: 'Evidence Recommendations', icon: FileCheck },
    { id: 'inheritance', label: 'Inheritance', icon: Link2 },
  ];

  const filteredControls = getFilteredControls();
  const groupedControls = groupControlsByFramework();

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-4">
        <Link
          href="/control-library"
          className="mt-1 rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-900/50 text-primary-400">
              <Layers className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-medium text-primary-400">{group.code}</span>
                <h1 className="text-2xl font-bold text-white">{group.name}</h1>
              </div>
              <p className="text-slate-400">{group.description || 'No description'}</p>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {group.category && (
            <span className="rounded-full bg-blue-500/20 px-3 py-1 text-sm text-blue-400">
              {group.category}
            </span>
          )}
          {group.domain && (
            <span className="rounded-full bg-purple-500/20 px-3 py-1 text-sm text-purple-400">
              {group.domain}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowEditModal(true)}
            className="flex items-center gap-2 rounded-lg bg-slate-700 px-4 py-2 text-white hover:bg-slate-600"
          >
            <Edit2 className="h-4 w-4" />
            Edit
          </button>
          <button
            onClick={() => populateFromFrameworksMutation.mutate()}
            disabled={populateFromFrameworksMutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-slate-700 px-4 py-2 text-white hover:bg-slate-600 disabled:opacity-50"
          >
            {populateFromFrameworksMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Populate Controls
          </button>
          <button
            onClick={() => generateSummaryMutation.mutate()}
            disabled={generateSummaryMutation.isPending || group.total_control_count === 0}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {generateSummaryMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            Generate AI Summary
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          {group.ai_summary && (
            <div className="rounded-lg border border-purple-700/50 bg-purple-900/20 p-4">
              <div className="mb-2 flex items-center gap-2 text-purple-400">
                <Brain className="h-4 w-4" />
                <span className="text-sm font-medium">AI Summary</span>
              </div>
              <p className="text-slate-300">{group.ai_summary}</p>
            </div>
          )}

          {group.keywords && group.keywords.length > 0 && (
            <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
              <div className="mb-3 flex items-center gap-2 text-slate-400">
                <Tag className="h-4 w-4" />
                <span className="text-sm font-medium">Keywords</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {group.keywords.map((keyword, idx) => (
                  <span
                    key={idx}
                    className="rounded-full bg-slate-700 px-3 py-1 text-sm text-slate-300"
                  >
                    {keyword}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
            <div className="mb-3 flex items-center gap-2 text-slate-400">
              <Calendar className="h-4 w-4" />
              <span className="text-sm font-medium">Details</span>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Created</span>
                <span className="text-white">{formatDate(group.created_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Updated</span>
                <span className="text-white">{formatDate(group.updated_at)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Total Controls</span>
                <span className="text-white">{group.total_control_count}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
        <button
          onClick={() => setFrameworkFilter(null)}
          className={`rounded-lg border p-4 text-center transition-colors ${
            frameworkFilter === null
              ? 'border-primary-500 bg-primary-500/10'
              : 'border-slate-700 bg-slate-800 hover:bg-slate-700'
          }`}
        >
          <Shield className="mx-auto mb-2 h-6 w-6 text-green-400" />
          <div className="text-lg font-bold text-white">
            {frameworksData?.normalized_control_count || 0}
          </div>
          <div className="text-xs text-slate-400">Normalized</div>
        </button>
        {frameworksData?.frameworks.map((fw) => (
          <button
            key={fw.framework_id}
            onClick={() => setFrameworkFilter(fw.framework_id === frameworkFilter ? null : fw.framework_id)}
            className={`rounded-lg border p-4 text-center transition-colors ${
              frameworkFilter === fw.framework_id
                ? 'border-primary-500 bg-primary-500/10'
                : 'border-slate-700 bg-slate-800 hover:bg-slate-700'
            }`}
          >
            <Layers className="mx-auto mb-2 h-6 w-6 text-orange-400" />
            <div className="text-lg font-bold text-white">{fw.control_count}</div>
            <div className="truncate text-xs text-slate-400">{fw.framework_code || fw.framework_name}</div>
          </button>
        ))}
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
        {activeTab === 'controls' && (
          <MappedControlsTab
            normalizedControls={filteredControls.normalized}
            frameworkControls={filteredControls.framework}
            parsedControls={filteredControls.parsed}
            groupByFramework={groupByFramework}
            setGroupByFramework={setGroupByFramework}
            groupedControls={groupedControls}
            onAddControls={() => setShowAddControlsModal(true)}
            onRemoveControl={(mappingId) => removeControlMutation.mutate(mappingId)}
            isRemoving={removeControlMutation.isPending}
            getConfidenceBadge={getConfidenceBadge}
            getSourceStyle={getSourceStyle}
            frameworkFilter={frameworkFilter}
          />
        )}

        {activeTab === 'similarity' && (
          <SimilarityTab similarities={similarities?.items || []} />
        )}

        {activeTab === 'evidence' && (
          <EvidenceRecommendationsTab
            recommendations={evidenceRecs?.recommendations || []}
            onGenerateRecs={() => generateEvidenceRecsMutation.mutate()}
            isGenerating={generateEvidenceRecsMutation.isPending}
            getPriorityStyle={getPriorityStyle}
          />
        )}

        {activeTab === 'inheritance' && (
          <InheritanceTab groupId={groupId} controls={[...filteredControls.normalized.map(c => ({...c, type: 'normalized'})), ...filteredControls.framework.map(c => ({...c, type: 'framework'})), ...filteredControls.parsed.map(c => ({...c, type: 'parsed'}))]} />
        )}
      </div>

      {showAddControlsModal && (
        <AddControlsModal
          groupId={groupId}
          existingNormalizedIds={(group.normalized_controls || []).map(c => c.control_id)}
          existingFrameworkIds={(group.framework_controls || []).map(c => c.control_id)}
          onClose={() => setShowAddControlsModal(false)}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['control-group-detail', groupId] });
            queryClient.invalidateQueries({ queryKey: ['control-group-frameworks', groupId] });
            setShowAddControlsModal(false);
          }}
        />
      )}

      {showEditModal && (
        <EditGroupModal
          group={group}
          onClose={() => setShowEditModal(false)}
          onSave={(data) => updateGroupMutation.mutate(data)}
          isSaving={updateGroupMutation.isPending}
        />
      )}
    </div>
  );
}

function MappedControlsTab({
  normalizedControls,
  frameworkControls,
  parsedControls,
  groupByFramework,
  setGroupByFramework,
  groupedControls,
  onAddControls,
  onRemoveControl,
  isRemoving,
  getConfidenceBadge,
  getSourceStyle,
  frameworkFilter,
}: {
  normalizedControls: NormalizedControlItem[];
  frameworkControls: FrameworkControlItem[];
  parsedControls: ParsedControlItem[];
  groupByFramework: boolean;
  setGroupByFramework: (v: boolean) => void;
  groupedControls: Record<string, (FrameworkControlItem | ParsedControlItem)[]>;
  onAddControls: () => void;
  onRemoveControl: (mappingId: number) => void;
  isRemoving: boolean;
  getConfidenceBadge: (c: number | null) => React.ReactNode;
  getSourceStyle: (s: string | null) => { bg: string; text: string };
  frameworkFilter: number | null;
}) {
  const allControls = [...normalizedControls, ...frameworkControls, ...parsedControls];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">
          Mapped Controls ({allControls.length})
        </h3>
        <div className="flex items-center gap-3">
          {frameworkFilter === null && (
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input
                type="checkbox"
                checked={groupByFramework}
                onChange={(e) => setGroupByFramework(e.target.checked)}
                className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-primary-600 focus:ring-primary-500"
              />
              Group by framework
            </label>
          )}
          <button
            onClick={onAddControls}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
          >
            <Plus className="h-4 w-4" />
            Add Controls
          </button>
        </div>
      </div>

      {allControls.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Shield className="mb-4 h-12 w-12 text-slate-600" />
          <h3 className="text-lg font-medium text-white">No controls mapped</h3>
          <p className="mt-1 text-slate-400">Add controls to this group to get started</p>
          <button
            onClick={onAddControls}
            className="mt-4 flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-white hover:bg-primary-700"
          >
            <Plus className="h-4 w-4" />
            Add Controls
          </button>
        </div>
      ) : groupByFramework && frameworkFilter === null ? (
        <div className="space-y-6">
          {normalizedControls.length > 0 && (
            <div>
              <h4 className="mb-3 flex items-center gap-2 text-sm font-medium text-green-400">
                <Shield className="h-4 w-4" />
                Normalized Controls ({normalizedControls.length})
              </h4>
              <ControlsTable
                controls={normalizedControls.map(c => ({ ...c, type: 'normalized' as const, framework_name: null, framework_code: null }))}
                onRemove={onRemoveControl}
                isRemoving={isRemoving}
                getConfidenceBadge={getConfidenceBadge}
                getSourceStyle={getSourceStyle}
              />
            </div>
          )}
          {Object.entries(groupedControls).map(([frameworkName, controls]) => (
            <div key={frameworkName}>
              <h4 className="mb-3 flex items-center gap-2 text-sm font-medium text-orange-400">
                <Layers className="h-4 w-4" />
                {frameworkName} ({controls.length})
              </h4>
              <ControlsTable
                controls={controls.map(c => ({ ...c, type: 'framework' as const }))}
                onRemove={onRemoveControl}
                isRemoving={isRemoving}
                getConfidenceBadge={getConfidenceBadge}
                getSourceStyle={getSourceStyle}
              />
            </div>
          ))}
        </div>
      ) : (
        <ControlsTable
          controls={[
            ...normalizedControls.map(c => ({ ...c, type: 'normalized' as const, framework_name: null, framework_code: null })),
            ...frameworkControls.map(c => ({ ...c, type: 'framework' as const })),
            ...parsedControls.map(c => ({ ...c, type: 'parsed' as const, framework_code: null })),
          ]}
          onRemove={onRemoveControl}
          isRemoving={isRemoving}
          getConfidenceBadge={getConfidenceBadge}
          getSourceStyle={getSourceStyle}
        />
      )}
    </div>
  );
}

function ControlsTable({
  controls,
  onRemove,
  isRemoving,
  getConfidenceBadge,
  getSourceStyle,
}: {
  controls: Array<(NormalizedControlItem | FrameworkControlItem | ParsedControlItem) & { type: 'normalized' | 'framework' | 'parsed'; framework_name?: string | null; framework_code?: string | null }>;
  onRemove: (mappingId: number) => void;
  isRemoving: boolean;
  getConfidenceBadge: (c: number | null) => React.ReactNode;
  getSourceStyle: (s: string | null) => { bg: string; text: string };
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-700">
      <table className="w-full">
        <thead className="bg-slate-700/50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Code</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Name</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Framework</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Confidence</th>
            <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Source</th>
            <th className="w-16 px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-700">
          {controls.map((control) => {
            const sourceStyle = getSourceStyle(control.mapping_source);
            return (
              <tr key={`${control.type}-${control.mapping_id}`} className="hover:bg-slate-700/30">
                <td className="px-4 py-3">
                  <span className="font-mono text-sm text-primary-400">{control.code}</span>
                </td>
                <td className="px-4 py-3">
                  <p className="max-w-xs truncate text-sm text-white">{control.name}</p>
                </td>
                <td className="px-4 py-3">
                  {control.type === 'normalized' ? (
                    <span className="rounded bg-green-500/20 px-2 py-1 text-xs text-green-400">Normalized</span>
                  ) : control.type === 'parsed' ? (
                    <span className="rounded bg-cyan-500/20 px-2 py-1 text-xs text-cyan-400">
                      {control.framework_name || 'Parsed'}
                    </span>
                  ) : (
                    <span className="rounded bg-orange-500/20 px-2 py-1 text-xs text-orange-400">
                      {control.framework_code || control.framework_name || 'Framework'}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {getConfidenceBadge(control.mapping_confidence)}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded px-2 py-1 text-xs ${sourceStyle.bg} ${sourceStyle.text}`}>
                    {control.mapping_source || 'manual'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => onRemove(control.mapping_id)}
                    disabled={isRemoving}
                    className="rounded p-1.5 text-slate-400 hover:bg-red-900/50 hover:text-red-400 disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SimilarityTab({ similarities }: { similarities: SimilarityItem[] }) {
  const [strengthFilter, setStrengthFilter] = useState<'all' | 'strong' | 'moderate' | 'weak'>('all');
  const [groupByPair, setGroupByPair] = useState(false);

  if (similarities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <GitMerge className="mb-4 h-12 w-12 text-slate-600" />
        <h3 className="text-lg font-medium text-white">No cross-framework mappings found</h3>
        <p className="mt-1 max-w-md text-slate-400">
          Run AI Analysis from the Control Library to discover controls across different frameworks that address the same requirements.
        </p>
      </div>
    );
  }

  const getMatchStrength = (score: number) => {
    const pct = score * 100;
    if (pct >= 70) return 'strong';
    if (pct >= 40) return 'moderate';
    return 'weak';
  };

  const getMatchLabel = (score: number) => {
    const strength = getMatchStrength(score);
    if (strength === 'strong') return 'Strong Match';
    if (strength === 'moderate') return 'Moderate Match';
    return 'Weak Match';
  };

  const getMatchStyle = (score: number) => {
    const strength = getMatchStrength(score);
    if (strength === 'strong') return { bg: 'bg-green-500/15', border: 'border-green-500/30', text: 'text-green-400', icon: CheckCircle };
    if (strength === 'moderate') return { bg: 'bg-amber-500/15', border: 'border-amber-500/30', text: 'text-amber-400', icon: Info };
    return { bg: 'bg-slate-500/15', border: 'border-slate-500/30', text: 'text-slate-400', icon: AlertTriangle };
  };

  const cleanReasoning = (reasoning: string | null, fw1: string, fw2: string): string => {
    if (!reasoning) return `These controls address similar compliance requirements.`;
    let cleaned = reasoning
      .replace(/keywords?:\s*\[.*?\]/gi, '')
      .replace(/matching keywords?:?\s*/gi, '')
      .replace(/\[.*?\]/g, '')
      .replace(/score:\s*[\d.]+/gi, '')
      .replace(/similarity:\s*[\d.]+%?/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!cleaned || cleaned.length < 10) {
      cleaned = `These controls address similar compliance requirements.`;
    }
    return cleaned;
  };

  const strongCount = similarities.filter(s => getMatchStrength(s.similarity_score) === 'strong').length;
  const moderateCount = similarities.filter(s => getMatchStrength(s.similarity_score) === 'moderate').length;
  const weakCount = similarities.filter(s => getMatchStrength(s.similarity_score) === 'weak').length;

  const filtered = strengthFilter === 'all'
    ? similarities
    : similarities.filter(s => getMatchStrength(s.similarity_score) === strengthFilter);

  const getFrameworkPairKey = (sim: SimilarityItem) => {
    const fws = [sim.control1_framework || 'Unknown', sim.control2_framework || 'Unknown'].sort();
    return `${fws[0]} ↔ ${fws[1]}`;
  };

  const groupedByPair: Record<string, SimilarityItem[]> = {};
  if (groupByPair) {
    for (const sim of filtered) {
      const key = getFrameworkPairKey(sim);
      if (!groupedByPair[key]) groupedByPair[key] = [];
      groupedByPair[key].push(sim);
    }
  }

  const FRAMEWORK_COLORS: Record<string, { bg: string; text: string }> = {};
  const COLOR_PALETTE = [
    { bg: 'bg-blue-500/20', text: 'text-blue-400' },
    { bg: 'bg-teal-500/20', text: 'text-teal-400' },
    { bg: 'bg-violet-500/20', text: 'text-violet-400' },
    { bg: 'bg-rose-500/20', text: 'text-rose-400' },
    { bg: 'bg-cyan-500/20', text: 'text-cyan-400' },
    { bg: 'bg-orange-500/20', text: 'text-orange-400' },
    { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
    { bg: 'bg-pink-500/20', text: 'text-pink-400' },
  ];
  let colorIdx = 0;
  const getFrameworkColor = (fw: string) => {
    if (!FRAMEWORK_COLORS[fw]) {
      FRAMEWORK_COLORS[fw] = COLOR_PALETTE[colorIdx % COLOR_PALETTE.length];
      colorIdx++;
    }
    return FRAMEWORK_COLORS[fw];
  };

  const renderCard = (sim: SimilarityItem) => {
    const matchStyle = getMatchStyle(sim.similarity_score);
    const MatchIcon = matchStyle.icon;
    const fw1Color = getFrameworkColor(sim.control1_framework || 'Unknown');
    const fw2Color = getFrameworkColor(sim.control2_framework || 'Unknown');
    const pct = Math.round(sim.similarity_score * 100);

    return (
      <div key={sim.id} className={`rounded-xl border ${matchStyle.border} ${matchStyle.bg} p-5`}>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <div className="space-y-2">
            <span className={`inline-block rounded-md px-2.5 py-1 text-xs font-semibold ${fw1Color.bg} ${fw1Color.text}`}>
              {sim.control1_framework || 'Unknown'}
            </span>
            <p className="font-mono text-sm font-medium text-white">{sim.control1_code}</p>
            <p className="text-sm text-slate-300">{sim.control1_name}</p>
          </div>

          <div className="flex flex-col items-center gap-1 px-3">
            <MatchIcon className={`h-6 w-6 ${matchStyle.text}`} />
            <span className={`text-xs font-bold ${matchStyle.text}`}>{pct}%</span>
            <span className={`whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${matchStyle.text}`}>
              {getMatchLabel(sim.similarity_score)}
            </span>
          </div>

          <div className="space-y-2 text-right">
            <span className={`inline-block rounded-md px-2.5 py-1 text-xs font-semibold ${fw2Color.bg} ${fw2Color.text}`}>
              {sim.control2_framework || 'Unknown'}
            </span>
            <p className="font-mono text-sm font-medium text-white">{sim.control2_code}</p>
            <p className="text-sm text-slate-300">{sim.control2_name}</p>
          </div>
        </div>

        <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-slate-700/50 bg-slate-800/60 p-3">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <div>
            <p className="text-xs font-medium text-amber-400">What this means</p>
            <p className="mt-0.5 text-sm text-slate-300">
              {cleanReasoning(sim.ai_reasoning, sim.control1_framework, sim.control2_framework)}
              {pct >= 40 && (
                <span className="text-slate-400">
                  {' '}Evidence collected for one may satisfy both.
                </span>
              )}
            </p>
          </div>
        </div>
      </div>
    );
  };

  const filterButtons: { key: typeof strengthFilter; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: similarities.length },
    { key: 'strong', label: 'Strong Match (70%+)', count: strongCount },
    { key: 'moderate', label: 'Moderate Match (40-69%)', count: moderateCount },
    { key: 'weak', label: 'Weak Match (<40%)', count: weakCount },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xl font-bold text-white">Cross-Framework Control Mapping</h3>
        <p className="mt-1 max-w-2xl text-sm text-slate-400">
          Controls from different frameworks that address the same requirements. Sharing evidence across equivalent controls reduces duplicate compliance work.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-700 bg-slate-900/50 p-3 text-center">
          <p className="text-2xl font-bold text-white">{similarities.length}</p>
          <p className="text-xs text-slate-400">Total Pairs</p>
        </div>
        <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-3 text-center">
          <p className="text-2xl font-bold text-green-400">{strongCount}</p>
          <p className="text-xs text-green-400/70">Strong Matches</p>
        </div>
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-center">
          <p className="text-2xl font-bold text-amber-400">{moderateCount}</p>
          <p className="text-xs text-amber-400/70">Moderate Matches</p>
        </div>
        <div className="rounded-lg border border-slate-600 bg-slate-900/50 p-3 text-center">
          <p className="text-2xl font-bold text-slate-400">{weakCount}</p>
          <p className="text-xs text-slate-500">Weak Matches</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {filterButtons.map((btn) => (
            <button
              key={btn.key}
              onClick={() => setStrengthFilter(btn.key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                strengthFilter === btn.key
                  ? 'bg-primary-600 text-white'
                  : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {btn.label} ({btn.count})
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input
            type="checkbox"
            checked={groupByPair}
            onChange={(e) => setGroupByPair(e.target.checked)}
            className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-primary-600 focus:ring-primary-500"
          />
          Group by framework pair
        </label>
      </div>

      {filtered.length === 0 ? (
        <div className="py-8 text-center text-slate-400">
          No matches found for the selected filter.
        </div>
      ) : groupByPair ? (
        <div className="space-y-6">
          {Object.entries(groupedByPair).sort(([a], [b]) => a.localeCompare(b)).map(([pairKey, items]) => (
            <div key={pairKey}>
              <div className="mb-3 flex items-center gap-2">
                <GitMerge className="h-4 w-4 text-primary-400" />
                <h4 className="text-sm font-semibold text-white">{pairKey}</h4>
                <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-400">
                  {items.length} {items.length === 1 ? 'pair' : 'pairs'}
                </span>
              </div>
              <div className="space-y-3">
                {items.map(renderCard)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(renderCard)}
        </div>
      )}
    </div>
  );
}

function EvidenceRecommendationsTab({
  recommendations,
  onGenerateRecs,
  isGenerating,
  getPriorityStyle,
}: {
  recommendations: EvidenceRecommendation[];
  onGenerateRecs: () => void;
  isGenerating: boolean;
  getPriorityStyle: (p: string) => { bg: string; text: string };
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-white">
          Evidence Recommendations ({recommendations.length})
        </h3>
        <button
          onClick={onGenerateRecs}
          disabled={isGenerating}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
        >
          {isGenerating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          Generate Recommendations
        </button>
      </div>

      {recommendations.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <FileCheck className="mb-4 h-12 w-12 text-slate-600" />
          <h3 className="text-lg font-medium text-white">No recommendations yet</h3>
          <p className="mt-1 text-slate-400">Generate AI-powered evidence recommendations for this control group</p>
          <button
            onClick={onGenerateRecs}
            disabled={isGenerating}
            className="mt-4 flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Generate Recommendations
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {recommendations.map((rec) => {
            const priorityStyle = getPriorityStyle(rec.priority);
            return (
              <div key={rec.id} className="rounded-lg border border-slate-700 bg-slate-700/30 p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium text-white">{rec.evidence_type}</h4>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${priorityStyle.bg} ${priorityStyle.text}`}>
                        {rec.priority}
                      </span>
                      {rec.ai_confidence !== null && (
                        <span className="text-xs text-slate-500">
                          {Math.round(rec.ai_confidence * 100)}% confidence
                        </span>
                      )}
                    </div>
                    {rec.evidence_description && (
                      <p className="mt-2 text-sm text-slate-400">{rec.evidence_description}</p>
                    )}
                    {rec.ai_reasoning && (
                      <p className="mt-2 text-xs text-slate-500">{rec.ai_reasoning}</p>
                    )}
                  </div>
                </div>
                {rec.sample_evidence_names && rec.sample_evidence_names.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <span className="text-xs text-slate-500">Samples:</span>
                    {rec.sample_evidence_names.map((name, idx) => (
                      <span key={idx} className="rounded bg-slate-600 px-2 py-0.5 text-xs text-slate-300">
                        {name}
                      </span>
                    ))}
                  </div>
                )}
                {rec.control_code && (
                  <div className="mt-2 text-xs text-slate-500">
                    From: <span className="font-mono text-primary-400">{rec.control_code}</span>
                    {rec.framework_name && <span> ({rec.framework_name})</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function InheritanceTab({ groupId, controls }: { groupId: number; controls: Array<{ control_id: number; type: string; code: string; name: string }> }) {
  const [selectedControl, setSelectedControl] = useState<{ type: string; id: number } | null>(null);

  const { data: inheritedData, isLoading: loadingInherited } = useQuery({
    queryKey: ['inheritance-parent', selectedControl?.type, selectedControl?.id],
    queryFn: async () => {
      if (!selectedControl) return null;
      const response = await apiClient.get(`/control-library/inheritance/parent/${selectedControl.type}/${selectedControl.id}`);
      return response.data;
    },
    enabled: !!selectedControl,
  });

  const { data: satisfyingData, isLoading: loadingSatisfying } = useQuery({
    queryKey: ['inheritance-child', selectedControl?.type, selectedControl?.id],
    queryFn: async () => {
      if (!selectedControl) return null;
      const response = await apiClient.get(`/control-library/inheritance/child/${selectedControl.type}/${selectedControl.id}`);
      return response.data;
    },
    enabled: !!selectedControl,
  });

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-white">Control Inheritance</h3>
      <p className="text-sm text-slate-400">
        Select a control from this group to view its inheritance relationships
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h4 className="mb-3 text-sm font-medium text-slate-400">Controls in this group</h4>
          <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-700">
            {controls.map((control) => (
              <button
                key={`${control.type}-${control.control_id}`}
                onClick={() => setSelectedControl({ type: control.type, id: control.control_id })}
                className={`w-full border-b border-slate-700 px-4 py-3 text-left last:border-0 ${
                  selectedControl?.type === control.type && selectedControl?.id === control.control_id
                    ? 'bg-primary-500/20'
                    : 'hover:bg-slate-700/50'
                }`}
              >
                <span className="font-mono text-sm text-primary-400">{control.code}</span>
                <p className="truncate text-sm text-slate-300">{control.name}</p>
              </button>
            ))}
            {controls.length === 0 && (
              <div className="p-4 text-center text-sm text-slate-500">No controls in this group</div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {selectedControl ? (
            <>
              <div className="rounded-lg border border-slate-700 bg-slate-700/30 p-4">
                <h4 className="mb-3 flex items-center gap-2 text-sm font-medium text-green-400">
                  <ChevronDown className="h-4 w-4" />
                  Controls Inherited FROM this control ({inheritedData?.inherited_controls?.length || 0})
                </h4>
                {loadingInherited ? (
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                ) : inheritedData?.inherited_controls?.length > 0 ? (
                  <div className="space-y-2">
                    {inheritedData.inherited_controls.map((item: InheritanceItem) => (
                      <div key={item.inheritance_id} className="flex items-center justify-between rounded bg-slate-800 p-2">
                        <div>
                          <span className="font-mono text-xs text-primary-400">{item.control.code}</span>
                          <p className="text-sm text-slate-300">{item.control.name}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500">{item.coverage_percentage}%</span>
                          <span className="rounded bg-blue-500/20 px-2 py-0.5 text-xs text-blue-400">
                            {item.inheritance_type}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No controls inherit from this control</p>
                )}
              </div>

              <div className="rounded-lg border border-slate-700 bg-slate-700/30 p-4">
                <h4 className="mb-3 flex items-center gap-2 text-sm font-medium text-orange-400">
                  <ChevronRight className="h-4 w-4" />
                  Controls that SATISFY this control ({satisfyingData?.satisfying_controls?.length || 0})
                </h4>
                {loadingSatisfying ? (
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                ) : satisfyingData?.satisfying_controls?.length > 0 ? (
                  <div className="space-y-2">
                    {satisfyingData.satisfying_controls.map((item: InheritanceItem) => (
                      <div key={item.inheritance_id} className="flex items-center justify-between rounded bg-slate-800 p-2">
                        <div>
                          <span className="font-mono text-xs text-primary-400">{item.control.code}</span>
                          <p className="text-sm text-slate-300">{item.control.name}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500">{item.coverage_percentage}%</span>
                          <span className="rounded bg-blue-500/20 px-2 py-0.5 text-xs text-blue-400">
                            {item.inheritance_type}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">No controls satisfy this control</p>
                )}
              </div>
            </>
          ) : (
            <div className="flex h-64 flex-col items-center justify-center text-center">
              <Link2 className="mb-4 h-12 w-12 text-slate-600" />
              <p className="text-slate-400">Select a control to view inheritance</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AddControlsModal({
  groupId,
  existingNormalizedIds,
  existingFrameworkIds,
  onClose,
  onSuccess,
}: {
  groupId: number;
  existingNormalizedIds: number[];
  existingFrameworkIds: number[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [frameworkFilter, setFrameworkFilter] = useState<number | null>(null);
  const [selectedNormalized, setSelectedNormalized] = useState<number[]>([]);
  const [selectedFramework, setSelectedFramework] = useState<number[]>([]);

  const { data: normalizedControls } = useQuery({
    queryKey: ['all-normalized-controls'],
    queryFn: async () => {
      const response = await controlsApi.getNormalized();
      return response.data;
    },
  });

  const { data: frameworks } = useQuery({
    queryKey: ['frameworks'],
    queryFn: async () => {
      const response = await frameworksApi.getAll();
      return response.data;
    },
  });

  const { data: frameworkControls } = useQuery({
    queryKey: ['framework-controls', frameworkFilter],
    queryFn: async () => {
      if (!frameworkFilter) return [];
      const response = await apiClient.get(`/frameworks/${frameworkFilter}`);
      const framework = response.data;
      const controls: Array<{ id: number; code: string; name: string }> = [];
      for (const domain of framework.domains || []) {
        for (const objective of domain.objectives || []) {
          for (const control of objective.controls || []) {
            controls.push({ id: control.id, code: control.code, name: control.name });
          }
        }
      }
      return controls;
    },
    enabled: !!frameworkFilter,
  });

  const addControlsMutation = useMutation({
    mutationFn: async () => {
      const data = {
        normalized_control_ids: selectedNormalized,
        framework_control_ids: selectedFramework,
      };
      await apiClient.post(`/control-library/groups/${groupId}/controls`, data);
    },
    onSuccess: () => {
      onSuccess();
    },
  });

  const filteredNormalized = (normalizedControls || []).filter((c: { id: number; code: string; name: string }) =>
    !existingNormalizedIds.includes(c.id) &&
    (searchTerm === '' || c.code.toLowerCase().includes(searchTerm.toLowerCase()) || c.name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const filteredFramework = (frameworkControls || []).filter((c: { id: number; code: string; name: string }) =>
    !existingFrameworkIds.includes(c.id) &&
    (searchTerm === '' || c.code.toLowerCase().includes(searchTerm.toLowerCase()) || c.name.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  const toggleNormalized = (id: number) => {
    setSelectedNormalized(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const toggleFramework = (id: number) => {
    setSelectedFramework(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  const totalSelected = selectedNormalized.length + selectedFramework.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-3xl rounded-lg border border-slate-700 bg-slate-800 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">Add Controls to Group</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search controls..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-700 py-2 pl-10 pr-4 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none"
              />
            </div>
            <select
              value={frameworkFilter || ''}
              onChange={(e) => setFrameworkFilter(e.target.value ? Number(e.target.value) : null)}
              className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
            >
              <option value="">All Frameworks</option>
              {frameworks?.map((fw: { id: number; name: string }) => (
                <option key={fw.id} value={fw.id}>{fw.name}</option>
              ))}
            </select>
          </div>

          <div className="max-h-80 overflow-y-auto rounded-lg border border-slate-700">
            {frameworkFilter === null && filteredNormalized.length > 0 && (
              <>
                <div className="sticky top-0 bg-slate-700 px-4 py-2 text-sm font-medium text-green-400">
                  Normalized Controls
                </div>
                {filteredNormalized.map((control: { id: number; code: string; name: string }) => (
                  <label
                    key={`normalized-${control.id}`}
                    className="flex cursor-pointer items-center gap-3 border-b border-slate-700 px-4 py-3 hover:bg-slate-700/50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedNormalized.includes(control.id)}
                      onChange={() => toggleNormalized(control.id)}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-primary-600 focus:ring-primary-500"
                    />
                    <div>
                      <span className="font-mono text-sm text-primary-400">{control.code}</span>
                      <p className="text-sm text-slate-300">{control.name}</p>
                    </div>
                  </label>
                ))}
              </>
            )}

            {frameworkFilter !== null && filteredFramework.length > 0 && (
              <>
                <div className="sticky top-0 bg-slate-700 px-4 py-2 text-sm font-medium text-orange-400">
                  Framework Controls
                </div>
                {filteredFramework.map((control: { id: number; code: string; name: string }) => (
                  <label
                    key={`framework-${control.id}`}
                    className="flex cursor-pointer items-center gap-3 border-b border-slate-700 px-4 py-3 hover:bg-slate-700/50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedFramework.includes(control.id)}
                      onChange={() => toggleFramework(control.id)}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-primary-600 focus:ring-primary-500"
                    />
                    <div>
                      <span className="font-mono text-sm text-primary-400">{control.code}</span>
                      <p className="text-sm text-slate-300">{control.name}</p>
                    </div>
                  </label>
                ))}
              </>
            )}

            {frameworkFilter === null && filteredNormalized.length === 0 && (
              <div className="p-8 text-center text-slate-400">
                {searchTerm ? 'No matching controls found' : 'Select a framework to view controls'}
              </div>
            )}

            {frameworkFilter !== null && filteredFramework.length === 0 && (
              <div className="p-8 text-center text-slate-400">
                {searchTerm ? 'No matching controls found' : 'No available controls in this framework'}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-slate-700 px-6 py-4">
          <span className="text-sm text-slate-400">
            {totalSelected} control{totalSelected !== 1 ? 's' : ''} selected
          </span>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="rounded-lg border border-slate-600 px-4 py-2 text-white hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              onClick={() => addControlsMutation.mutate()}
              disabled={totalSelected === 0 || addControlsMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {addControlsMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Add Selected
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EditGroupModal({
  group,
  onClose,
  onSave,
  isSaving,
}: {
  group: ControlGroupDetail;
  onClose: () => void;
  onSave: (data: Partial<ControlGroupDetail>) => void;
  isSaving: boolean;
}) {
  const [formData, setFormData] = useState({
    name: group.name,
    code: group.code,
    description: group.description || '',
    category: group.category || '',
    domain: group.domain || '',
    keywords: group.keywords?.join(', ') || '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name: formData.name,
      code: formData.code,
      description: formData.description || null,
      category: formData.category || null,
      domain: formData.domain || null,
      keywords: formData.keywords ? formData.keywords.split(',').map(k => k.trim()).filter(Boolean) : [],
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-lg rounded-lg border border-slate-700 bg-slate-800 shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
          <h2 className="text-lg font-semibold text-white">Edit Control Group</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <div>
            <label className="block text-sm font-medium text-slate-300">Code</label>
            <input
              type="text"
              value={formData.code}
              onChange={(e) => setFormData(prev => ({ ...prev, code: e.target.value }))}
              required
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300">Name</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
              required
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300">Category</label>
              <input
                type="text"
                value={formData.category}
                onChange={(e) => setFormData(prev => ({ ...prev, category: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">Domain</label>
              <input
                type="text"
                value={formData.domain}
                onChange={(e) => setFormData(prev => ({ ...prev, domain: e.target.value }))}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300">Keywords (comma-separated)</label>
            <input
              type="text"
              value={formData.keywords}
              onChange={(e) => setFormData(prev => ({ ...prev, keywords: e.target.value }))}
              placeholder="keyword1, keyword2, keyword3"
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-600 px-4 py-2 text-white hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="h-4 w-4" />
              )}
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
