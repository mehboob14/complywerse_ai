'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { auditApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import {
  ArrowLeft,
  AlertTriangle,
  Calendar,
  User,
  Tag,
  FileText,
  Shield,
  CheckCircle2,
  Clock,
  Plus,
  X,
  Loader2,
  Sparkles,
  MessageSquare,
  ClipboardList,
  RotateCcw,
  ChevronRight,
  Target,
  Lightbulb,
} from 'lucide-react';

interface ManagementResponse {
  id: number;
  response_type: string;
  response_text: string | null;
  action_plan: string | null;
  target_date: string | null;
  respondent_id: number | null;
  responded_at: string | null;
}

interface ActionPlan {
  id: number;
  milestone: string;
  description: string | null;
  owner_id: number | null;
  due_date: string | null;
  completed_date: string | null;
  status: string;
  evidence_of_completion: string | null;
}

interface Recommendation {
  id: number;
  title: string;
  description: string | null;
  priority: string;
  status: string;
  owner_id: number | null;
  due_date: string | null;
  action_plans: ActionPlan[];
}

interface FollowUp {
  id: number;
  follow_up_type: string;
  retest_result: string | null;
  retest_details: string | null;
  evidence_id: number | null;
  performed_by_id: number | null;
  performed_at: string | null;
  closure_approved: boolean;
  notes: string | null;
}

interface Finding {
  id: number;
  tenant_id: number;
  engagement_id: number;
  engagement_title: string | null;
  finding_number: string;
  title: string;
  condition: string | null;
  criteria: string | null;
  cause: string | null;
  effect: string | null;
  root_cause_category: string | null;
  severity: string;
  status: string;
  framework_mappings: string[];
  risk_id: number | null;
  control_id: number | null;
  owner_id: number | null;
  owner_name: string | null;
  due_date: string | null;
  ai_generated: boolean;
  theme: string | null;
  attachment_file_name: string | null;
  management_responses: ManagementResponse[];
  recommendations: Recommendation[];
  follow_ups: FollowUp[];
  created_at: string | null;
  updated_at: string | null;
}

interface RootCause {
  category: string;
  description: string;
  likelihood: string;
}

interface RootCauseResult {
  root_causes: RootCause[];
  summary: string;
  source: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-700 border-red-200',
  high: 'bg-orange-100 text-orange-700 border-orange-200',
  medium: 'bg-amber-100 text-amber-700 border-amber-200',
  low: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  observation: 'bg-blue-100 text-blue-700 border-blue-200',
};

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-red-100 text-red-700 border-red-200',
  in_progress: 'bg-amber-100 text-amber-700 border-amber-200',
  management_agreed: 'bg-blue-100 text-blue-700 border-blue-200',
  management_disagreed: 'bg-orange-100 text-orange-700 border-orange-200',
  partially_agreed: 'bg-violet-100 text-violet-700 border-violet-200',
  remediated: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  retest_failed: 'bg-red-100 text-red-700 border-red-200',
  closed: 'bg-slate-100 text-slate-600 border-slate-200',
};

const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  management_agreed: 'Management Agreed',
  management_disagreed: 'Management Disagreed',
  partially_agreed: 'Partially Agreed',
  remediated: 'Remediated',
  retest_failed: 'Retest Failed',
  closed: 'Closed',
};

const CCCE_CONFIG: { key: keyof Pick<Finding, 'condition' | 'criteria' | 'cause' | 'effect'>; label: string; color: string; icon: string }[] = [
  { key: 'condition', label: 'Condition', color: 'border-red-500 bg-red-50', icon: '🔍' },
  { key: 'criteria', label: 'Criteria', color: 'border-blue-500 bg-blue-50', icon: '📏' },
  { key: 'cause', label: 'Cause', color: 'border-amber-500 bg-amber-50', icon: '⚡' },
  { key: 'effect', label: 'Effect', color: 'border-purple-500 bg-purple-50', icon: '📊' },
];

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'bg-red-100 text-red-700',
  high: 'bg-orange-100 text-orange-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-emerald-100 text-emerald-700',
};

const LIFECYCLE_STAGES = ['open', 'in_progress', 'management_agreed', 'remediated', 'closed'];

function getLifecycleProgress(status: string): number {
  const stageMap: Record<string, number> = {
    open: 20,
    in_progress: 40,
    management_agreed: 60,
    management_disagreed: 50,
    partially_agreed: 55,
    remediated: 80,
    retest_failed: 70,
    closed: 100,
  };
  return stageMap[status] ?? 10;
}

type TabKey = 'details' | 'responses' | 'recommendations' | 'followups' | 'rootcause' | 'prioraudits';

