'use client';

import React, { useState } from 'react';
import { useParams } from 'wouter'
import { useRouter } from '@/lib/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { auditApi, apiClient } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  ArrowLeft,
  FileText,
  Users,
  Clock,
  AlertTriangle,
  ClipboardList,
  CheckCircle2,
  ArrowRight,
  Plus,
  X,
  Edit2,
  Trash2,
  User,
  Calendar,
  Target,
  Shield,
  Loader2,
  BookOpen,
  PenTool,
  Eye,
  Paperclip,
  Sparkles,
  RotateCcw,
} from 'lucide-react';

interface TeamMember {
  id: number;
  user_id: number;
  user_name: string | null;
  role: string;
  skills: string[];
  availability_percent: number;
  conflict_of_interest: boolean;
}

interface TimeEntry {
  id: number;
  user_id: number;
  date: string | null;
  hours: number;
  description: string | null;
  activity_type: string;
}

interface Procedure {
  id: number;
  procedure_number: string | null;
  title: string;
  description: string | null;
  test_type: string;
  sampling_methodology: string | null;
  sample_size: number | null;
  population_size: number | null;
  result: string | null;
  result_details: string | null;
  exceptions_noted: number;
  control_id: number | null;
  framework_control_id: number | null;
  evidence_ids: number[];
  ai_generated: boolean;
  performed_by_id: number | null;
  performed_at: string | null;
}

interface ProcedureWithContext extends Procedure {
  workpaper_id: number;
  workpaper_title: string;
  workpaper_ref: string;
}

interface Workpaper {
  id: number;
  engagement_id: number;
  reference_number: string;
  title: string;
  description: string | null;
  workpaper_type: string;
  status: string;
  preparer_id: number | null;
  preparer_name: string | null;
  reviewer_id: number | null;
  reviewer_name: string | null;
  lead_signoff_id: number | null;
  prepared_at: string | null;
  reviewed_at: string | null;
  lead_signoff_at: string | null;
  review_notes: string | null;
  conclusion: string | null;
  procedures: Procedure[];
  procedure_count: number;
  created_at: string | null;
}

interface Finding {
  id: number;
  finding_number: string | null;
  title: string;
  condition: string | null;
  criteria: string | null;
  cause: string | null;
  effect: string | null;
  root_cause_category: string | null;
  severity: string;
  status: string;
  theme: string | null;
  due_date: string | null;
}

interface Engagement {
  id: number;
  tenant_id: number;
  plan_item_id: number | null;
  auditable_entity_id: number | null;
  entity_name: string | null;
  engagement_number: string;
  title: string;
  description: string | null;
  engagement_type: string;
  status: string;
  scope: string | null;
  objectives: string | null;
  methodology: string | null;
  framework_id: number | null;
  framework_name: string | null;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  budget_hours: number;
  actual_hours: number;
  lead_auditor_id: number | null;
  lead_auditor_name: string | null;
  opinion: string | null;
  opinion_narrative: string | null;
  risk_rating: string | null;
  team_members: TeamMember[];
  workpaper_count: number;
  finding_count: number;
  time_entries: TimeEntry[];
  created_at: string | null;
  updated_at: string | null;
}

interface TenantUser {
  id?: number;
  user_id?: number;
  user?: {
    id: number;
    display_name?: string;
    username?: string;
    email?: string;
  };
  display_name?: string;
  username?: string;
  email?: string;
}

interface CurrentUserResponse {
  user?: { primary_tenant_id?: number };
  primary_tenant_id?: number;
}

const STATUS_COLORS: Record<string, string> = {
  planning: 'bg-blue-100 text-blue-700 border-blue-200',
  fieldwork: 'bg-amber-100 text-amber-700 border-amber-200',
  reporting: 'bg-purple-100 text-purple-700 border-purple-200',
  follow_up: 'bg-orange-100 text-orange-700 border-orange-200',
  closed: 'bg-emerald-100 text-emerald-700 border-emerald-200',
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

const LIFECYCLE_STAGES = ['planning', 'fieldwork', 'reporting', 'follow_up', 'closed'];

const TABS = [
  { key: 'overview', label: 'Overview', icon: Target },
  { key: 'workpapers', label: 'Workpapers', icon: FileText },
  { key: 'procedures', label: 'Procedures', icon: ClipboardList },
  { key: 'team', label: 'Team', icon: Users },
  { key: 'time', label: 'Time Entries', icon: Clock },
  { key: 'sampling', label: 'Sampling', icon: PenTool },
  { key: 'findings', label: 'Findings', icon: AlertTriangle },
];

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 border-red-200',
  high: 'bg-orange-100 text-orange-700 border-orange-200',
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  low: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

const WP_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600 border-slate-200',
  in_progress: 'bg-blue-100 text-blue-700 border-blue-200',
  prepared: 'bg-amber-100 text-amber-700 border-amber-200',
  reviewed: 'bg-purple-100 text-purple-700 border-purple-200',
  signed_off: 'bg-emerald-100 text-emerald-700 border-emerald-200',
};

const VALID_SIGNOFF_ACTIONS: Record<string, string> = {
  draft: 'prepare',
  in_progress: 'prepare',
  prepared: 'review',
  reviewed: 'lead_signoff',
};

function formatDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatStatus(s: string) {
  return s?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || '—';
}

