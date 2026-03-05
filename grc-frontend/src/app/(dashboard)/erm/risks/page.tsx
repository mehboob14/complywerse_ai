'use client';

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminApi, assetsApi, ermApi } from '@/lib/api';
import { ITAsset, Risk, RiskCategory, RiskStatus, RiskDashboard, HeatmapCell } from '@/types';
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
  Download,
  CheckCircle,
  Lock,
  Unlock,
  ListTodo,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Check,
  Zap,
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
  { value: 'project_change', label: 'Project/Change', color: 'text-pink-400', bgColor: 'bg-pink-500/20' },
  { value: 'internal', label: 'Internal', color: 'text-slate-700', bgColor: 'bg-slate-500/20' },
];

const REGISTER_TYPES = [
  { value: 'PCI-DSS', label: 'PCI-DSS' },
  { value: 'ISO 27001', label: 'ISO 27001' },
  { value: 'SOX', label: 'SOX' },
  { value: 'GDPR', label: 'GDPR' },
  { value: 'NIST', label: 'NIST' },
  { value: 'SAMA CSF', label: 'SAMA CSF' },
  { value: 'Internal', label: 'Internal' },
  { value: 'Project-Based', label: 'Project-Based' },
  { value: 'Third-Party', label: 'Third-Party' },
  { value: 'Other', label: 'Other' },
];

const normalizeFilterValue = (value: string | null | undefined) =>
  (value || '').toString().trim().toLowerCase();