function formatDate(d: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatStatus(s: string) {
  return STATUS_LABELS[s] || s.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function daysSince(date: string) {
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

export default function FindingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const findingId = Number(params.id);
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('audit:audit_management:create');
  const canEdit = hasPermission('audit:audit_management:edit');

  const [activeTab, setActiveTab] = useState<TabKey>('details');
  const [error, setError] = useState<string | null>(null);

  const [showResponseModal, setShowResponseModal] = useState(false);
  const [responseForm, setResponseForm] = useState({ response_type: 'agree', response_text: '', action_plan: '', target_date: '' });

  const [showRecModal, setShowRecModal] = useState(false);
  const [recForm, setRecForm] = useState({ title: '', description: '', priority: 'medium', due_date: '' });

  const [showApModal, setShowApModal] = useState(false);
  const [apRecId, setApRecId] = useState<number | null>(null);
  const [apForm, setApForm] = useState({ milestone: '', description: '', due_date: '' });

  const [showCompleteApModal, setShowCompleteApModal] = useState(false);
  const [completeApTarget, setCompleteApTarget] = useState<{ recId: number; apId: number } | null>(null);
  const [completeApForm, setCompleteApForm] = useState({ evidence_of_completion: '' });

  const [showFollowUpModal, setShowFollowUpModal] = useState(false);
  const [followUpForm, setFollowUpForm] = useState({ follow_up_type: 'retest', retest_result: '', retest_details: '', notes: '' });

  const [rootCauseResult, setRootCauseResult] = useState<RootCauseResult | null>(null);
  const [rootCauseLoading, setRootCauseLoading] = useState(false);
  const [severityLoading, setSeverityLoading] = useState(false);
  const [severityResult, setSeverityResult] = useState<any>(null);
  const [showSeverityModal, setShowSeverityModal] = useState(false);
  const [responseEvalLoading, setResponseEvalLoading] = useState(false);
  const [responseEvalResult, setResponseEvalResult] = useState<any>(null);
  const [showResponseEvalModal, setShowResponseEvalModal] = useState(false);

  const { data: finding, isLoading } = useQuery<Finding>({
    queryKey: ['audit-finding', findingId],
    queryFn: () => auditApi.findings.getById(findingId).then(r => r.data),
    enabled: !!findingId,
  });

  const refetchFinding = () => queryClient.invalidateQueries({ queryKey: ['audit-finding', findingId] });

  const { data: priorAuditsData } = useQuery({
    queryKey: ['finding-prior-audits', finding?.engagement_id],
    queryFn: () => auditApi.engagements.getPriorAudits(finding!.engagement_id).then(r => r.data),
    enabled: !!finding?.engagement_id,
  });

  const addResponseMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => auditApi.findings.addManagementResponse(findingId, data),
    onSuccess: () => { refetchFinding(); setShowResponseModal(false); setResponseForm({ response_type: 'agree', response_text: '', action_plan: '', target_date: '' }); },
    onError: (err: unknown) => { const e = err as { response?: { data?: { detail?: string } } }; setError(e.response?.data?.detail || 'Failed to add response'); },
  });

  const addRecMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => auditApi.findings.addRecommendation(findingId, data),
    onSuccess: () => { refetchFinding(); setShowRecModal(false); setRecForm({ title: '', description: '', priority: 'medium', due_date: '' }); },
    onError: (err: unknown) => { const e = err as { response?: { data?: { detail?: string } } }; setError(e.response?.data?.detail || 'Failed to add recommendation'); },
  });

  const addApMutation = useMutation({
    mutationFn: ({ recId, data }: { recId: number; data: Record<string, unknown> }) => auditApi.findings.addActionPlan(findingId, recId, data),
    onSuccess: () => { refetchFinding(); setShowApModal(false); setApForm({ milestone: '', description: '', due_date: '' }); setApRecId(null); },
    onError: (err: unknown) => { const e = err as { response?: { data?: { detail?: string } } }; setError(e.response?.data?.detail || 'Failed to add action plan'); },
  });

  const updateApMutation = useMutation({
    mutationFn: ({ recId, apId, data }: { recId: number; apId: number; data: Record<string, unknown> }) => auditApi.findings.updateActionPlan(findingId, recId, apId, data),
    onSuccess: () => { refetchFinding(); setShowCompleteApModal(false); setCompleteApTarget(null); setCompleteApForm({ evidence_of_completion: '' }); },
    onError: (err: unknown) => { const e = err as { response?: { data?: { detail?: string } } }; setError(e.response?.data?.detail || 'Failed to update action plan'); },
  });

  const addFollowUpMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => auditApi.findings.addFollowUp(findingId, data),
    onSuccess: () => { refetchFinding(); setShowFollowUpModal(false); setFollowUpForm({ follow_up_type: 'retest', retest_result: '', retest_details: '', notes: '' }); },
    onError: (err: unknown) => { const e = err as { response?: { data?: { detail?: string } } }; setError(e.response?.data?.detail || 'Failed to add follow-up'); },
  });

  const closeFollowUpMutation = useMutation({
    mutationFn: ({ fuId }: { fuId: number }) => auditApi.findings.closeFollowUp(findingId, fuId, {}),
    onSuccess: () => refetchFinding(),
    onError: (err: unknown) => { const e = err as { response?: { data?: { detail?: string } } }; setError(e.response?.data?.detail || 'Failed to close finding'); },
  });

  const handleRootCause = async () => {
    setRootCauseLoading(true);
    setRootCauseResult(null);
    try {
      const res = await auditApi.findings.suggestRootCause(findingId);
      setRootCauseResult(res.data);
    } catch { setError('Failed to analyze root causes'); }
    finally { setRootCauseLoading(false); }
  };

  const handleCalibrateSeverity = async () => {
    if (!finding) return;
    setSeverityLoading(true);
    setSeverityResult(null);
    try {
      const res = await auditApi.ai.calibrateSeverity({
        title: finding.title,
        condition: finding.condition || '',
        criteria: finding.criteria || '',
        cause: finding.cause || '',
        effect: finding.effect || '',
        control_area: finding.theme || '',
      });
      setSeverityResult(res.data?.calibration || res.data);
      setShowSeverityModal(true);
    } catch { setError('Failed to calibrate severity'); }
    finally { setSeverityLoading(false); }
  };

  const handleEvaluateResponse = async (resp: ManagementResponse) => {
    setResponseEvalLoading(true);
    setResponseEvalResult(null);
    try {
      const res = await auditApi.ai.evaluateResponse({
        finding_id: findingId,
        response_text: resp.response_text || '',
        response_type: resp.response_type || 'agree',
        action_plan: resp.action_plan || '',
        target_date: resp.target_date || '',
      });
      setResponseEvalResult(res.data?.evaluation || res.data);
      setShowResponseEvalModal(true);
    } catch { setError('Failed to evaluate response'); }
    finally { setResponseEvalLoading(false); }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!finding) {
    return (
      <div className="text-center py-20">
        <AlertTriangle className="h-12 w-12 text-slate-400 mx-auto mb-4" />
        <p className="text-slate-600 text-lg">Finding not found</p>
        <button onClick={() => router.push('/audit/findings')} className="mt-4 text-blue-600 hover:text-blue-500 text-sm">Back to Findings</button>
      </div>
    );
  }

  const isOverdue = finding.due_date && new Date(finding.due_date) < new Date() && !['closed', 'remediated'].includes(finding.status);
  const ageDays = finding.created_at ? daysSince(finding.created_at) : 0;
  const progressPct = getLifecycleProgress(finding.status);

  const tabs: { key: TabKey; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: 'details', label: 'Finding Details', icon: <FileText className="h-4 w-4" /> },
    { key: 'responses', label: 'Management Response', icon: <MessageSquare className="h-4 w-4" />, count: finding.management_responses?.length },
    { key: 'recommendations', label: 'Recommendations', icon: <ClipboardList className="h-4 w-4" />, count: finding.recommendations?.length },
    { key: 'followups', label: 'Follow-Up / Retest', icon: <RotateCcw className="h-4 w-4" />, count: finding.follow_ups?.length },
    { key: 'rootcause', label: 'Root Cause Analysis', icon: <Lightbulb className="h-4 w-4" /> },
    { key: 'prioraudits', label: 'Prior Audits', icon: <Clock className="h-4 w-4" />, count: priorAuditsData?.prior_engagements?.length },
  ];

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-center justify-between">
          <p className="text-sm text-red-700">{error}</p>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600"><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button onClick={() => router.push('/audit/findings')} className="p-2 text-slate-500 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 flex-wrap mb-1">
            {finding.finding_number && <span className="text-sm font-mono text-slate-500">{finding.finding_number}</span>}
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${SEVERITY_COLORS[finding.severity] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
              {finding.severity?.charAt(0).toUpperCase()}{finding.severity?.slice(1)}
            </span>
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[finding.status] || 'bg-slate-100 text-slate-600 border-slate-200'}`}>
              {formatStatus(finding.status)}
            </span>
            {isOverdue && <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 border border-red-200">Overdue</span>}
            {finding.ai_generated && <span className="px-2 py-0.5 rounded-full text-xs bg-violet-100 text-violet-700 border border-violet-200">AI Generated</span>}
          </div>
          <h1 className="text-2xl font-bold text-slate-900 truncate">{finding.title}</h1>
          <div className="flex items-center gap-4 mt-2 flex-wrap text-sm text-slate-600">
            {finding.engagement_title && <span className="flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" /> {finding.engagement_title}</span>}
            {finding.owner_name && <span className="flex items-center gap-1.5"><User className="h-3.5 w-3.5" /> {finding.owner_name}</span>}
            {finding.due_date && (
              <span className={`flex items-center gap-1.5 ${isOverdue ? 'text-red-600 font-medium' : ''}`}>
                <Calendar className="h-3.5 w-3.5" /> Due: {formatDate(finding.due_date)}
              </span>
            )}
            {finding.theme && <span className="flex items-center gap-1.5"><Tag className="h-3.5 w-3.5" /> {finding.theme}</span>}
            <span className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" /> Age: {ageDays}d</span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-slate-600">Remediation Lifecycle</span>
          <span className="text-xs text-slate-500">{formatStatus(finding.status)}</span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
        </div>
        <div className="flex justify-between mt-2">
          {LIFECYCLE_STAGES.map((stage) => {
            const stageProgress = getLifecycleProgress(stage);
            const isActive = progressPct >= stageProgress;
            return (
              <span key={stage} className={`text-[10px] ${isActive ? 'text-blue-600 font-medium' : 'text-slate-400'}`}>
                {formatStatus(stage)}
              </span>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="flex border-b border-slate-200 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                activeTab === tab.key ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
              }`}
            >
              {tab.icon}
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span className="px-1.5 py-0.5 text-xs bg-slate-100 text-slate-600 rounded-full">{tab.count}</span>
              )}
            </button>
          ))}
        </div>

        <div className="p-6">
          {activeTab === 'details' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {CCCE_CONFIG.map(item => (
                  <div key={item.key} className={`border-l-4 ${item.color} rounded-r-lg p-4`}>
                    <h4 className="text-sm font-semibold text-slate-700 mb-1.5 flex items-center gap-2">
                      <span>{item.icon}</span> {item.label}
                    </h4>
                    <p className="text-sm text-slate-600 leading-relaxed">{finding[item.key] || 'Not documented'}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {finding.root_cause_category && (
                  <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                    <p className="text-xs text-slate-500 mb-1">Root Cause Category</p>
                    <p className="text-sm font-medium text-slate-900 capitalize">{finding.root_cause_category}</p>
                  </div>
                )}
                {finding.risk_id && (
                  <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                    <p className="text-xs text-slate-500 mb-1">Linked Risk</p>
                    <p className="text-sm font-medium text-slate-900">Risk #{finding.risk_id}</p>
                  </div>
                )}
                {finding.control_id && (
                  <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                    <p className="text-xs text-slate-500 mb-1">Linked Control</p>
                    <p className="text-sm font-medium text-slate-900">Control #{finding.control_id}</p>
                  </div>
                )}
              </div>

              {finding.framework_mappings && finding.framework_mappings.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-slate-700 mb-2 flex items-center gap-2"><Shield className="h-4 w-4" /> Framework Mappings</h4>
                  <div className="flex flex-wrap gap-2">
                    {finding.framework_mappings.map((fw, idx) => (
                      <span key={idx} className="px-2.5 py-1 rounded-lg text-xs bg-slate-100 text-slate-700 border border-slate-200">
                        {typeof fw === 'string' ? fw : (fw as Record<string, string>).framework_name || (fw as Record<string, string>).name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {finding.attachment_file_name && (
                <div className="bg-slate-50 rounded-lg p-4 border border-slate-200">
                  <p className="text-xs text-slate-500 mb-1">Attachment</p>
                  <p className="text-sm text-blue-600">{finding.attachment_file_name}</p>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                  <p className="text-xs text-slate-500">Created</p>
                  <p className="text-slate-900">{formatDate(finding.created_at)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3 border border-slate-200">
                  <p className="text-xs text-slate-500">Last Updated</p>
                  <p className="text-slate-900">{formatDate(finding.updated_at)}</p>
                </div>
              </div>

              <div className="bg-violet-50 border border-violet-200 rounded-lg p-4">
                <button onClick={handleCalibrateSeverity} disabled={severityLoading} className="flex items-center gap-2 text-sm font-medium text-violet-700 hover:text-violet-800 transition-colors disabled:opacity-50">
                  {severityLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  AI Severity Calibration
                </button>
                <p className="text-xs text-violet-600 mt-1">Get an AI-powered severity assessment with impact analysis</p>
              </div>
            </div>
          )}

          {activeTab === 'responses' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">Management Responses</h3>
                {canCreate && <button
                  onClick={() => setShowResponseModal(true)}
                  className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm transition-colors"
                >
                  <Plus className="h-4 w-4" /> Add Response
                </button>}
              </div>

              {(!finding.management_responses || finding.management_responses.length === 0) ? (
                <div className="text-center py-12 bg-slate-50 rounded-lg border border-slate-200">
                  <MessageSquare className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-600">No management responses yet</p>
                  <p className="text-xs text-slate-400 mt-1">Submit a management response to proceed with remediation</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {finding.management_responses.map(resp => (
                    <div key={resp.id} className="bg-white rounded-lg border border-slate-200 p-4">
                      <div className="flex items-center gap-3 mb-2">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                          resp.response_type === 'agree' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                          resp.response_type === 'disagree' ? 'bg-red-100 text-red-700 border-red-200' :
                          'bg-amber-100 text-amber-700 border-amber-200'
                        }`}>
                          {resp.response_type === 'agree' ? 'Agreed' : resp.response_type === 'disagree' ? 'Disagreed' : 'Partially Agreed'}
                        </span>
                        <span className="text-xs text-slate-500">{formatDate(resp.responded_at)}</span>
                        {resp.target_date && <span className="text-xs text-slate-500 flex items-center gap-1"><Target className="h-3 w-3" /> Target: {formatDate(resp.target_date)}</span>}
                      </div>
                      {resp.response_text && <p className="text-sm text-slate-700 mb-2">{resp.response_text}</p>}
                      {resp.action_plan && (
                        <div className="mt-2 p-3 bg-blue-50 rounded-lg border border-blue-100">
                          <p className="text-xs font-medium text-blue-700 mb-1">Proposed Action Plan</p>
                          <p className="text-sm text-blue-800">{resp.action_plan}</p>
                        </div>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); handleEvaluateResponse(resp); }}
                        disabled={responseEvalLoading}
                        className="mt-2 flex items-center gap-1.5 text-xs text-violet-600 hover:text-violet-700 transition-colors disabled:opacity-50"
                      >
                        {responseEvalLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                        Evaluate Response with AI
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'recommendations' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">Recommendations & Action Plans</h3>
                {canCreate && <button
                  onClick={() => setShowRecModal(true)}
                  className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm transition-colors"
                >
                  <Plus className="h-4 w-4" /> Add Recommendation
                </button>}
              </div>

              {(!finding.recommendations || finding.recommendations.length === 0) ? (
                <div className="text-center py-12 bg-slate-50 rounded-lg border border-slate-200">
                  <ClipboardList className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-600">No recommendations yet</p>
                  <p className="text-xs text-slate-400 mt-1">Add recommendations with action plans to track remediation</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {finding.recommendations.map(rec => {
                    const totalAps = rec.action_plans?.length || 0;
                    const completedAps = rec.action_plans?.filter(ap => ap.status === 'completed').length || 0;
                    const apProgress = totalAps > 0 ? Math.round((completedAps / totalAps) * 100) : 0;

                    return (
                      <div key={rec.id} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                        <div className="p-4">
                          <div className="flex items-start justify-between">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <h4 className="text-sm font-semibold text-slate-900">{rec.title}</h4>
                                <span className={`px-2 py-0.5 rounded-full text-xs ${PRIORITY_COLORS[rec.priority] || 'bg-slate-100 text-slate-600'}`}>
                                  {rec.priority}
                                </span>
                                <span className={`px-2 py-0.5 rounded-full text-xs ${rec.status === 'completed' ? 'bg-emerald-100 text-emerald-700' : rec.status === 'in_progress' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                                  {formatStatus(rec.status)}
                                </span>
                              </div>
                              {rec.description && <p className="text-sm text-slate-600 mt-1">{rec.description}</p>}
                              <div className="flex items-center gap-3 mt-2 text-xs text-slate-500">
                                {rec.due_date && <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {formatDate(rec.due_date)}</span>}
                                {totalAps > 0 && <span>{completedAps}/{totalAps} action plans complete</span>}
                              </div>
                            </div>
                            {canCreate && <button
                              onClick={() => { setApRecId(rec.id); setShowApModal(true); }}
                              className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-slate-100 rounded-lg transition-colors"
                              title="Add Action Plan"
                            >
                              <Plus className="h-4 w-4" />
                            </button>}
                          </div>
                          {totalAps > 0 && (
                            <div className="mt-3">
                              <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${apProgress}%` }} />
                              </div>
                            </div>
                          )}
                        </div>

                        {rec.action_plans && rec.action_plans.length > 0 && (
                          <div className="border-t border-slate-100">
                            {rec.action_plans.map(ap => (
                              <div key={ap.id} className="px-4 py-3 border-b border-slate-50 last:border-0 flex items-center justify-between">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className={`h-2 w-2 rounded-full ${ap.status === 'completed' ? 'bg-emerald-500' : ap.status === 'in_progress' ? 'bg-amber-500' : 'bg-slate-300'}`} />
                                    <p className="text-sm text-slate-700 truncate">{ap.milestone}</p>
                                  </div>
                                  {ap.description && <p className="text-xs text-slate-500 mt-0.5 ml-4">{ap.description}</p>}
                                  <div className="flex items-center gap-3 ml-4 mt-1 text-xs text-slate-400">
                                    {ap.due_date && <span>Due: {formatDate(ap.due_date)}</span>}
                                    {ap.completed_date && <span className="text-emerald-600">Completed: {formatDate(ap.completed_date)}</span>}
                                    {ap.evidence_of_completion && <span className="text-blue-600">Evidence attached</span>}
                                  </div>
                                </div>
                                {ap.status !== 'completed' && canEdit && (
                                  <button
                                    onClick={() => { setCompleteApTarget({ recId: rec.id, apId: ap.id }); setCompleteApForm({ evidence_of_completion: '' }); setShowCompleteApModal(true); }}
                                    className="ml-2 px-2 py-1 text-xs text-emerald-600 hover:bg-emerald-50 rounded border border-emerald-200 transition-colors"
                                  >
                                    Complete
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeTab === 'followups' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-900">Follow-Up & Retesting</h3>
                {canCreate && <button
                  onClick={() => setShowFollowUpModal(true)}
                  className="flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm transition-colors"
                >
                  <Plus className="h-4 w-4" /> Add Follow-Up
                </button>}
              </div>

              {(!finding.follow_ups || finding.follow_ups.length === 0) ? (
                <div className="text-center py-12 bg-slate-50 rounded-lg border border-slate-200">
                  <RotateCcw className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-600">No follow-ups recorded</p>
                  <p className="text-xs text-slate-400 mt-1">Perform retesting after remediation and record results here</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {finding.follow_ups.map(fu => (
                    <div key={fu.id} className="bg-white rounded-lg border border-slate-200 p-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                            fu.retest_result === 'pass' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                            fu.retest_result === 'fail' ? 'bg-red-100 text-red-700 border-red-200' :
                            'bg-slate-100 text-slate-600 border-slate-200'
                          }`}>
                            {fu.retest_result === 'pass' ? 'Pass' : fu.retest_result === 'fail' ? 'Fail' : fu.follow_up_type || 'Review'}
                          </span>
                          <span className="text-xs text-slate-500">{formatDate(fu.performed_at)}</span>
                          {fu.closure_approved && <span className="px-2 py-0.5 rounded-full text-xs bg-emerald-100 text-emerald-700 border border-emerald-200">Closure Approved</span>}
                        </div>
                        {fu.retest_result === 'pass' && !fu.closure_approved && (
                          <button
                            onClick={() => closeFollowUpMutation.mutate({ fuId: fu.id })}
                            disabled={closeFollowUpMutation.isPending}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-emerald-600 hover:bg-emerald-50 rounded border border-emerald-200 transition-colors disabled:opacity-50"
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            {closeFollowUpMutation.isPending ? 'Closing...' : 'Approve Closure'}
                          </button>
                        )}
                      </div>
                      {fu.retest_details && <p className="text-sm text-slate-700 mb-1">{fu.retest_details}</p>}
                      {fu.notes && <p className="text-sm text-slate-600 italic">{fu.notes}</p>}
                      {fu.evidence_id && <p className="text-xs text-blue-600 mt-1">Evidence reference: #{fu.evidence_id}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'rootcause' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-slate-900">Root Cause Analysis</h3>
                  <p className="text-sm text-slate-500 mt-1">AI-powered analysis of potential root causes based on finding details and historical patterns</p>
                </div>
                <button
                  onClick={handleRootCause}
                  disabled={rootCauseLoading}
                  className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-sm transition-colors disabled:opacity-50"
                >
                  {rootCauseLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {rootCauseLoading ? 'Analyzing...' : 'Suggest Root Causes'}
                </button>
              </div>

              {rootCauseResult ? (
                <div className="space-y-4">
                  <div className="bg-violet-50 border border-violet-200 rounded-lg p-4">
                    <p className="text-sm font-medium text-violet-800 mb-1">Analysis Summary</p>
                    <p className="text-sm text-violet-700">{rootCauseResult.summary}</p>
                    <span className="inline-block mt-2 px-2 py-0.5 rounded text-xs bg-violet-100 text-violet-600">Source: {rootCauseResult.source}</span>
                  </div>

                  <div className="space-y-3">
                    {rootCauseResult.root_causes.map((rc, idx) => (
                      <div key={idx} className="bg-white rounded-lg border border-slate-200 p-4 flex items-start gap-4">
                        <div className={`p-2 rounded-lg ${
                          rc.category === 'people' ? 'bg-blue-100' :
                          rc.category === 'technology' ? 'bg-violet-100' :
                          rc.category === 'governance' ? 'bg-amber-100' : 'bg-emerald-100'
                        }`}>
                          <Target className={`h-5 w-5 ${
                            rc.category === 'people' ? 'text-blue-600' :
                            rc.category === 'technology' ? 'text-violet-600' :
                            rc.category === 'governance' ? 'text-amber-600' : 'text-emerald-600'
                          }`} />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-semibold text-slate-900 capitalize">{rc.category}</span>
                            <span className={`px-2 py-0.5 rounded-full text-xs ${
                              rc.likelihood === 'high' ? 'bg-red-100 text-red-700' :
                              rc.likelihood === 'medium' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                            }`}>
                              {rc.likelihood} likelihood
                            </span>
                          </div>
                          <p className="text-sm text-slate-600">{rc.description}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : !rootCauseLoading && (
                <div className="text-center py-12 bg-slate-50 rounded-lg border border-slate-200">
                  <Lightbulb className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-600">Click &quot;Suggest Root Causes&quot; to run AI analysis</p>
                  <p className="text-xs text-slate-400 mt-1">Uses finding details and historical patterns to identify potential root causes</p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'prioraudits' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Prior Audit History</h3>
                <p className="text-sm text-slate-500 mt-1">Previous audits of the same entity with their findings</p>
              </div>
              {!priorAuditsData?.prior_engagements?.length ? (
                <div className="text-center py-12 bg-slate-50 rounded-lg border border-slate-200">
                  <Clock className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                  <p className="text-slate-600">No prior audit history found</p>
                  <p className="text-xs text-slate-400 mt-1">This engagement may not be linked to an auditable entity, or this is the first audit</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {priorAuditsData.entity_name && (
                    <p className="text-sm text-slate-500">Entity: <span className="font-medium text-slate-700">{priorAuditsData.entity_name}</span></p>
                  )}

                  {priorAuditsData.overall_severity_distribution && Object.keys(priorAuditsData.overall_severity_distribution).length > 0 && (
                    <div className="bg-slate-50 rounded-lg border border-slate-200 p-4">
                      <h4 className="text-sm font-medium text-slate-700 mb-2">Historical Severity Distribution</h4>
                      <div className="flex items-center gap-3">
                        {['critical', 'high', 'medium', 'low'].map(sev => {
                          const count = priorAuditsData.overall_severity_distribution[sev] || 0;
                          if (!count) return null;
                          const colors: Record<string, string> = { critical: 'bg-red-100 text-red-700', high: 'bg-orange-100 text-orange-700', medium: 'bg-amber-100 text-amber-700', low: 'bg-slate-100 text-slate-600' };
                          return (
                            <span key={sev} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${colors[sev]}`}>
                              {sev}: {count}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {priorAuditsData.recurring_issues?.length > 0 && (
                    <div className="bg-amber-50 rounded-lg border border-amber-200 p-4">
                      <h4 className="text-sm font-medium text-amber-800 mb-2">Recurring Issues</h4>
                      <p className="text-xs text-amber-600 mb-2">Findings that appear in both prior and current audits</p>
                      <div className="space-y-1.5">
                        {priorAuditsData.recurring_issues.map((ri: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between text-xs">
                            <span className="text-amber-900 font-medium">{ri.title}</span>
                            <div className="flex items-center gap-2">
                              <span className={`px-1.5 py-0.5 rounded text-xs ${ri.severity === 'critical' ? 'bg-red-100 text-red-700' : ri.severity === 'high' ? 'bg-orange-100 text-orange-700' : 'bg-amber-100 text-amber-700'}`}>{ri.severity}</span>
                              <span className="text-amber-600">{ri.count}x prior</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {priorAuditsData.prior_engagements.map((pe: any) => (
                    <div key={pe.id} className="bg-white rounded-lg border border-slate-200 p-4 hover:border-blue-200 transition-colors">
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
                      <div className="flex items-center gap-4 text-xs text-slate-500 mb-2">
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
                        <div className="flex items-center gap-1.5 mb-2">
                          {['critical', 'high', 'medium', 'low'].map(sev => {
                            const c = pe.severity_distribution[sev];
                            if (!c) return null;
                            const cls: Record<string, string> = { critical: 'bg-red-50 text-red-600', high: 'bg-orange-50 text-orange-600', medium: 'bg-amber-50 text-amber-600', low: 'bg-slate-50 text-slate-500' };
                            return <span key={sev} className={`px-1.5 py-0.5 rounded text-xs ${cls[sev]}`}>{sev[0].toUpperCase()}:{c}</span>;
                          })}
                        </div>
                      )}
                      {pe.findings?.length > 0 && (
                        <div className="flex flex-wrap gap-1">
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
              )}
            </div>
          )}
        </div>
      </div>

      {showResponseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">Submit Management Response</h3>
              <button onClick={() => setShowResponseModal(false)} className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Response Type</label>
                <select
                  value={responseForm.response_type}
                  onChange={e => setResponseForm(p => ({ ...p, response_type: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-500"
                >
                  <option value="agree">Agree</option>
                  <option value="partial">Partially Agree</option>
                  <option value="disagree">Disagree</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Response</label>
                <textarea
                  value={responseForm.response_text}
                  onChange={e => setResponseForm(p => ({ ...p, response_text: e.target.value }))}
                  rows={3}
                  placeholder="Management response details..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Proposed Action Plan</label>
                <textarea
                  value={responseForm.action_plan}
                  onChange={e => setResponseForm(p => ({ ...p, action_plan: e.target.value }))}
                  rows={2}
                  placeholder="Describe planned remediation actions..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Target Completion Date</label>
                <input
                  type="date"
                  value={responseForm.target_date}
                  onChange={e => setResponseForm(p => ({ ...p, target_date: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
                <button onClick={() => setShowResponseModal(false)} className="px-4 py-2 text-sm text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">Cancel</button>
                <button
                  onClick={() => {
                    const payload: Record<string, unknown> = { response_type: responseForm.response_type };
                    if (responseForm.response_text) payload.response_text = responseForm.response_text;
                    if (responseForm.action_plan) payload.action_plan = responseForm.action_plan;
                    if (responseForm.target_date) payload.target_date = responseForm.target_date;
                    addResponseMutation.mutate(payload);
                  }}
                  disabled={addResponseMutation.isPending}
                  className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50"
                >
                  {addResponseMutation.isPending ? 'Submitting...' : 'Submit Response'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showRecModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">Add Recommendation</h3>
              <button onClick={() => setShowRecModal(false)} className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
                <input
                  type="text"
                  value={recForm.title}
                  onChange={e => setRecForm(p => ({ ...p, title: e.target.value }))}
                  placeholder="Recommendation title"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  value={recForm.description}
                  onChange={e => setRecForm(p => ({ ...p, description: e.target.value }))}
                  rows={3}
                  placeholder="Detailed recommendation..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Priority</label>
                  <select
                    value={recForm.priority}
                    onChange={e => setRecForm(p => ({ ...p, priority: e.target.value }))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-500"
                  >
                    <option value="critical">Critical</option>
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Due Date</label>
                  <input
                    type="date"
                    value={recForm.due_date}
                    onChange={e => setRecForm(p => ({ ...p, due_date: e.target.value }))}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
                <button onClick={() => setShowRecModal(false)} className="px-4 py-2 text-sm text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">Cancel</button>
                <button
                  onClick={() => {
                    const payload: Record<string, unknown> = { title: recForm.title, priority: recForm.priority };
                    if (recForm.description) payload.description = recForm.description;
                    if (recForm.due_date) payload.due_date = recForm.due_date;
                    addRecMutation.mutate(payload);
                  }}
                  disabled={!recForm.title || addRecMutation.isPending}
                  className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50"
                >
                  {addRecMutation.isPending ? 'Adding...' : 'Add Recommendation'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showApModal && apRecId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">Add Action Plan Milestone</h3>
              <button onClick={() => { setShowApModal(false); setApRecId(null); }} className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Milestone</label>
                <input
                  type="text"
                  value={apForm.milestone}
                  onChange={e => setApForm(p => ({ ...p, milestone: e.target.value }))}
                  placeholder="Milestone name"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
                <textarea
                  value={apForm.description}
                  onChange={e => setApForm(p => ({ ...p, description: e.target.value }))}
                  rows={2}
                  placeholder="Milestone details..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Due Date</label>
                <input
                  type="date"
                  value={apForm.due_date}
                  onChange={e => setApForm(p => ({ ...p, due_date: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
                <button onClick={() => { setShowApModal(false); setApRecId(null); }} className="px-4 py-2 text-sm text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">Cancel</button>
                <button
                  onClick={() => {
                    const payload: Record<string, unknown> = { milestone: apForm.milestone };
                    if (apForm.description) payload.description = apForm.description;
                    if (apForm.due_date) payload.due_date = apForm.due_date;
                    addApMutation.mutate({ recId: apRecId, data: payload });
                  }}
                  disabled={!apForm.milestone || addApMutation.isPending}
                  className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50"
                >
                  {addApMutation.isPending ? 'Adding...' : 'Add Milestone'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCompleteApModal && completeApTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">Complete Action Plan</h3>
              <button onClick={() => setShowCompleteApModal(false)} className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Evidence of Completion</label>
                <textarea
                  value={completeApForm.evidence_of_completion}
                  onChange={e => setCompleteApForm({ evidence_of_completion: e.target.value })}
                  rows={4}
                  placeholder="Describe the evidence of completion (document references, test results, screenshots, etc.)"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
                <button onClick={() => setShowCompleteApModal(false)} className="px-4 py-2 text-sm text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">Cancel</button>
                <button
                  onClick={() => {
                    updateApMutation.mutate({
                      recId: completeApTarget.recId,
                      apId: completeApTarget.apId,
                      data: {
                        status: 'completed',
                        completed_date: new Date().toISOString(),
                        evidence_of_completion: completeApForm.evidence_of_completion || undefined,
                      },
                    });
                  }}
                  disabled={updateApMutation.isPending}
                  className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg disabled:opacity-50"
                >
                  {updateApMutation.isPending ? 'Completing...' : 'Mark Complete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showFollowUpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white rounded-xl border border-slate-200 w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h3 className="text-lg font-semibold text-slate-900">Record Follow-Up / Retest</h3>
              <button onClick={() => setShowFollowUpModal(false)} className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100"><X className="h-5 w-5" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Follow-Up Type</label>
                <select
                  value={followUpForm.follow_up_type}
                  onChange={e => setFollowUpForm(p => ({ ...p, follow_up_type: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-500"
                >
                  <option value="retest">Retest</option>
                  <option value="review">Review</option>
                  <option value="validation">Validation</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Retest Result</label>
                <select
                  value={followUpForm.retest_result}
                  onChange={e => setFollowUpForm(p => ({ ...p, retest_result: e.target.value }))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-500"
                >
                  <option value="">Select result...</option>
                  <option value="pass">Pass — Issue Remediated</option>
                  <option value="fail">Fail — Issue Persists</option>
                  <option value="partial">Partial — Partially Remediated</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Retest Details</label>
                <textarea
                  value={followUpForm.retest_details}
                  onChange={e => setFollowUpForm(p => ({ ...p, retest_details: e.target.value }))}
                  rows={3}
                  placeholder="Describe retest procedures and observations..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea
                  value={followUpForm.notes}
                  onChange={e => setFollowUpForm(p => ({ ...p, notes: e.target.value }))}
                  rows={2}
                  placeholder="Additional notes..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="flex justify-end gap-2 pt-4 border-t border-slate-200">
                <button onClick={() => setShowFollowUpModal(false)} className="px-4 py-2 text-sm text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">Cancel</button>
                <button
                  onClick={() => {
                    const payload: Record<string, unknown> = { follow_up_type: followUpForm.follow_up_type };
                    if (followUpForm.retest_result) payload.retest_result = followUpForm.retest_result;
                    if (followUpForm.retest_details) payload.retest_details = followUpForm.retest_details;
                    if (followUpForm.notes) payload.notes = followUpForm.notes;
                    addFollowUpMutation.mutate(payload);
                  }}
                  disabled={addFollowUpMutation.isPending}
                  className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg disabled:opacity-50"
                >
                  {addFollowUpMutation.isPending ? 'Recording...' : 'Record Follow-Up'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showSeverityModal && severityResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-xl max-h-[85vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2"><Sparkles className="h-5 w-5 text-violet-500" /> Severity Calibration</h3>
              <button onClick={() => setShowSeverityModal(false)} className="text-slate-500 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-600">Current:</span>
                <span className={`px-2.5 py-1 rounded-lg text-sm font-medium border ${SEVERITY_COLORS[finding?.severity || ''] || 'bg-slate-100'}`}>
                  {finding?.severity?.charAt(0).toUpperCase()}{finding?.severity?.slice(1)}
                </span>
                <ChevronRight className="h-4 w-4 text-slate-400" />
                <span className="text-sm text-slate-600">Recommended:</span>
                <span className={`px-2.5 py-1 rounded-lg text-sm font-semibold border ${SEVERITY_COLORS[severityResult.recommended_severity] || 'bg-slate-100'}`}>
                  {(severityResult.recommended_severity || '').charAt(0).toUpperCase()}{(severityResult.recommended_severity || '').slice(1)}
                </span>
              </div>
              {severityResult.justification && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                  <p className="text-sm text-slate-700">{severityResult.justification}</p>
                </div>
              )}
              {severityResult.impact_dimensions && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-blue-700 mb-2">Impact Dimensions</h4>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    {Object.entries(severityResult.impact_dimensions).map(([k, v]) => (
                      <div key={k} className="flex justify-between">
                        <span className="text-blue-600 capitalize">{k}</span>
                        <span className={`font-medium ${v === 'high' ? 'text-red-600' : v === 'medium' ? 'text-amber-600' : v === 'low' ? 'text-emerald-600' : 'text-slate-500'}`}>{v as string}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {severityResult.aggravating_factors && severityResult.aggravating_factors.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-red-700 mb-2">Aggravating Factors</h4>
                  <ul className="text-sm text-red-800 list-disc pl-5 space-y-1">
                    {severityResult.aggravating_factors.map((f: string, i: number) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
              )}
              {severityResult.mitigating_factors && severityResult.mitigating_factors.length > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-emerald-700 mb-2">Mitigating Factors</h4>
                  <ul className="text-sm text-emerald-800 list-disc pl-5 space-y-1">
                    {severityResult.mitigating_factors.map((f: string, i: number) => <li key={i}>{f}</li>)}
                  </ul>
                </div>
              )}
              {severityResult.calibration_notes && (
                <p className="text-xs text-slate-500 italic">{severityResult.calibration_notes}</p>
              )}
            </div>
            <div className="flex justify-end mt-4 pt-4 border-t border-slate-200">
              <button onClick={() => setShowSeverityModal(false)} className="px-4 py-2 text-sm text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">Close</button>
            </div>
          </div>
        </div>
      )}

      {showResponseEvalModal && responseEvalResult && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-xl max-h-[85vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2"><Sparkles className="h-5 w-5 text-violet-500" /> Response Evaluation</h3>
              <button onClick={() => setShowResponseEvalModal(false)} className="text-slate-500 hover:text-slate-700"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${
                  responseEvalResult.overall_rating === 'adequate' ? 'bg-emerald-100 text-emerald-700' :
                  responseEvalResult.overall_rating === 'inadequate' ? 'bg-red-100 text-red-700' :
                  'bg-amber-100 text-amber-700'
                }`}>
                  {(responseEvalResult.overall_rating || '').replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                </span>
                {responseEvalResult.score && (
                  <span className="text-sm text-slate-500">Score: {responseEvalResult.score}/10</span>
                )}
                {responseEvalResult.risk_of_recurrence && (
                  <span className={`text-xs px-2 py-0.5 rounded-full ${
                    responseEvalResult.risk_of_recurrence === 'high' ? 'bg-red-100 text-red-700' :
                    responseEvalResult.risk_of_recurrence === 'medium' ? 'bg-amber-100 text-amber-700' :
                    'bg-emerald-100 text-emerald-700'
                  }`}>
                    Recurrence risk: {responseEvalResult.risk_of_recurrence}
                  </span>
                )}
              </div>
              {responseEvalResult.assessment && (
                <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                  <p className="text-sm text-slate-700">{responseEvalResult.assessment}</p>
                </div>
              )}
              {responseEvalResult.strengths && responseEvalResult.strengths.length > 0 && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-emerald-700 mb-2">Strengths</h4>
                  <ul className="text-sm text-emerald-800 list-disc pl-5 space-y-1">
                    {responseEvalResult.strengths.map((s: string, i: number) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}
              {responseEvalResult.gaps && responseEvalResult.gaps.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-red-700 mb-2">Gaps</h4>
                  <ul className="text-sm text-red-800 list-disc pl-5 space-y-1">
                    {responseEvalResult.gaps.map((g: string, i: number) => <li key={i}>{g}</li>)}
                  </ul>
                </div>
              )}
              {responseEvalResult.recommendations && responseEvalResult.recommendations.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="text-sm font-semibold text-blue-700 mb-2">Recommendations</h4>
                  <ul className="text-sm text-blue-800 list-disc pl-5 space-y-1">
                    {responseEvalResult.recommendations.map((r: string, i: number) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
              {responseEvalResult.timeline_assessment && (
                <p className="text-xs text-slate-500 italic">{responseEvalResult.timeline_assessment}</p>
              )}
            </div>
            <div className="flex justify-end mt-4 pt-4 border-t border-slate-200">
              <button onClick={() => setShowResponseEvalModal(false)} className="px-4 py-2 text-sm text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
