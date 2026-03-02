'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { ermApi } from '@/lib/api';
import Link from 'next/link';
import {
  ArrowLeft,
  Loader2,
  Target,
  TrendingUp,
  TrendingDown,
  Play,
  Check,
  Search,
  Minus,
  ChevronRight,
  Zap,
  SlidersHorizontal,
  BarChart3,
  AlertTriangle,
  Shield,
  Globe,
  Scale,
  Sparkles,
} from 'lucide-react';

interface ScenarioPreset {
  id: number;
  name: string;
  description: string;
  likelihood_adjustment: number;
  impact_adjustment: number;
  categories_affected?: string[];
}

interface ScenarioResult {
  risk_id: number;
  risk_title: string;
  risk_category: string;
  original_likelihood: number;
  original_impact: number;
  original_score: number;
  adjusted_likelihood: number;
  adjusted_impact: number;
  adjusted_score: number;
  score_change: number;
  score_change_pct: number;
  severity_original: string;
  severity_adjusted: string;
  scenario_name: string;
}

interface ScenarioSummary {
  total_risks_analyzed: number;
  total_original_score: number;
  total_adjusted_score: number;
  total_change: number;
  risks_increased: number;
  risks_decreased: number;
  risks_unchanged: number;
}

interface ScenarioResponse {
  results: ScenarioResult[];
  summary: ScenarioSummary;
}

interface RiskAdjustment {
  risk_id: number;
  adjusted_likelihood: number;
  adjusted_impact: number;
  scenario_name: string;
}

function getSeverityColor(severity: string): string {
  const s = severity?.toLowerCase() || '';
  if (s === 'critical' || s === 'very high') return 'bg-red-500/20 text-red-400 border-red-500/30';
  if (s === 'high') return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
  if (s === 'medium') return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
  if (s === 'low') return 'bg-green-500/20 text-green-400 border-green-500/30';
  return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
}

function getPresetIcon(name: string) {
  const n = name.toLowerCase();
  if (n.includes('best')) return <Shield className="h-6 w-6 text-green-400" />;
  if (n.includes('worst')) return <AlertTriangle className="h-6 w-6 text-red-400" />;
  if (n.includes('economic') || n.includes('downturn')) return <TrendingDown className="h-6 w-6 text-orange-400" />;
  if (n.includes('cyber')) return <Zap className="h-6 w-6 text-purple-400" />;
  if (n.includes('regulatory') || n.includes('regulation')) return <Scale className="h-6 w-6 text-blue-400" />;
  return <Globe className="h-6 w-6 text-slate-400" />;
}

