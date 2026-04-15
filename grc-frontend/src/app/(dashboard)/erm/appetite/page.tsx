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
  X,
  Sparkles,
  Trash2,
  Plus,
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

interface AISuggestion {
  category: string;
  appetite_level: string;
  tolerance_threshold: number;
  max_acceptable_score: number;
  description: string;
  escalation_criteria: string;
  rationale: string;
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
    default: return 'text-slate-600 bg-slate-500/20';
  }
};

export default function RiskAppetitePage() {
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Record<string, unknown>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [localChanges, setLocalChanges] = useState<Record<number, Partial<AppetiteConfigWithStats>>>({});
  const [aiSuggestingFor, setAiSuggestingFor] = useState<number | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<AISuggestion | null>(null);
  const [aiSuggestionConfigId, setAiSuggestionConfigId] = useState<number | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState<{
    category: RiskCategory;
    appetite_level: AppetiteLevel;
    tolerance_threshold: number;
    max_acceptable_score: number;
    description: string;
    alert_enabled: boolean;
  }>({
    category: 'strategic',
    appetite_level: 'moderate',
    tolerance_threshold: 12,
    max_acceptable_score: 15,
    description: '',
    alert_enabled: true,
  });

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

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await ermApi.appetite.delete(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appetite-configs-with-stats'] });
      queryClient.invalidateQueries({ queryKey: ['appetite-breaches'] });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof createForm) => {
      const tenantId = appetiteConfigs?.[0]?.tenant_id || 1;
      const response = await ermApi.appetite.create(tenantId, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appetite-configs-with-stats'] });
      queryClient.invalidateQueries({ queryKey: ['appetite-breaches'] });
      setShowCreateModal(false);
      setCreateForm({ category: 'strategic', appetite_level: 'moderate', tolerance_threshold: 12, max_acceptable_score: 15, description: '', alert_enabled: true });
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

  const startEditing = (config: AppetiteConfigWithStats) => {
    setEditingId(config.id);
    setEditForm({
      appetite_level: config.appetite_level,
      tolerance_threshold: config.tolerance_threshold,
      max_acceptable_score: config.max_acceptable_score,
      alert_enabled: config.alert_enabled,
      description: config.description || '',
    });
    setAiSuggestion(null);
    setAiSuggestionConfigId(null);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditForm({});
    setAiSuggestion(null);
    setAiSuggestionConfigId(null);
  };

  const saveEditing = async (configId: number) => {
    setIsSaving(true);
    try {
      await updateMutation.mutateAsync({ id: configId, data: editForm });
      setEditingId(null);
      setEditForm({});
      setSaveSuccess(true);
      setAiSuggestion(null);
      setAiSuggestionConfigId(null);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error('Failed to save configuration:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleAiSuggest = async (config: AppetiteConfigWithStats) => {
    setAiSuggestingFor(config.id);
    try {
      const response = await ermApi.appetite.aiSuggest({
        category: config.category,
        description: config.description || undefined,
      });
      const suggestion = response.data;
      setAiSuggestion(suggestion);
      setAiSuggestionConfigId(config.id);

      if (editingId === config.id) {
        setEditForm({
          appetite_level: suggestion.appetite_level,
          tolerance_threshold: suggestion.tolerance_threshold,
          max_acceptable_score: suggestion.max_acceptable_score,
          alert_enabled: editForm.alert_enabled ?? config.alert_enabled,
          description: suggestion.description,
        });
      }
    } catch (error) {
      console.error('AI suggestion failed:', error);
    } finally {
      setAiSuggestingFor(null);
    }
  };

  const applyAiSuggestion = (config: AppetiteConfigWithStats) => {
    if (!aiSuggestion) return;
    if (editingId !== config.id) {
      startEditing(config);
    }
    setEditForm({
      appetite_level: aiSuggestion.appetite_level,
      tolerance_threshold: aiSuggestion.tolerance_threshold,
      max_acceptable_score: aiSuggestion.max_acceptable_score,
      alert_enabled: editForm.alert_enabled ?? config.alert_enabled,
      description: aiSuggestion.description,
    });
  };

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
          <h2 className="text-xl font-semibold text-slate-900">Risk Appetite Management</h2>
          <p className="text-sm text-slate-600">Configure risk appetite levels and monitor tolerance breaches</p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
            <Database className="h-8 w-8 text-slate-600" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-2">No Appetite Configurations Found</h3>
          <p className="text-sm text-slate-600 mb-6">
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
          <h2 className="text-xl font-semibold text-slate-900">Risk Appetite Management</h2>
          <p className="text-sm text-slate-600">Configure risk appetite levels and monitor tolerance breaches</p>
        </div>
        <div className="flex items-center gap-3">
          {saveSuccess && (
            <span className="text-sm text-green-600">Configuration saved successfully!</span>
          )}
          {appetiteConfigs && (
            <button
              onClick={() => {
                const existingCategories = appetiteConfigs.map(c => c.category);
                const missing = RISK_CATEGORIES.find(c => !existingCategories.includes(c.value));
                setCreateForm(prev => ({ ...prev, category: missing?.value || RISK_CATEGORIES[0].value }));
                setShowCreateModal(true);
              }}
              className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Plus className="h-4 w-4" />
              New Config
            </button>
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
          const isEditing = editingId === config.id;
          const showAiSuggestion = aiSuggestionConfigId === config.id && aiSuggestion;
          
          return (
            <div
              key={config.id}
              className={`rounded-xl border ${isEditing ? 'border-primary-500' : 'border-slate-200'} bg-white overflow-hidden`}
            >
              <div className={`px-4 py-3 ${catStyle.bgColor} border-b ${catStyle.borderColor}`}>
                <div className="flex items-center justify-between">
                  <h3 className={`font-semibold ${catStyle.color}`}>{catStyle.label}</h3>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleAiSuggest(config)}
                      disabled={aiSuggestingFor === config.id}
                      className="p-1 rounded hover:bg-slate-100/50 text-slate-700 hover:text-slate-900 transition-colors"
                      title="AI Suggest Thresholds"
                    >
                      {aiSuggestingFor === config.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-purple-400" />
                      ) : (
                        <Sparkles className="h-4 w-4 text-purple-400" />
                      )}
                    </button>
                    {isEditing ? (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => saveEditing(config.id)}
                          disabled={isSaving}
                          className="p-1 rounded hover:bg-slate-50 text-green-600 hover:text-green-700 transition-colors"
                          title="Save"
                        >
                          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        </button>
                        <button
                          onClick={cancelEditing}
                          className="p-1 rounded hover:bg-slate-50 text-red-500 hover:text-red-600 transition-colors"
                          title="Cancel"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => startEditing(config)}
                          className="p-1 rounded hover:bg-slate-50 text-slate-500 hover:text-slate-700 transition-colors"
                          title="Edit"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => { if (confirm('Delete this risk appetite configuration?')) deleteMutation.mutate(config.id); }}
                          disabled={deleteMutation.isPending}
                          className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="p-4 space-y-3">
                {isEditing ? (
                  <>
                    <div>
                      <label className="text-xs text-slate-600 mb-1 block">Appetite Level</label>
                      <select
                        value={editForm.appetite_level as string}
                        onChange={(e) => setEditForm(prev => ({ ...prev, appetite_level: e.target.value }))}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
                      >
                        {APPETITE_LEVELS.map(level => (
                          <option key={level.value} value={level.value}>{level.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-slate-600 mb-1 block">Tolerance Threshold</label>
                      <input
                        type="number"
                        min="1"
                        max="25"
                        value={editForm.tolerance_threshold as number}
                        onChange={(e) => setEditForm(prev => ({ ...prev, tolerance_threshold: parseFloat(e.target.value) || 0 }))}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-600 mb-1 block">Max Acceptable Score</label>
                      <input
                        type="number"
                        min="1"
                        max="25"
                        value={editForm.max_acceptable_score as number}
                        onChange={(e) => setEditForm(prev => ({ ...prev, max_acceptable_score: parseFloat(e.target.value) || 0 }))}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-600">Alerts Enabled</span>
                      <button
                        onClick={() => setEditForm(prev => ({ ...prev, alert_enabled: !prev.alert_enabled }))}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          editForm.alert_enabled ? 'bg-primary-600' : 'bg-slate-200'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            editForm.alert_enabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                    <div>
                      <label className="text-xs text-slate-600 mb-1 block">Description</label>
                      <textarea
                        value={editForm.description as string}
                        onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                        rows={2}
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none resize-none"
                      />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-600">Appetite Level</span>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getAppetiteLevelColor(config.appetite_level)}`}>
                        {getAppetiteLevelLabel(config.appetite_level)}
                      </span>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-600">Tolerance Threshold</span>
                      <span className="text-slate-900 font-medium">{config.tolerance_threshold || '-'}</span>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-600">Risks Exceeding</span>
                      <span className={`font-bold ${config.exceeding_count > 0 ? 'text-red-400' : 'text-green-400'}`}>
                        {config.exceeding_count} / {config.risks_count}
                      </span>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-slate-600">Alerts</span>
                      {config.alert_enabled ? (
                        <Bell className="h-4 w-4 text-green-400" />
                      ) : (
                        <BellOff className="h-4 w-4 text-slate-500" />
                      )}
                    </div>

                    {config.description && (
                      <p className="text-xs text-slate-500 pt-1 border-t border-slate-200">{config.description}</p>
                    )}
                  </>
                )}

                {showAiSuggestion && (
                  <div className="mt-3 p-3 rounded-lg border border-purple-500/30 bg-gradient-to-br from-purple-500/10 to-blue-500/10">
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="h-3.5 w-3.5 text-purple-400" />
                      <span className="text-xs font-semibold text-purple-400">AI Suggestion</span>
                    </div>
                    <div className="space-y-1 text-xs">
                      <p className="text-slate-700"><span className="text-slate-600">Level:</span> {getAppetiteLevelLabel(aiSuggestion.appetite_level as AppetiteLevel)}</p>
                      <p className="text-slate-700"><span className="text-slate-600">Threshold:</span> {aiSuggestion.tolerance_threshold}</p>
                      <p className="text-slate-700"><span className="text-slate-600">Max Score:</span> {aiSuggestion.max_acceptable_score}</p>
                      <p className="text-slate-600 mt-1">{aiSuggestion.rationale}</p>
                    </div>
                    {!isEditing && (
                      <button
                        onClick={() => applyAiSuggestion(config)}
                        className="mt-2 w-full px-3 py-1.5 rounded-lg bg-purple-500/20 text-purple-300 text-xs font-medium hover:bg-purple-500/30 transition-colors"
                      >
                        Apply Suggestion
                      </button>
                    )}
                  </div>
                )}
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
              <p className="text-sm text-slate-600">{toleranceBreaches.length} risk(s) currently exceed their category tolerance threshold</p>
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
                        className="text-slate-900 font-medium hover:text-primary-400 flex items-center gap-1"
                      >
                        {breach.risk_title}
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                      <span className={`text-xs ${catStyle.color}`}>{catStyle.label}</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-6 text-sm">
                    <div className="text-center">
                      <p className="text-slate-600">Score vs Threshold</p>
                      <p className="font-medium">
                        <span className="text-red-400">{breach.current_score}</span>
                        <span className="text-slate-500"> / </span>
                        <span className="text-slate-700">{breach.tolerance}</span>
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-slate-600">Days Over</p>
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
              <p className="text-sm text-slate-600">No risks currently exceed their category tolerance threshold</p>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <TrendingUp className="h-5 w-5 text-primary-400" />
            <h3 className="text-lg font-semibold text-slate-900">Risk Appetite Configuration</h3>
          </div>
          <p className="text-sm text-slate-600 mt-1">Configure appetite levels, thresholds, and escalation settings for each risk category</p>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Category</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Appetite Level</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Tolerance Threshold</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">Escalation Owner</th>
                <th className="px-6 py-3 text-center text-xs font-medium text-slate-600 uppercase tracking-wider">Alerts Enabled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
              {appetiteConfigs.map(config => {
                const catStyle = getCategoryStyle(config.category);
                return (
                  <tr key={config.id} className="hover:bg-slate-100/30">
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
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
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
                        className="w-24 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-slate-700">
                        {config.escalation_owner?.full_name || config.escalation_owner?.email || 'Not assigned'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={() => handleConfigChange(config.id, 'alert_enabled', !(getConfigValue(config, 'alert_enabled') as boolean))}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                          getConfigValue(config, 'alert_enabled') ? 'bg-primary-600' : 'bg-slate-200'
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

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h3 className="text-lg font-semibold text-slate-900">New Appetite Configuration</h3>
              <button onClick={() => setShowCreateModal(false)} className="rounded p-1 hover:bg-slate-100 text-slate-500">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 p-6">
              <div>
                <label className="label">Category</label>
                <select
                  value={createForm.category}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, category: e.target.value as RiskCategory }))}
                  className="select w-full"
                >
                  {RISK_CATEGORIES.map(c => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Appetite Level</label>
                <select
                  value={createForm.appetite_level}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, appetite_level: e.target.value as AppetiteLevel }))}
                  className="select w-full"
                >
                  {APPETITE_LEVELS.map(l => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Tolerance Threshold</label>
                  <input
                    type="number" min="1" max="25"
                    value={createForm.tolerance_threshold}
                    onChange={(e) => setCreateForm(prev => ({ ...prev, tolerance_threshold: parseFloat(e.target.value) || 0 }))}
                    className="input w-full"
                  />
                </div>
                <div>
                  <label className="label">Max Acceptable Score</label>
                  <input
                    type="number" min="1" max="25"
                    value={createForm.max_acceptable_score}
                    onChange={(e) => setCreateForm(prev => ({ ...prev, max_acceptable_score: parseFloat(e.target.value) || 0 }))}
                    className="input w-full"
                  />
                </div>
              </div>
              <div>
                <label className="label">Description</label>
                <textarea
                  value={createForm.description}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, description: e.target.value }))}
                  rows={3}
                  className="input w-full resize-none"
                  placeholder="Optional description..."
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-700">Enable Breach Alerts</span>
                <button
                  type="button"
                  onClick={() => setCreateForm(prev => ({ ...prev, alert_enabled: !prev.alert_enabled }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    createForm.alert_enabled ? 'bg-primary-600' : 'bg-slate-200'
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    createForm.alert_enabled ? 'translate-x-6' : 'translate-x-1'
                  }`} />
                </button>
              </div>
            </div>
            <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
              <button onClick={() => setShowCreateModal(false)} className="btn-secondary btn-sm">Cancel</button>
              <button
                onClick={() => createMutation.mutate(createForm)}
                disabled={createMutation.isPending}
                className="btn-primary btn-sm"
              >
                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
