'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ermApi } from '@/lib/api';
import { Risk, RiskCategory } from '@/types';
import {
  AlertTriangle,
  Loader2,
  AlertCircle,
  Edit2,
  Save,
  Target,
  Bell,
  BellOff,
  ExternalLink,
  TrendingUp,
} from 'lucide-react';
import Link from 'next/link';

type AppetiteLevel = 'very_low' | 'low' | 'medium' | 'high' | 'very_high';

interface AppetiteConfig {
  id: number;
  category: RiskCategory;
  appetite_level: AppetiteLevel;
  tolerance_threshold: number;
  escalation_owner_id: number | null;
  escalation_owner_name: string | null;
  alerts_enabled: boolean;
}

interface ToleranceBreach {
  risk_id: number;
  risk_title: string;
  category: RiskCategory;
  current_score: number;
  tolerance_threshold: number;
  days_over_tolerance: number;
}

const RISK_CATEGORIES: { value: RiskCategory; label: string; color: string; bgColor: string; borderColor: string }[] = [
  { value: 'strategic', label: 'Strategic', color: 'text-purple-400', bgColor: 'bg-purple-500/20', borderColor: 'border-purple-500' },
  { value: 'operational', label: 'Operational', color: 'text-blue-400', bgColor: 'bg-blue-500/20', borderColor: 'border-blue-500' },
  { value: 'financial', label: 'Financial', color: 'text-green-400', bgColor: 'bg-green-500/20', borderColor: 'border-green-500' },
  { value: 'compliance', label: 'Compliance', color: 'text-yellow-400', bgColor: 'bg-yellow-500/20', borderColor: 'border-yellow-500' },
  { value: 'technology', label: 'Technology', color: 'text-cyan-400', bgColor: 'bg-cyan-500/20', borderColor: 'border-cyan-500' },
  { value: 'third_party', label: 'Third Party', color: 'text-orange-400', bgColor: 'bg-orange-500/20', borderColor: 'border-orange-500' },
  { value: 'project_change', label: 'Project/Change', color: 'text-pink-400', bgColor: 'bg-pink-500/20', borderColor: 'border-pink-500' },
];

const APPETITE_LEVELS: { value: AppetiteLevel; label: string; score: number }[] = [
  { value: 'very_low', label: 'Very Low', score: 4 },
  { value: 'low', label: 'Low', score: 8 },
  { value: 'medium', label: 'Medium', score: 12 },
  { value: 'high', label: 'High', score: 16 },
  { value: 'very_high', label: 'Very High', score: 20 },
];

const MOCK_OWNERS = [
  { id: 1, name: 'John Smith' },
  { id: 2, name: 'Jane Doe' },
  { id: 3, name: 'Bob Wilson' },
  { id: 4, name: 'Alice Brown' },
  { id: 5, name: 'Charlie Davis' },
];

const generateMockAppetiteConfig = (): AppetiteConfig[] => {
  return RISK_CATEGORIES.map((cat, idx) => ({
    id: idx + 1,
    category: cat.value,
    appetite_level: ['low', 'medium', 'low', 'very_low', 'medium', 'low', 'medium'][idx] as AppetiteLevel,
    tolerance_threshold: [8, 12, 8, 6, 12, 8, 10][idx],
    escalation_owner_id: MOCK_OWNERS[idx % MOCK_OWNERS.length].id,
    escalation_owner_name: MOCK_OWNERS[idx % MOCK_OWNERS.length].name,
    alerts_enabled: [true, true, true, true, false, true, false][idx],
  }));
};

const getCategoryStyle = (category: RiskCategory) => {
  return RISK_CATEGORIES.find(c => c.value === category) || RISK_CATEGORIES[0];
};

const getAppetiteLevelLabel = (level: AppetiteLevel) => {
  return APPETITE_LEVELS.find(l => l.value === level)?.label || level;
};

const getAppetiteLevelColor = (level: AppetiteLevel) => {
  switch (level) {
    case 'very_low': return 'text-green-400 bg-green-500/20';
    case 'low': return 'text-emerald-400 bg-emerald-500/20';
    case 'medium': return 'text-yellow-400 bg-yellow-500/20';
    case 'high': return 'text-orange-400 bg-orange-500/20';
    case 'very_high': return 'text-red-400 bg-red-500/20';
    default: return 'text-slate-400 bg-slate-500/20';
  }
};

