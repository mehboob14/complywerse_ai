'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { assetsApi, ermApi, evidenceApi, vulnManagementApi } from '@/lib/api';
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
  Edit2,
  Trash2,
  Banknote,
  AlertCircle,
  CheckCircle,
  Clock,
  ShieldCheck,
  Sparkles,
  Brain,
  ChevronRight,
  Shield,
  Link2,
  Target,
  TrendingUp,
  Upload,
  Tag,
  User,
} from 'lucide-react';
import { MultiSelectDropdown, RightSlidePanel, PageLoader } from '@/components/ui';
import AiRecommendationSaver from '@/components/ai/AiRecommendationSaver';
import { ImportIncidentsModal } from './ImportIncidentsModal';
import {
  BOUNDARY_TYPES, BUSINESS_LINES, EVENT_TYPES, VALIDATION_STATUSES, formatMoney, labelOf, lossPayload, netLoss,
  type BoundaryType, type CurrencyAmount, type LossDashboard, type LossEvent, type LossFields,
} from './lossEvents';

const FIELD = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500';

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 border-t border-slate-200 pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">{title}</h3>
      {children}
    </section>
  );
}

/** One line per currency: amounts in different currencies are never added together. */
function PerCurrency({ amounts }: { amounts?: CurrencyAmount[] }) {
  if (!amounts?.length) return <p className="text-2xl font-bold text-slate-900">0</p>;
  return (
    <div className="space-y-0.5">
      {amounts.map((a) => (
        <p key={a.currency ?? '-'} className="text-lg font-bold leading-tight text-slate-900">{formatMoney(a.net_loss, a.currency)}</p>
      ))}
    </div>
  );
}

const SEVERITIES: { value: IncidentSeverity; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'bg-emerald-50 text-emerald-700' },
  { value: 'medium', label: 'Medium', color: 'bg-amber-50 text-amber-700' },
  { value: 'high', label: 'High', color: 'bg-orange-50 text-orange-700' },
  { value: 'critical', label: 'Critical', color: 'bg-rose-50 text-rose-700' },
];

