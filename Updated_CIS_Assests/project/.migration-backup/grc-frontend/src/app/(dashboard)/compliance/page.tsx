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
  compliant: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Compliant' },
  partially_compliant: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Partially Compliant' },
  non_compliant: { bg: 'bg-rose-50', text: 'text-rose-700', label: 'Non-Compliant' },
  not_assessed: { bg: 'bg-gray-50', text: 'text-gray-700', label: 'Not Assessed' },
  not_applicable: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Not Applicable' },
};

const PRIORITY_COLORS: Record<string, { bg: string; text: string }> = {
  critical: { bg: 'bg-rose-50', text: 'text-rose-700' },
  high: { bg: 'bg-orange-50', text: 'text-orange-700' },
  medium: { bg: 'bg-amber-50', text: 'text-amber-700' },
  low: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
};

const IMPACT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  critical: { bg: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200' },
  high: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
  medium: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
  low: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
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
      const response = await controlLibraryApi.gapAnalysis.prioritizeWithAI({ max_gaps: 20 });
      return response.data as AIPrioritizationResult;
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
      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <div className="bg-gray-200 h-12 w-12 rounded-xl mb-4 animate-pulse" />
              <div className="bg-gray-200 h-8 w-20 mb-2 rounded animate-pulse" />
              <div className="bg-gray-200 h-4 w-32 rounded animate-pulse" />
            </div>
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <div className="bg-gray-200 h-6 w-32 mb-4 rounded animate-pulse" />
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-gray-200 h-16 w-full rounded-lg animate-pulse" />
              ))}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
            <div className="bg-gray-200 h-6 w-32 mb-4 rounded animate-pulse" />
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-gray-200 h-16 w-full rounded-lg animate-pulse" />
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
      iconColor: 'text-blue-600',
      bgColor: 'bg-blue-50',
    },
    {
      name: 'Compliant Rate',
      value: `${compliantPercent}%`,
      icon: CheckCircle,
      iconColor: 'text-emerald-600',
      bgColor: 'bg-emerald-50',
    },
    {
      name: 'Non-Compliant',
      value: nonCompliantCount,
      icon: XCircle,
      iconColor: 'text-rose-600',
      bgColor: 'bg-rose-50',
    },
    {
      name: 'Not Assessed',
      value: notAssessedCount,
      icon: HelpCircle,
      iconColor: 'text-gray-600',
      bgColor: 'bg-gray-50',
    },
  ];

  const overdueItems = overdue?.overdue || [];
  const recentStatements = statements?.statements || [];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="grid grid-cols-1 gap-3 sm:gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => (
          <div
            key={stat.name}
            className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm transition-all duration-200 hover:border-gray-300 hover:shadow-md"
          >
            <div className="mb-3 flex items-start justify-between">
              <div className={`rounded-xl ${stat.bgColor} p-2`}>
                <stat.icon className={`h-5 w-5 ${stat.iconColor}`} />
              </div>
            </div>
            <p className="text-[1.85rem] font-semibold leading-none text-black">{stat.value}</p>
            <p className="mt-1 text-[13px] text-gray-600">{stat.name}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <div className="mb-4">
            <div>
              <h2 className="text-lg font-semibold text-black">Compliance Status Breakdown</h2>
              <p className="text-sm text-gray-600 mt-1">Distribution by status</p>
            </div>
          </div>
          <div className="space-y-3">
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
                    <span className="text-sm text-gray-600">{count} ({percentage}%)</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${style.bg.replace('bg-', 'bg-').replace('-50', '-400')} transition-all duration-500`}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <div className="mb-4">
            <div>
              <h2 className="text-lg font-semibold text-black">By Category</h2>
              <p className="text-sm text-gray-600 mt-1">Statement distribution</p>
            </div>
          </div>
          <div className="space-y-3">
            {Object.entries(summary?.by_category || {}).slice(0, 6).map(([category, count]) => (
              <div key={category} className="flex items-center justify-between group hover:bg-gray-50 p-2 rounded-lg transition-colors">
                <span className="text-sm text-gray-700 capitalize">
                  {category.replace(/_/g, ' ')}
                </span>
                <span className="text-base font-semibold text-black">{count as number}</span>
              </div>
            ))}
            {Object.keys(summary?.by_category || {}).length === 0 && (
              <p className="text-sm text-gray-500 text-center py-4">No categories found</p>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-black flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                Overdue Assessments
              </h2>
              <p className="text-sm text-gray-600 mt-1">{overdue?.total || 0} overdue</p>
            </div>
            <Link href="/compliance/statements" className="px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors">
              View All
            </Link>
          </div>
          <div className="space-y-2.5">
            {overdueItems.length > 0 ? (
              overdueItems.map((item: any) => (
                <div
                  key={item.compliance_id}
                  className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-2.5 transition-colors hover:bg-gray-100"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-black truncate">
                      {item.statement_code || 'No Code'}
                    </p>
                    <p className="text-xs text-gray-600 truncate">
                      {item.document_title || 'No Document'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-rose-600 flex items-center gap-1 font-medium">
                      <Clock className="h-3 w-3" />
                      {item.days_overdue}d overdue
                    </span>
                    <span className={`px-2 py-1 text-xs font-medium rounded ${PRIORITY_COLORS[item.priority]?.bg || 'bg-gray-50'} ${PRIORITY_COLORS[item.priority]?.text || 'text-gray-700'}`}>
                      {item.priority || 'medium'}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-8">
                <CheckCircle className="h-12 w-12 text-emerald-600 mx-auto mb-3" />
                <p className="text-gray-600">No overdue assessments</p>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-black">Recent Statements</h2>
              <p className="text-sm text-gray-600 mt-1">Latest policy statements</p>
            </div>
            <Link href="/compliance/statements" className="px-3 py-1.5 text-sm font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors flex items-center gap-1">
              View All
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          <div className="space-y-2.5">
            {recentStatements.length > 0 ? (
              recentStatements.map((stmt: any) => {
                const statusStyle = STATUS_COLORS[stmt.compliance_status] || STATUS_COLORS.not_assessed;
                return (
                  <div
                    key={stmt.id}
                    className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-2.5 transition-colors hover:bg-gray-100"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-black truncate">
                        {stmt.statement_code || 'No Code'}
                      </p>
                      <p className="text-xs text-gray-600 truncate">
                        {stmt.statement_summary || stmt.statement_text?.slice(0, 60) + '...' || 'No text'}
                      </p>
                    </div>
                    <span className={`px-2 py-1 text-xs font-medium rounded ${statusStyle.bg} ${statusStyle.text} whitespace-nowrap ml-3`}>
                      {statusStyle.label}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-8">
                <FileText className="h-12 w-12 text-gray-400 mx-auto mb-3" />
                <p className="text-gray-600">No statements found</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
        <div className="mb-4">
          <div>
            <h2 className="text-lg font-semibold text-black flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-blue-600" />
              Compliance Score
            </h2>
            <p className="text-sm text-gray-600 mt-1">Overall compliance health</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="relative h-28 w-28">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
              <path
                d="M18 2.0845
                  a 15.9155 15.9155 0 0 1 0 31.831
                  a 15.9155 15.9155 0 0 1 0 -31.831"
                fill="none"
                stroke="rgb(229, 231, 235)"
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
              <span className="text-xl font-bold text-black">{summary?.compliance_score?.toFixed(0) || compliantPercent}%</span>
            </div>
          </div>
          <div className="flex-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-gray-50 p-2.5">
                <p className="text-sm text-gray-600">Assessed</p>
                <p className="text-lg font-semibold text-black">{summary?.statistics?.assessed_count || 0}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-2.5">
                <p className="text-sm text-gray-600">Mandatory</p>
                <p className="text-lg font-semibold text-black">{summary?.statistics?.mandatory_count || 0}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-2.5">
                <p className="text-sm text-gray-600">Active</p>
                <p className="text-lg font-semibold text-black">{summary?.statistics?.active_count || 0}</p>
              </div>
              <div className="rounded-lg bg-gray-50 p-2.5">
                <p className="text-sm text-gray-600">Compliance Rate</p>
                <p className="text-lg font-semibold text-emerald-600">{summary?.compliance_rate?.toFixed(1) || 0}%</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* AI Gap Prioritization Section */}
      <div className="bg-white rounded-xl border border-blue-200 p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-black flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-blue-600" />
              AI Gap Prioritization
            </h2>
            <p className="text-sm text-gray-600 mt-1">
              Analyze compliance gaps and prioritize by business impact
            </p>
          </div>
          <button
            onClick={() => aiPrioritizeMutation.mutate()}
            disabled={aiPrioritizeMutation.isPending}
            className="flex items-center gap-2 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
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
          <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg mb-4">
            <p className="text-sm text-rose-700">
              Failed to analyze gaps. Please try again.
            </p>
          </div>
        )}

        {showAIPrioritization && aiResult && (
          <div className="space-y-5">
            {aiResult.message && aiResult.total_gaps_analyzed === 0 && (
              <div className="text-center py-8">
                <CheckCircle className="h-12 w-12 text-emerald-600 mx-auto mb-3" />
                <p className="text-gray-700">{aiResult.message}</p>
              </div>
            )}

            {aiResult.total_gaps_analyzed > 0 && (
              <>
                {aiResult.fallback && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-sm text-amber-700">
                      {aiResult.error || 'AI analysis unavailable. Showing basic prioritization.'}
                    </p>
                  </div>
                )}

                {/* Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 bg-rose-50 border border-rose-200 rounded-lg">
                    <p className="text-2xl font-bold text-rose-700">{aiResult.summary.critical_gaps}</p>
                    <p className="text-sm text-gray-600">Critical</p>
                  </div>
                  <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
                    <p className="text-2xl font-bold text-orange-700">{aiResult.summary.high_gaps}</p>
                    <p className="text-sm text-gray-600">High</p>
                  </div>
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
                    <p className="text-2xl font-bold text-amber-700">{aiResult.summary.medium_gaps}</p>
                    <p className="text-sm text-gray-600">Medium</p>
                  </div>
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <p className="text-2xl font-bold text-blue-700">{aiResult.summary.low_gaps}</p>
                    <p className="text-sm text-gray-600">Low</p>
                  </div>
                </div>

                {/* Key Themes */}
                {aiResult.summary.key_themes && aiResult.summary.key_themes.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {aiResult.summary.key_themes.map((theme, idx) => (
                      <span key={idx} className="px-3 py-1 bg-gray-100 text-gray-700 text-sm rounded-full border border-gray-200">
                        {theme}
                      </span>
                    ))}
                  </div>
                )}

                {/* Quick Wins */}
                {aiResult.quick_wins && aiResult.quick_wins.length > 0 && (
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
                    <h3 className="text-sm font-semibold text-emerald-700 flex items-center gap-2 mb-3">
                      <Zap className="h-4 w-4" />
                      Quick Wins
                    </h3>
                    <div className="space-y-3">
                      {aiResult.quick_wins.map((win, idx) => (
                        <div key={idx} className="flex items-start gap-3">
                          <Lightbulb className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                          <div>
                            <p className="text-sm text-black">{win.gap_description}</p>
                            <p className="text-xs text-gray-600 mt-1">{win.recommendation}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Prioritized Gaps List */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-black flex items-center gap-2">
                    <Target className="h-4 w-4 text-blue-600" />
                    Prioritized Gaps ({aiResult.prioritized_gaps.length})
                  </h3>
                  {aiResult.prioritized_gaps.map((gap) => {
                    const impactStyle = IMPACT_COLORS[gap.business_impact] || IMPACT_COLORS.medium;
                    const isExpanded = expandedGaps.has(gap.rank);
                    return (
                      <div
                        key={gap.rank}
                        className={`p-4 bg-gray-50 border ${impactStyle.border} rounded-lg hover:shadow-sm transition-all`}
                      >
                        <div
                          className="flex items-start justify-between cursor-pointer"
                          onClick={() => toggleGapExpand(gap.rank)}
                        >
                          <div className="flex items-start gap-3 flex-1">
                            <div className="flex-shrink-0 w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center">
                              <span className="text-sm font-bold text-gray-700">#{gap.rank}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="font-medium text-black">{gap.control_title}</h4>
                                <span className={`px-2 py-1 text-xs font-medium rounded ${impactStyle.bg} ${impactStyle.text}`}>
                                  {gap.business_impact}
                                </span>
                                <span className="text-xs text-gray-600 px-2 py-0.5 bg-gray-100 rounded border border-gray-200">
                                  {gap.gap_type.replace('_', ' ')}
                                </span>
                              </div>
                              <p className="text-sm text-gray-600 mt-1">{gap.framework_name}</p>
                            </div>
                          </div>
                          <button className="text-gray-500 hover:text-black p-1 transition-colors">
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </button>
                        </div>

                        {isExpanded && (
                          <div className="mt-4 pt-4 border-t border-gray-200 space-y-4">
                            <div>
                              <p className="text-xs font-semibold text-gray-600 uppercase mb-1">Impact Reasoning</p>
                              <p className="text-sm text-gray-700">{gap.impact_reasoning}</p>
                            </div>
                            <div>
                              <p className="text-xs font-semibold text-gray-600 uppercase mb-1">Regulatory Risk</p>
                              <p className="text-sm text-gray-700">{gap.regulatory_risk}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <p className="text-xs font-semibold text-gray-600 uppercase mb-1">Remediation Effort</p>
                                <span className={`px-2 py-1 text-xs font-medium rounded ${
                                  gap.remediation_effort === 'low' ? 'bg-emerald-50 text-emerald-700' :
                                  gap.remediation_effort === 'high' ? 'bg-rose-50 text-rose-700' :
                                  'bg-amber-50 text-amber-700'
                                }`}>
                                  {gap.remediation_effort}
                                </span>
                              </div>
                              <div>
                                <p className="text-xs font-semibold text-gray-600 uppercase mb-1">Deadline</p>
                                <span className="text-sm text-black">{gap.deadline_recommendation}</span>
                              </div>
                            </div>
                            {gap.suggested_actions && gap.suggested_actions.length > 0 && (
                              <div>
                                <p className="text-xs font-semibold text-gray-600 uppercase mb-2">Suggested Actions</p>
                                <ul className="space-y-1">
                                  {gap.suggested_actions.map((action, idx) => (
                                    <li key={idx} className="flex items-start gap-2 text-sm text-gray-700">
                                      <span className="text-blue-600">•</span>
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

                <p className="text-xs text-gray-500 text-center">
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
