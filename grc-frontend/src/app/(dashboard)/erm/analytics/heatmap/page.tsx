'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ermApi } from '@/lib/api';
import Link from 'next/link';
import {
  ArrowLeft,
  Loader2,
  X,
  AlertTriangle,
  AlertOctagon,
  Shield,
  CheckCircle,
  BarChart3,
  Filter,
  RotateCcw,
} from 'lucide-react';
import { MultiSelectDropdown } from '@/components/ui/MultiSelectDropdown';
import { PageLoader } from '@/components/ui';

const LIKELIHOOD_LABELS = ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost Certain'];
const IMPACT_LABELS = ['Insignificant', 'Minor', 'Moderate', 'Major', 'Catastrophic'];

const CATEGORIES = [
  { value: 'strategic', label: 'Strategic' },
  { value: 'operational', label: 'Operational' },
  { value: 'financial', label: 'Financial' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'technology', label: 'Technology' },
  { value: 'reputational', label: 'Reputational' },
  { value: 'third_party', label: 'Third Party' },
];

function getCellColor(score: number): string {
  if (score >= 17) return 'bg-red-600 hover:bg-red-500';
  if (score >= 10) return 'bg-orange-500 hover:bg-orange-400';
  if (score >= 5) return 'bg-yellow-500 hover:bg-yellow-400';
  return 'bg-green-600 hover:bg-green-500';
}

function getCellBorderColor(score: number): string {
  if (score >= 17) return 'ring-red-400';
  if (score >= 10) return 'ring-orange-400';
  if (score >= 5) return 'ring-yellow-400';
  return 'ring-green-400';
}

interface HeatmapRisk {
  id: number;
  title: string;
  category?: string;
  owner?: string;
  inherent_score?: number;
  residual_score?: number;
  score?: number;
}

interface HeatmapCell {
  likelihood: number;
  impact: number;
  score: number;
  count: number;
  risks: HeatmapRisk[];
}

interface HeatmapResponse {
  cells: HeatmapCell[];
  total_risks: number;
  max_count: number;
  likelihood_labels: string[];
  impact_labels: string[];
}