const INCIDENT_STATUSES: { value: IncidentStatus; label: string; color: string }[] = [
  { value: 'open', label: 'Open', color: 'bg-rose-50 text-rose-700' },
  { value: 'investigating', label: 'Investigating', color: 'bg-amber-50 text-amber-700' },
  { value: 'mitigating', label: 'Mitigating', color: 'bg-primary-50 text-primary-700' },
  { value: 'resolved', label: 'Resolved', color: 'bg-emerald-50 text-emerald-700' },
  { value: 'closed', label: 'Closed', color: 'bg-slate-100 text-slate-600' },
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
  const { hasAnyPermission } = usePermissions();
  // Same names the API accepts: the incident right, or the risk right as a fallback.
  const canCreate = hasAnyPermission(['erm:incidents:create', 'erm:risks:create']);
  const canEdit = hasAnyPermission(['erm:incidents:edit', 'erm:risks:edit']);
  const canDelete = hasAnyPermission(['erm:incidents:delete', 'erm:risks:delete']);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingIncident, setEditingIncident] = useState<LossEvent | null>(null);
  const [reviewing, setReviewing] = useState<LossEvent | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [eventTypeFilter, setEventTypeFilter] = useState<string>('all');
  const [validationFilter, setValidationFilter] = useState<string>('all');
  const [analyzingIncident, setAnalyzingIncident] = useState<RiskIncident | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<AIAnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const queryClient = useQueryClient();

  const { data: incidents, isLoading } = useQuery({
    queryKey: ['erm-incidents', severityFilter, statusFilter, eventTypeFilter, validationFilter],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (severityFilter !== 'all') params.severity = severityFilter;
      if (statusFilter !== 'all') params.status_filter = statusFilter;
      if (eventTypeFilter !== 'all') params.event_type = eventTypeFilter;
      if (validationFilter !== 'all') params.validation_status = validationFilter;
      const response = await ermApi.incidents.getAll(params);
      return response.data as LossEvent[];
    },
    placeholderData: keepPreviousData,
  });

  const { data: incidentDashboard } = useQuery({
    queryKey: ['erm-incident-dashboard'],
    queryFn: async () => {
      const response = await ermApi.incidents.getDashboard();
      return response.data as LossDashboard;
    },
  });

  const refreshLists = () => {
    queryClient.invalidateQueries({ queryKey: ['erm-incidents'] });
    queryClient.invalidateQueries({ queryKey: ['erm-incident-dashboard'] });
  };

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
    // A failed delete used to do nothing at all on screen.
    onError: (e: any) => alert(e?.response?.data?.detail || 'Could not delete the incident.'),
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
      <PageLoader className="h-64" />
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 px-3 sm:px-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Loss Events</h1>
        <p className="text-sm text-slate-600">Operational loss events and near misses, classified by Basel event type and validated by a second person.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-orange-50 p-2">
              <Banknote className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <PerCurrency amounts={incidentDashboard?.net_loss_this_quarter} />
              <p className="text-sm text-slate-600">Net loss this quarter</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-rose-50 p-2">
              <AlertTriangle className="h-5 w-5 text-rose-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{incidentDashboard?.open_incidents || 0}</p>
              <p className="text-sm text-slate-600">Open events</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-50 p-2">
              <Clock className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{incidentDashboard?.awaiting_validation || 0}</p>
              <p className="text-sm text-slate-600">Awaiting validation</p>
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-emerald-50 p-2">
              <CheckCircle className="h-5 w-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{incidentDashboard?.near_misses || 0}</p>
              <p className="text-sm text-slate-600">Near misses</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap gap-2">
          <MultiSelectDropdown
            title="Severity"
            items={SEVERITIES.map((s) => ({ value: s.value, label: s.label }))}
            selectedValues={severityFilter !== 'all' ? [severityFilter] : []}
            onApply={(values) => setSeverityFilter(values[0] || 'all')}
            multiSelect={false}
            placeholder="All Severities"
          />
          <MultiSelectDropdown
            title="Status"
            items={INCIDENT_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
            selectedValues={statusFilter !== 'all' ? [statusFilter] : []}
            onApply={(values) => setStatusFilter(values[0] || 'all')}
            multiSelect={false}
            placeholder="All Statuses"
          />
          <MultiSelectDropdown
            title="Event type"
            items={EVENT_TYPES}
            selectedValues={eventTypeFilter !== 'all' ? [eventTypeFilter] : []}
            onApply={(values) => setEventTypeFilter(values[0] || 'all')}
            multiSelect={false}
            placeholder="All event types"
          />
          <MultiSelectDropdown
            title="Validation"
            items={VALIDATION_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
            selectedValues={validationFilter !== 'all' ? [validationFilter] : []}
            onApply={(values) => setValidationFilter(values[0] || 'all')}
            multiSelect={false}
            placeholder="Any validation"
          />
        </div>
        {canCreate && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowImport(true)}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Upload className="h-4 w-4" />
              Import
            </button>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm text-[#0a0a0a] hover:bg-primary-700"
            >
              <Plus className="h-4 w-4" />
              Report event
            </button>
          </div>
        )}
      </div>

      {incidents && incidents.length > 0 ? (
        <div className="space-y-3">
          {incidents.map((incident) => {
            const severityStyle = SEVERITIES.find((s) => s.value === incident.severity);
            const statusStyle = INCIDENT_STATUSES.find((s) => s.value === incident.status);
            const validation = VALIDATION_STATUSES.find((s) => s.value === (incident.validation_status || 'pending'));
            const net = incident.net_loss ?? incident.financial_impact;

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
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                        {incident.event_type ? labelOf(EVENT_TYPES, incident.event_type) : 'Not classified'}
                      </span>
                      {incident.is_near_miss && (
                        <span className="rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700">Near miss</span>
                      )}
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${validation?.color || ''}`}>
                        {validation?.label}
                      </span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${severityStyle?.color || ''}`}>
                        {incident.severity}
                      </span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle?.color || ''}`}>
                        {incident.status}
                      </span>
                      <span className="text-xs text-slate-500">
                        {new Date(incident.incident_date).toLocaleDateString()}
                      </span>
                      {incident.assignee_name && (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-600">
                          <User className="h-3 w-3" />
                          {incident.assignee_name}
                        </span>
                      )}
                      {net != null && (
                        <span className="flex items-center gap-1 text-xs text-orange-600" title="Net loss">
                          <Banknote className="h-3 w-3" />
                          Net {formatMoney(net, incident.currency)}
                        </span>
                      )}
                      {(incident.link_counts?.assets ||
                        incident.link_counts?.vulnerabilities ||
                        incident.link_counts?.risks ||
                        incident.link_counts?.evidence) ? (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                          <Link2 className="h-3 w-3" />
                          {(incident.link_counts?.assets || 0) +
                            (incident.link_counts?.vulnerabilities || 0) +
                            (incident.link_counts?.risks || 0) +
                            (incident.link_counts?.evidence || 0)}{' '}
                          linked
                        </span>
                      ) : null}
                    </div>
                    {incident.tags && incident.tags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {incident.tags.map((tag) => (
                          <span
                            key={tag}
                            className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-700"
                          >
                            <Tag className="h-3 w-3 text-slate-400" />
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="ml-4 flex gap-1">
                    <button
                      onClick={() => handleAnalyzeWithAI(incident)}
                      className="rounded p-1.5 text-slate-600 hover:bg-primary-50 hover:text-primary-600"
                      title="AI Analysis"
                    >
                      <Sparkles className="h-4 w-4" />
                    </button>
                    {canEdit && incident.validation_status !== 'validated' && (
                      <button
                        onClick={() => setReviewing(incident)}
                        className="rounded p-1.5 text-slate-600 hover:bg-emerald-50 hover:text-emerald-600"
                        title="Validate or return"
                      >
                        <ShieldCheck className="h-4 w-4" />
                      </button>
                    )}
                    {canEdit && (
                      <button
                        onClick={() => setEditingIncident(incident)}
                        className="rounded p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                        title="Edit"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                    )}
                    {canDelete && (
                      <button
                        onClick={() => {
                          if (confirm('Are you sure you want to delete this loss event?')) {
                            deleteMutation.mutate(incident.id);
                          }
                        }}
                        className="rounded p-1.5 text-slate-600 hover:bg-rose-50 hover:text-rose-600"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center rounded-xl border border-slate-200 bg-white">
          <AlertCircle className="h-12 w-12 text-slate-500" />
          <h3 className="mt-4 text-lg font-medium text-slate-900">No loss events recorded.</h3>
          <p className="mt-1 text-slate-600">Report loss events and near misses as they are found.</p>
        </div>
      )}

      {showImport && <ImportIncidentsModal onClose={() => setShowImport(false)} />}

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
            refreshLists();
          }}
        />
      )}

      {reviewing && (
        <ReviewPanel
          event={reviewing}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null);
            refreshLists();
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
  incident: LossEvent | null;
  risks: Risk[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState<Partial<RiskIncidentCreate> & LossFields>({
    risk_id: incident?.risk_id || undefined,
    title: incident?.title || '',
    description: incident?.description || '',
    incident_date: incident?.incident_date?.split('T')[0] || new Date().toISOString().split('T')[0],
    discovered_date: incident?.discovered_date?.split('T')[0] || '',
    accounting_date: incident?.accounting_date?.split('T')[0] || '',
    severity: incident?.severity || 'medium',
    event_type: incident?.event_type || '',
    event_type_l2: incident?.event_type_l2 || '',
    business_line: incident?.business_line || '',
    is_near_miss: !!incident?.is_near_miss,
    boundary_type: incident?.boundary_type || 'none',
    // a record from before loss events has only financial_impact: it is the gross loss
    gross_loss: incident?.gross_loss ?? incident?.financial_impact ?? null,
    recoveries: incident?.recoveries ?? null,
    currency: incident?.currency || '',
    operational_impact: incident?.operational_impact || '',
    root_cause: incident?.root_cause || '',
    corrective_actions: incident?.corrective_actions || '',
    assigned_to: incident?.assigned_to,
    tags: incident?.tags || [],
    linked_asset_ids: [],
    linked_vulnerability_ids: [],
    linked_risk_ids: incident?.risk_id ? [incident.risk_id] : [],
    linked_evidence_ids: [],
  });
  const [tagsInput, setTagsInput] = useState((incident?.tags || []).join(', '));
  const [status, setStatus] = useState<IncidentStatus>(incident?.status || 'open');
  const [aiSuggestionNote, setAiSuggestionNote] = useState<string | null>(null);
  const [linksLoaded, setLinksLoaded] = useState(!incident);

  const { data: tenantUsers } = useQuery({
    queryKey: ['tenant-users'],
    queryFn: async () => {
      const r = await assetsApi.getTenantUsers();
      return r.data;
    },
  });

  const { data: assets } = useQuery({
    queryKey: ['assets-for-incident-link'],
    queryFn: async () => {
      const r = await assetsApi.getAll({ limit: 500 });
      return r.data;
    },
  });

  const { data: vulnerabilities } = useQuery({
    queryKey: ['vulns-for-incident-link'],
    queryFn: async () => {
      const r = await vulnManagementApi.vulnerabilities.getAll({ include_closed: true });
      return Array.isArray(r.data) ? r.data : [];
    },
  });

  const { data: evidenceList } = useQuery({
    queryKey: ['evidence-for-incident-link'],
    queryFn: async () => {
      const r = await evidenceApi.getAll();
      return Array.isArray(r.data) ? r.data : [];
    },
  });

  useEffect(() => {
    if (!incident) return;
    let cancelled = false;
    (async () => {
      try {
        const r = await ermApi.incidents.getLinks(incident.id);
        if (cancelled) return;
        const links = r.data;
        setFormData((prev) => ({
          ...prev,
          linked_asset_ids: links.assets.map((a) => a.asset_id),
          linked_vulnerability_ids: links.vulnerabilities.map((v) => v.vulnerability_id),
          linked_risk_ids: links.risks.map((x) => x.risk_id).length
            ? links.risks.map((x) => x.risk_id)
            : (incident.risk_id ? [incident.risk_id] : []),
          linked_evidence_ids: links.evidence.map((e) => e.evidence_id),
        }));
      } catch {
        // Keep defaults if links endpoint is unavailable
      } finally {
        if (!cancelled) setLinksLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [incident]);

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
        event_type: prev.event_type || suggestion.event_type || '',
        business_line: prev.business_line || suggestion.business_line || '',
      }));
      setAiSuggestionNote(suggestion.rationale || 'AI suggestions applied');
    },
    onError: () => {
      setAiSuggestionNote('AI suggestion failed. Please try again.');
    },
  });

  const parseTags = (raw: string) =>
    raw.split(/[,;]/).map((t) => t.trim()).filter(Boolean);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const tags = parseTags(tagsInput);
    const linkedRiskIds = formData.linked_risk_ids?.length
      ? formData.linked_risk_ids
      : (formData.risk_id ? [formData.risk_id] : []);
    const payload = {
      ...formData,
      ...lossPayload(formData),
      tags,
      linked_risk_ids: linkedRiskIds,
      risk_id: formData.risk_id || linkedRiskIds[0] || undefined,
    };
    if (incident) {
      updateMutation.mutate({ id: incident.id, updates: { ...payload, status } });
    } else {
      createMutation.mutate(payload as RiskIncidentCreate);
    }
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      title={incident ? 'Edit loss event' : 'Report loss event'}
    >
      <form id="incident-form" onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-600">Use AI to suggest the event type, business line and assessment fields</p>
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

        <FormSection title="What happened">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              className={FIELD}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className={FIELD}
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Primary risk</label>
              <MultiSelectDropdown
                title="Risk"
                items={risks.map((risk) => ({
                  value: String(risk.id),
                  label: risk.title,
                  subLabel: risk.risk_category,
                }))}
                selectedValues={formData.risk_id ? [String(formData.risk_id)] : []}
                onApply={(values) => {
                  const rid = values[0] ? Number(values[0]) : undefined;
                  setFormData({
                    ...formData,
                    risk_id: rid,
                    linked_risk_ids: rid
                      ? Array.from(new Set([...(formData.linked_risk_ids || []), rid]))
                      : formData.linked_risk_ids,
                  });
                }}
                multiSelect={false}
                triggerVariant="input"
                triggerClassName="w-full"
                forceSearch
                searchPlaceholder="Search risk by title..."
                placeholder="Select Risk"
                size="md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Severity</label>
              <MultiSelectDropdown
                title="Severity"
                items={SEVERITIES.map((s) => ({ value: s.value, label: s.label }))}
                selectedValues={formData.severity ? [formData.severity] : []}
                onApply={(values) => setFormData({ ...formData, severity: (values[0] as IncidentSeverity) || 'medium' })}
                multiSelect={false}
                triggerVariant="input"
                triggerClassName="w-full"
                placeholder="Select Severity"
                size="md"
              />
            </div>
            {incident && (
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
                <MultiSelectDropdown
                  title="Status"
                  items={INCIDENT_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
                  selectedValues={status ? [status] : []}
                  onApply={(values) => setStatus((values[0] as IncidentStatus) || 'open')}
                  multiSelect={false}
                  triggerVariant="input"
                  triggerClassName="w-full"
                  placeholder="Select Status"
                  size="md"
                />
              </div>
            )}
          </div>
        </FormSection>

        <FormSection title="Classification">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Event type</label>
              <MultiSelectDropdown
                title="Event type"
                items={EVENT_TYPES}
                selectedValues={formData.event_type ? [formData.event_type] : []}
                onApply={(values) => setFormData({ ...formData, event_type: values[0] || '' })}
                multiSelect={false}
                triggerVariant="input"
                triggerClassName="w-full"
                placeholder="Basel level 1"
                size="md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Business line</label>
              <MultiSelectDropdown
                title="Business line"
                items={BUSINESS_LINES}
                selectedValues={formData.business_line ? [formData.business_line] : []}
                onApply={(values) => setFormData({ ...formData, business_line: values[0] || '' })}
                multiSelect={false}
                triggerVariant="input"
                triggerClassName="w-full"
                placeholder="Select business line"
                size="md"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Level 2 type</label>
            <input
              type="text"
              value={formData.event_type_l2 || ''}
              onChange={(e) => setFormData({ ...formData, event_type_l2: e.target.value })}
              placeholder="e.g. Theft and fraud, Systems, Transaction capture"
              className={FIELD}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Boundary</label>
              <MultiSelectDropdown
                title="Boundary"
                items={BOUNDARY_TYPES}
                selectedValues={[formData.boundary_type || 'none']}
                onApply={(values) => setFormData({ ...formData, boundary_type: (values[0] as BoundaryType) || 'none' })}
                multiSelect={false}
                triggerVariant="input"
                triggerClassName="w-full"
                placeholder="Operational only"
                size="md"
              />
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={!!formData.is_near_miss}
                onChange={(e) => setFormData({ ...formData, is_near_miss: e.target.checked })}
                className="h-4 w-4 rounded border-slate-300"
              />
              Near miss (no loss)
            </label>
          </div>
        </FormSection>

        <FormSection title="Amounts">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Gross loss</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={formData.gross_loss ?? ''}
                onChange={(e) => setFormData({ ...formData, gross_loss: e.target.value === '' ? null : Number(e.target.value) })}
                className={FIELD}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Recoveries</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={formData.recoveries ?? ''}
                onChange={(e) => setFormData({ ...formData, recoveries: e.target.value === '' ? null : Number(e.target.value) })}
                className={FIELD}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Net loss <span className="ml-1 text-[10px] font-normal text-slate-400">(gross less recoveries)</span>
              </label>
              <input
                type="text"
                readOnly
                value={(() => {
                  const net = netLoss(formData.gross_loss, formData.recoveries);
                  return net === null ? '' : formatMoney(net, formData.currency?.toUpperCase());
                })()}
                className={`${FIELD} bg-slate-50 text-slate-600`}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Currency</label>
              <input
                type="text"
                maxLength={3}
                value={formData.currency || ''}
                onChange={(e) => setFormData({ ...formData, currency: e.target.value.toUpperCase() })}
                placeholder="USD"
                className={`${FIELD} uppercase`}
              />
            </div>
          </div>
        </FormSection>

        <FormSection title="Dates">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Occurrence *</label>
              <input
                type="date"
                value={formData.incident_date}
                onChange={(e) => setFormData({ ...formData, incident_date: e.target.value })}
                className={FIELD}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Discovery</label>
              <input
                type="date"
                value={formData.discovered_date || ''}
                onChange={(e) => setFormData({ ...formData, discovered_date: e.target.value })}
                className={FIELD}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Accounting</label>
              <input
                type="date"
                value={formData.accounting_date || ''}
                onChange={(e) => setFormData({ ...formData, accounting_date: e.target.value })}
                className={FIELD}
              />
            </div>
          </div>
        </FormSection>

        <FormSection title="Cause and actions">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Root Cause</label>
            <textarea
              value={formData.root_cause}
              onChange={(e) => setFormData({ ...formData, root_cause: e.target.value })}
              className={FIELD}
              rows={2}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Corrective Actions</label>
            <textarea
              value={formData.corrective_actions}
              onChange={(e) => setFormData({ ...formData, corrective_actions: e.target.value })}
              className={FIELD}
              rows={2}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Operational Impact</label>
            <textarea
              value={formData.operational_impact || ''}
              onChange={(e) => setFormData({ ...formData, operational_impact: e.target.value })}
              className={FIELD}
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Assign to</label>
              <MultiSelectDropdown
                title="Assignee"
                items={(tenantUsers || []).map((u) => ({
                  value: String(u.id),
                  label: u.display_name || u.email,
                  subLabel: u.email,
                }))}
                selectedValues={formData.assigned_to ? [String(formData.assigned_to)] : []}
                onApply={(values) =>
                  setFormData({
                    ...formData,
                    assigned_to: values[0] ? Number(values[0]) : undefined,
                  })
                }
                multiSelect={false}
                triggerVariant="input"
                triggerClassName="w-full"
                forceSearch
                searchPlaceholder="Search user..."
                placeholder="Unassigned"
                size="md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Tags</label>
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="e.g. availability, p1, payments"
                className={FIELD}
              />
              <p className="mt-1 text-[11px] text-slate-500">Comma-separated labels</p>
            </div>
          </div>
        </FormSection>

        <div className="rounded-lg border border-slate-200 p-3 space-y-3">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-slate-500" />
            <p className="text-sm font-medium text-slate-800">Cross-module links</p>
            {!linksLoaded && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Related Risks</label>
            <MultiSelectDropdown
              title="Risks"
              items={risks.map((risk) => ({
                value: String(risk.id),
                label: risk.title,
                subLabel: risk.risk_category,
              }))}
              selectedValues={(formData.linked_risk_ids || []).map(String)}
              onApply={(values) =>
                setFormData({ ...formData, linked_risk_ids: values.map(Number) })
              }
              multiSelect
              triggerVariant="input"
              triggerClassName="w-full"
              forceSearch
              searchPlaceholder="Search risks..."
              placeholder="Link risks"
              size="md"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Related Assets</label>
            <MultiSelectDropdown
              title="Assets"
              items={(assets || []).map((a) => ({
                value: String(a.id),
                label: a.name,
                subLabel: a.asset_type,
              }))}
              selectedValues={(formData.linked_asset_ids || []).map(String)}
              onApply={(values) =>
                setFormData({ ...formData, linked_asset_ids: values.map(Number) })
              }
              multiSelect
              triggerVariant="input"
              triggerClassName="w-full"
              forceSearch
              searchPlaceholder="Search assets..."
              placeholder="Link assets"
              size="md"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Related Vulnerabilities</label>
            <MultiSelectDropdown
              title="Vulnerabilities"
              items={(vulnerabilities || []).map((v: { id: number; title?: string; cve_id?: string; severity?: string }) => ({
                value: String(v.id),
                label: v.title || v.cve_id || `Vuln #${v.id}`,
                subLabel: v.severity || v.cve_id,
              }))}
              selectedValues={(formData.linked_vulnerability_ids || []).map(String)}
              onApply={(values) =>
                setFormData({ ...formData, linked_vulnerability_ids: values.map(Number) })
              }
              multiSelect
              triggerVariant="input"
              triggerClassName="w-full"
              forceSearch
              searchPlaceholder="Search vulnerabilities..."
              placeholder="Link vulnerabilities"
              size="md"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Related Evidence</label>
            <MultiSelectDropdown
              title="Evidence"
              items={(evidenceList || []).map((e) => ({
                value: String(e.id),
                label: e.title || `Evidence #${e.id}`,
                subLabel: e.evidence_type,
              }))}
              selectedValues={(formData.linked_evidence_ids || []).map(String)}
              onApply={(values) =>
                setFormData({ ...formData, linked_evidence_ids: values.map(Number) })
              }
              multiSelect
              triggerVariant="input"
              triggerClassName="w-full"
              forceSearch
              searchPlaceholder="Search evidence..."
              placeholder="Link evidence"
              size="md"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="incident-form"
            disabled={isLoading}
            className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              incident ? 'Update' : 'Report'
            )}
          </button>
        </div>
      </form>
    </RightSlidePanel>
  );
}

