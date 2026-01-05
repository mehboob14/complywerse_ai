'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient, { frameworksApi } from '@/lib/api';
import {
  Sparkles,
  Loader2,
  AlertCircle,
  Search,
  Filter,
  ChevronDown,
  ChevronRight,
  FileCheck,
  AlertTriangle,
  TrendingUp,
  Repeat,
  Brain,
  X,
  Play,
  Link2,
  BarChart3,
  Clock,
  Zap,
  RefreshCw,
  CheckCircle,
  Percent,
  FileText,
} from 'lucide-react';

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

interface RecommendationsResponse {
  total: number;
  skip: number;
  limit: number;
  recommendations: EvidenceRecommendation[];
}

interface PrioritySummary {
  priority_summary: Record<string, number>;
  total: number;
}

interface EvidenceTypeCount {
  evidence_type: string;
  count: number;
}

interface EvidenceReuseStats {
  total_evidence: number;
  multi_framework_evidence: number;
  average_controls_per_evidence: number;
  top_reused_evidence: Array<{
    evidence_id: number;
    evidence_name: string;
    controls_linked: number;
    frameworks_covered: number;
  }>;
}

interface AuditSavings {
  total_evidence: number;
  multi_framework_evidence: number;
  single_framework_effort: number;
  actual_effort: number;
  savings_percent: number;
  controls_covered: number;
  average_controls_per_evidence: number;
}

interface ControlGroup {
  id: number;
  code: string;
  name: string;
}

const PRIORITY_STYLES: Record<string, { bg: string; text: string; bar: string }> = {
  critical: { bg: 'bg-red-500/20', text: 'text-red-400', bar: 'bg-red-500' },
  high: { bg: 'bg-orange-500/20', text: 'text-orange-400', bar: 'bg-orange-500' },
  medium: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', bar: 'bg-yellow-500' },
  low: { bg: 'bg-green-500/20', text: 'text-green-400', bar: 'bg-green-500' },
};

