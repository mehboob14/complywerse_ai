'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import {
  Library,
  Loader2,
  AlertCircle,
  Search,
  Plus,
  Brain,
  Sparkles,
  Layers,
  GitMerge,
  Shield,
  Eye,
  Edit2,
  Trash2,
  FileText,
  X,
  ChevronDown,
  RefreshCw,
  CheckCircle,
  Clock,
  XCircle,
  BarChart3,
  Play,
  Grid3X3,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';
import { StatCard, ProgressRing, DataCard } from '@/components/ui';

interface ControlGroup {
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
}

interface GroupsResponse {
  items: ControlGroup[];
  total: number;
  skip: number;
  limit: number;
}

interface Analysis {
  id: number;
  tenant_id: number;
  analysis_type: string;
  status: string;
  frameworks_analyzed: number[];
  total_controls_analyzed: number;
  mappings_created: number;
  groups_created: number;
  started_at: string;
  completed_at: string | null;
  error_message: string | null;
  created_by: number;
}

interface AutoGroupResult {
  message: string;
  groups_created: number;
  groups: ControlGroup[];
}

const STATUS_STYLES: Record<string, { bg: string; text: string; icon: typeof CheckCircle }> = {
  completed: { bg: 'bg-green-500/20', text: 'text-green-400', icon: CheckCircle },
  processing: { bg: 'bg-blue-500/20', text: 'text-blue-400', icon: RefreshCw },
  failed: { bg: 'bg-red-500/20', text: 'text-red-400', icon: XCircle },
  pending: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', icon: Clock },
};