/** The template's Review screen: a second person validates the classification and amounts, or returns them with a note. */
function ReviewPanel({ event, onClose, onDone }: { event: LossEvent; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: (outcome: 'validate' | 'return') =>
      outcome === 'validate' ? ermApi.incidents.validate(event.id, note) : ermApi.incidents.returnForFix(event.id, note),
    onSuccess: onDone,
  });
  // The server says why: the reporter cannot validate their own event (409), or what is missing (400).
  const refusal = (decide.error as { response?: { data?: { detail?: string } } } | null)?.response?.data?.detail
    || (decide.error ? 'Could not save the decision.' : null);
  const net = event.net_loss ?? netLoss(event.gross_loss ?? event.financial_impact, event.recoveries);
  const day = (d?: string | null) => (d ? new Date(d).toLocaleDateString() : '—');
  const rows: [string, string][] = [
    ['Event type', event.event_type ? labelOf(EVENT_TYPES, event.event_type) : 'Not classified'],
    ['Level 2 type', event.event_type_l2 || '—'],
    ['Business line', event.business_line ? labelOf(BUSINESS_LINES, event.business_line) : '—'],
    ['Near miss', event.is_near_miss ? 'Yes' : 'No'],
    ['Boundary', labelOf(BOUNDARY_TYPES, event.boundary_type || 'none')],
    ['Occurrence / discovery / accounting', `${day(event.incident_date)} / ${day(event.discovered_date)} / ${day(event.accounting_date)}`],
  ];
  const money = (n: number | null | undefined) => (n == null ? '—' : formatMoney(n, event.currency));

  return (
    <RightSlidePanel isOpen onClose={onClose} title="Validate loss event" subtitle={event.title}>
      <div className="space-y-5">
        <FormSection title="Classification">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-slate-500">{k}</dt>
                <dd className="text-slate-900">{v}</dd>
              </div>
            ))}
          </dl>
        </FormSection>
        <FormSection title="Amounts">
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg border border-slate-200 p-3"><p className="text-xs text-slate-500">Gross loss</p><p className="font-semibold text-slate-900">{money(event.gross_loss ?? event.financial_impact)}</p></div>
            <div className="rounded-lg border border-slate-200 p-3"><p className="text-xs text-slate-500">Recoveries</p><p className="font-semibold text-slate-900">{money(event.recoveries)}</p></div>
            <div className="rounded-lg border border-orange-200 bg-orange-50/40 p-3"><p className="text-xs text-slate-500">Net loss</p><p className="font-semibold text-slate-900">{money(net)}</p></div>
          </div>
        </FormSection>
        <FormSection title="Decision">
          {event.validation_note && (
            <p className="text-xs text-slate-600">Last note: {event.validation_note}</p>
          )}
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Note (needed to return: say what to fix)"
            className={FIELD}
          />
          {refusal && <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">{refusal}</div>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => decide.mutate('return')}
              disabled={decide.isPending}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Return
            </button>
            <button
              type="button"
              onClick={() => decide.mutate('validate')}
              disabled={decide.isPending}
              className="cw-btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {decide.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Validate
            </button>
          </div>
        </FormSection>
      </div>
    </RightSlidePanel>
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
      case 'critical': return 'bg-rose-50 text-rose-700 border-rose-200';
      case 'high': return 'bg-orange-50 text-orange-700 border-orange-200';
      case 'medium': return 'bg-amber-50 text-amber-700 border-amber-200';
      case 'low': return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      default: return 'bg-slate-100 text-slate-600 border-slate-200';
    }
  };

  const getRelevanceColor = (level: string) => {
    switch (level) {
      case 'high': return 'bg-primary-50 text-primary-700';
      case 'medium': return 'bg-primary-50 text-primary-700';
      case 'low': return 'bg-slate-100 text-slate-600';
      default: return 'bg-slate-100 text-slate-600';
    }
  };

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      width="w-full max-w-3xl"
      title={
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary-50 p-2">
            <Brain className="h-6 w-6 text-primary-600" strokeWidth={1.75} />
          </div>
          <div>
            <span className="text-lg font-semibold text-slate-900">AI Analysis</span>
            <p className="text-sm text-slate-600 font-normal">{incident.title}</p>
          </div>
        </div>
      }
    >
      <div>
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="relative">
              <div className="absolute inset-0 animate-ping rounded-full bg-primary-100" />
              <Sparkles className="relative h-12 w-12 text-primary-500 animate-pulse" />
            </div>
            <p className="mt-4 text-slate-600">Analyzing incident with AI...</p>
            <p className="text-xs text-slate-500 mt-1">This may take a few seconds</p>
          </div>
        ) : analysis ? (
          <div className="mt-6 space-y-6">
            <AiRecommendationSaver
              module="erm_incident"
              recommendationType="ai_analysis"
              entityType="incident"
              entityId={incident.id}
              title={`AI analysis · ${incident.title}`}
              output={analysis as unknown as Record<string, unknown>}
              model="gpt-4o"
            />
            <div className="rounded-xl border border-primary-200 bg-primary-50 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Target className="h-5 w-5 text-primary-600" />
                <h3 className="font-semibold text-slate-900">Root Cause Analysis</h3>
              </div>
              <p className="text-slate-700">{analysis.root_cause_analysis.primary_cause}</p>
              {analysis.root_cause_analysis.contributing_factors.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs text-slate-600 mb-2">Contributing Factors:</p>
                  <ul className="space-y-1">
                    {analysis.root_cause_analysis.contributing_factors.map((factor, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                        <ChevronRight className="h-4 w-4 text-primary-600 mt-0.5 flex-shrink-0" />
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
                  <AlertTriangle className="h-5 w-5 text-orange-600" />
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
                  <Shield className="h-5 w-5 text-primary-600" />
                  <h3 className="font-semibold text-slate-900">Related Controls</h3>
                </div>
                <div className="space-y-2">
                  {analysis.related_controls.map((control, i) => (
                    <div key={i} className="rounded-lg border border-slate-200 bg-white/50 p-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="font-medium text-slate-900">{control.control_title}</p>
                            <span className="rounded bg-primary-50 px-1.5 py-0.5 text-xs text-primary-700">
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
                  <CheckCircle className="h-5 w-5 text-emerald-600" />
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
            <AlertCircle className="h-12 w-12 text-rose-500" />
            <p className="mt-4 text-slate-600">Failed to analyze incident</p>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2 border-t border-slate-200 pt-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </RightSlidePanel>
  );
}
