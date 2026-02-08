'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ermApi } from '@/lib/api';
import { RiskCategory } from '@/types';
import {
  AlertTriangle,
  Loader2,
  Edit2,
  Save,
  Target,
  Bell,
  BellOff,
  ExternalLink,
  TrendingUp,
  Database,
} from 'lucide-react';
import Link from 'next/link';

type AppetiteLevel = 'averse' | 'minimal' | 'cautious' | 'moderate' | 'open' | 'hungry';

interface AppetiteConfigWithStats {
  id: number;
  tenant_id: number;
  category: RiskCategory;
  appetite_level: AppetiteLevel;
  appetite_value: number;
  max_acceptable_score: number;
  tolerance_threshold: number;
  escalation_owner_id: number | null;
  escalation_owner: { id: number; email: string; full_name: string } | null;
  alert_enabled: boolean;
  description: string | null;
  risks_count: number;
  exceeding_count: number;
  tolerance_breaches: ToleranceBreachFromAPI[];
}

interface ToleranceBreachFromAPI {
  risk_id: number;
  risk_title: string;
  category: RiskCategory;
  current_score: number;
  tolerance: number;
  days_over: number;
}

interface BreachesResponse {
  total_breaches: number;
  breaches: {
    risk_id: number;
    risk_title: string;
    category: RiskCategory;
    current_score: number;
    tolerance: number;
    excess: number;
    days_over: number;
    owner_id: number | null;
    owner: { id: number; email: string; full_name: string } | null;
  }[];
}

const RISK_CATEGORIES: { value: RiskCategory; label: string; color: string; bgColor: string; borderColor: string }[] = [
  { value: 'strategic', label: 'Strategic', color: 'text-primary-600', bgColor: 'bg-primary-500/20', borderColor: 'border-primary-500' },
  { value: 'operational', label: 'Operational', color: 'text-blue-400', bgColor: 'bg-blue-500/20', borderColor: 'border-blue-500' },
  { value: 'financial', label: 'Financial', color: 'text-green-400', bgColor: 'bg-green-500/20', borderColor: 'border-green-500' },
  { value: 'compliance', label: 'Compliance', color: 'text-yellow-400', bgColor: 'bg-yellow-500/20', borderColor: 'border-yellow-500' },
  { value: 'technology', label: 'Technology', color: 'text-cyan-400', bgColor: 'bg-cyan-500/20', borderColor: 'border-cyan-500' },
  { value: 'third_party', label: 'Third Party', color: 'text-orange-400', bgColor: 'bg-orange-500/20', borderColor: 'border-orange-500' },
  { value: 'project_change', label: 'Project/Change', color: 'text-pink-400', bgColor: 'bg-pink-500/20', borderColor: 'border-pink-500' },
];

const APPETITE_LEVELS: { value: AppetiteLevel; label: string }[] = [
  { value: 'averse', label: 'Averse' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'cautious', label: 'Cautious' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'open', label: 'Open' },
  { value: 'hungry', label: 'Hungry' },
];

const getCategoryStyle = (category: RiskCategory) => {
  return RISK_CATEGORIES.find(c => c.value === category) || RISK_CATEGORIES[0];
};

const getAppetiteLevelLabel = (level: AppetiteLevel) => {
  return APPETITE_LEVELS.find(l => l.value === level)?.label || level;
};

const getAppetiteLevelColor = (level: AppetiteLevel) => {
  switch (level) {
    case 'averse': return 'text-green-400 bg-green-500/20';
    case 'minimal': return 'text-emerald-400 bg-emerald-500/20';
    case 'cautious': return 'text-yellow-400 bg-yellow-500/20';
    case 'moderate': return 'text-orange-400 bg-orange-500/20';
    case 'open': return 'text-red-400 bg-red-500/20';
    case 'hungry': return 'text-rose-400 bg-rose-500/20';
    default: return 'text-slate-400 bg-slate-500/20';
  }
};

