'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient, { frameworksApi } from '@/lib/api';
import { Framework } from '@/types';
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
  Play
} from 'lucide-react';
import Link from 'next/link';

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

  const { data: frameworks } = useQuery({
    queryKey: ['frameworks'],
    queryFn: async () => {
      const response = await frameworksApi.getAll();
      return response.data;
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

  const autoGroupMutation = useMutation({
    mutationFn: async (frameworkIds: number[]) => {
      setAutoGroupLoading(true);
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
    onError: () => {
      setAutoGroupLoading(false);
    },
  });

  const [analysisResult, setAnalysisResult] = useState<Analysis | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  const startAnalysisMutation = useMutation({
    mutationFn: async (frameworkIds: number[]) => {
      setAnalysisLoading(true);
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
    onError: () => {
      setAnalysisLoading(false);
    },
  });

  const handleDeleteGroup = (group: ControlGroup) => {
    if (confirm(`Are you sure you want to delete "${group.name}"?`)) {
      deleteGroupMutation.mutate(group.id);
    }
  };

  const totalGroups = groupsData?.total || 0;
  const totalControls = groupsData?.items?.reduce((sum, g) => sum + g.total_control_count, 0) || 0;
  const uniqueFrameworks = new Set(groupsData?.items?.flatMap(g => [g.category, g.domain]).filter(Boolean)).size;

  const filteredGroups = showEmptyGroups
    ? groupsData?.items
    : groupsData?.items?.filter(g => g.total_control_count > 0);

  const totalPages = Math.ceil((groupsData?.total || 0) / pageSize);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Unified Control Library</h1>
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
            className="flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-700 px-4 py-2 font-medium text-white hover:bg-slate-600"
          >
            <Brain size={18} />
            Run AI Analysis
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-primary-500/20 to-primary-600/10 p-3">
              <Library className="h-6 w-6 text-primary-400" />
            </div>
          </div>
          <p className="stat-value">{groupsLoading ? '-' : totalGroups}</p>
          <p className="stat-label">Total Control Groups</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-600/10 p-3">
              <GitMerge className="h-6 w-6 text-blue-400" />
            </div>
          </div>
          <p className="stat-value">{groupsLoading ? '-' : totalControls}</p>
          <p className="stat-label">Total Mapped Controls</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-green-500/20 to-green-600/10 p-3">
              <Layers className="h-6 w-6 text-green-400" />
            </div>
          </div>
          <p className="stat-value">{groupsLoading ? '-' : frameworks?.length || 0}</p>
          <p className="stat-label">Frameworks Covered</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-purple-500/20 to-purple-600/10 p-3">
              <Brain className="h-6 w-6 text-purple-400" />
            </div>
          </div>
          <p className="stat-value text-base">
            {latestAnalysis?.total ? `${latestAnalysis.total} mappings` : 'Ready'}
          </p>
          <p className="stat-label">AI Analysis Status</p>
        </div>
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
                className="w-full rounded-lg border border-slate-600 bg-slate-800 py-2 pl-10 pr-4 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none"
              />
            </div>

            <select
              value={categoryFilter}
              onChange={(e) => { setCategoryFilter(e.target.value); setPage(0); }}
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
            >
              <option value="">All Categories</option>
              {categories?.map(cat => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>

            <select
              value={domainFilter}
              onChange={(e) => { setDomainFilter(e.target.value); setPage(0); }}
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
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
                className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-primary-600 focus:ring-primary-500"
              />
              Show empty groups
            </label>
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
          <h3 className="text-lg font-medium text-white">No control groups found</h3>
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
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-slate-700">
            <table className="w-full">
              <thead className="bg-slate-800/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Code</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Category</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Domain</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Controls</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Breakdown</th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Keywords</th>
                  <th className="w-32 px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700 bg-slate-800">
                {filteredGroups?.map((group) => (
                  <tr key={group.id} className="hover:bg-slate-700/50">
                    <td className="px-4 py-3">
                      <span className="font-mono text-sm font-medium text-primary-400">{group.code}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="max-w-xs">
                        <p className="truncate text-sm font-medium text-white">{group.name}</p>
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
                        <span className="rounded-full bg-purple-500/20 px-2 py-1 text-xs text-purple-400">
                          {group.domain}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-500">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Shield className="h-4 w-4 text-slate-400" />
                        <span className="text-sm font-medium text-white">{group.total_control_count}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {group.normalized_control_count > 0 && (
                          <span className="rounded bg-green-500/20 px-1.5 py-0.5 text-xs text-green-400">
                            {group.normalized_control_count} normalized
                          </span>
                        )}
                        {group.framework_control_count > 0 && (
                          <span className="rounded bg-orange-500/20 px-1.5 py-0.5 text-xs text-orange-400">
                            {group.framework_control_count} framework
                          </span>
                        )}
                        {group.total_control_count === 0 && (
                          <span className="text-xs text-slate-500">No controls</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1 max-w-[150px]">
                        {group.keywords?.slice(0, 3).map((kw, idx) => (
                          <span key={idx} className="rounded bg-slate-700 px-1.5 py-0.5 text-xs text-slate-300">
                            {kw}
                          </span>
                        ))}
                        {(group.keywords?.length || 0) > 3 && (
                          <span className="text-xs text-slate-500">+{group.keywords!.length - 3}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/control-library/${group.id}`}
                          title="View Details"
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white"
                        >
                          <Eye size={14} />
                        </Link>
                        <button
                          title="Edit"
                          onClick={() => setEditingGroup(group)}
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          title="Generate AI Summary"
                          onClick={() => generateSummaryMutation.mutate(group.id)}
                          disabled={generateSummaryMutation.isPending}
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-primary-400"
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
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-700 pt-4">
              <div className="text-sm text-slate-400">
                Showing {page * pageSize + 1} to {Math.min((page + 1) * pageSize, groupsData?.total || 0)} of {groupsData?.total || 0} results
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  Previous
                </button>
                <span className="px-3 text-sm text-slate-400">
                  Page {page + 1} of {totalPages}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-800 p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Create Control Group</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white">
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
                <label className="mb-1 block text-sm font-medium text-slate-300">Code *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., CCG-001"
                  value={newGroup.code}
                  onChange={(e) => setNewGroup({ ...newGroup, code: e.target.value })}
                  className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Access Control Management"
                  value={newGroup.name}
                  onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">Description</label>
                <textarea
                  placeholder="Describe the purpose of this control group..."
                  value={newGroup.description}
                  onChange={(e) => setNewGroup({ ...newGroup, description: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-300">Category</label>
                  <input
                    type="text"
                    placeholder="e.g., Access Control"
                    value={newGroup.category}
                    onChange={(e) => setNewGroup({ ...newGroup, category: e.target.value })}
                    list="categories-list"
                    className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none"
                  />
                  <datalist id="categories-list">
                    {categories?.map(cat => <option key={cat} value={cat} />)}
                  </datalist>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-300">Domain</label>
                  <input
                    type="text"
                    placeholder="e.g., Security"
                    value={newGroup.domain}
                    onChange={(e) => setNewGroup({ ...newGroup, domain: e.target.value })}
                    list="domains-list"
                    className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none"
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
                  className="rounded-lg border border-slate-600 px-4 py-2 text-slate-300 hover:bg-slate-700"
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
          <div className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-800 p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">Edit Control Group</h2>
              <button onClick={() => setEditingGroup(null)} className="text-slate-400 hover:text-white">
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
                <label className="mb-1 block text-sm font-medium text-slate-300">Code *</label>
                <input
                  type="text"
                  required
                  value={editingGroup.code}
                  onChange={(e) => setEditingGroup({ ...editingGroup, code: e.target.value })}
                  className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">Name *</label>
                <input
                  type="text"
                  required
                  value={editingGroup.name}
                  onChange={(e) => setEditingGroup({ ...editingGroup, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-300">Description</label>
                <textarea
                  value={editingGroup.description || ''}
                  onChange={(e) => setEditingGroup({ ...editingGroup, description: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-300">Category</label>
                  <input
                    type="text"
                    value={editingGroup.category || ''}
                    onChange={(e) => setEditingGroup({ ...editingGroup, category: e.target.value })}
                    list="edit-categories-list"
                    className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
                  />
                  <datalist id="edit-categories-list">
                    {categories?.map(cat => <option key={cat} value={cat} />)}
                  </datalist>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-300">Domain</label>
                  <input
                    type="text"
                    value={editingGroup.domain || ''}
                    onChange={(e) => setEditingGroup({ ...editingGroup, domain: e.target.value })}
                    list="edit-domains-list"
                    className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
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
                  className="rounded-lg border border-slate-600 px-4 py-2 text-slate-300 hover:bg-slate-700"
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
          <div className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-800 p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary-500/20 p-2">
                  <Sparkles className="h-5 w-5 text-primary-400" />
                </div>
                <h2 className="text-lg font-semibold text-white">AI Auto-Grouping</h2>
              </div>
              <button onClick={() => setShowAutoGroupModal(false)} className="text-slate-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            {!autoGroupResult && !autoGroupLoading ? (
              <div className="space-y-4">
                <p className="text-slate-400">
                  Use AI to automatically analyze and group related controls across your frameworks.
                </p>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">Select Frameworks (optional)</label>
                  <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-slate-600 bg-slate-700 p-3">
                    {frameworks?.map((fw: Framework) => (
                      <label key={fw.id} className="flex items-center gap-2 text-sm text-slate-300">
                        <input
                          type="checkbox"
                          checked={selectedFrameworks.includes(parseInt(fw.id))}
                          onChange={(e) => {
                            const id = parseInt(fw.id);
                            if (e.target.checked) {
                              setSelectedFrameworks([...selectedFrameworks, id]);
                            } else {
                              setSelectedFrameworks(selectedFrameworks.filter(f => f !== id));
                            }
                          }}
                          className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-primary-600 focus:ring-primary-500"
                        />
                        {fw.name}
                      </label>
                    ))}
                    {(!frameworks || frameworks.length === 0) && (
                      <p className="text-sm text-slate-500">No frameworks available</p>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Leave empty to analyze all frameworks</p>
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <button
                    onClick={() => setShowAutoGroupModal(false)}
                    className="rounded-lg border border-slate-600 px-4 py-2 text-slate-300 hover:bg-slate-700"
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
                <p className="text-white">Analyzing controls with AI...</p>
                <p className="mt-1 text-sm text-slate-400">This may take a moment</p>
              </div>
            ) : autoGroupResult ? (
              <div className="space-y-4">
                <div className="rounded-lg bg-green-500/10 border border-green-500/30 p-4">
                  <div className="flex items-center gap-2 text-green-400">
                    <CheckCircle size={20} />
                    <span className="font-medium">Auto-grouping complete!</span>
                  </div>
                  <p className="mt-2 text-slate-300">{autoGroupResult.message}</p>
                </div>
                <div className="rounded-lg border border-slate-600 bg-slate-700 p-4">
                  <h4 className="mb-2 font-medium text-white">Results</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-slate-400">Groups Created</p>
                      <p className="text-2xl font-semibold text-white">{autoGroupResult.groups_created}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Total Controls Grouped</p>
                      <p className="text-2xl font-semibold text-white">
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
          <div className="w-full max-w-lg rounded-lg border border-slate-700 bg-slate-800 p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-purple-500/20 p-2">
                  <Brain className="h-5 w-5 text-purple-400" />
                </div>
                <h2 className="text-lg font-semibold text-white">AI Similarity Analysis</h2>
              </div>
              <button onClick={() => setShowAnalysisModal(false)} className="text-slate-400 hover:text-white">
                <X size={20} />
              </button>
            </div>

            {!analysisResult && !analysisLoading ? (
              <div className="space-y-4">
                <p className="text-slate-400">
                  Run AI analysis to identify similar and related controls across your frameworks.
                  This will create similarity mappings that help with control harmonization.
                </p>
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-300">Select Frameworks (optional)</label>
                  <div className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-slate-600 bg-slate-700 p-3">
                    {frameworks?.map((fw: Framework) => (
                      <label key={fw.id} className="flex items-center gap-2 text-sm text-slate-300">
                        <input
                          type="checkbox"
                          checked={selectedFrameworks.includes(parseInt(fw.id))}
                          onChange={(e) => {
                            const id = parseInt(fw.id);
                            if (e.target.checked) {
                              setSelectedFrameworks([...selectedFrameworks, id]);
                            } else {
                              setSelectedFrameworks(selectedFrameworks.filter(f => f !== id));
                            }
                          }}
                          className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-primary-600 focus:ring-primary-500"
                        />
                        {fw.name}
                      </label>
                    ))}
                    {(!frameworks || frameworks.length === 0) && (
                      <p className="text-sm text-slate-500">No frameworks available</p>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">Leave empty to analyze all frameworks</p>
                </div>
                <div className="flex justify-end gap-3 pt-4">
                  <button
                    onClick={() => setShowAnalysisModal(false)}
                    className="rounded-lg border border-slate-600 px-4 py-2 text-slate-300 hover:bg-slate-700"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => startAnalysisMutation.mutate(selectedFrameworks)}
                    className="flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 font-medium text-white hover:bg-purple-700"
                  >
                    <Brain size={16} />
                    Run Analysis
                  </button>
                </div>
              </div>
            ) : analysisLoading ? (
              <div className="flex flex-col items-center justify-center py-8">
                <Loader2 className="mb-4 h-12 w-12 animate-spin text-purple-400" />
                <p className="text-white">Running AI similarity analysis...</p>
                <p className="mt-1 text-sm text-slate-400">Analyzing control relationships</p>
              </div>
            ) : analysisResult ? (
              <div className="space-y-4">
                <div className={`rounded-lg p-4 ${
                  analysisResult.status === 'completed' 
                    ? 'bg-green-500/10 border border-green-500/30' 
                    : analysisResult.status === 'failed'
                    ? 'bg-red-500/10 border border-red-500/30'
                    : 'bg-blue-500/10 border border-blue-500/30'
                }`}>
                  <div className={`flex items-center gap-2 ${
                    analysisResult.status === 'completed' ? 'text-green-400' :
                    analysisResult.status === 'failed' ? 'text-red-400' : 'text-blue-400'
                  }`}>
                    {analysisResult.status === 'completed' ? <CheckCircle size={20} /> :
                     analysisResult.status === 'failed' ? <XCircle size={20} /> :
                     <RefreshCw size={20} className="animate-spin" />}
                    <span className="font-medium capitalize">{analysisResult.status}</span>
                  </div>
                  {analysisResult.error_message && (
                    <p className="mt-2 text-sm text-red-300">{analysisResult.error_message}</p>
                  )}
                </div>
                <div className="rounded-lg border border-slate-600 bg-slate-700 p-4">
                  <h4 className="mb-3 font-medium text-white">Analysis Results</h4>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div className="text-center">
                      <p className="text-slate-400">Controls Analyzed</p>
                      <p className="text-2xl font-semibold text-white">{analysisResult.total_controls_analyzed}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-slate-400">Mappings Created</p>
                      <p className="text-2xl font-semibold text-white">{analysisResult.mappings_created}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-slate-400">Groups Created</p>
                      <p className="text-2xl font-semibold text-white">{analysisResult.groups_created}</p>
                    </div>
                  </div>
                </div>
                {analysisResult.completed_at && (
                  <p className="text-xs text-slate-500">
                    Completed at: {new Date(analysisResult.completed_at).toLocaleString()}
                  </p>
                )}
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
