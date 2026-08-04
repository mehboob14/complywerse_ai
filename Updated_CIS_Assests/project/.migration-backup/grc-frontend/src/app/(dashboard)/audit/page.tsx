'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { auditApi } from '@/lib/api';
import Link from 'next/link';
import {
  ClipboardCheck,
  AlertTriangle,
  Calendar,
  TrendingUp,
  DollarSign,
  Shield,
  Eye,
  Clock,
  ArrowRight,
  CheckCircle,
  XCircle,
  AlertCircle,
  Activity,
  BarChart3,
  Target,
  Search,
  FileText,
  ChevronRight,
  Calculator,
  Sparkles,
  Loader2,
  X,
  ChevronDown,
  ChevronUp,
  Users,
  Zap,
  Info,
  Globe,
  Bell,
  ExternalLink,
} from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  planning: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  fieldwork: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  reporting: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  review: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  completed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  closed: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  draft: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
  approved: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  in_progress: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
  informational: '#6366f1',
};

const PIPELINE_STAGES = ['planning', 'fieldwork', 'reporting', 'review', 'completed'];

const RISK_RATING_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30' },
  high: { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30' },
  medium: { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30' },
  low: { bg: 'bg-green-500/20', text: 'text-green-400', border: 'border-green-500/30' },
};

const PRIORITY_STYLES: Record<string, string> = {
  immediate: 'bg-red-500/20 text-red-400 border-red-500/30',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  standard: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  low: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
};

const IMPACT_CATEGORY_LABELS: Record<string, { label: string; color: string }> = {
  cost_savings: { label: 'Cost Savings', color: '#22c55e' },
  revenue_protection: { label: 'Revenue Protection', color: '#3b82f6' },
  efficiency_gain: { label: 'Efficiency Gain', color: '#a855f7' },
  risk_reduction: { label: 'Risk Reduction', color: '#f59e0b' },
  compliance_penalty_avoided: { label: 'Penalty Avoided', color: '#ef4444' },
  unclassified: { label: 'Unclassified', color: '#64748b' },
};

function formatCurrency(val: number): string {
  if (val >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
  if (val >= 1000) return `$${(val / 1000).toFixed(1)}K`;
  return `$${val.toFixed(0)}`;
}

export default function AuditDashboardPage() {
  const [showSamplingCalc, setShowSamplingCalc] = useState(false);
  const [samplingForm, setSamplingForm] = useState({ population_size: '', confidence_level: '95', expected_error_rate: '5', tolerable_error_rate: '10', sampling_type: 'attribute' });
  const [samplingResult, setSamplingResult] = useState<any>(null);
  const [calculatingSample, setCalculatingSample] = useState(false);
  const [showMethodology, setShowMethodology] = useState(false);
  const [showUncoveredRisks, setShowUncoveredRisks] = useState(false);
  const [expandedEscalation, setExpandedEscalation] = useState<string | null>(null);

  const handleCalculateSample = async () => {
    if (!samplingForm.population_size) return;
    setCalculatingSample(true);
    setSamplingResult(null);
    try {
      const res = await auditApi.tools.samplingCalculator({
        population_size: parseInt(samplingForm.population_size),
        confidence_level: parseFloat(samplingForm.confidence_level),
        expected_error_rate: parseFloat(samplingForm.expected_error_rate),
        tolerable_error_rate: parseFloat(samplingForm.tolerable_error_rate),
        sampling_type: samplingForm.sampling_type,
      });
      setSamplingResult(res.data);
    } catch (err) { console.error('Sampling calculation failed:', err); }
    finally { setCalculatingSample(false); }
  };

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['audit-kpis'],
    queryFn: () => auditApi.reporting.getKPIs().then(r => r.data),
  });

  const { data: coverage, isLoading: coverageLoading } = useQuery({
    queryKey: ['audit-coverage'],
    queryFn: () => auditApi.universe.getCoverageGaps().then(r => r.data),
  });

  const { data: engagements, isLoading: engagementsLoading } = useQuery({
    queryKey: ['audit-engagements'],
    queryFn: () => auditApi.engagements.getAll().then(r => r.data?.engagements || r.data || []),
  });

  const { data: ccmStats, isLoading: ccmLoading } = useQuery({
    queryKey: ['ccm-stats'],
    queryFn: () => auditApi.ccm.getStats().then(r => r.data),
  });

  const { data: findings } = useQuery({
    queryKey: ['audit-findings'],
    queryFn: () => auditApi.findings.getAll().then(r => r.data?.findings || r.data || []),
  });

  const { data: riskPrioritization } = useQuery({
    queryKey: ['audit-risk-prioritization'],
    queryFn: () => auditApi.reporting.getRiskPrioritization().then(r => r.data?.risk_prioritization || r.data || {}),
  });

  const { data: accountability } = useQuery({
    queryKey: ['audit-accountability'],
    queryFn: () => auditApi.reporting.getAccountability().then(r => r.data?.accountability || r.data || {}),
  });

  const { data: roiMetrics } = useQuery({
    queryKey: ['audit-roi-metrics'],
    queryFn: () => auditApi.reporting.getROIMetrics().then(r => r.data?.roi_metrics || r.data || {}),
  });

  const { data: regImpactTracker } = useQuery({
    queryKey: ['audit-regulatory-impact-tracker'],
    queryFn: () => auditApi.reporting.getRegulatoryImpactTracker().then(r => r.data?.regulatory_impact_tracker || r.data || {}),
  });

  const [expandedRegAction, setExpandedRegAction] = useState<number | null>(null);

  const findingsBySeverity = (() => {
    if (!findings || !Array.isArray(findings)) return [];
    const counts: Record<string, number> = {};
    findings.forEach((f: any) => {
      const sev = (f.severity || f.rating || 'medium').toLowerCase();
      counts[sev] = (counts[sev] || 0) + 1;
    });
    const maxCount = Math.max(...Object.values(counts), 1);
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([severity, count]) => ({
        severity,
        count,
        percentage: Math.round((count / maxCount) * 100),
        color: SEVERITY_COLORS[severity] || '#94a3b8',
      }));
  })();

  const activeEngagements = Array.isArray(engagements)
    ? engagements.filter((e: any) => e.status !== 'completed' && e.status !== 'closed')
    : [];

  const engagementsByStage = (() => {
    if (!Array.isArray(engagements)) return {};
    const grouped: Record<string, number> = {};
    PIPELINE_STAGES.forEach(s => { grouped[s] = 0; });
    engagements.forEach((e: any) => {
      const status = (e.status || 'planning').toLowerCase();
      if (grouped[status] !== undefined) grouped[status]++;
      else grouped['planning']++;
    });
    return grouped;
  })();

  const isLoading = kpisLoading && coverageLoading && engagementsLoading;

  if (isLoading) {
    return (
      <div className="space-y-8">
        <div>
          <div className="h-8 w-64 bg-slate-800 rounded animate-pulse mb-2" />
          <div className="h-5 w-96 bg-slate-800 rounded animate-pulse" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="rounded-xl border border-slate-700/50 bg-slate-800 p-5 shadow-lg">
              <div className="h-10 w-10 bg-slate-700 rounded-lg animate-pulse mb-3" />
              <div className="h-8 w-20 bg-slate-700 rounded animate-pulse mb-2" />
              <div className="h-4 w-32 bg-slate-700 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const closureRate = kpis?.findings_closure_rate ?? kpis?.closure_rate ?? 0;
  const overdueFindings = kpis?.overdue_findings ?? 0;
  const activeCount = activeEngagements.length;
  const planCompletion = kpis?.plan_completion_percentage ?? kpis?.plan_completion ?? 0;
  const budgetUtil = kpis?.budget_utilization ?? 0;

  const rp = riskPrioritization || {} as any;
  const heatMap = rp.risk_heat_map || {};
  const prioritizedEntities = rp.prioritized_entities || [];
  const uncoveredRisks = rp.uncovered_risks || [];
  const methodology = rp.risk_scoring_methodology || {};

  const acc = accountability || {} as any;
  const accScore = acc.accountability_score ?? 0;
  const ownerStats = acc.owner_stats || [];
  const escalation = acc.escalation_summary || {};
  const deptPerf = acc.department_performance || [];
  const overdueTrend = acc.overdue_trend || {};

  const roi = roiMetrics || {} as any;
  const impactByCategory = roi.impact_by_category || {};
  const valueByEngagement = roi.value_by_engagement || [];
  const recTracking = roi.recommendation_value_tracking || {};
  const effMetrics = roi.efficiency_metrics || {};

  const accScoreColor = accScore >= 80 ? 'text-emerald-400' : accScore >= 60 ? 'text-yellow-400' : accScore >= 40 ? 'text-orange-400' : 'text-red-400';
  const accScoreBorder = accScore >= 80 ? 'border-emerald-500/50' : accScore >= 60 ? 'border-yellow-500/50' : accScore >= 40 ? 'border-orange-500/50' : 'border-red-500/50';

  return (
    <div className="space-y-6 audit-light">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Audit Management</h1>
          <p className="text-slate-400 mt-1">Monitor audit engagements, findings, coverage and quality</p>
        </div>
        <div className="flex gap-2">
          <Link href="/audit/plans" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 border border-slate-700/50 text-slate-300 hover:text-white hover:border-slate-600 transition-all text-sm">
            <Calendar className="h-4 w-4" />
            Audit Plans
          </Link>
          <Link href="/audit/engagements" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-all text-sm">
            <ClipboardCheck className="h-4 w-4" />
            New Engagement
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-5 shadow-lg hover:border-emerald-500/50 transition-all">
          <div className="flex items-center justify-between mb-3">
            <div className="h-10 w-10 rounded-lg flex items-center justify-center">
              <CheckCircle className="h-5 w-5 text-emerald-400" />
            </div>
            <span className="text-xs font-medium text-emerald-400">{closureRate}%</span>
          </div>
          <p className="text-2xl font-bold text-white">{closureRate}%</p>
          <p className="text-sm text-slate-400 mt-1">Findings Closure Rate</p>
        </div>

        <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-5 shadow-lg hover:border-rose-500/50 transition-all">
          <div className="flex items-center justify-between mb-3">
            <div className="h-10 w-10 rounded-lg flex items-center justify-center">
              <AlertTriangle className="h-5 w-5 text-rose-400" />
            </div>
            {overdueFindings > 0 && (
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500 animate-pulse" />
            )}
          </div>
          <p className="text-2xl font-bold text-white">{overdueFindings}</p>
          <p className="text-sm text-slate-400 mt-1">Overdue Findings</p>
        </div>

        <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-5 shadow-lg hover:border-blue-500/50 transition-all">
          <div className="flex items-center justify-between mb-3">
            <div className="h-10 w-10 rounded-lg flex items-center justify-center">
              <Activity className="h-5 w-5 text-blue-400" />
            </div>
          </div>
          <p className="text-2xl font-bold text-white">{activeCount}</p>
          <p className="text-sm text-slate-400 mt-1">Active Engagements</p>
        </div>

        <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-5 shadow-lg hover:border-amber-500/50 transition-all">
          <div className="flex items-center justify-between mb-3">
            <div className="h-10 w-10 rounded-lg flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-amber-400" />
            </div>
          </div>
          <p className="text-2xl font-bold text-white">{planCompletion}%</p>
          <p className="text-sm text-slate-400 mt-1">Plan Completion</p>
        </div>

        <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-5 shadow-lg hover:border-purple-500/50 transition-all">
          <div className="flex items-center justify-between mb-3">
            <div className="h-10 w-10 rounded-lg flex items-center justify-center">
              <DollarSign className="h-5 w-5 text-purple-400" />
            </div>
          </div>
          <p className="text-2xl font-bold text-white">{budgetUtil}%</p>
          <p className="text-sm text-slate-400 mt-1">Budget Utilization</p>
        </div>
      </div>

      {(() => {
        const rit = regImpactTracker || {} as any;
        const impactSummary = rit.impact_summary || {};
        const pendingChanges = rit.pending_changes || [];
        const actionsNeeded = rit.audit_actions_needed || [];
        const recentlyCompleted = rit.recently_completed || [];
        const totalActive = impactSummary.total_active_changes || 0;
        const withoutCoverage = impactSummary.changes_without_coverage || 0;
        const coveragePct = impactSummary.coverage_percentage ?? 100;
        const criticalUncovered = actionsNeeded.filter((a: any) => a.priority === 'critical' || a.priority === 'high').length;
        const pendingFeedItems = rit.pending_feed_items || {};
        const totalUnprocessed = pendingFeedItems.total_unprocessed || 0;

        if (totalActive === 0 && pendingChanges.length === 0 && totalUnprocessed === 0) {
          return (
            <div className="rounded-xl border border-slate-700/50 bg-slate-800 shadow-lg overflow-hidden">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Globe className="h-5 w-5 text-blue-400" />
                    Regulatory Change Impact
                  </h2>
                </div>
                <div className="bg-slate-900/50 border border-slate-700/30 rounded-lg p-4 flex items-start gap-3">
                  <Info className="h-5 w-5 text-slate-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-white">No active regulatory impact items right now.</p>
                    <p className="text-xs text-slate-400 mt-1">When feeds are processed or linked changes are active, impact insights will appear here.</p>
                    <Link
                      href="/governance/regulatory-feeds"
                      className="inline-flex items-center gap-1 mt-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      Open Regulatory Feeds <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          );
        }

        if (totalActive === 0 && pendingChanges.length === 0 && totalUnprocessed > 0) {
          return (
            <div className="rounded-xl border border-slate-700/50 bg-slate-800 shadow-lg overflow-hidden">
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Globe className="h-5 w-5 text-blue-400" />
                    Regulatory Change Impact
                  </h2>
                </div>
                <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 flex items-start gap-3">
                  <Bell className="h-5 w-5 text-blue-400 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-blue-300">
                      {totalUnprocessed} regulatory feed item{totalUnprocessed > 1 ? 's' : ''} pending processing
                    </p>
                    <p className="text-xs text-slate-400 mt-1">
                      {pendingFeedItems.new_count > 0 && `${pendingFeedItems.new_count} new (awaiting analysis)`}
                      {pendingFeedItems.new_count > 0 && pendingFeedItems.analyzed_count > 0 && ' · '}
                      {pendingFeedItems.analyzed_count > 0 && `${pendingFeedItems.analyzed_count} analyzed (ready to convert)`}
                    </p>
                    <Link
                      href="/governance/regulatory-feeds"
                      className="inline-flex items-center gap-1 mt-2 text-sm text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      Go to Regulatory Feeds to process them <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          );
        }

        return (
          <div className="rounded-xl border border-slate-700/50 bg-slate-800 shadow-lg overflow-hidden">
            {criticalUncovered > 0 && (
              <div className="bg-gradient-to-r from-red-500/10 to-amber-500/10 border-b border-red-500/20 px-6 py-3 flex items-center gap-3">
                <Bell className="h-5 w-5 text-red-400 animate-pulse" />
                <span className="text-sm font-medium text-red-300">
                  {criticalUncovered} high/critical regulatory change{criticalUncovered > 1 ? 's' : ''} require{criticalUncovered === 1 ? 's' : ''} audit attention
                </span>
                <Link href="/audit/plans" className="ml-auto text-xs text-red-400 hover:text-red-300 flex items-center gap-1">
                  Go to Audit Plans <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            )}
            <div className="p-6">
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                    <Globe className="h-5 w-5 text-blue-400" />
                    Regulatory Change Impact
                  </h2>
                  <p className="text-sm text-slate-400">Active regulatory changes and their audit coverage status</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-xs text-slate-500 uppercase tracking-wide">Coverage</p>
                    <p className={`text-lg font-bold ${coveragePct >= 80 ? 'text-emerald-400' : coveragePct >= 50 ? 'text-yellow-400' : 'text-red-400'}`}>{coveragePct}%</p>
                  </div>
                  <div className="w-24 h-2 bg-slate-700 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${coveragePct >= 80 ? 'bg-emerald-500' : coveragePct >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${Math.min(coveragePct, 100)}%` }} />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3 mb-5">
                <div className="bg-slate-900/50 rounded-lg p-3 text-center border border-slate-700/30">
                  <p className="text-xl font-bold text-white">{totalActive}</p>
                  <p className="text-xs text-slate-400">Active Changes</p>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-3 text-center border border-slate-700/30">
                  <p className="text-xl font-bold text-emerald-400">{impactSummary.changes_with_audit_coverage || 0}</p>
                  <p className="text-xs text-slate-400">With Coverage</p>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-3 text-center border border-slate-700/30">
                  <p className={`text-xl font-bold ${withoutCoverage > 0 ? 'text-red-400' : 'text-slate-400'}`}>{withoutCoverage}</p>
                  <p className="text-xs text-slate-400">Gaps</p>
                </div>
                <div className="bg-slate-900/50 rounded-lg p-3 text-center border border-slate-700/30">
                  <p className="text-xl font-bold text-blue-400">{recentlyCompleted.length}</p>
                  <p className="text-xs text-slate-400">Recently Closed</p>
                </div>
              </div>

              {pendingChanges.length > 0 && (
                <div className="mb-5">
                  <h3 className="text-sm font-medium text-slate-300 mb-3">Active Regulatory Changes</h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-700/50">
                          <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 uppercase">Change</th>
                          <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 uppercase">Source</th>
                          <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 uppercase">Priority</th>
                          <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 uppercase">Effective</th>
                          <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 uppercase">Coverage</th>
                          <th className="text-left py-2 px-3 text-xs font-medium text-slate-500 uppercase">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pendingChanges.slice(0, 8).map((rc: any) => {
                          const daysUntil = rc.days_until_effective;
                          const urgent = daysUntil !== null && daysUntil < 30;
                          return (
                            <tr key={rc.id} className="border-b border-slate-700/20 hover:bg-slate-700/20 transition-colors">
                              <td className="py-2.5 px-3">
                                <p className="text-white font-medium truncate max-w-[240px]">{rc.title}</p>
                                {rc.gap_count > 0 && <span className="text-xs text-amber-400">{rc.gap_count} gap(s) identified</span>}
                              </td>
                              <td className="py-2.5 px-3 text-slate-400">{rc.source}</td>
                              <td className="py-2.5 px-3">
                                <span className={`px-2 py-0.5 rounded text-xs font-medium ${rc.priority === 'critical' ? 'bg-red-500/20 text-red-400' : rc.priority === 'high' ? 'bg-orange-500/20 text-orange-400' : rc.priority === 'medium' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-slate-500/20 text-slate-400'}`}>
                                  {rc.priority}
                                </span>
                              </td>
                              <td className="py-2.5 px-3">
                                {rc.effective_date ? (
                                  <span className={urgent ? 'text-red-400 font-medium' : 'text-slate-300'}>
                                    {new Date(rc.effective_date).toLocaleDateString()}
                                    {daysUntil !== null && <span className="text-xs ml-1">({daysUntil}d)</span>}
                                  </span>
                                ) : <span className="text-slate-500">TBD</span>}
                              </td>
                              <td className="py-2.5 px-3">
                                {rc.has_audit_coverage ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-emerald-500/20 text-emerald-400"><CheckCircle className="h-3 w-3" />Covered</span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-red-500/20 text-red-400"><AlertCircle className="h-3 w-3" />Gap</span>
                                )}
                              </td>
                              <td className="py-2.5 px-3">
                                <span className="text-xs text-slate-400 capitalize">{rc.status?.replace('_', ' ')}</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {actionsNeeded.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-red-300 mb-3 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    Audit Actions Needed ({actionsNeeded.length})
                  </h3>
                  <div className="space-y-2">
                    {actionsNeeded.map((action: any) => (
                      <div key={action.id} className="bg-red-500/5 border border-red-500/20 rounded-lg overflow-hidden">
                        <button
                          onClick={() => setExpandedRegAction(expandedRegAction === action.id ? null : action.id)}
                          className="w-full flex items-center justify-between p-3 text-left hover:bg-red-500/10 transition-colors"
                        >
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <span className={`px-2 py-0.5 rounded text-xs font-medium ${action.recommended_action === 'new_engagement' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'}`}>
                              {(action.recommended_action || '').replace('_', ' ')}
                            </span>
                            <span className="text-sm text-white truncate">{action.title}</span>
                            <span className={`px-2 py-0.5 rounded text-xs ${action.priority === 'critical' ? 'bg-red-500/20 text-red-400' : 'bg-orange-500/20 text-orange-400'}`}>{action.priority}</span>
                          </div>
                          {expandedRegAction === action.id ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                        </button>
                        {expandedRegAction === action.id && (
                          <div className="px-3 pb-3 space-y-2">
                            <p className="text-sm text-slate-300">{action.rationale}</p>
                            {action.audit_impact_analysis && (
                              <div className="bg-slate-900/50 rounded-lg p-3 space-y-2 mt-2">
                                <p className="text-xs font-medium text-purple-300 flex items-center gap-1"><Sparkles className="h-3 w-3" />AI Impact Assessment</p>
                                <p className="text-xs text-slate-400">{action.audit_impact_analysis.overall_impact_summary}</p>
                                {action.audit_impact_analysis.suggested_new_audits?.length > 0 && (
                                  <div className="mt-2">
                                    <p className="text-xs font-medium text-slate-300 mb-1">Suggested Audits:</p>
                                    {action.audit_impact_analysis.suggested_new_audits.map((sa: any, idx: number) => (
                                      <div key={idx} className="flex items-center gap-2 text-xs text-slate-400 py-0.5">
                                        <ArrowRight className="h-3 w-3 text-purple-400" />
                                        <span className="text-white">{sa.name}</span>
                                        <span className={`px-1.5 py-0.5 rounded ${sa.priority === 'critical' ? 'bg-red-500/20 text-red-400' : sa.priority === 'high' ? 'bg-orange-500/20 text-orange-400' : 'bg-blue-500/20 text-blue-400'}`}>{sa.priority}</span>
                                        <span className="text-slate-500">({sa.suggested_quarter})</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                            <Link href="/audit/plans" className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 mt-1">
                              Create Plan Item <ExternalLink className="h-3 w-3" />
                            </Link>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-6 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Coverage Gaps</h2>
              <p className="text-sm text-slate-400">Audit universe coverage analysis</p>
            </div>
            <Link href="/audit/universe" className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1">
              View All <ChevronRight className="h-3 w-3" />
            </Link>
          </div>

          {coverageLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-16 bg-slate-700/50 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-4">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-rose-500/20 flex items-center justify-center">
                    <XCircle className="h-4 w-4 text-rose-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">Never Audited</p>
                    <p className="text-xs text-slate-400">Entities with no audit history</p>
                  </div>
                  <span className="text-xl font-bold text-rose-400">
                    {coverage?.never_audited?.length ?? coverage?.never_audited_count ?? 0}
                  </span>
                </div>
              </div>

              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-amber-500/20 flex items-center justify-center">
                    <Clock className="h-4 w-4 text-amber-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">Overdue</p>
                    <p className="text-xs text-slate-400">Past scheduled audit date</p>
                  </div>
                  <span className="text-xl font-bold text-amber-400">
                    {coverage?.overdue?.length ?? coverage?.overdue_count ?? 0}
                  </span>
                </div>
              </div>

              <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-blue-500/20 flex items-center justify-center">
                    <Calendar className="h-4 w-4 text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-white">Upcoming</p>
                    <p className="text-xs text-slate-400">Scheduled in next 90 days</p>
                  </div>
                  <span className="text-xl font-bold text-blue-400">
                    {coverage?.upcoming?.length ?? coverage?.upcoming_count ?? 0}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="lg:col-span-2 rounded-xl border border-slate-700/50 bg-slate-800 p-6 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Engagement Pipeline</h2>
              <p className="text-sm text-slate-400">Status distribution of audit engagements</p>
            </div>
            <Link href="/audit/engagements" className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1">
              View All <ChevronRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="flex items-end gap-1 mb-6 h-24">
            {PIPELINE_STAGES.map((stage) => {
              const count = engagementsByStage[stage] || 0;
              const total = Array.isArray(engagements) ? engagements.length : 1;
              const heightPct = total > 0 ? Math.max((count / total) * 100, 4) : 4;
              const colors: Record<string, string> = {
                planning: '#3b82f6',
                fieldwork: '#f59e0b',
                reporting: '#a855f7',
                review: '#06b6d4',
                completed: '#22c55e',
              };
              return (
                <div key={stage} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-sm font-bold text-white">{count}</span>
                  <div
                    className="w-full rounded-t-md transition-all"
                    style={{
                      height: `${heightPct}%`,
                      backgroundColor: colors[stage] || '#6366f1',
                      minHeight: '4px',
                    }}
                  />
                  <span className="text-[10px] text-slate-400 capitalize mt-1">{stage}</span>
                </div>
              );
            })}
          </div>

          <div className="border-t border-slate-700/50 pt-4">
            <h3 className="text-sm font-medium text-slate-300 mb-3">Active Engagements</h3>
            {engagementsLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-12 bg-slate-700/50 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : activeEngagements.length > 0 ? (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {activeEngagements.slice(0, 6).map((eng: any) => (
                  <Link
                    key={eng.id}
                    href={`/audit/engagements`}
                    className="flex items-center justify-between p-3 rounded-lg bg-slate-900/50 border border-slate-700/30 hover:border-slate-600 transition-all group"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                        <FileText className="h-4 w-4 text-blue-400" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-white truncate">{eng.title || eng.name}</p>
                        <p className="text-xs text-slate-500">{eng.audit_type || eng.engagement_type || 'General'}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_COLORS[eng.status] || STATUS_COLORS.planning}`}>
                        {eng.status}
                      </span>
                      <ArrowRight className="h-3 w-3 text-slate-500 group-hover:text-blue-400 transition-colors" />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <Search className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-500">No active engagements</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-6 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Findings by Severity</h2>
              <p className="text-sm text-slate-400">Distribution of audit findings</p>
            </div>
            <Link href="/audit/findings" className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1">
              View All <ChevronRight className="h-3 w-3" />
            </Link>
          </div>

          {findingsBySeverity.length > 0 ? (
            <div className="space-y-3">
              {findingsBySeverity.map(({ severity, count, percentage, color }) => (
                <div key={severity} className="group">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-slate-300 capitalize">{severity}</span>
                    <span className="text-sm font-bold text-white">{count}</span>
                  </div>
                  <div className="h-3 w-full bg-slate-900/50 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500 group-hover:opacity-80"
                      style={{
                        width: `${percentage}%`,
                        backgroundColor: color,
                        minWidth: count > 0 ? '8px' : '0',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <BarChart3 className="h-8 w-8 text-slate-600 mx-auto mb-2" />
              <p className="text-sm text-slate-500">No findings data available</p>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-6 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Continuous Controls Monitoring</h2>
              <p className="text-sm text-slate-400">CCM rules and anomaly detection</p>
            </div>
            <Link href="/audit/ccm" className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1">
              Manage <ChevronRight className="h-3 w-3" />
            </Link>
          </div>

          {ccmLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-16 bg-slate-700/50 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-700/30 bg-slate-900/50 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="h-4 w-4 text-blue-400" />
                  <span className="text-xs text-slate-400">Active Rules</span>
                </div>
                <p className="text-2xl font-bold text-white">{ccmStats?.active_rules ?? ccmStats?.total_rules ?? 0}</p>
              </div>

              <div className="rounded-lg border border-slate-700/30 bg-slate-900/50 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <AlertCircle className="h-4 w-4 text-rose-400" />
                  <span className="text-xs text-slate-400">Open Anomalies</span>
                </div>
                <p className="text-2xl font-bold text-white">{ccmStats?.open_anomalies ?? ccmStats?.unreviewed_anomalies ?? 0}</p>
              </div>

              <div className="rounded-lg border border-slate-700/30 bg-slate-900/50 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Eye className="h-4 w-4 text-amber-400" />
                  <span className="text-xs text-slate-400">Pending Review</span>
                </div>
                <p className="text-2xl font-bold text-white">{ccmStats?.pending_review ?? 0}</p>
              </div>

              <div className="rounded-lg border border-slate-700/30 bg-slate-900/50 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Target className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs text-slate-400">Coverage</span>
                </div>
                <p className="text-2xl font-bold text-white">{ccmStats?.coverage_percentage ?? ccmStats?.controls_monitored ?? 0}{typeof ccmStats?.coverage_percentage === 'number' ? '%' : ''}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ===== RISK-BASED PRIORITIZATION (T004) ===== */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-6 shadow-lg">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Shield className="h-5 w-5 text-blue-400" />
              Risk-Based Audit Prioritization
            </h2>
            <p className="text-sm text-slate-400 mt-0.5">Prioritize audits based on business impact and exposure</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowMethodology(!showMethodology)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700/50 border border-slate-600/50 text-slate-300 hover:text-white text-xs transition-all"
            >
              <Info className="h-3.5 w-3.5" />
              Methodology
            </button>
            <Link href="/audit/plans" className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1">
              Plans <ChevronRight className="h-3 w-3" />
            </Link>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          {(['critical', 'high', 'medium', 'low'] as const).map((level) => {
            const style = RISK_RATING_STYLES[level];
            const count = heatMap[level] ?? 0;
            return (
              <div key={level} className={`rounded-lg border ${style.border} ${style.bg} p-4`}>
                <p className={`text-xs font-medium ${style.text} uppercase tracking-wide mb-1`}>{level}</p>
                <p className="text-2xl font-bold text-white">{count}</p>
                <p className="text-xs text-slate-400">entities</p>
              </div>
            );
          })}
        </div>

        <div className="grid gap-4 lg:grid-cols-3 mb-5">
          <div className="rounded-lg border border-slate-700/30 bg-slate-900/50 p-4">
            <p className="text-xs text-slate-400 mb-2">Risk Coverage (Critical/High)</p>
            <div className="flex items-end gap-2 mb-2">
              <p className="text-2xl font-bold text-white">{rp.risk_coverage_pct ?? 0}%</p>
              <p className="text-xs text-slate-500 pb-1">{rp.covered_critical_high ?? 0} / {rp.total_critical_high ?? 0} risks</p>
            </div>
            <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${Math.min(rp.risk_coverage_pct ?? 0, 100)}%` }} />
            </div>
          </div>

          <div className="rounded-lg border border-slate-700/30 bg-slate-900/50 p-4">
            <p className="text-xs text-slate-400 mb-2">Risk Appetite Alignment</p>
            <div className="flex items-end gap-2 mb-2">
              <p className="text-2xl font-bold text-white">{rp.risk_appetite_alignment_pct ?? 0}%</p>
              <p className="text-xs text-slate-500 pb-1">critical entities audited (12mo)</p>
            </div>
            <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${Math.min(rp.risk_appetite_alignment_pct ?? 0, 100)}%` }} />
            </div>
          </div>

          <div className="rounded-lg border border-slate-700/30 bg-slate-900/50 p-4">
            <p className="text-xs text-slate-400 mb-2">Plan Risk Alignment Score</p>
            <p className="text-2xl font-bold text-white">{rp.plan_risk_alignment_score ?? 'N/A'}</p>
            <p className="text-xs text-slate-500">avg entity risk score in plan</p>
          </div>
        </div>

        {uncoveredRisks.length > 0 && (
          <div className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
            <button
              onClick={() => setShowUncoveredRisks(!showUncoveredRisks)}
              className="w-full flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-400" />
                <span className="text-sm font-medium text-amber-300">{uncoveredRisks.length} Uncovered Critical/High Risks</span>
              </div>
              {showUncoveredRisks ? <ChevronUp className="h-4 w-4 text-amber-400" /> : <ChevronDown className="h-4 w-4 text-amber-400" />}
            </button>
            {showUncoveredRisks && (
              <div className="mt-3 space-y-2">
                {uncoveredRisks.slice(0, 10).map((r: any) => (
                  <div key={r.risk_id} className="flex items-center justify-between p-2 rounded bg-slate-900/50">
                    <div>
                      <p className="text-sm text-white">{r.title}</p>
                      <p className="text-xs text-slate-400">{r.category}</p>
                    </div>
                    <span className="text-sm font-bold text-amber-400">{r.residual_score ?? r.inherent_score}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {prioritizedEntities.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-slate-300 mb-3">Prioritized Audit Queue</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700/50">
                    <th className="text-left py-2 px-3 text-xs font-medium text-slate-400">Entity</th>
                    <th className="text-center py-2 px-3 text-xs font-medium text-slate-400">Risk Score</th>
                    <th className="text-center py-2 px-3 text-xs font-medium text-slate-400">Rating</th>
                    <th className="text-center py-2 px-3 text-xs font-medium text-slate-400">Last Audit</th>
                    <th className="text-center py-2 px-3 text-xs font-medium text-slate-400">Days Since</th>
                    <th className="text-center py-2 px-3 text-xs font-medium text-slate-400">In Plan</th>
                    <th className="text-center py-2 px-3 text-xs font-medium text-slate-400">Priority</th>
                  </tr>
                </thead>
                <tbody>
                  {prioritizedEntities.slice(0, 10).map((e: any) => {
                    const ratingStyle = RISK_RATING_STYLES[e.risk_rating] || RISK_RATING_STYLES.low;
                    const prioStyle = PRIORITY_STYLES[e.recommended_priority] || PRIORITY_STYLES.standard;
                    return (
                      <tr key={e.entity_id} className="border-b border-slate-700/20 hover:bg-slate-700/20">
                        <td className="py-2.5 px-3">
                          <p className="text-white font-medium">{e.name}</p>
                          <p className="text-xs text-slate-500">{e.entity_type}</p>
                        </td>
                        <td className="py-2.5 px-3 text-center font-bold text-white">{e.risk_score ?? '-'}</td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${ratingStyle.bg} ${ratingStyle.text} ${ratingStyle.border} capitalize`}>
                            {e.risk_rating}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center text-slate-300 text-xs">
                          {e.last_audit_date ? new Date(e.last_audit_date).toLocaleDateString() : 'Never'}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={`text-sm font-bold ${e.days_since_audit && e.days_since_audit > 365 ? 'text-red-400' : e.days_since_audit ? 'text-slate-300' : 'text-amber-400'}`}>
                            {e.days_since_audit ?? 'N/A'}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          {e.in_current_plan ? (
                            <CheckCircle className="h-4 w-4 text-emerald-400 mx-auto" />
                          ) : (
                            <XCircle className="h-4 w-4 text-slate-600 mx-auto" />
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full border ${prioStyle} capitalize`}>
                            {e.recommended_priority}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {showMethodology && methodology.model && (
          <div className="mt-4 rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-blue-300">Risk Scoring Methodology</h4>
              <button onClick={() => setShowMethodology(false)} className="text-slate-400 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-3 lg:grid-cols-2 text-xs text-slate-300">
              <div>
                <p className="text-slate-400 mb-1">Model</p>
                <p className="font-medium">{methodology.model} ({methodology.scale})</p>
              </div>
              <div>
                <p className="text-slate-400 mb-1">Rating Thresholds</p>
                <div className="flex gap-2 flex-wrap">
                  {Object.entries(methodology.rating_thresholds || {}).map(([k, v]) => (
                    <span key={k} className={`px-1.5 py-0.5 rounded ${RISK_RATING_STYLES[k]?.bg || ''} ${RISK_RATING_STYLES[k]?.text || ''} capitalize`}>
                      {k}: {v as string}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-slate-400 mb-1">Likelihood Factors</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {(methodology.likelihood_factors || []).map((f: string) => <li key={f}>{f}</li>)}
                </ul>
              </div>
              <div>
                <p className="text-slate-400 mb-1">Impact Factors</p>
                <ul className="list-disc list-inside space-y-0.5">
                  {(methodology.impact_factors || []).map((f: string) => <li key={f}>{f}</li>)}
                </ul>
              </div>
            </div>
            <p className="text-xs text-slate-400 mt-3 italic">{methodology.frequency_weighting}</p>
          </div>
        )}
      </div>

      {/* ===== STAKEHOLDER ACCOUNTABILITY (T005) ===== */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-6 shadow-lg">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Users className="h-5 w-5 text-cyan-400" />
              Stakeholder Accountability
            </h2>
            <p className="text-sm text-slate-400 mt-0.5">Ownership tracking, escalation paths, and performance metrics</p>
          </div>
          <Link href="/audit/findings" className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1">
            All Findings <ChevronRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="grid gap-4 lg:grid-cols-4 mb-5">
          <div className={`rounded-lg border ${accScoreBorder} bg-slate-900/50 p-4 flex flex-col items-center justify-center`}>
            <p className="text-xs text-slate-400 mb-2">Accountability Score</p>
            <div className={`text-4xl font-bold ${accScoreColor}`}>{Math.round(accScore)}</div>
            <p className="text-xs text-slate-500 mt-1">out of 100</p>
            {acc.score_components && (
              <div className="mt-3 w-full space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-400">Closure Rate (40%)</span>
                  <span className="text-white">{acc.score_components.closure_rate_score}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Timeliness (30%)</span>
                  <span className="text-white">{acc.score_components.timeliness_score}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Response Rate (30%)</span>
                  <span className="text-white">{acc.score_components.response_rate_score}%</span>
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-3">
            <div className="grid grid-cols-3 gap-3 mb-3">
              {[
                { label: 'Warning (30+ days)', items: escalation.warning || [], color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20', key: 'warning' },
                { label: 'Escalation (60+ days)', items: escalation.escalation || [], color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20', key: 'escalation' },
                { label: 'Executive Alert (90+ days)', items: escalation.executive_alert || [], color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', key: 'executive_alert' },
              ].map(({ label, items, color, bg, key }) => (
                <button
                  key={key}
                  onClick={() => setExpandedEscalation(expandedEscalation === key ? null : key)}
                  className={`rounded-lg border ${bg} p-3 text-left hover:opacity-90 transition-opacity`}
                >
                  <p className={`text-xs font-medium ${color}`}>{label}</p>
                  <p className="text-2xl font-bold text-white mt-1">{items.length}</p>
                </button>
              ))}
            </div>

            {expandedEscalation && (escalation[expandedEscalation] || []).length > 0 && (
              <div className="rounded-lg border border-slate-700/30 bg-slate-900/50 p-3 max-h-40 overflow-y-auto">
                {(escalation[expandedEscalation] || []).slice(0, 8).map((item: any) => (
                  <div key={item.finding_id} className="flex items-center justify-between py-1.5 border-b border-slate-700/20 last:border-0">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-white truncate">{item.title}</p>
                      <p className="text-xs text-slate-400">{item.owner_name} | {item.engagement_title}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                      <span className={`text-xs px-1.5 py-0.5 rounded border ${SEVERITY_COLORS[item.severity] ? '' : 'border-slate-600'}`}
                        style={{ color: SEVERITY_COLORS[item.severity] || '#94a3b8', borderColor: SEVERITY_COLORS[item.severity] ? `${SEVERITY_COLORS[item.severity]}40` : undefined }}
                      >
                        {item.severity}
                      </span>
                      <span className="text-xs font-bold text-red-400">{item.days_overdue}d</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-medium text-slate-300 mb-3">Owner Leaderboard</h3>
            {ownerStats.length > 0 ? (
              <div className="overflow-x-auto max-h-64 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-800">
                    <tr className="border-b border-slate-700/50">
                      <th className="text-left py-2 px-2 text-xs font-medium text-slate-400">Owner</th>
                      <th className="text-center py-2 px-2 text-xs font-medium text-slate-400">Total</th>
                      <th className="text-center py-2 px-2 text-xs font-medium text-slate-400">Open</th>
                      <th className="text-center py-2 px-2 text-xs font-medium text-slate-400">Overdue</th>
                      <th className="text-center py-2 px-2 text-xs font-medium text-slate-400">Closure</th>
                      <th className="text-center py-2 px-2 text-xs font-medium text-slate-400">Avg Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ownerStats.slice(0, 10).map((o: any, idx: number) => (
                      <tr key={idx} className="border-b border-slate-700/20 hover:bg-slate-700/20">
                        <td className="py-2 px-2 text-white text-xs font-medium truncate max-w-[140px]">{o.display_name}</td>
                        <td className="py-2 px-2 text-center text-slate-300">{o.total_findings}</td>
                        <td className="py-2 px-2 text-center text-slate-300">{o.open_findings}</td>
                        <td className="py-2 px-2 text-center">
                          <span className={o.overdue_findings > 0 ? 'text-red-400 font-bold' : 'text-slate-500'}>{o.overdue_findings}</span>
                        </td>
                        <td className="py-2 px-2">
                          <div className="flex items-center gap-1.5">
                            <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                              <div className="h-full rounded-full bg-emerald-500" style={{ width: `${Math.min(o.closure_rate, 100)}%` }} />
                            </div>
                            <span className="text-xs text-slate-300 w-10 text-right">{o.closure_rate}%</span>
                          </div>
                        </td>
                        <td className="py-2 px-2 text-center text-slate-300 text-xs">{o.avg_days_to_close ?? '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-6">
                <Users className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-500">No ownership data available</p>
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-medium text-slate-300 mb-3">Department Performance</h3>
            {deptPerf.length > 0 ? (
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {deptPerf.slice(0, 8).map((d: any, idx: number) => (
                  <div key={idx}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-white truncate max-w-[200px]">{d.department}</span>
                      <div className="flex items-center gap-3 text-xs">
                        {d.overdue_findings > 0 && (
                          <span className="text-red-400">{d.overdue_findings} overdue</span>
                        )}
                        <span className="text-slate-400">{d.closure_rate}%</span>
                      </div>
                    </div>
                    <div className="h-2.5 w-full bg-slate-700/50 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${Math.min(d.closure_rate, 100)}%`,
                          backgroundColor: d.closure_rate >= 80 ? '#22c55e' : d.closure_rate >= 50 ? '#eab308' : '#ef4444',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <BarChart3 className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-500">No department data available</p>
              </div>
            )}

            {Object.keys(overdueTrend).length > 0 && (
              <div className="mt-4 pt-4 border-t border-slate-700/50">
                <h4 className="text-xs font-medium text-slate-400 mb-2">Overdue Trend (6 months)</h4>
                <div className="flex items-end gap-1 h-12">
                  {Object.entries(overdueTrend).map(([month, count]) => {
                    const maxVal = Math.max(...Object.values(overdueTrend) as number[], 1);
                    const pct = ((count as number) / maxVal) * 100;
                    return (
                      <div key={month} className="flex-1 flex flex-col items-center gap-0.5">
                        <span className="text-[9px] text-slate-500">{count as number}</span>
                        <div className="w-full rounded-t bg-cyan-500/60" style={{ height: `${Math.max(pct, 4)}%`, minHeight: '2px' }} />
                        <span className="text-[8px] text-slate-600">{month.slice(5)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ===== AUDIT ROI & VALUE REALIZATION (T006) ===== */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800 p-6 shadow-lg">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-emerald-400" />
              Audit ROI & Value Realization
            </h2>
            <p className="text-sm text-slate-400 mt-0.5">Financial impact quantification and return on audit investment</p>
          </div>
          <Link href="/audit/reporting" className="text-sm text-blue-400 hover:text-blue-300 flex items-center gap-1">
            Full Reports <ChevronRight className="h-3 w-3" />
          </Link>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4">
            <p className="text-xs text-slate-400 mb-1">Impact Identified</p>
            <p className="text-2xl font-bold text-emerald-400">{formatCurrency(roi.total_financial_impact_identified ?? 0)}</p>
          </div>
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-4">
            <p className="text-xs text-slate-400 mb-1">Savings Realized</p>
            <p className="text-2xl font-bold text-blue-400">{formatCurrency(roi.total_savings_realized ?? 0)}</p>
          </div>
          <div className="rounded-lg border border-purple-500/20 bg-purple-500/5 p-4">
            <p className="text-xs text-slate-400 mb-1">ROI Ratio</p>
            <p className="text-2xl font-bold text-purple-400">{roi.roi_ratio ?? 0}x</p>
            <p className="text-xs text-slate-500">savings / audit cost</p>
          </div>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
            <p className="text-xs text-slate-400 mb-1">Cost Per Finding</p>
            <p className="text-2xl font-bold text-amber-400">{formatCurrency(effMetrics.avg_cost_per_finding ?? 0)}</p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2 mb-5">
          <div>
            <h3 className="text-sm font-medium text-slate-300 mb-3">Impact by Category</h3>
            {Object.keys(impactByCategory).length > 0 ? (
              <div className="space-y-2.5">
                {Object.entries(impactByCategory).map(([cat, data]: [string, any]) => {
                  const catInfo = IMPACT_CATEGORY_LABELS[cat] || { label: cat, color: '#64748b' };
                  const maxImpact = Math.max(...Object.values(impactByCategory).map((d: any) => d.estimated_impact || 0), 1);
                  const pct = ((data.estimated_impact || 0) / maxImpact) * 100;
                  return (
                    <div key={cat}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-slate-300">{catInfo.label}</span>
                        <div className="flex items-center gap-2 text-xs">
                          <span className="text-slate-400">{data.count} findings</span>
                          <span className="text-white font-medium">{formatCurrency(data.estimated_impact || 0)}</span>
                        </div>
                      </div>
                      <div className="h-2 w-full bg-slate-700/50 rounded-full overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: catInfo.color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-6">
                <DollarSign className="h-8 w-8 text-slate-600 mx-auto mb-2" />
                <p className="text-sm text-slate-500">No financial impact data yet</p>
                <p className="text-xs text-slate-600 mt-1">Add estimated impact to findings to track ROI</p>
              </div>
            )}
          </div>

          <div>
            <h3 className="text-sm font-medium text-slate-300 mb-3">Recommendation Value Tracker</h3>
            <div className="space-y-3">
              <div className="rounded-lg border border-slate-700/30 bg-slate-900/50 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-400">Estimated Value</span>
                  <span className="text-sm font-bold text-white">{formatCurrency(recTracking.total_estimated_value ?? 0)}</span>
                </div>
                <div className="h-2 w-full bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-blue-500" style={{ width: '100%' }} />
                </div>
              </div>
              <div className="rounded-lg border border-slate-700/30 bg-slate-900/50 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-400">Realized Value</span>
                  <span className="text-sm font-bold text-emerald-400">{formatCurrency(recTracking.total_realized_value ?? 0)}</span>
                </div>
                <div className="h-2 w-full bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${recTracking.realization_rate ?? 0}%` }} />
                </div>
                <p className="text-xs text-slate-500 mt-1">{recTracking.realization_rate ?? 0}% realization rate</p>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded bg-slate-900/50 p-2">
                  <p className="text-lg font-bold text-white">{recTracking.total_recommendations ?? 0}</p>
                  <p className="text-[10px] text-slate-400">Total Recs</p>
                </div>
                <div className="rounded bg-slate-900/50 p-2">
                  <p className="text-lg font-bold text-white">{recTracking.with_value_estimate ?? 0}</p>
                  <p className="text-[10px] text-slate-400">With Value</p>
                </div>
                <div className="rounded bg-slate-900/50 p-2">
                  <p className="text-lg font-bold text-white">{recTracking.implemented ?? 0}</p>
                  <p className="text-[10px] text-slate-400">Implemented</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {valueByEngagement.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-slate-300 mb-3">Value by Engagement</h3>
            <div className="overflow-x-auto max-h-48 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-slate-800">
                  <tr className="border-b border-slate-700/50">
                    <th className="text-left py-2 px-3 text-xs font-medium text-slate-400">Engagement</th>
                    <th className="text-center py-2 px-3 text-xs font-medium text-slate-400">Findings</th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-slate-400">Impact</th>
                    <th className="text-right py-2 px-3 text-xs font-medium text-slate-400">Savings</th>
                    <th className="text-center py-2 px-3 text-xs font-medium text-slate-400">Hours</th>
                    <th className="text-center py-2 px-3 text-xs font-medium text-slate-400">ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {valueByEngagement.slice(0, 10).map((v: any) => (
                    <tr key={v.engagement_id} className="border-b border-slate-700/20 hover:bg-slate-700/20">
                      <td className="py-2 px-3 text-white text-xs font-medium truncate max-w-[200px]">{v.title}</td>
                      <td className="py-2 px-3 text-center text-slate-300">{v.findings_count}</td>
                      <td className="py-2 px-3 text-right text-emerald-400 text-xs">{formatCurrency(v.total_impact)}</td>
                      <td className="py-2 px-3 text-right text-blue-400 text-xs">{formatCurrency(v.savings_realized)}</td>
                      <td className="py-2 px-3 text-center text-slate-300 text-xs">{v.hours_invested}</td>
                      <td className="py-2 px-3 text-center">
                        <span className={`text-xs font-bold ${v.roi > 1 ? 'text-emerald-400' : v.roi > 0 ? 'text-yellow-400' : 'text-slate-400'}`}>
                          {v.roi}x
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4 pt-4 border-t border-slate-700/50">
          <div className="text-center">
            <p className="text-lg font-bold text-white">{effMetrics.total_findings ?? 0}</p>
            <p className="text-xs text-slate-400">Total Findings</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-white">{effMetrics.avg_hours_per_finding ?? 0}</p>
            <p className="text-xs text-slate-400">Avg Hours/Finding</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-white">{effMetrics.findings_per_engagement ?? 0}</p>
            <p className="text-xs text-slate-400">Findings/Engagement</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-white">{formatCurrency(effMetrics.cost_per_engagement ?? 0)}</p>
            <p className="text-xs text-slate-400">Cost/Engagement</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {[
          { href: '/audit/universe', icon: Target, label: 'Audit Universe', color: 'text-blue-400 bg-blue-500/10' },
          { href: '/audit/plans', icon: Calendar, label: 'Audit Plans', color: 'text-amber-400 bg-amber-500/10' },
          { href: '/audit/engagements', icon: ClipboardCheck, label: 'Engagements', color: 'text-purple-400 bg-purple-500/10' },
          { href: '/audit/findings', icon: AlertTriangle, label: 'Findings', color: 'text-rose-400 bg-rose-500/10' },
          { href: '/audit/test-scripts', icon: FileText, label: 'Test Scripts', color: 'text-indigo-400 bg-indigo-500/10' },
          { href: '/audit/capacity', icon: Clock, label: 'Capacity', color: 'text-teal-400 bg-teal-500/10' },
          { href: '/audit/reporting', icon: BarChart3, label: 'Reporting', color: 'text-cyan-400 bg-cyan-500/10' },
          { href: '/audit/qaip', icon: Shield, label: 'QA & IP', color: 'text-emerald-400 bg-emerald-500/10' },
          { href: '/audit/skill-matrix', icon: Target, label: 'Skill Matrix', color: 'text-pink-400 bg-pink-500/10' },
          { href: '/audit/ccm', icon: Eye, label: 'CCM', color: 'text-orange-400 bg-orange-500/10' },
        ].map(({ href, icon: Icon, label, color }) => (
          <Link
            key={href}
            href={href}
            className="flex flex-col items-center gap-2 p-4 rounded-xl border border-slate-700/50 bg-slate-800 hover:border-slate-600 hover:bg-slate-800/80 transition-all group"
          >
            <div className={`h-10 w-10 rounded-lg ${color} flex items-center justify-center group-hover:scale-110 transition-transform`}>
              <Icon className="h-5 w-5" />
            </div>
            <span className="text-xs font-medium text-slate-400 group-hover:text-white transition-colors">{label}</span>
          </Link>
        ))}
        <button
          onClick={() => setShowSamplingCalc(true)}
          className="flex flex-col items-center gap-2 p-4 rounded-xl border border-slate-700/50 bg-slate-800 hover:border-purple-500/50 hover:bg-slate-800/80 transition-all group"
        >
          <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-purple-500/20 to-blue-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
            <Calculator className="h-5 w-5 text-purple-400" />
          </div>
          <span className="text-xs font-medium text-slate-400 group-hover:text-white transition-colors">Sampling Calc</span>
        </button>
      </div>

      {showSamplingCalc && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl border border-slate-700/50 w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b border-slate-700/50">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <Calculator className="h-5 w-5 text-purple-400" />
                Sampling Calculator
              </h2>
              <button onClick={() => { setShowSamplingCalc(false); setSamplingResult(null); }} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">Population Size *</label>
                <input
                  type="number"
                  value={samplingForm.population_size}
                  onChange={(e) => setSamplingForm({ ...samplingForm, population_size: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  placeholder="e.g. 5000"
                  min="1"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Confidence Level</label>
                  <select
                    value={samplingForm.confidence_level}
                    onChange={(e) => setSamplingForm({ ...samplingForm, confidence_level: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  >
                    <option value="90">90%</option>
                    <option value="95">95%</option>
                    <option value="99">99%</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Sampling Method</label>
                  <select
                    value={samplingForm.sampling_type}
                    onChange={(e) => setSamplingForm({ ...samplingForm, sampling_type: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                  >
                    <option value="attribute">Attribute Sampling</option>
                    <option value="mus">Monetary Unit (MUS)</option>
                    <option value="random">Simple Random</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Expected Error Rate (%)</label>
                  <input
                    type="number"
                    value={samplingForm.expected_error_rate}
                    onChange={(e) => setSamplingForm({ ...samplingForm, expected_error_rate: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                    min="0" max="50" step="0.5"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-300 mb-1">Tolerable Error Rate (%)</label>
                  <input
                    type="number"
                    value={samplingForm.tolerable_error_rate}
                    onChange={(e) => setSamplingForm({ ...samplingForm, tolerable_error_rate: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                    min="1" max="50" step="0.5"
                  />
                </div>
              </div>
              <button
                onClick={handleCalculateSample}
                disabled={calculatingSample || !samplingForm.population_size}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 disabled:opacity-50 text-white rounded-lg font-medium transition-all"
              >
                {calculatingSample ? <><Loader2 className="h-4 w-4 animate-spin" />Calculating...</> : <><Calculator className="h-4 w-4" />Calculate Sample Size</>}
              </button>

              {samplingResult && (
                <div className="bg-slate-900/80 border border-purple-500/30 rounded-lg p-4 space-y-3">
                  <div className="text-center">
                    <p className="text-xs text-slate-500 uppercase tracking-wide">Recommended Sample Size</p>
                    <p className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-blue-400">{samplingResult.sample_size}</p>
                    <p className="text-sm text-slate-400 mt-1">{samplingResult.methodology}</p>
                  </div>
                  <div className="border-t border-slate-700/50 pt-3">
                    <p className="text-xs text-slate-400">{samplingResult.interpretation}</p>
                  </div>
                  {samplingResult.sampling_interval && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500">Sampling Interval</span>
                      <span className="text-white font-medium">{samplingResult.sampling_interval}</span>
                    </div>
                  )}
                  {samplingResult.benchmarks && (
                    <div className="border-t border-slate-700/50 pt-3">
                      <p className="text-xs text-slate-500 mb-2">Benchmarks by Confidence Level</p>
                      <div className="grid grid-cols-3 gap-2">
                        {samplingResult.benchmarks.map((b: any, idx: number) => (
                          <div key={idx} className="text-center bg-slate-800/50 rounded p-2">
                            <p className="text-xs text-slate-500">{b.confidence_level}</p>
                            <p className="text-sm font-bold text-white">{b.sample_size}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
