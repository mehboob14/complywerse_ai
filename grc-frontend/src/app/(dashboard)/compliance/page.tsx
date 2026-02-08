'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { complianceApi, controlLibraryApi } from '@/lib/api';
import {
  FileText,
  CheckCircle,
  XCircle,
  HelpCircle,
  AlertTriangle,
  ArrowRight,
  Clock,
  TrendingUp,
  Sparkles,
  Zap,
  Target,
  Lightbulb,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import Link from 'next/link';

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  compliant: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', label: 'Compliant' },
  partially_compliant: { bg: 'bg-amber-500/20', text: 'text-amber-400', label: 'Partially Compliant' },
  non_compliant: { bg: 'bg-rose-500/20', text: 'text-rose-400', label: 'Non-Compliant' },
  not_assessed: { bg: 'bg-slate-500/20', text: 'text-slate-400', label: 'Not Assessed' },
  not_applicable: { bg: 'bg-gray-500/20', text: 'text-gray-400', label: 'Not Applicable' },
};

const PRIORITY_COLORS: Record<string, { bg: string; text: string }> = {
  critical: { bg: 'bg-rose-500/20', text: 'text-rose-400' },
  high: { bg: 'bg-orange-500/20', text: 'text-orange-400' },
  medium: { bg: 'bg-amber-500/20', text: 'text-amber-400' },
  low: { bg: 'bg-emerald-500/20', text: 'text-emerald-400' },
};

const IMPACT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: 'bg-rose-500/20', text: 'text-rose-400', border: 'border-rose-500/30' },
  high: { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30' },
  medium: { bg: 'bg-amber-500/20', text: 'text-amber-400', border: 'border-amber-500/30' },
  low: { bg: 'bg-blue-500/20', text: 'text-blue-400', border: 'border-blue-500/30' },
};

interface PrioritizedGap {
  rank: number;
  gap_type: string;
  control_id: number;
  control_title: string;
  framework_name: string;
  business_impact: string;
  impact_reasoning: string;
  regulatory_risk: string;
  remediation_effort: string;
  suggested_actions: string[];
  deadline_recommendation: string;
}

interface QuickWin {
  gap_description: string;
  effort: string;
  impact: string;
  recommendation: string;
}

interface AIPrioritizationResult {
  analysis_date: string;
  total_gaps_analyzed: number;
  prioritized_gaps: PrioritizedGap[];
  summary: {
    critical_gaps: number;
    high_gaps: number;
    medium_gaps: number;
    low_gaps: number;
    key_themes: string[];
  };
  quick_wins: QuickWin[];
  message?: string;
  fallback?: boolean;
  error?: string;
}