const canonicalFilterValue = (value: string | null | undefined) =>
  normalizeFilterValue(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');

const filterValuesMatch = (left: string | null | undefined, right: string | null | undefined) => {
  const leftCanonical = canonicalFilterValue(left);
  const rightCanonical = canonicalFilterValue(right);

  if (!leftCanonical || !rightCanonical) return false;
  return (
    leftCanonical === rightCanonical ||
    leftCanonical.includes(rightCanonical) ||
    rightCanonical.includes(leftCanonical)
  );
};

const inferEffectiveRiskCategory = (risk: Risk): RiskCategory => {
  const legacyCategory = (risk as Risk & { category?: string }).category;
  const categoryText = [
    risk.risk_category,
    legacyCategory,
    risk.register_type,
    risk.title,
    risk.description,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  if (/(gdpr|privacy|lawfulness|data subject|regulatory|compliance|legal)/.test(categoryText)) return 'compliance';
  if (/(technology|cyber|security|network|system|information security|iso ?27001|nist|pci)/.test(categoryText)) return 'technology';
  if (/(financial|budget|cost|credit|liquidity|sox|soc ?2|basel)/.test(categoryText)) return 'financial';
  if (/(vendor|supplier|third party|outsourcing|partner)/.test(categoryText)) return 'third_party';
  if (/(project|change|implementation|transformation)/.test(categoryText)) return 'project_change';
  if (/(strategy|strategic|market|reputation|brand)/.test(categoryText)) return 'strategic';
  if (/(internal|fraud|governance|culture|integrity)/.test(categoryText)) return 'internal';
  return 'operational';
};

const SUB_CATEGORIES_BY_CATEGORY: Record<RiskCategory, string[]> = {
  strategic: ['Market', 'Reputation', 'Strategic Planning', 'Competitive', 'Brand', 'Other'],
  operational: ['Process', 'Human Resources', 'Supply Chain', 'Business Continuity', 'Quality', 'Other'],
  financial: ['Credit', 'Market Risk', 'Liquidity', 'Accounting', 'Budget', 'Other'],
  compliance: ['Regulatory', 'Legal', 'Contractual', 'Ethical', 'Data Privacy', 'Other'],
  technology: ['Cybersecurity', 'Infrastructure', 'Data', 'System Availability', 'Software', 'Other'],
  third_party: ['Vendor', 'Outsourcing', 'Partnership', 'Contractor', 'Other'],
  project_change: ['Project Delivery', 'Change Management', 'Integration', 'Scope', 'Other'],
  internal: ['Fraud', 'Governance', 'Culture', 'Process Integrity', 'Other'],
};

const DEPARTMENTS = [
  { id: 1, name: 'IT' },
  { id: 2, name: 'Finance' },
  { id: 3, name: 'Operations' },
  { id: 4, name: 'HR' },
  { id: 5, name: 'Legal' },
  { id: 6, name: 'Sales' },
  { id: 7, name: 'Marketing' },
  { id: 8, name: 'Security' },
];

const RISK_STATUSES: { value: RiskStatus; label: string; color: string; bgColor: string }[] = [
  { value: 'open', label: 'Open', color: 'text-red-400', bgColor: 'bg-red-500/20' },
  { value: 'in_treatment', label: 'In Treatment', color: 'text-yellow-400', bgColor: 'bg-yellow-500/20' },
  { value: 'mitigated', label: 'Mitigated', color: 'text-green-400', bgColor: 'bg-green-500/20' },
  { value: 'accepted', label: 'Accepted', color: 'text-blue-400', bgColor: 'bg-blue-500/20' },
  { value: 'closed', label: 'Closed', color: 'text-slate-600', bgColor: 'bg-slate-500/20' },
];

const getCategoryStyle = (category: string | null | undefined) => {
  const canonicalCategory = canonicalFilterValue(category);
  const matched = RISK_CATEGORIES.find((item) => canonicalFilterValue(item.value) === canonicalCategory);
  if (matched) return matched;

  const fallbackLabel = (category || 'Other')
    .toString()
    .trim()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());

  return {
    value: 'operational' as RiskCategory,
    label: fallbackLabel,
    color: 'text-slate-700',
    bgColor: 'bg-slate-100',
  };
};

const getStatusStyle = (status: RiskStatus) => {
  return RISK_STATUSES.find(s => s.value === status) || RISK_STATUSES[0];
};

const getScoreColor = (score: number | undefined) => {
  if (!score) return { text: 'text-slate-600', bg: 'bg-slate-500/20' };
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
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [registerTypeFilter, setRegisterTypeFilter] = useState<string>('all');
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>('all');
  const [heatmapType, setHeatmapType] = useState<'inherent' | 'residual'>('inherent');
  const [selectedHeatmapCell, setSelectedHeatmapCell] = useState<{l: number, i: number} | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingRisk, setEditingRisk] = useState<Risk | null>(null);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [selectedRegisterType, setSelectedRegisterType] = useState<string>('');
  const [uploadResult, setUploadResult] = useState<{ message: string; created: number; skipped: number; errors: string[] } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: risks, isLoading, error } = useQuery({
    queryKey: ['erm-risks'],
    queryFn: async () => {
      const response = await ermApi.risks.getAll();
      return response.data;
    },
  });

  const { data: dashboard } = useQuery({
    queryKey: ['erm-risks-dashboard'],
    queryFn: async () => {
      const response = await ermApi.risks.getDashboard();
      return response.data;
    },
  });

  const { data: heatmapData } = useQuery({
    queryKey: ['erm-risks-heatmap', heatmapType],
    queryFn: async () => {
      const response = await ermApi.risks.getHeatmap(heatmapType);
      return response.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: Partial<Risk>) => ermApi.risks.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['erm-risks'] });
      queryClient.invalidateQueries({ queryKey: ['erm-risks-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['erm-risks-heatmap'] });
      setIsModalOpen(false);
      setEditingRisk(null);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<Risk> }) => ermApi.risks.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['erm-risks'] });
      queryClient.invalidateQueries({ queryKey: ['erm-risks-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['erm-risks-heatmap'] });
      setIsModalOpen(false);
      setEditingRisk(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => ermApi.risks.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['erm-risks'] });
      queryClient.invalidateQueries({ queryKey: ['erm-risks-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['erm-risks-heatmap'] });
    },
  });

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setIsUploading(true);
    setUploadResult(null);
    
    try {
      const response = await ermApi.risks.uploadRiskRegister(file, selectedRegisterType || undefined);
      setUploadResult(response.data);
      queryClient.invalidateQueries({ queryKey: ['erm-risks'] });
      queryClient.invalidateQueries({ queryKey: ['erm-risks-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['erm-risks-heatmap'] });
      setIsUploadModalOpen(false);
      setSelectedRegisterType('');
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

  const handleDownloadTemplate = async () => {
    try {
      const response = await ermApi.risks.downloadTemplate();
      const blob = new Blob([
        response.data,
      ], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'risk_register_template.xlsx';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to download risk register template', error);
      setUploadResult({
        message: 'Failed to download risk register template',
        created: 0,
        skipped: 0,
        errors: ['Template download failed'],
      });
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
      
      const effectiveCategory = inferEffectiveRiskCategory(risk);
      const riskRegisterType = risk.register_type;

      const matchesStatus = statusFilter === 'all' || risk.status === statusFilter;
      const matchesCategory = categoryFilter === 'all' || filterValuesMatch(effectiveCategory, categoryFilter);
      const matchesRegisterType = registerTypeFilter === 'all' || filterValuesMatch(riskRegisterType, registerTypeFilter);
      
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
      
      return matchesSearch && matchesStatus && matchesCategory && matchesRegisterType && matchesScore && matchesHeatmap;
    });
  }, [risks, searchTerm, statusFilter, categoryFilter, registerTypeFilter, scoreFilter, selectedHeatmapCell, heatmapType]);

  const availableCategoryOptions = useMemo(() => {
    const valuesByCanonical = new Map<string, string>();

    RISK_CATEGORIES.forEach((item) => {
      const canonical = canonicalFilterValue(item.value);
      if (canonical && !valuesByCanonical.has(canonical)) {
        valuesByCanonical.set(canonical, item.value);
      }
    });

    (risks || []).forEach((risk) => {
      const legacyCategory = (risk as Risk & { category?: string }).category;
      const value = (risk.risk_category || legacyCategory || '').trim();
      const canonical = canonicalFilterValue(value);
      if (canonical && !valuesByCanonical.has(canonical)) {
        valuesByCanonical.set(canonical, value);
      }
    });

    return Array.from(valuesByCanonical.values()).map((value) => ({
      value,
      label: value
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (match) => match.toUpperCase()),
    }));
  }, [risks]);

  const availableRegisterTypeOptions = useMemo(() => {
    const valuesByCanonical = new Map<string, string>();

    REGISTER_TYPES.forEach((item) => {
      const canonical = canonicalFilterValue(item.value);
      if (canonical && !valuesByCanonical.has(canonical)) {
        valuesByCanonical.set(canonical, item.value);
      }
    });

    (risks || []).forEach((risk) => {
      const value = (risk.register_type || '').trim();
      const canonical = canonicalFilterValue(value);
      if (canonical && !valuesByCanonical.has(canonical)) {
        valuesByCanonical.set(canonical, value);
      }
    });

    return Array.from(valuesByCanonical.values()).map((value) => ({ value, label: value }));
  }, [risks]);

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
            onClick={() => setIsUploadModalOpen(true)}
            disabled={isUploading}
            className="flex items-center gap-2 rounded-lg bg-slate-100 px-4 py-2 font-medium text-slate-900 hover:bg-slate-200 disabled:opacity-50"
          >
            {isUploading ? (
              <Loader2 size={18} className="animate-spin" />
            ) : (
              <Upload size={18} />
            )}
            Upload Register
          </button>
          <button
            onClick={handleDownloadTemplate}
            className="flex items-center gap-2 rounded-lg bg-white px-4 py-2 font-medium text-slate-900 border border-slate-300 hover:bg-slate-50"
          >
            <Download size={18} />
            Download Template
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
        <div className={`rounded-xl border p-4 ${uploadResult.errors.length > 0 ? 'border-red-500/50 bg-white' : 'border-green-500/50 bg-white'}`}>
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              {uploadResult.errors.length > 0 ? (
                <AlertCircle className="h-5 w-5 text-red-400 mt-0.5" />
              ) : (
                <CheckCircle className="h-5 w-5 text-green-400 mt-0.5" />
              )}
              <div>
                <p className="font-medium text-slate-900">{uploadResult.message}</p>
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
              className="text-slate-600 hover:text-slate-900"
            >
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary-500/20 p-2">
              <AlertTriangle className="h-5 w-5 text-primary-400" />
            </div>
            <div>
              <p className="text-sm text-slate-600">Total Risks</p>
              <p className="text-2xl font-bold text-slate-900">{computedDashboard?.total_risks || 0}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-red-500/20 p-2">
              <Shield className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <p className="text-sm text-slate-600">Open Risks</p>
              <p className="text-2xl font-bold text-slate-900">{computedDashboard?.open_risks || 0}</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-orange-500/20 p-2">
              <TrendingUp className="h-5 w-5 text-orange-400" />
            </div>
            <div>
              <p className="text-sm text-slate-600">Avg Inherent</p>
              <p className="text-2xl font-bold text-slate-900">
                {(computedDashboard?.avg_inherent_score || 0).toFixed(1)}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-500/20 p-2">
              <TrendingDown className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="text-sm text-slate-600">Avg Residual</p>
              <p className="text-2xl font-bold text-slate-900">
                {(computedDashboard?.avg_residual_score || 0).toFixed(1)}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 lg:col-span-1">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Risk Heatmap</h2>
            <div className="flex gap-1">
              <button
                onClick={() => {
                  setHeatmapType('inherent');
                  setSelectedHeatmapCell(null);
                }}
                className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                  heatmapType === 'inherent'
                    ? 'bg-primary-600 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
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
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
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
                        } ${isSelected ? 'ring-2 ring-white ring-offset-1 ring-offset-white' : ''}`}
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
              className="mt-3 w-full rounded bg-slate-100 py-1 text-xs text-slate-700 hover:bg-slate-200"
            >
              Clear filter
            </button>
          )}
        </div>

        <div className="space-y-4 lg:col-span-2">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600" />
              <input
                type="text"
                placeholder="Search risks..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-4 text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
              >
                <option value="all">All Categories</option>
                {availableCategoryOptions.map((cat) => (
                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                ))}
              </select>

              <select
                value={registerTypeFilter}
                onChange={(e) => setRegisterTypeFilter(e.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
              >
                <option value="all">All Register Types</option>
                {availableRegisterTypeOptions.map((type) => (
                  <option key={type.value} value={type.value}>{type.label}</option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as RiskStatus | 'all')}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
              >
                <option value="all">All Statuses</option>
                {RISK_STATUSES.map(status => (
                  <option key={status.value} value={status.value}>{status.label}</option>
                ))}
              </select>

              <select
                value={scoreFilter}
                onChange={(e) => setScoreFilter(e.target.value as ScoreFilter)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
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
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
                <AlertTriangle className="mx-auto h-10 w-10 text-slate-500" />
                <p className="mt-2 text-slate-600">No risks found matching your criteria</p>
              </div>
            ) : (
              filteredRisks.map((risk) => {
                const categoryStyle = getCategoryStyle(inferEffectiveRiskCategory(risk));
                const statusStyle = getStatusStyle(risk.status);
                const scoreColor = getScoreColor(risk.inherent_score);
                
                return (
                  <div
                    key={risk.id}
                    className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <Link href={`/risks/${risk.id}`} className="text-lg font-medium text-slate-900 hover:text-primary-400">
                          {risk.title}
                        </Link>
                        {risk.description && (
                          <p className="mt-1 text-sm text-slate-600 line-clamp-2">{risk.description}</p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2">
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${categoryStyle.bgColor} ${categoryStyle.color}`}>
                            {categoryStyle.label}
                          </span>
                          {risk.risk_sub_category && (
                            <span className="rounded-full px-2.5 py-0.5 text-xs font-medium bg-slate-200/50 text-slate-700">
                              {risk.risk_sub_category}
                            </span>
                          )}
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle.bgColor} ${statusStyle.color}`}>
                            {statusStyle.label}
                          </span>
                          {risk.closure_status && (
                            <span className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              risk.closure_status === 'closed' 
                                ? 'bg-slate-500/30 text-slate-700' 
                                : 'bg-amber-500/20 text-amber-400'
                            }`}>
                              {risk.closure_status === 'closed' ? <Lock size={10} /> : <Unlock size={10} />}
                              {risk.closure_status === 'closed' ? 'Closed' : 'Pending Closure'}
                            </span>
                          )}
                          {(risk.mitigation_actions?.length || 0) > 0 && (
                            <span className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium bg-indigo-500/20 text-indigo-400">
                              <ListTodo size={10} />
                              {risk.mitigation_actions?.length} Actions
                            </span>
                          )}
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
                            className="rounded p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => {
                              if (confirm('Are you sure you want to delete this risk?')) {
                                deleteMutation.mutate(risk.id);
                              }
                            }}
                            className="rounded p-1.5 text-slate-600 hover:bg-red-500/20 hover:text-red-400"
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
          onSubmit={async ({ riskData, linkedAssetId }) => {
            if (editingRisk) {
              const updated = await updateMutation.mutateAsync({ id: editingRisk.id, data: riskData });
              const updatedRiskId = updated?.data?.id || editingRisk.id;
              if (linkedAssetId && updatedRiskId) {
                try {
                  await ermApi.risks.linkAsset(updatedRiskId, { asset_id: linkedAssetId });
                } catch {
                }
              }
              return;
            }

            const created = await createMutation.mutateAsync(riskData);
            const createdRiskId = created?.data?.id;
            if (linkedAssetId && createdRiskId) {
              try {
                await ermApi.risks.linkAsset(createdRiskId, { asset_id: linkedAssetId });
                queryClient.invalidateQueries({ queryKey: ['erm-risks'] });
              } catch {
              }
            }
          }}
          isLoading={createMutation.isPending || updateMutation.isPending}
        />
      )}

      {isUploadModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-slate-900">Upload Risk Register</h2>
              <button
                onClick={() => {
                  setIsUploadModalOpen(false);
                  setSelectedRegisterType('');
                }}
                className="text-slate-600 hover:text-slate-900"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Risk Register Type (Optional)
                </label>
                <select
                  value={selectedRegisterType}
                  onChange={(e) => setSelectedRegisterType(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
                >
                  <option value="">None (No Register Type)</option>
                  {REGISTER_TYPES.map(type => (
                    <option key={type.value} value={type.value}>{type.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500">
                  Select a register type to categorize all risks in this file
                </p>
              </div>

              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {isUploading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload size={18} />
                    Select File to Upload
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface User {
  id: number;
  email: string;
  full_name?: string;
}

interface AISuggestion {
  suggested_description: string;
  suggested_causes: string[];
  suggested_consequences: string[];
  recommended_controls: Array<{
    control_id: number;
    control_name: string;
    control_code?: string;
    relevance: string;
    rationale: string;
  }>;
  suggested_likelihood: number;
  suggested_impact: number;
  risk_treatment_options: string[];
}

interface RiskModalSubmitPayload {
  riskData: Partial<Risk>;
  linkedAssetId?: number;
}

function RiskModal({
  risk,
  onClose,
  onSubmit,
  isLoading,
}: {
  risk: Risk | null;
  onClose: () => void;
  onSubmit: (payload: RiskModalSubmitPayload) => Promise<void> | void;
  isLoading: boolean;
}) {
  const [formData, setFormData] = useState({
    title: risk?.title || '',
    description: risk?.description || '',
    risk_category: risk?.risk_category || 'operational' as RiskCategory,
    risk_sub_category: risk?.risk_sub_category || '',
    business_owner_id: risk?.business_owner_id || undefined as number | undefined,
    affected_department_ids: risk?.affected_department_ids || [] as number[],
    status: risk?.status || 'open' as RiskStatus,
    inherent_likelihood: risk?.inherent_likelihood || 3,
    inherent_impact: risk?.inherent_impact || 3,
    residual_likelihood: risk?.residual_likelihood || 2,
    residual_impact: risk?.residual_impact || 2,
    treatment_plan: risk?.treatment_plan || '',
    linked_asset_id: '',
  });

  const [aiSuggestions, setAiSuggestions] = useState<AISuggestion | null>(null);
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const [isGeneratingTreatment, setIsGeneratingTreatment] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      try {
        const response = await adminApi.getUsers();
        return (response.data || []).map((user: any) => ({
          id: user.id,
          email: user.email,
          full_name:
            user.full_name ||
            user.name ||
            [user.first_name, user.last_name].filter(Boolean).join(' ').trim() ||
            user.email,
        })) as User[];
      } catch {
        return [];
      }
    },
  });

  const { data: assets } = useQuery({
    queryKey: ['erm-assets-select-options'],
    queryFn: async () => {
      const response = await assetsApi.getAll();
      return (response.data || []) as ITAsset[];
    },
  });

  const subCategories = SUB_CATEGORIES_BY_CATEGORY[formData.risk_category] || [];

  const handleCategoryChange = (newCategory: RiskCategory) => {
    setFormData({ 
      ...formData, 
      risk_category: newCategory,
      risk_sub_category: ''
    });
  };

  const handleDepartmentToggle = (deptId: number) => {
    const current = formData.affected_department_ids;
    if (current.includes(deptId)) {
      setFormData({ ...formData, affected_department_ids: current.filter(id => id !== deptId) });
    } else {
      setFormData({ ...formData, affected_department_ids: [...current, deptId] });
    }
  };

  const handleGetAISuggestions = async () => {
    if (formData.title.trim().length < 3) {
      setAiError('Please enter at least 3 characters for the risk title');
      return;
    }
    
    setIsLoadingAI(true);
    setAiError(null);
    
    try {
      const response = await ermApi.risks.getAISuggestions({
        name: formData.title,
        category: formData.risk_category,
        sub_category: formData.risk_sub_category || undefined,
        description: formData.description || undefined,
      });
      setAiSuggestions(response.data);
      setShowSuggestions(true);
    } catch (err) {
      console.error('AI suggestion error:', err);
      setAiError('Failed to get AI suggestions. Please try again.');
    } finally {
      setIsLoadingAI(false);
    }
  };

  const applyDescription = () => {
    if (aiSuggestions?.suggested_description) {
      setFormData({ ...formData, description: aiSuggestions.suggested_description });
    }
  };

  const applyLikelihoodImpact = () => {
    if (aiSuggestions) {
      setFormData({
        ...formData,
        inherent_likelihood: aiSuggestions.suggested_likelihood,
        inherent_impact: aiSuggestions.suggested_impact,
      });
    }
  };

  const appendCauseToDescription = (cause: string) => {
    const causesSection = formData.description.includes('Root Causes:') 
      ? formData.description 
      : formData.description + (formData.description ? '\n\n' : '') + 'Root Causes:\n';
    setFormData({ ...formData, description: causesSection + `• ${cause}\n` });
  };

  const appendConsequenceToDescription = (consequence: string) => {
    const consequenceSection = formData.description.includes('Potential Consequences:')
      ? formData.description
      : formData.description + (formData.description ? '\n\n' : '') + 'Potential Consequences:\n';
    setFormData({ ...formData, description: consequenceSection + `• ${consequence}\n` });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const { linked_asset_id, ...riskData } = formData;
    await onSubmit({
      riskData: {
        ...riskData,
        inherent_score: formData.inherent_likelihood * formData.inherent_impact,
        residual_score: formData.residual_likelihood * formData.residual_impact,
      },
      linkedAssetId: linked_asset_id ? Number(linked_asset_id) : undefined,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">{risk ? 'Edit Risk' : 'Create Risk'}</h2>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="block text-sm text-slate-600">Title</label>
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                className="flex-1 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
                required
                placeholder="Enter risk title..."
              />
              <button
                type="button"
                onClick={handleGetAISuggestions}
                disabled={isLoadingAI || formData.title.trim().length < 3}
                className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 px-4 py-2 text-sm font-medium text-slate-900 hover:from-purple-500 hover:to-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {isLoadingAI ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                AI Assist
              </button>
            </div>
            {aiError && (
              <p className="mt-1 text-xs text-red-400">{aiError}</p>
            )}
          </div>

          {aiSuggestions && (
            <div className="rounded-xl border-2 border-transparent bg-gradient-to-r from-purple-500/20 to-blue-500/20 p-[2px]">
              <div className="rounded-[10px] bg-white p-4">
                <button
                  type="button"
                  onClick={() => setShowSuggestions(!showSuggestions)}
                  className="flex w-full items-center justify-between text-left"
                >
                  <div className="flex items-center gap-2">
                    <Zap className="h-4 w-4 text-purple-400" />
                    <span className="text-sm font-medium text-slate-900">AI Suggestions</span>
                  </div>
                  {showSuggestions ? (
                    <ChevronUp className="h-4 w-4 text-slate-600" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-slate-600" />
                  )}
                </button>
                
                {showSuggestions && (
                  <div className="mt-4 space-y-4">
                    <div>
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-medium text-slate-600 uppercase tracking-wider">Suggested Description</h4>
                        <button
                          type="button"
                          onClick={applyDescription}
                          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-purple-400 hover:bg-purple-500/20"
                        >
                          <Check className="h-3 w-3" />
                          Use this
                        </button>
                      </div>
                      <p className="mt-1 text-sm text-slate-700 bg-slate-100/50 rounded-lg p-3">
                        {aiSuggestions.suggested_description}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <h4 className="text-xs font-medium text-slate-600 uppercase tracking-wider mb-2">Root Causes</h4>
                        <div className="flex flex-wrap gap-1">
                          {aiSuggestions.suggested_causes.map((cause, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => appendCauseToDescription(cause)}
                              className="rounded-full bg-red-500/20 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/30 transition-colors"
                            >
                              + {cause}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <h4 className="text-xs font-medium text-slate-600 uppercase tracking-wider mb-2">Consequences</h4>
                        <div className="flex flex-wrap gap-1">
                          {aiSuggestions.suggested_consequences.map((consequence, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => appendConsequenceToDescription(consequence)}
                              className="rounded-full bg-orange-500/20 px-2.5 py-1 text-xs text-orange-300 hover:bg-orange-500/30 transition-colors"
                            >
                              + {consequence}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between">
                        <h4 className="text-xs font-medium text-slate-600 uppercase tracking-wider">Suggested Risk Rating</h4>
                        <button
                          type="button"
                          onClick={applyLikelihoodImpact}
                          className="flex items-center gap-1 rounded px-2 py-1 text-xs text-purple-400 hover:bg-purple-500/20"
                        >
                          <Check className="h-3 w-3" />
                          Apply
                        </button>
                      </div>
                      <div className="mt-2 flex items-center gap-4">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-600">Likelihood:</span>
                          <span className="rounded bg-blue-500/20 px-2 py-0.5 text-sm font-medium text-blue-300">
                            {aiSuggestions.suggested_likelihood}/5
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-600">Impact:</span>
                          <span className="rounded bg-amber-500/20 px-2 py-0.5 text-sm font-medium text-amber-300">
                            {aiSuggestions.suggested_impact}/5
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-600">Score:</span>
                          <span className={`rounded px-2 py-0.5 text-sm font-medium ${getScoreColor(aiSuggestions.suggested_likelihood * aiSuggestions.suggested_impact).bg} ${getScoreColor(aiSuggestions.suggested_likelihood * aiSuggestions.suggested_impact).text}`}>
                            {aiSuggestions.suggested_likelihood * aiSuggestions.suggested_impact}
                          </span>
                        </div>
                      </div>
                    </div>

                    {aiSuggestions.recommended_controls.length > 0 && (
                      <div>
                        <h4 className="text-xs font-medium text-slate-600 uppercase tracking-wider mb-2">Recommended Controls</h4>
                        <div className="space-y-2">
                          {aiSuggestions.recommended_controls.map((control) => (
                            <div
                              key={control.control_id}
                              className="flex items-start gap-3 rounded-lg bg-slate-100/50 p-3"
                            >
                              <Shield className="h-4 w-4 text-green-400 mt-0.5 flex-shrink-0" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium text-slate-900 truncate">
                                    {control.control_name}
                                  </span>
                                  {control.control_code && (
                                    <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-700">
                                      {control.control_code}
                                    </span>
                                  )}
                                  <span className={`rounded px-1.5 py-0.5 text-xs ${
                                    control.relevance === 'high' 
                                      ? 'bg-green-500/20 text-green-300'
                                      : control.relevance === 'medium'
                                      ? 'bg-yellow-500/20 text-yellow-300'
                                      : 'bg-slate-500/20 text-slate-700'
                                  }`}>
                                    {control.relevance}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs text-slate-600">{control.rationale}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <h4 className="text-xs font-medium text-slate-600 uppercase tracking-wider mb-2">Treatment Options</h4>
                      <div className="flex flex-wrap gap-2">
                        {aiSuggestions.risk_treatment_options.map((option, idx) => (
                          <span
                            key={idx}
                            className="rounded-full bg-purple-500/20 px-3 py-1 text-xs text-purple-300"
                          >
                            {option}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm text-slate-600">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
              rows={3}
              placeholder="Describe the risk..."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-600">Category</label>
              <select
                value={formData.risk_category}
                onChange={(e) => handleCategoryChange(e.target.value as RiskCategory)}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
              >
                {RISK_CATEGORIES.map((cat) => (
                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-600">Sub-Category</label>
              <select
                value={formData.risk_sub_category}
                onChange={(e) => setFormData({ ...formData, risk_sub_category: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
              >
                <option value="">Select sub-category...</option>
                {subCategories.map((sub) => (
                  <option key={sub} value={sub}>{sub}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-600">Status</label>
              <select
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as RiskStatus })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
              >
                {RISK_STATUSES.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-600">Business Owner</label>
              <select
                value={formData.business_owner_id || ''}
                onChange={(e) => setFormData({ ...formData, business_owner_id: e.target.value ? Number(e.target.value) : undefined })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
              >
                <option value="">Select owner...</option>
                {(users || []).map((user) => (
                  <option key={user.id} value={user.id}>{user.full_name || user.email}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-600">Linked Asset (Optional)</label>
            <select
              value={formData.linked_asset_id}
              onChange={(e) => setFormData({ ...formData, linked_asset_id: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
            >
              <option value="">Select asset...</option>
              {(assets || []).map((asset) => (
                <option key={asset.id} value={asset.id}>{asset.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm text-slate-600 mb-2">Affected Departments</label>
            <div className="flex flex-wrap gap-2">
              {DEPARTMENTS.map((dept) => (
                <button
                  key={dept.id}
                  type="button"
                  onClick={() => handleDepartmentToggle(dept.id)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    formData.affected_department_ids.includes(dept.id)
                      ? 'bg-primary-600 text-white'
                      : 'bg-slate-200 text-slate-700 hover:bg-slate-500'
                  }`}
                >
                  {dept.name}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-600">Inherent Likelihood (1-5)</label>
              <input
                type="number"
                min="1"
                max="5"
                value={formData.inherent_likelihood}
                onChange={(e) => setFormData({ ...formData, inherent_likelihood: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-600">Inherent Impact (1-5)</label>
              <input
                type="number"
                min="1"
                max="5"
                value={formData.inherent_impact}
                onChange={(e) => setFormData({ ...formData, inherent_impact: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-600">Residual Likelihood (1-5)</label>
              <input
                type="number"
                min="1"
                max="5"
                value={formData.residual_likelihood}
                onChange={(e) => setFormData({ ...formData, residual_likelihood: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-600">Residual Impact (1-5)</label>
              <input
                type="number"
                min="1"
                max="5"
                value={formData.residual_impact}
                onChange={(e) => setFormData({ ...formData, residual_impact: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm text-slate-600">Treatment Plan</label>
              {risk && (
                <button
                  type="button"
                  onClick={async () => {
                    setIsGeneratingTreatment(true);
                    try {
                      const response = await ermApi.risks.generateTreatmentPlan(risk.id);
                      setFormData(prev => ({ ...prev, treatment_plan: response.data.treatment_plan }));
                    } catch {
                      setAiError('Failed to generate treatment plan');
                    } finally {
                      setIsGeneratingTreatment(false);
                    }
                  }}
                  disabled={isGeneratingTreatment}
                  className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-blue-600 px-4 py-2 text-sm font-medium text-slate-900 hover:from-purple-500 hover:to-blue-500 disabled:opacity-50 transition-all"
                >
                  {isGeneratingTreatment ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  AI Generate Treatment Plan
                </button>
              )}
            </div>
            <textarea
              value={formData.treatment_plan}
              onChange={(e) => setFormData({ ...formData, treatment_plan: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
              rows={formData.treatment_plan.length > 200 ? 8 : 2}
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200"
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