export default function EvidenceSuggestionsPage() {
  const queryClient = useQueryClient();
  const [priorityFilter, setPriorityFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize] = useState(20);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkControlIds, setBulkControlIds] = useState<Array<{ type: string; id: number }>>([]);
  const [bulkProgress, setBulkProgress] = useState<{ status: string; generated: number; total: number } | null>(null);

  const { data: recommendations, isLoading: recsLoading, error: recsError, refetch: refetchRecs } = useQuery({
    queryKey: ['evidence-recommendations', priorityFilter, typeFilter, page, pageSize],
    queryFn: async () => {
      const params: Record<string, string | number> = {
        skip: page * pageSize,
        limit: pageSize,
      };
      if (priorityFilter) params.priority = priorityFilter;
      const response = await apiClient.get('/control-library/evidence-recs', { params });
      return response.data as RecommendationsResponse;
    },
  });

  const { data: prioritySummary, isLoading: priorityLoading } = useQuery({
    queryKey: ['evidence-priority-summary'],
    queryFn: async () => {
      const response = await apiClient.get('/control-library/evidence-recs/priority-summary');
      return response.data as PrioritySummary;
    },
  });

  const { data: evidenceTypes } = useQuery({
    queryKey: ['evidence-rec-types'],
    queryFn: async () => {
      const response = await apiClient.get('/control-library/evidence-recs/evidence-types');
      return response.data.evidence_types as EvidenceTypeCount[];
    },
  });

  const { data: reuseStats, isLoading: reuseLoading } = useQuery({
    queryKey: ['evidence-reuse-stats'],
    queryFn: async () => {
      const response = await apiClient.get('/control-library/coverage/evidence-reuse');
      return response.data as EvidenceReuseStats;
    },
  });

  const { data: auditSavings, isLoading: savingsLoading } = useQuery({
    queryKey: ['audit-savings'],
    queryFn: async () => {
      const response = await apiClient.get('/control-library/coverage/audit-savings');
      return response.data as AuditSavings;
    },
  });

  const { data: frameworks } = useQuery({
    queryKey: ['frameworks'],
    queryFn: async () => {
      const response = await frameworksApi.getAll();
      return response.data;
    },
  });

  const { data: controlGroups } = useQuery({
    queryKey: ['control-groups-list'],
    queryFn: async () => {
      const response = await apiClient.get('/control-library/groups', { params: { limit: 100 } });
      return response.data.items as ControlGroup[];
    },
  });

  const generateMutation = useMutation({
    mutationFn: async ({ controlType, controlId }: { controlType: string; controlId: number }) => {
      const response = await apiClient.post(`/control-library/evidence-recs/generate/${controlType}/${controlId}`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['evidence-recommendations'] });
      queryClient.invalidateQueries({ queryKey: ['evidence-priority-summary'] });
      queryClient.invalidateQueries({ queryKey: ['evidence-rec-types'] });
    },
  });

  const bulkGenerateMutation = useMutation({
    mutationFn: async (controlIds: Array<{ type: string; id: number }>) => {
      setBulkProgress({ status: 'processing', generated: 0, total: controlIds.length });
      const response = await apiClient.post('/control-library/evidence-recs/bulk-generate', {
        control_ids: controlIds,
      });
      return response.data;
    },
    onSuccess: (data) => {
      setBulkProgress({
        status: 'completed',
        generated: data.total_generated || 0,
        total: data.controls_processed || 0,
      });
      queryClient.invalidateQueries({ queryKey: ['evidence-recommendations'] });
      queryClient.invalidateQueries({ queryKey: ['evidence-priority-summary'] });
      queryClient.invalidateQueries({ queryKey: ['evidence-rec-types'] });
    },
    onError: () => {
      setBulkProgress({ status: 'failed', generated: 0, total: 0 });
    },
  });

  const toggleRowExpand = (id: number) => {
    const newExpanded = new Set(expandedRows);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedRows(newExpanded);
  };

  const handleTypeClick = (type: string) => {
    setTypeFilter(typeFilter === type ? '' : type);
    setPage(0);
  };

  const filteredRecommendations = recommendations?.recommendations.filter((rec) => {
    if (typeFilter && rec.evidence_type !== typeFilter) return false;
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      return (
        rec.evidence_type.toLowerCase().includes(search) ||
        rec.control_name?.toLowerCase().includes(search) ||
        rec.control_code?.toLowerCase().includes(search) ||
        rec.framework_name?.toLowerCase().includes(search)
      );
    }
    return true;
  });

  const getPriorityBadge = (priority: string) => {
    const style = PRIORITY_STYLES[priority] || PRIORITY_STYLES.medium;
    return (
      <span className={`inline-flex items-center gap-1 rounded-full ${style.bg} px-2 py-0.5 text-xs font-medium ${style.text}`}>
        {priority === 'critical' && <AlertTriangle size={10} />}
        {priority.charAt(0).toUpperCase() + priority.slice(1)}
      </span>
    );
  };

  const getConfidenceBadge = (confidence: number | null) => {
    if (confidence === null) return null;
    const pct = Math.round(confidence * 100);
    const color = pct >= 80 ? 'text-green-400' : pct >= 60 ? 'text-yellow-400' : 'text-orange-400';
    return (
      <span className={`text-xs ${color}`}>
        {pct}%
      </span>
    );
  };

  const totalPages = Math.ceil((recommendations?.total || 0) / pageSize);

  const reuseRate = reuseStats?.total_evidence
    ? Math.round((reuseStats.multi_framework_evidence / reuseStats.total_evidence) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Evidence Suggestions & Reuse</h1>
          <p className="text-slate-400">AI-recommended evidence types and reuse metrics</p>
        </div>
        <button
          onClick={() => {
            setBulkProgress(null);
            setShowBulkModal(true);
          }}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
        >
          <Sparkles size={18} />
          Bulk Generate
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-primary-500/20 to-primary-600/10 p-3">
              <Brain className="h-6 w-6 text-primary-400" />
            </div>
          </div>
          <p className="stat-value">{priorityLoading ? '-' : prioritySummary?.total || 0}</p>
          <p className="stat-label">Total Recommendations</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-red-500/20 to-red-600/10 p-3">
              <AlertTriangle className="h-6 w-6 text-red-400" />
            </div>
            {(prioritySummary?.priority_summary?.critical || 0) > 0 && (
              <span className="flex h-2 w-2">
                <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500"></span>
              </span>
            )}
          </div>
          <p className="stat-value">{priorityLoading ? '-' : prioritySummary?.priority_summary?.critical || 0}</p>
          <p className="stat-label">Critical Priority</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-blue-500/20 to-blue-600/10 p-3">
              <Repeat className="h-6 w-6 text-blue-400" />
            </div>
          </div>
          <p className="stat-value">{reuseLoading ? '-' : `${reuseRate}%`}</p>
          <p className="stat-label">Evidence Reuse Rate</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-green-500/20 to-green-600/10 p-3">
              <TrendingUp className="h-6 w-6 text-green-400" />
            </div>
          </div>
          <p className="stat-value">{savingsLoading ? '-' : `${auditSavings?.savings_percent || 0}%`}</p>
          <p className="stat-label">Audit Savings</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Priority Summary</h2>
              <p className="card-description">Recommendations by priority level</p>
            </div>
          </div>
          {priorityLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary-400" />
            </div>
          ) : (
            <div className="space-y-4">
              {['critical', 'high', 'medium', 'low'].map((priority) => {
                const count = prioritySummary?.priority_summary?.[priority] || 0;
                const total = prioritySummary?.total || 1;
                const pct = Math.round((count / total) * 100) || 0;
                const style = PRIORITY_STYLES[priority];
                return (
                  <div key={priority}>
                    <div className="mb-1 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`h-3 w-3 rounded-full ${style.bar}`}></span>
                        <span className="text-sm font-medium capitalize text-white">{priority}</span>
                      </div>
                      <span className={`text-sm font-medium ${style.text}`}>{count}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-700">
                      <div
                        className={`h-full transition-all duration-500 ${style.bar}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Evidence Types</h2>
              <p className="card-description">Click to filter recommendations</p>
            </div>
          </div>
          {!evidenceTypes?.length ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <FileText className="mb-3 h-10 w-10 text-slate-600" />
              <p className="text-sm text-slate-400">No evidence types yet</p>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {evidenceTypes.map((type) => (
                <button
                  key={type.evidence_type}
                  onClick={() => handleTypeClick(type.evidence_type)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                    typeFilter === type.evidence_type
                      ? 'border-primary-500 bg-primary-500/20 text-primary-400'
                      : 'border-slate-600 bg-slate-700/50 text-slate-300 hover:border-slate-500 hover:bg-slate-700'
                  }`}
                >
                  <FileCheck size={14} />
                  <span className="truncate max-w-[150px]">{type.evidence_type}</span>
                  <span className="rounded-full bg-slate-600 px-1.5 py-0.5 text-xs text-slate-300">
                    {type.count}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Evidence Reuse Analytics</h2>
            <p className="card-description">Top evidence items linked to multiple controls</p>
          </div>
        </div>
        
        {reuseLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-primary-400" />
          </div>
        ) : !reuseStats?.top_reused_evidence?.length ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Repeat className="mb-3 h-10 w-10 text-slate-600" />
            <p className="text-sm text-slate-400">No reused evidence found</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-blue-500/20 p-2">
                    <FileCheck className="h-5 w-5 text-blue-400" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-white">{reuseStats.total_evidence}</p>
                    <p className="text-xs text-slate-400">Total Evidence</p>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-purple-500/20 p-2">
                    <Repeat className="h-5 w-5 text-purple-400" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-white">{reuseStats.multi_framework_evidence}</p>
                    <p className="text-xs text-slate-400">Multi-Framework</p>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-green-500/20 p-2">
                    <BarChart3 className="h-5 w-5 text-green-400" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-white">{reuseStats.average_controls_per_evidence}</p>
                    <p className="text-xs text-slate-400">Avg Controls/Evidence</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-800/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Evidence Name</th>
                    <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-slate-400">Controls Linked</th>
                    <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-slate-400">Frameworks Covered</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {reuseStats.top_reused_evidence.slice(0, 5).map((item) => (
                    <tr key={item.evidence_id} className="hover:bg-slate-700/50">
                      <td className="px-4 py-3">
                        <p className="text-sm font-medium text-white truncate max-w-xs">{item.evidence_name}</p>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/20 px-2 py-0.5 text-sm text-blue-400">
                          <Link2 size={12} />
                          {item.controls_linked}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-sm text-slate-300">{item.frameworks_covered}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {auditSavings && (
              <div className="mt-4 rounded-lg border border-green-500/30 bg-green-500/10 p-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-green-500/20 p-2">
                    <Percent className="h-5 w-5 text-green-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-green-400">
                      Audit Effort Savings: {auditSavings.savings_percent}%
                    </p>
                    <p className="text-xs text-slate-400">
                      Single-framework effort: {auditSavings.single_framework_effort} | 
                      Actual effort: {auditSavings.actual_effort} | 
                      Controls covered: {auditSavings.controls_covered}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-header flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <h2 className="card-title">AI Recommendations</h2>
            <p className="card-description">Suggested evidence for controls</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-800 py-2 pl-10 pr-4 text-sm text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none sm:w-48"
              />
            </div>
            <select
              value={priorityFilter}
              onChange={(e) => { setPriorityFilter(e.target.value); setPage(0); }}
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
            >
              <option value="">All Priorities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            {typeFilter && (
              <button
                onClick={() => setTypeFilter('')}
                className="flex items-center gap-1 rounded-lg border border-primary-500 bg-primary-500/20 px-3 py-2 text-sm text-primary-400"
              >
                {typeFilter}
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        {recsLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
          </div>
        ) : recsError ? (
          <div className="flex h-64 flex-col items-center justify-center text-red-400">
            <AlertCircle className="mb-2 h-8 w-8" />
            <p>Failed to load recommendations</p>
            <button onClick={() => refetchRecs()} className="mt-2 text-sm text-primary-400 hover:underline">
              Try again
            </button>
          </div>
        ) : !filteredRecommendations?.length ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Sparkles className="mb-4 h-12 w-12 text-slate-600" />
            <h3 className="text-lg font-medium text-white">No recommendations yet</h3>
            <p className="mt-1 text-slate-400">Use Bulk Generate to create AI recommendations for your controls</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-slate-800/50">
                  <tr>
                    <th className="w-8 px-2 py-3"></th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Control</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Evidence Type</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Priority</th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-400">Confidence</th>
                    <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-400">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700 bg-slate-800">
                  {filteredRecommendations.map((rec) => (
                    <>
                      <tr
                        key={rec.id}
                        className="hover:bg-slate-700/50 cursor-pointer"
                        onClick={() => toggleRowExpand(rec.id)}
                      >
                        <td className="px-2 py-3">
                          <button className="text-slate-400 hover:text-white">
                            {expandedRows.has(rec.id) ? (
                              <ChevronDown size={16} />
                            ) : (
                              <ChevronRight size={16} />
                            )}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <p className="text-sm font-medium text-white">
                              {rec.control_code && (
                                <span className="mr-2 font-mono text-primary-400">{rec.control_code}</span>
                              )}
                              {rec.control_name || rec.group_name || 'Unknown Control'}
                            </p>
                            {rec.framework_name && (
                              <p className="text-xs text-slate-400">{rec.framework_name}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1 rounded-lg bg-slate-700 px-2 py-1 text-sm text-white">
                            <FileCheck size={14} className="text-slate-400" />
                            {rec.evidence_type}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {getPriorityBadge(rec.priority)}
                        </td>
                        <td className="px-4 py-3">
                          {getConfidenceBadge(rec.ai_confidence)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                            }}
                            className="btn-ghost btn-sm inline-flex items-center gap-1"
                          >
                            <Link2 size={14} />
                            Link
                          </button>
                        </td>
                      </tr>
                      {expandedRows.has(rec.id) && (
                        <tr key={`${rec.id}-expanded`} className="bg-slate-800/80">
                          <td colSpan={6} className="px-4 py-4">
                            <div className="ml-8 space-y-3">
                              {rec.ai_reasoning && (
                                <div>
                                  <p className="mb-1 text-xs font-medium uppercase text-slate-500">AI Reasoning</p>
                                  <p className="text-sm text-slate-300">{rec.ai_reasoning}</p>
                                </div>
                              )}
                              {rec.evidence_description && (
                                <div>
                                  <p className="mb-1 text-xs font-medium uppercase text-slate-500">Description</p>
                                  <p className="text-sm text-slate-300">{rec.evidence_description}</p>
                                </div>
                              )}
                              {rec.sample_evidence_names && rec.sample_evidence_names.length > 0 && (
                                <div>
                                  <p className="mb-1 text-xs font-medium uppercase text-slate-500">Sample Names</p>
                                  <div className="flex flex-wrap gap-2">
                                    {rec.sample_evidence_names.map((name, idx) => (
                                      <span
                                        key={idx}
                                        className="rounded bg-slate-700 px-2 py-1 text-xs text-slate-300"
                                      >
                                        {name}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-700 px-4 py-3">
                <p className="text-sm text-slate-400">
                  Showing {page * pageSize + 1} - {Math.min((page + 1) * pageSize, recommendations.total)} of {recommendations.total}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage(Math.max(0, page - 1))}
                    disabled={page === 0}
                    className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-1 text-sm text-white disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-slate-400">
                    Page {page + 1} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                    disabled={page >= totalPages - 1}
                    className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-1 text-sm text-white disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showBulkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-800 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-700 p-4">
              <h3 className="text-lg font-semibold text-white">Bulk Generate Recommendations</h3>
              <button
                onClick={() => setShowBulkModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-4">
              {bulkProgress ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-center">
                    {bulkProgress.status === 'processing' ? (
                      <div className="flex flex-col items-center gap-3">
                        <Loader2 className="h-12 w-12 animate-spin text-primary-400" />
                        <p className="text-slate-300">Generating recommendations...</p>
                      </div>
                    ) : bulkProgress.status === 'completed' ? (
                      <div className="flex flex-col items-center gap-3">
                        <CheckCircle className="h-12 w-12 text-green-400" />
                        <p className="text-white font-medium">Generation Complete!</p>
                        <p className="text-slate-400">
                          Generated {bulkProgress.generated} recommendations
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-3">
                        <AlertCircle className="h-12 w-12 text-red-400" />
                        <p className="text-red-400">Generation failed</p>
                      </div>
                    )}
                  </div>
                  {bulkProgress.status !== 'processing' && (
                    <button
                      onClick={() => {
                        setShowBulkModal(false);
                        setBulkProgress(null);
                      }}
                      className="btn-primary w-full"
                    >
                      Close
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <p className="text-sm text-slate-400">
                    Select controls to generate AI evidence recommendations. This will analyze each control and suggest appropriate evidence types.
                  </p>
                  
                  <div>
                    <label className="mb-2 block text-sm font-medium text-slate-300">
                      Select Control Groups
                    </label>
                    <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-600 bg-slate-900">
                      {controlGroups?.map((group) => (
                        <label
                          key={group.id}
                          className="flex items-center gap-3 border-b border-slate-700 px-4 py-2 last:border-0 hover:bg-slate-800"
                        >
                          <input
                            type="checkbox"
                            checked={bulkControlIds.some(c => c.type === 'group' && c.id === group.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setBulkControlIds([...bulkControlIds, { type: 'group', id: group.id }]);
                              } else {
                                setBulkControlIds(bulkControlIds.filter(c => !(c.type === 'group' && c.id === group.id)));
                              }
                            }}
                            className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-primary-600 focus:ring-primary-500"
                          />
                          <div className="flex-1">
                            <p className="text-sm font-medium text-white">{group.code}</p>
                            <p className="text-xs text-slate-400 truncate">{group.name}</p>
                          </div>
                        </label>
                      ))}
                      {(!controlGroups || controlGroups.length === 0) && (
                        <p className="px-4 py-3 text-sm text-slate-500">No control groups available</p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <span className="text-sm text-slate-400">
                      {bulkControlIds.length} item(s) selected
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowBulkModal(false)}
                        className="btn-ghost"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          if (bulkControlIds.length > 0) {
                            bulkGenerateMutation.mutate(bulkControlIds);
                          }
                        }}
                        disabled={bulkControlIds.length === 0 || bulkGenerateMutation.isPending}
                        className="btn-primary flex items-center gap-2"
                      >
                        {bulkGenerateMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Play size={16} />
                        )}
                        Generate
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
