'use client';

import Link from 'next/link';
import {
  Shield,
  FileText,
  Target,
  CheckCircle,
  ChevronRight,
} from 'lucide-react';
import {
  KPICard,
  TrendLine,
  ChartEmptyState,
} from '@/components/charts';
import { UnifiedDashboard } from './types';

export default function ComplianceTab({ data }: { data: UnifiedDashboard }) {
  const trendLabels = data.kpis.compliance_trend.map(t => ({ label: t.month, value: t.value }));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Frameworks Tracked"
          value={data.compliance.frameworks_tracked}
          icon={<Shield className="h-5 w-5" style={{ color: 'var(--color-base)' }} />}
          color="blue"
        />
        <KPICard
          title="Overall Maturity"
          value={`${data.compliance.overall_maturity}%`}
          icon={<Target className="h-5 w-5" style={{ color: 'var(--color-success)' }} />}
          color="green"
        />
        <KPICard
          title="Controls Implemented"
          value={`${data.compliance.controls_implemented}/${data.compliance.controls_total}`}
          subtitle={data.compliance.controls_total > 0 
            ? `${Math.round((data.compliance.controls_implemented / data.compliance.controls_total) * 100)}% complete`
            : 'No controls yet'}
          icon={<CheckCircle className="h-5 w-5" style={{ color: 'var(--color-base)' }} />}
          color="purple"
        />
        <KPICard
          title="Evidence Items"
          value={data.compliance.evidence_items}
          icon={<FileText className="h-5 w-5" style={{ color: 'var(--color-base)' }} />}
          color="cyan"
        />
      </div>

      <div className="rounded-xl overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3">
            <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
              <Shield className="h-4 w-4" style={{ color: 'var(--color-base)' }} />
            </div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Framework Coverage</h3>
          </div>
          <Link href="/frameworks" className="text-xs flex items-center gap-1" style={{ color: 'var(--color-base)' }}>
            View all <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="p-5">
          {data.compliance.framework_coverage.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {data.compliance.framework_coverage.map((framework) => (
                <div
                  key={framework.framework_id}
                  className="rounded-lg p-4 transition-colors"
                  style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium px-2 py-0.5 rounded" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)', color: 'var(--color-base)' }}>
                        {framework.short_code}
                      </span>
                    </div>
                    <span
                      className="text-sm px-2 py-0.5 rounded"
                      style={{
                        backgroundColor: framework.status === 'compliant'
                          ? 'rgba(45, 106, 79, 0.1)' : framework.status === 'partial'
                          ? 'rgba(146, 87, 14, 0.1)' : 'rgba(155, 28, 28, 0.1)',
                        color: framework.status === 'compliant'
                          ? 'var(--color-success)' : framework.status === 'partial'
                          ? 'var(--color-warning)' : 'var(--color-danger)',
                      }}
                    >
                      {framework.status}
                    </span>
                  </div>
                  <p className="text-sm font-medium mb-3 truncate" style={{ color: 'var(--color-text)' }} title={framework.name}>
                    {framework.name}
                  </p>
                  <div className="relative pt-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                        {framework.implemented_controls} / {framework.total_controls} controls
                      </span>
                      <span
                        className="text-sm font-semibold"
                        style={{
                          color: framework.score >= 80
                            ? 'var(--color-success)' : framework.score >= 60
                            ? 'var(--color-warning)' : 'var(--color-danger)',
                        }}
                      >
                        {framework.score}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-border)' }}>
                      <div
                        className="h-full transition-all duration-500"
                        style={{
                          width: `${framework.score}%`,
                          backgroundColor: framework.score >= 80
                            ? 'var(--color-success)' : framework.score >= 60
                            ? 'var(--color-warning)' : 'var(--color-danger)',
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <ChartEmptyState
              title="No frameworks yet"
              description="Upload regulatory frameworks to track compliance coverage"
              icon={<Shield className="h-8 w-8" style={{ color: 'var(--color-muted)' }} />}
            />
          )}
        </div>
      </div>

      <div className="rounded-xl overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(45, 106, 79, 0.08)' }}>
            <Target className="h-4 w-4" style={{ color: 'var(--color-success)' }} />
          </div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Compliance Trend</h3>
        </div>
        <div className="p-5">
          {trendLabels.length > 0 ? (
            <TrendLine data={trendLabels} color="#1C2B3A" height={100} />
          ) : (
            <ChartEmptyState
              title="No compliance trend data yet"
              description="Compliance trends will populate as assessments are completed over time"
              icon={<Target className="h-8 w-8" style={{ color: 'var(--color-muted)' }} />}
            />
          )}
        </div>
      </div>
    </div>
  );
}
