'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DataTable, MultiSelectDropdown } from '@/components/ui';
import { adminApi, workflowEngineApi } from '@/lib/api';
import { CheckCircle, XCircle, Clock, AlertCircle, ChevronDown, ChevronRight, Loader2, Search, ExternalLink, Download } from 'lucide-react';

interface AuditLogEntry {
  id: number;
  user_id: number | null;
  user_name: string;
  action: string;
  resource_type: string;
  resource_id: number | null;
  details: Record<string, unknown>;
  method?: string;
  path?: string;
  status_code?: number;
  duration_ms?: number;
  ip_address: string | null;
  timestamp: string;
  actor_type?: string;
  summary?: string;
  ai_summary?: string | null;
  resource_name?: string;
  resource_url?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  snapshot?: Record<string, unknown> | null;
  field_diff?: Record<string, { old: unknown; new: unknown }> | null;
}

interface ExecutionStep {
  id: number;
  node_key: string;
  node_type: string;
  status: string;
  input_payload: Record<string, unknown>;
  output_payload: Record<string, unknown>;
  attempts: number;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

interface ExecutionInstance {
  id: number;
  workflow_definition_id: number;
  status: string;
  trigger_event: string;
  trigger_payload: Record<string, unknown>;
  context: Record<string, unknown>;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  error_message: string | null;
}

interface WorkflowExecution {
  instance: ExecutionInstance;
  steps: ExecutionStep[];
}

interface WorkflowInfo {
  name: string;
  id: number;
}

// Single-word verbs that, as the trailing path segment, indicate a sub-action.
// Mirrors backend audit_logger._KNOWN_SUB_ACTION_VERBS — keep in sync.
const KNOWN_SUB_ACTION_VERBS = new Set<string>([
  'approve', 'reject', 'submit', 'withdraw', 'decision', 'escalate',
  'claim', 'complete', 'cancel', 'request',
  'publish', 'unpublish', 'archive', 'unarchive', 'restore',
  'activate', 'deactivate', 'enable', 'disable',
  'trigger', 'execute', 'run', 'rerun', 'retry', 'schedule',
  'send', 'dispatch', 'notify',
  'import', 'export', 'generate', 'regenerate', 'refresh', 'sync',
  'validate', 'verify', 'parse', 'analyze', 'optimize',
  'ask', 'suggest', 'reword',
  'measure', 'assign', 'reassign', 'clone', 'duplicate', 'merge',
]);

// Detect sub-action endpoints like /ai-suggest, /parse-policy, /publish.
// Mirrors backend audit_logger._extract_sub_action so older middleware logs
// (where action="create" was incorrectly stamped) get re-labeled correctly
// at display time without a DB backfill.
//
// Returns null for sub-resource collection creates (e.g. POST /risks/5/comments)
// so they remain a true CRUD "create".
function extractSubAction(path: string): string | null {
  const normalized = path.replace(/^\/grc\//, '').replace(/^\//, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length < 3) return null;
  const last = parts[parts.length - 1];
  if (/^\d+$/.test(last)) return null;
  const lower = last.toLowerCase();
  // Hyphenated trailing segment is always a verb phrase in this codebase
  if (last.includes('-')) return lower.replace(/-/g, '_');
  // Single-word verb whitelist
  if (KNOWN_SUB_ACTION_VERBS.has(lower)) return lower;
  // Otherwise: sub-resource collection — let CRUD action stand
  return null;
}

function formatActivity(log: AuditLogEntry): string {
  const path = log.path || '';
  const rawAction = log.action || '';
  const resource = log.resource_type || '';
  const segments = path.replace(/^\/grc\//, '').split('/').filter(Boolean);
  const moduleSlug = segments[0] || resource;

  // Re-classify legacy create/update logs that were really sub-actions
  // (e.g. /kris/ai-suggest stamped as "create" by old middleware).
  let action = rawAction;
  if (rawAction === 'create' || rawAction === 'update' || rawAction === 'create_failed' || rawAction === 'update_failed') {
    const sub = extractSubAction(path);
    if (sub) {
      const failed = rawAction.endsWith('_failed') ? '_failed' : '';
      action = `${sub}${failed}`;
    }
  }

  // Specific overrides for workflow execution events
  if (moduleSlug === 'workflow-engine') {
    const sub = segments[1] || '';
    const sub2 = segments[2] || '';
    if (sub === 'executions' && sub2 === 'trigger') return 'Executed Workflow';
    if (sub === 'executions' && sub2 === 'instances') return 'Workflow Instance Action';
    if (sub === 'definitions' && action === 'create') {
      const reqBody = log.details?.request as Record<string, unknown> | null | undefined;
      const name = reqBody?.name as string | null;
      return name ? `Created Workflow "${name}"` : 'Created Workflow';
    }
    if (sub === 'definitions' && action === 'update') {
      const reqBody = log.details?.request as Record<string, unknown> | null | undefined;
      const name = reqBody?.name as string | null;
      return name ? `Updated Workflow "${name}"` : 'Updated Workflow';
    }
    if (sub === 'approvals') return 'Workflow Approval Action';
    if (sub === 'schedules') return 'Workflow Schedule Action';
    if (sub === 'notifications' && sub2 === 'in-app') {
      const lastSeg = segments[segments.length - 1] || '';
      if (lastSeg === 'read') return 'Marked notification as read';
      if (lastSeg === 'dismiss') return 'Dismissed notification';
      return 'Workflow notification action';
    }
    if (sub === 'catalog') return 'Viewed workflow catalog';
    return 'Workflow Action';
  }

  // Auth — friendlier strings for login/logout
  if (moduleSlug === 'auth') {
    const sub = segments[1] || '';
    const reqBody = log.details?.request as Record<string, unknown> | null | undefined;
    const who = (reqBody?.username as string) || (reqBody?.email as string) || '';
    if (sub === 'login') {
      if (action === 'create_failed') return who ? `Failed login attempt for "${who}"` : 'Failed login attempt';
      return who ? `Signed in as "${who}"` : 'Signed in';
    }
    if (sub === 'logout') return 'Signed out';
    if (sub === 'register' || sub === 'register-organization') {
      return who ? `Registered account "${who}"` : 'Registered account';
    }
    if (sub === 'me') return 'Checked active session';
  }

  const MODULE_LABELS: Record<string, string> = {
    'erm': 'Risk',
    'compliance': 'Compliance',
    'governance': 'Document',
    'controls': 'Control',
    'evidence': 'Evidence',
    'vendor-risk': 'Vendor',
    'vendor_risk': 'Vendor',
    'kris': 'KRI',
    'rcsa': 'RCSA',
    'auth': 'Auth',
    'admin': 'Admin',
    'integrations': 'Integration',
    'frameworks': 'Framework',
    'vulnerabilities': 'Vulnerability',
    'certifications': 'Certification',
    'risks': 'Risk',
    'incidents': 'Incident',
    'assessments': 'Assessment',
    'questionnaires': 'Questionnaire',
    'documents': 'Document',
    'committees': 'Committee',
    'attestations': 'Attestation',
    'users': 'User',
  };

  const subSlug = segments[1] || '';
  const resourceLabel =
    MODULE_LABELS[subSlug] ||
    MODULE_LABELS[moduleSlug] ||
    MODULE_LABELS[resource] ||
    (resource ? resource.charAt(0).toUpperCase() + resource.slice(1).replace(/_/g, ' ') : 'Record');

  const ACTION_VERBS: Record<string, string> = {
    create: 'Created',
    create_failed: 'Failed to Create',
    update: 'Updated',
    delete: 'Deleted',
    read: 'Viewed',
    execute: 'Executed',
    login: 'Logged In',
    logout: 'Logged Out',
    upload: 'Uploaded',
    download: 'Downloaded',
    approve: 'Approved',
    reject: 'Rejected',
    submit: 'Submitted',
    send: 'Sent',
    // Common sub-actions surfaced by the middleware
    ai_suggest: 'AI Suggested for',
    parse_policy: 'Parsed Policy on',
    start_review: 'Started Review on',
    complete_review: 'Completed Review on',
    publish: 'Published',
    measure: 'Recorded Measurement on',
    upload_file: 'Uploaded File to',
    download_file: 'Downloaded File from',
    bulk_archive: 'Bulk Archived',
    bulk_update_status: 'Bulk Updated Status of',
    trigger: 'Triggered',
    decision: 'Recorded Decision on',
    archive: 'Archived',
    restore: 'Restored',
    activate: 'Activated',
    deactivate: 'Deactivated',
    assign: 'Assigned',
    escalate: 'Escalated',
    withdraw: 'Withdrew',
    clone: 'Cloned',
    duplicate: 'Duplicated',
  };

  // Pretty-format unknown sub-action verbs: 'ai_suggest_policies' → 'Ai Suggest Policies'
  const titleCaseAction = (a: string) =>
    a.split('_').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

  const verb = ACTION_VERBS[action] || (action ? titleCaseAction(action) : 'Performed action on');
  const requestBody = log.details?.request as Record<string, unknown> | null | undefined;
  const name = (requestBody?.name as string) || (requestBody?.title as string) || (requestBody?.username as string) || null;
  const resourceId = log.resource_id ? ` #${log.resource_id}` : '';
  const namePart = name ? ` "${name}"` : resourceId;
  return `${verb} ${resourceLabel}${namePart}`;
}

function getResourceBadge(resource_type: string): string {
  const colors: Record<string, string> = {
    workflow: 'bg-purple-50 text-purple-700',
    risk: 'bg-orange-50 text-orange-700',
    compliance: 'bg-blue-50 text-blue-700',
    governance: 'bg-teal-50 text-teal-700',
    controls: 'bg-indigo-50 text-indigo-700',
    evidence: 'bg-yellow-50 text-yellow-700',
    admin: 'bg-slate-50 text-slate-700',
    auth: 'bg-green-50 text-green-700',
  };
  return colors[resource_type] || 'bg-slate-50 text-slate-600';
}

function getActionColor(action: string) {
  if (action === 'execute') return 'bg-violet-50 text-violet-700 border border-violet-200';
  if (action.includes('create')) return 'bg-green-50 text-green-700 border border-green-200';
  if (action.includes('delete') || action.includes('remove')) return 'bg-red-50 text-red-700 border border-red-200';
  if (action.includes('update') || action.includes('edit')) return 'bg-blue-50 text-blue-700 border border-blue-200';
  if (action.includes('login') || action.includes('auth')) return 'bg-emerald-50 text-emerald-700 border border-emerald-200';
  return 'bg-slate-50 text-slate-600 border border-slate-200';
}

function isWorkflowExecution(log: AuditLogEntry): boolean {
  return (log.path || '').includes('workflow-engine/executions/trigger') ||
    (log.path || '').includes('workflow-engine/executions/instances');
}

function stepDuration(step: ExecutionStep): string {
  if (!step.started_at || !step.completed_at) return '-';
  const ms = new Date(step.completed_at).getTime() - new Date(step.started_at).getTime();
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function totalDuration(instance: ExecutionInstance): string {
  if (!instance.started_at) return '-';
  const end = instance.completed_at || instance.failed_at;
  if (!end) return 'Running…';
  const ms = new Date(end).getTime() - new Date(instance.started_at).getTime();
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function humanizeNodeKey(key: string): string {
  return key
    .replace(/^platform_action\.[^.]+\.[^.]+\.[^.]+\./, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function StepStatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle size={14} className="text-green-500 shrink-0" />;
  if (status === 'failed') return <XCircle size={14} className="text-red-500 shrink-0" />;
  if (status === 'running') return <Loader2 size={14} className="text-blue-500 shrink-0 animate-spin" />;
  if (status === 'pending') return <Clock size={14} className="text-slate-400 shrink-0" />;
  return <AlertCircle size={14} className="text-amber-500 shrink-0" />;
}

function isEmptyPayload(p: Record<string, unknown>): boolean {
  if (!p || Object.keys(p).length === 0) return true;
  const trigger = p.trigger as Record<string, unknown> | undefined;
  const context = p.context as Record<string, unknown> | undefined;
  if (
    Object.keys(p).every((k) => k === 'trigger' || k === 'context') &&
    (!trigger || Object.keys(trigger).length === 0) &&
    (!context || Object.keys(context).length === 0)
  ) return true;
  return false;
}

function PayloadView({ payload, label }: { payload: Record<string, unknown>; label: string }) {
  const filtered = Object.fromEntries(
    Object.entries(payload).filter(([k]) => k !== 'trigger' && k !== 'context')
  );
  const trigger = payload.trigger as Record<string, unknown> | undefined;
  const merged = { ...filtered, ...(trigger && Object.keys(trigger).length > 0 ? trigger : {}) };

  if (Object.keys(merged).length === 0) return null;
  return (
    <div>
      <p className="text-[10px] text-slate-400 uppercase font-semibold mb-1">{label}</p>
      <div className="bg-slate-50 border border-slate-200 rounded divide-y divide-slate-100">
        {Object.entries(merged).map(([k, v]) => (
          <div key={k} className="flex items-start gap-2 px-2.5 py-1.5">
            <span className="text-[10px] text-slate-500 font-medium w-32 shrink-0 pt-0.5 capitalize">{k.replace(/_/g, ' ')}</span>
            <span className="text-[10px] text-black break-all">
              {typeof v === 'boolean' ? (v ? 'Yes' : 'No') : typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function StepRow({ step, index }: { step: ExecutionStep; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const out = step.output_payload || {};
  const isBlocked = out.blocked === true;
  const blockedReason = out.reason as string | undefined;
  const hasUsefulOutput = !isEmptyPayload(out) && !isBlocked;
  const hasUsefulInput = !isEmptyPayload(step.input_payload || {});
  const canExpand = isBlocked || hasUsefulOutput || hasUsefulInput || !!step.error_message;

  return (
    <div className={`border rounded-lg overflow-hidden ${step.status === 'failed' ? 'border-red-200' : 'border-slate-200'}`}>
      <button
        onClick={() => canExpand && setExpanded((v) => !v)}
        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors bg-slate-50 hover:bg-slate-100 ${!canExpand ? 'cursor-default' : ''}`}
      >
        <span className="text-[10px] font-bold text-slate-400 w-4 shrink-0">{index + 1}</span>
        <StepStatusIcon status={step.status} />
        <div className="flex-1 min-w-0">
          <span className="text-xs font-semibold text-black capitalize">
            {humanizeNodeKey(step.node_key)}
          </span>
          <span className="ml-2 text-[10px] text-slate-400">{step.node_type}</span>
          {isBlocked && (
            <span className="ml-2 text-[10px] font-medium text-amber-500">not connected</span>
          )}
        </div>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
          step.status === 'completed' ? 'bg-green-100 text-green-700' :
          step.status === 'failed' ? 'bg-red-100 text-red-700' :
          'bg-slate-100 text-slate-600'
        }`}>
          {step.status}
        </span>
        <span className="text-[10px] text-slate-400 w-12 text-right shrink-0">{stepDuration(step)}</span>
        {canExpand && (
          expanded ? <ChevronDown size={12} className="text-slate-400 shrink-0" /> : <ChevronRight size={12} className="text-slate-400 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="bg-white border-t border-slate-100 px-3 py-2 space-y-2">
          {step.error_message && (
            <div className="bg-red-50 border border-red-200 rounded p-2">
              <p className="text-[10px] text-red-500 font-semibold uppercase mb-1">Error</p>
              <p className="text-xs text-red-700">{step.error_message}</p>
            </div>
          )}
          {isBlocked && (
            <div className="bg-slate-50 border border-slate-200 rounded p-2 flex items-start gap-2">
              <AlertCircle size={13} className="text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-[10px] text-slate-700 font-semibold">Action not yet connected to a live integration</p>
                <p className="text-[10px] text-slate-500 mt-0.5">This step was reached but the platform action is not yet wired up in the workflow runtime. The step completed without performing its intended action.</p>
              </div>
            </div>
          )}
          {hasUsefulOutput && <PayloadView payload={out} label="Result" />}
          {hasUsefulInput && <PayloadView payload={step.input_payload || {}} label="Input" />}
        </div>
      )}
    </div>
  );
}

function WorkflowExecutionPanel({ log, onNameLoaded }: { log: AuditLogEntry; onNameLoaded?: (name: string) => void }) {
  const [execution, setExecution] = useState<WorkflowExecution | null>(null);
  const [workflowInfo, setWorkflowInfo] = useState<WorkflowInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const req = log.details?.request as Record<string, unknown> | null | undefined;
    const defId = req?.workflow_definition_id as number | null;
    if (!defId) { setLoading(false); return; }

    const load = async () => {
      try {
        // Fetch workflow name
        const defResp = await workflowEngineApi.definitions.getById(defId);
        const name = defResp.data?.name || `Workflow #${defId}`;
        setWorkflowInfo({ id: defId, name });
        onNameLoaded?.(name);

        // Fetch execution instances for this definition — find the one closest to log timestamp
        const instResp = await workflowEngineApi.executions.listInstances({ workflow_definition_id: defId, limit: 50 });
        const instances: ExecutionInstance[] = instResp.data || [];
        if (!instances.length) { setLoading(false); return; }

        const logTime = new Date(log.timestamp).getTime();
        const closest = instances.reduce((best, cur) => {
          const diff = Math.abs(new Date(cur.started_at || '').getTime() - logTime);
          const bestDiff = Math.abs(new Date(best.started_at || '').getTime() - logTime);
          return diff < bestDiff ? cur : best;
        });

        // Fetch execution detail with steps
        const detailResp = await workflowEngineApi.executions.getInstance(closest.id);
        setExecution(detailResp.data);
      } catch {
        setError('Could not load execution details');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [log]);

  if (loading) return (
    <div className="flex items-center justify-center py-8 gap-2 text-slate-400">
      <Loader2 size={16} className="animate-spin" />
      <span className="text-xs">Loading execution data…</span>
    </div>
  );

  if (error) return <p className="text-xs text-red-500 py-4">{error}</p>;

  if (!execution) return (
    <p className="text-xs text-slate-400 py-4">No execution data found for this trigger.</p>
  );

  const inst = execution.instance;
  const steps = execution.steps || [];
  const completed = steps.filter((s) => s.status === 'completed').length;
  const failed = steps.filter((s) => s.status === 'failed').length;

  return (
    <div className="space-y-3">
      {/* Workflow summary */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-bold text-indigo-800">{workflowInfo?.name || `Workflow #${inst.workflow_definition_id}`}</p>
            <p className="text-[10px] text-indigo-500 mt-0.5">Definition #{inst.workflow_definition_id} · Instance #{inst.id}</p>
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${inst.status === 'completed' ? 'bg-green-100 text-green-700' : inst.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
            {inst.status}
          </span>
        </div>

        <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
          <div>
            <span className="text-indigo-400 uppercase font-semibold">Duration</span>
            <p className="text-indigo-800 font-medium">{totalDuration(inst)}</p>
          </div>
          <div>
            <span className="text-indigo-400 uppercase font-semibold">Trigger</span>
            <p className="text-indigo-800 font-medium">{inst.trigger_event}</p>
          </div>
          <div>
            <span className="text-indigo-400 uppercase font-semibold">Steps</span>
            <p className="text-indigo-800 font-medium">
              {completed}/{steps.length} done
              {failed > 0 && <span className="text-red-600 ml-1">· {failed} failed</span>}
            </p>
          </div>
        </div>

        {inst.error_message && (
          <div className="mt-2 bg-red-100 border border-red-200 rounded p-2">
            <p className="text-[10px] text-red-600">{inst.error_message}</p>
          </div>
        )}
      </div>

      {/* Visual pipeline progress bar */}
      {steps.length > 0 && (
        <div>
          <p className="text-[10px] text-slate-400 uppercase font-semibold mb-1.5">Pipeline Progress</p>
          <div className="flex items-center gap-0.5">
            {steps.map((step, i) => (
              <div key={step.id} className="flex items-center gap-0.5 flex-1">
                <div
                  title={humanizeNodeKey(step.node_key)}
                  className={`h-2 flex-1 rounded-full transition-colors ${step.status === 'completed' ? 'bg-green-500' : step.status === 'failed' ? 'bg-red-500' : step.status === 'running' ? 'bg-blue-400 animate-pulse' : 'bg-slate-200'}`}
                />
                {i < steps.length - 1 && <div className="w-0.5 h-0.5 rounded-full bg-slate-300 shrink-0" />}
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-0.5">
            <span className="text-[9px] text-slate-400">{humanizeNodeKey(steps[0]?.node_key || '')}</span>
            <span className="text-[9px] text-slate-400">{humanizeNodeKey(steps[steps.length - 1]?.node_key || '')}</span>
          </div>
        </div>
      )}

      {/* Step-by-step trace */}
      <div>
        <p className="text-[10px] text-slate-400 uppercase font-semibold mb-1.5">Execution Trace</p>
        <div className="space-y-1.5">
          {steps.map((step, i) => <StepRow key={step.id} step={step} index={i} />)}
        </div>
      </div>
    </div>
  );
}

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [actionFilter, setActionFilter] = useState('all');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [actorFilter, setActorFilter] = useState('user');
  const [hideReads, setHideReads] = useState(true);
  const [availableActions, setAvailableActions] = useState<string[]>([]);
  const [availableModules, setAvailableModules] = useState<string[]>([]);
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);
  const [selectedWfName, setSelectedWfName] = useState<string | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [exporting, setExporting] = useState(false);
  const limit = 50;

  useEffect(() => { fetchFilters(); }, []);
  useEffect(() => {
    const t = setTimeout(() => { setPage(0); setDebouncedSearch(searchText); }, 350);
    return () => clearTimeout(t);
  }, [searchText]);
  useEffect(() => { fetchLogs(); }, [page, actionFilter, moduleFilter, dateFilter, actorFilter, hideReads, debouncedSearch]);

  // When the user opens a log's detail modal, lazily fetch its AI summary
  // (cached server-side after first generation).
  useEffect(() => {
    if (!selectedLog) { setAiSummary(null); setAiSummaryLoading(false); return; }
    if (selectedLog.ai_summary) { setAiSummary(selectedLog.ai_summary); return; }
    let cancelled = false;
    setAiSummary(null);
    setAiSummaryLoading(true);
    adminApi.generateAuditLogAiSummary(selectedLog.id).then((resp) => {
      if (cancelled) return;
      const s = resp.data?.ai_summary || null;
      setAiSummary(s);
      // Patch the row in the list so re-opens are instant
      if (s) setLogs((prev) => prev.map((l) => l.id === selectedLog.id ? { ...l, ai_summary: s } : l));
    }).catch(() => { if (!cancelled) setAiSummary(null); })
      .finally(() => { if (!cancelled) setAiSummaryLoading(false); });
    return () => { cancelled = true; };
  }, [selectedLog]);

  const getDateRange = () => {
    if (dateFilter === 'all') return {};
    const now = new Date();
    const toDate = now.toISOString().slice(0, 10);
    if (dateFilter === 'today') return { start_date: toDate, end_date: toDate };
    if (dateFilter === 'last_7_days') {
      const from = new Date(now); from.setDate(now.getDate() - 6);
      return { start_date: from.toISOString().slice(0, 10), end_date: toDate };
    }
    if (dateFilter === 'last_30_days') {
      const from = new Date(now); from.setDate(now.getDate() - 29);
      return { start_date: from.toISOString().slice(0, 10), end_date: toDate };
    }
    return {};
  };

  const fetchFilters = async () => {
    try {
      const response = await adminApi.getAuditLogFilters();
      setAvailableActions(response.data.actions || []);
      setAvailableModules(response.data.modules || []);
    } catch {
      setAvailableActions([]);
      setAvailableModules([]);
    }
  };

  const buildFetchParams = (overrides?: { limit?: number; offset?: number }) => {
    const dateRange = getDateRange();
    return {
      limit: overrides?.limit ?? limit,
      offset: overrides?.offset ?? page * limit,
      action: actionFilter !== 'all' ? actionFilter : undefined,
      exclude_action: hideReads && actionFilter === 'all' ? 'read' : undefined,
      module: moduleFilter !== 'all' ? moduleFilter : undefined,
      start_date: dateRange.start_date,
      end_date: dateRange.end_date,
      actor_type: actorFilter !== 'all' ? actorFilter : undefined,
      search: debouncedSearch.trim() || undefined,
    };
  };

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const response = await adminApi.getAuditLogs(buildFetchParams());
      setLogs(response.data.logs);
      setTotal(response.data.total);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to load audit logs');
    } finally {
      setLoading(false);
    }
  };

  const handleExportCSV = async () => {
    try {
      setExporting(true);
      const response = await adminApi.getAuditLogs(buildFetchParams({ limit: 10000, offset: 0 }));
      const rows: AuditLogEntry[] = response.data.logs || [];
      const headers = ['ID', 'Timestamp', 'Actor', 'Actor Type', 'Action', 'Resource Type', 'Resource ID', 'Resource Name', 'Summary', 'IP Address'];
      const csvRows = [
        headers.join(','),
        ...rows.map((r) => [
          r.id,
          r.timestamp,
          `"${(r.user_name || '').replace(/"/g, '""')}"`,
          r.actor_type || 'user',
          r.action,
          r.resource_type,
          r.resource_id ?? '',
          `"${(r.resource_name || '').replace(/"/g, '""')}"`,
          `"${(r.summary || '').replace(/"/g, '""')}"`,
          r.ip_address || '',
        ].join(',')),
      ];
      const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError('Failed to export audit logs');
    } finally {
      setExporting(false);
    }
  };

  const formatTimestamp = (timestamp: string) => new Date(timestamp).toLocaleString();

  const columns = [
    {
      id: 'timestamp',
      header: 'Timestamp',
      accessor: (log: AuditLogEntry) => (
        <span className="text-slate-600 text-xs whitespace-nowrap">{formatTimestamp(log.timestamp)}</span>
      ),
    },
    {
      id: 'user',
      header: 'Actor',
      accessor: (log: AuditLogEntry) => (
        <div className="flex flex-col gap-0.5">
          <span className="text-black text-sm font-medium">{log.user_name}</span>
          {log.actor_type === 'workflow_engine' ? (
            <span className="text-[9px] px-1 py-0.5 bg-violet-100 text-violet-700 rounded font-semibold w-fit">Workflow Engine</span>
          ) : (
            <span className="text-[9px] px-1 py-0.5 bg-slate-100 text-slate-500 rounded font-semibold w-fit">User</span>
          )}
        </div>
      ),
    },
    {
      id: 'activity',
      header: 'Activity',
      accessor: (log: AuditLogEntry) => (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-black text-sm font-medium">
              {log.summary || formatActivity(log)}
            </span>
            {isWorkflowExecution(log) && (
              <span className="text-[9px] px-1 py-0.5 bg-violet-100 text-violet-700 rounded font-semibold">WF RUN</span>
            )}
            {log.resource_url && (
              <a
                href={log.resource_url}
                onClick={(e) => e.stopPropagation()}
                title="Open resource"
                className="shrink-0 text-indigo-400 hover:text-indigo-600 transition-colors"
              >
                <ExternalLink size={12} />
              </a>
            )}
          </div>
          {log.resource_name && (
            <span className="text-slate-500 text-xs font-medium">{log.resource_name}</span>
          )}
          {!log.summary && (
            <span className="text-slate-400 text-xs truncate max-w-[280px]" title={log.path || ''}>
              {log.method} {log.path}
            </span>
          )}
        </div>
      ),
    },
    {
      id: 'action',
      header: 'Action',
      accessor: (log: AuditLogEntry) => (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${getActionColor(log.action)}`}>
          {log.action}
        </span>
      ),
    },
    {
      id: 'resource',
      header: 'Resource',
      accessor: (log: AuditLogEntry) => (
        <div className="flex flex-col gap-0.5">
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium w-fit ${getResourceBadge(log.resource_type)}`}>
            {log.resource_type}
          </span>
          {log.resource_id && <span className="text-slate-400 text-xs">#{log.resource_id}</span>}
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      accessor: (log: AuditLogEntry) => (
        <div className="text-xs">
          <div className={`font-semibold ${(log.status_code || 0) >= 400 ? 'text-red-600' : 'text-green-700'}`}>
            {log.status_code || '-'}
          </div>
          <div className="text-slate-400">{log.duration_ms != null ? `${log.duration_ms} ms` : '-'}</div>
        </div>
      ),
    },
    {
      id: 'details',
      header: 'Details',
      accessor: (log: AuditLogEntry) => (
        <button
          type="button"
          onClick={() => { setSelectedLog(log); setSelectedWfName(null); setShowRawJson(false); }}
          className="rounded border border-primary-200 bg-primary-50 px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-100"
        >
          View
        </button>
      ),
    },
  ];

  const actionItems = availableActions.filter((a) => !hideReads || a !== 'read').map((action) => ({ value: action, label: action }));
  const moduleItems = availableModules.map((module) => ({ value: module, label: module }));
  const dateItems = [
    { value: 'today', label: 'Today' },
    { value: 'last_7_days', label: 'Last 7 Days' },
    { value: 'last_30_days', label: 'Last 30 Days' },
  ];
  const actorItems = [
    { value: 'user', label: 'User' },
    { value: 'workflow_engine', label: 'Workflow Engine' },
  ];
  const handleSingleApply = (setter: (v: string) => void) => (values: string[]) => { setPage(0); setter(values[0] || 'all'); };

  if (loading && logs.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500" />
      </div>
    );
  }

  const requestBody = selectedLog?.details?.request as Record<string, unknown> | null | undefined;
  const hasRequestBody = requestBody && Object.keys(requestBody).length > 0;
  const selectedIsExecution = selectedLog ? isWorkflowExecution(selectedLog) : false;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-semibold text-black tracking-tight">Audit Logs</h1>
          <p className="mt-1 text-sm text-slate-600">Track all user and system actions across the platform</p>
        </div>
        <button
          onClick={handleExportCSV}
          disabled={exporting}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          {exporting ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          Export CSV
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Search input */}
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search logs…"
            className="pl-8 pr-3 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-black placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-primary-400 w-44"
          />
        </div>

        <MultiSelectDropdown title="Action" items={actionItems} selectedValues={actionFilter !== 'all' ? [actionFilter] : []} onApply={handleSingleApply(setActionFilter)} multiSelect={false} autoApply placeholder="All Actions" size="md" />
        <MultiSelectDropdown title="Module" items={moduleItems} selectedValues={moduleFilter !== 'all' ? [moduleFilter] : []} onApply={handleSingleApply(setModuleFilter)} multiSelect={false} autoApply placeholder="All Modules" size="md" />
        <MultiSelectDropdown title="Date" items={dateItems} selectedValues={dateFilter !== 'all' ? [dateFilter] : []} onApply={handleSingleApply(setDateFilter)} multiSelect={false} autoApply placeholder="All Dates" size="md" />
        <MultiSelectDropdown title="Actor" items={actorItems} selectedValues={actorFilter !== 'all' ? [actorFilter] : []} onApply={handleSingleApply(setActorFilter)} multiSelect={false} autoApply placeholder="All Actors" size="md" />

        <label className="flex items-center gap-2 ml-auto cursor-pointer select-none">
          <div onClick={() => { setPage(0); setHideReads((v) => !v); }} className={`relative w-8 h-4 rounded-full transition-colors ${hideReads ? 'bg-primary-500' : 'bg-slate-300'}`}>
            <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${hideReads ? 'translate-x-4' : ''}`} />
          </div>
          <span className="text-xs text-slate-600">Hide system reads</span>
        </label>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-500/50 rounded-lg p-4 text-red-600">
          {error}
          <button onClick={() => setError(null)} className="ml-4 underline">Dismiss</button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <DataTable data={logs} columns={columns} />
        {logs.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <svg className="h-10 w-10 mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-sm">No audit logs found for the selected filters</p>
          </div>
        )}
      </div>

      {total > limit && (
        <div className="flex items-center justify-between">
          <div className="text-sm text-slate-600">
            Showing {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}
          </div>
          <div className="flex space-x-2">
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-black rounded text-sm disabled:opacity-40 disabled:cursor-not-allowed">Previous</button>
            <button onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * limit >= total} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-black rounded text-sm disabled:opacity-40 disabled:cursor-not-allowed">Next</button>
          </div>
        </div>
      )}

      {selectedLog !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSelectedLog(null)}>
          <div className="w-full max-w-2xl max-h-[90vh] overflow-hidden rounded-xl bg-white shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <div>
                <h3 className="text-sm font-semibold text-black">Audit Log Details</h3>
                {selectedIsExecution && (
                  <p className="text-[10px] text-violet-600 font-medium mt-0.5">Workflow Execution</p>
                )}
              </div>
              <button type="button" onClick={() => setSelectedLog(null)} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-black" aria-label="Close">
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>

            <div className="overflow-auto p-5 space-y-4">
              {/* AI-structured rendering of the audit row — replaces raw JSON
                  blocks like nodes_json/edges_json with readable sections.
                  Falls back to the template summary when AI is unavailable. */}
              <div className="bg-indigo-50/40 border border-indigo-100 rounded-lg px-4 py-3">
                <p className="text-[9px] text-indigo-500 mb-2 uppercase tracking-wide font-semibold">What happened</p>
                {aiSummaryLoading ? (
                  <p className="text-xs font-medium text-indigo-600 flex items-center gap-2">
                    <Loader2 size={12} className="animate-spin" />
                    Generating readable summary…
                  </p>
                ) : aiSummary ? (
                  <div className="prose prose-sm max-w-none prose-headings:font-semibold prose-headings:text-slate-800 prose-p:text-slate-700 prose-li:text-slate-700 prose-strong:text-slate-900 prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{aiSummary}</ReactMarkdown>
                  </div>
                ) : selectedLog.summary ? (
                  <p className="text-xs font-semibold text-indigo-800">{selectedLog.summary}</p>
                ) : (
                  <p className="text-xs text-slate-400 italic">No summary available.</p>
                )}
              </div>

              {/* Base fields always shown */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-[10px] text-slate-400 uppercase font-semibold mb-1">Activity</p>
                  <p className="text-sm text-black font-medium">
                    {selectedIsExecution && selectedWfName
                      ? `Executed Workflow "${selectedWfName}"`
                      : (selectedLog.summary || formatActivity(selectedLog))}
                  </p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-[10px] text-slate-400 uppercase font-semibold mb-1">Actor</p>
                  <p className="text-sm text-black font-medium">{selectedLog.user_name}</p>
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-semibold mt-0.5 inline-block ${selectedLog.actor_type === 'workflow_engine' ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-500'}`}>
                    {selectedLog.actor_type === 'workflow_engine' ? 'Workflow Engine' : 'User'}
                  </span>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-[10px] text-slate-400 uppercase font-semibold mb-1">Timestamp</p>
                  <p className="text-sm text-black">{formatTimestamp(selectedLog.timestamp)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-[10px] text-slate-400 uppercase font-semibold mb-1">Status</p>
                  {selectedLog.status_code ? (
                    <p className={`text-sm font-semibold ${(selectedLog.status_code || 0) >= 400 ? 'text-red-600' : 'text-green-700'}`}>
                      {selectedLog.status_code}&nbsp;
                      <span className="font-normal text-slate-500">{selectedLog.duration_ms != null ? `(${selectedLog.duration_ms} ms)` : ''}</span>
                    </p>
                  ) : (
                    <p className="text-sm text-green-700 font-semibold">Success</p>
                  )}
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-[10px] text-slate-400 uppercase font-semibold mb-1">Resource</p>
                  <p className="text-sm text-black">
                    {selectedLog.resource_name
                      ? <><span className="font-medium">{selectedLog.resource_name}</span><span className="text-slate-400 ml-1 text-xs">({selectedLog.resource_type}{selectedLog.resource_id ? ` #${selectedLog.resource_id}` : ''})</span></>
                      : <>{selectedLog.resource_type}{selectedLog.resource_id ? ` #${selectedLog.resource_id}` : ''}</>
                    }
                  </p>
                </div>
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-[10px] text-slate-400 uppercase font-semibold mb-1">IP Address</p>
                  <p className="text-sm text-black">{selectedLog.ip_address || '-'}</p>
                </div>
              </div>

              {selectedLog.path && (
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-[10px] text-slate-400 uppercase font-semibold mb-1">Endpoint</p>
                  <p className="text-sm font-mono text-black">
                    <span className="text-indigo-600 font-semibold">{selectedLog.method}</span>{' '}{selectedLog.path}
                  </p>
                </div>
              )}

              {selectedLog.resource_url && (
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-[10px] text-slate-400 uppercase font-semibold mb-1">Resource Link</p>
                  <a
                    href={selectedLog.resource_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-indigo-600 hover:underline break-all"
                  >
                    {selectedLog.resource_url}
                  </a>
                </div>
              )}

              {/* Field Changes — prefer server-computed field_diff, fall back to client-side diff */}
              {(() => {
                const fieldDiff = selectedLog.field_diff;
                if (fieldDiff && Object.keys(fieldDiff).length > 0) {
                  const entries = Object.entries(fieldDiff);
                  return (
                    <div>
                      <p className="text-[10px] text-slate-400 uppercase font-semibold mb-2">
                        Field Changes <span className="normal-case text-slate-400 font-normal ml-1">({entries.length} changed)</span>
                      </p>
                      <div className="rounded-lg border border-slate-200 overflow-hidden divide-y divide-slate-100">
                        {entries.map(([k, { old: oldVal, new: newVal }]) => (
                          <div key={k} className="flex items-start gap-0 px-3 py-2 bg-amber-50/40">
                            <span className="text-xs text-slate-500 font-medium w-36 shrink-0 pt-0.5 capitalize">{k.replace(/_/g, ' ')}</span>
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <span className="text-xs px-1.5 py-0.5 rounded max-w-[140px] truncate bg-red-50 text-red-700 line-through">
                                {oldVal == null ? '—' : typeof oldVal === 'object' ? JSON.stringify(oldVal) : String(oldVal)}
                              </span>
                              <span className="text-xs text-slate-300">→</span>
                              <span className="text-xs px-1.5 py-0.5 rounded max-w-[140px] truncate bg-green-50 text-green-700">
                                {newVal == null ? '—' : typeof newVal === 'object' ? JSON.stringify(newVal) : String(newVal)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                }
                // Fallback: client-side diff from before/after
                const before = (selectedLog.before || selectedLog.details?.before) as Record<string, unknown> | undefined;
                const after = (selectedLog.after || selectedLog.details?.after) as Record<string, unknown> | undefined;
                const allKeys = Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})]));
                const changedKeys = allKeys.filter((k) => String(before?.[k] ?? '') !== String(after?.[k] ?? ''));
                const displayKeys = changedKeys.length > 0 ? changedKeys : allKeys;
                if (!displayKeys.length) return null;
                return (
                  <div>
                    <p className="text-[10px] text-slate-400 uppercase font-semibold mb-2">
                      Field Changes {changedKeys.length > 0 && <span className="normal-case text-slate-400 font-normal ml-1">({changedKeys.length} changed)</span>}
                    </p>
                    <div className="rounded-lg border border-slate-200 overflow-hidden divide-y divide-slate-100">
                      {displayKeys.map((k) => {
                        const bVal = before?.[k];
                        const aVal = after?.[k];
                        const changed = before && after && String(bVal ?? '') !== String(aVal ?? '');
                        return (
                          <div key={k} className={`flex items-start gap-0 px-3 py-2 ${changed ? 'bg-amber-50/40' : 'bg-white'}`}>
                            <span className="text-xs text-slate-500 font-medium w-36 shrink-0 pt-0.5 capitalize">{k.replace(/_/g, ' ')}</span>
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              {before && k in before && (
                                <span className={`text-xs px-1.5 py-0.5 rounded max-w-[140px] truncate ${changed ? 'bg-red-50 text-red-700 line-through' : 'bg-slate-50 text-slate-600'}`}>
                                  {String(bVal ?? '—')}
                                </span>
                              )}
                              {after && k in after && (
                                <span className={`text-xs px-1.5 py-0.5 rounded max-w-[140px] truncate ${changed ? 'bg-green-50 text-green-700' : 'bg-slate-50 text-slate-600'}`}>
                                  {String(aVal ?? '—')}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* Snapshot — only shown when the AI structured view is unavailable.
                  When AI summary is present, the snapshot is already described in it,
                  so hiding the raw JSON block keeps the modal readable. */}
              {!aiSummary && selectedLog.snapshot && (() => {
                const snap = selectedLog.snapshot as Record<string, unknown>;
                const snapKeys = Object.keys(snap);
                if (!snapKeys.length) return null;
                const isDelete = selectedLog.action?.includes('delete');
                const isCreate = selectedLog.action?.includes('create');
                const snapLabel = isDelete ? 'Deleted Record Snapshot' : isCreate ? 'Created Record Snapshot' : 'Record Snapshot';
                const borderColor = isDelete ? 'border-red-100' : isCreate ? 'border-green-100' : 'border-slate-200';
                const rowBg = isDelete ? 'bg-red-50/30' : isCreate ? 'bg-green-50/20' : 'bg-slate-50/30';
                return (
                  <details className="group" open={isCreate}>
                    <summary className="cursor-pointer flex items-center gap-1.5 text-[10px] text-slate-400 uppercase font-semibold mb-1 select-none list-none">
                      <span className="transition-transform group-open:rotate-90">▶</span>
                      <span>{snapLabel}</span>
                    </summary>
                    <div className={`mt-2 rounded-lg border ${borderColor} overflow-hidden divide-y divide-slate-100`}>
                      {snapKeys.map((k) => {
                        const val = snap[k];
                        const isEmpty = val == null || (typeof val === 'object' && Object.keys(val as object).length === 0);
                        const display = val == null
                          ? '—'
                          : typeof val === 'object'
                            ? (isEmpty ? '—' : JSON.stringify(val, null, 2))
                            : String(val);
                        return (
                          <div key={k} className={`flex items-start px-3 py-1.5 ${rowBg}`}>
                            <span className="text-xs text-slate-500 font-medium w-36 shrink-0 pt-0.5 capitalize">{k.replace(/_/g, ' ')}</span>
                            {typeof val === 'object' && !isEmpty
                              ? <pre className="text-[11px] text-slate-700 break-all whitespace-pre-wrap font-mono flex-1 min-w-0">{display}</pre>
                              : <span className="text-xs text-slate-700 break-all">{display}</span>
                            }
                          </div>
                        );
                      })}
                    </div>
                  </details>
                );
              })()}

              {/* Workflow execution: rich panel */}
              {selectedIsExecution ? (
                <div>
                  <p className="text-[10px] text-slate-400 uppercase font-semibold mb-2">Workflow Execution Details</p>
                  <WorkflowExecutionPanel log={selectedLog} onNameLoaded={setSelectedWfName} />
                </div>
              ) : (
                // Only show the raw Request Data table when AI structured view is
                // unavailable — otherwise the same info is in the AI rendering above.
                !aiSummary && hasRequestBody && (
                  <div>
                    <p className="text-[10px] text-slate-400 uppercase font-semibold mb-2">Request Data</p>
                    <div className="bg-slate-50 rounded-lg border border-slate-200 divide-y divide-slate-100">
                      {Object.entries(requestBody as Record<string, unknown>)
                        .filter(([k]) => !['password', 'token', 'secret'].includes(k))
                        .map(([key, val]) => (
                          <div key={key} className="flex items-start gap-3 px-3 py-2">
                            <span className="text-xs text-slate-500 font-medium w-36 shrink-0 pt-0.5">{key}</span>
                            <span className="text-xs text-black break-all">{typeof val === 'object' ? JSON.stringify(val) : String(val ?? '-')}</span>
                          </div>
                        ))}
                    </div>
                  </div>
                )
              )}

              <div className="flex justify-end">
                <button type="button" onClick={() => setShowRawJson((v) => !v)} className="text-xs text-slate-400 hover:text-slate-600 underline">
                  {showRawJson ? 'Hide raw JSON' : 'Show raw JSON'}
                </button>
              </div>

              {showRawJson && (
                <pre className="text-xs bg-slate-50 border border-slate-200 rounded p-3 text-black whitespace-pre-wrap break-words">
                  {JSON.stringify(selectedLog.details, null, 2)}
                </pre>
              )}
            </div>

            <div className="flex justify-end border-t border-slate-200 px-5 py-3">
              <button type="button" onClick={() => setSelectedLog(null)} className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-700 hover:bg-slate-200">
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
