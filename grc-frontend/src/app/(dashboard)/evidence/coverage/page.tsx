'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
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
import { PageLoader } from '@/components/ui';

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
    if (percentage >= 80) return 'bg-emerald-500';
    if (percentage >= 50) return 'bg-amber-500';
    if (percentage >= 20) return 'bg-orange-500';
    return 'bg-rose-500';
  };

  const getCoverageTextColor = (percentage: number) => {
    if (percentage >= 80) return 'text-emerald-600';
    if (percentage >= 50) return 'text-amber-600';
    if (percentage >= 20) return 'text-orange-600';
    return 'text-rose-600';
  };

  const getExpiryStatusStyle = (daysRemaining: number) => {
    if (daysRemaining <= 3) return { bg: 'bg-rose-50', text: 'text-rose-700', label: 'Critical' };
    if (daysRemaining <= 7) return { bg: 'bg-orange-50', text: 'text-orange-700', label: 'Warning' };
    return { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Expiring Soon' };
  };

  const isLoading = summaryLoading || coverageLoading;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Evidence Coverage Dashboard</h1>
          <p className="text-slate-500">Monitor evidence coverage across frameworks and controls</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" strokeWidth={1.75} />
            <select
              value={selectedFrameworkId || ''}
              onChange={(e) => setSelectedFrameworkId(e.target.value ? Number(e.target.value) : null)}
              className="appearance-none rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-10 text-slate-700 focus:border-primary-500 focus:outline-none"
            >
              <option value="">All Frameworks</option>
              {coverage?.frameworks.map(fw => (
                <option key={fw.framework_id} value={fw.framework_id}>
                  {fw.framework_code} - {fw.framework_name}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 pointer-events-none" strokeWidth={1.75} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-primary-50 p-3">
              <Shield className="h-6 w-6 text-primary-600" strokeWidth={1.75} />
            </div>
          </div>
          <p className="stat-value">{isLoading ? '-' : coverage?.total_controls || 0}</p>
          <p className="stat-label">Total Controls</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-emerald-50 p-3">
              <CheckCircle className="h-6 w-6 text-emerald-600" strokeWidth={1.75} />
            </div>
            {coverage && coverage.total_controls > 0 && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                {coverage.coverage_percentage}%
              </span>
            )}
          </div>
          <p className="stat-value">{isLoading ? '-' : coverage?.controls_with_evidence || 0}</p>
          <p className="stat-label">Controls with Evidence</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-orange-50 p-3">
              <XCircle className="h-6 w-6 text-orange-600" strokeWidth={1.75} />
            </div>
          </div>
          <p className="stat-value">{isLoading ? '-' : coverage?.controls_without_evidence || 0}</p>
          <p className="stat-label">Controls without Evidence</p>
        </div>

        <div className="stat-card group">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-rose-50 p-3">
              <AlertTriangle className="h-6 w-6 text-rose-600" strokeWidth={1.75} />
            </div>
            {(summary?.stale_count || 0) > 0 && (
              <span className="flex h-2 w-2">
                <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500"></span>
              </span>
            )}
          </div>
          <p className="stat-value">{summaryLoading ? '-' : summary?.stale_count || 0}</p>
          <p className="stat-label">Stale Evidence</p>
        </div>

        <div className="stat-card">
          <div className="flex items-start justify-between">
            <div className="rounded-xl bg-amber-50 p-3">
              <TrendingDown className="h-6 w-6 text-amber-600" strokeWidth={1.75} />
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
          <PageLoader className="h-64" />
        ) : coverageError ? (
          <div className="flex h-64 flex-col items-center justify-center text-rose-600">
            <AlertCircle className="mb-2 h-8 w-8" strokeWidth={1.75} />
            <p>Failed to load coverage data</p>
          </div>
        ) : !coverage?.frameworks.length ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <BarChart3 className="mb-4 h-12 w-12 text-slate-300" strokeWidth={1.75} />
            <h3 className="text-lg font-medium text-slate-800">No framework data available</h3>
            <p className="mt-1 text-slate-500">Add frameworks and controls to see coverage</p>
          </div>
        ) : (
          <div className="space-y-4">
            {coverage.frameworks.map(fw => (
              <div key={fw.framework_id} className="rounded-lg border border-slate-200 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100">
                      <Shield className="h-5 w-5 text-slate-500" strokeWidth={1.75} />
                    </div>
                    <div>
                      <h3 className="font-medium text-slate-900">{fw.framework_code}</h3>
                      <p className="text-xs text-slate-500">{fw.framework_name}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className={`text-lg font-bold ${getCoverageTextColor(fw.coverage_percentage)}`}>
                        {fw.coverage_percentage}%
                      </p>
                      <p className="text-xs text-slate-500">
                        {fw.controls_with_evidence} / {fw.total_controls} controls
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mb-2 h-3 w-full overflow-hidden rounded-full bg-slate-100">
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
                          ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
                      }`}
                      onMouseEnter={() => setHoveredCell({ frameworkId: fw.framework_id, controlId: ctrl.id })}
                      onMouseLeave={() => setHoveredCell(null)}
                    >
                      {ctrl.code}
                      {hoveredCell?.controlId === ctrl.id && hoveredCell?.frameworkId === fw.framework_id && (
                        <div className="absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-xs shadow-lg">
                          <p className="font-medium text-white">{ctrl.name}</p>
                          <p className={ctrl.has_evidence ? 'text-emerald-300' : 'text-rose-300'}>
                            {ctrl.has_evidence ? 'Has Evidence' : 'Missing Evidence'}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                  {fw.controls.length > 30 && (
                    <span className="rounded px-2 py-1 text-xs text-slate-500">
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
                <CheckCircle className="mb-3 h-10 w-10 text-emerald-500" strokeWidth={1.75} />
                <p className="text-slate-500">All controls have evidence!</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="sticky top-0 bg-white">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-slate-500">Framework</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-slate-500">Control</th>
                    <th className="px-4 py-2 text-right text-xs font-medium uppercase text-slate-500">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {filteredOrphanControls.slice(0, 10).map(ctrl => (
                    <tr key={`${ctrl.frameworkId}-${ctrl.id}`} className="hover:bg-slate-50">
                      <td className="px-4 py-2">
                        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                          {ctrl.frameworkCode}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <p className="text-sm font-medium text-slate-900">{ctrl.code}</p>
                        <p className="text-xs text-slate-500 truncate max-w-xs">{ctrl.name}</p>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Link
                          href="/evidence"
                          className="inline-flex items-center gap-1 rounded bg-primary-600 px-2 py-1 text-xs font-medium text-white hover:bg-primary-700"
                        >
                          <Plus size={12} strokeWidth={1.75} />
                          Add Evidence
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {filteredOrphanControls.length > 10 && (
              <div className="border-t border-slate-200 p-3 text-center">
                <span className="text-sm text-slate-500">
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
                <AlertTriangle className="h-5 w-5 text-rose-500" strokeWidth={1.75} />
                Stale Evidence Alerts
              </h2>
              <p className="card-description">{staleEvidence?.total || 0} items need attention</p>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {staleLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary-500" strokeWidth={1.75} />
              </div>
            ) : !staleEvidence?.items.length ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle className="mb-3 h-10 w-10 text-emerald-500" strokeWidth={1.75} />
                <p className="text-slate-500">No stale evidence!</p>
              </div>
            ) : (
              <div className="space-y-3">
                {staleEvidence.items.slice(0, 5).map(item => (
                  <div key={item.id} className="flex items-center justify-between rounded-lg border border-rose-200 bg-rose-50 p-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-100">
                        <AlertTriangle className="h-4 w-4 text-rose-600" strokeWidth={1.75} />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{item.name}</p>
                        <p className="text-xs text-rose-600">
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
                      className="inline-flex items-center gap-1 rounded bg-rose-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700 disabled:opacity-50"
                    >
                      <RefreshCw size={12} className={renewMutation.isPending ? 'animate-spin' : ''} strokeWidth={1.75} />
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
                <Clock className="h-5 w-5 text-amber-500" strokeWidth={1.75} />
                Expiring Soon
              </h2>
              <p className="card-description">Evidence expiring within 30 days</p>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {expiringLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary-500" strokeWidth={1.75} />
              </div>
            ) : !expiringEvidence?.items.length ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle className="mb-3 h-10 w-10 text-emerald-500" strokeWidth={1.75} />
                <p className="text-slate-500">No evidence expiring soon</p>
              </div>
            ) : (
              <table className="w-full">
                <thead className="sticky top-0 bg-white">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-slate-500">Evidence</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-slate-500">Expiry</th>
                    <th className="px-4 py-2 text-left text-xs font-medium uppercase text-slate-500">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {expiringEvidence.items.map(item => {
                    const daysRemaining = getDaysRemaining(item.expiry_date);
                    const status = getExpiryStatusStyle(daysRemaining);
                    return (
                      <tr key={item.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2">
                          <p className="text-sm font-medium text-slate-900">{item.name}</p>
                          <p className="text-xs text-slate-500 capitalize">{item.evidence_type?.replace(/_/g, ' ') || 'Unknown'}</p>
                        </td>
                        <td className="px-4 py-2">
                          <p className="text-sm text-slate-700">
                            {new Date(item.expiry_date).toLocaleDateString()}
                          </p>
                          <p className="text-xs text-slate-500">{daysRemaining} days remaining</p>
                        </td>
                        <td className="px-4 py-2">
                          <span className={`inline-flex items-center gap-1 rounded-full ${status.bg} px-2 py-0.5 text-xs font-medium ${status.text}`}>
                            {daysRemaining <= 3 ? <AlertCircle size={10} strokeWidth={1.75} /> : <Clock size={10} strokeWidth={1.75} />}
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
                <TrendingDown className="h-5 w-5 text-orange-500" strokeWidth={1.75} />
                Low Quality Evidence
              </h2>
              <p className="card-description">Quality score below 50%</p>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {lowQualityLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-primary-500" strokeWidth={1.75} />
              </div>
            ) : !lowQualityEvidence?.length ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle className="mb-3 h-10 w-10 text-emerald-500" strokeWidth={1.75} />
                <p className="text-slate-500">All evidence meets quality standards</p>
              </div>
            ) : (
              <div className="space-y-3">
                {lowQualityEvidence.slice(0, 5).map(item => (
                  <div key={item.id} className="flex items-center justify-between rounded-lg border border-orange-200 bg-orange-50 p-3">
                    <div className="flex items-center gap-3">
                      <div className="relative">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full border-4 border-slate-200">
                          <span className="text-sm font-bold text-orange-600">
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
                            className="text-slate-200"
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
                        <p className="text-xs text-slate-500">
                          Last assessed: {item.uploaded_at ? new Date(item.uploaded_at).toLocaleDateString() : 'Never'}
                        </p>
                      </div>
                    </div>
                    <Link
                      href={`/evidence/${item.id}`}
                      className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <Eye size={12} strokeWidth={1.75} />
                      Review
                    </Link>
                  </div>
                ))}
              </div>
            )}
            {lowQualityEvidence && lowQualityEvidence.length > 5 && (
              <div className="border-t border-slate-200 p-3 text-center">
                <span className="text-sm text-slate-500">
                  Showing 5 of {lowQualityEvidence.length} items
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-start gap-3">
          <Info className="h-5 w-5 text-slate-400 mt-0.5" strokeWidth={1.75} />
          <div>
            <h4 className="text-sm font-medium text-slate-900">Coverage Legend</h4>
            <div className="mt-2 flex flex-wrap gap-4 text-xs">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded bg-emerald-500"></div>
                <span className="text-slate-600">80%+ Excellent</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded bg-amber-500"></div>
                <span className="text-slate-600">50-79% Good</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded bg-orange-500"></div>
                <span className="text-slate-600">20-49% Needs Improvement</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded bg-rose-500"></div>
                <span className="text-slate-600">&lt;20% Critical</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

