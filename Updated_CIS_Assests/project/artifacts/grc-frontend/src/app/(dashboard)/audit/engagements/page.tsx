'use client';

import { useState } from 'react';
import { useRouter } from '@/lib/navigation';
import { useQuery, useMutation } from '@tanstack/react-query';
import { auditApi, apiClient } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  Plus,
  X,
  Filter,
  ClipboardList,
  Calendar,
  Clock,
  Users,
  FileText,
  AlertTriangle,
  ArrowRight,
  Search,
  Target,
  User,
  ChevronRight,
  Pencil,
  Sparkles,
  Loader2,
  BarChart3,
} from 'lucide-react';

const STATUS_COLORS: Record<string, string> = {
  planning: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  fieldwork: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  reporting: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  follow_up: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  closed: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
};

const STATUS_LABELS: Record<string, string> = {
  planning: 'Planning',
  fieldwork: 'Fieldwork',
  reporting: 'Reporting',
  follow_up: 'Follow-up',
  closed: 'Closed',
};

const NEXT_STATUS: Record<string, string> = {
  planning: 'fieldwork',
  fieldwork: 'reporting',
  reporting: 'follow_up',
  follow_up: 'closed',
};

const TYPE_LABELS: Record<string, string> = {
  assurance: 'Assurance',
  advisory: 'Advisory',
  follow_up: 'Follow-up',
};

const FILTER_TABS = [
  { key: '', label: 'All' },
  { key: 'planning', label: 'Planning' },
  { key: 'fieldwork', label: 'Fieldwork' },
  { key: 'reporting', label: 'Reporting' },
  { key: 'follow_up', label: 'Follow-up' },
  { key: 'closed', label: 'Closed' },
];

