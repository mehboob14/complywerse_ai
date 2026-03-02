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
      return { backgroundColor: 'rgba(155, 28, 28, 0.1)', color: 'var(--color-danger)', borderColor: 'rgba(155, 28, 28, 0.2)' };
    case 'high':
      return { backgroundColor: 'rgba(146, 87, 14, 0.1)', color: 'var(--color-warning)', borderColor: 'rgba(146, 87, 14, 0.2)' };
    case 'medium':
      return { backgroundColor: 'rgba(146, 87, 14, 0.08)', color: 'var(--color-warning)', borderColor: 'rgba(146, 87, 14, 0.15)' };
    case 'low':
      return { backgroundColor: 'rgba(28, 43, 58, 0.08)', color: 'var(--color-base)', borderColor: 'rgba(28, 43, 58, 0.15)' };
    default:
      return { backgroundColor: 'var(--color-subtle)', color: 'var(--color-muted)', borderColor: 'var(--color-border)' };
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
      return { color: 'var(--color-base)', backgroundColor: 'rgba(28, 43, 58, 0.08)' };
    case 'risk':
      return { color: 'var(--color-warning)', backgroundColor: 'rgba(146, 87, 14, 0.08)' };
    case 'evidence':
      return { color: 'var(--color-success)', backgroundColor: 'rgba(45, 106, 79, 0.08)' };
    case 'governance':
      return { color: 'var(--color-base)', backgroundColor: 'rgba(28, 43, 58, 0.06)' };
    default:
      return { color: 'var(--color-muted)', backgroundColor: 'var(--color-subtle)' };
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
      <div className="rounded-xl overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3">
            <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
              <Sparkles className="h-5 w-5" style={{ color: 'var(--color-base)' }} />
            </div>
            <div>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>AI Insights</h3>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Loading recommendations...</p>
            </div>
          </div>
        </div>
        <div className="p-5">
          <div className="space-y-4 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-lg p-4" style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}>
                <div className="flex items-start gap-3">
                  <div className="h-8 w-8 rounded-lg skeleton" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 w-3/4 rounded skeleton" />
                    <div className="h-3 w-full rounded skeleton" />
                    <div className="h-3 w-2/3 rounded skeleton" />
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
      <div className="rounded-xl overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3">
            <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
              <Sparkles className="h-5 w-5" style={{ color: 'var(--color-base)' }} />
            </div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>AI Insights</h3>
          </div>
        </div>
        <div className="p-8 text-center">
          <AlertCircle className="h-10 w-10 mx-auto mb-3" style={{ color: 'var(--color-muted)' }} />
          <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>Unable to load AI insights</p>
          <button
            onClick={() => refetch()}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors"
            style={{ backgroundColor: 'var(--color-subtle)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
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
    <div className="rounded-xl overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-3">
          <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
            <Sparkles className="h-5 w-5" style={{ color: 'var(--color-base)' }} />
          </div>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>AI Insights</h3>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              {totalSignals > 0 ? `${totalSignals} issues detected` : 'Analyzing your GRC posture'}
            </p>
          </div>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="p-2 rounded-lg transition-colors disabled:opacity-50"
          style={{ color: 'var(--color-muted)' }}
          title="Refresh insights"
        >
          <RefreshCw className={`h-4 w-4 ${isFetching ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="p-5">
        {recommendations.length > 0 ? (
          <div className="space-y-3">
            {recommendations.slice(0, 6).map((rec) => {
              const CategoryIcon = getCategoryIcon(rec.category);
              const catStyles = getCategoryStyles(rec.category);
              const sevStyles = getSeverityStyles(rec.severity);
              return (
                <div
                  key={rec.id}
                  className="rounded-lg p-4 transition-colors"
                  style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}
                >
                  <div className="flex items-start gap-3">
                    <div className="rounded-lg p-2" style={catStyles}>
                      <CategoryIcon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <h4 className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }} title={rec.title}>
                          {rec.title}
                        </h4>
                        <span
                          className="shrink-0 text-xs font-medium px-2 py-0.5 rounded"
                          style={{ ...sevStyles, border: `1px solid ${sevStyles.borderColor}` }}
                        >
                          {rec.severity}
                        </span>
                      </div>
                      <p className="text-xs line-clamp-2 mb-3" style={{ color: 'var(--color-muted)' }}>{rec.rationale}</p>
                      <Link
                        href={rec.action_link}
                        className="inline-flex items-center gap-1 text-xs font-medium transition-colors"
                        style={{ color: 'var(--color-base)' }}
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
            <Shield className="h-10 w-10 mx-auto mb-3" style={{ color: 'var(--color-success)', opacity: 0.5 }} />
            <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>All clear!</p>
            <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
              No critical issues detected at this time
            </p>
          </div>
        )}
      </div>

      {data?.generated_at && (
        <div className="px-5 py-3" style={{ borderTop: '1px solid var(--color-border)', backgroundColor: 'var(--color-subtle)' }}>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Generated {new Date(data.generated_at).toLocaleString()}
          </p>
        </div>
      )}
    </div>
  );
}
