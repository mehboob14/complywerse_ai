'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import {
  Rss,
  RefreshCw,
  AlertCircle,
  CheckCircle,
  Loader2,
  ExternalLink,
  FileText,
  Globe,
  Clock,
  Brain,
  ChevronDown,
  ChevronRight,
  Trash2,
  Edit,
  Play,
  Eye,
  ArrowRightCircle,
  Database,
  Filter,
  Plus,
  X,
} from 'lucide-react';

interface FeedSource {
  id: number;
  name: string;
  regulator: string;
  country: string;
  category: string;
  source_url: string;
  source_type: string;
  is_active: boolean;
  poll_interval_hours: number;
  last_polled_at: string | null;
  last_successful_poll: string | null;
  items_processed: number;
  created_at: string;
  updated_at: string;
}

interface ImpactedFramework {
  name: string;
  relevance: string;
  reason: string;
}

interface ImpactedControl {
  id: string;
  name: string;
  gap_type: string;
  action_needed: string;
}

interface ImpactedPolicy {
  title: string;
  action_needed: string;
}

interface ImplementationTask {
  title: string;
  description: string;
  priority: string;
  suggested_deadline_days: number;
}

interface AIAnalysis {
  summary: string;
  priority: string;
  effective_date_estimate: string | null;
  compliance_gaps: string[];
  impacted_frameworks: ImpactedFramework[];
  impacted_controls: ImpactedControl[];
  impacted_policies: ImpactedPolicy[];
  implementation_tasks: ImplementationTask[];
  recommendations: string[];
  analyzed_at: string;
  model_used: string;
}

interface FeedItem {
  id: number;
  feed_source_id: number;
  feed_source_name: string;
  guid: string;
  title: string;
  link: string;
  description: string;
  content: string | null;
  published_date: string;
  status: string;
  ai_analysis: AIAnalysis | null;
  regulatory_change_id: number | null;
  processed_at: string | null;
  created_at: string;
}

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  new: { bg: 'bg-blue-50', text: 'text-blue-600', label: 'New' },
  analyzed: { bg: 'bg-amber-50', text: 'text-amber-600', label: 'Analyzed' },
  processed: { bg: 'bg-emerald-50', text: 'text-emerald-600', label: 'Processed' },
  active: { bg: 'bg-emerald-50', text: 'text-emerald-600', label: 'Active' },
  inactive: { bg: 'bg-slate-50', text: 'text-slate-600', label: 'Inactive' },
  error: { bg: 'bg-rose-50', text: 'text-rose-600', label: 'Error' },
};

const PRIORITY_STYLES: Record<string, { bg: string; text: string }> = {
  critical: { bg: 'bg-rose-50', text: 'text-rose-600' },
  high: { bg: 'bg-orange-50', text: 'text-orange-600' },
  medium: { bg: 'bg-amber-50', text: 'text-amber-600' },
  low: { bg: 'bg-blue-50', text: 'text-blue-600' },
};

const FILTER_OPTIONS = [
  { value: '', label: 'All Items' },
  { value: 'new', label: 'New' },
  { value: 'analyzed', label: 'Analyzed' },
  { value: 'processed', label: 'Processed' },
];

