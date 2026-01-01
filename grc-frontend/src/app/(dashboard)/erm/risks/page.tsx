'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { risksApi } from '@/lib/api';
import { Risk, RiskCategory, RiskStatus, RiskDashboard, HeatmapCell } from '@/types';
import { 
  AlertTriangle, 
  Loader2, 
  AlertCircle, 
  Search, 
  Plus,
  X,
  TrendingUp,
  TrendingDown,
  Shield,
  Edit2,
  Trash2,
  Upload,
  CheckCircle,
} from 'lucide-react';
import Link from 'next/link';
import { useRef } from 'react';

type ScoreFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';

const RISK_CATEGORIES: { value: RiskCategory; label: string; color: string; bgColor: string }[] = [
  { value: 'strategic', label: 'Strategic', color: 'text-purple-400', bgColor: 'bg-purple-500/20' },
  { value: 'operational', label: 'Operational', color: 'text-blue-400', bgColor: 'bg-blue-500/20' },
  { value: 'financial', label: 'Financial', color: 'text-green-400', bgColor: 'bg-green-500/20' },
  { value: 'compliance', label: 'Compliance', color: 'text-yellow-400', bgColor: 'bg-yellow-500/20' },
  { value: 'technology', label: 'Technology', color: 'text-cyan-400', bgColor: 'bg-cyan-500/20' },
  { value: 'third_party', label: 'Third Party', color: 'text-orange-400', bgColor: 'bg-orange-500/20' },
];

const RISK_STATUSES: { value: RiskStatus; label: string; color: string; bgColor: string }[] = [
  { value: 'open', label: 'Open', color: 'text-red-400', bgColor: 'bg-red-500/20' },
  { value: 'in_treatment', label: 'In Treatment', color: 'text-yellow-400', bgColor: 'bg-yellow-500/20' },
  { value: 'mitigated', label: 'Mitigated', color: 'text-green-400', bgColor: 'bg-green-500/20' },
  { value: 'accepted', label: 'Accepted', color: 'text-blue-400', bgColor: 'bg-blue-500/20' },
  { value: 'closed', label: 'Closed', color: 'text-slate-400', bgColor: 'bg-slate-500/20' },
];

const getCategoryStyle = (category: RiskCategory) => {
  return RISK_CATEGORIES.find(c => c.value === category) || RISK_CATEGORIES[0];
};

const getStatusStyle = (status: RiskStatus) => {
  return RISK_STATUSES.find(s => s.value === status) || RISK_STATUSES[0];
};

const getScoreColor = (score: number | undefined) => {
  if (!score) return { text: 'text-slate-400', bg: 'bg-slate-500/20' };
  if (score >= 20) return { text: 'text-red-400', bg: 'bg-red-500/20' };
  if (score >= 12) return { text: 'text-orange-400', bg: 'bg-orange-500/20' };
  if (score >= 6) return { text: 'text-yellow-400', bg: 'bg-yellow-500/20' };
  return { text: 'text-green-400', bg: 'bg-green-500/20' };
};

const getHeatmapCellColor = (likelihood: number, impact: number) => {
  const score = likelihood * impact;
  if (score >= 20) return 'bg-red-600/80 hover:bg-red-600';
  if (score >= 15) return 'bg-red-500/60 hover:bg-red-500/80';
  if (score >= 12) return 'bg-orange-500/60 hover:bg-orange-500/80';
  if (score >= 8) return 'bg-yellow-500/60 hover:bg-yellow-500/80';
  if (score >= 4) return 'bg-yellow-400/40 hover:bg-yellow-400/60';
  return 'bg-green-500/40 hover:bg-green-500/60';
};

