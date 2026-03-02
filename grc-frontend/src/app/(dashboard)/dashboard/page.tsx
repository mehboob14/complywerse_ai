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
            <div key={i} className="cw-card rounded-xl p-6">
              <div className="h-20 w-20 rounded-full skeleton mx-auto mb-4" />
              <div className="h-6 w-24 rounded skeleton mx-auto" />
            </div>
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="cw-card rounded-xl p-6">
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
    <div className="cw-dashboard dashboard-light space-y-6">
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title flex items-center gap-3">
              <div className="cw-icon-badge-base rounded-xl p-2.5">
                <Target className="h-6 w-6" />
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
                className="cw-btn-neutral flex items-center gap-2 rounded-lg px-4 py-2 text-sm transition-colors"
                onClick={() => {
                  const el = window.document.getElementById('export-dropdown');
                  if (el) el.classList.toggle('hidden');
                }}
              >
                <Download className="h-4 w-4" />
                Export Reports
              </button>
              <div id="export-dropdown" className="cw-dropdown hidden absolute right-0 mt-2 w-56 rounded-lg shadow-xl z-50">
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
                  className="cw-text-default w-full text-left px-4 py-2.5 text-sm transition-colors rounded-t-lg"
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
                  className="cw-text-default w-full text-left px-4 py-2.5 text-sm transition-colors rounded-b-lg"
                >
                  Audit Log (CSV)
                </button>
              </div>
            </div>
            <div className="cw-text-muted hidden lg:flex items-center gap-2 text-sm">
              <Clock className="h-4 w-4" />
              Last updated: {new Date().toLocaleTimeString()}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="cw-card rounded-xl p-5 transition-all duration-300 shadow-sm hover:shadow-md">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="cw-text-muted text-sm mb-1">Overall Compliance</p>
              <div className="flex items-baseline gap-2">
                <span className="cw-text-default text-3xl font-semibold">{data.executive_summary.overall_compliance_score}%</span>
                {data.executive_summary.trend === 'up' && (
                  <span className="cw-text-success flex items-center text-xs">
                    <TrendingUp className="h-3 w-3 mr-0.5" />improving
                  </span>
                )}
                {data.executive_summary.trend === 'down' && (
                  <span className="cw-text-danger flex items-center text-xs">
                    <TrendingDown className="h-3 w-3 mr-0.5" />declining
                  </span>
                )}
              </div>
              <p className="cw-text-muted text-xs mt-1">{data.compliance.frameworks_tracked} frameworks tracked</p>
            </div>
            <div className="cw-icon-badge-base rounded-xl p-3">
              <Shield className="h-6 w-6" />
            </div>
          </div>
          <div className="cw-progress-track mt-4 h-2 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${data.executive_summary.overall_compliance_score >= 80 ? 'cw-progress-fill-success' : data.executive_summary.overall_compliance_score >= 60 ? 'cw-progress-fill-warning' : 'cw-progress-fill-danger'}`}
              style={{
                width: `${data.executive_summary.overall_compliance_score}%`,
              }}
            />
          </div>
        </div>

        <div className="cw-card rounded-xl p-5 transition-all duration-300 shadow-sm hover:shadow-md">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="cw-text-muted text-sm mb-1">Risk Score</p>
              <div className="flex items-baseline gap-2">
                <span className={`text-3xl font-semibold ${data.executive_summary.risk_score <= 25 ? 'cw-text-success' : data.executive_summary.risk_score <= 75 ? 'cw-text-warning' : 'cw-text-danger'}`}>
                  {data.executive_summary.risk_score}
                </span>
                <span className="cw-text-muted text-xs">/ 100</span>
              </div>
              <p className="cw-text-muted text-xs mt-1">{data.risk.open_risks} open risks</p>
            </div>
            <div className="cw-icon-badge-warning rounded-xl p-3">
              <AlertTriangle className="h-6 w-6" />
            </div>
          </div>
          <div className="mt-4 flex gap-1">
            {['critical', 'high', 'medium', 'low'].map((level) => {
              const count = data.risk.by_score_range[level as keyof typeof data.risk.by_score_range] || 0;
              const colorClass: Record<string, string> = {
                critical: 'cw-progress-fill-danger',
                high: 'cw-progress-fill-warning',
                medium: 'cw-progress-fill-warning',
                low: 'cw-progress-fill-success',
              };
              return (
                <div key={level} className="flex-1 text-center">
                  <div className={`h-2 rounded-full mb-1 ${colorClass[level]} ${count > 0 ? 'opacity-100' : 'opacity-20'}`} />
                  <span className="cw-text-muted text-xs">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="cw-card rounded-xl p-5 transition-all duration-300 shadow-sm hover:shadow-md">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="cw-text-muted text-sm mb-1">Open Issues</p>
              <p className="cw-text-default text-3xl font-semibold">{data.risk.incidents_open}</p>
              <p className="cw-text-muted text-xs mt-1">
                {data.risk.mitigations_overdue > 0 ? (
                  <span className="cw-text-danger">{data.risk.mitigations_overdue} overdue mitigations</span>
                ) : (
                  'No overdue mitigations'
                )}
              </p>
            </div>
            <div className="cw-icon-badge-danger rounded-xl p-3">
              <Flame className="h-6 w-6" />
            </div>
          </div>
        </div>

        <div className="cw-card rounded-xl p-5 transition-all duration-300 shadow-sm hover:shadow-md">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <p className="cw-text-muted text-sm mb-1">Pending Actions</p>
              <p className="cw-text-default text-3xl font-semibold">{data.governance.pending_approvals}</p>
              <p className="cw-text-muted text-xs mt-1">
                {data.attestations.active_campaigns > 0 ? (
                  <span>{data.attestations.active_campaigns} active campaigns</span>
                ) : (
                  'No active campaigns'
                )}
              </p>
            </div>
            <div className="cw-icon-badge-base rounded-xl p-3">
              <ClipboardCheck className="h-6 w-6" />
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto border-b border-[var(--color-border)]">
        <nav className="flex gap-1 min-w-max" aria-label="Dashboard tabs">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`cw-tab flex items-center gap-1.5 px-3 py-3 text-sm font-medium transition-all duration-200 border-b-2 -mb-px whitespace-nowrap ${activeTab === tab.id ? 'cw-tab-active' : ''}`}
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
      <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-base)]" /></div>}>
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
