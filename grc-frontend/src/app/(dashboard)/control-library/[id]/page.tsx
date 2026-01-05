'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient, { frameworksApi, controlsApi } from '@/lib/api';
import { 
  ArrowLeft, Loader2, AlertCircle, Shield, Calendar, Tag,
  Edit2, Sparkles, Trash2, Plus, X, Search, Layers, GitMerge,
  FileCheck, Link2, Eye, RefreshCw, Brain, ChevronDown, ChevronRight,
  CheckCircle, Clock, AlertTriangle, Filter
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
  total_control_count: number;
  created_at: string | null;
  updated_at: string | null;
  created_by: number | null;
  normalized_controls: NormalizedControlItem[];
  framework_controls: FrameworkControlItem[];
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
      const response = await apiClient.get('/control-library/ai-mapping/similarities', {
        params: { limit: 50 }
      });
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
    if (!group) return { normalized: [], framework: [] };
    let normalized = group.normalized_controls || [];
    let framework = group.framework_controls || [];
    if (frameworkFilter !== null) {
      framework = framework.filter(c => c.framework_id === frameworkFilter);
      normalized = [];
    }
    return { normalized, framework };
  };

  const groupControlsByFramework = () => {
    if (!group) return {};
    const groups: Record<string, FrameworkControlItem[]> = {};
    for (const control of group.framework_controls || []) {
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
          <InheritanceTab groupId={groupId} controls={[...filteredControls.normalized.map(c => ({...c, type: 'normalized'})), ...filteredControls.framework.map(c => ({...c, type: 'framework'}))]} />
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
  groupByFramework: boolean;
  setGroupByFramework: (v: boolean) => void;
  groupedControls: Record<string, FrameworkControlItem[]>;
  onAddControls: () => void;
  onRemoveControl: (mappingId: number) => void;
  isRemoving: boolean;
  getConfidenceBadge: (c: number | null) => React.ReactNode;
  getSourceStyle: (s: string | null) => { bg: string; text: string };
  frameworkFilter: number | null;
}) {
  const allControls = [...normalizedControls, ...frameworkControls];

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
  controls: Array<(NormalizedControlItem | FrameworkControlItem) & { type: 'normalized' | 'framework'; framework_name?: string | null; framework_code?: string | null }>;
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
  if (similarities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <GitMerge className="mb-4 h-12 w-12 text-slate-600" />
        <h3 className="text-lg font-medium text-white">No similarity data</h3>
        <p className="mt-1 text-slate-400">Run AI Analysis from the Control Library to generate similarities</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-white">Control Similarities</h3>
      <div className="space-y-3">
        {similarities.map((sim) => (
          <div key={sim.id} className="rounded-lg border border-slate-700 bg-slate-700/30 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <p className="font-mono text-sm text-primary-400">{sim.control1_code}</p>
                  <p className="max-w-[200px] truncate text-xs text-slate-400">{sim.control1_name}</p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-px w-8 bg-slate-600" />
                  <div className={`rounded-full px-3 py-1 text-sm font-medium ${
                    sim.similarity_score >= 0.8 ? 'bg-green-500/20 text-green-400' :
                    sim.similarity_score >= 0.6 ? 'bg-yellow-500/20 text-yellow-400' :
                    'bg-orange-500/20 text-orange-400'
                  }`}>
                    {Math.round(sim.similarity_score * 100)}%
                  </div>
                  <div className="h-px w-8 bg-slate-600" />
                </div>
                <div className="text-center">
                  <p className="font-mono text-sm text-primary-400">{sim.control2_code}</p>
                  <p className="max-w-[200px] truncate text-xs text-slate-400">{sim.control2_name}</p>
                </div>
              </div>
            </div>
            {sim.ai_reasoning && (
              <p className="mt-3 text-sm text-slate-400">{sim.ai_reasoning}</p>
            )}
          </div>
        ))}
      </div>
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
