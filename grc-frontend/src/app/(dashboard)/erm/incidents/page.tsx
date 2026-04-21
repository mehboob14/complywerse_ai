'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ermApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  RiskIncident,
  RiskIncidentCreate,
  Risk,
  IncidentSeverity,
  IncidentStatus,
} from '@/types';
import {
  AlertTriangle,
  Loader2,
  Plus,
  X,
  Edit2,
  Trash2,
  DollarSign,
  AlertCircle,
  CheckCircle,
  Clock,
  Sparkles,
  Brain,
  ChevronRight,
  Shield,
  Link2,
  Target,
  TrendingUp,
} from 'lucide-react';

const SEVERITIES: { value: IncidentSeverity; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'bg-green-500/20 text-green-400' },
  { value: 'medium', label: 'Medium', color: 'bg-yellow-500/20 text-yellow-400' },
  { value: 'high', label: 'High', color: 'bg-orange-500/20 text-orange-400' },
  { value: 'critical', label: 'Critical', color: 'bg-red-500/20 text-red-400' },
];

const INCIDENT_STATUSES: { value: IncidentStatus; label: string; color: string }[] = [
  { value: 'open', label: 'Open', color: 'bg-red-500/20 text-red-400' },
  { value: 'investigating', label: 'Investigating', color: 'bg-yellow-500/20 text-yellow-400' },
  { value: 'mitigating', label: 'Mitigating', color: 'bg-blue-500/20 text-blue-400' },
  { value: 'resolved', label: 'Resolved', color: 'bg-green-500/20 text-green-400' },
  { value: 'closed', label: 'Closed', color: 'bg-slate-500/20 text-slate-600' },
];

type AIAnalysisResult = {
  root_cause_analysis: {
    primary_cause: string;
    contributing_factors: string[];
    category: string;
    preventability: string;
  };
  related_risks: Array<{
    risk_id: number;
    risk_title: string;
    relevance: string;
    explanation: string;
  }>;
  related_controls: Array<{
    control_id: number;
    control_title: string;
    framework: string;
    relevance: string;
    status_recommendation: string;
  }>;
  recommended_actions: string[];
  similar_incidents: Array<{
    incident_id: number;
    title: string;
    similarity: number;
  }>;
  impact_assessment: {
    financial_impact: string;
    reputational_impact: string;
    regulatory_impact: string;
    operational_impact: string;
  };
};

