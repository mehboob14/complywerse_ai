'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { risksApi, dashboardApi } from '@/lib/api';
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
  User,
  Edit2,
  Trash2,
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle,
  BarChart3,
  ArrowUp,
  ArrowDown,
  Minus,
  Target,
  Activity,
  Zap
} from 'lucide-react';
import Link from 'next/link';
import { useRef } from 'react';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from 'recharts';

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

const SCORE_COLORS = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
};

const TREATMENT_COLORS: Record<string, string> = {
  mitigate: '#3b82f6',
  accept: '#22c55e',
  transfer: '#a855f7',
  avoid: '#ef4444',
  untreated: '#64748b',
};

const darkTooltipStyle = {
  backgroundColor: '#1e293b',
  border: '1px solid #334155',
  borderRadius: '8px',
  color: '#fff',
  fontSize: '12px',
};

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

const getScoreLabel = (score: number) => {
  if (score >= 20) return 'Critical';
  if (score >= 12) return 'High';
  if (score >= 6) return 'Medium';
  return 'Low';
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

const CATEGORY_COLORS: Record<string, string> = {
  strategic: '#a855f7',
  operational: '#3b82f6',
  financial: '#22c55e',
  compliance: '#eab308',
  technology: '#06b6d4',
  third_party: '#f97316',
};

export default function RisksPage() {
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

  const { data: enhancedStats } = useQuery({
    queryKey: ['dashboard-enhanced-stats'],
    queryFn: async () => {
      const response = await dashboardApi.getEnhancedStats();
      return response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<Risk>) => risksApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['risks'] });
      queryClient.invalidateQueries({ queryKey: ['risks-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['risks-heatmap'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-enhanced-stats'] });
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
      queryClient.invalidateQueries({ queryKey: ['dashboard-enhanced-stats'] });
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
      queryClient.invalidateQueries({ queryKey: ['dashboard-enhanced-stats'] });
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

  const scoreDistribution = useMemo(() => {
    if (!computedDashboard?.by_score_range) return [];
    const { critical, high, medium, low } = computedDashboard.by_score_range;
    return [
      { name: 'Critical', value: critical || 0, color: SCORE_COLORS.critical },
      { name: 'High', value: high || 0, color: SCORE_COLORS.high },
      { name: 'Medium', value: medium || 0, color: SCORE_COLORS.medium },
      { name: 'Low', value: low || 0, color: SCORE_COLORS.low },
    ].filter(d => d.value > 0);
  }, [computedDashboard]);

  const treatmentDistribution = useMemo(() => {
    if (enhancedStats?.risk_treatment_distribution) {
      return Object.entries(enhancedStats.risk_treatment_distribution).map(([key, value]) => ({
        name: key.charAt(0).toUpperCase() + key.slice(1),
        value: value as number,
        color: TREATMENT_COLORS[key] || '#64748b',
      })).filter(d => d.value > 0);
    }
    if (!risks) return [];
    const dist: Record<string, number> = {};
    risks.forEach((r: Risk) => {
      const t = r.treatment || 'untreated';
      dist[t] = (dist[t] || 0) + 1;
    });
    return Object.entries(dist).map(([key, value]) => ({
      name: key.charAt(0).toUpperCase() + key.slice(1),
      value,
      color: TREATMENT_COLORS[key] || '#64748b',
    })).filter(d => d.value > 0);
  }, [enhancedStats, risks]);

  const categoryBarData = useMemo(() => {
    if (!computedDashboard?.by_category) return [];
    return Object.entries(computedDashboard.by_category)
      .map(([cat, count]) => ({
        name: getCategoryStyle(cat as RiskCategory).label,
        count: count as number,
        fill: CATEGORY_COLORS[cat] || '#64748b',
      }))
      .sort((a, b) => b.count - a.count);
  }, [computedDashboard]);

  const inherentVsResidualData = useMemo(() => {
    if (!risks || risks.length === 0) return [];
    const catMap: Record<string, { inherent: number; residual: number; count: number }> = {};
    risks.forEach((r: Risk) => {
      const cat = r.risk_category || 'operational';
      if (!catMap[cat]) catMap[cat] = { inherent: 0, residual: 0, count: 0 };
      catMap[cat].inherent += r.inherent_score || 0;
      catMap[cat].residual += r.residual_score || 0;
      catMap[cat].count++;
    });
    return Object.entries(catMap).map(([cat, data]) => ({
      name: getCategoryStyle(cat as RiskCategory).label,
      inherent: data.count > 0 ? Math.round((data.inherent / data.count) * 10) / 10 : 0,
      residual: data.count > 0 ? Math.round((data.residual / data.count) * 10) / 10 : 0,
    }));
  }, [risks]);

  const riskMovement = useMemo(() => {
    if (enhancedStats?.risk_movement) return enhancedStats.risk_movement;
    if (!risks) return { improved: 0, unchanged: 0, worsened: 0 };
    let improved = 0, unchanged = 0, worsened = 0;
    risks.forEach((r: Risk) => {
      const inh = r.inherent_score || 0;
      const res = r.residual_score || 0;
      if (res < inh) improved++;
      else if (res === inh) unchanged++;
      else worsened++;
    });
    return { improved, unchanged, worsened };
  }, [enhancedStats, risks]);

  const topCriticalRisks = useMemo(() => {
    if (enhancedStats?.top_risks) return enhancedStats.top_risks.slice(0, 5);
    if (!risks) return [];
    return [...risks]
      .sort((a: Risk, b: Risk) => (b.inherent_score || 0) - (a.inherent_score || 0))
      .slice(0, 5)
      .map((r: Risk) => ({
        id: r.id,
        title: r.title,
        category: r.risk_category,
        inherent_score: r.inherent_score || 0,
        residual_score: r.residual_score || 0,
        treatment: r.treatment || 'untreated',
        status: r.status,
        owner: r.risk_owner,
      }));
  }, [enhancedStats, risks]);

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

  const totalRisks = computedDashboard?.total_risks || 0;
  const criticalCount = computedDashboard?.by_score_range?.critical || 0;
  const inTreatmentCount = computedDashboard?.by_status?.in_treatment || 0;
  const mitigatedCount = computedDashboard?.by_status?.mitigated || 0;
  const scoreReduction = totalRisks > 0 && computedDashboard
    ? Math.round(((computedDashboard.avg_inherent_score - computedDashboard.avg_residual_score) / Math.max(computedDashboard.avg_inherent_score, 1)) * 100)
    : 0;

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
        <div>
          <h1 className="text-2xl font-bold text-white">Enterprise Risk Management</h1>
          <p className="text-slate-400">Identify, assess, and manage organizational risks</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/risks/advanced"
            className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2 font-medium text-white hover:from-purple-700 hover:to-indigo-700"
          >
            <BarChart3 size={18} />
            Advanced ERM
          </Link>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            accept=".xlsx,.xls"
            className="hidden"
          />
          <a
            href="/api/risks/upload-template"
            download
            className="flex items-center gap-2 rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 font-medium text-slate-300 hover:bg-slate-700 hover:text-white"
          >
            <Download size={18} />
            Template
          </a>
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
        <div className={`card ${uploadResult.errors.length > 0 ? 'border border-red-500/50' : 'border border-green-500/50'}`}>
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
                {uploadResult.errors.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {uploadResult.errors.slice(0, 5).map((err, idx) => (
                      <p key={idx} className="text-xs text-red-400">{err}</p>
                    ))}
                  </div>
                )}
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

      {/* Row 1: KPI Cards */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
        <div className="rounded-xl border border-slate-700/50 bg-gradient-to-br from-slate-800 to-slate-800/50 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary-500/20 p-2.5">
              <AlertTriangle className="h-5 w-5 text-primary-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Total Risks</p>
              <p className="text-2xl font-bold text-white">{totalRisks}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-red-500/20 bg-gradient-to-br from-red-950/30 to-slate-800/50 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-red-500/20 p-2.5">
              <Zap className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Critical</p>
              <p className="text-2xl font-bold text-red-400">{criticalCount}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700/50 bg-gradient-to-br from-slate-800 to-slate-800/50 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-orange-500/20 p-2.5">
              <Shield className="h-5 w-5 text-orange-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Open</p>
              <p className="text-2xl font-bold text-white">{computedDashboard?.open_risks || 0}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-yellow-500/20 bg-gradient-to-br from-yellow-950/20 to-slate-800/50 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-yellow-500/20 p-2.5">
              <Activity className="h-5 w-5 text-yellow-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">In Treatment</p>
              <p className="text-2xl font-bold text-yellow-400">{inTreatmentCount + mitigatedCount}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-700/50 bg-gradient-to-br from-slate-800 to-slate-800/50 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-orange-500/20 p-2.5">
              <TrendingUp className="h-5 w-5 text-orange-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Avg Inherent</p>
              <p className="text-2xl font-bold text-white">
                {(computedDashboard?.avg_inherent_score || 0).toFixed(1)}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-green-500/20 bg-gradient-to-br from-green-950/20 to-slate-800/50 p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-500/20 p-2.5">
              <TrendingDown className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">Avg Residual</p>
              <p className="text-2xl font-bold text-green-400">
                {(computedDashboard?.avg_residual_score || 0).toFixed(1)}
              </p>
              {scoreReduction > 0 && (
                <p className="text-[10px] text-green-500 flex items-center gap-0.5">
                  <ArrowDown size={10} /> {scoreReduction}% reduction
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Row 2: Heatmap + Score Distribution Donut + Treatment Donut */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* Heatmap */}
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-semibold text-white">Risk Heatmap</h2>
            <div className="flex gap-1">
              <button
                onClick={() => {
                  setHeatmapType('inherent');
                  setSelectedHeatmapCell(null);
                }}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
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
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
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
                          <span className="text-white font-bold">{cell.count}</span>
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
              className="mt-3 w-full rounded bg-slate-700 py-1.5 text-xs text-slate-300 hover:bg-slate-600 transition-colors"
            >
              Clear heatmap filter
            </button>
          )}
        </div>

        {/* Score Distribution + Treatment Distribution */}
        <div className="grid gap-6 lg:col-span-3 grid-cols-1 md:grid-cols-2">
          {/* Score Distribution Donut */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-5">
            <h2 className="text-base font-semibold text-white mb-3">Risk Score Distribution</h2>
            {scoreDistribution.length > 0 ? (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={scoreDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                      stroke="none"
                    >
                      {scoreDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={darkTooltipStyle} />
                    <Legend
                      verticalAlign="bottom"
                      iconType="circle"
                      iconSize={8}
                      formatter={(value: string) => <span className="text-xs text-slate-300">{value}</span>}
                    />
                    <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" className="fill-white text-2xl font-bold">
                      {totalRisks}
                    </text>
                    <text x="50%" y="58%" textAnchor="middle" dominantBaseline="middle" className="fill-slate-400 text-[10px]">
                      Total
                    </text>
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[220px] text-slate-500 text-sm">
                No risk data available
              </div>
            )}
          </div>

          {/* Treatment Distribution Donut */}
          <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-5">
            <h2 className="text-base font-semibold text-white mb-3">Treatment Strategy</h2>
            {treatmentDistribution.length > 0 ? (
              <div className="h-[220px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={treatmentDistribution}
                      cx="50%"
                      cy="50%"
                      innerRadius={55}
                      outerRadius={80}
                      paddingAngle={3}
                      dataKey="value"
                      stroke="none"
                    >
                      {treatmentDistribution.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={darkTooltipStyle} />
                    <Legend
                      verticalAlign="bottom"
                      iconType="circle"
                      iconSize={8}
                      formatter={(value: string) => <span className="text-xs text-slate-300">{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[220px] text-slate-500 text-sm">
                No treatment data
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Row 3: Category Breakdown + Inherent vs Residual */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Category Breakdown */}
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-5">
          <h2 className="text-base font-semibold text-white mb-4">Risks by Category</h2>
          {categoryBarData.length > 0 ? (
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryBarData} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} />
                  <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#475569' }} />
                  <YAxis type="category" dataKey="name" tick={{ fill: '#cbd5e1', fontSize: 11 }} width={85} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={darkTooltipStyle} cursor={{ fill: 'rgba(148,163,184,0.1)' }} />
                  <Bar dataKey="count" radius={[0, 4, 4, 0]} barSize={18}>
                    {categoryBarData.map((entry, index) => (
                      <Cell key={`bar-${index}`} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center h-[220px] text-slate-500 text-sm">
              No category data
            </div>
          )}
        </div>

        {/* Inherent vs Residual Comparison */}
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-5">
          <h2 className="text-base font-semibold text-white mb-1">Inherent vs Residual by Category</h2>
          <p className="text-xs text-slate-400 mb-3">Average scores showing control effectiveness</p>
          {inherentVsResidualData.length > 0 ? (
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={inherentVsResidualData} margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} axisLine={{ stroke: '#475569' }} interval={0} angle={-15} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: '#475569' }} />
                  <Tooltip contentStyle={darkTooltipStyle} />
                  <Legend
                    verticalAlign="top"
                    iconType="circle"
                    iconSize={8}
                    formatter={(value: string) => <span className="text-xs text-slate-300">{value}</span>}
                  />
                  <Bar dataKey="inherent" name="Inherent" fill="#f97316" radius={[4, 4, 0, 0]} barSize={16} />
                  <Bar dataKey="residual" name="Residual" fill="#22c55e" radius={[4, 4, 0, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex items-center justify-center h-[220px] text-slate-500 text-sm">
              No comparison data
            </div>
          )}
        </div>
      </div>

      {/* Row 4: Risk Movement + Top Critical Risks */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Risk Movement */}
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-5">
          <h2 className="text-base font-semibold text-white mb-4">Risk Score Movement</h2>
          <p className="text-xs text-slate-400 mb-4">Inherent → Residual comparison</p>
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg bg-green-500/10 border border-green-500/20 p-3">
              <div className="rounded-full bg-green-500/20 p-2">
                <ArrowDown className="h-5 w-5 text-green-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-green-400">Improved</p>
                <p className="text-xs text-slate-400">Score decreased</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-green-400">{riskMovement.improved}</p>
                {totalRisks > 0 && (
                  <p className="text-xs text-slate-500">{Math.round((riskMovement.improved / totalRisks) * 100)}%</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg bg-slate-500/10 border border-slate-500/20 p-3">
              <div className="rounded-full bg-slate-500/20 p-2">
                <Minus className="h-5 w-5 text-slate-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-300">Unchanged</p>
                <p className="text-xs text-slate-400">Same score</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-slate-300">{riskMovement.unchanged}</p>
                {totalRisks > 0 && (
                  <p className="text-xs text-slate-500">{Math.round((riskMovement.unchanged / totalRisks) * 100)}%</p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg bg-red-500/10 border border-red-500/20 p-3">
              <div className="rounded-full bg-red-500/20 p-2">
                <ArrowUp className="h-5 w-5 text-red-400" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-red-400">Worsened</p>
                <p className="text-xs text-slate-400">Score increased</p>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-red-400">{riskMovement.worsened}</p>
                {totalRisks > 0 && (
                  <p className="text-xs text-slate-500">{Math.round((riskMovement.worsened / totalRisks) * 100)}%</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Top Critical Risks */}
        <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-white">Top Critical Risks</h2>
            <Target className="h-5 w-5 text-red-400" />
          </div>
          {topCriticalRisks.length > 0 ? (
            <div className="space-y-2">
              {topCriticalRisks.map((risk: any, idx: number) => {
                const scoreColor = getScoreColor(risk.inherent_score);
                const resColor = getScoreColor(risk.residual_score);
                const catStyle = getCategoryStyle(risk.category as RiskCategory);
                return (
                  <div
                    key={risk.id}
                    className={`flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-slate-700/30 ${
                      risk.inherent_score >= 20 ? 'border-red-500/30 bg-red-950/10' :
                      risk.inherent_score >= 12 ? 'border-orange-500/20 bg-orange-950/10' :
                      'border-slate-700/50'
                    }`}
                  >
                    <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                      idx === 0 ? 'bg-red-500/20 text-red-400' :
                      idx === 1 ? 'bg-orange-500/20 text-orange-400' :
                      'bg-slate-700 text-slate-300'
                    }`}>
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{risk.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${catStyle.bgColor} ${catStyle.color}`}>
                          {catStyle.label}
                        </span>
                        {risk.treatment && risk.treatment !== 'untreated' && (
                          <span className="text-[10px] text-slate-400 capitalize">{risk.treatment}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="text-center">
                        <p className="text-[10px] text-slate-500 uppercase">Inherent</p>
                        <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${scoreColor.bg} ${scoreColor.text}`}>
                          {risk.inherent_score}
                        </span>
                      </div>
                      <ArrowDown size={12} className="text-green-400" />
                      <div className="text-center">
                        <p className="text-[10px] text-slate-500 uppercase">Residual</p>
                        <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${resColor.bg} ${resColor.text}`}>
                          {risk.residual_score || '-'}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-center h-[200px] text-slate-500 text-sm">
              No risks to display
            </div>
          )}
        </div>
      </div>

      {/* Row 5: Risk Register Table */}
      <div className="rounded-xl border border-slate-700/50 bg-slate-800/50 p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center mb-4">
          <h2 className="text-base font-semibold text-white">Risk Register</h2>
          <span className="rounded-full bg-slate-700 px-2.5 py-0.5 text-xs font-medium text-slate-300">
            {filteredRisks.length} {filteredRisks.length === 1 ? 'risk' : 'risks'}
          </span>
          <div className="flex-1" />
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search risks..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full sm:w-64 rounded-lg border border-slate-600 bg-slate-700/50 py-2 pl-10 pr-4 text-sm text-white placeholder-slate-400 focus:border-primary-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as RiskCategory | 'all')}
              className="rounded-lg border border-slate-600 bg-slate-700/50 px-3 py-2 text-xs text-white focus:border-primary-500 focus:outline-none"
            >
              <option value="all">All Categories</option>
              {RISK_CATEGORIES.map(cat => (
                <option key={cat.value} value={cat.value}>{cat.label}</option>
              ))}
            </select>

            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as RiskStatus | 'all')}
              className="rounded-lg border border-slate-600 bg-slate-700/50 px-3 py-2 text-xs text-white focus:border-primary-500 focus:outline-none"
            >
              <option value="all">All Status</option>
              {RISK_STATUSES.map(status => (
                <option key={status.value} value={status.value}>{status.label}</option>
              ))}
            </select>

            <select
              value={scoreFilter}
              onChange={(e) => setScoreFilter(e.target.value as ScoreFilter)}
              className="rounded-lg border border-slate-600 bg-slate-700/50 px-3 py-2 text-xs text-white focus:border-primary-500 focus:outline-none"
            >
              <option value="all">All Scores</option>
              <option value="critical">Critical (≥20)</option>
              <option value="high">High (12-19)</option>
              <option value="medium">Medium (6-11)</option>
              <option value="low">Low (&lt;6)</option>
            </select>
          </div>
        </div>

        <div className="space-y-2">
          {filteredRisks.map((risk: Risk) => {
            const categoryStyle = getCategoryStyle(risk.risk_category);
            const statusStyle = getStatusStyle(risk.status);
            const inherentColor = getScoreColor(risk.inherent_score);
            const residualColor = getScoreColor(risk.residual_score);
            const borderClass = risk.inherent_score && risk.inherent_score >= 20 ? 'border-l-red-500' :
              risk.inherent_score && risk.inherent_score >= 12 ? 'border-l-orange-500' :
              risk.inherent_score && risk.inherent_score >= 6 ? 'border-l-yellow-500' :
              'border-l-green-500';
            
            return (
              <div
                key={risk.id}
                className={`rounded-lg border border-slate-700/50 bg-slate-800/30 p-4 border-l-[3px] ${borderClass} hover:bg-slate-700/30 transition-colors`}
              >
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-white">
                        {risk.title}
                      </p>
                      {risk.gap_finding_id && (
                        <span className="inline-flex items-center rounded-full bg-purple-500/20 px-2 py-0.5 text-[10px] text-purple-400 font-medium">
                          Gap Acceptance
                        </span>
                      )}
                    </div>
                    {risk.description && (
                      <p className="mt-1 text-xs text-slate-400 line-clamp-1">{risk.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${categoryStyle.bgColor} ${categoryStyle.color}`}>
                        {categoryStyle.label}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusStyle.bgColor} ${statusStyle.color}`}>
                        {statusStyle.label}
                      </span>
                      {risk.treatment && risk.treatment !== 'untreated' && (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-indigo-500/20 text-indigo-400 capitalize">
                          {risk.treatment}
                        </span>
                      )}
                      {risk.owner_name && (
                        <span className="flex items-center gap-1 text-[11px] text-slate-400">
                          <User size={11} />
                          {risk.owner_name}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <div className="text-center">
                      <p className="text-[10px] text-slate-500 uppercase mb-1">Inherent</p>
                      {risk.inherent_score ? (
                        <div>
                          <span className={`rounded px-2 py-1 text-sm font-bold ${inherentColor.bg} ${inherentColor.text}`}>
                            {risk.inherent_score}
                          </span>
                          <p className="text-[9px] text-slate-500 mt-0.5">{risk.inherent_likelihood}×{risk.inherent_impact}</p>
                        </div>
                      ) : (
                        <span className="text-slate-500 text-sm">-</span>
                      )}
                    </div>

                    {risk.inherent_score && risk.residual_score ? (
                      <div className="flex flex-col items-center">
                        {risk.residual_score < risk.inherent_score ? (
                          <ArrowDown size={14} className="text-green-400" />
                        ) : risk.residual_score > risk.inherent_score ? (
                          <ArrowUp size={14} className="text-red-400" />
                        ) : (
                          <Minus size={14} className="text-slate-500" />
                        )}
                      </div>
                    ) : null}

                    <div className="text-center">
                      <p className="text-[10px] text-slate-500 uppercase mb-1">Residual</p>
                      {risk.residual_score ? (
                        <div>
                          <span className={`rounded px-2 py-1 text-sm font-bold ${residualColor.bg} ${residualColor.text}`}>
                            {risk.residual_score}
                          </span>
                          <p className="text-[9px] text-slate-500 mt-0.5">{risk.residual_likelihood}×{risk.residual_impact}</p>
                        </div>
                      ) : (
                        <span className="text-slate-500 text-sm">-</span>
                      )}
                    </div>

                    <div className="flex items-center gap-1 ml-2 border-l border-slate-700 pl-3">
                      <button
                        onClick={() => {
                          setEditingRisk(risk);
                          setIsModalOpen(true);
                        }}
                        className="rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-white transition-colors"
                        title="Edit"
                      >
                        <Edit2 size={15} />
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('Are you sure you want to delete this risk?')) {
                            deleteMutation.mutate(risk.id);
                          }
                        }}
                        className="rounded p-1.5 text-slate-400 hover:bg-red-900/50 hover:text-red-400 transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {filteredRisks.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <AlertTriangle className="mb-4 h-12 w-12 text-slate-600" />
            <h3 className="text-lg font-medium text-white">No risks found</h3>
            <p className="mt-1 text-slate-400">
              {searchTerm || statusFilter !== 'all' || categoryFilter !== 'all' || scoreFilter !== 'all' || selectedHeatmapCell
                ? 'Try adjusting your filters'
                : 'Add your first risk to start tracking'}
            </p>
          </div>
        )}
      </div>

      {isModalOpen && (
        <RiskModal
          risk={editingRisk}
          onClose={() => {
            setIsModalOpen(false);
            setEditingRisk(null);
          }}
          onSave={(data) => {
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
  onSave,
  isLoading,
}: {
  risk: Risk | null;
  onClose: () => void;
  onSave: (data: Partial<Risk>) => void;
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState({
    title: risk?.title || '',
    description: risk?.description || '',
    risk_category: risk?.risk_category || 'operational' as RiskCategory,
    inherent_likelihood: risk?.inherent_likelihood || 3,
    inherent_impact: risk?.inherent_impact || 3,
    residual_likelihood: risk?.residual_likelihood || undefined as number | undefined,
    residual_impact: risk?.residual_impact || undefined as number | undefined,
    status: risk?.status || 'open' as RiskStatus,
    treatment_plan: risk?.treatment_plan || '',
    due_date: risk?.due_date || '',
  });

  const inherentScore = formData.inherent_likelihood * formData.inherent_impact;
  const residualScore = formData.residual_likelihood && formData.residual_impact 
    ? formData.residual_likelihood * formData.residual_impact 
    : undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      ...formData,
      inherent_score: inherentScore,
      residual_score: residualScore,
      residual_likelihood: formData.residual_likelihood || undefined,
      residual_impact: formData.residual_impact || undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-slate-800 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            {risk ? 'Edit Risk' : 'Create Risk'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300">Title *</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300">Category</label>
              <select
                value={formData.risk_category}
                onChange={(e) => setFormData({ ...formData, risk_category: e.target.value as RiskCategory })}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
              >
                {RISK_CATEGORIES.map(cat => (
                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300">Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as RiskStatus })}
                className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
              >
                {RISK_STATUSES.map(status => (
                  <option key={status.value} value={status.value}>{status.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-lg border border-slate-600 p-3">
            <h3 className="mb-3 text-sm font-medium text-slate-300">Inherent Risk Assessment</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-slate-400">Likelihood (1-5)</label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={formData.inherent_likelihood}
                  onChange={(e) => setFormData({ ...formData, inherent_likelihood: parseInt(e.target.value) || 1 })}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400">Impact (1-5)</label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={formData.inherent_impact}
                  onChange={(e) => setFormData({ ...formData, inherent_impact: parseInt(e.target.value) || 1 })}
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400">Score</label>
                <div className={`mt-1 flex items-center justify-center rounded-lg px-3 py-2 text-lg font-bold ${getScoreColor(inherentScore).bg} ${getScoreColor(inherentScore).text}`}>
                  {inherentScore}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-600 p-3">
            <h3 className="mb-3 text-sm font-medium text-slate-300">Residual Risk Assessment (Optional)</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-slate-400">Likelihood (1-5)</label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={formData.residual_likelihood || ''}
                  onChange={(e) => setFormData({ ...formData, residual_likelihood: parseInt(e.target.value) || undefined })}
                  placeholder="-"
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white placeholder-slate-500 focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400">Impact (1-5)</label>
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={formData.residual_impact || ''}
                  onChange={(e) => setFormData({ ...formData, residual_impact: parseInt(e.target.value) || undefined })}
                  placeholder="-"
                  className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white placeholder-slate-500 focus:border-primary-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400">Score</label>
                <div className={`mt-1 flex items-center justify-center rounded-lg px-3 py-2 text-lg font-bold ${residualScore ? getScoreColor(residualScore).bg : 'bg-slate-700'} ${residualScore ? getScoreColor(residualScore).text : 'text-slate-500'}`}>
                  {residualScore || '-'}
                </div>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300">Treatment Plan</label>
            <textarea
              value={formData.treatment_plan}
              onChange={(e) => setFormData({ ...formData, treatment_plan: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
              rows={2}
              placeholder="Describe mitigation strategies..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300">Due Date</label>
            <input
              type="date"
              value={formData.due_date}
              onChange={(e) => setFormData({ ...formData, due_date: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-white focus:border-primary-500 focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-600 px-4 py-2 text-slate-300 hover:bg-slate-700"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {risk ? 'Update' : 'Create'} Risk
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