export default function AuditEngagementsPage() {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('audit:audit_management:create');
  const canEdit = hasPermission('audit:audit_management:edit');
  const [statusFilter, setStatusFilter] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingEngagement, setEditingEngagement] = useState<any>(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [createAiLoading, setCreateAiLoading] = useState(false);
  const [editEngForm, setEditEngForm] = useState({
    title: '',
    description: '',
    engagement_type: 'assurance',
    scope: '',
    objectives: '',
    planned_start: '',
    planned_end: '',
    budget_hours: '',
    lead_auditor_id: '',
  });
  const [newEngagement, setNewEngagement] = useState({
    title: '',
    description: '',
    engagement_type: 'assurance',
    scope: '',
    objectives: '',
    methodology: '',
    planned_start: '',
    planned_end: '',
    budget_hours: '',
  });
  const [riskSuggestionsId, setRiskSuggestionsId] = useState<number|null>(null);
  const [riskSuggestions, setRiskSuggestions] = useState<any>(null);
  const [loadingRiskSuggestions, setLoadingRiskSuggestions] = useState(false);
  const [fieldworkGuidanceId, setFieldworkGuidanceId] = useState<number|null>(null);
  const [fieldworkGuidance, setFieldworkGuidance] = useState<any>(null);
  const [loadingFieldwork, setLoadingFieldwork] = useState(false);

  const { data: engagements, refetch, isLoading } = useQuery({
    queryKey: ['engagements', statusFilter],
    queryFn: () => auditApi.engagements.getAll(statusFilter ? { status: statusFilter } : undefined).then(r => r.data?.engagements || r.data || []),
  });

  const { data: currentUser } = useQuery({
    queryKey: ['current-user'],
    queryFn: () => apiClient.get('/auth/me').then(r => r.data),
  });

  const tenantId = currentUser?.user?.primary_tenant_id || currentUser?.primary_tenant_id;

  const { data: tenantUsers } = useQuery({
    queryKey: ['tenant-users', tenantId],
    queryFn: async () => {
      const response = await apiClient.get(`/tenants/${tenantId}/users`);
      const payload = response.data as unknown;
      if (Array.isArray(payload)) return payload as any[];
      const data = payload as { users?: any[]; items?: any[] };
      return data.users || data.items || [];
    },
    enabled: !!tenantId,
  });

  const normalizedLeadAuditors = Array.from(
    new Map(
      (Array.isArray(tenantUsers) ? tenantUsers : [])
        .map((tenantUser: any) => {
          const userId = tenantUser.user?.id || tenantUser.id || tenantUser.user_id;
          const userName = tenantUser.user?.display_name || tenantUser.user?.username || tenantUser.display_name || tenantUser.username || tenantUser.user?.email || tenantUser.email || 'User';
          if (!userId) return null;
          return { id: userId, name: userName };
        })
        .filter((user): user is { id: number; name: string } => !!user)
        .map((user) => [user.id, user])
    ).values()
  );

  const createMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => auditApi.engagements.create(data).then(r => r.data),
    onSuccess: () => {
      refetch();
      setShowCreateModal(false);
      setNewEngagement({ title: '', description: '', engagement_type: 'assurance', scope: '', objectives: '', methodology: '', planned_start: '', planned_end: '', budget_hours: '' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) =>
      auditApi.engagements.update(id, data).then(r => r.data),
    onSuccess: () => {
      refetch();
      setShowEditModal(false);
      setEditingEngagement(null);
    },
  });

  const transitionMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      auditApi.engagements.transition(id, { new_status: status }).then(r => r.data),
    onSuccess: () => refetch(),
  });

  const openEditEngagement = (eng: any) => {
    setEditingEngagement(eng);
    setEditEngForm({
      title: eng.title || '',
      description: eng.description || '',
      engagement_type: eng.engagement_type || 'assurance',
      scope: eng.scope || '',
      objectives: eng.objectives || '',
      planned_start: eng.planned_start ? eng.planned_start.split('T')[0] : '',
      planned_end: eng.planned_end ? eng.planned_end.split('T')[0] : '',
      budget_hours: eng.budget_hours != null ? String(eng.budget_hours) : '',
      lead_auditor_id: eng.lead_auditor_id != null ? String(eng.lead_auditor_id) : '',
    });
    setShowEditModal(true);
  };

  const handleEditSave = () => {
    if (!editingEngagement) return;
    const payload: Record<string, unknown> = {
      title: editEngForm.title,
      description: editEngForm.description,
      engagement_type: editEngForm.engagement_type,
      scope: editEngForm.scope,
      objectives: editEngForm.objectives,
    };
    if (editEngForm.planned_start) payload.planned_start = editEngForm.planned_start;
    if (editEngForm.planned_end) payload.planned_end = editEngForm.planned_end;
    if (editEngForm.budget_hours) payload.budget_hours = Number(editEngForm.budget_hours);
    if (editEngForm.lead_auditor_id) payload.lead_auditor_id = Number(editEngForm.lead_auditor_id);
    const optionalFields = ['description', 'scope', 'objectives'] as const;
    for (const f of optionalFields) {
      if (!payload[f]) delete payload[f];
    }
    updateMutation.mutate({ id: editingEngagement.id, data: payload });
  };

  const handleAiGenerate = async () => {
    if (!editEngForm.title) return;
    setAiGenerating(true);
    try {
      const entityName = editingEngagement?.entity_name || editingEngagement?.auditable_entity?.name || '';
      const res = await auditApi.ai.generateEngagementDetails({
        title: editEngForm.title,
        entity_name: entityName,
        engagement_type: editEngForm.engagement_type,
      });
      const d = res.data;
      setEditEngForm(prev => ({
        ...prev,
        description: d.description || prev.description,
        scope: d.scope || prev.scope,
        objectives: d.objectives || prev.objectives,
      }));
    } catch (err) {
      console.error('AI generation failed:', err);
    } finally {
      setAiGenerating(false);
    }
  };

  const handleCreateAiScope = async () => {
    if (!newEngagement.title) return;
    setCreateAiLoading(true);
    try {
      const res = await auditApi.ai.generateScope({
        engagement_type: newEngagement.engagement_type || 'assurance',
        title: newEngagement.title,
      });
      const d = res.data?.scope_data;
      if (d) {
        setNewEngagement(prev => ({
          ...prev,
          scope: d.scope || prev.scope,
          objectives: d.objectives || prev.objectives,
          methodology: d.methodology || prev.methodology,
        }));
      }
    } catch (err) {
      console.error('AI scope generation failed:', err);
      alert('Failed to generate scope. Please try again.');
    } finally {
      setCreateAiLoading(false);
    }
  };

  const handleCreate = () => {
    const data: Record<string, unknown> = {
      title: newEngagement.title,
      description: newEngagement.description,
      engagement_type: newEngagement.engagement_type,
      scope: newEngagement.scope,
      objectives: newEngagement.objectives,
      methodology: newEngagement.methodology,
    };
    if (newEngagement.planned_start) data.planned_start = newEngagement.planned_start;
    if (newEngagement.planned_end) data.planned_end = newEngagement.planned_end;
    if (newEngagement.budget_hours) data.budget_hours = parseFloat(newEngagement.budget_hours);
    createMutation.mutate(data);
  };

  const getProgressColor = (actual: number, budget: number) => {
    if (!budget) return 'bg-slate-500';
    const pct = (actual / budget) * 100;
    if (pct > 100) return 'bg-red-500';
    if (pct >= 80) return 'bg-amber-500';
    return 'bg-emerald-500';
  };

  const getProgressPct = (actual: number, budget: number) => {
    if (!budget) return 0;
    return Math.min((actual / budget) * 100, 100);
  };

  const handleRiskSuggestions = async (engId: number) => {
    setRiskSuggestionsId(engId);
    setLoadingRiskSuggestions(true);
    setRiskSuggestions(null);
    try {
      const res = await auditApi.ai.getRiskSuggestions({ engagement_id: engId });
      setRiskSuggestions(res.data);
    } catch (err) { console.error('Risk suggestions failed:', err); }
    finally { setLoadingRiskSuggestions(false); }
  };

  const handleFieldworkGuidance = async (engId: number) => {
    setFieldworkGuidanceId(engId);
    setLoadingFieldwork(true);
    setFieldworkGuidance(null);
    try {
      const res = await auditApi.ai.getFieldworkGuidance({ engagement_id: engId });
      setFieldworkGuidance(res.data);
    } catch (err) { console.error('Fieldwork guidance failed:', err); }
    finally { setLoadingFieldwork(false); }
  };

  const items = Array.isArray(engagements) ? engagements : [];
  const isFollowUpTab = statusFilter === 'follow_up';
  const isClosedTab = statusFilter === 'closed';
  const emptyStateTitle = isFollowUpTab
    ? 'No follow-up engagements'
    : isClosedTab
      ? 'No closed engagements'
      : 'No engagements found';
  const showEmptyCreateCta = !isFollowUpTab && !isClosedTab;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Audit Engagements</h1>
          <p className="text-slate-600 mt-1">Manage audit engagements and track progress</p>
        </div>
        {canCreate && (
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Engagement
        </button>
        )}
      </div>

      <div className="flex items-center gap-1 bg-white rounded-lg p-1 border border-slate-200">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => {
              if (tab.key === 'reporting') {
                router.push('/audit/reporting');
                return;
              }
              setStatusFilter(tab.key);
            }}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              statusFilter === tab.key
                ? 'bg-slate-100 text-slate-900'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-20">
          <ClipboardList className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-600">{emptyStateTitle}</p>
          {showEmptyCreateCta && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-colors"
            >
              Create First Engagement
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4">
          {items.map((eng: any) => {
            const budgetHours = eng.budget_hours || 0;
            const actualHours = eng.actual_hours || 0;
            const nextStatus = NEXT_STATUS[eng.status];

            return (
              <div
                key={eng.id}
                onClick={() => router.push(`/audit/engagements/${eng.id}`)}
                className="bg-white rounded-xl border border-slate-200 p-5 hover:border-blue-300 hover:shadow-sm transition-all cursor-pointer"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 mb-1">
                      {eng.engagement_number && (
                        <span className="text-xs font-mono text-slate-500">{eng.engagement_number}</span>
                      )}
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[eng.status] || 'bg-slate-500/20 text-slate-600 border-slate-500/30'}`}>
                        {STATUS_LABELS[eng.status] || eng.status}
                      </span>
                      {eng.engagement_type && (
                        <span className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-700">
                          {TYPE_LABELS[eng.engagement_type] || eng.engagement_type}
                        </span>
                      )}
                    </div>
                    <h3 className="text-lg font-semibold text-blue-600 hover:text-blue-500 truncate">{eng.title}</h3>
                    {eng.entity_name && (
                      <p className="text-sm text-slate-600 mt-0.5 flex items-center gap-1">
                        <Target className="w-3.5 h-3.5" />
                        {eng.entity_name}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2 ml-4">
                    {canEdit && (
                    <button
                      onClick={(e) => { e.stopPropagation(); openEditEngagement(eng); }}
                      className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 hover:text-slate-900 rounded-lg transition-colors"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    )}
                    {nextStatus && (
                      <button
                        onClick={(e) => { e.stopPropagation(); transitionMutation.mutate({ id: eng.id, status: nextStatus }); }}
                        disabled={transitionMutation.isPending}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs rounded-lg transition-colors whitespace-nowrap"
                      >
                        {STATUS_LABELS[eng.status]}
                        <ArrowRight className="w-3 h-3" />
                        {STATUS_LABELS[nextStatus]}
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Calendar className="w-4 h-4 text-slate-500" />
                    <div>
                      <div className="text-xs text-slate-500">Planned Start</div>
                      <div className="text-slate-700">
                        {eng.planned_start ? new Date(eng.planned_start).toLocaleDateString() : '—'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Calendar className="w-4 h-4 text-slate-500" />
                    <div>
                      <div className="text-xs text-slate-500">Planned End</div>
                      <div className="text-slate-700">
                        {eng.planned_end ? new Date(eng.planned_end).toLocaleDateString() : '—'}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <User className="w-4 h-4 text-slate-500" />
                    <div>
                      <div className="text-xs text-slate-500">Lead Auditor</div>
                      <div className="text-slate-700">{eng.lead_auditor_name || eng.lead_auditor || '—'}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <Users className="w-4 h-4 text-slate-500" />
                    <div>
                      <div className="text-xs text-slate-500">Team Size</div>
                      <div className="text-slate-700">{eng.team_size ?? eng.team_members?.length ?? '—'}</div>
                    </div>
                  </div>
                </div>

                <div className="mb-4">
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-slate-600 flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5" />
                      Budget Utilization
                    </span>
                    <span className="text-slate-700">
                      {actualHours.toFixed(1)}h / {budgetHours.toFixed(1)}h
                      {budgetHours > 0 && (
                        <span className={`ml-1 ${
                          (actualHours / budgetHours) * 100 > 100 ? 'text-red-400' :
                          (actualHours / budgetHours) * 100 >= 80 ? 'text-amber-400' : 'text-emerald-400'
                        }`}>
                          ({((actualHours / budgetHours) * 100).toFixed(0)}%)
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${getProgressColor(actualHours, budgetHours)}`}
                      style={{ width: `${getProgressPct(actualHours, budgetHours)}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-4 pt-3 border-t border-slate-200">
                  <div className="flex items-center gap-1.5 text-sm text-slate-600">
                    <AlertTriangle className="w-4 h-4 text-slate-500" />
                    <span className="text-slate-700 font-medium">{eng.finding_count ?? eng.findings_count ?? 0}</span>
                    <span>Findings</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-sm text-slate-600">
                    <FileText className="w-4 h-4 text-slate-500" />
                    <span className="text-slate-700 font-medium">{eng.workpaper_count ?? eng.workpapers_count ?? 0}</span>
                    <span>Workpapers</span>
                  </div>
                  <div className="flex items-center gap-2 ml-auto">
                    {(eng.status === 'planning' || eng.status === 'fieldwork') && (
                      <button onClick={(e) => { e.stopPropagation(); handleFieldworkGuidance(eng.id); }} className="flex items-center gap-1 px-2.5 py-1 bg-gradient-to-r from-purple-600/80 to-blue-600/80 hover:from-purple-500 hover:to-blue-500 text-slate-900 text-xs rounded-lg transition-all">
                        <Sparkles className="w-3 h-3" />Fieldwork Guide
                      </button>
                    )}
                    {(eng.status === 'reporting' || eng.status === 'follow_up' || eng.status === 'closed') && (
                      <button onClick={(e) => { e.stopPropagation(); handleRiskSuggestions(eng.id); }} className="flex items-center gap-1 px-2.5 py-1 bg-gradient-to-r from-purple-600/80 to-blue-600/80 hover:from-purple-500 hover:to-blue-500 text-slate-900 text-xs rounded-lg transition-all">
                        <Sparkles className="w-3 h-3" />Risk Suggestions
                      </button>
                    )}
                    <span className="flex items-center gap-1 text-xs text-blue-600 font-medium">
                      View Details <ChevronRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {riskSuggestionsId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2"><Sparkles className="h-5 w-5 text-purple-400" />AI Risk Assessment Suggestions</h2>
              <button onClick={() => { setRiskSuggestionsId(null); setRiskSuggestions(null); }} className="text-slate-600 hover:text-slate-900"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5">
              {loadingRiskSuggestions ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-purple-400" /><span className="ml-3 text-slate-600">Analyzing findings and risk impacts...</span></div>
              ) : riskSuggestions ? (
                <div className="space-y-4">
                  {riskSuggestions.overall_assessment && <div className="bg-white/50 border border-purple-500/20 rounded-lg p-4"><p className="text-sm text-slate-700">{riskSuggestions.overall_assessment}</p></div>}
                  <p className="text-xs text-slate-500">{riskSuggestions.findings_analyzed} findings analyzed</p>
                  {(riskSuggestions.suggestions || []).map((s: any, idx: number) => (
                    <div key={idx} className="bg-white/50 rounded-lg p-4 border border-slate-200/30">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-semibold text-slate-900">{s.risk_title}</h4>
                        <span className={"px-2 py-0.5 rounded text-xs font-medium " + (s.adjustment_direction === 'increase' ? 'bg-red-500/20 text-red-400' : s.adjustment_direction === 'decrease' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-500/20 text-slate-600')}>{s.adjustment_direction === 'increase' ? 'Increase' : s.adjustment_direction === 'decrease' ? 'Decrease' : 'No Change'}</span>
                      </div>
                      <div className="flex items-center gap-4 mb-2">
                        <div className="text-center"><span className="text-xs text-slate-500">Current</span><p className="text-lg font-bold text-slate-900">{s.current_score}</p></div>
                        <ArrowRight className="w-4 h-4 text-slate-500" />
                        <div className="text-center"><span className="text-xs text-slate-500">Suggested</span><p className={"text-lg font-bold " + (s.suggested_score > s.current_score ? 'text-red-400' : s.suggested_score < s.current_score ? 'text-emerald-400' : 'text-slate-900')}>{s.suggested_score}</p></div>
                      </div>
                      <p className="text-xs text-slate-600">{s.rationale}</p>
                    </div>
                  ))}
                  {(!riskSuggestions.suggestions || riskSuggestions.suggestions.length === 0) && <p className="text-sm text-slate-600 text-center py-4">No risk adjustment suggestions generated.</p>}
                </div>
              ) : <p className="text-sm text-slate-600 text-center py-8">Click to analyze engagement findings</p>}
            </div>
          </div>
        </div>
      )}

      {fieldworkGuidanceId && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900 flex items-center gap-2"><Sparkles className="h-5 w-5 text-purple-400" />AI Fieldwork Guidance</h2>
              <button onClick={() => { setFieldworkGuidanceId(null); setFieldworkGuidance(null); }} className="text-slate-600 hover:text-slate-900"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5">
              {loadingFieldwork ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-purple-400" /><span className="ml-3 text-slate-600">Generating fieldwork guidance...</span></div>
              ) : fieldworkGuidance ? (
                <div className="space-y-5">
                  <div className="flex items-center gap-3 mb-4">
                    <span className="px-3 py-1 rounded-full text-sm bg-purple-500/20 text-purple-300 border border-purple-500/30">{fieldworkGuidance.audit_type_classification}</span>
                    <span className="text-sm text-slate-600">{fieldworkGuidance.entity_name}</span>
                    {fieldworkGuidance.prior_findings_count > 0 && <span className="text-xs text-amber-400">{fieldworkGuidance.prior_findings_count} prior findings</span>}
                  </div>
                  {(fieldworkGuidance.guidance_areas || []).map((area: any, idx: number) => (
                    <div key={idx} className="bg-white/50 rounded-lg p-4 border border-slate-200/30">
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-semibold text-slate-900">{area.area_name}</h4>
                        <span className={"px-2 py-0.5 rounded text-xs " + (area.risk_level === 'high' ? 'bg-red-500/20 text-red-400' : area.risk_level === 'medium' ? 'bg-amber-500/20 text-amber-400' : 'bg-emerald-500/20 text-emerald-400')}>{area.risk_level}</span>
                      </div>
                      <p className="text-xs text-slate-600 mb-3">{area.description}</p>
                      {area.sample_findings && area.sample_findings.length > 0 && (
                        <div className="mb-3">
                          <p className="text-xs font-semibold text-slate-700 mb-1">Sample Findings:</p>
                          {area.sample_findings.map((sf: any, si: number) => (
                            <div key={si} className="text-xs text-slate-600 ml-2 mb-1">- <span className="text-slate-700">{sf.title}</span> ({sf.severity})</div>
                          ))}
                        </div>
                      )}
                      {area.key_controls_to_test && area.key_controls_to_test.length > 0 && (
                        <div className="mb-3">
                          <p className="text-xs font-semibold text-slate-700 mb-1">Controls to Test:</p>
                          {area.key_controls_to_test.map((c: string, ci: number) => (
                            <div key={ci} className="text-xs text-slate-600 ml-2">- {c}</div>
                          ))}
                        </div>
                      )}
                      {area.evidence_to_collect && area.evidence_to_collect.length > 0 && (
                        <div>
                          <p className="text-xs font-semibold text-slate-700 mb-1">Evidence to Collect:</p>
                          {area.evidence_to_collect.map((e: string, ei: number) => (
                            <div key={ei} className="text-xs text-slate-600 ml-2">- {e}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                  {fieldworkGuidance.red_flags && fieldworkGuidance.red_flags.length > 0 && (
                    <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-red-300 mb-2">Red Flags to Watch</h4>
                      {fieldworkGuidance.red_flags.map((rf: string, ri: number) => (
                        <div key={ri} className="text-xs text-red-400/80 ml-2 mb-1">- {rf}</div>
                      ))}
                    </div>
                  )}
                  {fieldworkGuidance.general_tips && fieldworkGuidance.general_tips.length > 0 && (
                    <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-blue-300 mb-2">General Tips</h4>
                      {fieldworkGuidance.general_tips.map((tip: string, ti: number) => (
                        <div key={ti} className="text-xs text-blue-400/80 ml-2 mb-1">- {tip}</div>
                      ))}
                    </div>
                  )}
                </div>
              ) : <p className="text-sm text-slate-600 text-center py-8">Loading guidance...</p>}
            </div>
          </div>
        </div>
      )}

      {showEditModal && editingEngagement && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">Edit Engagement</h2>
              <button onClick={() => setShowEditModal(false)} className="text-slate-600 hover:text-slate-900">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
                <input
                  type="text"
                  value={editEngForm.title}
                  onChange={(e) => setEditEngForm({ ...editEngForm, title: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Engagement title"
                />
              </div>
              <button
                type="button"
                onClick={handleAiGenerate}
                disabled={aiGenerating || !editEngForm.title}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 disabled:from-purple-800 disabled:to-blue-800 disabled:opacity-50 text-slate-900 rounded-lg font-medium transition-all text-sm"
              >
                {aiGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Generating with AI...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Generate Description, Scope & Objectives with AI
                  </>
                )}
              </button>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  value={editEngForm.description}
                  onChange={(e) => setEditEngForm({ ...editEngForm, description: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Describe the engagement..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Engagement Type *</label>
                <select
                  value={editEngForm.engagement_type}
                  onChange={(e) => setEditEngForm({ ...editEngForm, engagement_type: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                >
                  <option value="assurance">Assurance</option>
                  <option value="advisory">Advisory</option>
                  <option value="follow_up">Follow-up</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Scope</label>
                <textarea
                  value={editEngForm.scope}
                  onChange={(e) => setEditEngForm({ ...editEngForm, scope: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Engagement scope..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Objectives</label>
                <textarea
                  value={editEngForm.objectives}
                  onChange={(e) => setEditEngForm({ ...editEngForm, objectives: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Engagement objectives..."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Planned Start</label>
                  <input
                    type="date"
                    value={editEngForm.planned_start}
                    onChange={(e) => setEditEngForm({ ...editEngForm, planned_start: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Planned End</label>
                  <input
                    type="date"
                    value={editEngForm.planned_end}
                    onChange={(e) => setEditEngForm({ ...editEngForm, planned_end: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Budget Hours</label>
                <input
                  type="number"
                  value={editEngForm.budget_hours}
                  onChange={(e) => setEditEngForm({ ...editEngForm, budget_hours: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="e.g. 200"
                  min="0"
                  step="0.5"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Lead Auditor</label>
                <select
                  value={editEngForm.lead_auditor_id}
                  onChange={(e) => setEditEngForm({ ...editEngForm, lead_auditor_id: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                >
                  <option value="">Select Lead Auditor</option>
                  {normalizedLeadAuditors.map((auditor) => (
                    <option key={auditor.id} value={auditor.id}>
                      {auditor.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-5 border-t border-slate-200">
              <button
                onClick={() => setShowEditModal(false)}
                className="px-4 py-2 text-slate-600 hover:text-slate-900 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleEditSave}
                disabled={!editEngForm.title || updateMutation.isPending}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <h2 className="text-lg font-semibold text-slate-900">New Engagement</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-600 hover:text-slate-900">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
                <input
                  type="text"
                  value={newEngagement.title}
                  onChange={(e) => setNewEngagement({ ...newEngagement, title: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Engagement title"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  value={newEngagement.description}
                  onChange={(e) => setNewEngagement({ ...newEngagement, description: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Describe the engagement..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Engagement Type *</label>
                <select
                  value={newEngagement.engagement_type}
                  onChange={(e) => setNewEngagement({ ...newEngagement, engagement_type: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                >
                  <option value="assurance">Assurance</option>
                  <option value="advisory">Advisory</option>
                  <option value="follow_up">Follow-up</option>
                </select>
              </div>
              <button
                type="button"
                onClick={handleCreateAiScope}
                disabled={createAiLoading || !newEngagement.title}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 rounded-lg text-sm transition-colors disabled:opacity-50"
              >
                {createAiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Generate Scope, Objectives & Methodology with AI
              </button>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Scope</label>
                <textarea
                  value={newEngagement.scope}
                  onChange={(e) => setNewEngagement({ ...newEngagement, scope: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Engagement scope..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Objectives</label>
                <textarea
                  value={newEngagement.objectives}
                  onChange={(e) => setNewEngagement({ ...newEngagement, objectives: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Engagement objectives..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Methodology</label>
                <textarea
                  value={newEngagement.methodology}
                  onChange={(e) => setNewEngagement({ ...newEngagement, methodology: e.target.value })}
                  rows={2}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Audit methodology..."
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Planned Start</label>
                  <input
                    type="date"
                    value={newEngagement.planned_start}
                    onChange={(e) => setNewEngagement({ ...newEngagement, planned_start: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Planned End</label>
                  <input
                    type="date"
                    value={newEngagement.planned_end}
                    onChange={(e) => setNewEngagement({ ...newEngagement, planned_end: e.target.value })}
                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Budget Hours</label>
                <input
                  type="number"
                  value={newEngagement.budget_hours}
                  onChange={(e) => setNewEngagement({ ...newEngagement, budget_hours: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="e.g. 200"
                  min="0"
                  step="0.5"
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 p-5 border-t border-slate-200">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-4 py-2 text-slate-600 hover:text-slate-900 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newEngagement.title || createMutation.isPending}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                {createMutation.isPending ? 'Creating...' : 'Create Engagement'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