export default function RiskAppetitePage() {
  const [appetiteConfig, setAppetiteConfig] = useState<AppetiteConfig[]>(generateMockAppetiteConfig());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const { data: risks, isLoading: risksLoading } = useQuery({
    queryKey: ['erm-risks'],
    queryFn: async () => {
      const response = await ermApi.risks.getAll();
      return response.data;
    },
  });

  const toleranceBreaches = useMemo((): ToleranceBreach[] => {
    if (!risks) return [];
    
    const breaches: ToleranceBreach[] = [];
    
    risks.forEach((risk: Risk) => {
      const config = appetiteConfig.find(c => c.category === risk.risk_category);
      if (!config) return;
      
      const currentScore = risk.residual_score || risk.inherent_score || 0;
      if (currentScore > config.tolerance_threshold) {
        const riskDate = new Date(risk.created_at);
        const now = new Date();
        const daysOver = Math.floor((now.getTime() - riskDate.getTime()) / (1000 * 60 * 60 * 24));
        
        breaches.push({
          risk_id: risk.id,
          risk_title: risk.title,
          category: risk.risk_category,
          current_score: currentScore,
          tolerance_threshold: config.tolerance_threshold,
          days_over_tolerance: Math.max(0, daysOver),
        });
      }
    });
    
    return breaches.sort((a, b) => (b.current_score - b.tolerance_threshold) - (a.current_score - a.tolerance_threshold));
  }, [risks, appetiteConfig]);

  const risksByCategory = useMemo(() => {
    if (!risks) return {};
    
    const byCategory: Record<RiskCategory, { total: number; exceeding: number }> = {} as Record<RiskCategory, { total: number; exceeding: number }>;
    
    RISK_CATEGORIES.forEach(cat => {
      byCategory[cat.value] = { total: 0, exceeding: 0 };
    });
    
    risks.forEach((risk: Risk) => {
      if (byCategory[risk.risk_category]) {
        byCategory[risk.risk_category].total++;
        
        const config = appetiteConfig.find(c => c.category === risk.risk_category);
        const currentScore = risk.residual_score || risk.inherent_score || 0;
        if (config && currentScore > config.tolerance_threshold) {
          byCategory[risk.risk_category].exceeding++;
        }
      }
    });
    
    return byCategory;
  }, [risks, appetiteConfig]);

  const handleConfigChange = (id: number, field: keyof AppetiteConfig, value: string | number | boolean) => {
    setAppetiteConfig(prev => 
      prev.map(config => {
        if (config.id !== id) return config;
        
        const updated = { ...config, [field]: value };
        
        if (field === 'escalation_owner_id') {
          const owner = MOCK_OWNERS.find(o => o.id === value);
          updated.escalation_owner_name = owner?.name || null;
        }
        
        return updated;
      })
    );
  };

  const handleSave = async () => {
    setIsSaving(true);
    await new Promise(resolve => setTimeout(resolve, 1000));
    setIsSaving(false);
    setSaveSuccess(true);
    setTimeout(() => setSaveSuccess(false), 3000);
  };

  if (risksLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-white">Risk Appetite Management</h2>
          <p className="text-sm text-slate-400">Configure risk appetite levels and monitor tolerance breaches</p>
        </div>
        <div className="flex items-center gap-3">
          {saveSuccess && (
            <span className="text-sm text-green-400">Configuration saved successfully!</span>
          )}
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Configuration
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {RISK_CATEGORIES.map(cat => {
          const config = appetiteConfig.find(c => c.category === cat.value);
          const stats = risksByCategory[cat.value] || { total: 0, exceeding: 0 };
          
          return (
            <div
              key={cat.value}
              className={`rounded-xl border border-slate-700 bg-slate-800 overflow-hidden`}
            >
              <div className={`px-4 py-3 ${cat.bgColor} border-b ${cat.borderColor}`}>
                <div className="flex items-center justify-between">
                  <h3 className={`font-semibold ${cat.color}`}>{cat.label}</h3>
                  <button
                    onClick={() => setEditingId(editingId === config?.id ? null : config?.id || null)}
                    className="p-1 rounded hover:bg-slate-700/50 text-slate-300 hover:text-white transition-colors"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Appetite Level</span>
                  {config && (
                    <span className={`px-2 py-1 rounded text-xs font-medium ${getAppetiteLevelColor(config.appetite_level)}`}>
                      {getAppetiteLevelLabel(config.appetite_level)}
                    </span>
                  )}
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Tolerance Threshold</span>
                  <span className="text-white font-medium">{config?.tolerance_threshold || '-'}</span>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Risks Exceeding</span>
                  <span className={`font-bold ${stats.exceeding > 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {stats.exceeding} / {stats.total}
                  </span>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Alerts</span>
                  {config?.alerts_enabled ? (
                    <Bell className="h-4 w-4 text-green-400" />
                  ) : (
                    <BellOff className="h-4 w-4 text-slate-500" />
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {toleranceBreaches.length > 0 && (
        <div className="rounded-xl border-2 border-red-500/50 bg-red-500/5 p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-red-500/20">
              <AlertTriangle className="h-6 w-6 text-red-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-red-400">Tolerance Breach Alerts</h3>
              <p className="text-sm text-slate-400">{toleranceBreaches.length} risk(s) currently exceed their category tolerance threshold</p>
            </div>
          </div>
          
          <div className="space-y-3">
            {toleranceBreaches.map(breach => {
              const catStyle = getCategoryStyle(breach.category);
              return (
                <div
                  key={breach.risk_id}
                  className="flex items-center justify-between rounded-lg border border-red-500/30 bg-slate-800 p-4"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col">
                      <Link
                        href={`/erm/risks?id=${breach.risk_id}`}
                        className="text-white font-medium hover:text-primary-400 flex items-center gap-1"
                      >
                        {breach.risk_title}
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                      <span className={`text-xs ${catStyle.color}`}>{catStyle.label}</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-6 text-sm">
                    <div className="text-center">
                      <p className="text-slate-400">Score vs Threshold</p>
                      <p className="font-medium">
                        <span className="text-red-400">{breach.current_score}</span>
                        <span className="text-slate-500"> / </span>
                        <span className="text-slate-300">{breach.tolerance_threshold}</span>
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-slate-400">Days Over</p>
                      <p className="font-medium text-orange-400">{breach.days_over_tolerance}</p>
                    </div>
                    <Link
                      href={`/erm/risks?id=${breach.risk_id}`}
                      className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-400 text-xs font-medium hover:bg-red-500/30 transition-colors"
                    >
                      Remediate
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {toleranceBreaches.length === 0 && (
        <div className="rounded-xl border border-green-500/30 bg-green-500/5 p-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/20">
              <Target className="h-6 w-6 text-green-400" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-green-400">All Risks Within Tolerance</h3>
              <p className="text-sm text-slate-400">No risks currently exceed their category tolerance threshold</p>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-700 bg-slate-800 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-700">
          <div className="flex items-center gap-3">
            <TrendingUp className="h-5 w-5 text-primary-400" />
            <h3 className="text-lg font-semibold text-white">Risk Appetite Configuration</h3>
          </div>
          <p className="text-sm text-slate-400 mt-1">Configure appetite levels, thresholds, and escalation settings for each risk category</p>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Category</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Appetite Level</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Tolerance Threshold</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Escalation Owner</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-slate-400 uppercase tracking-wider">Alerts Enabled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {appetiteConfig.map(config => {
                const catStyle = getCategoryStyle(config.category);
                return (
                  <tr key={config.id} className="hover:bg-slate-700/30">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full ${catStyle.bgColor} ${catStyle.borderColor} border`} />
                        <span className={`font-medium ${catStyle.color}`}>{catStyle.label}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <select
                        value={config.appetite_level}
                        onChange={(e) => handleConfigChange(config.id, 'appetite_level', e.target.value)}
                        className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
                      >
                        {APPETITE_LEVELS.map(level => (
                          <option key={level.value} value={level.value}>{level.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-6 py-4">
                      <input
                        type="number"
                        min="1"
                        max="25"
                        value={config.tolerance_threshold}
                        onChange={(e) => handleConfigChange(config.id, 'tolerance_threshold', parseInt(e.target.value) || 0)}
                        className="w-24 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <select
                        value={config.escalation_owner_id || ''}
                        onChange={(e) => handleConfigChange(config.id, 'escalation_owner_id', parseInt(e.target.value) || null)}
                        className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white focus:border-primary-500 focus:outline-none"
                      >
                        <option value="">Select owner...</option>
                        {MOCK_OWNERS.map(owner => (
                          <option key={owner.id} value={owner.id}>{owner.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={() => handleConfigChange(config.id, 'alerts_enabled', !config.alerts_enabled)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          config.alerts_enabled ? 'bg-primary-600' : 'bg-slate-600'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            config.alerts_enabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