export default function RiskAppetitePage() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [localChanges, setLocalChanges] = useState<Record<number, Partial<AppetiteConfigWithStats>>>({});

  const { data: appetiteConfigs, isLoading: configsLoading, error: configsError } = useQuery({
    queryKey: ['appetite-configs-with-stats'],
    queryFn: async () => {
      const response = await ermApi.appetite.getWithStats();
      return response.data as AppetiteConfigWithStats[];
    },
  });

  const { data: breachesData, isLoading: breachesLoading } = useQuery({
    queryKey: ['appetite-breaches'],
    queryFn: async () => {
      const response = await ermApi.appetite.getBreaches();
      return response.data as BreachesResponse;
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Record<string, unknown> }) => {
      const response = await ermApi.appetite.update(id, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appetite-configs-with-stats'] });
      queryClient.invalidateQueries({ queryKey: ['appetite-breaches'] });
    },
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      const response = await ermApi.appetite.seedDefaults(1);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appetite-configs-with-stats'] });
      queryClient.invalidateQueries({ queryKey: ['appetite-breaches'] });
    },
  });

  const getConfigValue = (config: AppetiteConfigWithStats, field: keyof AppetiteConfigWithStats) => {
    const changes = localChanges[config.id];
    if (changes && field in changes) {
      return changes[field as keyof typeof changes];
    }
    return config[field];
  };

  const handleConfigChange = (id: number, field: string, value: string | number | boolean) => {
    setLocalChanges(prev => ({
      ...prev,
      [id]: {
        ...prev[id],
        [field]: value,
      },
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const promises = Object.entries(localChanges).map(([id, changes]) => {
        return updateMutation.mutateAsync({ id: parseInt(id), data: changes });
      });
      await Promise.all(promises);
      setLocalChanges({});
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error('Failed to save configurations:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSeedDefaults = async () => {
    try {
      await seedMutation.mutateAsync();
    } catch (error) {
      console.error('Failed to seed defaults:', error);
    }
  };

  const hasChanges = Object.keys(localChanges).length > 0;

  if (configsLoading || breachesLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  if (!appetiteConfigs || appetiteConfigs.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Risk Appetite Management</h2>
          <p className="text-sm text-slate-400">Configure risk appetite levels and monitor tolerance breaches</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-200">
            <Database className="h-8 w-8 text-slate-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-800 mb-2">No Appetite Configurations Found</h3>
          <p className="text-sm text-slate-400 mb-6">
            Get started by seeding default risk appetite configurations for all risk categories.
          </p>
          <button
            onClick={handleSeedDefaults}
            disabled={seedMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-6 py-3 font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {seedMutation.isPending ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Database className="h-5 w-5" />
            )}
            Seed Default Configurations
          </button>
        </div>
      </div>
    );
  }

  const toleranceBreaches = breachesData?.breaches || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-800">Risk Appetite Management</h2>
          <p className="text-sm text-slate-400">Configure risk appetite levels and monitor tolerance breaches</p>
        </div>
        <div className="flex items-center gap-3">
          {saveSuccess && (
            <span className="text-sm text-green-400">Configuration saved successfully!</span>
          )}
          <button
            onClick={handleSave}
            disabled={isSaving || !hasChanges}
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
        {appetiteConfigs.map(config => {
          const catStyle = getCategoryStyle(config.category);
          
          return (
            <div
              key={config.id}
              className={`rounded-xl border border-slate-200 bg-white overflow-hidden`}
            >
              <div className={`px-4 py-3 ${catStyle.bgColor} border-b ${catStyle.borderColor}`}>
                <div className="flex items-center justify-between">
                  <h3 className={`font-semibold ${catStyle.color}`}>{catStyle.label}</h3>
                  <button
                    onClick={() => setEditingId(editingId === config.id ? null : config.id)}
                    className="p-1 rounded hover:bg-slate-50 text-slate-600 hover:text-slate-900 transition-colors"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              
              <div className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Appetite Level</span>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${getAppetiteLevelColor(getConfigValue(config, 'appetite_level') as AppetiteLevel)}`}>
                    {getAppetiteLevelLabel(getConfigValue(config, 'appetite_level') as AppetiteLevel)}
                  </span>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Tolerance Threshold</span>
                  <span className="text-slate-800 font-medium">{getConfigValue(config, 'tolerance_threshold') || '-'}</span>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Risks Exceeding</span>
                  <span className={`font-bold ${config.exceeding_count > 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {config.exceeding_count} / {config.risks_count}
                  </span>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-400">Alerts</span>
                  {getConfigValue(config, 'alert_enabled') ? (
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
                  className="flex items-center justify-between rounded-lg border border-red-500/30 bg-white p-4"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col">
                      <Link
                        href={`/erm/risks?id=${breach.risk_id}`}
                        className="text-slate-800 font-medium hover:text-primary-400 flex items-center gap-1"
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
                        <span className="text-slate-600">{breach.tolerance}</span>
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-slate-400">Days Over</p>
                      <p className="font-medium text-orange-400">{breach.days_over}</p>
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

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <TrendingUp className="h-5 w-5 text-primary-400" />
            <h3 className="text-lg font-semibold text-slate-800">Risk Appetite Configuration</h3>
          </div>
          <p className="text-sm text-slate-400 mt-1">Configure appetite levels, thresholds, and escalation settings for each risk category</p>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Category</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Appetite Level</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Tolerance Threshold</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-400 uppercase tracking-wider">Escalation Owner</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-slate-400 uppercase tracking-wider">Alerts Enabled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {appetiteConfigs.map(config => {
                const catStyle = getCategoryStyle(config.category);
                return (
                  <tr key={config.id} className="hover:bg-slate-200/30">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <div className={`w-3 h-3 rounded-full ${catStyle.bgColor} ${catStyle.borderColor} border`} />
                        <span className={`font-medium ${catStyle.color}`}>{catStyle.label}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <select
                        value={getConfigValue(config, 'appetite_level') as string}
                        onChange={(e) => handleConfigChange(config.id, 'appetite_level', e.target.value)}
                        className="w-full rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:border-primary-500 focus:outline-none"
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
                        value={getConfigValue(config, 'tolerance_threshold') as number}
                        onChange={(e) => handleConfigChange(config.id, 'tolerance_threshold', parseFloat(e.target.value) || 0)}
                        className="w-24 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:border-primary-500 focus:outline-none"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-slate-600">
                        {config.escalation_owner?.full_name || config.escalation_owner?.email || 'Not assigned'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={() => handleConfigChange(config.id, 'alert_enabled', !(getConfigValue(config, 'alert_enabled') as boolean))}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          getConfigValue(config, 'alert_enabled') ? 'bg-primary-600' : 'bg-slate-600'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            getConfigValue(config, 'alert_enabled') ? 'translate-x-6' : 'translate-x-1'
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