export default function RegulatoryFeedsPage() {
  const [sourcesExpanded, setSourcesExpanded] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set());
  const [showAddModal, setShowAddModal] = useState(false);
  const [newFeed, setNewFeed] = useState({
    name: '',
    source_url: '',
    source_type: 'rss',
    regulator: '',
    country: '',
    category: 'general',
    poll_interval_hours: 24,
  });
  const queryClient = useQueryClient();

  const { data: sources, isLoading: sourcesLoading } = useQuery({
    queryKey: ['regulatory-feed-sources'],
    queryFn: async () => {
      const response = await apiClient.get('/governance/regulatory-feeds/sources');
      return response.data as FeedSource[];
    },
  });

  const { data: items, isLoading: itemsLoading } = useQuery({
    queryKey: ['regulatory-feed-items', statusFilter],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (statusFilter) params.status = statusFilter;
      const response = await apiClient.get('/governance/regulatory-feeds/items', { params });
      return response.data as FeedItem[];
    },
  });

  const seedCBSLMutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.post('/governance/regulatory-feeds/seed-cbsl');
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regulatory-feed-sources'] });
      queryClient.invalidateQueries({ queryKey: ['regulatory-feed-items'] });
    },
  });

  const pollAllMutation = useMutation({
    mutationFn: async () => {
      const response = await apiClient.post('/governance/regulatory-feeds/poll-all');
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regulatory-feed-sources'] });
      queryClient.invalidateQueries({ queryKey: ['regulatory-feed-items'] });
    },
  });

  const createFeedMutation = useMutation({
    mutationFn: async (feedData: typeof newFeed) => {
      const response = await apiClient.post('/governance/regulatory-feeds/sources', feedData);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regulatory-feed-sources'] });
      setShowAddModal(false);
      setNewFeed({
        name: '',
        source_url: '',
        source_type: 'rss',
        regulator: '',
        country: '',
        category: 'general',
        poll_interval_hours: 24,
      });
    },
  });

  const pollSourceMutation = useMutation({
    mutationFn: async (sourceId: number) => {
      const response = await apiClient.post(`/governance/regulatory-feeds/sources/${sourceId}/poll`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regulatory-feed-sources'] });
      queryClient.invalidateQueries({ queryKey: ['regulatory-feed-items'] });
    },
  });

  const deleteSourceMutation = useMutation({
    mutationFn: async (sourceId: number) => {
      const response = await apiClient.delete(`/governance/regulatory-feeds/sources/${sourceId}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regulatory-feed-sources'] });
      queryClient.invalidateQueries({ queryKey: ['regulatory-feed-items'] });
    },
  });

  const analyzeItemMutation = useMutation({
    mutationFn: async (itemId: number) => {
      const response = await apiClient.post(`/governance/regulatory-feeds/items/${itemId}/analyze`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regulatory-feed-items'] });
    },
  });

  const convertItemMutation = useMutation({
    mutationFn: async (itemId: number) => {
      const response = await apiClient.post(`/governance/regulatory-feeds/items/${itemId}/convert`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regulatory-feed-items'] });
    },
  });

  const toggleItemExpanded = (itemId: number) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(itemId)) {
      newExpanded.delete(itemId);
    } else {
      newExpanded.add(itemId);
    }
    setExpandedItems(newExpanded);
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  };

  const formatDateTime = (dateString: string | null) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const newCount = items?.filter(i => i.status === 'new').length || 0;
  const analyzedCount = items?.filter(i => i.status === 'analyzed').length || 0;
  const processedCount = items?.filter(i => i.status === 'processed').length || 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-black">Regulatory Feeds</h1>
          <p className="text-slate-600 mt-1">
            Manage regulatory update feeds and monitor compliance changes
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setShowAddModal(true)}
            className="btn-secondary flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Custom Feed
          </button>
          <button
            onClick={() => seedCBSLMutation.mutate()}
            disabled={seedCBSLMutation.isPending}
            className="btn-secondary flex items-center gap-2"
          >
            {seedCBSLMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Database className="h-4 w-4" />
            )}
            Add Default Feeds
          </button>
          <button
            onClick={() => pollAllMutation.mutate()}
            disabled={pollAllMutation.isPending}
            className="btn-primary flex items-center gap-2"
          >
            {pollAllMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Poll All Feeds
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-primary-500/20 to-primary-600/10 p-3">
              <Rss className="h-6 w-6 text-primary-600" />
            </div>
          </div>
          <p className="stat-value">{sources?.length || 0}</p>
          <p className="stat-label">Feed Sources</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-600/10 p-3">
              <FileText className="h-6 w-6 text-blue-600" />
            </div>
          </div>
          <p className="stat-value">{newCount}</p>
          <p className="stat-label">New Items</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-600/10 p-3">
              <Brain className="h-6 w-6 text-amber-600" />
            </div>
          </div>
          <p className="stat-value">{analyzedCount}</p>
          <p className="stat-label">Analyzed</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 p-3">
              <CheckCircle className="h-6 w-6 text-emerald-600" />
            </div>
          </div>
          <p className="stat-value">{processedCount}</p>
          <p className="stat-label">Processed</p>
        </div>
      </div>

      <div className="card">
        <button
          onClick={() => setSourcesExpanded(!sourcesExpanded)}
          className="w-full flex items-center justify-between p-4 hover:bg-white/50 transition-colors rounded-t-xl"
        >
          <div className="flex items-center gap-3">
            <Rss className="h-5 w-5 text-primary-600" />
            <h2 className="text-lg font-semibold text-black">Feed Sources</h2>
            <span className="badge bg-slate-600/50 text-slate-600">
              {sources?.length || 0}
            </span>
          </div>
          {sourcesExpanded ? (
            <ChevronDown className="h-5 w-5 text-slate-600" />
          ) : (
            <ChevronRight className="h-5 w-5 text-slate-600" />
          )}
        </button>

        {sourcesExpanded && (
          <div className="border-t border-slate-200">
            <div className="overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Regulator</th>
                    <th>Country</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Last Polled</th>
                    <th>Items</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sourcesLoading ? (
                    <tr>
                      <td colSpan={8} className="text-center py-8">
                        <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary-600" />
                      </td>
                    </tr>
                  ) : !sources || sources.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-8">
                        <Rss className="h-12 w-12 text-slate-500 mx-auto mb-3" />
                        <p className="text-slate-600">No feed sources configured</p>
                        <p className="text-sm text-slate-500 mt-1">
                          Click "Add Default Feeds" to add regulatory feeds from Federal Reserve and ECB
                        </p>
                      </td>
                    </tr>
                  ) : (
                    sources.map((source) => {
                      const statusStyle = source.is_active ? STATUS_STYLES.active : STATUS_STYLES.inactive;
                      return (
                        <tr key={source.id}>
                          <td>
                            <div className="font-medium text-black">{source.name}</div>
                          </td>
                          <td>
                            <div className="flex items-center gap-2">
                              <Globe className="h-4 w-4 text-slate-500" />
                              <span className="text-slate-600">{source.regulator}</span>
                            </div>
                          </td>
                          <td>
                            <span className="text-slate-600">{source.country}</span>
                          </td>
                          <td>
                            <span className="text-slate-600 capitalize">{source.category}</span>
                          </td>
                          <td>
                            <span className={`badge ${statusStyle.bg} ${statusStyle.text}`}>
                              {statusStyle.label}
                            </span>
                          </td>
                          <td>
                            <div className="flex items-center gap-2 text-slate-600">
                              <Clock className="h-4 w-4" />
                              <span className="text-sm">{formatDateTime(source.last_polled_at)}</span>
                            </div>
                          </td>
                          <td>
                            <span className="text-slate-600">{source.items_processed}</span>
                          </td>
                          <td>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => pollSourceMutation.mutate(source.id)}
                                disabled={pollSourceMutation.isPending}
                                className="btn-ghost btn-sm"
                                title="Poll Now"
                              >
                                {pollSourceMutation.isPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Play className="h-4 w-4" />
                                )}
                              </button>
                              <button className="btn-ghost btn-sm" title="Edit">
                                <Edit className="h-4 w-4" />
                              </button>
                              <button
                                onClick={() => {
                                  if (confirm(`Delete "${source.name}" and all its feed items?`)) {
                                    deleteSourceMutation.mutate(source.id);
                                  }
                                }}
                                disabled={deleteSourceMutation.isPending}
                                className="btn-ghost btn-sm text-rose-600"
                                title="Delete"
                              >
                                {deleteSourceMutation.isPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="p-4 border-b border-slate-200">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-primary-600" />
              <h2 className="text-lg font-semibold text-black">Feed Items</h2>
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-slate-600" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="select min-w-[140px]"
              >
                {FILTER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="w-8"></th>
                <th>Title</th>
                <th>Published</th>
                <th>Source</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {itemsLoading ? (
                <tr>
                  <td colSpan={6} className="text-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary-600" />
                  </td>
                </tr>
              ) : !items || items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8">
                    <FileText className="h-12 w-12 text-slate-500 mx-auto mb-3" />
                    <p className="text-slate-600">No feed items found</p>
                    <p className="text-sm text-slate-500 mt-1">
                      Poll feeds to retrieve regulatory updates
                    </p>
                  </td>
                </tr>
              ) : (
                items.map((item) => {
                  const statusStyle = STATUS_STYLES[item.status] || STATUS_STYLES.new;
                  const isExpanded = expandedItems.has(item.id);

                  return (
                    <>
                      <tr key={item.id} className="cursor-pointer hover:bg-white/50">
                        <td onClick={() => toggleItemExpanded(item.id)}>
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-slate-600" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-slate-600" />
                          )}
                        </td>
                        <td onClick={() => toggleItemExpanded(item.id)}>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-black">{item.title}</span>
                            {item.link && (
                              <a
                                href={item.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary-600 hover:text-primary-300"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ExternalLink className="h-4 w-4" />
                              </a>
                            )}
                          </div>
                        </td>
                        <td>
                          <span className="text-slate-600 text-sm">
                            {formatDate(item.published_date)}
                          </span>
                        </td>
                        <td>
                          <span className="text-slate-600">{item.feed_source_name}</span>
                        </td>
                        <td>
                          <span className={`badge ${statusStyle.bg} ${statusStyle.text}`}>
                            {statusStyle.label}
                          </span>
                        </td>
                        <td>
                          <div className="flex items-center gap-1">
                            {item.status === 'new' && (
                              <button
                                onClick={() => analyzeItemMutation.mutate(item.id)}
                                disabled={analyzeItemMutation.isPending}
                                className="btn-ghost btn-sm text-amber-600"
                                title="Analyze with AI"
                              >
                                {analyzeItemMutation.isPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Brain className="h-4 w-4" />
                                )}
                              </button>
                            )}
                            {item.status === 'analyzed' && !item.regulatory_change_id && (
                              <button
                                onClick={() => convertItemMutation.mutate(item.id)}
                                disabled={convertItemMutation.isPending}
                                className="btn-ghost btn-sm text-emerald-600"
                                title="Convert to Regulatory Change"
                              >
                                {convertItemMutation.isPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <ArrowRightCircle className="h-4 w-4" />
                                )}
                              </button>
                            )}
                            <button
                              onClick={() => toggleItemExpanded(item.id)}
                              className="btn-ghost btn-sm"
                              title="View Details"
                            >
                              <Eye className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${item.id}-expanded`}>
                          <td colSpan={6} className="bg-white/30 p-0">
                            <div className="p-4 space-y-4">
                              <div>
                                <h4 className="text-sm font-medium text-slate-600 mb-2">Description</h4>
                                <p className="text-slate-600 text-sm">{item.description || 'No description available'}</p>
                              </div>

                              {item.ai_analysis && (
                                <div className="space-y-4 border-t border-slate-200 pt-4">
                                  <div className="flex items-center gap-2">
                                    <Brain className="h-5 w-5 text-amber-600" />
                                    <h4 className="text-sm font-medium text-black">AI Analysis</h4>
                                    {item.ai_analysis.priority && (
                                      <span className={`badge ${PRIORITY_STYLES[item.ai_analysis.priority.toLowerCase()]?.bg || 'bg-slate-50'} ${PRIORITY_STYLES[item.ai_analysis.priority.toLowerCase()]?.text || 'text-slate-600'}`}>
                                        {item.ai_analysis.priority} Priority
                                      </span>
                                    )}
                                  </div>

                                  <div>
                                    <h5 className="text-xs font-medium text-slate-500 uppercase mb-1">Summary</h5>
                                    <p className="text-slate-600 text-sm">{item.ai_analysis.summary}</p>
                                  </div>

                                  {item.ai_analysis.compliance_gaps && item.ai_analysis.compliance_gaps.length > 0 && (
                                    <div>
                                      <h5 className="text-xs font-medium text-slate-500 uppercase mb-2">Compliance Gaps</h5>
                                      <div className="flex flex-wrap gap-2">
                                        {item.ai_analysis.compliance_gaps.map((gap, idx) => (
                                          <span key={idx} className="badge bg-rose-50 text-rose-700">
                                            {gap}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    {item.ai_analysis.impacted_frameworks && item.ai_analysis.impacted_frameworks.length > 0 && (
                                      <div>
                                        <h5 className="text-xs font-medium text-slate-500 uppercase mb-2">Impacted Frameworks</h5>
                                        <div className="space-y-2">
                                          {item.ai_analysis.impacted_frameworks.map((fw, idx) => (
                                            <div key={idx} className="text-sm">
                                              <div className="text-slate-600 font-medium">{fw.name}</div>
                                              <div className="text-slate-500 text-xs">{fw.reason}</div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {item.ai_analysis.impacted_controls && item.ai_analysis.impacted_controls.length > 0 && (
                                      <div>
                                        <h5 className="text-xs font-medium text-slate-500 uppercase mb-2">Impacted Controls</h5>
                                        <div className="space-y-2">
                                          {item.ai_analysis.impacted_controls.map((ctrl, idx) => (
                                            <div key={idx} className="text-sm">
                                              <div className="text-slate-600 font-medium">{ctrl.id}: {ctrl.name}</div>
                                              <div className="text-slate-500 text-xs">{ctrl.action_needed}</div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {item.ai_analysis.impacted_policies && item.ai_analysis.impacted_policies.length > 0 && (
                                      <div>
                                        <h5 className="text-xs font-medium text-slate-500 uppercase mb-2">Impacted Policies</h5>
                                        <div className="space-y-2">
                                          {item.ai_analysis.impacted_policies.map((policy, idx) => (
                                            <div key={idx} className="text-sm">
                                              <div className="text-slate-600 font-medium">{policy.title}</div>
                                              <div className="text-slate-500 text-xs capitalize">{policy.action_needed}</div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>

                                  {item.ai_analysis.implementation_tasks && item.ai_analysis.implementation_tasks.length > 0 && (
                                    <div>
                                      <h5 className="text-xs font-medium text-slate-500 uppercase mb-2">Implementation Tasks</h5>
                                      <div className="space-y-2">
                                        {item.ai_analysis.implementation_tasks.map((task, idx) => (
                                          <div key={idx} className="text-sm bg-white/50 p-2 rounded">
                                            <div className="flex items-center justify-between">
                                              <span className="text-slate-600 font-medium">{task.title}</span>
                                              <span className={`badge text-xs ${PRIORITY_STYLES[task.priority?.toLowerCase()]?.bg || 'bg-slate-50'} ${PRIORITY_STYLES[task.priority?.toLowerCase()]?.text || 'text-slate-600'}`}>
                                                {task.priority}
                                              </span>
                                            </div>
                                            <div className="text-slate-500 text-xs mt-1">{task.description}</div>
                                            {task.suggested_deadline_days && (
                                              <div className="text-slate-500 text-xs mt-1">Deadline: {task.suggested_deadline_days} days</div>
                                            )}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {item.status === 'analyzed' && !item.regulatory_change_id && (
                                    <div className="pt-2">
                                      <button
                                        onClick={() => convertItemMutation.mutate(item.id)}
                                        disabled={convertItemMutation.isPending}
                                        className="btn-primary flex items-center gap-2"
                                      >
                                        {convertItemMutation.isPending ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                          <ArrowRightCircle className="h-4 w-4" />
                                        )}
                                        Convert to Regulatory Change
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}

                              {item.status === 'new' && (
                                <div className="border-t border-slate-200 pt-4">
                                  <button
                                    onClick={() => analyzeItemMutation.mutate(item.id)}
                                    disabled={analyzeItemMutation.isPending}
                                    className="btn-secondary flex items-center gap-2"
                                  >
                                    {analyzeItemMutation.isPending ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <Brain className="h-4 w-4" />
                                    )}
                                    Analyze with AI
                                  </button>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-black">Add Custom Feed Source</h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-600 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createFeedMutation.mutate(newFeed);
              }}
              className="p-4 space-y-4"
            >
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  Feed Name *
                </label>
                <input
                  type="text"
                  value={newFeed.name}
                  onChange={(e) => setNewFeed({ ...newFeed, name: e.target.value })}
                  required
                  className="input w-full"
                  placeholder="e.g., SEC Press Releases"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  RSS Feed URL *
                </label>
                <input
                  type="url"
                  value={newFeed.source_url}
                  onChange={(e) => setNewFeed({ ...newFeed, source_url: e.target.value })}
                  required
                  className="input w-full"
                  placeholder="https://example.com/rss/feed.xml"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">
                    Regulator
                  </label>
                  <input
                    type="text"
                    value={newFeed.regulator}
                    onChange={(e) => setNewFeed({ ...newFeed, regulator: e.target.value })}
                    className="input w-full"
                    placeholder="e.g., SEC"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">
                    Country
                  </label>
                  <input
                    type="text"
                    value={newFeed.country}
                    onChange={(e) => setNewFeed({ ...newFeed, country: e.target.value })}
                    className="input w-full"
                    placeholder="e.g., United States"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">
                    Category
                  </label>
                  <select
                    value={newFeed.category}
                    onChange={(e) => setNewFeed({ ...newFeed, category: e.target.value })}
                    className="select w-full"
                  >
                    <option value="general">General</option>
                    <option value="press_releases">Press Releases</option>
                    <option value="regulatory_policy">Regulatory Policy</option>
                    <option value="notices">Notices</option>
                    <option value="monetary_policy">Monetary Policy</option>
                    <option value="enforcement">Enforcement</option>
                    <option value="guidance">Guidance</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-600 mb-1">
                    Poll Interval (hours)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="168"
                    value={newFeed.poll_interval_hours}
                    onChange={(e) => setNewFeed({ ...newFeed, poll_interval_hours: parseInt(e.target.value) || 24 })}
                    className="input w-full"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createFeedMutation.isPending || !newFeed.name || !newFeed.source_url}
                  className="btn-primary flex items-center gap-2"
                >
                  {createFeedMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Add Feed
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
