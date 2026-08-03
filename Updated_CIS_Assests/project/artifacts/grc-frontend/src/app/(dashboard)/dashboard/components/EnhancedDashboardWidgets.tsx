'use client';

import { useQuery } from '@tanstack/react-query';
import { governanceApi } from '@/lib/api';
import {
  Shield,
  AlertTriangle,
  Clock,
  CheckCircle,
  Calendar,
  Scale,
} from 'lucide-react';

export default function EnhancedDashboardWidgets() {
  const { data: complianceData } = useQuery({
    queryKey: ['dashboard-compliance-by-framework'],
    queryFn: async () => {
      const res = await governanceApi.getComplianceByFramework();
      return res.data;
    },
  });

  const { data: gapsSummary } = useQuery({
    queryKey: ['dashboard-open-gaps-summary'],
    queryFn: async () => {
      const res = await governanceApi.getOpenGapsSummary();
      return res.data;
    },
  });

  const { data: remediationData } = useQuery({
    queryKey: ['dashboard-remediation-progress'],
    queryFn: async () => {
      const res = await governanceApi.getRemediationProgress();
      return res.data;
    },
  });

  const { data: upcomingReviews } = useQuery({
    queryKey: ['dashboard-upcoming-reviews'],
    queryFn: async () => {
      const res = await governanceApi.getUpcomingReviewsDashboard();
      return res.data;
    },
  });

  const { data: acceptedRisks } = useQuery({
    queryKey: ['dashboard-accepted-risks'],
    queryFn: async () => {
      const res = await governanceApi.getAcceptedRisks();
      return res.data;
    },
  });

  return (
    <div className="space-y-6">
      {complianceData?.frameworks && complianceData.frameworks.length > 0 && (
        <div className="rounded-xl overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
              <Shield className="h-4 w-4" style={{ color: 'var(--color-base)' }} />
            </div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Compliance by Framework (Gap Analysis)</h3>
          </div>
          <div className="p-5 space-y-3">
            {complianceData.frameworks.map((fw: any) => {
              const pct = fw.compliance_percentage ?? 0;
              const barColor = pct >= 80 ? 'var(--color-success)' : pct >= 50 ? 'var(--color-warning)' : 'var(--color-danger)';
              return (
                <div key={fw.framework_id}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm truncate max-w-[250px]" style={{ color: 'var(--color-text)' }} title={fw.framework_name}>
                      {fw.framework_name}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                        {fw.fully_compliant}/{fw.total_clauses} clauses
                      </span>
                      <span className="text-sm font-semibold" style={{ color: barColor }}>
                        {fw.compliance_percentage != null ? `${fw.compliance_percentage}%` : 'N/A'}
                      </span>
                    </div>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-subtle)' }}>
                    <div
                      className="h-full transition-all duration-500"
                      style={{ width: `${pct}%`, backgroundColor: barColor }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {gapsSummary && (
        <>
          <div className="rounded-xl overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(155, 28, 28, 0.08)' }}>
                <AlertTriangle className="h-4 w-4" style={{ color: 'var(--color-danger)' }} />
              </div>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
                Open Gaps by Severity
                <span className="ml-2 text-xs font-normal" style={{ color: 'var(--color-muted)' }}>({gapsSummary.total_open_gaps} total)</span>
              </h3>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="rounded-xl p-4 text-center" style={{ border: '1px solid rgba(155, 28, 28, 0.2)', backgroundColor: 'rgba(155, 28, 28, 0.04)' }}>
                  <p className="text-2xl font-semibold" style={{ color: 'var(--color-danger)' }}>{gapsSummary.by_severity?.critical || 0}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Critical</p>
                </div>
                <div className="rounded-xl p-4 text-center" style={{ border: '1px solid rgba(146, 87, 14, 0.2)', backgroundColor: 'rgba(146, 87, 14, 0.04)' }}>
                  <p className="text-2xl font-semibold" style={{ color: 'var(--color-warning)' }}>{gapsSummary.by_severity?.high || 0}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>High</p>
                </div>
                <div className="rounded-xl p-4 text-center" style={{ border: '1px solid rgba(146, 87, 14, 0.15)', backgroundColor: 'rgba(146, 87, 14, 0.03)' }}>
                  <p className="text-2xl font-semibold" style={{ color: 'var(--color-warning)' }}>{gapsSummary.by_severity?.medium || 0}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Medium</p>
                </div>
                <div className="rounded-xl p-4 text-center" style={{ border: '1px solid rgba(45, 106, 79, 0.2)', backgroundColor: 'rgba(45, 106, 79, 0.04)' }}>
                  <p className="text-2xl font-semibold" style={{ color: 'var(--color-success)' }}>{gapsSummary.by_severity?.low || 0}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Low</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(146, 87, 14, 0.08)' }}>
                <Clock className="h-4 w-4" style={{ color: 'var(--color-warning)' }} />
              </div>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Gap Aging Analysis</h3>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="rounded-xl p-4 text-center" style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}>
                  <p className="text-2xl font-semibold" style={{ color: 'var(--color-success)' }}>{gapsSummary.aging_analysis?.['0_30_days'] || 0}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>0–30 days</p>
                </div>
                <div className="rounded-xl p-4 text-center" style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}>
                  <p className="text-2xl font-semibold" style={{ color: 'var(--color-warning)' }}>{gapsSummary.aging_analysis?.['31_60_days'] || 0}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>31–60 days</p>
                </div>
                <div className="rounded-xl p-4 text-center" style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}>
                  <p className="text-2xl font-semibold" style={{ color: 'var(--color-warning)' }}>{gapsSummary.aging_analysis?.['61_90_days'] || 0}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>61–90 days</p>
                </div>
                <div className="rounded-xl p-4 text-center" style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}>
                  <p className="text-2xl font-semibold" style={{ color: 'var(--color-danger)' }}>{gapsSummary.aging_analysis?.['over_90_days'] || 0}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>90+ days</p>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {remediationData && remediationData.total_findings > 0 && (
        <div className="rounded-xl overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(45, 106, 79, 0.08)' }}>
              <CheckCircle className="h-4 w-4" style={{ color: 'var(--color-success)' }} />
            </div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Remediation Progress</h3>
            <span className="ml-auto text-sm font-semibold" style={{ color: 'var(--color-success)' }}>{remediationData.progress_percentage}%</span>
          </div>
          <div className="p-5">
            <div className="h-4 rounded-full overflow-hidden flex" style={{ backgroundColor: 'var(--color-subtle)' }}>
              {remediationData.closed > 0 && (
                <div
                  className="h-full transition-all duration-500"
                  style={{ width: `${(remediationData.closed / remediationData.total_findings) * 100}%`, backgroundColor: 'var(--color-success)' }}
                  title={`Closed: ${remediationData.closed}`}
                />
              )}
              {remediationData.in_progress > 0 && (
                <div
                  className="h-full transition-all duration-500"
                  style={{ width: `${(remediationData.in_progress / remediationData.total_findings) * 100}%`, backgroundColor: 'var(--color-warning)' }}
                  title={`In Progress: ${remediationData.in_progress}`}
                />
              )}
              {remediationData.open > 0 && (
                <div
                  className="h-full transition-all duration-500"
                  style={{ width: `${(remediationData.open / remediationData.total_findings) * 100}%`, backgroundColor: 'var(--color-border)' }}
                  title={`Open: ${remediationData.open}`}
                />
              )}
            </div>
            <div className="flex items-center justify-between mt-3 text-xs" style={{ color: 'var(--color-muted)' }}>
              <div className="flex items-center gap-4">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: 'var(--color-success)' }} />
                  Closed ({remediationData.closed})
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: 'var(--color-warning)' }} />
                  In Progress ({remediationData.in_progress})
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: 'var(--color-border)' }} />
                  Open ({remediationData.open})
                </span>
              </div>
              <span style={{ color: 'var(--color-muted)' }}>{remediationData.total_findings} total findings</span>
            </div>
          </div>
        </div>
      )}

      {upcomingReviews && upcomingReviews.upcoming && upcomingReviews.upcoming.length > 0 && (
        <div className="rounded-xl overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
              <Calendar className="h-4 w-4" style={{ color: 'var(--color-base)' }} />
            </div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Upcoming Policy Reviews</h3>
            {upcomingReviews.overdue_count > 0 && (
              <span className="ml-2 text-xs px-2 py-0.5 rounded" style={{ backgroundColor: 'rgba(155, 28, 28, 0.1)', color: 'var(--color-danger)', border: '1px solid rgba(155, 28, 28, 0.2)' }}>
                {upcomingReviews.overdue_count} overdue
              </span>
            )}
          </div>
          <div style={{ borderColor: 'var(--color-border)' }}>
            {upcomingReviews.upcoming.map((review: any) => (
              <div key={review.id} className="flex items-center gap-4 px-5 py-3 transition-colors" style={{ borderBottom: '1px solid var(--color-border)' }}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate" style={{ color: 'var(--color-text)' }}>{review.title}</p>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    {review.doc_type} • Review every {review.review_cycle_months} months
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {review.is_overdue ? (
                    <span className="text-xs px-2 py-0.5 rounded whitespace-nowrap" style={{ backgroundColor: 'rgba(155, 28, 28, 0.1)', color: 'var(--color-danger)', border: '1px solid rgba(155, 28, 28, 0.2)' }}>
                      {Math.abs(review.days_until)}d overdue
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded whitespace-nowrap" style={{ backgroundColor: 'var(--color-subtle)', color: 'var(--color-muted)' }}>
                      {review.days_until}d left
                    </span>
                  )}
                  <span className="text-xs whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>
                    {review.next_review_date ? new Date(review.next_review_date).toLocaleDateString() : ''}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {acceptedRisks && acceptedRisks.total_accepted > 0 && (
        <div className="rounded-xl overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(146, 87, 14, 0.08)' }}>
              <Scale className="h-4 w-4" style={{ color: 'var(--color-warning)' }} />
            </div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
              Accepted Risks
              <span className="ml-2 text-xs font-normal" style={{ color: 'var(--color-muted)' }}>({acceptedRisks.total_accepted} total)</span>
            </h3>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
              {['critical', 'high', 'medium', 'low'].map((level) => {
                const count = acceptedRisks.by_risk_level?.[level] || 0;
                const colorMap: Record<string, { border: string; bg: string; text: string }> = {
                  critical: { border: 'rgba(155, 28, 28, 0.2)', bg: 'rgba(155, 28, 28, 0.04)', text: 'var(--color-danger)' },
                  high: { border: 'rgba(146, 87, 14, 0.2)', bg: 'rgba(146, 87, 14, 0.04)', text: 'var(--color-warning)' },
                  medium: { border: 'rgba(146, 87, 14, 0.15)', bg: 'rgba(146, 87, 14, 0.03)', text: 'var(--color-warning)' },
                  low: { border: 'rgba(45, 106, 79, 0.2)', bg: 'rgba(45, 106, 79, 0.04)', text: 'var(--color-success)' },
                };
                const c = colorMap[level];
                return (
                  <div key={level} className="rounded-xl p-4 text-center" style={{ border: `1px solid ${c.border}`, backgroundColor: c.bg }}>
                    <p className="text-2xl font-semibold" style={{ color: c.text }}>{count}</p>
                    <p className="text-xs mt-1 capitalize" style={{ color: 'var(--color-muted)' }}>{level}</p>
                  </div>
                );
              })}
            </div>
            {acceptedRisks.risks && acceptedRisks.risks.length > 0 && (
              <div className="space-y-2">
                {acceptedRisks.risks.slice(0, 5).map((risk: any) => (
                  <div key={risk.id} className="flex items-center justify-between p-2 rounded-lg" style={{ backgroundColor: 'var(--color-subtle)' }}>
                    <span className="text-sm truncate flex-1 mr-2" style={{ color: 'var(--color-text)' }}>{risk.title}</span>
                    <span
                      className="text-xs px-2 py-0.5 rounded capitalize"
                      style={{
                        backgroundColor: risk.risk_level === 'critical' || risk.risk_level === 'high'
                          ? 'rgba(155, 28, 28, 0.1)' : risk.risk_level === 'medium'
                          ? 'rgba(146, 87, 14, 0.1)' : 'rgba(45, 106, 79, 0.1)',
                        color: risk.risk_level === 'critical' || risk.risk_level === 'high'
                          ? 'var(--color-danger)' : risk.risk_level === 'medium'
                          ? 'var(--color-warning)' : 'var(--color-success)',
                      }}
                    >
                      {risk.risk_level}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