export default function IncidentsPage() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('erm:incidents:create');
  const canDelete = hasPermission('erm:incidents:delete');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingIncident, setEditingIncident] = useState<RiskIncident | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [analyzingIncident, setAnalyzingIncident] = useState<RiskIncident | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const queryClient = useQueryClient();

  const { data: incidents, isLoading } = useQuery({
    queryKey: ['erm-incidents', severityFilter, statusFilter],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (severityFilter !== 'all') params.severity = severityFilter;
      if (statusFilter !== 'all') params.status_filter = statusFilter;
      const response = await ermApi.incidents.getAll(params);
      return response.data;
    },
  });

  const { data: incidentDashboard } = useQuery({
    queryKey: ['erm-incident-dashboard'],
    queryFn: async () => {
      const response = await ermApi.incidents.getDashboard();
      return response.data;
    },
  });

  const { data: risks } = useQuery({
    queryKey: ['erm-risks-list'],
    queryFn: async () => {
      const response = await ermApi.risks.getAll();
      return response.data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => ermApi.incidents.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['erm-incidents'] });
      queryClient.invalidateQueries({ queryKey: ['erm-incident-dashboard'] });
    },
  });

  const handleAnalyzeWithAI = async (incident: RiskIncident) => {
    setAnalyzingIncident(incident);
    setAiAnalysis(null);
    setIsAnalyzing(true);
    try {
      const response = await ermApi.incidents.analyzeWithAI({
        title: incident.title,
        description: incident.description || '',
        severity: incident.severity,
        incident_date: incident.incident_date,
      });
      setAiAnalysis(response.data);
    } catch (error) {
      console.error('AI analysis failed:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-red-500/20 p-2">
              <AlertTriangle className="h-5 w-5 text-red-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{incidentDashboard?.open_incidents || 0}</p>
              <p className="text-sm text-slate-600">Open Incidents</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-yellow-500/20 p-2">
              <Clock className="h-5 w-5 text-yellow-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{incidentDashboard?.investigating || 0}</p>
              <p className="text-sm text-slate-600">Investigating</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-green-500/20 p-2">
              <CheckCircle className="h-5 w-5 text-green-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{incidentDashboard?.resolved_this_month || 0}</p>
              <p className="text-sm text-slate-600">Resolved (Month)</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-orange-500/20 p-2">
              <DollarSign className="h-5 w-5 text-orange-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">
                ${((incidentDashboard?.total_financial_impact || 0) / 1000).toFixed(0)}K
              </p>
              <p className="text-sm text-slate-600">Total Impact</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-2">
          <select
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900"
          >
            <option value="all">All Severities</option>
            {SEVERITIES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-sm text-slate-900"
          >
            <option value="all">All Statuses</option>
            {INCIDENT_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>
        {canCreate && (
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-white hover:bg-primary-500"
        >
          <Plus className="h-4 w-4" />
          Report Incident
        </button>
        )}
      </div>

      {incidents && incidents.length > 0 ? (
        <div className="space-y-3">
          {incidents.map((incident) => {
            const severityStyle = SEVERITIES.find((s) => s.value === incident.severity);
            const statusStyle = INCIDENT_STATUSES.find((s) => s.value === incident.status);
            
            return (
              <div
                key={incident.id}
                className="rounded-xl border border-slate-200 bg-white p-4 hover:border-slate-300"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="font-medium text-slate-900">{incident.title}</h3>
                    <p className="mt-1 text-sm text-slate-600 line-clamp-2">{incident.description}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${severityStyle?.color || ''}`}>
                        {incident.severity}
                      </span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle?.color || ''}`}>
                        {incident.status}
                      </span>
                      <span className="text-xs text-slate-500">
                        {new Date(incident.incident_date).toLocaleDateString()}
                      </span>
                      {incident.financial_impact && (
                        <span className="flex items-center gap-1 text-xs text-orange-400">
                          <DollarSign className="h-3 w-3" />
                          {incident.financial_impact.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="ml-4 flex gap-1">
                    <button
                      onClick={() => handleAnalyzeWithAI(incident)}
                      className="rounded p-1.5 text-slate-600 hover:bg-purple-500/20 hover:text-purple-400"
                      title="AI Analysis"
                    >
                      <Sparkles className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setEditingIncident(incident)}
                      className="rounded p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm('Are you sure you want to delete this incident?')) {
                          deleteMutation.mutate(incident.id);
                        }
                      }}
                      className="rounded p-1.5 text-slate-600 hover:bg-red-500/20 hover:text-red-400"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center rounded-xl border border-slate-200 bg-white">
          <AlertCircle className="h-12 w-12 text-slate-500" />
          <h3 className="mt-4 text-lg font-medium text-slate-900">No incidents found</h3>
          <p className="mt-1 text-slate-600">Report incidents as they occur to track and resolve them</p>
        </div>
      )}

      {(showCreateModal || editingIncident) && (
        <IncidentModal
          incident={editingIncident}
          risks={risks || []}
          onClose={() => {
            setShowCreateModal(false);
            setEditingIncident(null);
          }}
          onSuccess={() => {
            setShowCreateModal(false);
            setEditingIncident(null);
            queryClient.invalidateQueries({ queryKey: ['erm-incidents'] });
            queryClient.invalidateQueries({ queryKey: ['erm-incident-dashboard'] });
          }}
        />
      )}

      {analyzingIncident && (
        <AIAnalysisModal
          incident={analyzingIncident}
          analysis={aiAnalysis}
          isLoading={isAnalyzing}
          onClose={() => {
            setAnalyzingIncident(null);
            setAiAnalysis(null);
          }}
        />
      )}
    </div>
  );
}

function IncidentModal({
  incident,
  risks,
  onClose,
  onSuccess,
}: {
  incident: RiskIncident | null;
  risks: Risk[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState<Partial<RiskIncidentCreate>>({
    risk_id: incident?.risk_id || (risks[0]?.id || 0),
    title: incident?.title || '',
    description: incident?.description || '',
    incident_date: incident?.incident_date?.split('T')[0] || new Date().toISOString().split('T')[0],
    severity: incident?.severity || 'medium',
    financial_impact: incident?.financial_impact,
    root_cause: incident?.root_cause || '',
    corrective_actions: incident?.corrective_actions || '',
  });
  const [status, setStatus] = useState<IncidentStatus>(incident?.status || 'open');
  const [aiSuggestionNote, setAiSuggestionNote] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: RiskIncidentCreate) => ermApi.incidents.create(data),
    onSuccess,
  });

  const updateMutation = useMutation({
    mutationFn: (data: { id: number; updates: Partial<RiskIncidentCreate & { status: IncidentStatus }> }) =>
      ermApi.incidents.update(data.id, data.updates),
    onSuccess,
  });

  const aiSuggestMutation = useMutation({
    mutationFn: () =>
      ermApi.incidents.aiSuggestManual({
        title: formData.title || '',
        description: formData.description,
        severity: formData.severity,
        risk_id: formData.risk_id,
      }),
    onSuccess: (response) => {
      const suggestion = response.data.suggestion;
      setFormData((prev) => ({
        ...prev,
        severity: (suggestion.suggested_severity as IncidentSeverity) || prev.severity,
        root_cause: prev.root_cause || suggestion.root_cause || '',
        corrective_actions: prev.corrective_actions || suggestion.corrective_actions || '',
        operational_impact: prev.operational_impact || suggestion.operational_impact || '',
      }));
      setAiSuggestionNote(suggestion.rationale || 'AI suggestions applied');
    },
    onError: () => {
      setAiSuggestionNote('AI suggestion failed. Please try again.');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (incident) {
      updateMutation.mutate({ id: incident.id, updates: { ...formData, status } });
    } else {
      createMutation.mutate(formData as RiskIncidentCreate);
    }
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">{incident ? 'Edit Incident' : 'Report Incident'}</h2>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-slate-600">Use AI to prefill incident assessment fields</p>
              <button
                type="button"
                onClick={() => aiSuggestMutation.mutate()}
                disabled={!formData.title || aiSuggestMutation.isPending}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 hover:bg-slate-100 disabled:opacity-50"
              >
                {aiSuggestMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                AI Suggest
              </button>
            </div>
            {aiSuggestionNote && <p className="mt-2 text-xs text-slate-600">{aiSuggestionNote}</p>}
          </div>

          <div>
            <label className="block text-sm text-slate-600">Title</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-600">Related Risk</label>
              <select
                value={formData.risk_id}
                onChange={(e) => setFormData({ ...formData, risk_id: Number(e.target.value) })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
                required
              >
                {risks.map((risk) => (
                  <option key={risk.id} value={risk.id}>
                    {risk.title}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-600">Incident Date</label>
              <input
                type="date"
                value={formData.incident_date}
                onChange={(e) => setFormData({ ...formData, incident_date: e.target.value })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-slate-600">Severity</label>
              <select
                value={formData.severity}
                onChange={(e) => setFormData({ ...formData, severity: e.target.value as IncidentSeverity })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
              >
                {SEVERITIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            {incident && (
              <div>
                <label className="block text-sm text-slate-600">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as IncidentStatus)}
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
                >
                  {INCIDENT_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm text-slate-600">Financial Impact ($)</label>
              <input
                type="number"
                value={formData.financial_impact || ''}
                onChange={(e) => setFormData({ ...formData, financial_impact: e.target.value ? Number(e.target.value) : undefined })}
                className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-slate-600">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
              rows={2}
            />
          </div>

          <div>
            <label className="block text-sm text-slate-600">Root Cause</label>
            <textarea
              value={formData.root_cause}
              onChange={(e) => setFormData({ ...formData, root_cause: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
              rows={2}
            />
          </div>

          <div>
            <label className="block text-sm text-slate-600">Corrective Actions</label>
            <textarea
              value={formData.corrective_actions}
              onChange={(e) => setFormData({ ...formData, corrective_actions: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
              rows={2}
            />
          </div>

          <div>
            <label className="block text-sm text-slate-600">Operational Impact</label>
            <textarea
              value={formData.operational_impact || ''}
              onChange={(e) => setFormData({ ...formData, operational_impact: e.target.value })}
              className="mt-1 w-full rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-slate-900"
              rows={2}
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
              {incident ? 'Update' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AIAnalysisModal({
  incident,
  analysis,
  isLoading,
  onClose,
}: {
  incident: RiskIncident;
  analysis: AIAnalysisResult | null;
  isLoading: boolean;
  onClose: () => void;
}) {
  const getImpactColor = (level: string) => {
    switch (level) {
      case 'critical': return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'high': return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      case 'medium': return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30';
      case 'low': return 'bg-green-500/20 text-green-400 border-green-500/30';
      default: return 'bg-slate-500/20 text-slate-600 border-slate-500/30';
    }
  };

  const getRelevanceColor = (level: string) => {
    switch (level) {
      case 'high': return 'bg-purple-500/20 text-purple-400';
      case 'medium': return 'bg-blue-500/20 text-blue-400';
      case 'low': return 'bg-slate-500/20 text-slate-600';
      default: return 'bg-slate-500/20 text-slate-600';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl bg-white p-6">
        <div className="flex items-center justify-between border-b border-slate-200 pb-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-gradient-to-br from-purple-500/20 to-blue-500/20 p-2">
              <Brain className="h-6 w-6 text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">AI Analysis</h2>
              <p className="text-sm text-slate-600">{incident.title}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-600 hover:text-slate-900">
            <X className="h-5 w-5" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="relative">
              <div className="absolute inset-0 animate-ping rounded-full bg-purple-500/30" />
              <Sparkles className="relative h-12 w-12 text-purple-400 animate-pulse" />
            </div>
            <p className="mt-4 text-slate-600">Analyzing incident with AI...</p>
            <p className="text-xs text-slate-500 mt-1">This may take a few seconds</p>
          </div>
        ) : analysis ? (
          <div className="mt-6 space-y-6">
            <div className="rounded-xl border border-purple-500/20 bg-gradient-to-br from-purple-900/20 to-blue-900/20 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Target className="h-5 w-5 text-purple-400" />
                <h3 className="font-semibold text-slate-900">Root Cause Analysis</h3>
              </div>
              <p className="text-slate-700">{analysis.root_cause_analysis.primary_cause}</p>
              {analysis.root_cause_analysis.contributing_factors.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs text-slate-600 mb-2">Contributing Factors:</p>
                  <ul className="space-y-1">
                    {analysis.root_cause_analysis.contributing_factors.map((factor, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                        <ChevronRight className="h-4 w-4 text-purple-400 mt-0.5 flex-shrink-0" />
                        {factor}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs ${getImpactColor(analysis.root_cause_analysis.category)}`}>
                  {analysis.root_cause_analysis.category}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${getImpactColor(analysis.root_cause_analysis.preventability)}`}>
                  {analysis.root_cause_analysis.preventability} preventability
                </span>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-3">
              <div className={`rounded-lg border p-3 ${getImpactColor(analysis.impact_assessment.financial_impact)}`}>
                <p className="text-xs opacity-70">Financial</p>
                <p className="font-semibold capitalize">{analysis.impact_assessment.financial_impact}</p>
              </div>
              <div className={`rounded-lg border p-3 ${getImpactColor(analysis.impact_assessment.reputational_impact)}`}>
                <p className="text-xs opacity-70">Reputational</p>
                <p className="font-semibold capitalize">{analysis.impact_assessment.reputational_impact}</p>
              </div>
              <div className={`rounded-lg border p-3 ${getImpactColor(analysis.impact_assessment.regulatory_impact)}`}>
                <p className="text-xs opacity-70">Regulatory</p>
                <p className="font-semibold capitalize">{analysis.impact_assessment.regulatory_impact}</p>
              </div>
              <div className={`rounded-lg border p-3 ${getImpactColor(analysis.impact_assessment.operational_impact)}`}>
                <p className="text-xs opacity-70">Operational</p>
                <p className="font-semibold capitalize">{analysis.impact_assessment.operational_impact}</p>
              </div>
            </div>

            {analysis.related_risks.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="h-5 w-5 text-orange-400" />
                  <h3 className="font-semibold text-slate-900">Related Risks</h3>
                </div>
                <div className="space-y-2">
                  {analysis.related_risks.map((risk, i) => (
                    <div key={i} className="rounded-lg border border-slate-200 bg-white/50 p-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-medium text-slate-900">{risk.risk_title}</p>
                          <p className="text-sm text-slate-600 mt-1">{risk.explanation}</p>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${getRelevanceColor(risk.relevance)}`}>
                          {risk.relevance}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {analysis.related_controls.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="h-5 w-5 text-blue-400" />
                  <h3 className="font-semibold text-slate-900">Related Controls</h3>
                </div>
                <div className="space-y-2">
                  {analysis.related_controls.map((control, i) => (
                    <div key={i} className="rounded-lg border border-slate-200 bg-white/50 p-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-slate-900">{control.control_title}</p>
                            <span className="rounded bg-blue-500/20 px-1.5 py-0.5 text-xs text-blue-400">
                              {control.framework}
                            </span>
                          </div>
                          <p className="text-sm text-slate-600 mt-1">{control.status_recommendation}</p>
                        </div>
                        <span className={`rounded-full px-2 py-0.5 text-xs ${getRelevanceColor(control.relevance)}`}>
                          {control.relevance}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {analysis.recommended_actions.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle className="h-5 w-5 text-green-400" />
                  <h3 className="font-semibold text-slate-900">Recommended Actions</h3>
                </div>
                <div className="space-y-2">
                  {analysis.recommended_actions.map((action, i) => (
                    <div key={i} className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white/50 p-3">
                      <div className="rounded-full border border-slate-300 p-1">
                        <div className="h-2 w-2 rounded-full bg-slate-200" />
                      </div>
                      <p className="text-sm text-slate-700">{action}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {analysis.similar_incidents.length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Link2 className="h-5 w-5 text-slate-600" />
                  <h3 className="font-semibold text-slate-900">Similar Incidents</h3>
                </div>
                <div className="space-y-2">
                  {analysis.similar_incidents.map((inc, i) => (
                    <div key={i} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white/50 p-3">
                      <p className="text-sm text-slate-700">{inc.title}</p>
                      <span className="text-xs text-slate-600">
                        {Math.round(inc.similarity * 100)}% match
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16">
            <AlertCircle className="h-12 w-12 text-red-400" />
            <p className="mt-4 text-slate-600">Failed to analyze incident</p>
          </div>
        )}

        <div className="mt-6 flex justify-end border-t border-slate-200 pt-4">
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
