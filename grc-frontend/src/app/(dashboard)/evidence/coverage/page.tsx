'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import {
  BarChart3,
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  FileCheck,
  Filter,
  Loader2,
  AlertCircle,
  RefreshCw,
  Plus,
  ChevronDown,
  Eye,
  Calendar,
  TrendingDown,
  Info
} from 'lucide-react';

interface EvidenceSummary {
  total_count: number;
  by_status: Record<string, number>;
  by_type: Record<string, number>;
  stale_count: number;
  expiring_soon_count: number;
  pending_review_count: number;
}

interface FrameworkCoverage {
  framework_id: number;
  framework_name: string;
  framework_code: string;
  total_controls: number;
  controls_with_evidence: number;
  controls_without_evidence: number;
  coverage_percentage: number;
  controls: Array<{
    id: number;
    code: string;
    name: string;
    has_evidence: boolean;
  }>;
}

interface CoverageData {
  total_controls: number;
  controls_with_evidence: number;
  controls_without_evidence: number;
  coverage_percentage: number;
  frameworks: FrameworkCoverage[];
}

interface StaleEvidence {
  id: number;
  name: string;
  expiry_date: string | null;
  status: string;
  evidence_type: string | null;
}

interface ExpiringEvidence {
  id: number;
  name: string;
  expiry_date: string;
  status: string;
  evidence_type: string | null;
}

interface LowQualityEvidence {
  id: number;
  name: string;
  quality_score: number | null;
  status: string;
  evidence_type: string | null;
  uploaded_at: string;
}

