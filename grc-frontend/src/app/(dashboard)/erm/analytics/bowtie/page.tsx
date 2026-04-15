'use client';

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ermApi } from '@/lib/api';
import Link from 'next/link';
import {
  GitBranch,
  Shield,
  AlertTriangle,
  Target,
  ArrowRight,
  ArrowLeft,
  Loader2,
  ChevronDown,
  Zap,
  ShieldCheck,
  ShieldAlert,
  TrendingDown,
  Sparkles,
  Brain,
} from 'lucide-react';

export default function BowTieAnalysisPage() {
  const [selectedRiskId, setSelectedRiskId] = useState<number | null>(null);
  const [aiNarrative, setAiNarrative] = useState<string | null>(null);

  const narrativeMutation = useMutation({
    mutationFn: async (riskId: number) => {
      const response = await ermApi.analytics.generateBowTieNarrative(riskId);
      return response.data;
    },
    onSuccess: (data: any) => {
      setAiNarrative(data.narrative);
    },
  });

  const { data: risks, isLoading: risksLoading } = useQuery({
    queryKey: ['erm-risks-list'],
    queryFn: async () => {
      const response = await ermApi.risks.getAll();
      return response.data;
    },
  });

  const { data: bowTieData, isLoading: bowTieLoading } = useQuery({
    queryKey: ['erm-bowtie', selectedRiskId],
    queryFn: async () => {
      const response = await ermApi.analytics.getBowTie(selectedRiskId!);
      return response.data;
    },
    enabled: !!selectedRiskId,
  });

  const scoreReduction = bowTieData
    ? bowTieData.inherent_score - bowTieData.residual_score
    : 0;

  const scoreReductionPct = bowTieData && bowTieData.inherent_score > 0
    ? Math.round((scoreReduction / bowTieData.inherent_score) * 100)
    : 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/erm/analytics"
            className="flex items-center gap-1 text-sm text-slate-600 hover:text-slate-900 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Analytics
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-slate-900 flex items-center gap-2.5">
              <GitBranch className="h-6 w-6 text-blue-400" />
              Bow-Tie Risk Analysis
            </h1>
            <p className="text-sm text-slate-600 mt-1">
              Visualize threats, controls, and consequences for any risk
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3.5">
        <label className="block text-sm font-medium text-slate-600 mb-2">Select a Risk to Analyze</label>
        <div className="relative">
          <select
            value={selectedRiskId ?? ''}
            onChange={(e) => { setSelectedRiskId(e.target.value ? Number(e.target.value) : null); setAiNarrative(null); }}
            className="w-full appearance-none rounded-lg border border-slate-300 bg-slate-100 px-4 py-2.5 pr-10 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            disabled={risksLoading}
          >
            <option value="">— Choose a risk —</option>
            {risks?.map((risk: any) => (
              <option key={risk.id} value={risk.id}>
                {risk.title} {risk.risk_category ? `(${risk.risk_category})` : ''} — Score: {risk.residual_score ?? 'N/A'}
              </option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-600 pointer-events-none" />
        </div>
      </div>

      {!selectedRiskId && (
        <div className="flex flex-col items-center justify-center py-20 rounded-xl border border-slate-200 bg-white">
          <GitBranch className="h-16 w-16 text-slate-600" />
          <h3 className="mt-4 text-lg font-medium text-slate-900">No Risk Selected</h3>
          <p className="mt-2 text-slate-600 text-center max-w-md">
            Select a risk from the dropdown above to view its bow-tie analysis showing threats,
            controls, and consequences.
          </p>
        </div>
      )}

      {selectedRiskId && bowTieLoading && (
        <div className="flex h-64 items-center justify-center rounded-xl border border-slate-200 bg-white">
          <Loader2 className="h-8 w-8 animate-spin text-blue-400" />
          <span className="ml-3 text-slate-600">Loading bow-tie analysis...</span>
        </div>
      )}

      {selectedRiskId && bowTieData && !bowTieLoading && (
        <>
          <div className="rounded-xl border border-slate-200 bg-white p-4 overflow-x-auto">
            <div className="flex items-stretch justify-center gap-2 min-w-[860px]">
              <div className="flex flex-col justify-center gap-2.5 w-[188px] flex-shrink-0">
                <h3 className="text-sm font-semibold text-red-400 uppercase tracking-wider mb-1 flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  Threats
                </h3>
                {bowTieData.threats?.length > 0 ? (
                  bowTieData.threats.map((threat: any) => (
                    <div
                      key={threat.id}
                      className="rounded-lg border border-red-500/30 bg-red-500/10 p-3"
                    >
                      <p className="text-sm font-medium text-red-300">{threat.title}</p>
                      <div className="mt-1 flex items-center gap-2">
                        {threat.category && (
                          <span className="text-xs text-red-400/70">{threat.category}</span>
                        )}
                        {threat.likelihood && (
                          <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs text-red-300">
                            L: {threat.likelihood}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-500 italic">No threats identified</p>
                )}
              </div>

              <div className="flex flex-col justify-center flex-shrink-0">
                <div className="flex flex-col items-center gap-1 text-orange-400">
                  <ArrowRight className="h-5 w-5" />
                  <ArrowRight className="h-5 w-5" />
                  <ArrowRight className="h-5 w-5" />
                </div>
              </div>

              <div className="flex flex-col justify-center gap-2.5 w-[172px] flex-shrink-0">
                <h3 className="text-sm font-semibold text-blue-400 uppercase tracking-wider mb-1 flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Preventive
                </h3>
                {bowTieData.preventive_controls?.length > 0 ? (
                  bowTieData.preventive_controls.map((ctrl: any) => (
                    <div
                      key={ctrl.id}
                      className="rounded-lg border border-blue-500/30 bg-blue-500/10 p-3"
                    >
                      <p className="text-sm font-medium text-blue-300">{ctrl.name}</p>
                      <div className="mt-1 flex items-center gap-2">
                        {ctrl.code && (
                          <span className="text-xs text-blue-400/70">{ctrl.code}</span>
                        )}
                        {ctrl.effectiveness && (
                          <span className="rounded-full bg-blue-500/20 px-2 py-0.5 text-xs text-blue-300">
                            {ctrl.effectiveness}%
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-500 italic">No preventive controls</p>
                )}
              </div>

              <div className="flex flex-col justify-center flex-shrink-0">
                <div className="h-full w-1 bg-gradient-to-b from-blue-500/50 via-blue-500 to-blue-500/50 rounded-full mx-2" />
              </div>

              <div className="flex flex-col justify-center flex-shrink-0 w-[210px]">
                <div className="rounded-xl border-2 border-amber-500 bg-gradient-to-br from-amber-500/20 to-orange-500/10 p-4 text-center shadow-lg shadow-amber-500/10">
                  <AlertTriangle className="h-7 w-7 text-amber-400 mx-auto mb-2" />
                  <h3 className="text-base font-semibold text-slate-900">{bowTieData.risk_title}</h3>
                  {bowTieData.risk_category && (
                    <span className="inline-block mt-1 rounded-full bg-amber-500/20 px-3 py-0.5 text-xs text-amber-300">
                      {bowTieData.risk_category}
                    </span>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-white/80 p-1.5">
                      <p className="text-xs text-slate-600">Inherent</p>
                      <p className="text-lg font-bold text-red-400">{bowTieData.inherent_score ?? '—'}</p>
                    </div>
                    <div className="rounded-lg bg-white/80 p-1.5">
                      <p className="text-xs text-slate-600">Residual</p>
                      <p className="text-lg font-bold text-green-400">{bowTieData.residual_score ?? '—'}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex flex-col justify-center flex-shrink-0">
                <div className="h-full w-1 bg-gradient-to-b from-green-500/50 via-green-500 to-green-500/50 rounded-full mx-2" />
              </div>

              <div className="flex flex-col justify-center gap-2.5 w-[172px] flex-shrink-0">
                <h3 className="text-sm font-semibold text-green-400 uppercase tracking-wider mb-1 flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" />
                  Mitigating
                </h3>
                {bowTieData.mitigating_controls?.length > 0 ? (
                  bowTieData.mitigating_controls.map((ctrl: any) => (
                    <div
                      key={ctrl.id}
                      className="rounded-lg border border-green-500/30 bg-green-500/10 p-3"
                    >
                      <p className="text-sm font-medium text-green-300">{ctrl.name}</p>
                      <div className="mt-1 flex items-center gap-2">
                        {ctrl.code && (
                          <span className="text-xs text-green-400/70">{ctrl.code}</span>
                        )}
                        {ctrl.effectiveness && (
                          <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-xs text-green-300">
                            {ctrl.effectiveness}%
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-500 italic">No mitigating controls</p>
                )}
              </div>

              <div className="flex flex-col justify-center flex-shrink-0">
                <div className="flex flex-col items-center gap-1 text-amber-400">
                  <ArrowRight className="h-5 w-5" />
                  <ArrowRight className="h-5 w-5" />
                  <ArrowRight className="h-5 w-5" />
                </div>
              </div>

              <div className="flex flex-col justify-center gap-2.5 w-[188px] flex-shrink-0">
                <h3 className="text-sm font-semibold text-amber-400 uppercase tracking-wider mb-1 flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  Consequences
                </h3>
                {bowTieData.consequences?.length > 0 ? (
                  bowTieData.consequences.map((cons: any) => (
                    <div
                      key={cons.id}
                      className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3"
                    >
                      <p className="text-sm font-medium text-amber-300">{cons.title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {cons.severity && (
                          <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">
                            {cons.severity}
                          </span>
                        )}
                        {cons.impact && (
                          <span className="text-xs text-amber-400/70">Impact: {cons.impact}</span>
                        )}
                      </div>
                      {cons.financial_impact && (
                        <p className="mt-1 text-xs text-amber-400/60">
                          Financial: ${typeof cons.financial_impact === 'number' ? cons.financial_impact.toLocaleString() : cons.financial_impact}
                        </p>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="text-xs text-slate-500 italic">No consequences identified</p>
                )}
              </div>
            </div>

            <div className="mt-5 flex items-center justify-center gap-6 border-t border-slate-200 pt-3.5">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-red-500/50 border border-red-500" />
                <span className="text-xs text-slate-600">Threats / Causes</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-blue-500/50 border border-blue-500" />
                <span className="text-xs text-slate-600">Preventive Controls</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-amber-500/50 border border-amber-500" />
                <span className="text-xs text-slate-600">Risk Event</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-green-500/50 border border-green-500" />
                <span className="text-xs text-slate-600">Mitigating Controls</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-amber-500/50 border border-amber-500" />
                <span className="text-xs text-slate-600">Consequences</span>
              </div>
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4.5">
              <h3 className="text-base font-semibold text-slate-900 mb-3">Risk Details</h3>
              <div className="space-y-3">
                <div>
                  <p className="text-sm text-slate-600">Description</p>
                  <p className="text-sm text-slate-900 mt-1">
                    {bowTieData.risk_description || 'No description provided'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-600">Category</p>
                  <p className="text-sm text-slate-900 mt-1">{bowTieData.risk_category || '—'}</p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-4.5">
              <h3 className="text-base font-semibold text-slate-900 mb-3">Score Analysis</h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-lg bg-slate-100/50 p-3 text-center">
                  <ShieldAlert className="h-5 w-5 text-red-400 mx-auto mb-1" />
                  <p className="text-xs text-slate-600">Inherent Score</p>
                  <p className="text-2xl font-bold text-red-400 mt-1">{bowTieData.inherent_score ?? '—'}</p>
                </div>
                <div className="rounded-lg bg-slate-100/50 p-3 text-center">
                  <ShieldCheck className="h-5 w-5 text-green-400 mx-auto mb-1" />
                  <p className="text-xs text-slate-600">Residual Score</p>
                  <p className="text-2xl font-bold text-green-400 mt-1">{bowTieData.residual_score ?? '—'}</p>
                </div>
                <div className="rounded-lg bg-slate-100/50 p-3 text-center">
                  <TrendingDown className="h-5 w-5 text-blue-400 mx-auto mb-1" />
                  <p className="text-xs text-slate-600">Reduction</p>
                  <p className="text-2xl font-bold text-blue-400 mt-1">{scoreReduction}</p>
                  <p className="text-xs text-slate-500">({scoreReductionPct}%)</p>
                </div>
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between text-xs text-slate-600 mb-1">
                  <span>Risk Reduction</span>
                  <span>{scoreReductionPct}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-500"
                    style={{ width: `${Math.min(scoreReductionPct, 100)}%` }}
                  />
                </div>
              </div>

              <div className="mt-3.5 grid grid-cols-4 gap-2.5 text-center">
                <div>
                  <p className="text-xs text-slate-600">Threats</p>
                  <p className="text-lg font-semibold text-red-400">{bowTieData.threats?.length ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-600">Preventive</p>
                  <p className="text-lg font-semibold text-blue-400">{bowTieData.preventive_controls?.length ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-600">Mitigating</p>
                  <p className="text-lg font-semibold text-green-400">{bowTieData.mitigating_controls?.length ?? 0}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-600">Consequences</p>
                  <p className="text-lg font-semibold text-amber-400">{bowTieData.consequences?.length ?? 0}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-4.5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <Brain className="h-5 w-5 text-purple-400" />
                AI Analysis
              </h3>
              <button
                onClick={() => selectedRiskId && narrativeMutation.mutate(selectedRiskId)}
                disabled={narrativeMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 px-3.5 py-2 text-sm font-medium text-slate-900 shadow-lg shadow-purple-500/25 hover:from-purple-500 hover:to-blue-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {narrativeMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Generate AI Narrative
                  </>
                )}
              </button>
            </div>

            {!aiNarrative && !narrativeMutation.isPending && !narrativeMutation.isError && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="rounded-full bg-gradient-to-br from-purple-500/20 to-blue-500/20 p-4 mb-4">
                  <Sparkles className="h-8 w-8 text-purple-400" />
                </div>
                <p className="text-slate-600 max-w-md">
                  Click &quot;Generate AI Narrative&quot; to get a comprehensive plain-English explanation of the
                  bow-tie risk analysis, including threats, controls, consequences, and recommendations.
                </p>
              </div>
            )}

            {narrativeMutation.isError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
                <p className="text-sm text-red-400">Failed to generate AI narrative. Please try again.</p>
              </div>
            )}

            {aiNarrative && (
              <div className="relative">
                <div className="absolute left-0 top-0 bottom-0 w-1 rounded-full bg-gradient-to-b from-purple-500 to-blue-500" />
                <div className="pl-6 prose prose-invert prose-sm max-w-none">
                  {aiNarrative.split('\n').map((line, i) => {
                    if (line.startsWith('## ')) {
                      return <h2 key={i} className="text-lg font-bold text-slate-900 mt-4 mb-2">{line.replace('## ', '')}</h2>;
                    }
                    if (line.startsWith('### ')) {
                      return <h3 key={i} className="text-base font-semibold text-purple-300 mt-4 mb-2">{line.replace('### ', '')}</h3>;
                    }
                    if (line.startsWith('**') && line.endsWith('**')) {
                      return <h3 key={i} className="text-base font-semibold text-purple-300 mt-4 mb-2">{line.replace(/\*\*/g, '')}</h3>;
                    }
                    if (line.match(/^\d+\.\s/)) {
                      return <p key={i} className="text-sm text-slate-700 ml-4 mb-1">{line}</p>;
                    }
                    if (line.startsWith('- ')) {
                      return <p key={i} className="text-sm text-slate-700 ml-4 mb-1">{line}</p>;
                    }
                    if (line.trim() === '') {
                      return <div key={i} className="h-2" />;
                    }
                    return <p key={i} className="text-sm text-slate-700 mb-2">{line}</p>;
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}