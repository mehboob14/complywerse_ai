'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  Clock,
  Target,
  TrendingUp,
  ChevronRight,
  Flame,
  BarChart3,
  Layers,
} from 'lucide-react';
import {
  RiskHeatmap,
  TrendLine,
  KPICard,
  ChartEmptyState,
} from '@/components/charts';
import { UnifiedDashboard } from './types';

export default function RiskTab({ data }: { data: UnifiedDashboard }) {
  const riskTrendLabels = data.kpis.risk_trend.map(t => ({ label: t.month, value: t.value }));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Total Risks"
          value={data.risk.total_risks}
          subtitle={`${data.risk.open_risks} open`}
          icon={<AlertTriangle className="h-5 w-5" style={{ color: 'var(--color-warning)' }} />}
          color="amber"
        />
        <KPICard
          title="Avg Risk Score"
          value={data.risk.avg_residual_score}
          subtitle="Residual risk"
          icon={<BarChart3 className="h-5 w-5" style={{ color: 'var(--color-base)' }} />}
          color="blue"
        />
        <KPICard
          title="Open Incidents"
          value={data.risk.incidents_open}
          subtitle={data.risk.incidents_open > 0 ? 'Active investigations' : 'No active incidents'}
          icon={<Flame className="h-5 w-5" style={{ color: 'var(--color-danger)' }} />}
          color="red"
        />
        <KPICard
          title="Overdue Mitigations"
          value={data.risk.mitigations_overdue}
          subtitle={data.risk.mitigations_overdue > 0 ? 'Requires action' : 'On track'}
          icon={<Clock className="h-5 w-5" style={{ color: 'var(--color-base)' }} />}
          color="purple"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(155, 28, 28, 0.08)' }}>
                <Target className="h-4 w-4" style={{ color: 'var(--color-danger)' }} />
              </div>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Risk Heatmap</h3>
            </div>
            <Link href="/erm/risks" className="text-xs flex items-center gap-1" style={{ color: 'var(--color-base)' }}>
              View all <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="p-5">
            <RiskHeatmap data={data.risk.heatmap} />
          </div>
        </div>

        <div className="rounded-xl overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(146, 87, 14, 0.08)' }}>
              <Layers className="h-4 w-4" style={{ color: 'var(--color-warning)' }} />
            </div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Risk by Category</h3>
          </div>
          <div className="p-5">
            {Object.keys(data.risk.by_category).length > 0 ? (
              <div className="space-y-3">
                {Object.entries(data.risk.by_category).slice(0, 6).map(([category, count]) => {
                  const total = Object.values(data.risk.by_category).reduce((a, b) => a + b, 0);
                  const percentage = total > 0 ? Math.round((count / total) * 100) : 0;
                  return (
                    <div key={category}>
                      <div className="flex justify-between items-center text-sm mb-1">
                        <span className="capitalize" style={{ color: 'var(--color-text)' }}>{category.replace(/_/g, ' ')}</span>
                        <span style={{ color: 'var(--color-muted)' }}>{count} ({percentage}%)</span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-subtle)' }}>
                        <div
                          className="h-full transition-all duration-300"
                          style={{ width: `${percentage}%`, backgroundColor: 'var(--color-warning)' }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <ChartEmptyState
                title="No risk categories yet"
                description="Risk categories will appear as risks are registered"
                icon={<Layers className="h-8 w-8" style={{ color: 'var(--color-muted)' }} />}
              />
            )}
          </div>
        </div>
      </div>

      <div className="rounded-xl overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3">
            <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
              <TrendingUp className="h-4 w-4" style={{ color: 'var(--color-base)' }} />
            </div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Risk Trend</h3>
          </div>
        </div>
        <div className="p-5">
          {riskTrendLabels.length > 0 ? (
            <TrendLine data={riskTrendLabels} color="#92570E" height={100} />
          ) : (
            <ChartEmptyState
              title="No risk trend data yet"
              description="Risk trends will populate as risk assessments are conducted over time"
              icon={<TrendingUp className="h-8 w-8" style={{ color: 'var(--color-muted)' }} />}
            />
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-xl p-4 text-center" style={{ border: '1px solid rgba(155, 28, 28, 0.2)', backgroundColor: 'rgba(155, 28, 28, 0.04)' }}>
          <p className="text-2xl font-semibold" style={{ color: 'var(--color-danger)' }}>{data.risk.by_score_range.critical}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Critical</p>
        </div>
        <div className="rounded-xl p-4 text-center" style={{ border: '1px solid rgba(146, 87, 14, 0.2)', backgroundColor: 'rgba(146, 87, 14, 0.04)' }}>
          <p className="text-2xl font-semibold" style={{ color: 'var(--color-warning)' }}>{data.risk.by_score_range.high}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>High</p>
        </div>
        <div className="rounded-xl p-4 text-center" style={{ border: '1px solid rgba(146, 87, 14, 0.15)', backgroundColor: 'rgba(146, 87, 14, 0.03)' }}>
          <p className="text-2xl font-semibold" style={{ color: 'var(--color-warning)' }}>{data.risk.by_score_range.medium}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Medium</p>
        </div>
        <div className="rounded-xl p-4 text-center" style={{ border: '1px solid rgba(45, 106, 79, 0.2)', backgroundColor: 'rgba(45, 106, 79, 0.04)' }}>
          <p className="text-2xl font-semibold" style={{ color: 'var(--color-success)' }}>{data.risk.by_score_range.low}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Low</p>
        </div>
      </div>
    </div>
  );
}
