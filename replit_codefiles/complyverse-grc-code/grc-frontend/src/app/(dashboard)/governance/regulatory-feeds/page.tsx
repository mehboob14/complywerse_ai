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
  new: { bg: 'rgba(28, 43, 58, 0.08)', text: 'var(--color-base)', label: 'New' },
  analyzed: { bg: 'rgba(146, 87, 14, 0.1)', text: 'var(--color-warning)', label: 'Analyzed' },
  processed: { bg: 'rgba(45, 106, 79, 0.1)', text: 'var(--color-success)', label: 'Processed' },
  active: { bg: 'rgba(45, 106, 79, 0.1)', text: 'var(--color-success)', label: 'Active' },
  inactive: { bg: 'rgba(28, 43, 58, 0.06)', text: 'var(--color-muted)', label: 'Inactive' },
  error: { bg: 'rgba(155, 28, 28, 0.1)', text: 'var(--color-danger)', label: 'Error' },
};

const PRIORITY_STYLES: Record<string, { bg: string; text: string }> = {
  critical: { bg: 'rgba(155, 28, 28, 0.1)', text: 'var(--color-danger)' },
  high: { bg: 'rgba(146, 87, 14, 0.1)', text: 'var(--color-warning)' },
  medium: { bg: 'rgba(146, 87, 14, 0.1)', text: 'var(--color-warning)' },
  low: { bg: 'rgba(28, 43, 58, 0.08)', text: 'var(--color-base)' },
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
          <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Regulatory Feeds</h1>
          <p className="mt-1" style={{ color: 'var(--color-muted)' }}>
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
            <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
              <Rss className="h-6 w-6" style={{ color: 'var(--color-base)' }} />
            </div>
          </div>
          <p className="stat-value">{sources?.length || 0}</p>
          <p className="stat-label">Feed Sources</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
              <FileText className="h-6 w-6" style={{ color: 'var(--color-base)' }} />
            </div>
          </div>
          <p className="stat-value">{newCount}</p>
          <p className="stat-label">New Items</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(146, 87, 14, 0.1)' }}>
              <Brain className="h-6 w-6" style={{ color: 'var(--color-warning)' }} />
            </div>
          </div>
          <p className="stat-value">{analyzedCount}</p>
          <p className="stat-label">Analyzed</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(45, 106, 79, 0.1)' }}>
              <CheckCircle className="h-6 w-6" style={{ color: 'var(--color-success)' }} />
            </div>
          </div>
          <p className="stat-value">{processedCount}</p>
          <p className="stat-label">Processed</p>
        </div>
      </div>

      <div className="card">
        <button
          onClick={() => setSourcesExpanded(!sourcesExpanded)}
          className="w-full flex items-center justify-between p-4 transition-colors rounded-t-xl"
        >
          <div className="flex items-center gap-3">
            <Rss className="h-5 w-5 text-primary-400" />
            <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Feed Sources</h2>
            <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: 'rgba(28, 43, 58, 0.06)', color: 'var(--color-text)' }}>
              {sources?.length || 0}
            </span>
          </div>
          {sourcesExpanded ? (
            <ChevronDown className="h-5 w-5" style={{ color: 'var(--color-muted)' }} />
          ) : (
            <ChevronRight className="h-5 w-5" style={{ color: 'var(--color-muted)' }} />
          )}
        </button>

        {sourcesExpanded && (
          <div style={{ borderTop: '1px solid var(--color-border)' }}>
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
                        <Rss className="h-12 w-12 mx-auto mb-3" style={{ color: 'var(--color-muted)' }} />
                        <p style={{ color: 'var(--color-muted)' }}>No feed sources configured</p>
                        <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
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
                            <div className="font-medium" style={{ color: 'var(--color-text)' }}>{source.name}</div>
                          </td>
                          <td>
                            <div className="flex items-center gap-2">
                              <Globe className="h-4 w-4" style={{ color: 'var(--color-muted)' }} />
                              <span style={{ color: 'var(--color-text)' }}>{source.regulator}</span>
                            </div>
                          </td>
                          <td>
                            <span style={{ color: 'var(--color-muted)' }}>{source.country}</span>
                          </td>
                          <td>
                            <span className="capitalize" style={{ color: 'var(--color-muted)' }}>{source.category}</span>
                          </td>
                          <td>
                            <span className="badge rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ backgroundColor: statusStyle.bg, color: statusStyle.text }}>
                              {statusStyle.label}
                            </span>
                          </td>
                          <td>
                            <div className="flex items-center gap-2" style={{ color: 'var(--color-muted)' }}>
                              <Clock className="h-4 w-4" />
                              <span className="text-sm">{formatDateTime(source.last_polled_at)}</span>
                            </div>
                          </td>
                          <td>
                            <span style={{ color: 'var(--color-text)' }}>{source.items_processed}</span>
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
                                className="btn-ghost btn-sm"
                                style={{ color: 'var(--color-danger)' }}
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
        <div className="p-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-primary-400" />
              <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Feed Items</h2>
            </div>
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4" style={{ color: 'var(--color-muted)' }} />
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
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary-400" />
                  </td>
                </tr>
              ) : !items || items.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8">
                    <FileText className="h-12 w-12 mx-auto mb-3" style={{ color: 'var(--color-muted)' }} />
                    <p style={{ color: 'var(--color-muted)' }}>No feed items found</p>
                    <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
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
                      <tr key={item.id} className="cursor-pointer">
                        <td onClick={() => toggleItemExpanded(item.id)}>
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" style={{ color: 'var(--color-muted)' }} />
                          ) : (
                            <ChevronRight className="h-4 w-4" style={{ color: 'var(--color-muted)' }} />
                          )}
                        </td>
                        <td onClick={() => toggleItemExpanded(item.id)}>
                          <div className="flex items-center gap-2">
                            <span className="font-medium" style={{ color: 'var(--color-text)' }}>{item.title}</span>
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
                        </td>
                        <td>
                          <span className="text-sm" style={{ color: 'var(--color-muted)' }}>
                            {formatDate(item.published_date)}
                          </span>
                        </td>
                        <td>
                          <span style={{ color: 'var(--color-text)' }}>{item.feed_source_name}</span>
                        </td>
                        <td>
                          <span className="badge rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ backgroundColor: statusStyle.bg, color: statusStyle.text }}>
                            {statusStyle.label}
                          </span>
                        </td>
                        <td>
                          <div className="flex items-center gap-1">
                            {item.status === 'new' && (
                              <button
                                onClick={() => analyzeItemMutation.mutate(item.id)}
                                disabled={analyzeItemMutation.isPending}
                                className="btn-ghost btn-sm"
                                style={{ color: 'var(--color-warning)' }}
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
                                className="btn-ghost btn-sm"
                                style={{ color: 'var(--color-success)' }}
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
                          <td colSpan={6} className="p-0" style={{ backgroundColor: 'var(--color-subtle)' }}>
                            <div className="p-4 space-y-4">
                              <div>
                                <h4 className="text-sm font-medium mb-2" style={{ color: 'var(--color-muted)' }}>Description</h4>
                                <p className="text-sm" style={{ color: 'var(--color-text)' }}>{item.description || 'No description available'}</p>
                              </div>

                              {item.ai_analysis && (
                                <div className="space-y-4 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
                                  <div className="flex items-center gap-2">
                                    <Brain className="h-5 w-5" style={{ color: 'var(--color-warning)' }} />
                                    <h4 className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>AI Analysis</h4>
                                    {item.ai_analysis.priority && (
                                      <span className="badge rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ backgroundColor: PRIORITY_STYLES[item.ai_analysis.priority.toLowerCase()]?.bg || 'rgba(28, 43, 58, 0.06)', color: PRIORITY_STYLES[item.ai_analysis.priority.toLowerCase()]?.text || 'var(--color-muted)' }}>
                                        {item.ai_analysis.priority} Priority
                                      </span>
                                    )}
                                  </div>

                                  <div>
                                    <h5 className="text-xs font-medium uppercase mb-1" style={{ color: 'var(--color-muted)' }}>Summary</h5>
                                    <p className="text-sm" style={{ color: 'var(--color-text)' }}>{item.ai_analysis.summary}</p>
                                  </div>

                                  {item.ai_analysis.compliance_gaps && item.ai_analysis.compliance_gaps.length > 0 && (
                                    <div>
                                      <h5 className="text-xs font-medium uppercase mb-2" style={{ color: 'var(--color-muted)' }}>Compliance Gaps</h5>
                                      <div className="flex flex-wrap gap-2">
                                        {item.ai_analysis.compliance_gaps.map((gap, idx) => (
                                          <span key={idx} className="badge rounded-full px-2.5 py-0.5 text-xs font-medium" style={{ backgroundColor: 'rgba(155, 28, 28, 0.1)', color: 'var(--color-danger)' }}>
                                            {gap}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    {item.ai_analysis.impacted_frameworks && item.ai_analysis.impacted_frameworks.length > 0 && (
                                      <div>
                                        <h5 className="text-xs font-medium uppercase mb-2" style={{ color: 'var(--color-muted)' }}>Impacted Frameworks</h5>
                                        <div className="space-y-2">
                                          {item.ai_analysis.impacted_frameworks.map((fw, idx) => (
                                            <div key={idx} className="text-sm">
                                              <div className="font-medium" style={{ color: 'var(--color-text)' }}>{fw.name}</div>
                                              <div className="text-xs" style={{ color: 'var(--color-muted)' }}>{fw.reason}</div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {item.ai_analysis.impacted_controls && item.ai_analysis.impacted_controls.length > 0 && (
                                      <div>
                                        <h5 className="text-xs font-medium uppercase mb-2" style={{ color: 'var(--color-muted)' }}>Impacted Controls</h5>
                                        <div className="space-y-2">
                                          {item.ai_analysis.impacted_controls.map((ctrl, idx) => (
                                            <div key={idx} className="text-sm">
                                              <div className="font-medium" style={{ color: 'var(--color-text)' }}>{ctrl.id}: {ctrl.name}</div>
                                              <div className="text-xs" style={{ color: 'var(--color-muted)' }}>{ctrl.action_needed}</div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}

                                    {item.ai_analysis.impacted_policies && item.ai_analysis.impacted_policies.length > 0 && (
                                      <div>
                                        <h5 className="text-xs font-medium uppercase mb-2" style={{ color: 'var(--color-muted)' }}>Impacted Policies</h5>
                                        <div className="space-y-2">
                                          {item.ai_analysis.impacted_policies.map((policy, idx) => (
                                            <div key={idx} className="text-sm">
                                              <div className="font-medium" style={{ color: 'var(--color-text)' }}>{policy.title}</div>
                                              <div className="text-xs capitalize" style={{ color: 'var(--color-muted)' }}>{policy.action_needed}</div>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>

                                  {item.ai_analysis.implementation_tasks && item.ai_analysis.implementation_tasks.length > 0 && (
                                    <div>
                                      <h5 className="text-xs font-medium uppercase mb-2" style={{ color: 'var(--color-muted)' }}>Implementation Tasks</h5>
                                      <div className="space-y-2">
                                        {item.ai_analysis.implementation_tasks.map((task, idx) => (
                                          <div key={idx} className="text-sm p-2 rounded" style={{ backgroundColor: 'var(--color-surface)' }}>
                                            <div className="flex items-center justify-between">
                                              <span className="font-medium" style={{ color: 'var(--color-text)' }}>{task.title}</span>
                                              <span className="badge text-xs rounded-full px-2 py-0.5" style={{ backgroundColor: PRIORITY_STYLES[task.priority?.toLowerCase()]?.bg || 'rgba(28, 43, 58, 0.06)', color: PRIORITY_STYLES[task.priority?.toLowerCase()]?.text || 'var(--color-muted)' }}>
                                                {task.priority}
                                              </span>
                                            </div>
                                            <div className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{task.description}</div>
                                            {task.suggested_deadline_days && (
                                              <div className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Deadline: {task.suggested_deadline_days} days</div>
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
                                <div className="pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
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
          <div className="rounded-lg shadow-xl w-full max-w-lg mx-4" style={{ backgroundColor: 'var(--color-surface)' }}>
            <div className="flex items-center justify-between p-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>Add Custom Feed Source</h2>
              <button
                onClick={() => setShowAddModal(false)}
                style={{ color: 'var(--color-muted)' }}
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
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
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
                <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
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
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
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
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
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
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
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
                  <label className="block text-sm font-medium mb-1" style={{ color: 'var(--color-text)' }}>
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
              <div className="flex justify-end gap-3 pt-4" style={{ borderTop: '1px solid var(--color-border)' }}>
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