export default function ComplianceOverviewPage() {
  const [showAIPrioritization, setShowAIPrioritization] = useState(false);
  const [aiResult, setAiResult] = useState<AIPrioritizationResult | null>(null);
  const [expandedGaps, setExpandedGaps] = useState<Set<number>>(new Set());

  const toggleGapExpand = (rank: number) => {
    const newExpanded = new Set(expandedGaps);
    if (newExpanded.has(rank)) {
      newExpanded.delete(rank);
    } else {
      newExpanded.add(rank);
    }
    setExpandedGaps(newExpanded);
  };

  const aiPrioritizeMutation = useMutation({
    mutationFn: async () => {
      return await controlLibraryApi.gapAnalysis.prioritizeWithAI({ max_gaps: 20 });
    },
    onSuccess: (data) => {
      setAiResult(data);
      setShowAIPrioritization(true);
    },
  });
  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['compliance-dashboard-summary'],
    queryFn: async () => {
      const response = await complianceApi.dashboard.getSummary();
      return response.data;
    },
  });

  const { data: overdue } = useQuery({
    queryKey: ['compliance-overdue'],
    queryFn: async () => {
      const response = await complianceApi.dashboard.getOverdue({ limit: 5 });
      return response.data;
    },
  });

  const { data: statements } = useQuery({
    queryKey: ['compliance-recent-statements'],
    queryFn: async () => {
      const response = await complianceApi.statements.getAll({ limit: 5 });
      return response.data;
    },
  });

  if (summaryLoading) {
    return (
      <div className="space-y-8">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="stat-card">
              <div className="skeleton h-12 w-12 rounded-xl mb-4" />
              <div className="skeleton h-8 w-20 mb-2" />
              <div className="skeleton h-4 w-32" />
            </div>
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="card">
            <div className="skeleton h-6 w-32 mb-4" />
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="skeleton h-16 w-full rounded-lg" />
              ))}
            </div>
          </div>
          <div className="card">
            <div className="skeleton h-6 w-32 mb-4" />
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="skeleton h-16 w-full rounded-lg" />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const byStatus = summary?.by_status || {};
  const totalStatements = summary?.total_statements || 0;
  const compliantCount = byStatus.compliant || 0;
  const nonCompliantCount = byStatus.non_compliant || 0;
  const notAssessedCount = byStatus.not_assessed || 0;
  const partiallyCompliantCount = byStatus.partially_compliant || 0;
  const notApplicableCount = byStatus.not_applicable || 0;
  
  const applicableCount = totalStatements - notApplicableCount;
  const compliantPercent = applicableCount > 0 
    ? Math.round((compliantCount / applicableCount) * 100) 
    : 0;

  const statCards = [
    {
      name: 'Total Statements',
      value: totalStatements,
      icon: FileText,
      iconColor: 'text-primary-400',
      bgColor: 'from-primary-500/20 to-primary-600/10',
    },
    {
      name: 'Compliant Rate',
      value: `${compliantPercent}%`,
      icon: CheckCircle,
      iconColor: 'text-emerald-400',
      bgColor: 'from-emerald-500/20 to-emerald-600/10',
    },
    {
      name: 'Non-Compliant',
      value: nonCompliantCount,
      icon: XCircle,
      iconColor: 'text-rose-400',
      bgColor: 'from-rose-500/20 to-rose-600/10',
    },
    {
      name: 'Not Assessed',
      value: notAssessedCount,
      icon: HelpCircle,
      iconColor: 'text-slate-400',
      bgColor: 'from-slate-500/20 to-slate-600/10',
    },
  ];

  const overdueItems = overdue?.overdue || [];
  const recentStatements = statements?.statements || [];

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <div
            key={stat.name}
            className="stat-card group hover:border-slate-300 transition-all duration-200 hover:shadow-xl"
          >
            <div className="flex items-start justify-between mb-4">
              <div className={`rounded-xl bg-gradient-to-br ${stat.bgColor} p-3`}>
                <stat.icon className={`h-6 w-6 ${stat.iconColor}`} />
              </div>
            </div>
            <p className="stat-value">{stat.value}</p>
            <p className="stat-label">{stat.name}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Compliance Status Breakdown</h2>
              <p className="card-description">Distribution by status</p>
            </div>
          </div>
          <div className="space-y-4">
            {[
              { key: 'compliant', label: 'Compliant', count: compliantCount },
              { key: 'partially_compliant', label: 'Partially Compliant', count: partiallyCompliantCount },
              { key: 'non_compliant', label: 'Non-Compliant', count: nonCompliantCount },
              { key: 'not_assessed', label: 'Not Assessed', count: notAssessedCount },
              { key: 'not_applicable', label: 'Not Applicable', count: notApplicableCount },
            ].map(({ key, label, count }) => {
              const percentage = totalStatements > 0 ? Math.round((count / totalStatements) * 100) : 0;
              const style = STATUS_COLORS[key] || STATUS_COLORS.not_assessed;
              return (
                <div key={key} className="group">
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-sm font-medium ${style.text}`}>{label}</span>
                    <span className="text-sm text-slate-400">{count} ({percentage}%)</span>
                  </div>
                  <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${style.bg.replace('/20', '')} transition-all duration-500`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">By Category</h2>
              <p className="card-description">Statement distribution</p>
            </div>
          </div>
          <div className="space-y-3">
            {Object.entries(summary?.by_category || {}).slice(0, 6).map(([category, count]) => (
              <div key={category} className="flex items-center justify-between group">
                <span className="text-sm text-slate-600 group-hover:text-slate-900 transition-colors capitalize">
                  {category.replace(/_/g, ' ')}
                </span>
                <span className="text-base font-semibold text-slate-800">{count as number}</span>
              </div>
            ))}
            {Object.keys(summary?.by_category || {}).length === 0 && (
              <p className="text-sm text-slate-500 text-center py-4">No categories found</p>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-400" />
                Overdue Assessments
              </h2>
              <p className="card-description">{overdue?.total || 0} overdue</p>
            </div>
            <Link href="/compliance/statements" className="btn-secondary btn-sm">
              View All
            </Link>
          </div>
          <div className="space-y-3">
            {overdueItems.length > 0 ? (
              overdueItems.map((item: any) => (
                <div
                  key={item.compliance_id}
                  className="flex items-center justify-between p-3 bg-white/50 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">
                      {item.statement_code || 'No Code'}
                    </p>
                    <p className="text-xs text-slate-400 truncate">
                      {item.document_title || 'No Document'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-rose-400 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {item.days_overdue}d overdue
                    </span>
                    <span className={`badge ${PRIORITY_COLORS[item.priority]?.bg || 'bg-slate-500/20'} ${PRIORITY_COLORS[item.priority]?.text || 'text-slate-400'}`}>
                      {item.priority || 'medium'}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8">
                <CheckCircle className="h-12 w-12 text-emerald-400 mx-auto mb-3" />
                <p className="text-slate-400">No overdue assessments</p>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Recent Statements</h2>
              <p className="card-description">Latest policy statements</p>
            </div>
            <Link href="/compliance/statements" className="btn-secondary btn-sm">
              View All
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="space-y-3">
            {recentStatements.length > 0 ? (
              recentStatements.map((stmt: any) => {
                const statusStyle = STATUS_COLORS[stmt.compliance_status] || STATUS_COLORS.not_assessed;
                return (
                  <div
                    key={stmt.id}
                    className="flex items-center justify-between p-3 bg-white/50 rounded-lg hover:bg-slate-50 transition-colors"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">
                        {stmt.statement_code || 'No Code'}
                      </p>
                      <p className="text-xs text-slate-400 truncate">
                        {stmt.statement_summary || stmt.statement_text?.slice(0, 60) + '...' || 'No text'}
                      </p>
                    </div>
                    <span className={`badge ${statusStyle.bg} ${statusStyle.text}`}>
                      {statusStyle.label}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-8">
                <FileText className="h-12 w-12 text-slate-500 mx-auto mb-3" />
                <p className="text-slate-400">No statements found</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary-400" />
              Compliance Score
            </h2>
            <p className="card-description">Overall compliance health</p>
          </div>
        </div>
        <div className="flex items-center gap-8">
          <div className="relative w-32 h-32">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
              <path
                d="M18 2.0845
                  a 15.9155 15.9155 0 0 1 0 31.831
                  a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="rgb(51, 65, 85)"
                strokeWidth="3"
              />
              <path
                d="M18 2.0845
                  a 15.9155 15.9155 0 0 1 0 31.831
                  a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke={compliantPercent >= 80 ? 'rgb(16, 185, 129)' : compliantPercent >= 50 ? 'rgb(245, 158, 11)' : 'rgb(239, 68, 68)'}
                strokeWidth="3"
                strokeDasharray={`${compliantPercent}, 100`}
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-2xl font-bold text-slate-800">{summary?.compliance_score?.toFixed(0) || compliantPercent}%</span>
            </div>
          </div>
          <div className="flex-1">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-slate-400">Assessed</p>
                <p className="text-xl font-semibold text-slate-800">{summary?.statistics?.assessed_count || 0}</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">Mandatory</p>
                <p className="text-xl font-semibold text-slate-800">{summary?.statistics?.mandatory_count || 0}</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">Active</p>
                <p className="text-xl font-semibold text-slate-800">{summary?.statistics?.active_count || 0}</p>
              </div>
              <div>
                <p className="text-sm text-slate-400">Compliance Rate</p>
                <p className="text-xl font-semibold text-emerald-400">{summary?.compliance_rate?.toFixed(1) || 0}%</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* AI Gap Prioritization Section */}
      <div className="card border border-primary-500/20">
        <div className="card-header">
          <div>
            <h2 className="card-title flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary-400" />
              AI Gap Prioritization
            </h2>
            <p className="card-description">
              Analyze compliance gaps and prioritize by business impact
            </p>
          </div>
          <button
            onClick={() => aiPrioritizeMutation.mutate()}
            disabled={aiPrioritizeMutation.isPending}
            className="btn-primary flex items-center gap-2"
          >
            {aiPrioritizeMutation.isPending ? (
              <>
                <div className="h-4 w-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Prioritize with AI
              </>
            )}
          </button>
        </div>

        {aiPrioritizeMutation.isError && (
          <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-lg mb-4">
            <p className="text-sm text-rose-400">
              Failed to analyze gaps. Please try again.
            </p>
          </div>
        )}

        {showAIPrioritization && aiResult && (
          <div className="space-y-6">
            {aiResult.message && aiResult.total_gaps_analyzed === 0 && (
              <div className="text-center py-8">
                <CheckCircle className="h-12 w-12 text-emerald-400 mx-auto mb-3" />
                <p className="text-slate-600">{aiResult.message}</p>
              </div>
            )}

            {aiResult.total_gaps_analyzed > 0 && (
              <>
                {aiResult.fallback && (
                  <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                    <p className="text-sm text-amber-400">
                      {aiResult.error || 'AI analysis unavailable. Showing basic prioritization.'}
                    </p>
                  </div>
                )}

                {/* Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 bg-rose-500/10 border border-rose-500/20 rounded-lg">
                    <p className="text-2xl font-bold text-rose-400">{aiResult.summary.critical_gaps}</p>
                    <p className="text-sm text-slate-400">Critical</p>
                  </div>
                  <div className="p-4 bg-orange-500/10 border border-orange-500/20 rounded-lg">
                    <p className="text-2xl font-bold text-orange-400">{aiResult.summary.high_gaps}</p>
                    <p className="text-sm text-slate-400">High</p>
                  </div>
                  <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                    <p className="text-2xl font-bold text-amber-400">{aiResult.summary.medium_gaps}</p>
                    <p className="text-sm text-slate-400">Medium</p>
                  </div>
                  <div className="p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                    <p className="text-2xl font-bold text-blue-400">{aiResult.summary.low_gaps}</p>
                    <p className="text-sm text-slate-400">Low</p>
                  </div>
                </div>

                {/* Key Themes */}
                {aiResult.summary.key_themes && aiResult.summary.key_themes.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {aiResult.summary.key_themes.map((theme, idx) => (
                      <span key={idx} className="px-3 py-1 bg-slate-200 text-slate-600 text-sm rounded-full">
                        {theme}
                      </span>
                    ))}
                  </div>
                )}

                {/* Quick Wins */}
                {aiResult.quick_wins && aiResult.quick_wins.length > 0 && (
                  <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
                    <h3 className="text-sm font-semibold text-emerald-400 flex items-center gap-2 mb-3">
                      <Zap className="h-4 w-4" />
                      Quick Wins
                    </h3>
                    <div className="space-y-3">
                      {aiResult.quick_wins.map((win, idx) => (
                        <div key={idx} className="flex items-start gap-3">
                          <Lightbulb className="h-4 w-4 text-amber-400 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-sm text-slate-800">{win.gap_description}</p>
                            <p className="text-xs text-slate-400 mt-1">{win.recommendation}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Prioritized Gaps List */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-600 flex items-center gap-2">
                    <Target className="h-4 w-4 text-primary-400" />
                    Prioritized Gaps ({aiResult.prioritized_gaps.length})
                  </h3>
                  {aiResult.prioritized_gaps.map((gap) => {
                    const impactStyle = IMPACT_COLORS[gap.business_impact] || IMPACT_COLORS.medium;
                    const isExpanded = expandedGaps.has(gap.rank);
                    return (
                      <div
                        key={gap.rank}
                        className={`p-4 bg-white/50 border ${impactStyle.border} rounded-lg`}
                      >
                        <div
                          className="flex items-start justify-between cursor-pointer"
                          onClick={() => toggleGapExpand(gap.rank)}
                        >
                          <div className="flex items-start gap-3 flex-1">
                            <div className="flex-shrink-0 w-8 h-8 bg-slate-200 rounded-full flex items-center justify-center">
                              <span className="text-sm font-bold text-slate-800">#{gap.rank}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="font-medium text-slate-800">{gap.control_title}</h4>
                                <span className={`badge ${impactStyle.bg} ${impactStyle.text}`}>
                                  {gap.business_impact}
                                </span>
                                <span className="text-xs text-slate-500 px-2 py-0.5 bg-slate-200 rounded">
                                  {gap.gap_type.replace('_', ' ')}
                                </span>
                              </div>
                              <p className="text-sm text-slate-400 mt-1">{gap.framework_name}</p>
                            </div>
                          </div>
                          <button className="text-slate-400 hover:text-slate-900 p-1">
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </button>
                        </div>

                        {isExpanded && (
                          <div className="mt-4 pt-4 border-t border-slate-200 space-y-4">
                            <div>
                              <p className="text-xs font-semibold text-slate-400 uppercase mb-1">Impact Reasoning</p>
                              <p className="text-sm text-slate-600">{gap.impact_reasoning}</p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-slate-400 uppercase mb-1">Regulatory Risk</p>
                              <p className="text-sm text-slate-600">{gap.regulatory_risk}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <p className="text-xs font-semibold text-slate-400 uppercase mb-1">Remediation Effort</p>
                                <span className={`badge ${
                                  gap.remediation_effort === 'low' ? 'bg-emerald-500/20 text-emerald-400' :
                                  gap.remediation_effort === 'high' ? 'bg-rose-500/20 text-rose-400' :
                                  'bg-amber-500/20 text-amber-400'
                                }`}>
                                  {gap.remediation_effort}
                                </span>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-slate-400 uppercase mb-1">Deadline</p>
                                <span className="text-sm text-slate-800">{gap.deadline_recommendation}</span>
                              </div>
                            </div>
                            {gap.suggested_actions && gap.suggested_actions.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-slate-400 uppercase mb-2">Suggested Actions</p>
                                <ul className="space-y-1">
                                  {gap.suggested_actions.map((action, idx) => (
                                    <li key={idx} className="flex items-start gap-2 text-sm text-slate-600">
                                      <span className="text-primary-400">•</span>
                                      {action}
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <p className="text-xs text-slate-500 text-center">
                  Analysis performed at {new Date(aiResult.analysis_date).toLocaleString()} • {aiResult.total_gaps_analyzed} gaps analyzed
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