export default function ControlLibraryPage() {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [domainFilter, setDomainFilter] = useState('');
  const [showEmptyGroups, setShowEmptyGroups] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize] = useState(20);
  const [viewMode, setViewMode] = useState<'cards' | 'table'>('cards');

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showAutoGroupModal, setShowAutoGroupModal] = useState(false);
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ControlGroup | null>(null);

  const [newGroup, setNewGroup] = useState({
    code: '',
    name: '',
    description: '',
    category: '',
    domain: '',
  });

  const [selectedFrameworks, setSelectedFrameworks] = useState<number[]>([]);

  const { data: groupsData, isLoading: groupsLoading, error: groupsError, refetch: refetchGroups } = useQuery({
    queryKey: ['control-groups', searchTerm, categoryFilter, domainFilter, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string | number> = {
        skip: page * pageSize,
        limit: pageSize,
      };
      if (searchTerm) params.search = searchTerm;
      if (categoryFilter) params.category = categoryFilter;
      if (domainFilter) params.domain = domainFilter;
      const response = await apiClient.get('/control-library/groups', { params });
      return response.data as GroupsResponse;
    },
  });

  const { data: categories } = useQuery({
    queryKey: ['control-group-categories'],
    queryFn: async () => {
      const response = await apiClient.get('/control-library/groups/categories');
      return response.data.categories as string[];
    },
  });

  const { data: domains } = useQuery({
    queryKey: ['control-group-domains'],
    queryFn: async () => {
      const response = await apiClient.get('/control-library/groups/domains');
      return response.data.domains as string[];
    },
  });

  const { data: uploadedFrameworks } = useQuery({
    queryKey: ['uploaded-frameworks'],
    queryFn: async () => {
      const response = await apiClient.get('/framework-upload/upload');
      return response.data?.items || [];
    },
  });

  const { data: latestAnalysis } = useQuery({
    queryKey: ['latest-ai-analysis'],
    queryFn: async () => {
      try {
        const response = await apiClient.get('/control-library/ai-mapping/similarities', { params: { limit: 1 } });
        return response.data;
      } catch {
        return null;
      }
    },
  });

  const { data: gapDashboard } = useQuery({
    queryKey: ['gap-analysis-dashboard'],
    queryFn: async () => {
      try {
        const response = await apiClient.get('/control-library/gap-analysis/dashboard');
        return response.data;
      } catch {
        return null;
      }
    },
  });

  const createGroupMutation = useMutation({
    mutationFn: (data: typeof newGroup) => apiClient.post('/control-library/groups', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['control-groups'] });
      queryClient.invalidateQueries({ queryKey: ['control-group-categories'] });
      queryClient.invalidateQueries({ queryKey: ['control-group-domains'] });
      setShowCreateModal(false);
      setNewGroup({ code: '', name: '', description: '', category: '', domain: '' });
    },
  });

  const updateGroupMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ControlGroup> }) =>
      apiClient.put(`/control-library/groups/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['control-groups'] });
      setEditingGroup(null);
    },
  });

  const deleteGroupMutation = useMutation({
    mutationFn: (id: number) => apiClient.delete(`/control-library/groups/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['control-groups'] });
    },
  });

  const generateSummaryMutation = useMutation({
    mutationFn: (id: number) => apiClient.post(`/control-library/groups/${id}/generate-summary`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['control-groups'] });
    },
  });

  const [autoGroupResult, setAutoGroupResult] = useState<AutoGroupResult | null>(null);
  const [autoGroupLoading, setAutoGroupLoading] = useState(false);
  const [autoGroupError, setAutoGroupError] = useState<string | null>(null);

  const autoGroupMutation = useMutation({
    mutationFn: async (frameworkIds: number[]) => {
      setAutoGroupLoading(true);
      setAutoGroupError(null);
      const response = await apiClient.post('/control-library/groups/auto-group', {
        framework_ids: frameworkIds.length > 0 ? frameworkIds : null,
      });
      return response.data as AutoGroupResult;
    },
    onSuccess: (data) => {
      setAutoGroupResult(data);
      setAutoGroupLoading(false);
      queryClient.invalidateQueries({ queryKey: ['control-groups'] });
    },
    onError: (error: any) => {
      setAutoGroupLoading(false);
      const errorMessage = error?.response?.data?.detail?.message 
        || error?.response?.data?.detail 
        || error?.response?.data?.message 
        || error?.message 
        || 'An error occurred while auto-grouping controls';
      setAutoGroupError(errorMessage);
    },
  });

  const [analysisResult, setAnalysisResult] = useState<Analysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const startAnalysisMutation = useMutation({
    mutationFn: async (frameworkIds: number[]) => {
      setAnalysisLoading(true);
      setAnalysisError(null);
      const response = await apiClient.post('/control-library/ai-mapping/analyze', {
        framework_ids: frameworkIds.length > 0 ? frameworkIds : null,
      });
      return response.data as Analysis;
    },
    onSuccess: (data) => {
      setAnalysisResult(data);
      setAnalysisLoading(false);
      queryClient.invalidateQueries({ queryKey: ['latest-ai-analysis'] });
    },
    onError: (error: any) => {
      setAnalysisLoading(false);
      const errorMessage = error?.response?.data?.detail?.message 
        || error?.response?.data?.detail 
        || error?.response?.data?.message 
        || error?.message 
        || 'An error occurred while analyzing controls';
      setAnalysisError(errorMessage);
    },
  });

  const handleDeleteGroup = (group: ControlGroup) => {
    if (confirm(`Are you sure you want to delete "${group.name}"?`)) {
      deleteGroupMutation.mutate(group.id);
    }
  };

  const totalGroups = groupsData?.total || 0;
  const totalControls = groupsData?.items?.reduce((sum, g) => sum + g.total_control_count, 0) || 0;

  const filteredGroups = showEmptyGroups
    ? groupsData?.items
    : groupsData?.items?.filter(g => g.total_control_count > 0);

  const totalPages = Math.ceil((groupsData?.total || 0) / pageSize);

  const getGroupCompletionPercent = (group: ControlGroup) => {
    if (group.total_control_count === 0) return 0;
    const hasDescription = group.description ? 20 : 0;
    const hasCategory = group.category ? 20 : 0;
    const hasDomain = group.domain ? 20 : 0;
    const hasKeywords = (group.keywords?.length || 0) > 0 ? 20 : 0;
    const hasControls = group.total_control_count > 0 ? 20 : 0;
    return hasDescription + hasCategory + hasDomain + hasKeywords + hasControls;
  };

  const averageCompletion = useMemo(() => {
    if (!groupsData?.items?.length) return 0;
    const sum = groupsData.items.reduce((acc, g) => acc + getGroupCompletionPercent(g), 0);
    return Math.round(sum / groupsData.items.length);
  }, [groupsData]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Unified Control Library</h1>
          <p className="text-slate-400">AI-powered control mapping across frameworks</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
          >
            <Plus size={18} />
            Create Group
          </button>
          <button
            onClick={() => {
              setAutoGroupResult(null);
              setShowAutoGroupModal(true);
            }}
            className="flex items-center gap-2 rounded-lg border border-primary-500 bg-primary-500/10 px-4 py-2 font-medium text-primary-400 hover:bg-primary-500/20"
          >
            <Sparkles size={18} />
            Auto-Group with AI
          </button>
          <button
            onClick={() => {
              setAnalysisResult(null);
              setShowAnalysisModal(true);
            }}
            className="flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-200 px-4 py-2 font-medium text-slate-800 hover:bg-slate-600"
          >
            <Brain size={18} />
            Run AI Analysis
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          title="Total Control Groups"
          value={groupsLoading ? '-' : totalGroups}
          icon={Library}
          variant="default"
          subtitle="Organized control sets"
        />
        <StatCard
          title="Total Mapped Controls"
          value={groupsLoading ? '-' : totalControls}
          icon={GitMerge}
          variant="info"
          subtitle="Across all groups"
        />
        <StatCard
          title="Frameworks Covered"
          value={groupsLoading ? '-' : uploadedFrameworks?.length || 0}
          icon={Layers}
          variant="success"
          subtitle="Uploaded frameworks"
        />
        <StatCard
          title="Evidence Coverage"
          value={`${gapDashboard?.evidence_coverage_percentage || 0}%`}
          icon={TrendingUp}
          variant={gapDashboard?.evidence_coverage_percentage >= 70 ? 'success' : gapDashboard?.evidence_coverage_percentage >= 40 ? 'warning' : 'danger'}
          subtitle="Controls with evidence"
        />
        <div className="rounded-xl border border-slate-200 bg-white p-4 flex items-center justify-center">
          <ProgressRing
            percentage={averageCompletion}
            size={80}
            color={averageCompletion >= 70 ? 'success' : averageCompletion >= 40 ? 'warning' : 'danger'}
            label="Completion"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Link href="/control-library/coverage" className="card hover:border-primary-500/50 transition-colors group">
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-600/10 p-3">
              <Grid3X3 className="h-6 w-6 text-blue-400" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800 group-hover:text-primary-400 transition-colors">Coverage Matrix</h3>
              <p className="text-sm text-slate-400">View evidence coverage heatmap</p>
            </div>
          </div>
        </Link>
        <Link href="/control-library/gaps" className="card hover:border-primary-500/50 transition-colors group">
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-gradient-to-br from-orange-500/20 to-orange-600/10 p-3">
              <AlertCircle className="h-6 w-6 text-orange-400" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800 group-hover:text-primary-400 transition-colors">Gap Analysis</h3>
              <p className="text-sm text-slate-400">Identify and address control gaps</p>
            </div>
          </div>
        </Link>
        <Link href="/control-library/compare" className="card hover:border-primary-500/50 transition-colors group">
          <div className="flex items-center gap-4">
            <div className="rounded-xl bg-gradient-to-br from-purple-500/20 to-purple-600/10 p-3">
              <BarChart3 className="h-6 w-6 text-primary-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800 group-hover:text-primary-400 transition-colors">Compare Controls</h3>
              <p className="text-sm text-slate-400">Side-by-side control comparison</p>
            </div>
          </div>
        </Link>
      </div>

      <div className="card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1 sm:max-w-xs">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search by name or code..."
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setPage(0); }}
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-4 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none"
              />
            </div>

            <select
              value={categoryFilter}
              onChange={(e) => { setCategoryFilter(e.target.value); setPage(0); }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none"
            >
              <option value="">All Categories</option>
              {categories?.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>

            <select
              value={domainFilter}
              onChange={(e) => { setDomainFilter(e.target.value); setPage(0); }}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none"
            >
              <option value="">All Domains</option>
              {domains?.map(dom => (
                <option key={dom} value={dom}>{dom}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input
                type="checkbox"
                checked={showEmptyGroups}
                onChange={(e) => setShowEmptyGroups(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 bg-slate-200 text-primary-600 focus:ring-primary-500"
              />
              Show empty groups
            </label>
            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
              <button
                onClick={() => setViewMode('cards')}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  viewMode === 'cards' 
                    ? 'bg-primary-600 text-white' 
                    : 'bg-white text-slate-400 hover:text-slate-900'
                }`}
              >
                <Grid3X3 className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  viewMode === 'table' 
                    ? 'bg-primary-600 text-white' 
                    : 'bg-white text-slate-400 hover:text-slate-900'
                }`}
              >
                <FileText className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {groupsLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
        </div>
      ) : groupsError ? (
        <div className="flex h-64 flex-col items-center justify-center text-red-400">
          <AlertCircle className="mb-2 h-8 w-8" />
          <p>Failed to load control groups</p>
          <button onClick={() => refetchGroups()} className="mt-2 text-sm text-primary-400 hover:underline">
            Try again
          </button>
        </div>
      ) : !filteredGroups || filteredGroups.length === 0 ? (
        <div className="card flex flex-col items-center justify-center py-12 text-center">
          <Library className="mb-4 h-12 w-12 text-slate-600" />
          <h3 className="text-lg font-medium text-slate-800">No control groups found</h3>
          <p className="mt-1 text-slate-400">Create your first control group or use AI auto-grouping</p>
          <div className="mt-4 flex gap-3">
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
            >
              <Plus size={16} />
              Create Group
            </button>
            <button
              onClick={() => setShowAutoGroupModal(true)}
              className="flex items-center gap-2 rounded-lg border border-primary-500 px-4 py-2 font-medium text-primary-400 hover:bg-primary-500/10"
            >
              <Sparkles size={16} />
              Auto-Group
            </button>
          </div>
        </div>
      ) : viewMode === 'cards' ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredGroups?.map((group) => {
              const completion = getGroupCompletionPercent(group);
              return (
                <div
                  key={group.id}
                  className="card hover:border-slate-300 transition-all group"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="rounded-lg bg-primary-500/20 p-2">
                        <Shield className="h-5 w-5 text-primary-400" />
                      </div>
                      <div>
                        <span className="font-mono text-xs text-primary-400">{group.code}</span>
                        <h3 className="font-medium text-slate-800 line-clamp-1">{group.name}</h3>
                      </div>
                    </div>
                    <ProgressRing
                      percentage={completion}
                      size={40}
                      strokeWidth={3}
                      color={completion >= 70 ? 'success' : completion >= 40 ? 'warning' : 'danger'}
                      showPercentage={false}
                    />
                  </div>

                  {group.description && (
                    <p className="text-sm text-slate-400 line-clamp-2 mb-3">{group.description}</p>
                  )}

                  <div className="flex flex-wrap gap-2 mb-4">
                    {group.category && (
                      <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-xs text-blue-400">
                        {group.category}
                      </span>
                    )}
                    {group.domain && (
                      <span className="rounded-full bg-primary-500/20 px-2 py-0.5 text-xs text-primary-600">
                        {group.domain}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between border-t border-slate-200 pt-3">
                    <div className="flex items-center gap-4 text-sm">
                      <div className="flex items-center gap-1">
                        <Shield className="h-4 w-4 text-slate-400" />
                        <span className="text-slate-800 font-medium">{group.total_control_count}</span>
                        <span className="text-slate-500">controls</span>
                      </div>
                      {group.normalized_control_count > 0 && (
                        <span className="text-xs text-green-400">
                          {group.normalized_control_count} normalized
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Link
                        href={`/control-library/${group.id}`}
                        title="View Details"
                        className="rounded p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-900"
                      >
                        <Eye size={14} />
                      </Link>
                      <button
                        title="Edit"
                        onClick={() => setEditingGroup(group)}
                        className="rounded p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-900"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        title="Generate AI Summary"
                        onClick={() => generateSummaryMutation.mutate(group.id)}
                        disabled={generateSummaryMutation.isPending}
                        className="rounded p-1.5 text-slate-400 hover:bg-slate-200 hover:text-primary-400"
                      >
                        <Sparkles size={14} />
                      </button>
                      <button
                        title="Delete"
                        onClick={() => handleDeleteGroup(group)}
                        className="rounded p-1.5 text-slate-400 hover:bg-red-900/50 hover:text-red-400"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full">
            <thead className="bg-white/50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Code</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Name</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Category</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Domain</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Controls</th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Completion</th>
                <th className="w-32 px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700 bg-white">
              {filteredGroups?.map((group) => {
                const completion = getGroupCompletionPercent(group);
                return (
                  <tr key={group.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <span className="font-mono text-sm font-medium text-primary-400">{group.code}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="max-w-xs">
                        <p className="truncate text-sm font-medium text-slate-800">{group.name}</p>
                        {group.description && (
                          <p className="truncate text-xs text-slate-400">{group.description}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {group.category ? (
                        <span className="rounded-full bg-blue-500/20 px-2 py-1 text-xs text-blue-400">
                          {group.category}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {group.domain ? (
                        <span className="rounded-full bg-primary-500/20 px-2 py-1 text-xs text-primary-600">
                          {group.domain}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-slate-400" />
                        <span className="text-sm font-medium text-slate-800">{group.total_control_count}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-20 overflow-hidden rounded-full bg-slate-200">
                          <div
                            className={`h-full transition-all ${
                              completion >= 70 ? 'bg-green-500' : completion >= 40 ? 'bg-yellow-500' : 'bg-red-500'
                            }`}
                            style={{ width: `${completion}%` }}
                          />
                        </div>
                        <span className="text-xs text-slate-400">{completion}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/control-library/${group.id}`}
                          title="View Details"
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-900"
                        >
                          <Eye size={14} />
                        </Link>
                        <button
                          title="Edit"
                          onClick={() => setEditingGroup(group)}
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-900"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          title="Generate AI Summary"
                          onClick={() => generateSummaryMutation.mutate(group.id)}
                          disabled={generateSummaryMutation.isPending}
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-200 hover:text-primary-400"
                        >
                          <Sparkles size={14} />
                        </button>
                        <button
                          title="Delete"
                          onClick={() => handleDeleteGroup(group)}
                          className="rounded p-1.5 text-slate-400 hover:bg-red-900/50 hover:text-red-400"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-200 pt-4">
          <div className="text-sm text-slate-400">
            Showing {page * pageSize + 1} to {Math.min((page + 1) * pageSize, groupsData?.total || 0)} of {groupsData?.total || 0} results
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-200 disabled:opacity-50"
            >
              Previous
            </button>
            <span className="px-3 text-sm text-slate-400">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-800 hover:bg-slate-200 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800">Create Control Group</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-slate-900">
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createGroupMutation.mutate(newGroup);
              }}
              className="space-y-4"
            >
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">Code *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., CCG-001"
                  value={newGroup.code}
                  onChange={(e) => setNewGroup({ ...newGroup, code: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Access Control Management"
                  value={newGroup.name}
                  onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">Description</label>
                <textarea
                  placeholder="Describe the purpose of this control group..."
                  value={newGroup.description}
                  onChange={(e) => setNewGroup({ ...newGroup, description: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">Category</label>
                  <input
                    type="text"
                    placeholder="e.g., Access Control"
                    value={newGroup.category}
                    onChange={(e) => setNewGroup({ ...newGroup, category: e.target.value })}
                    list="categories-list"
                    className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none"
                  />
                  <datalist id="categories-list">
                    {categories?.map(cat => <option key={cat} value={cat} />)}
                  </datalist>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">Domain</label>
                  <input
                    type="text"
                    placeholder="e.g., Security"
                    value={newGroup.domain}
                    onChange={(e) => setNewGroup({ ...newGroup, domain: e.target.value })}
                    list="domains-list"
                    className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 placeholder-slate-400 focus:border-primary-500 focus:outline-none"
                  />
                  <datalist id="domains-list">
                    {domains?.map(dom => <option key={dom} value={dom} />)}
                  </datalist>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-slate-600 hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createGroupMutation.isPending}
                  className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {createGroupMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Create Group
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editingGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-800">Edit Control Group</h2>
              <button onClick={() => setEditingGroup(null)} className="text-slate-400 hover:text-slate-900">
                <X size={20} />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                updateGroupMutation.mutate({
                  id: editingGroup.id,
                  data: {
                    code: editingGroup.code,
                    name: editingGroup.name,
                    description: editingGroup.description,
                    category: editingGroup.category,
                    domain: editingGroup.domain,
                  },
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">Code *</label>
                <input
                  type="text"
                  required
                  value={editingGroup.code}
                  onChange={(e) => setEditingGroup({ ...editingGroup, code: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">Name *</label>
                <input
                  type="text"
                  required
                  value={editingGroup.name}
                  onChange={(e) => setEditingGroup({ ...editingGroup, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-600">Description</label>
                <textarea
                  value={editingGroup.description || ''}
                  onChange={(e) => setEditingGroup({ ...editingGroup, description: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">Category</label>
                  <input
                    type="text"
                    value={editingGroup.category || ''}
                    onChange={(e) => setEditingGroup({ ...editingGroup, category: e.target.value })}
                    list="edit-categories-list"
                    className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none"
                  />
                  <datalist id="edit-categories-list">
                    {categories?.map(cat => <option key={cat} value={cat} />)}
                  </datalist>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-600">Domain</label>
                  <input
                    type="text"
                    value={editingGroup.domain || ''}
                    onChange={(e) => setEditingGroup({ ...editingGroup, domain: e.target.value })}
                    list="edit-domains-list"
                    className="w-full rounded-lg border border-slate-300 bg-slate-200 px-3 py-2 text-slate-800 focus:border-primary-500 focus:outline-none"
                  />
                  <datalist id="edit-domains-list">
                    {domains?.map(dom => <option key={dom} value={dom} />)}
                  </datalist>
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setEditingGroup(null)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-slate-600 hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={updateGroupMutation.isPending}
                  className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {updateGroupMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAutoGroupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary-500/20 p-2">
                  <Sparkles className="h-5 w-5 text-primary-400" />
                </div>
                <h2 className="text-lg font-semibold text-slate-800">AI Auto-Grouping</h2>
              </div>
              <button onClick={() => setShowAutoGroupModal(false)} className="text-slate-400 hover:text-slate-900">
                <X size={20} />
              </button>
            </div>

            {autoGroupError ? (
              <div className="space-y-4">
                <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-4">
                  <div className="flex items-center gap-2 text-red-400">
                    <XCircle size={20} />
                    <span className="font-medium">Auto-grouping failed</span>
                  </div>
                  <p className="mt-2 text-slate-600">{autoGroupError}</p>
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <button
                    onClick={() => {
                      setShowAutoGroupModal(false);
                      setAutoGroupError(null);
                    }}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-slate-600 hover:bg-slate-200"
                  >
                    Close
                  </button>
                  <button
                    onClick={() => {
                      setAutoGroupError(null);
                      autoGroupMutation.mutate(selectedFrameworks);
                    }}
                    className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
                  >
                    <RefreshCw size={16} />
                    Retry
                  </button>
                </div>
              </div>
            ) : !autoGroupResult && !autoGroupLoading ? (
              <div className="space-y-4">
                <p className="text-slate-400">
                  Use AI to automatically analyze and group related controls across your frameworks.
                </p>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-600">Select Frameworks (optional)</label>
                  <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-slate-300 bg-slate-200 p-3">
                    {uploadedFrameworks?.map((fw: any) => (
                      <label key={fw.id} className="flex items-center gap-2 text-sm text-slate-600">
                        <input
                          type="checkbox"
                          checked={selectedFrameworks.includes(fw.id)}
                          onChange={(e) => {
                            const id = fw.id;
                            if (e.target.checked) {
                              setSelectedFrameworks([...selectedFrameworks, id]);
                            } else {
                              setSelectedFrameworks(selectedFrameworks.filter(f => f !== id));
                            }
                          }}
                          className="h-4 w-4 rounded border-slate-300 bg-slate-200 text-primary-600 focus:ring-primary-500"
                        />
                        {fw.name}
                      </label>
                    ))}
                    {(!uploadedFrameworks || uploadedFrameworks.length === 0) && (
                      <p className="text-sm text-slate-500">No frameworks uploaded. Please upload frameworks first.</p>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Leave empty to analyze all frameworks</p>
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <button
                    onClick={() => setShowAutoGroupModal(false)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-slate-600 hover:bg-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => autoGroupMutation.mutate(selectedFrameworks)}
                    className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
                  >
                    <Play size={16} />
                    Start Auto-Grouping
                  </button>
                </div>
              </div>
            ) : autoGroupLoading ? (
              <div className="flex flex-col items-center justify-center py-8">
                <Loader2 className="mb-4 h-12 w-12 animate-spin text-primary-400" />
                <p className="text-slate-800">Analyzing controls with AI...</p>
                <p className="mt-1 text-sm text-slate-400">This may take a moment</p>
              </div>
            ) : autoGroupResult ? (
              <div className="space-y-4">
                <div className="rounded-lg bg-green-500/10 border border-green-500/30 p-4">
                  <div className="flex items-center gap-2 text-green-400">
                    <CheckCircle size={20} />
                    <span className="font-medium">Auto-grouping complete!</span>
                  </div>
                  <p className="mt-2 text-slate-600">{autoGroupResult.message}</p>
                </div>
                <div className="rounded-lg border border-slate-300 bg-slate-200 p-4">
                  <h4 className="mb-2 font-medium text-slate-800">Results</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-slate-400">Groups Created</p>
                      <p className="text-2xl font-semibold text-slate-800">{autoGroupResult.groups_created}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Total Controls Grouped</p>
                      <p className="text-2xl font-semibold text-slate-800">
                        {autoGroupResult.groups?.reduce((sum, g) => sum + (g.total_control_count || 0), 0) || 0}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      setShowAutoGroupModal(false);
                      setAutoGroupResult(null);
                    }}
                    className="rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {showAnalysisModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary-500/20 p-2">
                  <Brain className="h-5 w-5 text-primary-600" />
                </div>
                <h2 className="text-lg font-semibold text-slate-800">AI Similarity Analysis</h2>
              </div>
              <button onClick={() => setShowAnalysisModal(false)} className="text-slate-400 hover:text-slate-900">
                <X size={20} />
              </button>
            </div>

            {analysisError ? (
              <div className="space-y-4">
                <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-4">
                  <div className="flex items-center gap-2 text-red-400">
                    <XCircle size={20} />
                    <span className="font-medium">Analysis failed</span>
                  </div>
                  <p className="mt-2 text-slate-600">{analysisError}</p>
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <button
                    onClick={() => {
                      setShowAnalysisModal(false);
                      setAnalysisError(null);
                    }}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-slate-600 hover:bg-slate-200"
                  >
                    Close
                  </button>
                  <button
                    onClick={() => {
                      setAnalysisError(null);
                      startAnalysisMutation.mutate(selectedFrameworks);
                    }}
                    className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
                  >
                    <RefreshCw size={16} />
                    Retry
                  </button>
                </div>
              </div>
            ) : !analysisResult && !analysisLoading ? (
              <div className="space-y-4">
                <p className="text-slate-400">
                  Run AI analysis to identify similar and related controls across your frameworks.
                  This will create similarity mappings that help with control harmonization.
                </p>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-600">Select Frameworks (optional)</label>
                  <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-slate-300 bg-slate-200 p-3">
                    {uploadedFrameworks?.map((fw: any) => (
                      <label key={fw.id} className="flex items-center gap-2 text-sm text-slate-600">
                        <input
                          type="checkbox"
                          checked={selectedFrameworks.includes(fw.id)}
                          onChange={(e) => {
                            const id = fw.id;
                            if (e.target.checked) {
                              setSelectedFrameworks([...selectedFrameworks, id]);
                            } else {
                              setSelectedFrameworks(selectedFrameworks.filter(f => f !== id));
                            }
                          }}
                          className="h-4 w-4 rounded border-slate-300 bg-slate-200 text-primary-600 focus:ring-primary-500"
                        />
                        {fw.name}
                      </label>
                    ))}
                    {(!uploadedFrameworks || uploadedFrameworks.length === 0) && (
                      <p className="text-sm text-slate-500">No frameworks uploaded. Please upload frameworks first.</p>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Leave empty to analyze all frameworks</p>
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <button
                    onClick={() => setShowAnalysisModal(false)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-slate-600 hover:bg-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => startAnalysisMutation.mutate(selectedFrameworks)}
                    className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
                  >
                    <Brain size={16} />
                    Start Analysis
                  </button>
                </div>
              </div>
            ) : analysisLoading ? (
              <div className="flex flex-col items-center justify-center py-8">
                <Loader2 className="mb-4 h-12 w-12 animate-spin text-primary-600" />
                <p className="text-slate-800">Running AI similarity analysis...</p>
                <p className="mt-1 text-sm text-slate-400">This may take a moment</p>
              </div>
            ) : analysisResult ? (
              <div className="space-y-4">
                <div className="rounded-lg bg-green-500/10 border border-green-500/30 p-4">
                  <div className="flex items-center gap-2 text-green-400">
                    <CheckCircle size={20} />
                    <span className="font-medium">Analysis complete!</span>
                  </div>
                </div>
                <div className="rounded-lg border border-slate-300 bg-slate-200 p-4">
                  <h4 className="mb-2 font-medium text-slate-800">Results</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-slate-400">Controls Analyzed</p>
                      <p className="text-2xl font-semibold text-slate-800">{analysisResult.total_controls_analyzed}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Mappings Created</p>
                      <p className="text-2xl font-semibold text-slate-800">{analysisResult.mappings_created}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Groups Created</p>
                      <p className="text-2xl font-semibold text-slate-800">{analysisResult.groups_created}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Status</p>
                      <p className="text-lg font-semibold text-green-400 capitalize">{analysisResult.status}</p>
                    </div>
                  </div>
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={() => {
                      setShowAnalysisModal(false);
                      setAnalysisResult(null);
                    }}
                    className="rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