export default function EngagementDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('audit:audit_management:create');
  const canEdit = hasPermission('audit:audit_management:edit');
  const canDelete = hasPermission('audit:audit_management:delete');
  const engagementId = Number(params.id);

  const [activeTab, setActiveTab] = useState('overview');
  const [showWpModal, setShowWpModal] = useState(false);
  const [editingWp, setEditingWp] = useState<Workpaper | null>(null);
  const [wpForm, setWpForm] = useState({ title: '', description: '', workpaper_type: 'test', reference_number: '' });
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [teamForm, setTeamForm] = useState({ user_id: '', role: 'auditor' });
  const [showTimeModal, setShowTimeModal] = useState(false);
  const [timeForm, setTimeForm] = useState({ date: '', hours: '', description: '', activity_type: 'fieldwork' });
  const [showSignoffModal, setShowSignoffModal] = useState(false);
  const [signoffWp, setSignoffWp] = useState<Workpaper | null>(null);
  const [signoffForm, setSignoffForm] = useState({ action: 'prepare', notes: '' });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [evidenceProcedure, setEvidenceProcedure] = useState<ProcedureWithContext | null>(null);
  const [evidenceInput, setEvidenceInput] = useState('');
  const [scopeLoading, setScopeLoading] = useState(false);
  const [scopeResult, setScopeResult] = useState<any>(null);
  const [showScopeModal, setShowScopeModal] = useState(false);
  const [letterLoading, setLetterLoading] = useState(false);
  const [letterResult, setLetterResult] = useState<any>(null);
  const [showLetterModal, setShowLetterModal] = useState(false);
  const [opinionLoading, setOpinionLoading] = useState(false);
  const [opinionResult, setOpinionResult] = useState<any>(null);
  const [showOpinionModal, setShowOpinionModal] = useState(false);
  const [samplingForm, setSamplingForm] = useState({ population_size: '', confidence_level: '95', expected_error_rate: '5', tolerable_error_rate: '10', sampling_type: 'attribute', workpaper_id: '' });
  const [samplingResult, setSamplingResult] = useState<any>(null);
  const [samplingLoading, setSamplingLoading] = useState(false);
  const [samplingHistory, setSamplingHistory] = useState<any[]>([]);

  const { data: engagement, isLoading, refetch } = useQuery<Engagement>({
    queryKey: ['engagement-detail', engagementId],
    queryFn: () => auditApi.engagements.getById(engagementId).then(r => r.data),
    enabled: !!engagementId,
  });

  const { data: workpapers, refetch: refetchWps } = useQuery<Workpaper[]>({
    queryKey: ['engagement-workpapers', engagementId],
    queryFn: () => auditApi.workpapers.getAll({ engagement_id: engagementId }).then(r => r.data?.workpapers || []),
    enabled: !!engagementId,
  });

  const { data: findings } = useQuery<Finding[]>({
    queryKey: ['engagement-findings', engagementId],
    queryFn: () => auditApi.findings.getAll({ engagement_id: engagementId }).then(r => r.data?.findings || r.data || []),
    enabled: !!engagementId,
  });

  const { data: priorAuditsData } = useQuery({
    queryKey: ['engagement-prior-audits', engagementId],
    queryFn: () => auditApi.engagements.getPriorAudits(engagementId).then(r => r.data),
    enabled: !!engagementId,
  });

  const { data: savedSamplingRecords, refetch: refetchSampling } = useQuery({
    queryKey: ['engagement-sampling-records', engagementId],
    queryFn: () => auditApi.engagements.getSamplingRecords(engagementId).then(r => r.data),
    enabled: !!engagementId,
  });

  const { data: currentUser } = useQuery<CurrentUserResponse>({
    queryKey: ['current-user'],
    queryFn: () => apiClient.get('/auth/me').then(r => r.data),
  });

  const tenantId = currentUser?.user?.primary_tenant_id || currentUser?.primary_tenant_id;

  const { data: tenantUsers } = useQuery<TenantUser[]>({
    queryKey: ['tenant-users', tenantId],
    queryFn: async () => {
      const response = await apiClient.get(`/tenants/${tenantId}/users`);
      const payload = response.data as unknown;
      if (Array.isArray(payload)) return payload as TenantUser[];
      const data = payload as { users?: TenantUser[]; items?: TenantUser[] };
      return data.users || data.items || [];
    },
    enabled: !!tenantId,
  });

  const handleError = (err: unknown) => {
    const error = err as { response?: { data?: { detail?: string } }; message?: string };
    const msg = error?.response?.data?.detail || error?.message || 'An error occurred';
    setErrorMessage(msg);
    setTimeout(() => setErrorMessage(null), 5000);
  };

  const transitionMutation = useMutation({
    mutationFn: (newStatus: string) => auditApi.engagements.transition(engagementId, { new_status: newStatus }),
    onSuccess: () => { refetch(); },
    onError: handleError,
  });

  const createWpMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => auditApi.workpapers.create(data),
    onSuccess: () => { refetchWps(); refetch(); setShowWpModal(false); setEditingWp(null); },
    onError: handleError,
  });

  const updateWpMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => auditApi.workpapers.update(id, data),
    onSuccess: () => { refetchWps(); setShowWpModal(false); setEditingWp(null); },
    onError: handleError,
  });

  const deleteWpMutation = useMutation({
    mutationFn: (id: number) => auditApi.workpapers.delete(id),
    onSuccess: () => { refetchWps(); refetch(); },
    onError: handleError,
  });

  const signoffMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => auditApi.workpapers.signoff(id, data),
    onSuccess: () => { refetchWps(); setShowSignoffModal(false); setSignoffWp(null); },
    onError: handleError,
  });

  const addTeamMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => auditApi.engagements.addTeamMember(engagementId, data),
    onSuccess: () => { refetch(); setShowTeamModal(false); setTeamForm({ user_id: '', role: 'auditor' }); },
    onError: handleError,
  });

  const removeTeamMutation = useMutation({
    mutationFn: (memberId: number) => auditApi.engagements.removeTeamMember(engagementId, memberId),
    onSuccess: () => { refetch(); },
    onError: handleError,
  });

  const addTimeMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => auditApi.engagements.addTimeEntry(engagementId, data),
    onSuccess: () => { refetch(); setShowTimeModal(false); setTimeForm({ date: '', hours: '', description: '', activity_type: 'fieldwork' }); },
    onError: handleError,
  });

  const deleteTimeMutation = useMutation({
    mutationFn: (entryId: number) => auditApi.engagements.deleteTimeEntry(engagementId, entryId),
    onSuccess: () => { refetch(); },
    onError: handleError,
  });

  const updateEvidenceMutation = useMutation({
    mutationFn: ({ workpaperId, procedureId, evidenceIds }: { workpaperId: number; procedureId: number; evidenceIds: number[] }) =>
      auditApi.workpapers.updateProcedure(workpaperId, procedureId, { evidence_ids: evidenceIds }),
    onSuccess: () => { refetchWps(); },
    onError: handleError,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!engagement) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <p className="text-slate-600">Engagement not found</p>
        <button onClick={() => router.push('/audit/engagements')} className="text-blue-600 hover:underline text-sm">
          Back to Engagements
        </button>
      </div>
    );
  }

  const nextStatus = NEXT_STATUS[engagement.status];
  const currentStageIdx = LIFECYCLE_STAGES.indexOf(engagement.status);
  const budgetUsed = engagement.budget_hours > 0 ? ((engagement.actual_hours || 0) / engagement.budget_hours) * 100 : 0;
  const allProcedures: ProcedureWithContext[] = (workpapers || []).flatMap((wp) =>
    (wp.procedures || []).map((p) => ({ ...p, workpaper_id: wp.id, workpaper_title: wp.title, workpaper_ref: wp.reference_number }))
  );

  const teamHoursMap: Record<number, number> = {};
  (engagement.time_entries || []).forEach((te) => {
    teamHoursMap[te.user_id] = (teamHoursMap[te.user_id] || 0) + te.hours;
  });

  const handleGenerateScope = async () => {
    setScopeLoading(true);
    setScopeResult(null);
    try {
      const res = await auditApi.ai.generateScope({ engagement_id: engagementId });
      setScopeResult(res.data?.scope_data || res.data);
      setShowScopeModal(true);
    } catch { handleError({ message: 'Failed to generate scope' }); }
    finally { setScopeLoading(false); }
  };

  const handleGenerateLetter = async () => {
    setLetterLoading(true);
    setLetterResult(null);
    try {
      const res = await auditApi.ai.generateEngagementLetter({ engagement_id: engagementId });
      setLetterResult(res.data?.letter || res.data);
      setShowLetterModal(true);
    } catch { handleError({ message: 'Failed to generate engagement letter' }); }
    finally { setLetterLoading(false); }
  };

  const handleSuggestOpinion = async () => {
    setOpinionLoading(true);
    setOpinionResult(null);
    try {
      const res = await auditApi.ai.suggestOpinion({ engagement_id: engagementId });
      setOpinionResult(res.data);
      setShowOpinionModal(true);
    } catch { handleError({ message: 'Failed to suggest opinion' }); }
    finally { setOpinionLoading(false); }
  };

  const handleSamplingCalculation = async () => {
    if (!samplingForm.population_size) return;
    setSamplingLoading(true);
    try {
      const res = await auditApi.tools.samplingCalculator({
        population_size: Number(samplingForm.population_size),
        confidence_level: Number(samplingForm.confidence_level),
        expected_error_rate: Number(samplingForm.expected_error_rate),
        tolerable_error_rate: Number(samplingForm.tolerable_error_rate),
        sampling_type: samplingForm.sampling_type,
      });
      const result = res.data;
      setSamplingResult(result);
      setSamplingHistory(prev => [{ ...result, timestamp: new Date().toISOString(), id: Date.now() }, ...prev].slice(0, 20));
      try {
        await auditApi.engagements.saveSamplingRecord(engagementId, {
          sampling_type: samplingForm.sampling_type,
          population_size: Number(samplingForm.population_size),
          sample_size: result.sample_size,
          confidence_level: Number(samplingForm.confidence_level),
          expected_error_rate: Number(samplingForm.expected_error_rate),
          tolerable_error_rate: Number(samplingForm.tolerable_error_rate),
          methodology: result.methodology,
          interpretation: result.interpretation,
          sampling_interval: result.sampling_interval,
          parameters: { ...samplingForm },
          workpaper_id: samplingForm.workpaper_id ? Number(samplingForm.workpaper_id) : null,
        });
        refetchSampling();
      } catch (e) { console.error('Failed to persist sampling record:', e); }
    } catch { handleError({ message: 'Sampling calculation failed' }); }
    finally { setSamplingLoading(false); }
  };

  const canSignoff = (wpStatus: string): boolean => {
    return wpStatus in VALID_SIGNOFF_ACTIONS;
  };

  const getSignoffAction = (wpStatus: string): string => {
    return VALID_SIGNOFF_ACTIONS[wpStatus] || 'prepare';
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/audit/engagements')} className="p-2 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">{engagement.title}</h1>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[engagement.status] || 'bg-slate-100 text-slate-600'}`}>
              {STATUS_LABELS[engagement.status] || engagement.status}
            </span>
            {engagement.engagement_number && (
              <span className="text-sm text-slate-500">{engagement.engagement_number}</span>
            )}
          </div>
          <div className="flex items-center gap-4 mt-1 text-sm text-slate-500">
            {engagement.entity_name && <span>Entity: {engagement.entity_name}</span>}
            {engagement.lead_auditor_name && <span>Lead: {engagement.lead_auditor_name}</span>}
            {engagement.framework_name && <span>Framework: {engagement.framework_name}</span>}
          </div>
        </div>
        {nextStatus && (
          <button
            onClick={() => transitionMutation.mutate(nextStatus)}
            disabled={transitionMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50"
          >
            {transitionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
            Move to {STATUS_LABELS[nextStatus]}
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center gap-1">
          {LIFECYCLE_STAGES.map((stage, idx) => (
            <React.Fragment key={stage}>
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium ${
                idx < currentStageIdx ? 'bg-emerald-100 text-emerald-700' :
                idx === currentStageIdx ? 'bg-blue-600 text-white' :
                'bg-slate-100 text-slate-400'
              }`}>
                {idx < currentStageIdx ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
                {STATUS_LABELS[stage]}
              </div>
              {idx < LIFECYCLE_STAGES.length - 1 && (
                <div className={`flex-1 h-0.5 ${idx < currentStageIdx ? 'bg-emerald-300' : 'bg-slate-200'}`} />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm flex items-center justify-between">
          <span>{errorMessage}</span>
          <button onClick={() => setErrorMessage(null)} className="text-red-500 hover:text-red-700"><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="border-b border-slate-200">
        <div className="flex gap-1">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const count = tab.key === 'workpapers' ? (workpapers || []).length :
                          tab.key === 'findings' ? (findings || []).length :
                          tab.key === 'team' ? (engagement.team_members || []).length :
                          tab.key === 'time' ? (engagement.time_entries || []).length :
                          tab.key === 'procedures' ? allProcedures.length : null;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
                {count !== null && count > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600">{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {engagement.description && (
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <h3 className="text-sm font-semibold text-slate-900 mb-2">Description</h3>
                <p className="text-sm text-slate-600 whitespace-pre-wrap">{engagement.description}</p>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {engagement.scope && (
                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2"><Target className="h-4 w-4 text-blue-500" /> Scope</h3>
                  <p className="text-sm text-slate-600 whitespace-pre-wrap">{engagement.scope}</p>
                </div>
              )}
              {engagement.objectives && (
                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2"><BookOpen className="h-4 w-4 text-purple-500" /> Objectives</h3>
                  <p className="text-sm text-slate-600 whitespace-pre-wrap">{engagement.objectives}</p>
                </div>
              )}
            </div>
            {engagement.methodology && (
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <h3 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2"><Shield className="h-4 w-4 text-emerald-500" /> Methodology</h3>
                <p className="text-sm text-slate-600 whitespace-pre-wrap">{engagement.methodology}</p>
              </div>
            )}
            {(engagement.opinion || engagement.opinion_narrative) && (
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <h3 className="text-sm font-semibold text-slate-900 mb-2">Audit Opinion</h3>
                {engagement.opinion && <p className="text-sm font-medium text-slate-700 mb-1 capitalize">{engagement.opinion}</p>}
                {engagement.opinion_narrative && <p className="text-sm text-slate-600">{engagement.opinion_narrative}</p>}
              </div>
            )}
          </div>
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
              <h3 className="text-sm font-semibold text-slate-900">Details</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Type</span><span className="text-slate-900 capitalize">{engagement.engagement_type}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Planned Start</span><span className="text-slate-900">{formatDate(engagement.planned_start)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Planned End</span><span className="text-slate-900">{formatDate(engagement.planned_end)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Actual Start</span><span className="text-slate-900">{formatDate(engagement.actual_start)}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Actual End</span><span className="text-slate-900">{formatDate(engagement.actual_end)}</span></div>
                {engagement.risk_rating && <div className="flex justify-between"><span className="text-slate-500">Risk Rating</span><span className="text-slate-900 capitalize">{engagement.risk_rating}</span></div>}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-3">Budget vs Actual</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Budget</span>
                  <span className="text-slate-900 font-medium">{engagement.budget_hours || 0}h</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">Actual</span>
                  <span className="text-slate-900 font-medium">{(engagement.actual_hours || 0).toFixed(1)}h</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${budgetUsed > 100 ? 'bg-red-500' : budgetUsed > 80 ? 'bg-amber-500' : 'bg-blue-500'}`}
                    style={{ width: `${Math.min(budgetUsed, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-slate-500 text-right">{budgetUsed.toFixed(0)}% used</p>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-3">Quick Stats</h3>
              <div className="grid grid-cols-2 gap-3">
                <div className="text-center p-2 bg-slate-50 rounded-lg">
                  <p className="text-lg font-bold text-slate-900">{engagement.workpaper_count || 0}</p>
                  <p className="text-xs text-slate-500">Workpapers</p>
                </div>
                <div className="text-center p-2 bg-slate-50 rounded-lg">
                  <p className="text-lg font-bold text-slate-900">{engagement.finding_count || 0}</p>
                  <p className="text-xs text-slate-500">Findings</p>
                </div>
                <div className="text-center p-2 bg-slate-50 rounded-lg">
                  <p className="text-lg font-bold text-slate-900">{(engagement.team_members || []).length}</p>
                  <p className="text-xs text-slate-500">Team</p>
                </div>
                <div className="text-center p-2 bg-slate-50 rounded-lg">
                  <p className="text-lg font-bold text-slate-900">{(engagement.time_entries || []).length}</p>
                  <p className="text-xs text-slate-500">Time Entries</p>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2"><Sparkles className="h-4 w-4 text-violet-500" /> AI Intelligence</h3>
              <div className="space-y-2">
                <button onClick={handleGenerateScope} disabled={scopeLoading} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-slate-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-lg transition-colors disabled:opacity-50">
                  {scopeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Target className="h-4 w-4 text-violet-500" />}
                  Generate Scope & Methodology
                </button>
                <button onClick={handleGenerateLetter} disabled={letterLoading} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-slate-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-lg transition-colors disabled:opacity-50">
                  {letterLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4 text-violet-500" />}
                  Generate Engagement Letter
                </button>
                <button onClick={handleSuggestOpinion} disabled={opinionLoading} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left text-slate-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 rounded-lg transition-colors disabled:opacity-50">
                  {opinionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4 text-violet-500" />}
                  Suggest Audit Opinion
                </button>
              </div>
            </div>
          </div>
          {priorAuditsData?.prior_engagements?.length > 0 && (
            <div className="lg:col-span-3">
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-500" />
                  Prior Audit History {priorAuditsData.entity_name && <span className="text-slate-400 font-normal">— {priorAuditsData.entity_name}</span>}
                </h3>
                <div className="space-y-3">
                  {priorAuditsData.prior_engagements.map((pe: any) => (
                    <div key={pe.id} className="border border-slate-100 rounded-lg p-4 hover:bg-slate-50 transition-colors">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <button
                            onClick={() => router.push(`/audit/engagements/${pe.id}`)}
                            className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            {pe.title}
                          </button>
                          {pe.engagement_number && (
                            <span className="ml-2 text-xs text-slate-400">{pe.engagement_number}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {pe.opinion && (
                            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${pe.opinion === 'satisfactory' ? 'bg-emerald-50 text-emerald-700' : pe.opinion === 'unsatisfactory' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                              {pe.opinion}
                            </span>
                          )}
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${pe.status === 'closed' ? 'bg-slate-100 text-slate-600' : 'bg-blue-50 text-blue-600'}`}>
                            {pe.status}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-slate-500">
                        {pe.planned_start && (
                          <span className="flex items-center gap-1">
                            <Calendar className="h-3 w-3" />
                            {new Date(pe.planned_start).toLocaleDateString()}
                          </span>
                        )}
                        <span>{pe.findings_count} finding{pe.findings_count !== 1 ? 's' : ''}</span>
                        {pe.open_findings > 0 && (
                          <span className="text-amber-600 font-medium">{pe.open_findings} still open</span>
                        )}
                      </div>
                      {pe.severity_distribution && Object.keys(pe.severity_distribution).length > 0 && (
                        <div className="flex items-center gap-1.5 mt-1.5">
                          {['critical', 'high', 'medium', 'low'].map(sev => {
                            const c = pe.severity_distribution[sev];
                            if (!c) return null;
                            const cls: Record<string, string> = { critical: 'bg-red-50 text-red-600', high: 'bg-orange-50 text-orange-600', medium: 'bg-amber-50 text-amber-600', low: 'bg-slate-50 text-slate-500' };
                            return <span key={sev} className={`px-1.5 py-0.5 rounded text-xs ${cls[sev]}`}>{sev[0].toUpperCase()}:{c}</span>;
                          })}
                        </div>
                      )}
                      {pe.findings?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {pe.findings.map((f: any) => (
                            <span
                              key={f.id}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${f.severity === 'critical' ? 'bg-red-50 text-red-700' : f.severity === 'high' ? 'bg-orange-50 text-orange-700' : f.severity === 'medium' ? 'bg-amber-50 text-amber-700' : 'bg-slate-50 text-slate-600'} ${f.is_recurring ? 'ring-1 ring-amber-400' : ''}`}
                              title={`${f.title} (${f.status})${f.is_recurring ? ' — Recurring' : ''}`}
                            >
                              {f.is_recurring && <RotateCcw className="h-2.5 w-2.5 text-amber-500" />}
                              {f.title.length > 30 ? f.title.substring(0, 30) + '...' : f.title}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'workpapers' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Workpapers</h2>
            {canCreate && (
            <button
              onClick={() => { setEditingWp(null); setWpForm({ title: '', description: '', workpaper_type: 'test', reference_number: '' }); setShowWpModal(true); }}
              className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Plus className="h-4 w-4" /> Add Workpaper
            </button>
            )}
          </div>
          {(workpapers || []).length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
              <FileText className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-600">No workpapers yet</p>
              <p className="text-xs text-slate-400 mt-1">Create a workpaper to start documenting audit work</p>
            </div>
          ) : (
            <div className="space-y-3">
              {(workpapers || []).map((wp) => (
                <div key={wp.id} className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs text-slate-500 font-mono">{wp.reference_number}</span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${WP_STATUS_COLORS[wp.status] || 'bg-slate-100 text-slate-600'}`}>
                          {formatStatus(wp.status)}
                        </span>
                        <span className="text-xs text-slate-400 capitalize">{wp.workpaper_type}</span>
                      </div>
                      <h4 className="text-sm font-medium text-slate-900">{wp.title}</h4>
                      {wp.description && <p className="text-xs text-slate-500 mt-1">{wp.description}</p>}
                      <div className="flex items-center gap-4 mt-2 text-xs text-slate-500">
                        {wp.preparer_name && <span className="flex items-center gap-1"><PenTool className="h-3 w-3" /> Prepared: {wp.preparer_name} {wp.prepared_at ? `(${formatDate(wp.prepared_at)})` : ''}</span>}
                        {wp.reviewer_name && <span className="flex items-center gap-1"><Eye className="h-3 w-3" /> Reviewed: {wp.reviewer_name} {wp.reviewed_at ? `(${formatDate(wp.reviewed_at)})` : ''}</span>}
                        {wp.lead_signoff_at && <span className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-500" /> Signed off: {formatDate(wp.lead_signoff_at)}</span>}
                        <span>{wp.procedure_count || 0} procedures</span>
                      </div>
                      {wp.conclusion && <p className="text-xs text-slate-600 mt-2 p-2 bg-slate-50 rounded"><strong>Conclusion:</strong> {wp.conclusion}</p>}
                      {wp.procedures && wp.procedures.length > 0 && (
                        <div className="mt-3 border-t border-slate-100 pt-2">
                          <p className="text-xs font-medium text-slate-600 mb-1.5 flex items-center gap-1"><Paperclip className="h-3 w-3" /> Evidence by Procedure</p>
                          <div className="space-y-1">
                            {wp.procedures.map((proc) => (
                              <div key={proc.id} className="flex items-center justify-between text-xs">
                                <span className="text-slate-600 truncate flex-1">{proc.procedure_number || '—'}: {proc.title}</span>
                                <button
                                  onClick={() => { setEvidenceProcedure({ ...proc, workpaper_id: wp.id, workpaper_title: wp.title, workpaper_ref: wp.reference_number }); setEvidenceInput(''); }}
                                  className="ml-2 flex items-center gap-1 text-blue-600 hover:text-blue-500 transition-colors whitespace-nowrap"
                                >
                                  <Paperclip className="h-3 w-3" />
                                  {proc.evidence_ids && proc.evidence_ids.length > 0 ? `${proc.evidence_ids.length} linked` : 'Add evidence'}
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 ml-3">
                      {canSignoff(wp.status) && (
                        <button
                          onClick={() => { setSignoffWp(wp); setSignoffForm({ action: getSignoffAction(wp.status), notes: '' }); setShowSignoffModal(true); }}
                          className="p-1.5 text-slate-500 hover:text-emerald-600 rounded-lg hover:bg-slate-100 transition-colors"
                          title={`Sign off — ${formatStatus(getSignoffAction(wp.status))}`}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </button>
                      )}
                      {canEdit && (
                      <button
                        onClick={() => { setEditingWp(wp); setWpForm({ title: wp.title, description: wp.description || '', workpaper_type: wp.workpaper_type || 'test', reference_number: wp.reference_number || '' }); setShowWpModal(true); }}
                        className="p-1.5 text-slate-500 hover:text-blue-600 rounded-lg hover:bg-slate-100 transition-colors"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                      )}
                      {canDelete && (
                      <button
                        onClick={() => { if (confirm('Delete this workpaper?')) deleteWpMutation.mutate(wp.id); }}
                        className="p-1.5 text-slate-500 hover:text-red-600 rounded-lg hover:bg-slate-100 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'procedures' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Audit Procedures</h2>
          {allProcedures.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
              <ClipboardList className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-600">No procedures yet</p>
              <p className="text-xs text-slate-400 mt-1">Add procedures through workpapers</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left px-4 py-3 text-slate-600 font-medium">#</th>
                    <th className="text-left px-4 py-3 text-slate-600 font-medium">Title</th>
                    <th className="text-left px-4 py-3 text-slate-600 font-medium">Workpaper</th>
                    <th className="text-left px-4 py-3 text-slate-600 font-medium">Type</th>
                    <th className="text-left px-4 py-3 text-slate-600 font-medium">Result</th>
                    <th className="text-left px-4 py-3 text-slate-600 font-medium">Exceptions</th>
                    <th className="text-left px-4 py-3 text-slate-600 font-medium">Sample</th>
                    <th className="text-left px-4 py-3 text-slate-600 font-medium">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {allProcedures.map((p) => (
                    <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-500 font-mono text-xs">{p.procedure_number || '—'}</td>
                      <td className="px-4 py-3 text-slate-900">{p.title}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{p.workpaper_ref} — {p.workpaper_title}</td>
                      <td className="px-4 py-3 text-slate-600 capitalize text-xs">{(p.test_type || '').replace(/_/g, ' ')}</td>
                      <td className="px-4 py-3">
                        {p.result ? (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            p.result === 'effective' ? 'bg-emerald-100 text-emerald-700' :
                            p.result === 'ineffective' ? 'bg-red-100 text-red-700' :
                            p.result === 'partially_effective' ? 'bg-amber-100 text-amber-700' :
                            'bg-slate-100 text-slate-600'
                          }`}>
                            {formatStatus(p.result)}
                          </span>
                        ) : <span className="text-slate-400 text-xs">Pending</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{p.exceptions_noted ?? 0}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{p.sample_size ? `${p.sample_size}/${p.population_size || '?'}` : '—'}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">
                        <button
                          onClick={() => { setEvidenceProcedure(p); setEvidenceInput(''); }}
                          className="flex items-center gap-1 text-blue-600 hover:text-blue-500 transition-colors"
                          title="Manage evidence"
                        >
                          <Paperclip className="h-3 w-3" />
                          {p.evidence_ids && p.evidence_ids.length > 0 ? p.evidence_ids.length : 'Add'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'team' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Team Members</h2>
            {canCreate && (
            <button
              onClick={() => { setTeamForm({ user_id: '', role: 'auditor' }); setShowTeamModal(true); }}
              className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Plus className="h-4 w-4" /> Add Member
            </button>
            )}
          </div>
          {(engagement.team_members || []).length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
              <Users className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-600">No team members assigned</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {(engagement.team_members || []).map((tm) => (
                <div key={tm.id} className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                        <User className="h-5 w-5 text-blue-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{tm.user_name || `User ${tm.user_id}`}</p>
                        <p className="text-xs text-slate-500 capitalize">{tm.role}</p>
                      </div>
                    </div>
                    {canDelete && (
                    <button
                      onClick={() => { if (confirm('Remove team member?')) removeTeamMutation.mutate(tm.id); }}
                      className="p-1 text-slate-400 hover:text-red-500 rounded transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                    )}
                  </div>
                  <div className="mt-3 flex items-center gap-3 text-xs text-slate-500">
                    <span>Availability: {tm.availability_percent}%</span>
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" /> {(teamHoursMap[tm.user_id] || 0).toFixed(1)}h logged</span>
                    {tm.conflict_of_interest && <span className="text-amber-600 font-medium">COI Declared</span>}
                  </div>
                  {tm.skills && tm.skills.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {tm.skills.map((s, i) => (
                        <span key={i} className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600">{s}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'time' && (() => {
        const budgetHours = engagement.budget_hours || 0;
        const actualHours = engagement.actual_hours || 0;
        const remaining = budgetHours - actualHours;
        const utilizationPct = budgetHours > 0 ? Math.min(100, (actualHours / budgetHours) * 100) : 0;
        const entries: TimeEntry[] = engagement.time_entries || [];
        const sortedEntries = [...entries].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        const activityBreakdown: Record<string, number> = {};
        entries.forEach((te) => { activityBreakdown[te.activity_type] = (activityBreakdown[te.activity_type] || 0) + te.hours; });
        return (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-900">Time Tracking</h2>
            {canCreate && (
            <button
              onClick={() => { setTimeForm({ date: new Date().toISOString().split('T')[0], hours: '', description: '', activity_type: 'fieldwork' }); setShowTimeModal(true); }}
              className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Plus className="h-4 w-4" /> Log Time
            </button>
            )}
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-5">
            <div className="grid grid-cols-3 gap-4 text-center mb-4">
              <div>
                <p className="text-2xl font-bold text-slate-900">{budgetHours}h</p>
                <p className="text-xs text-slate-500">Budget</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-slate-900">{actualHours.toFixed(1)}h</p>
                <p className="text-xs text-slate-500">Actual</p>
              </div>
              <div>
                <p className={`text-2xl font-bold ${remaining < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {remaining.toFixed(1)}h
                </p>
                <p className="text-xs text-slate-500">Remaining</p>
              </div>
            </div>
            {budgetHours > 0 && (
              <div>
                <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                  <span>Utilization</span>
                  <span className={utilizationPct > 100 ? 'text-red-600 font-medium' : ''}>{utilizationPct.toFixed(0)}%</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2.5">
                  <div
                    className={`h-2.5 rounded-full transition-all ${utilizationPct > 100 ? 'bg-red-500' : utilizationPct > 80 ? 'bg-amber-500' : 'bg-blue-500'}`}
                    style={{ width: `${Math.min(100, utilizationPct)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
          {Object.keys(activityBreakdown).length > 0 && (
            <div className="bg-white rounded-xl border border-slate-200 p-5">
              <h3 className="text-sm font-medium text-slate-700 mb-3">Hours by Activity</h3>
              <div className="space-y-2">
                {Object.entries(activityBreakdown).sort((a, b) => b[1] - a[1]).map(([activity, hours]) => (
                  <div key={activity} className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1">
                      <span className="text-sm text-slate-700 capitalize w-28">{activity}</span>
                      <div className="flex-1 bg-slate-100 rounded-full h-2">
                        <div
                          className="h-2 rounded-full bg-blue-400"
                          style={{ width: `${actualHours > 0 ? (hours / actualHours) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-sm font-medium text-slate-900 ml-3 w-12 text-right">{hours.toFixed(1)}h</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {sortedEntries.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
              <Clock className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-600">No time entries logged</p>
              <p className="text-xs text-slate-400 mt-1">Click &quot;Log Time&quot; to record your first entry</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left px-4 py-3 text-slate-600 font-medium">Date</th>
                    <th className="text-left px-4 py-3 text-slate-600 font-medium">Hours</th>
                    <th className="text-left px-4 py-3 text-slate-600 font-medium">Activity</th>
                    <th className="text-left px-4 py-3 text-slate-600 font-medium">Description</th>
                    <th className="text-right px-4 py-3 text-slate-600 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedEntries.map((te) => (
                    <tr key={te.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 text-slate-900">{formatDate(te.date)}</td>
                      <td className="px-4 py-3 text-slate-900 font-medium">{te.hours}h</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 capitalize">{te.activity_type}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 max-w-xs truncate">{te.description || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        {canDelete && (
                        <button
                          onClick={() => { if (confirm('Delete this time entry?')) deleteTimeMutation.mutate(te.id); }}
                          className="p-1.5 text-slate-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 border-t border-slate-200">
                    <td className="px-4 py-3 text-slate-700 font-medium">Total</td>
                    <td className="px-4 py-3 text-slate-900 font-bold">{actualHours.toFixed(1)}h</td>
                    <td colSpan={3}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
        );
      })()}

      {activeTab === 'sampling' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Sampling Calculator</h2>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
              <h3 className="text-sm font-medium text-slate-700">Parameters</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Sampling Methodology</label>
                  <select
                    value={samplingForm.sampling_type}
                    onChange={e => setSamplingForm({ ...samplingForm, sampling_type: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="attribute">Attribute Sampling</option>
                    <option value="mus">Monetary Unit Sampling (MUS)</option>
                    <option value="random">Simple Random Sampling</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Population Size</label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={samplingForm.population_size}
                    onChange={e => setSamplingForm({ ...samplingForm, population_size: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                    placeholder="e.g., 1000"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Confidence Level (%)</label>
                    <select
                      value={samplingForm.confidence_level}
                      onChange={e => setSamplingForm({ ...samplingForm, confidence_level: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                    >
                      <option value="90">90%</option>
                      <option value="95">95%</option>
                      <option value="99">99%</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Expected Error Rate (%)</label>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="0.5"
                      value={samplingForm.expected_error_rate}
                      onChange={e => setSamplingForm({ ...samplingForm, expected_error_rate: e.target.value })}
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tolerable Error Rate (%)</label>
                  <input
                    type="number"
                    min="0.1"
                    max="100"
                    step="0.5"
                    value={samplingForm.tolerable_error_rate}
                    onChange={e => setSamplingForm({ ...samplingForm, tolerable_error_rate: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Link to Workpaper (optional)</label>
                  <select
                    value={samplingForm.workpaper_id}
                    onChange={e => setSamplingForm({ ...samplingForm, workpaper_id: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="">— No workpaper —</option>
                    {(workpapers || []).map(wp => (
                      <option key={wp.id} value={wp.id}>{wp.reference_number ? `${wp.reference_number} — ` : ''}{wp.title}</option>
                    ))}
                  </select>
                </div>
              </div>
              <button
                onClick={handleSamplingCalculation}
                disabled={samplingLoading || !samplingForm.population_size}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                {samplingLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenTool className="h-4 w-4" />}
                Calculate Sample Size
              </button>
            </div>
            <div className="space-y-4">
              {samplingResult ? (
                <div className="bg-white rounded-xl border border-blue-200 p-5">
                  <div className="text-center mb-4">
                    <p className="text-4xl font-bold text-blue-600">{samplingResult.sample_size}</p>
                    <p className="text-sm text-slate-500 mt-1">Required Sample Size</p>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-3 mb-4">
                    <p className="text-sm text-blue-800">{samplingResult.interpretation}</p>
                  </div>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between text-slate-600">
                      <span>Methodology</span>
                      <span className="font-medium text-slate-900">{samplingResult.methodology}</span>
                    </div>
                    {samplingResult.sampling_interval && (
                      <div className="flex justify-between text-slate-600">
                        <span>Sampling Interval</span>
                        <span className="font-medium text-slate-900">{samplingResult.sampling_interval}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-slate-600">
                      <span>Formula</span>
                      <span className="font-medium text-slate-900 text-right max-w-[200px]">{samplingResult.formula}</span>
                    </div>
                  </div>
                  {samplingResult.benchmarks && samplingResult.benchmarks.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-slate-100">
                      <h4 className="text-xs font-medium text-slate-600 mb-2">Benchmarks at Other Confidence Levels</h4>
                      <div className="grid grid-cols-3 gap-2">
                        {samplingResult.benchmarks.map((b: any) => (
                          <div key={b.confidence_level} className="text-center bg-slate-50 rounded-lg p-2">
                            <p className="text-lg font-bold text-slate-900">{b.sample_size}</p>
                            <p className="text-xs text-slate-500">{b.confidence_level}%</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                  <PenTool className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-600">Configure parameters and calculate</p>
                  <p className="text-xs text-slate-400 mt-1">Results will appear here</p>
                </div>
              )}
              {savedSamplingRecords?.sampling_records?.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <h3 className="text-sm font-medium text-slate-700 mb-3">Saved Sampling Records</h3>
                  <div className="space-y-2">
                    {savedSamplingRecords.sampling_records.map((r: any) => (
                      <div key={r.id} className="flex items-center justify-between text-xs border border-slate-100 rounded-lg p-2.5">
                        <div>
                          <span className="font-medium text-slate-900">{r.methodology || r.sampling_type}</span>
                          <span className="text-slate-400 ml-2">Pop: {r.population_size}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="font-bold text-blue-600">{r.sample_size} samples</span>
                          <span className="text-slate-400">{r.created_at ? new Date(r.created_at).toLocaleDateString() : ''}</span>
                          <button
                            onClick={async () => {
                              try {
                                await auditApi.engagements.deleteSamplingRecord(engagementId, r.id);
                                refetchSampling();
                              } catch (e) { console.error('Failed to delete sampling record:', e); }
                            }}
                            className="text-red-400 hover:text-red-600"
                            title="Delete record"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {samplingHistory.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <h3 className="text-sm font-medium text-slate-700 mb-3">Session History</h3>
                  <div className="space-y-2">
                    {samplingHistory.map((h) => (
                      <div key={h.id} className="flex items-center justify-between text-xs border border-slate-100 rounded-lg p-2.5">
                        <div>
                          <span className="font-medium text-slate-900">{h.methodology}</span>
                          <span className="text-slate-400 ml-2">Pop: {h.parameters_used?.population_size}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-blue-600">{h.sample_size} samples</span>
                          <span className="text-slate-400">{new Date(h.timestamp).toLocaleTimeString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'findings' && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-slate-900">Findings</h2>
          {(findings || []).length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
              <AlertTriangle className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-600">No findings for this engagement</p>
            </div>
          ) : (
            <div className="space-y-3">
              {(findings || []).map((f) => (
                <div key={f.id} className="bg-white rounded-xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {f.finding_number && <span className="text-xs text-slate-500 font-mono">{f.finding_number}</span>}
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${SEVERITY_COLORS[f.severity] || 'bg-slate-100 text-slate-600'}`}>
                          {(f.severity || 'medium').charAt(0).toUpperCase() + (f.severity || 'medium').slice(1)}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          f.status === 'open' ? 'bg-amber-100 text-amber-700' :
                          f.status === 'closed' ? 'bg-emerald-100 text-emerald-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>
                          {formatStatus(f.status)}
                        </span>
                      </div>
                      <h4 className="text-sm font-medium text-slate-900">{f.title}</h4>
                      {f.condition && <p className="text-xs text-slate-500 mt-1 line-clamp-2">{f.condition}</p>}
                      <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                        {f.due_date && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> Due: {formatDate(f.due_date)}</span>}
                        {f.root_cause_category && <span>Root Cause: {f.root_cause_category}</span>}
                        {f.theme && <span>Theme: {f.theme}</span>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {showWpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">{editingWp ? 'Edit Workpaper' : 'Add Workpaper'}</h3>
              <button onClick={() => { setShowWpModal(false); setEditingWp(null); }} className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={e => { e.preventDefault(); if (editingWp) { updateWpMutation.mutate({ id: editingWp.id, data: { title: wpForm.title, description: wpForm.description || null, workpaper_type: wpForm.workpaper_type } }); } else { createWpMutation.mutate({ engagement_id: engagementId, ...wpForm, reference_number: wpForm.reference_number || undefined, description: wpForm.description || null }); } }} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Title *</label>
                <input type="text" required value={wpForm.title} onChange={e => setWpForm({ ...wpForm, title: e.target.value })} className="w-full px-3 py-2 bg-slate-50 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                  <select value={wpForm.workpaper_type} onChange={e => setWpForm({ ...wpForm, workpaper_type: e.target.value })} className="w-full px-3 py-2 bg-slate-50 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500">
                    <option value="test">Test</option>
                    <option value="analysis">Analysis</option>
                    <option value="walkthrough">Walkthrough</option>
                    <option value="memo">Memo</option>
                    <option value="planning">Planning</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                {!editingWp && (
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Ref Number</label>
                    <input type="text" value={wpForm.reference_number} onChange={e => setWpForm({ ...wpForm, reference_number: e.target.value })} placeholder="Auto-generated" className="w-full px-3 py-2 bg-slate-50 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
                  </div>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <textarea value={wpForm.description} onChange={e => setWpForm({ ...wpForm, description: e.target.value })} rows={3} className="w-full px-3 py-2 bg-slate-50 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500 resize-none" />
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button type="button" onClick={() => { setShowWpModal(false); setEditingWp(null); }} className="px-4 py-2 text-sm text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">Cancel</button>
                <button type="submit" disabled={createWpMutation.isPending || updateWpMutation.isPending} className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 rounded-lg font-medium disabled:opacity-50">
                  {createWpMutation.isPending || updateWpMutation.isPending ? 'Saving...' : editingWp ? 'Update' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showSignoffModal && signoffWp && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">Workpaper Sign-off</h3>
              <button onClick={() => { setShowSignoffModal(false); setSignoffWp(null); }} className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={e => { e.preventDefault(); signoffMutation.mutate({ id: signoffWp.id, data: signoffForm }); }} className="p-6 space-y-4">
              <p className="text-sm text-slate-600">Signing off: <strong>{signoffWp.title}</strong></p>
              <p className="text-xs text-slate-500">Current status: {formatStatus(signoffWp.status)}</p>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Action</label>
                <select value={signoffForm.action} onChange={e => setSignoffForm({ ...signoffForm, action: e.target.value })} className="w-full px-3 py-2 bg-slate-50 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500">
                  {(signoffWp.status === 'draft' || signoffWp.status === 'in_progress') && (
                    <option value="prepare">Mark as Prepared</option>
                  )}
                  {signoffWp.status === 'prepared' && (
                    <option value="review">Mark as Reviewed</option>
                  )}
                  {signoffWp.status === 'reviewed' && (
                    <option value="lead_signoff">Lead Sign-off</option>
                  )}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea value={signoffForm.notes} onChange={e => setSignoffForm({ ...signoffForm, notes: e.target.value })} rows={3} className="w-full px-3 py-2 bg-slate-50 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500 resize-none" placeholder="Optional review notes..." />
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button type="button" onClick={() => { setShowSignoffModal(false); setSignoffWp(null); }} className="px-4 py-2 text-sm text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">Cancel</button>
                <button type="submit" disabled={signoffMutation.isPending} className="px-4 py-2 text-sm text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg font-medium disabled:opacity-50">
                  {signoffMutation.isPending ? 'Processing...' : 'Sign Off'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showTeamModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">Add Team Member</h3>
              <button onClick={() => setShowTeamModal(false)} className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={e => { e.preventDefault(); addTeamMutation.mutate({ user_id: Number(teamForm.user_id), role: teamForm.role }); }} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">User *</label>
                <select required value={teamForm.user_id} onChange={e => setTeamForm({ ...teamForm, user_id: e.target.value })} className="w-full px-3 py-2 bg-slate-50 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500">
                  <option value="">Select user...</option>
                  {(Array.isArray(tenantUsers) ? tenantUsers : []).map((tu) => {
                    const userId = tu.user?.id || tu.id || tu.user_id;
                    const userName = tu.user?.display_name || tu.user?.username || tu.display_name || tu.username || tu.user?.email || tu.email || `User ${userId}`;
                    if (!userId) return null;
                    return (
                      <option key={userId} value={userId}>{userName}</option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Role</label>
                <select value={teamForm.role} onChange={e => setTeamForm({ ...teamForm, role: e.target.value })} className="w-full px-3 py-2 bg-slate-50 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500">
                  <option value="lead">Lead Auditor</option>
                  <option value="auditor">Auditor</option>
                  <option value="reviewer">Reviewer</option>
                  <option value="observer">Observer</option>
                </select>
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button type="button" onClick={() => setShowTeamModal(false)} className="px-4 py-2 text-sm text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">Cancel</button>
                <button type="submit" disabled={addTeamMutation.isPending} className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 rounded-lg font-medium disabled:opacity-50">
                  {addTeamMutation.isPending ? 'Adding...' : 'Add Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {evidenceProcedure && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">Manage Evidence</h3>
              <button onClick={() => setEvidenceProcedure(null)} className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-600">Procedure: <strong>{evidenceProcedure.title}</strong></p>
              <p className="text-xs text-slate-500">Workpaper: {evidenceProcedure.workpaper_ref} — {evidenceProcedure.workpaper_title}</p>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Current Evidence IDs</label>
                {evidenceProcedure.evidence_ids && evidenceProcedure.evidence_ids.length > 0 ? (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {evidenceProcedure.evidence_ids.map((eid) => (
                      <span key={eid} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs border border-blue-200">
                        #{eid}
                        <button
                          onClick={() => {
                            const newIds = evidenceProcedure.evidence_ids.filter(id => id !== eid);
                            updateEvidenceMutation.mutate(
                              { workpaperId: evidenceProcedure.workpaper_id, procedureId: evidenceProcedure.id, evidenceIds: newIds },
                              { onSuccess: () => setEvidenceProcedure({ ...evidenceProcedure, evidence_ids: newIds }) }
                            );
                          }}
                          className="text-blue-400 hover:text-red-500 transition-colors"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 mb-2">No evidence linked yet</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Add Evidence ID</label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="1"
                    value={evidenceInput}
                    onChange={e => setEvidenceInput(e.target.value)}
                    placeholder="Enter evidence ID"
                    className="flex-1 px-3 py-2 bg-slate-50 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={() => {
                      const newId = Number(evidenceInput);
                      if (!newId || newId < 1) return;
                      const currentIds = evidenceProcedure.evidence_ids || [];
                      if (currentIds.includes(newId)) return;
                      const newIds = [...currentIds, newId];
                      updateEvidenceMutation.mutate(
                        { workpaperId: evidenceProcedure.workpaper_id, procedureId: evidenceProcedure.id, evidenceIds: newIds },
                        { onSuccess: () => { setEvidenceProcedure({ ...evidenceProcedure, evidence_ids: newIds }); setEvidenceInput(''); } }
                      );
                    }}
                    disabled={updateEvidenceMutation.isPending || !evidenceInput}
                    className="px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
                  >
                    {updateEvidenceMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="flex justify-end pt-4 border-t border-slate-200">
                <button onClick={() => setEvidenceProcedure(null)} className="px-4 py-2 text-sm text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">Done</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showTimeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">Log Time</h3>
              <button onClick={() => setShowTimeModal(false)} className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={e => { e.preventDefault(); addTimeMutation.mutate({ date: new Date(timeForm.date).toISOString(), hours: Number(timeForm.hours), description: timeForm.description || null, activity_type: timeForm.activity_type }); }} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Date *</label>
                  <input type="date" required value={timeForm.date} onChange={e => setTimeForm({ ...timeForm, date: e.target.value })} className="w-full px-3 py-2 bg-slate-50 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Hours *</label>
                  <input type="number" required min="0.25" step="0.25" value={timeForm.hours} onChange={e => setTimeForm({ ...timeForm, hours: e.target.value })} className="w-full px-3 py-2 bg-slate-50 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Activity Type</label>
                <select value={timeForm.activity_type} onChange={e => setTimeForm({ ...timeForm, activity_type: e.target.value })} className="w-full px-3 py-2 bg-slate-50 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500">
                  <option value="planning">Planning</option>
                  <option value="fieldwork">Fieldwork</option>
                  <option value="reporting">Reporting</option>
                  <option value="review">Review</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <textarea value={timeForm.description} onChange={e => setTimeForm({ ...timeForm, description: e.target.value })} rows={2} className="w-full px-3 py-2 bg-slate-50 border border-slate-300 text-slate-900 rounded-lg text-sm focus:outline-none focus:border-blue-500 resize-none" placeholder="What did you work on?" />
              </div>
              <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                <button type="button" onClick={() => setShowTimeModal(false)} className="px-4 py-2 text-sm text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">Cancel</button>
                <button type="submit" disabled={addTimeMutation.isPending} className="px-4 py-2 text-sm text-white bg-blue-600 hover:bg-blue-500 rounded-lg font-medium disabled:opacity-50">
                  {addTimeMutation.isPending ? 'Saving...' : 'Log Time'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showScopeModal && scopeResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2"><Sparkles className="h-5 w-5 text-violet-500" /> AI-Generated Scope & Methodology</h3>
              <button onClick={() => setShowScopeModal(false)} className="text-slate-500 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              {scopeResult.scope && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-blue-700 mb-2">Scope</h4>
                  <p className="text-sm text-blue-800 whitespace-pre-wrap">{scopeResult.scope}</p>
                </div>
              )}
              {scopeResult.objectives && (
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-purple-700 mb-2">Objectives</h4>
                  <p className="text-sm text-purple-800 whitespace-pre-wrap">{scopeResult.objectives}</p>
                </div>
              )}
              {scopeResult.methodology && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-emerald-700 mb-2">Methodology</h4>
                  <p className="text-sm text-emerald-800 whitespace-pre-wrap">{scopeResult.methodology}</p>
                </div>
              )}
              {scopeResult.key_risks && scopeResult.key_risks.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-amber-700 mb-2">Key Risks</h4>
                  <ul className="text-sm text-amber-800 list-disc pl-5 space-y-1">
                    {scopeResult.key_risks.map((r: string, i: number) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
              <div className="flex gap-4 text-sm text-slate-600">
                {scopeResult.estimated_duration_days && <span>Est. Duration: {scopeResult.estimated_duration_days} days</span>}
                {scopeResult.suggested_team_size && <span>Team Size: {scopeResult.suggested_team_size}</span>}
              </div>
            </div>
            <div className="flex justify-end mt-4 pt-4 border-t border-slate-200">
              <button onClick={() => setShowScopeModal(false)} className="px-4 py-2 text-sm text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">Close</button>
            </div>
          </div>
        </div>
      )}

      {showLetterModal && letterResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2"><Sparkles className="h-5 w-5 text-violet-500" /> Engagement Letter</h3>
              <button onClick={() => setShowLetterModal(false)} className="text-slate-500 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            {letterResult.subject_line && (
              <p className="text-sm font-medium text-slate-700 mb-3 bg-slate-50 px-3 py-2 rounded-lg">Subject: {letterResult.subject_line}</p>
            )}
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 mb-4">
              <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{letterResult.letter_content}</p>
            </div>
            {letterResult.key_dates && Object.keys(letterResult.key_dates).length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
                <h4 className="text-sm font-semibold text-blue-700 mb-2">Key Dates</h4>
                <div className="grid grid-cols-2 gap-2 text-sm text-blue-800">
                  {Object.entries(letterResult.key_dates).map(([k, v]) => (
                    <div key={k} className="flex justify-between">
                      <span className="capitalize">{k.replace(/_/g, ' ')}</span>
                      <span className="font-medium">{v as string}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
              <button onClick={() => setShowLetterModal(false)} className="px-4 py-2 text-sm text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">Close</button>
              <button
                onClick={() => {
                  const content = [
                    letterResult.subject_line ? `Subject: ${letterResult.subject_line}\n` : '',
                    letterResult.letter_content || '',
                    letterResult.key_dates && Object.keys(letterResult.key_dates).length > 0
                      ? `\n\nKey Dates:\n${Object.entries(letterResult.key_dates).map(([k, v]) => `  ${k.replace(/_/g, ' ')}: ${v}`).join('\n')}`
                      : '',
                  ].join('');
                  const blob = new Blob([content], { type: 'text/plain' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `engagement-letter-${engagement?.title?.replace(/\s+/g, '-').toLowerCase() || 'draft'}.txt`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-2"
              >
                <FileText className="h-4 w-4" />
                Export as TXT
              </button>
            </div>
          </div>
        </div>
      )}

      {showOpinionModal && opinionResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2"><Sparkles className="h-5 w-5 text-violet-500" /> AI Opinion Recommendation</h3>
              <button onClick={() => setShowOpinionModal(false)} className="text-slate-500 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              {opinionResult.opinion && (
                <>
                  <div className="flex items-center gap-3">
                    <span className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${
                      opinionResult.opinion.recommended_opinion === 'satisfactory' ? 'bg-emerald-100 text-emerald-700' :
                      opinionResult.opinion.recommended_opinion === 'unsatisfactory' ? 'bg-red-100 text-red-700' :
                      'bg-amber-100 text-amber-700'
                    }`}>
                      {(opinionResult.opinion.recommended_opinion || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                    </span>
                    {opinionResult.opinion.confidence && (
                      <span className="text-xs text-slate-500">Confidence: {opinionResult.opinion.confidence}</span>
                    )}
                  </div>
                  {opinionResult.opinion.opinion_narrative && (
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                      <p className="text-sm text-slate-700 whitespace-pre-wrap">{opinionResult.opinion.opinion_narrative}</p>
                    </div>
                  )}
                  {opinionResult.opinion.key_factors && opinionResult.opinion.key_factors.length > 0 && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-blue-700 mb-2">Key Factors</h4>
                      <ul className="text-sm text-blue-800 list-disc pl-5 space-y-1">
                        {opinionResult.opinion.key_factors.map((f: string, i: number) => <li key={i}>{f}</li>)}
                      </ul>
                    </div>
                  )}
                  {opinionResult.opinion.caveats && opinionResult.opinion.caveats.length > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                      <h4 className="text-sm font-semibold text-amber-700 mb-2">Caveats</h4>
                      <ul className="text-sm text-amber-800 list-disc pl-5 space-y-1">
                        {opinionResult.opinion.caveats.map((c: string, i: number) => <li key={i}>{c}</li>)}
                      </ul>
                    </div>
                  )}
                </>
              )}
              {opinionResult.finding_summary && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-slate-700 mb-2">Finding Summary</h4>
                  <div className="flex gap-4 text-sm text-slate-600">
                    <span>Total: {opinionResult.finding_summary.total}</span>
                    {Object.entries(opinionResult.finding_summary.severity_distribution || {}).map(([k, v]) => (
                      v ? <span key={k} className="capitalize">{k}: {v as number}</span> : null
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end mt-4 pt-4 border-t border-slate-200">
              <button onClick={() => setShowOpinionModal(false)} className="px-4 py-2 text-sm text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
