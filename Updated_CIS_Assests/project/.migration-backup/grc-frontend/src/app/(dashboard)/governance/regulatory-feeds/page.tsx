'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Rss,
  RefreshCw,
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
  Edit2,
  Play,
  Eye,
  ArrowRightCircle,
  Database,
  Plus,
} from 'lucide-react';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { RightSlidePanel } from '@/components/ui/RightSlidePanel';

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
  new: { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'New' },
  analyzed: { bg: 'bg-amber-500/20', text: 'text-amber-400', label: 'Analyzed' },
  processed: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'Processed' },
  active: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'Active' },
  inactive: { bg: 'bg-slate-500/20', text: 'text-gray-600', label: 'Inactive' },
  error: { bg: 'bg-rose-500/20', text: 'text-rose-400', label: 'Error' },
};

const PRIORITY_STYLES: Record<string, { bg: string; text: string }> = {
  critical: { bg: 'bg-rose-500/20', text: 'text-rose-400' },
  high: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
  medium: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  low: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
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
  const [pollingSourceId, setPollingSourceId] = useState<number | null>(null);
  const [analyzingItemId, setAnalyzingItemId] = useState<number | null>(null);
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
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('governance:regulatory_changes:create');
  const canDelete = hasPermission('governance:regulatory_changes:delete');

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
    placeholderData: keepPreviousData,
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
    onMutate: (sourceId: number) => {
      setPollingSourceId(sourceId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regulatory-feed-sources'] });
      queryClient.invalidateQueries({ queryKey: ['regulatory-feed-items'] });
    },
    onSettled: () => {
      setPollingSourceId(null);
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
    onMutate: (itemId: number) => {
      setAnalyzingItemId(itemId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['regulatory-feed-items'] });
    },
    onSettled: () => {
      setAnalyzingItemId(null);
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

  const getItemDescription = (item: FeedItem) => {
    const rawText = item.description || item.content || '';
    const plainText = rawText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return plainText || 'No description available';
  };

  const newCount = items?.filter(i => i.status === 'new').length || 0;
  const analyzedCount = items?.filter(i => i.status === 'analyzed').length || 0;
  const processedCount = items?.filter(i => i.status === 'processed').length || 0;

  const filterItems = FILTER_OPTIONS.filter((opt) => opt.value !== '').map((opt) => ({
    value: opt.value,
    label: opt.label,
  }));
  const categoryItems = [
    { value: 'general', label: 'General' },
    { value: 'press_releases', label: 'Press Releases' },
    { value: 'regulatory_policy', label: 'Regulatory Policy' },
    { value: 'notices', label: 'Notices' },
    { value: 'monetary_policy', label: 'Monetary Policy' },
    { value: 'enforcement', label: 'Enforcement' },
    { value: 'guidance', label: 'Guidance' },
  ];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-black">Regulatory Feeds</h1>
          <p className="text-sm text-gray-600 mt-1">
            Manage regulatory update feeds and monitor compliance changes
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canCreate && (
          <button
            onClick={() => setShowAddModal(true)}
            className="btn-secondary flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add Custom Feed
          </button>
          )}
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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-lg bg-gradient-to-br from-primary-500/20 to-primary-600/10 p-2.5">
              <Rss className="h-5 w-5 text-primary-400" />
            </div>
          </div>
          <p className="stat-value">{sources?.length || 0}</p>
          <p className="stat-label">Feed Sources</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-lg bg-gradient-to-br from-blue-500/20 to-blue-600/10 p-2.5">
              <FileText className="h-5 w-5 text-blue-400" />
            </div>
          </div>
          <p className="stat-value">{newCount}</p>
          <p className="stat-label">New Items</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-lg bg-gradient-to-br from-amber-500/20 to-amber-600/10 p-2.5">
              <Brain className="h-5 w-5 text-amber-400" />
            </div>
          </div>
          <p className="stat-value">{analyzedCount}</p>
          <p className="stat-label">Analyzed</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-lg bg-gradient-to-br from-emerald-500/20 to-emerald-600/10 p-2.5">
              <CheckCircle className="h-5 w-5 text-emerald-400" />
            </div>
          </div>
          <p className="stat-value">{processedCount}</p>
          <p className="stat-label">Processed</p>
        </div>
      </div>

      <div className="card">
        <button
          onClick={() => setSourcesExpanded(!sourcesExpanded)}
          className="w-full flex items-center justify-between p-3.5 hover:bg-white/50 transition-colors rounded-t-xl"
        >
          <div className="flex items-center gap-3">
            <Rss className="h-5 w-5 text-primary-400" />
            <h2 className="text-base font-semibold text-black">Feed Sources</h2>
            <span className="badge bg-gray-100/50 text-gray-800">
              {sources?.length || 0}
            </span>
          </div>
          {sourcesExpanded ? (
            <ChevronDown className="h-5 w-5 text-gray-600" />
          ) : (
            <ChevronRight className="h-5 w-5 text-gray-600" />
          )}
        </button>

        {sourcesExpanded && (
          <div className="border-t border-gray-300">
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
                        <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary-400" />
                      </td>
                    </tr>
                  ) : !sources || sources.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="text-center py-8">
                        <Rss className="h-12 w-12 text-gray-700 mx-auto mb-3" />
                        <p className="text-gray-600">No feed sources configured</p>
                        <p className="text-sm text-gray-700 mt-1">
                          Click &quot;Add Default Feeds&quot; to add regulatory feeds from Federal Reserve and ECB
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
                              <Globe className="h-4 w-4 text-gray-700" />
                              <span className="text-gray-800">{source.regulator}</span>
                            </div>
                          </td>
                          <td>
                            <span className="text-gray-600">{source.country}</span>
                          </td>
                          <td>
                            <span className="text-gray-600 capitalize">{source.category}</span>
                          </td>
                          <td>
                            <span className={`badge ${statusStyle.bg} ${statusStyle.text}`}>
                              {statusStyle.label}
                            </span>
                          </td>
                          <td>
                            <div className="flex items-center gap-2 text-gray-600">
                              <Clock className="h-4 w-4" />
                              <span className="text-sm">{formatDateTime(source.last_polled_at)}</span>
                            </div>
                          </td>
                          <td>
                            <span className="text-gray-800">{source.items_processed}</span>
                          </td>
                          <td>
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => pollSourceMutation.mutate(source.id)}
                                disabled={pollSourceMutation.isPending}
                                className="btn-ghost btn-sm"
                                title="Poll Now"
                              >
                                {pollSourceMutation.isPending && pollingSourceId === source.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Play className="h-4 w-4" />
                                )}
                              </button>
                              {canCreate && <button className="btn-ghost btn-sm" title="Edit">
                                <Edit2 className="h-4 w-4" />
                              </button>}
                              {canDelete && <button
                                onClick={() => {
                                  if (confirm(`Delete "${source.name}" and all its feed items?`)) {
                                    deleteSourceMutation.mutate(source.id);
                                  }
                                }}
                                disabled={deleteSourceMutation.isPending}
                                className="btn-ghost btn-sm text-rose-400"
                                title="Delete"
                              >
                                {deleteSourceMutation.isPending ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4" />
                                )}
                              </button>}
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
        <div className="p-3.5 border-b border-gray-300">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-primary-400" />
              <h2 className="text-base font-semibold text-black">Feed Items</h2>
            </div>
            <div className="flex items-center gap-2">
              <MultiSelectDropdown
                title="Status"
                items={filterItems}
                selectedValues={statusFilter ? [statusFilter] : []}
                onApply={(values) => setStatusFilter(values[0] || '')}
                multiSelect={false}
              />
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
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary-400" />
                  </td>
                </tr>
              ) : !items || items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8">
                    <FileText className="h-12 w-12 text-gray-700 mx-auto mb-3" />
                    <p className="text-gray-600">No feed items found</p>
                    <p className="text-sm text-gray-700 mt-1">
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
                            <ChevronDown className="h-4 w-4 text-gray-600" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-gray-600" />
                          )}
                        </td>
                        <td onClick={() => toggleItemExpanded(item.id)}>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-black">{item.title}</span>
                              {item.link && (
                                <a
                                  href={item.link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-primary-400 hover:text-primary-300"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <ExternalLink className="h-4 w-4" />
                                </a>
                              )}
                            </div>
                            <p className="text-xs text-gray-700 mt-1 line-clamp-2">
                              {getItemDescription(item)}
                            </p>
                          </div>
                        </td>
                        <td>
                          <span className="text-gray-600 text-sm">
                            {formatDate(item.published_date)}
                          </span>
                        </td>
                        <td>
                          <span className="text-gray-800">{item.feed_source_name}</span>
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
                                className="btn-ghost btn-sm text-amber-400"
                                title="Analyze with AI"
                              >
                                {analyzeItemMutation.isPending && analyzingItemId === item.id ? (
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
                                className="btn-ghost btn-sm text-emerald-400"
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
                            <div className="p-3.5 space-y-3.5">
                              <div>
                                <h4 className="text-sm font-medium text-gray-600 mb-2">Description</h4>
                                <p className="text-gray-800 text-sm">{getItemDescription(item)}</p>
                              </div>

                              {item.ai_analysis && (
                                <div className="space-y-4 border-t border-gray-300 pt-4">
                                  <div className="flex items-center gap-2">
                                    <Brain className="h-5 w-5 text-amber-400" />
                                    <h4 className="text-sm font-medium text-black">AI Analysis</h4>
                                    {item.ai_analysis.priority && (
                                      <span className={`badge ${PRIORITY_STYLES[item.ai_analysis.priority.toLowerCase()]?.bg || 'bg-slate-500/20'} ${PRIORITY_STYLES[item.ai_analysis.priority.toLowerCase()]?.text || 'text-gray-600'}`}>
                                        {item.ai_analysis.priority} Priority
                                      </span>
                                    )}
                                  </div>

                                  <div>
                                    <h5 className="text-xs font-medium text-gray-700 uppercase mb-1">Summary</h5>
                                    <p className="text-gray-800 text-sm">{item.ai_analysis.summary}</p>
                                  </div>

                                  {item.ai_analysis.compliance_gaps && item.ai_analysis.compliance_gaps.length > 0 && (
                                    <div>
                                      <h5 className="text-xs font-medium text-gray-700 uppercase mb-2">Compliance Gaps</h5>
                                      <div className="flex flex-wrap gap-2">
                                        {item.ai_analysis.compliance_gaps.map((gap, idx) => (
                                          <span key={idx} className="badge bg-rose-500/20 text-rose-400">
                                            {gap}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    {item.ai_analysis.impacted_frameworks && item.ai_analysis.impacted_frameworks.length > 0 && (
                                      <div>
                                        <h5 className="text-xs font-medium text-gray-700 uppercase mb-2">Impacted Frameworks</h5>
                                        <div className="space-y-2">
                                          {item.ai_analysis.impacted_frameworks.map((fw, idx) => (
                                            <div key={idx} className="text-sm">
                                              <div className="text-gray-800 font-medium">{fw.name}</div>
                                              <div className="text-gray-700 text-xs">{fw.reason}</div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {item.ai_analysis.impacted_controls && item.ai_analysis.impacted_controls.length > 0 && (
                                      <div>
                                        <h5 className="text-xs font-medium text-gray-700 uppercase mb-2">Impacted Controls</h5>
                                        <div className="space-y-2">
                                          {item.ai_analysis.impacted_controls.map((ctrl, idx) => (
                                            <div key={idx} className="text-sm">
                                              <div className="text-gray-800 font-medium">{ctrl.id}: {ctrl.name}</div>
                                              <div className="text-gray-700 text-xs">{ctrl.action_needed}</div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                  </div>

                                  {item.ai_analysis.implementation_tasks && item.ai_analysis.implementation_tasks.length > 0 && (
                                    <div>
                                      <h5 className="text-xs font-medium text-gray-700 uppercase mb-2">Implementation Tasks</h5>
                                      <div className="space-y-2">
                                        {item.ai_analysis.implementation_tasks.map((task, idx) => (
                                          <div key={idx} className="text-sm bg-white/50 p-2 rounded-lg">
                                            <div className="flex items-center justify-between">
                                              <span className="text-gray-800 font-medium">{task.title}</span>
                                              <span className={`badge text-xs ${PRIORITY_STYLES[task.priority?.toLowerCase()]?.bg || 'bg-slate-500/20'} ${PRIORITY_STYLES[task.priority?.toLowerCase()]?.text || 'text-gray-600'}`}>
                                                {task.priority}
                                              </span>
                                            </div>
                                            <div className="text-gray-700 text-xs mt-1">{task.description}</div>
                                            {task.suggested_deadline_days && (
                                              <div className="text-gray-700 text-xs mt-1">Deadline: {task.suggested_deadline_days} days</div>
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
                                <div className="border-t border-gray-300 pt-4">
                                  <button
                                    onClick={() => analyzeItemMutation.mutate(item.id)}
                                    disabled={analyzeItemMutation.isPending}
                                    className="btn-secondary flex items-center gap-2"
                                  >
                                    {analyzeItemMutation.isPending && analyzingItemId === item.id ? (
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

      <RightSlidePanel
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Add Custom Feed Source"
        footer={
          <div className="flex justify-end gap-2.5">
            <button
              type="button"
              onClick={() => setShowAddModal(false)}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              form="add-feed-form"
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
        }
      >
        <form
          id="add-feed-form"
          onSubmit={(e) => {
            e.preventDefault();
            createFeedMutation.mutate(newFeed);
          }}
          className="space-y-3.5"
        >
          <div>
            <label className="block text-sm font-medium text-gray-800 mb-1">
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
            <label className="block text-sm font-medium text-gray-800 mb-1">
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">
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
              <label className="block text-sm font-medium text-gray-800 mb-1">
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">
                Category
              </label>
              <MultiSelectDropdown
                title="Category"
                items={categoryItems}
                selectedValues={[newFeed.category]}
                onApply={(values) => setNewFeed({ ...newFeed, category: values[0] || 'general' })}
                multiSelect={false}
                triggerVariant="input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-800 mb-1">
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
        </form>
      </RightSlidePanel>
    </div>
  );
}