export default function EvidenceCoverageDashboardPage() {
  const [selectedFrameworkId, setSelectedFrameworkId] = useState<number | null>(null);
  const [hoveredCell, setHoveredCell] = useState<{ frameworkId: number; controlId: number } | null>(null);
  const queryClient = useQueryClient();

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['evidence-summary'],
    queryFn: async () => {
      const response = await apiClient.get('/evidence-mgmt/items/dashboard/summary');
      return response.data as EvidenceSummary;
    },
  });

  const { data: coverage, isLoading: coverageLoading, error: coverageError } = useQuery({
    queryKey: ['evidence-coverage', selectedFrameworkId],
    queryFn: async () => {
      const params: Record<string, number> = {};
      if (selectedFrameworkId) params.framework_id = selectedFrameworkId;
      const response = await apiClient.get('/evidence-mgmt/links/coverage', { params });
      return response.data as CoverageData;
    },
  });

  const { data: staleEvidence, isLoading: staleLoading } = useQuery({
    queryKey: ['stale-evidence'],
    queryFn: async () => {
      const response = await apiClient.get('/evidence-mgmt/lifecycle/stale');
      return response.data as { items: StaleEvidence[]; total: number };
    },
  });

  const { data: expiringEvidence, isLoading: expiringLoading } = useQuery({
    queryKey: ['expiring-evidence'],
    queryFn: async () => {
      const response = await apiClient.get('/evidence-mgmt/lifecycle/expiring-soon', {
        params: { days: 30 }
      });
      return response.data as { items: ExpiringEvidence[]; total: number };
    },
  });

  const { data: lowQualityEvidence, isLoading: lowQualityLoading } = useQuery({
    queryKey: ['low-quality-evidence'],
    queryFn: async () => {
      const response = await apiClient.get('/evidence-mgmt/ai/low-quality', {
        params: { threshold: 50 }
      });
      return response.data as LowQualityEvidence[];
    },
  });

  const renewMutation = useMutation({
    mutationFn: async (evidenceId: number) => {
      const response = await apiClient.post(`/evidence-mgmt/lifecycle/${evidenceId}/renew`, {
        new_collection_date: new Date().toISOString(),
        new_validity_period_days: 365
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stale-evidence'] });
      queryClient.invalidateQueries({ queryKey: ['evidence-summary'] });
    },
  });

  const reassessMutation = useMutation({
    mutationFn: async (evidenceId: number) => {
      const response = await apiClient.post(`/evidence-mgmt/ai/${evidenceId}/assess?force_refresh=true`);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['low-quality-evidence'] });
      queryClient.invalidateQueries({ queryKey: ['evidence-summary'] });
    },
  });

  const orphanControls = useMemo(() => {
    if (!coverage?.frameworks) return [];
    
    return coverage.frameworks.flatMap(fw => 
      fw.controls
        .filter(ctrl => !ctrl.has_evidence)
        .map(ctrl => ({
          ...ctrl,
          frameworkId: fw.framework_id,
          frameworkName: fw.framework_name,
          frameworkCode: fw.framework_code
        }))
    );
  }, [coverage]);

  const filteredOrphanControls = useMemo(() => {
    if (!selectedFrameworkId) return orphanControls;
    return orphanControls.filter(ctrl => ctrl.frameworkId === selectedFrameworkId);
  }, [orphanControls, selectedFrameworkId]);

  const getDaysOverdue = (expiryDate: string | null) => {
    if (!expiryDate) return 0;
    const expiry = new Date(expiryDate);
    const now = new Date();
    const diff = Math.floor((now.getTime() - expiry.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(0, diff);
  };

  const getDaysRemaining = (expiryDate: string) => {
    const expiry = new Date(expiryDate);
    const now = new Date();
    const diff = Math.floor((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(0, diff);
  };

  const getCoverageColor = (percentage: number) => {
    if (percentage >= 80) return 'bg-green-500';
    if (percentage >= 50) return 'bg-yellow-500';
    if (percentage >= 20) return 'bg-orange-500';
    return 'bg-red-500';
  };

  const getCoverageTextColor = (percentage: number) => {
    if (percentage >= 80) return 'text-green-400';
    if (percentage >= 50) return 'text-yellow-400';
    if (percentage >= 20) return 'text-orange-400';
    return 'text-red-400';
  };

  const getExpiryStatusStyle = (daysRemaining: number) => {
    if (daysRemaining <= 3) return { bg: 'bg-red-500/20', text: 'text-red-400', label: 'Critical' };
    if (daysRemaining <= 7) return { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'Warning' };
    return { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Expiring Soon' };
  };

  const isLoading = summaryLoading || coverageLoading;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Evidence Coverage Dashboard</h1>
          <p className="text-gray-600">Monitor evidence coverage across frameworks and controls</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600" />
            <select
              value={selectedFrameworkId || ''}
              onChange={(e) => setSelectedFrameworkId(e.target.value ? Number(e.target.value) : null)}
              className="appearance-none rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-10 text-slate-700 focus:border-primary-500 focus:outline-none"
            >
              <option value="">All Frameworks</option>
              {coverage?.frameworks.map(fw => (
                <option key={fw.framework_id} value={fw.framework_id}>
                  {fw.framework_code} - {fw.framework_name}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600 pointer-events-none" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-primary-500/20 to-primary-600/10 p-3">
              <Shield className="h-6 w-6 text-primary-400" />
            </div>
          </div>
          <p className="stat-value">{isLoading ? '-' : coverage?.total_controls || 0}</p>
          <p className="stat-label">Total Controls</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-green-500/20 to-green-600/10 p-3">
              <CheckCircle className="h-6 w-6 text-green-400" />
            </div>
            {coverage && coverage.total_controls > 0 && (
              <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-xs font-medium text-green-400">
                {coverage.coverage_percentage}%
              </span>
            )}
          </div>
          <p className="stat-value">{isLoading ? '-' : coverage?.controls_with_evidence || 0}</p>
          <p className="stat-label">Controls with Evidence</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-orange-500/20 to-orange-600/10 p-3">
              <XCircle className="h-6 w-6 text-orange-400" />
            </div>
          </div>
          <p className="stat-value">{isLoading ? '-' : coverage?.controls_without_evidence || 0}</p>
          <p className="stat-label">Controls without Evidence</p>
        </div>

        <div className="stat-card group">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-red-500/20 to-red-600/10 p-3">
              <AlertTriangle className="h-6 w-6 text-red-400" />
            </div>
            {(summary?.stale_count || 0) > 0 && (
              <span className="flex h-2 w-2">
                <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500"></span>
              </span>
            )}
          </div>
          <p className="stat-value">{summaryLoading ? '-' : summary?.stale_count || 0}</p>
          <p className="stat-label">Stale Evidence</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-gradient-to-br from-yellow-500/20 to-yellow-600/10 p-3">
              <TrendingDown className="h-6 w-6 text-yellow-400" />
            </div>
          </div>
          <p className="stat-value">{lowQualityLoading ? '-' : lowQualityEvidence?.length || 0}</p>
          <p className="stat-label">Low Quality Evidence</p>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title">Coverage Heatmap</h2>
            <p className="card-description">Evidence coverage across frameworks</p>
          </div>
        </div>
        
        {coverageLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
          </div>
        ) : coverageError ? (
          <div className="flex h-64 flex-col items-center justify-center text-red-400">
            <AlertCircle className="mb-2 h-8 w-8" />
            <p>Failed to load coverage data</p>
          </div>
        ) : !coverage?.frameworks.length ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <BarChart3 className="mb-4 h-12 w-12 text-gray-400" />
            <h3 className="text-lg font-medium text-slate-800">No framework data available</h3>
            <p className="mt-1 text-gray-600">Add frameworks and controls to see coverage</p>
          </div>
        ) : (
          <div className="space-y-4">
            {coverage.frameworks.map(fw => (
              <div key={fw.framework_id} className="rounded-lg border border-gray-200 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gray-100">
                      <Shield className="h-5 w-5 text-gray-600" />
                    </div>
                    <div>
                      <h3 className="font-medium text-slate-900">{fw.framework_code}</h3>
                      <p className="text-xs text-gray-600">{fw.framework_name}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className={`text-lg font-bold ${getCoverageTextColor(fw.coverage_percentage)}`}>
                        {fw.coverage_percentage}%
                      </p>
                      <p className="text-xs text-gray-600">
                        {fw.controls_with_evidence} / {fw.total_controls} controls
                      </p>
                    </div>
                  </div>
                </div>
                
                <div className="mb-2 h-3 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={`h-full transition-all ${getCoverageColor(fw.coverage_percentage)}`}
                    style={{ width: `${fw.coverage_percentage}%` }}
                  />
                </div>
                
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {fw.controls.slice(0, 30).map(ctrl => (
                    <div
                      key={ctrl.id}
                      className={`group relative cursor-pointer rounded px-2 py-1 text-xs transition-all ${
                        ctrl.has_evidence 
                          ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' 
                          : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                      }`}
                      onMouseEnter={() => setHoveredCell({ frameworkId: fw.framework_id, controlId: ctrl.id })}
                      onMouseLeave={() => setHoveredCell(null)}
                    >
                      {ctrl.code}
                      {hoveredCell?.controlId === ctrl.id && hoveredCell?.frameworkId === fw.framework_id && (
                        <div className="absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-gray-800 px-3 py-2 text-xs shadow-lg border border-gray-200">
                          <p className="font-medium text-white">{ctrl.name}</p>
                          <p className={ctrl.has_evidence ? 'text-green-400' : 'text-red-400'}>
                            {ctrl.has_evidence ? 'Has Evidence' : 'Missing Evidence'}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                  {fw.controls.length > 30 && (
                    <span className="rounded px-2 py-1 text-xs text-gray-600">
                      +{fw.controls.length - 30} more
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Controls Without Evidence</h2>
              <p className="card-description">{filteredOrphanControls.length} controls need evidence</p>
            </div>
          </div>
          
          <div className="max-h-96 overflow-y-auto">
            {filteredOrphanControls.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle className="mb-3 h-10 w-10 text-green-400" />
                <p className="text-gray-600">All controls have evidence!</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="sticky top-0 bg-white">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-600">Framework</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-600">Control</th>
                    <th className="px-4 py-2 text-right text-xs font-medium uppercase text-gray-600">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredOrphanControls.slice(0, 10).map(ctrl => (
                    <tr key={`${ctrl.frameworkId}-${ctrl.id}`} className="hover:bg-gray-50">
                      <td className="px-4 py-2">
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-700">
                          {ctrl.frameworkCode}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <p className="text-sm font-medium text-slate-900">{ctrl.code}</p>
                        <p className="text-xs text-gray-600 truncate max-w-xs">{ctrl.name}</p>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button className="inline-flex items-center gap-1 rounded bg-primary-600 px-2 py-1 text-xs font-medium text-white hover:bg-primary-700">
                          <Plus size={12} />
                          Add Evidence
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {filteredOrphanControls.length > 10 && (
              <div className="border-t border-gray-200 p-3 text-center">
                <span className="text-sm text-gray-600">
                  Showing 10 of {filteredOrphanControls.length} controls
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-400" />
                Stale Evidence Alerts
              </h2>
              <p className="card-description">{staleEvidence?.total || 0} items need attention</p>
            </div>
          </div>
          
          <div className="max-h-96 overflow-y-auto">
            {staleLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary-400" />
              </div>
            ) : !staleEvidence?.items.length ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle className="mb-3 h-10 w-10 text-green-400" />
                <p className="text-gray-600">No stale evidence!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {staleEvidence.items.slice(0, 5).map(item => (
                  <div key={item.id} className="flex items-center justify-between rounded-lg border border-red-500/20 bg-red-500/5 p-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500/20">
                        <AlertTriangle className="h-4 w-4 text-red-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{item.name}</p>
                        <p className="text-xs text-red-400">
                          {item.expiry_date 
                            ? `${getDaysOverdue(item.expiry_date)} days overdue`
                            : 'Marked as stale'
                          }
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => renewMutation.mutate(item.id)}
                      disabled={renewMutation.isPending}
                      className="inline-flex items-center gap-1 rounded bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50"
                    >
                      <RefreshCw size={12} className={renewMutation.isPending ? 'animate-spin' : ''} />
                      Renew
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title flex items-center gap-2">
                <Clock className="h-5 w-5 text-yellow-400" />
                Expiring Soon
              </h2>
              <p className="card-description">Evidence expiring within 30 days</p>
            </div>
          </div>
          
          <div className="max-h-96 overflow-y-auto">
            {expiringLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary-400" />
              </div>
            ) : !expiringEvidence?.items.length ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle className="mb-3 h-10 w-10 text-green-400" />
                <p className="text-gray-600">No evidence expiring soon</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="sticky top-0 bg-white">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-600">Evidence</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-600">Expiry</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-gray-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {expiringEvidence.items.map(item => {
                    const daysRemaining = getDaysRemaining(item.expiry_date);
                    const status = getExpiryStatusStyle(daysRemaining);
                    return (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-4 py-2">
                          <p className="text-sm font-medium text-black">{item.name}</p>
                          <p className="text-xs text-gray-600 capitalize">{item.evidence_type?.replace(/_/g, ' ') || 'Unknown'}</p>
                        </td>
                        <td className="px-4 py-2">
                          <p className="text-sm text-gray-700">
                            {new Date(item.expiry_date).toLocaleDateString()}
                          </p>
                          <p className="text-xs text-gray-600">{daysRemaining} days remaining</p>
                        </td>
                        <td className="px-4 py-2">
                          <span className={`inline-flex items-center gap-1 rounded-full ${status.bg} px-2 py-0.5 text-xs font-medium ${status.text}`}>
                            {daysRemaining <= 3 ? <AlertCircle size={10} /> : <Clock size={10} />}
                            {status.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title flex items-center gap-2">
                <TrendingDown className="h-5 w-5 text-orange-400" />
                Low Quality Evidence
              </h2>
              <p className="card-description">Quality score below 50%</p>
            </div>
          </div>
          
          <div className="max-h-96 overflow-y-auto">
            {lowQualityLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary-400" />
              </div>
            ) : !lowQualityEvidence?.length ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle className="mb-3 h-10 w-10 text-green-400" />
                <p className="text-gray-600">All evidence meets quality standards</p>
              </div>
            ) : (
              <div className="space-y-3">
                {lowQualityEvidence.slice(0, 5).map(item => (
                  <div key={item.id} className="flex items-center justify-between rounded-lg border border-orange-500/20 bg-orange-500/5 p-3">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full border-4 border-gray-200">
                          <span className="text-sm font-bold text-orange-400">
                            {item.quality_score?.toFixed(0) || 0}%
                          </span>
                        </div>
                        <svg className="absolute inset-0 h-12 w-12 -rotate-90">
                          <circle
                            cx="24"
                            cy="24"
                            r="20"
                            strokeWidth="4"
                            stroke="currentColor"
                            fill="none"
                            className="text-gray-700"
                          />
                          <circle
                            cx="24"
                            cy="24"
                            r="20"
                            strokeWidth="4"
                            stroke="currentColor"
                            fill="none"
                            strokeDasharray={`${(item.quality_score || 0) * 1.256} 125.6`}
                            className="text-orange-500"
                          />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{item.name}</p>
                        <p className="text-xs text-gray-600">
                          Last assessed: {item.uploaded_at ? new Date(item.uploaded_at).toLocaleDateString() : 'Never'}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => reassessMutation.mutate(item.id)}
                      disabled={reassessMutation.isPending}
                      className="inline-flex items-center gap-1 rounded bg-orange-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-600 disabled:opacity-50"
                    >
                      <RefreshCw size={12} className={reassessMutation.isPending ? 'animate-spin' : ''} />
                      Re-assess
                    </button>
                  </div>
                ))}
              </div>
            )}
            {lowQualityEvidence && lowQualityEvidence.length > 5 && (
              <div className="border-t border-gray-200 p-3 text-center">
                <span className="text-sm text-gray-600">
                  Showing 5 of {lowQualityEvidence.length} items
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white/50 p-4">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-gray-600 mt-0.5" />
          <div>
            <h4 className="text-sm font-medium text-slate-900">Coverage Legend</h4>
            <div className="mt-2 flex flex-wrap gap-4 text-xs">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded bg-green-500"></div>
                <span className="text-gray-600">80%+ Excellent</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded bg-yellow-500"></div>
                <span className="text-gray-600">50-79% Good</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded bg-orange-500"></div>
                <span className="text-gray-600">20-49% Needs Improvement</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded bg-red-500"></div>
                <span className="text-gray-600">&lt;20% Critical</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

