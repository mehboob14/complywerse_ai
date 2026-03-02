'use client';

import Link from 'next/link';
import {
  FileText,
  Clock,
  CheckCircle,
  AlertCircle,
  ClipboardCheck,
  ChevronRight,
  BarChart3,
  Users,
  BookOpen,
  Scale,
} from 'lucide-react';
import {
  KPICard,
  StatusDistribution,
  ProgressBar,
  ChartEmptyState,
} from '@/components/charts';
import { formatTimeAgo } from './helpers';
import { UnifiedDashboard } from './types';

export default function GovernanceTab({ data }: { data: UnifiedDashboard }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KPICard
          title="Total Documents"
          value={data.governance.total_documents}
          icon={<FileText className="h-5 w-5" style={{ color: 'var(--color-base)' }} />}
          color="blue"
        />
        <KPICard
          title="Pending Approvals"
          value={data.governance.pending_approvals}
          subtitle={data.governance.pending_approvals > 0 ? 'Requires attention' : 'All clear'}
          icon={<ClipboardCheck className="h-5 w-5" style={{ color: 'var(--color-base)' }} />}
          color="purple"
        />
        <KPICard
          title="Expiring Soon"
          value={data.governance.expiring_30_days}
          subtitle="Within 30 days"
          icon={<Clock className="h-5 w-5" style={{ color: 'var(--color-warning)' }} />}
          color="amber"
        />
        <KPICard
          title="Overdue Reviews"
          value={data.governance.overdue_reviews}
          subtitle={data.governance.overdue_reviews > 0 ? 'Action required' : 'Up to date'}
          icon={<AlertCircle className="h-5 w-5" style={{ color: 'var(--color-danger)' }} />}
          color="red"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
              <BarChart3 className="h-4 w-4" style={{ color: 'var(--color-base)' }} />
            </div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Document Status</h3>
          </div>
          <div className="p-5">
            {Object.keys(data.governance.by_status).length > 0 ? (
              <StatusDistribution data={data.governance.by_status} />
            ) : (
              <ChartEmptyState
                title="No documents yet"
                description="Document status distribution will appear as policies are created"
                icon={<FileText className="h-8 w-8" style={{ color: 'var(--color-muted)' }} />}
              />
            )}
          </div>
        </div>

        <div className="rounded-xl overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-3">
              <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(45, 106, 79, 0.08)' }}>
                <BookOpen className="h-4 w-4" style={{ color: 'var(--color-success)' }} />
              </div>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Recent Publications</h3>
            </div>
            <Link href="/governance/documents" className="text-xs flex items-center gap-1" style={{ color: 'var(--color-base)' }}>
              View all <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="p-4">
            {data.governance.recent_publications.length > 0 ? (
              <div className="space-y-3">
                {data.governance.recent_publications.map((pub: any) => (
                  <Link
                    key={pub.id}
                    href={`/governance/documents`}
                    className="flex items-center gap-3 p-2 rounded-lg transition-colors group"
                  >
                    <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(45, 106, 79, 0.08)' }}>
                      <CheckCircle className="h-4 w-4" style={{ color: 'var(--color-success)' }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm truncate transition-colors" style={{ color: 'var(--color-text)' }}>
                        {pub.title}
                      </p>
                      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                        {pub.doc_type} • {pub.published_at ? formatTimeAgo(pub.published_at) : 'Recently'}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <ChartEmptyState
                title="No publications yet"
                description="Recently published documents will appear here"
                icon={<BookOpen className="h-8 w-8" style={{ color: 'var(--color-muted)' }} />}
              />
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
              <Users className="h-4 w-4" style={{ color: 'var(--color-base)' }} />
            </div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Attestation Campaigns</h3>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg p-4 text-center" style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}>
                <p className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>{data.attestations.active_campaigns}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Active Campaigns</p>
              </div>
              <div className="rounded-lg p-4 text-center" style={{ backgroundColor: 'var(--color-subtle)', border: '1px solid var(--color-border)' }}>
                <p className="text-2xl font-semibold" style={{ color: data.attestations.overdue > 0 ? 'var(--color-danger)' : 'var(--color-text)' }}>
                  {data.attestations.overdue}
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Overdue Responses</p>
              </div>
            </div>
            {data.attestations.completion_rate > 0 && (
              <div className="mt-4">
                <ProgressBar
                  value={data.attestations.completion_rate}
                  label="Completion Rate"
                  color={data.attestations.completion_rate >= 80 ? 'success' : 'warning'}
                />
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl overflow-hidden shadow-sm" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <div className="rounded-lg p-2" style={{ backgroundColor: 'rgba(146, 87, 14, 0.08)' }}>
              <Scale className="h-4 w-4" style={{ color: 'var(--color-warning)' }} />
            </div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Regulatory Changes</h3>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="text-center">
                <p className="text-xl font-semibold" style={{ color: 'var(--color-text)' }}>{data.regulatory_changes.total_changes}</p>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Total</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-semibold" style={{ color: 'var(--color-warning)' }}>{data.regulatory_changes.pending_review}</p>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Pending</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-semibold" style={{ color: data.regulatory_changes.high_impact > 0 ? 'var(--color-danger)' : 'var(--color-text)' }}>
                  {data.regulatory_changes.high_impact}
                </p>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>High Impact</p>
              </div>
            </div>
            {data.regulatory_changes.recent.length > 0 ? (
              <div className="space-y-2">
                {data.regulatory_changes.recent.slice(0, 3).map((change: any) => (
                  <div key={change.id} className="flex items-center justify-between p-2 rounded-lg" style={{ backgroundColor: 'var(--color-subtle)' }}>
                    <span className="text-sm truncate flex-1" style={{ color: 'var(--color-text)' }}>{change.title}</span>
                    <span
                      className="text-xs px-2 py-0.5 rounded"
                      style={{
                        backgroundColor: change.impact_level === 'high' || change.impact_level === 'critical'
                          ? 'rgba(155, 28, 28, 0.1)' : 'var(--color-subtle)',
                        color: change.impact_level === 'high' || change.impact_level === 'critical'
                          ? 'var(--color-danger)' : 'var(--color-muted)',
                      }}
                    >
                      {change.impact_level}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-center py-4" style={{ color: 'var(--color-muted)' }}>No recent regulatory changes</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