export default function InteractiveHeatMapPage() {
  const [scoreType, setScoreType] = useState<string>('inherent');
  const [category, setCategory] = useState<string>('');
  const [businessUnitId, setBusinessUnitId] = useState<number | undefined>(undefined);
  const [selectedCell, setSelectedCell] = useState<HeatmapCell | null>(null);

  const params = useMemo(() => {
    const p: Record<string, any> = { score_type: scoreType };
    if (category) p.category = category;
    if (businessUnitId) p.business_unit_id = businessUnitId;
    return p;
  }, [scoreType, category, businessUnitId]);

  const { data, isLoading } = useQuery({
    queryKey: ['erm-interactive-heatmap', params],
    queryFn: async () => {
      const response = await ermApi.analytics.getInteractiveHeatmap(params);
      return response.data as HeatmapResponse;
    },
  });

  const cellMap = useMemo(() => {
    const map: Record<string, HeatmapCell> = {};
    if (data?.cells) {
      data.cells.forEach((cell) => {
        map[`${cell.likelihood}-${cell.impact}`] = cell;
      });
    }
    return map;
  }, [data]);

  const summary = useMemo(() => {
    if (!data?.cells) return { total: 0, critical: 0, high: 0, medium: 0, low: 0 };
    let critical = 0, high = 0, medium = 0, low = 0;
    data.cells.forEach((cell) => {
      if (cell.score > 16) critical += cell.count;
      else if (cell.score >= 9 && cell.score <= 16) high += cell.count;
      else if (cell.score >= 4 && cell.score <= 9) medium += cell.count;
      else if (cell.score <= 4) low += cell.count;
    });
    return { total: data.total_risks || 0, critical, high, medium, low };
  }, [data]);

  const clearFilters = () => {
    setScoreType('inherent');
    setCategory('');
    setBusinessUnitId(undefined);
  };

  const hasFilters = scoreType !== 'inherent' || category !== '' || businessUnitId !== undefined;

  const likelihoodLabels = data?.likelihood_labels || LIKELIHOOD_LABELS;
  const impactLabels = data?.impact_labels || IMPACT_LABELS;

  return (
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6">
      <div className="flex items-center gap-4">
        <Link
          href="/erm/analytics"
          className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900">Interactive Risk Heat Map</h1>
          <p className="text-sm text-slate-600">Visualize risk distribution across likelihood and impact dimensions</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3.5">
        <Filter className="h-4 w-4 text-slate-600" />
        <div className="flex rounded-lg border border-slate-300 overflow-hidden">
          <button
            onClick={() => setScoreType('inherent')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              scoreType === 'inherent'
                ? 'bg-primary-600 text-[#0a0a0a] hover:bg-primary-700'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Inherent
          </button>
          <button
            onClick={() => setScoreType('residual')}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              scoreType === 'residual'
                ? 'bg-primary-600 text-[#0a0a0a] hover:bg-primary-700'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Residual
          </button>
        </div>

        <MultiSelectDropdown
          title="Category"
          items={[
            { value: '', label: 'All Categories' },
            ...CATEGORIES.map((cat) => ({ value: cat.value, label: cat.label })),
          ]}
          selectedValues={[category]}
          onApply={(values) => setCategory(values[0] ?? '')}
          multiSelect={false}
        />

        {hasFilters && (
          <button
            onClick={clearFilters}
            className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-700 hover:bg-slate-200"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Clear Filters
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-3.5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary-50 p-2">
              <BarChart3 className="h-5 w-5 text-primary-600" strokeWidth={1.75} />
            </div>
            <div>
              <p className="text-sm text-slate-600">Total Risks</p>
              <p className="text-2xl font-bold text-slate-900">{summary.total}</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-red-500/10 p-2">
              <AlertOctagon className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <p className="text-sm text-slate-600">Critical (&gt;16)</p>
              <p className="text-2xl font-bold text-red-400">{summary.critical}</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-orange-500/10 p-2">
              <AlertTriangle className="h-5 w-5 text-orange-400" />
            </div>
            <div>
              <p className="text-sm text-slate-600">High (9-16)</p>
              <p className="text-2xl font-bold text-orange-400">{summary.high}</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-yellow-500/10 p-2">
              <Shield className="h-5 w-5 text-yellow-400" />
            </div>
            <div>
              <p className="text-sm text-slate-600">Medium (4-9)</p>
              <p className="text-2xl font-bold text-yellow-400">{summary.medium}</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3.5">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-500/10 p-2">
              <CheckCircle className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="text-sm text-slate-600">Low (≤4)</p>
              <p className="text-2xl font-bold text-green-400">{summary.low}</p>
            </div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <PageLoader className="h-64" />
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-4.5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-slate-900">
              {scoreType === 'inherent' ? 'Inherent' : 'Residual'} Risk Heat Map
              {category && ` — ${CATEGORIES.find(c => c.value === category)?.label}`}
            </h2>
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded bg-green-600" />
                <span className="text-xs text-slate-600">Low (1-4)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded bg-yellow-500" />
                <span className="text-xs text-slate-600">Medium (5-9)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded bg-orange-500" />
                <span className="text-xs text-slate-600">High (10-16)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-4 h-4 rounded bg-red-600" />
                <span className="text-xs text-slate-600">Critical (17-25)</span>
              </div>
            </div>
          </div>

          <div className="flex">
            <div className="flex flex-col items-center justify-center mr-2">
              <span className="text-xs text-slate-500 font-medium -rotate-90 whitespace-nowrap">
                Likelihood →
              </span>
            </div>

            <div className="flex flex-col justify-between pr-3 py-1" style={{ width: '100px' }}>
              {[...likelihoodLabels].reverse().map((label, idx) => (
                <div key={idx} className="h-16 flex items-center justify-end text-right">
                  <span className="text-xs text-slate-600 truncate">{label}</span>
                </div>
              ))}
            </div>

            <div className="flex-1">
              <div className="grid grid-cols-5 gap-1.5">
                {[5, 4, 3, 2, 1].map((likelihood) =>
                  [1, 2, 3, 4, 5].map((impact) => {
                    const key = `${likelihood}-${impact}`;
                    const cell = cellMap[key];
                    const score = likelihood * impact;
                    const count = cell?.count || 0;

                    return (
                      <button
                        key={key}
                        onClick={() => {
                          if (cell && cell.count > 0) {
                            setSelectedCell(cell);
                          }
                        }}
                        className={`relative h-14 rounded-lg flex flex-col items-center justify-center cursor-pointer transition-all duration-200 ${getCellColor(score)} ${
                          count > 0 ? `ring-1 ${getCellBorderColor(score)}` : ''
                        }`}
                      >
                        <span className={`font-bold ${count > 0 ? 'text-white text-lg' : 'text-white/60 text-sm'}`}>
                          {count > 0 ? count : '·'}
                        </span>
                        <span className="text-[10px] text-white/80">{score}</span>
                      </button>
                    );
                  })
                )}
              </div>

              <div className="flex justify-between mt-3 px-1">
                {impactLabels.map((label, idx) => (
                  <div key={idx} className="text-xs text-slate-600 text-center flex-1">
                    {label}
                  </div>
                ))}
              </div>
              <div className="text-center mt-2 text-xs text-slate-500 font-medium">
                Impact →
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedCell && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" onClick={() => setSelectedCell(null)}>
          <div
            className="w-full max-w-lg rounded-xl bg-white border border-slate-200 p-4.5 mx-4 max-h-[78vh] overflow-y-auto shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3.5">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Cell Detail — L{selectedCell.likelihood} × I{selectedCell.impact}
                </h2>
                <p className="text-sm text-slate-600">
                  Score: {selectedCell.score} · {selectedCell.count} risk{selectedCell.count !== 1 ? 's' : ''}
                </p>
              </div>
              <button
                onClick={() => setSelectedCell(null)}
                className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {selectedCell.risks.length > 0 ? (
              <div className="space-y-3">
                {selectedCell.risks.map((risk) => (
                  <div
                    key={risk.id}
                    className="rounded-lg border border-slate-300 bg-slate-100/50 p-4"
                  >
                    <h3 className="font-medium text-slate-900">{risk.title}</h3>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                      {risk.category && (
                        <div>
                          <span className="text-slate-600">Category: </span>
                          <span className="text-slate-900 capitalize">{risk.category.replace('_', ' ')}</span>
                        </div>
                      )}
                      {risk.owner && (
                        <div>
                          <span className="text-slate-600">Owner: </span>
                          <span className="text-slate-900">{risk.owner}</span>
                        </div>
                      )}
                      {risk.inherent_score !== undefined && (
                        <div>
                          <span className="text-slate-600">Inherent: </span>
                          <span className="text-slate-900">{risk.inherent_score}</span>
                        </div>
                      )}
                      {risk.residual_score !== undefined && (
                        <div>
                          <span className="text-slate-600">Residual: </span>
                          <span className="text-slate-900">{risk.residual_score}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-600">No risks in this cell.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