export default function ERMRisksPage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<RiskStatus | 'all'>('all');
  const [categoryFilter, setCategoryFilter] = useState<RiskCategory | 'all'>('all');
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>('all');
  const [heatmapType, setHeatmapType] = useState<'inherent' | 'residual'>('inherent');
  const [selectedHeatmapCell, setSelectedHeatmapCell] = useState<{l: number, i: number} | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRisk, setEditingRisk] = useState<Risk | null>(null);
  const [uploadResult, setUploadResult] = useState<{ message: string; created: number; skipped: number; errors: string[] } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: risks, isLoading, error } = useQuery({
    queryKey: ['risks'],
    queryFn: async () => {
      const response = await risksApi.getAll();
      return response.data;
    },
  });

  const { data: dashboard } = useQuery({
    queryKey: ['risks-dashboard'],
    queryFn: async () => {
      const response = await risksApi.getDashboard();
      return response.data;
    },
  });

  const { data: heatmapData } = useQuery({
    queryKey: ['risks-heatmap', heatmapType],
    queryFn: async () => {
      const response = await risksApi.getHeatmap(heatmapType);
      return response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<Risk>) => risksApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['risks'] });
      queryClient.invalidateQueries({ queryKey: ['risks-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['risks-heatmap'] });
      setIsModalOpen(false);
      setEditingRisk(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Risk> }) => risksApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['risks'] });
      queryClient.invalidateQueries({ queryKey: ['risks-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['risks-heatmap'] });
      setIsModalOpen(false);
      setEditingRisk(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => risksApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['risks'] });
      queryClient.invalidateQueries({ queryKey: ['risks-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['risks-heatmap'] });
    },
  });

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setIsUploading(true);
    setUploadResult(null);
    
    try {
      const response = await risksApi.uploadRiskRegister(file);
      setUploadResult(response.data);
      queryClient.invalidateQueries({ queryKey: ['risks'] });
      queryClient.invalidateQueries({ queryKey: ['risks-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['risks-heatmap'] });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to upload file';
      setUploadResult({
        message: errorMessage,
        created: 0,
        skipped: 0,
        errors: [errorMessage],
      });
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const heatmapMatrix = useMemo(() => {
    const matrix: Record<string, { count: number; risks: Array<{id: number; title: string; score: number}> }> = {};
    for (let l = 1; l <= 5; l++) {
      for (let i = 1; i <= 5; i++) {
        matrix[`${l}-${i}`] = { count: 0, risks: [] };
      }
    }
    
    if (heatmapData) {
      heatmapData.forEach((cell: HeatmapCell) => {
        matrix[`${cell.likelihood}-${cell.impact}`] = { count: cell.count, risks: cell.risks };
      });
    } else if (risks) {
      risks.forEach((risk: Risk) => {
        const likelihood = heatmapType === 'inherent' ? risk.inherent_likelihood : risk.residual_likelihood;
        const impact = heatmapType === 'inherent' ? risk.inherent_impact : risk.residual_impact;
        const score = heatmapType === 'inherent' ? risk.inherent_score : risk.residual_score;
        if (likelihood && impact) {
          const key = `${likelihood}-${impact}`;
          if (matrix[key]) {
            matrix[key].count++;
            matrix[key].risks.push({ id: risk.id, title: risk.title, score: score || 0 });
          }
        }
      });
    }
    return matrix;
  }, [risks, heatmapData, heatmapType]);

  const computedDashboard = useMemo(() => {
    if (dashboard) return dashboard;
    if (!risks) return null;
    
    const byCategory: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let totalInherent = 0;
    let totalResidual = 0;
    let inherentCount = 0;
    let residualCount = 0;
    let critical = 0, high = 0, medium = 0, low = 0;
    let openRisks = 0;
    
    risks.forEach((risk: Risk) => {
      byCategory[risk.risk_category] = (byCategory[risk.risk_category] || 0) + 1;
      byStatus[risk.status] = (byStatus[risk.status] || 0) + 1;
      
      if (risk.inherent_score) {
        totalInherent += risk.inherent_score;
        inherentCount++;
        if (risk.inherent_score >= 20) critical++;
        else if (risk.inherent_score >= 12) high++;
        else if (risk.inherent_score >= 6) medium++;
        else low++;
      }
      
      if (risk.residual_score) {
        totalResidual += risk.residual_score;
        residualCount++;
      }
      
      if (risk.status === 'open') openRisks++;
    });
    
    return {
      total_risks: risks.length,
      by_category: byCategory,
      by_status: byStatus,
      by_score_range: { critical, high, medium, low },
      avg_inherent_score: inherentCount > 0 ? totalInherent / inherentCount : 0,
      avg_residual_score: residualCount > 0 ? totalResidual / residualCount : 0,
      open_risks: openRisks,
      risks_needing_review: 0,
    };
  }, [risks, dashboard]);

  const filteredRisks = useMemo(() => {
    if (!risks) return [];
    
    return risks.filter((risk: Risk) => {
      const matchesSearch = 
        risk.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        risk.description?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesStatus = statusFilter === 'all' || risk.status === statusFilter;
      const matchesCategory = categoryFilter === 'all' || risk.risk_category === categoryFilter;
      
      let matchesScore = true;
      const score = risk.inherent_score || 0;
      if (scoreFilter === 'critical') matchesScore = score >= 20;
      else if (scoreFilter === 'high') matchesScore = score >= 12 && score < 20;
      else if (scoreFilter === 'medium') matchesScore = score >= 6 && score < 12;
      else if (scoreFilter === 'low') matchesScore = score < 6;
      
      let matchesHeatmap = true;
      if (selectedHeatmapCell) {
        const likelihood = heatmapType === 'inherent' ? risk.inherent_likelihood : risk.residual_likelihood;
        const impact = heatmapType === 'inherent' ? risk.inherent_impact : risk.residual_impact;
        matchesHeatmap = likelihood === selectedHeatmapCell.l && impact === selectedHeatmapCell.i;
      }
      
      return matchesSearch && matchesStatus && matchesCategory && matchesScore && matchesHeatmap;
    });
  }, [risks, searchTerm, statusFilter, categoryFilter, scoreFilter, selectedHeatmapCell, heatmapType]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-64 flex-col items-center justify-center text-red-400">
        <AlertCircle className="mb-2 h-8 w-8" />
        <p>Failed to load risks</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".xlsx,.xls"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className="flex items-center gap-2 rounded-lg bg-slate-700 px-4 py-2 font-medium text-white hover:bg-slate-600 disabled:opacity-50"
          >
            {isUploading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Upload size={18} />
            )}
            Upload Register
          </button>
          <button
            onClick={() => {
              setEditingRisk(null);
              setIsModalOpen(true);
            }}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700"
          >
            <Plus size={18} />
            Add Risk
          </button>
        </div>
      </div>

      {uploadResult && (
        <div className={`rounded-xl border p-4 ${uploadResult.errors.length > 0 ? 'border-red-500/50 bg-slate-800' : 'border-green-500/50 bg-slate-800'}`}>
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              {uploadResult.errors.length > 0 ? (
                <AlertCircle className="h-5 w-5 text-red-400 mt-0.5" />
              ) : (
                <CheckCircle className="h-5 w-5 text-green-400 mt-0.5" />
              )}
              <div>
                <p className="font-medium text-white">{uploadResult.message}</p>
                <div className="mt-1 flex gap-4 text-sm">
                  <span className="text-green-400">Created: {uploadResult.created}</span>
                  <span className="text-yellow-400">Skipped: {uploadResult.skipped}</span>
                  {uploadResult.errors.length > 0 && (
                    <span className="text-red-400">Errors: {uploadResult.errors.length}</span>
                  )}
                </div>
              </div>
            </div>
            <button
              onClick={() => setUploadResult(null)}
              className="text-slate-400 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary-500/20 p-2">
              <AlertTriangle className="h-5 w-5 text-primary-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Total Risks</p>
              <p className="text-2xl font-bold text-white">{computedDashboard?.total_risks || 0}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-red-500/20 p-2">
              <Shield className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Open Risks</p>
              <p className="text-2xl font-bold text-white">{computedDashboard?.open_risks || 0}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-orange-500/20 p-2">
              <TrendingUp className="h-5 w-5 text-orange-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Avg Inherent</p>
              <p className="text-2xl font-bold text-white">
                {(computedDashboard?.avg_inherent_score || 0).toFixed(1)}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-500/20 p-2">
              <TrendingDown className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="text-sm text-slate-400">Avg Residual</p>
              <p className="text-2xl font-bold text-white">
                {(computedDashboard?.avg_residual_score || 0).toFixed(1)}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4 lg:col-span-1">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Risk Heatmap</h2>
            <div className="flex gap-1">
              <button
                onClick={() => {
                  setHeatmapType('inherent');
                  setSelectedHeatmapCell(null);
                }}
                className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                  heatmapType === 'inherent'
                    ? 'bg-primary-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                Inherent
              </button>
              <button
                onClick={() => {
                  setHeatmapType('residual');
                  setSelectedHeatmapCell(null);
                }}
                className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                  heatmapType === 'residual'
                    ? 'bg-primary-600 text-white'
                    : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                }`}
              >
                Residual
              </button>
            </div>
          </div>

          <div className="flex">
            <div className="flex flex-col justify-between pr-2 text-xs text-slate-500">
              <span>5</span>
              <span>4</span>
              <span>3</span>
              <span>2</span>
              <span>1</span>
            </div>
            <div className="flex-1">
              <div className="grid aspect-square grid-cols-5 gap-1">
                {[5, 4, 3, 2, 1].map((likelihood) =>
                  [1, 2, 3, 4, 5].map((impact) => {
                    const cell = heatmapMatrix[`${likelihood}-${impact}`];
                    const isSelected = selectedHeatmapCell?.l === likelihood && selectedHeatmapCell?.i === impact;
                    return (
                      <button
                        key={`${likelihood}-${impact}`}
                        onClick={() => {
                          if (isSelected) {
                            setSelectedHeatmapCell(null);
                          } else {
                            setSelectedHeatmapCell({ l: likelihood, i: impact });
                          }
                        }}
                        className={`flex items-center justify-center rounded text-xs font-medium transition-all ${
                          getHeatmapCellColor(likelihood, impact)
                        } ${isSelected ? 'ring-2 ring-white ring-offset-1 ring-offset-slate-900' : ''}`}
                        title={`L${likelihood} x I${impact} = ${likelihood * impact}`}
                      >
                        {cell?.count > 0 && (
                          <span className="text-white">{cell.count}</span>
                        )}
                      </button>
                    );
                  })
                )}
              </div>
              <div className="mt-2 flex justify-between text-xs text-slate-500">
                <span>1</span>
                <span>Impact</span>
                <span>5</span>
              </div>
            </div>
          </div>
          <div className="mt-2 text-center text-xs text-slate-500">
            Likelihood (Y-axis) × Impact (X-axis)
          </div>
          {selectedHeatmapCell && (
            <button
              onClick={() => setSelectedHeatmapCell(null)}
              className="mt-3 w-full rounded bg-slate-700 py-1 text-xs text-slate-300 hover:bg-slate-600"
            >
              Clear filter
            </button>
          )}
        </div>

        <div className="space-y-4 lg:col-span-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search risks..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-lg border border-slate-600 bg-slate-800 py-2 pl-10 pr-4 text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as RiskCategory | 'all')}
                className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
              >
                <option value="all">All Categories</option>
                {RISK_CATEGORIES.map(cat => (
                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as RiskStatus | 'all')}
                className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
              >
                <option value="all">All Statuses</option>
                {RISK_STATUSES.map(status => (
                  <option key={status.value} value={status.value}>{status.label}</option>
                ))}
              </select>

              <select
                value={scoreFilter}
                onChange={(e) => setScoreFilter(e.target.value as ScoreFilter)}
                className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
              >
                <option value="all">All Scores</option>
                <option value="critical">Critical (≥20)</option>
                <option value="high">High (12-19)</option>
                <option value="medium">Medium (6-11)</option>
                <option value="low">Low (&lt;6)</option>
              </select>
            </div>
          </div>

          <div className="space-y-3">
            {filteredRisks.length === 0 ? (
              <div className="rounded-xl border border-slate-700 bg-slate-800 p-8 text-center">
                <AlertTriangle className="mx-auto h-10 w-10 text-slate-500" />
                <p className="mt-2 text-slate-400">No risks found matching your criteria</p>
              </div>
            ) : (
              filteredRisks.map((risk) => {
                const categoryStyle = getCategoryStyle(risk.risk_category);
                const statusStyle = getStatusStyle(risk.status);
                const scoreColor = getScoreColor(risk.inherent_score);
                
                return (
                  <div
                    key={risk.id}
                    className="rounded-xl border border-slate-700 bg-slate-800 p-4 hover:border-slate-600"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <Link href={`/risks/${risk.id}`} className="text-lg font-medium text-white hover:text-primary-400">
                          {risk.title}
                        </Link>
                        {risk.description && (
                          <p className="mt-1 text-sm text-slate-400 line-clamp-2">{risk.description}</p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${categoryStyle.bgColor} ${categoryStyle.color}`}>
                            {categoryStyle.label}
                          </span>
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle.bgColor} ${statusStyle.color}`}>
                            {statusStyle.label}
                          </span>
                        </div>
                      </div>
                      <div className="ml-4 flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-xs text-slate-500">Inherent</p>
                          <p className={`text-lg font-bold ${scoreColor.text}`}>
                            {risk.inherent_score || '—'}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-slate-500">Residual</p>
                          <p className={`text-lg font-bold ${getScoreColor(risk.residual_score).text}`}>
                            {risk.residual_score || '—'}
                          </p>
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => {
                              setEditingRisk(risk);
                              setIsModalOpen(true);
                            }}
                            className="rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm('Are you sure you want to delete this risk?')) {
                                deleteMutation.mutate(risk.id);
                              }
                            }}
                            className="rounded p-1.5 text-slate-400 hover:bg-red-500/20 hover:text-red-400"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {isModalOpen && (
        <RiskModal
          risk={editingRisk}
          onClose={() => {
            setIsModalOpen(false);
            setEditingRisk(null);
          }}
          onSubmit={(data) => {
            if (editingRisk) {
              updateMutation.mutate({ id: editingRisk.id, data });
            } else {
              createMutation.mutate(data);
            }
          }}
          isLoading={createMutation.isPending || updateMutation.isPending}
        />
      )}
    </div>
  );
}

function RiskModal({
  risk,
  onClose,
  onSubmit,
  isLoading,
}: {
  risk: Risk | null;
  onClose: () => void;
  onSubmit: (data: Partial<Risk>) => void;
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState({
    title: risk?.title || '',
    description: risk?.description || '',
    risk_category: risk?.risk_category || 'operational' as RiskCategory,
    status: risk?.status || 'open' as RiskStatus,
    inherent_likelihood: risk?.inherent_likelihood || 3,
    inherent_impact: risk?.inherent_impact || 3,
    residual_likelihood: risk?.residual_likelihood || 2,
    residual_impact: risk?.residual_impact || 2,
    treatment_plan: risk?.treatment_plan || '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      inherent_score: formData.inherent_likelihood * formData.inherent_impact,
      residual_score: formData.residual_likelihood * formData.residual_impact,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-slate-800 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">{risk ? 'Edit Risk' : 'Create Risk'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm text-slate-400">Title</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white"
              required
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400">Category</label>
              <select
                value={formData.risk_category}
                onChange={(e) => setFormData({ ...formData, risk_category: e.target.value as RiskCategory })}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white"
              >
                {RISK_CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-400">Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as RiskStatus })}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white"
              >
                {RISK_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400">Inherent Likelihood (1-5)</label>
              <input
                type="number"
                min="1"
                max="5"
                value={formData.inherent_likelihood}
                onChange={(e) => setFormData({ ...formData, inherent_likelihood: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400">Inherent Impact (1-5)</label>
              <input
                type="number"
                min="1"
                max="5"
                value={formData.inherent_impact}
                onChange={(e) => setFormData({ ...formData, inherent_impact: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-400">Residual Likelihood (1-5)</label>
              <input
                type="number"
                min="1"
                max="5"
                value={formData.residual_likelihood}
                onChange={(e) => setFormData({ ...formData, residual_likelihood: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-400">Residual Impact (1-5)</label>
              <input
                type="number"
                min="1"
                max="5"
                value={formData.residual_impact}
                onChange={(e) => setFormData({ ...formData, residual_impact: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-400">Treatment Plan</label>
            <textarea
              value={formData.treatment_plan}
              onChange={(e) => setFormData({ ...formData, treatment_plan: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white"
              rows={2}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-500 disabled:opacity-50"
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {risk ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
