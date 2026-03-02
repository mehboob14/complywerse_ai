'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboardApi, governanceApi } from '@/lib/api';
import { lazy, Suspense } from 'react';
import {
  Shield,
  AlertTriangle,
  Clock,
  TrendingUp,
  TrendingDown,
  Target,
  Layers,
  ClipboardCheck,
  Flame,
  Download,
  Gavel,
  Brain,
  HeartPulse,
  Crosshair,
  Siren,
  FlaskConical,
  Scale,
} from 'lucide-react';
import { UnifiedDashboard, TabType } from './components/types';
import { getRiskScoreColor } from './components/helpers';
import OverviewTab from './components/OverviewTab';
import GovernanceTab from './components/GovernanceTab';
import RiskTab from './components/RiskTab';
import ComplianceTab from './components/ComplianceTab';

const ExecutiveRiskTab = lazy(() => import('./components/ExecutiveRiskTab'));
const ComplianceHealthTab = lazy(() => import('./components/ComplianceHealthTab'));
const RiskTreatmentTab = lazy(() => import('./components/RiskTreatmentTab'));
const IncidentDashTab = lazy(() => import('./components/IncidentDashTab'));
const ControlTestingTab = lazy(() => import('./components/ControlTestingTab'));
const RegulatoryImpactTab = lazy(() => import('./components/RegulatoryImpactTab'));