export default function ScenarioAnalysisPage() {
  const [scoreType, setScoreType] = useState<'inherent' | 'residual'>('residual');
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedRiskIds, setSelectedRiskIds] = useState<Set<number>>(new Set());
  const [approach, setApproach] = useState<'preset' | 'custom'>('preset');
  const [selectedPresetId, setSelectedPresetId] = useState<number | null>(null);
  const [customAdjustments, setCustomAdjustments] = useState<Record<number, { likelihood: number; impact: number }>>({});
  const [results, setResults] = useState<ScenarioResponse | null>(null);
  const [scenarioName, setScenarioName] = useState('');
  const [aiExplanation, setAiExplanation] = useState<string | null>(null);

  const { data: risksData, isLoading: risksLoading } = useQuery({
    queryKey: ['erm-risks'],
    queryFn: async () => {
      const response = await ermApi.risks.getAll();
      return response.data;
    },
  });

  const { data: presetsData, isLoading: presetsLoading } = useQuery({
    queryKey: ['erm-scenario-presets'],
    queryFn: async () => {
      const response = await ermApi.analytics.getScenarioPresets();
      return response.data;
    },
  });

  const risks = risksData || [];
  const presets: ScenarioPreset[] = presetsData || [];

  const filteredRisks = useMemo(() => {
    if (!searchFilter) return risks;
    const lower = searchFilter.toLowerCase();
    return risks.filter((r: any) =>
      r.title?.toLowerCase().includes(lower) ||
      r.risk_category?.toLowerCase().includes(lower)
    );
  }, [risks, searchFilter]);

  const selectedPreset = presets.find((p) => p.id === selectedPresetId) || null;

  const analysisMutation = useMutation({
    mutationFn: async (data: { scenarios: RiskAdjustment[] }) => {
      const response = await ermApi.analytics.runScenarioAnalysis(data, scoreType);
      return response.data as ScenarioResponse;
    },
    onSuccess: (data) => {
      setResults(data);
      setAiExplanation(null);
    },
  });

  const aiExplainMutation = useMutation({
    mutationFn: async (data: { results: any[]; summary: any; scenario_type?: string }) => {
      const response = await ermApi.analytics.aiExplainScenario(data);
      return response.data;
    },
    onSuccess: (data) => {
      setAiExplanation(data.explanation);
    },
  });

  const handleAIExplain = () => {
    if (!results) return;
    const scenarioType = scenarioName || (selectedPreset?.name ?? 'Custom Scenario');
    aiExplainMutation.mutate({
      results: results.results,
      summary: results.summary,
      scenario_type: scenarioType,
    });
  };

  const handleSelectAll = () => {
    const allIds = new Set(filteredRisks.map((r: any) => r.id));
    setSelectedRiskIds(allIds);
  };

  const handleSelectNone = () => {
    setSelectedRiskIds(new Set());
  };

  const handleToggleRisk = (id: number) => {
    const next = new Set(selectedRiskIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedRiskIds(next);
  };

  const handleRunAnalysis = () => {
    const scenarios: RiskAdjustment[] = [];
    const name = scenarioName || (selectedPreset?.name ?? 'Custom Scenario');

    for (const riskId of selectedRiskIds) {
      const risk = risks.find((r: any) => r.id === riskId);
      if (!risk) continue;

      if (approach === 'preset' && selectedPreset) {
        const baseLikelihood = scoreType === 'inherent' ? (risk.inherent_likelihood || 3) : (risk.residual_likelihood || 3);
        const baseImpact = scoreType === 'inherent' ? (risk.inherent_impact || 3) : (risk.residual_impact || 3);
        const adjL = Math.max(1, Math.min(5, baseLikelihood + selectedPreset.likelihood_adjustment));
        const adjI = Math.max(1, Math.min(5, baseImpact + selectedPreset.impact_adjustment));
        scenarios.push({
          risk_id: riskId,
          adjusted_likelihood: adjL,
          adjusted_impact: adjI,
          scenario_name: name,
        });
      } else if (approach === 'custom') {
        const adj = customAdjustments[riskId];
        if (adj) {
          scenarios.push({
            risk_id: riskId,
            adjusted_likelihood: adj.likelihood,
            adjusted_impact: adj.impact,
            scenario_name: name,
          });
        }
      }
    }

    if (scenarios.length > 0) {
      analysisMutation.mutate({ scenarios });
    }
  };

  const initCustomAdjustments = () => {
    const adj: Record<number, { likelihood: number; impact: number }> = {};
    for (const riskId of selectedRiskIds) {
      const risk = risks.find((r: any) => r.id === riskId);
      if (risk) {
        adj[riskId] = {
          likelihood: scoreType === 'inherent' ? (risk.inherent_likelihood || 3) : (risk.residual_likelihood || 3),
          impact: scoreType === 'inherent' ? (risk.inherent_impact || 3) : (risk.residual_impact || 3),
        };
      }
    }
    setCustomAdjustments(adj);
  };

  const canRunAnalysis =
    selectedRiskIds.size > 0 &&
    (approach === 'preset' ? selectedPresetId !== null : Object.keys(customAdjustments).length > 0);

  if (risksLoading || presetsLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link
            href="/erm/analytics"
            className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-400 hover:text-white border border-slate-700"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <div>
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Target className="h-5 w-5 text-primary-400" />
              Scenario Analysis
            </h2>
            <p className="text-sm text-slate-400">Model what-if scenarios to understand risk impact changes</p>
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-slate-800 border border-slate-700 p-1">
          <button
            onClick={() => setScoreType('inherent')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              scoreType === 'inherent'
                ? 'bg-primary-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Inherent
          </button>
          <button
            onClick={() => setScoreType('residual')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              scoreType === 'residual'
                ? 'bg-primary-600 text-white'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Residual
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800 p-6">
        <h3 className="text-white font-medium flex items-center gap-2 mb-4">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 text-xs text-white font-bold">1</span>
          Select Risks
        </h3>
        <div className="flex items-center gap-3 mb-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <input
              type="text"
              placeholder="Search risks..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="w-full rounded-lg border border-slate-600 bg-slate-700 pl-10 pr-3 py-2 text-sm text-white placeholder-slate-500"
            />
          </div>
          <button
            onClick={handleSelectAll}
            className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-600 whitespace-nowrap"
          >
            Select All
          </button>
          <button
            onClick={handleSelectNone}
            className="rounded-lg bg-slate-700 px-3 py-2 text-sm text-slate-300 hover:bg-slate-600 whitespace-nowrap"
          >
            Select None
          </button>
          <span className="text-sm text-slate-400 whitespace-nowrap">
            {selectedRiskIds.size} selected
          </span>
        </div>
        <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900/50">
          {filteredRisks.length === 0 ? (
            <p className="p-4 text-center text-sm text-slate-500">No risks found</p>
          ) : (
            filteredRisks.map((risk: any) => {
              const score = scoreType === 'inherent' ? risk.inherent_score : risk.residual_score;
              return (
                <label
                  key={risk.id}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-800/80 cursor-pointer border-b border-slate-800 last:border-0"
                >
                  <input
                    type="checkbox"
                    checked={selectedRiskIds.has(risk.id)}
                    onChange={() => handleToggleRisk(risk.id)}
                    className="h-4 w-4 rounded border-slate-600 bg-slate-700 text-primary-600 focus:ring-primary-500"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm text-white truncate block">{risk.title}</span>
                    <span className="text-xs text-slate-500">{risk.risk_category}</span>
                  </div>
                  <span className="text-xs text-slate-400 whitespace-nowrap">
                    Score: {score ?? '—'}
                  </span>
                </label>
              );
            })
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800 p-6">
        <h3 className="text-white font-medium flex items-center gap-2 mb-4">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-600 text-xs text-white font-bold">2</span>
          Choose Approach
        </h3>
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => setApproach('preset')}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              approach === 'preset'
                ? 'bg-primary-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            <Zap className="h-4 w-4" />
            Preset Scenarios
          </button>
          <button
            onClick={() => {
              setApproach('custom');
              initCustomAdjustments();
            }}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              approach === 'custom'
                ? 'bg-primary-600 text-white'
                : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
            }`}
          >
            <SlidersHorizontal className="h-4 w-4" />
            Custom Adjustments
          </button>
        </div>

        {approach === 'preset' && (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {presets.map((preset) => (
              <button
                key={preset.id}
                onClick={() => setSelectedPresetId(preset.id)}
                className={`rounded-lg border p-4 text-left transition-all ${
                  selectedPresetId === preset.id
                    ? 'border-primary-500 bg-primary-600/10 ring-1 ring-primary-500'
                    : 'border-slate-700 bg-slate-900/50 hover:border-slate-600'
                }`}
              >
                <div className="flex items-start gap-3">
                  {getPresetIcon(preset.name)}
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-medium text-white">{preset.name}</h4>
                    <p className="mt-1 text-xs text-slate-400 line-clamp-2">{preset.description}</p>
                    <div className="mt-2 flex gap-2">
                      <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${
                        preset.likelihood_adjustment > 0 ? 'bg-red-500/20 text-red-400' :
                        preset.likelihood_adjustment < 0 ? 'bg-green-500/20 text-green-400' :
                        'bg-slate-500/20 text-slate-400'
                      }`}>
                        L: {preset.likelihood_adjustment > 0 ? '+' : ''}{preset.likelihood_adjustment}
                      </span>
                      <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs ${
                        preset.impact_adjustment > 0 ? 'bg-red-500/20 text-red-400' :
                        preset.impact_adjustment < 0 ? 'bg-green-500/20 text-green-400' :
                        'bg-slate-500/20 text-slate-400'
                      }`}>
                        I: {preset.impact_adjustment > 0 ? '+' : ''}{preset.impact_adjustment}
                      </span>
                    </div>
                  </div>
                  {selectedPresetId === preset.id && (
                    <Check className="h-5 w-5 text-primary-400 flex-shrink-0" />
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        {approach === 'custom' && (
          <div className="space-y-3">
            {selectedRiskIds.size === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">Select risks in Step 1 first</p>
            ) : (
              <>
                <div className="grid grid-cols-[1fr_120px_120px] gap-3 px-2 text-xs text-slate-500 font-medium">
                  <span>Risk</span>
                  <span className="text-center">Likelihood (1-5)</span>
                  <span className="text-center">Impact (1-5)</span>
                </div>
                <div className="max-h-80 overflow-y-auto space-y-1">
                  {Array.from(selectedRiskIds).map((riskId) => {
                    const risk = risks.find((r: any) => r.id === riskId);
                    if (!risk) return null;
                    const adj = customAdjustments[riskId] || {
                      likelihood: scoreType === 'inherent' ? (risk.inherent_likelihood || 3) : (risk.residual_likelihood || 3),
                      impact: scoreType === 'inherent' ? (risk.inherent_impact || 3) : (risk.residual_impact || 3),
                    };
                    return (
                      <div key={riskId} className="grid grid-cols-[1fr_120px_120px] gap-3 items-center rounded-lg bg-slate-900/50 px-3 py-2 border border-slate-700">
                        <div className="min-w-0">
                          <span className="text-sm text-white truncate block">{risk.title}</span>
                          <span className="text-xs text-slate-500">{risk.risk_category}</span>
                        </div>
                        <input
                          type="number"
                          min={1}
                          max={5}
                          value={adj.likelihood}
                          onChange={(e) => {
                            const val = Math.max(1, Math.min(5, Number(e.target.value)));
                            setCustomAdjustments((prev) => ({
                              ...prev,
                              [riskId]: { ...prev[riskId], likelihood: val },
                            }));
                          }}
                          className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm text-white text-center"
                        />
                        <input
                          type="number"
                          min={1}
                          max={5}
                          value={adj.impact}
                          onChange={(e) => {
                            const val = Math.max(1, Math.min(5, Number(e.target.value)));
                            setCustomAdjustments((prev) => ({
                              ...prev,
                              [riskId]: { ...prev[riskId], impact: val },
                            }));
                          }}
                          className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-1.5 text-sm text-white text-center"
                        />
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center gap-4">
        <input
          type="text"
          placeholder="Scenario name (optional)"
          value={scenarioName}
          onChange={(e) => setScenarioName(e.target.value)}
          className="flex-1 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-white placeholder-slate-500"
        />
        <button
          onClick={handleRunAnalysis}
          disabled={!canRunAnalysis || analysisMutation.isPending}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-primary-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {analysisMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          Run Analysis
        </button>
      </div>

      {analysisMutation.isError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
          Failed to run scenario analysis. Please try again.
        </div>
      )}

      {results && (
        <div className="space-y-6">
          <h3 className="text-white font-semibold flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary-400" />
            Analysis Results
          </h3>

          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
              <p className="text-xs text-slate-400">Risks Analyzed</p>
              <p className="mt-1 text-2xl font-bold text-white">{results.summary.total_risks_analyzed}</p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
              <p className="text-xs text-slate-400">Total Original Score</p>
              <p className="mt-1 text-2xl font-bold text-white">{results.summary.total_original_score}</p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
              <p className="text-xs text-slate-400">Total Adjusted Score</p>
              <p className="mt-1 text-2xl font-bold text-white">{results.summary.total_adjusted_score}</p>
            </div>
            <div className={`rounded-xl border p-4 ${
              results.summary.total_change > 0
                ? 'border-red-500/30 bg-red-500/10'
                : results.summary.total_change < 0
                ? 'border-green-500/30 bg-green-500/10'
                : 'border-slate-700 bg-slate-800'
            }`}>
              <p className="text-xs text-slate-400">Total Change</p>
              <p className={`mt-1 text-2xl font-bold flex items-center gap-1 ${
                results.summary.total_change > 0 ? 'text-red-400' :
                results.summary.total_change < 0 ? 'text-green-400' : 'text-white'
              }`}>
                {results.summary.total_change > 0 && <TrendingUp className="h-5 w-5" />}
                {results.summary.total_change < 0 && <TrendingDown className="h-5 w-5" />}
                {results.summary.total_change === 0 && <Minus className="h-5 w-5" />}
                {results.summary.total_change > 0 ? '+' : ''}{results.summary.total_change}
              </p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
              <p className="text-xs text-slate-400">Increased / Decreased</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-lg font-bold text-red-400">{results.summary.risks_increased}</span>
                <span className="text-slate-600">/</span>
                <span className="text-lg font-bold text-green-400">{results.summary.risks_decreased}</span>
              </div>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
              <p className="text-xs text-slate-400">Unchanged</p>
              <p className="mt-1 text-2xl font-bold text-slate-300">{results.summary.risks_unchanged}</p>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={handleAIExplain}
              disabled={aiExplainMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:from-purple-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-purple-500/20 transition-all"
            >
              {aiExplainMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              AI Explain Results
            </button>
          </div>

          {aiExplainMutation.isError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
              Failed to generate AI explanation. Please try again.
            </div>
          )}

          {aiExplanation && (
            <div className="rounded-xl border border-purple-500/30 bg-gradient-to-br from-purple-500/5 to-blue-500/5 p-6">
              <div className="flex items-center gap-2 mb-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-r from-purple-600 to-blue-600">
                  <Sparkles className="h-4 w-4 text-white" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white">AI Business Impact Analysis</h4>
                  <p className="text-xs text-slate-400">Plain-English explanation of scenario results</p>
                </div>
              </div>
              <div className="prose prose-invert prose-sm max-w-none text-slate-300 leading-relaxed whitespace-pre-wrap">
                {aiExplanation}
              </div>
            </div>
          )}

          <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 bg-slate-900/50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Risk</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Category</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-slate-400">Original Score</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-slate-400"></th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-slate-400">Adjusted Score</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-slate-400">Change</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-slate-400">Change %</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-slate-400">Severity</th>
                  </tr>
                </thead>
                <tbody>
                  {results.results.map((row) => (
                    <tr key={row.risk_id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                      <td className="px-4 py-3 text-white font-medium max-w-[200px] truncate">{row.risk_title}</td>
                      <td className="px-4 py-3 text-slate-400">{row.risk_category}</td>
                      <td className="px-4 py-3 text-center text-white">{row.original_score}</td>
                      <td className="px-4 py-3 text-center">
                        <ChevronRight className="h-4 w-4 text-slate-600 mx-auto" />
                      </td>
                      <td className="px-4 py-3 text-center text-white font-medium">{row.adjusted_score}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1 ${
                          row.score_change > 0 ? 'text-red-400' :
                          row.score_change < 0 ? 'text-green-400' : 'text-slate-400'
                        }`}>
                          {row.score_change > 0 && <TrendingUp className="h-3.5 w-3.5" />}
                          {row.score_change < 0 && <TrendingDown className="h-3.5 w-3.5" />}
                          {row.score_change > 0 ? '+' : ''}{row.score_change}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs ${
                          row.score_change_pct > 0 ? 'text-red-400' :
                          row.score_change_pct < 0 ? 'text-green-400' : 'text-slate-400'
                        }`}>
                          {row.score_change_pct > 0 ? '+' : ''}{row.score_change_pct.toFixed(1)}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <span className={`inline-block rounded px-2 py-0.5 text-xs border ${getSeverityColor(row.severity_original)}`}>
                            {row.severity_original}
                          </span>
                          {row.severity_original !== row.severity_adjusted && (
                            <>
                              <ChevronRight className="h-3 w-3 text-slate-600 flex-shrink-0" />
                              <span className={`inline-block rounded px-2 py-0.5 text-xs border ${getSeverityColor(row.severity_adjusted)}`}>
                                {row.severity_adjusted}
                              </span>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
