'use client';

import { useQuery } from '@tanstack/react-query';
import { dashboardApi } from '@/lib/api';
import Link from 'next/link';
import {
  Sparkles,
  AlertTriangle,
  Shield,
  FileText,
  Gavel,
  ChevronRight,
  RefreshCw,
  AlertCircle,
} from 'lucide-react';

interface Recommendation {
  id: number;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: 'compliance' | 'risk' | 'evidence' | 'governance';
  rationale: string;
  action_text: string;
  action_link: string;
}

interface AIInsightsData {
  generated_at: string;
  signals: {
    compliance_gaps: Array<{ framework_id: number; name: string; score: number; gap_percentage: number }>;
    expiring_evidence: Array<{ id: number; name: string; days_until_expiry: number }>;
    risks_without_controls: Array<{ id: number; title: string }>;
    overdue_mitigations: Array<{ id: number; title: string; days_overdue: number }>;
    pending_assessments: Array<{ id: number; name: string; type: string }>;
  };
  recommendations: Recommendation[];
}

function getSeverityStyles(severity: string) {
  switch (severity) {
    case 'critical':
      return 'bg-red-50 text-red-700 border-red-200';
    case 'high':
      return 'bg-orange-50 text-orange-700 border-orange-500/30';
    case 'medium':
      return 'bg-yellow-50 text-yellow-700 border-yellow-200';
    case 'low':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    default:
      return 'bg-slate-50 text-slate-700 border-slate-500/30';
  }
}

function getCategoryIcon(category: string) {
  switch (category) {
    case 'compliance':
      return Shield;
    case 'risk':
      return AlertTriangle;
    case 'evidence':
      return FileText;
    case 'governance':
      return Gavel;
    default:
      return Shield;
  }
}

function getCategoryStyles(category: string) {
  switch (category) {
    case 'compliance':
      return 'text-blue-600 bg-blue-50';
    case 'risk':
      return 'text-amber-600 bg-amber-50';
    case 'evidence':
      return 'text-emerald-600 bg-emerald-50';
    case 'governance':
      return 'text-primary-600 bg-primary-50';
    default:
      return 'text-slate-600 bg-slate-50';
  }
}

export default function AIInsightsPanel() {
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['ai-insights'],
    queryFn: async () => {
      const response = await dashboardApi.getAIInsights();
      return response.data as AIInsightsData;
    },
    refetchInterval: 300000,
    staleTime: 120000,
  });

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 p-1.5">
              <Sparkles className="h-5 w-5 text-violet-400" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">AI Insights</h3>
              <p className="text-xs text-slate-600">Loading recommendations...</p>
            </div>
          </div>
        </div>
        <div className="p-4">
          <div className="space-y-4 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-lg border border-slate-200 bg-slate-50/50 p-4">
                <div className="flex items-start gap-3">
                  <div className="h-8 w-8 rounded-lg bg-slate-200" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 rounded bg-slate-200" />
                    <div className="h-3 w-full rounded bg-slate-200" />
                    <div className="h-3 w-2/3 rounded bg-slate-200" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 p-1.5">
              <Sparkles className="h-5 w-5 text-violet-400" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900">AI Insights</h3>
          </div>
        </div>
        <div className="p-6 text-center">
          <AlertCircle className="h-10 w-10 text-slate-500 mx-auto mb-3" />
          <p className="text-sm text-slate-600 mb-4">Unable to load AI insights</p>
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 transition-colors hover:bg-slate-50"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  const recommendations = data?.recommendations || [];
  const totalSignals =
    (data?.signals?.compliance_gaps?.length || 0) +
    (data?.signals?.expiring_evidence?.length || 0) +
    (data?.signals?.risks_without_controls?.length || 0) +
    (data?.signals?.overdue_mitigations?.length || 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="rounded-lg bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 p-1.5">
            <Sparkles className="h-5 w-5 text-violet-400" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-900">AI Insights</h3>
            <p className="text-xs text-slate-600">
              {totalSignals > 0 ? `${totalSignals} issues detected` : 'Analyzing your GRC posture'}
            </p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="rounded-lg p-1.5 text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
          title="Refresh insights"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="p-4">
        {recommendations.length > 0 ? (
          <div className="space-y-3">
            {recommendations.slice(0, 6).map((rec) => {
              const CategoryIcon = getCategoryIcon(rec.category);
              return (
                <div
                  key={rec.id}
                  className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 hover:border-slate-300 transition-colors"
                >
                  <div className="flex items-start gap-3">
                    <div className={`rounded-lg p-2 ${getCategoryStyles(rec.category)}`}>
                      <CategoryIcon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                          <h4 className="truncate text-sm font-medium text-slate-900" title={rec.title}>
                          {rec.title}
                        </h4>
                        <span
                          className={`shrink-0 text-xs font-medium px-2 py-0.5 rounded border ${getSeverityStyles(
                            rec.severity
                          )}`}
                        >
                          {rec.severity}
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 line-clamp-2 mb-3">{rec.rationale}</p>
                      <Link
                        href={rec.action_link}
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary-600 transition-colors hover:text-primary-700"
                      >
                        {rec.action_text}
                        <ChevronRight className="h-3 w-3" />
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8">
            <Shield className="h-10 w-10 text-emerald-500/50 mx-auto mb-3" />
            <p className="text-sm font-medium text-slate-900">All clear!</p>
            <p className="text-xs text-slate-500 mt-1">
              No critical issues detected at this time
            </p>
          </div>
        )}
      </div>

      {data?.generated_at && (
        <div className="border-t border-slate-200 bg-slate-50/30 px-4 py-2.5">
          <p className="text-xs text-slate-500">
            Generated {new Date(data.generated_at).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}