export default function UnifiedGRCDashboard() {
  const [activeTab, setActiveTab] = useState<TabType>('overview');

  const { data: dashboardData, isLoading, error } = useQuery({
    queryKey: ['unified-dashboard'],
    queryFn: async () => {
      const response = await dashboardApi.getUnified();
      return response.data as UnifiedDashboard;
    },
    refetchInterval: 60000,
  });

  if (isLoading) {
    return (
      <div className="space-y-8 animate-pulse">
        <div className="page-header">
          <div className="h-8 w-72 rounded skeleton" />
          <div className="h-5 w-96 rounded skeleton mt-2" />
        </div>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-xl p-6" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <div className="h-20 w-20 rounded-full skeleton mx-auto mb-4" />
              <div className="h-6 w-24 rounded skeleton mx-auto" />
            </div>
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl p-6" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <div className="h-6 w-32 rounded skeleton mb-4" />
              <div className="space-y-3">
                {[1, 2, 3].map((j) => (
                  <div key={j} className="h-12 rounded skeleton" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const data = dashboardData || {
    executive_summary: { overall_compliance_score: 0, risk_score: 0, open_issues: 0, pending_actions: 0, trend: 'stable' },
    governance: { total_documents: 0, by_status: {}, pending_approvals: 0, expiring_30_days: 0, overdue_reviews: 0, recent_publications: [] },
    risk: { total_risks: 0, open_risks: 0, by_category: {}, by_score_range: { critical: 0, high: 0, medium: 0, low: 0 }, avg_residual_score: 0, heatmap: [], incidents_open: 0, mitigations_overdue: 0 },
    compliance: { frameworks_tracked: 0, framework_coverage: [], overall_maturity: 0, controls_implemented: 0, controls_total: 0, evidence_items: 0 },
    attestations: { active_campaigns: 0, pending_responses: 0, completion_rate: 0, overdue: 0 },
    regulatory_changes: { total_changes: 0, pending_review: 0, high_impact: 0, recent: [] },
    upcoming_deadlines: [],
    recent_activity: [],
    kpis: { compliance_trend: [], risk_trend: [], evidence_trend: [] },
  } as UnifiedDashboard;

  const tabs: { id: TabType; label: string; icon: React.ElementType }[] = [
    { id: 'overview', label: 'Overview', icon: Layers },
    { id: 'governance', label: 'Governance', icon: Gavel },
    { id: 'risk', label: 'Risk', icon: AlertTriangle },
    { id: 'compliance', label: 'Compliance', icon: Shield },
    { id: 'executive', label: 'Executive Risk', icon: Brain },
    { id: 'compliance_health', label: 'Compliance Health', icon: HeartPulse },
    { id: 'treatment', label: 'Risk Treatment', icon: Crosshair },
    { id: 'incidents', label: 'Incidents', icon: Siren },
    { id: 'controls', label: 'Control Testing', icon: FlaskConical },
    { id: 'regulatory', label: 'Regulatory Impact', icon: Scale },
  ];

  return (
    <div className="space-y-6">
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title flex items-center gap-3">
              <div className="rounded-xl p-2.5" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
                <Target className="h-6 w-6" style={{ color: 'var(--color-base)' }} />
              </div>
              Unified GRC Dashboard
            </h1>
            <p className="page-description mt-1">
              Comprehensive view of Governance, Risk, and Compliance metrics
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative group">
              <button
                className="flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition-colors"
                style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                onClick={() => {
                  const el = window.document.getElementById('export-dropdown');
                  if (el) el.classList.toggle('hidden');
                }}
              >
                <Download className="h-4 w-4" />
                Export Reports
              </button>
              <div id="export-dropdown" className="hidden absolute right-0 mt-2 w-56 rounded-lg shadow-xl z-50" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <button
                  onClick={async () => {
                    try {
                      const response = await governanceApi.exportComplianceSummary();
                      const blob = new Blob([response.data], { type: 'text/csv' });
                      const url = window.URL.createObjectURL(blob);
                      const a = window.document.createElement('a');
                      a.href = url;
                      a.download = `compliance_summary_${new Date().toISOString().slice(0, 10)}.csv`;
                      window.document.body.appendChild(a);
                      a.click();
                      window.URL.revokeObjectURL(url);
                      window.document.body.removeChild(a);
                    } catch (e) { console.error('Export failed:', e); }
                    window.document.getElementById('export-dropdown')?.classList.add('hidden');
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm transition-colors rounded-t-lg"
                  style={{ color: 'var(--color-text)' }}
                >
                  Compliance Summary (CSV)
                </button>
                <button
                  onClick={async () => {
                    try {
                      const response = await governanceApi.exportAuditLog();
                      const blob = new Blob([response.data], { type: 'text/csv' });
                      const url = window.URL.createObjectURL(blob);
                      const a = window.document.createElement('a');
                      a.href = url;
                      a.download = `audit_log_${new Date().toISOString().slice(0, 10)}.csv`;
                      window.document.body.appendChild(a);
                      a.click();
                      window.URL.revokeObjectURL(url);
                      window.document.body.removeChild(a);
                    } catch (e) { console.error('Export failed:', e); }
                    window.document.getElementById('export-dropdown')?.classList.add('hidden');
                  }}
                  className="w-full text-left px-4 py-2.5 text-sm transition-colors rounded-b-lg"
                  style={{ color: 'var(--color-text)' }}
                >
                  Audit Log (CSV)
                </button>
              </div>
            </div>
            <div className="hidden lg:flex items-center gap-2 text-sm" style={{ color: 'var(--color-muted)' }}>
              <Clock className="h-4 w-4" />
              Last updated: {new Date().toLocaleTimeString()}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl p-5 transition-all duration-300 shadow-sm hover:shadow-md" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-sm mb-1" style={{ color: 'var(--color-muted)' }}>Overall Compliance</p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold" style={{ color: 'var(--color-text)' }}>{data.executive_summary.overall_compliance_score}%</span>
                {data.executive_summary.trend === 'up' && (
                  <span className="flex items-center text-xs" style={{ color: 'var(--color-success)' }}>
                    <TrendingUp className="h-3 w-3 mr-0.5" />improving
                  </span>
                )}
                {data.executive_summary.trend === 'down' && (
                  <span className="flex items-center text-xs" style={{ color: 'var(--color-danger)' }}>
                    <TrendingDown className="h-3 w-3 mr-0.5" />declining
                  </span>
                )}
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{data.compliance.frameworks_tracked} frameworks tracked</p>
            </div>
            <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
              <Shield className="h-6 w-6" style={{ color: 'var(--color-base)' }} />
            </div>
          </div>
          <div className="mt-4 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-subtle)' }}>
            <div
              className="h-full transition-all duration-500"
              style={{
                width: `${data.executive_summary.overall_compliance_score}%`,
                backgroundColor: data.executive_summary.overall_compliance_score >= 80
                  ? 'var(--color-success)'
                  : data.executive_summary.overall_compliance_score >= 60
                  ? 'var(--color-warning)'
                  : 'var(--color-danger)',
              }}
            />
          </div>
        </div>

        <div className="rounded-xl p-5 transition-all duration-300 shadow-sm hover:shadow-md" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-sm mb-1" style={{ color: 'var(--color-muted)' }}>Risk Score</p>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold" style={{ color: getRiskScoreColor(data.executive_summary.risk_score) }}>
                  {data.executive_summary.risk_score}
                </span>
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>/ 100</span>
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{data.risk.open_risks} open risks</p>
            </div>
            <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(146, 87, 14, 0.08)' }}>
              <AlertTriangle className="h-6 w-6" style={{ color: 'var(--color-warning)' }} />
            </div>
          </div>
          <div className="mt-4 flex gap-1">
            {['critical', 'high', 'medium', 'low'].map((level) => {
              const count = data.risk.by_score_range[level as keyof typeof data.risk.by_score_range] || 0;
              const colors: Record<string, string> = {
                critical: 'var(--color-danger)',
                high: 'var(--color-warning)',
                medium: 'var(--color-warning)',
                low: 'var(--color-success)',
              };
              return (
                <div key={level} className="flex-1 text-center">
                  <div className="h-2 rounded-full mb-1" style={{ backgroundColor: colors[level], opacity: count > 0 ? 1 : 0.2 }} />
                  <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl p-5 transition-all duration-300 shadow-sm hover:shadow-md" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-sm mb-1" style={{ color: 'var(--color-muted)' }}>Open Issues</p>
              <p className="text-3xl font-semibold" style={{ color: 'var(--color-text)' }}>{data.risk.incidents_open}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                {data.risk.mitigations_overdue > 0 ? (
                  <span style={{ color: 'var(--color-danger)' }}>{data.risk.mitigations_overdue} overdue mitigations</span>
                ) : (
                  'No overdue mitigations'
                )}
              </p>
            </div>
            <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(155, 28, 28, 0.08)' }}>
              <Flame className="h-6 w-6" style={{ color: 'var(--color-danger)' }} />
            </div>
          </div>
        </div>

        <div className="rounded-xl p-5 transition-all duration-300 shadow-sm hover:shadow-md" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="text-sm mb-1" style={{ color: 'var(--color-muted)' }}>Pending Actions</p>
              <p className="text-3xl font-semibold" style={{ color: 'var(--color-text)' }}>{data.governance.pending_approvals}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                {data.attestations.active_campaigns > 0 ? (
                  <span>{data.attestations.active_campaigns} active campaigns</span>
                ) : (
                  'No active campaigns'
                )}
              </p>
            </div>
            <div className="rounded-xl p-3" style={{ backgroundColor: 'rgba(28, 43, 58, 0.08)' }}>
              <ClipboardCheck className="h-6 w-6" style={{ color: 'var(--color-base)' }} />
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <nav className="flex gap-1 min-w-max" aria-label="Dashboard tabs">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="flex items-center gap-1.5 px-3 py-3 text-sm font-medium transition-all duration-200 border-b-2 -mb-px whitespace-nowrap"
                style={{
                  borderBottomColor: activeTab === tab.id ? 'var(--color-base)' : 'transparent',
                  color: activeTab === tab.id ? 'var(--color-base)' : 'var(--color-muted)',
                  backgroundColor: activeTab === tab.id ? 'rgba(28, 43, 58, 0.04)' : undefined,
                }}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>

      {activeTab === 'overview' && <OverviewTab data={data} />}
      {activeTab === 'governance' && <GovernanceTab data={data} />}
      {activeTab === 'risk' && <RiskTab data={data} />}
      {activeTab === 'compliance' && <ComplianceTab data={data} />}
      <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2" style={{ borderColor: 'var(--color-base)' }} /></div>}>
        {activeTab === 'executive' && <ExecutiveRiskTab />}
        {activeTab === 'compliance_health' && <ComplianceHealthTab />}
        {activeTab === 'treatment' && <RiskTreatmentTab />}
        {activeTab === 'incidents' && <IncidentDashTab />}
        {activeTab === 'controls' && <ControlTestingTab />}
        {activeTab === 'regulatory' && <RegulatoryImpactTab />}
      </Suspense>
    </div>
  );
}
