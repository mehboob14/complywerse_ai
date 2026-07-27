'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'wouter'
import { useRouter } from '@/lib/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { criticalTasksApi, risksApi, ermApi, vulnManagementApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { Link } from 'wouter';
import {
  ArrowLeft, CheckCircle2, Plus, X,
  Send, Trash2, Pencil, Loader2,
  Sparkles, FileText, Shield, ShieldCheck, ShieldX, RefreshCw,
} from 'lucide-react';

interface TaskUser {
  id: number;
  username?: string | null;
  display_name: string | null;
  email: string;
}

interface SubTask {
  id: number;
  title: string;
  status: string;
  assigned_owner_id: number | null;
  assigned_owner: TaskUser | null;
  due_date: string | null;
  completed_at: string | null;
  created_at: string | null;
}

interface TaskComment {
  id: number;
  content: string;
  user: TaskUser | null;
  created_at: string | null;
}

interface TaskHistoryEntry {
  id: number;
  action: string;
  field_changed: string | null;
  old_value: string | null;
  new_value: string | null;
  user: TaskUser | null;
  created_at: string | null;
}

interface CriticalTaskDetail {
  id: number;
  tenant_id: number;
  title: string;
  description: string | null;
  source: string;
  source_module: string | null;
  source_entity_id: number | null;
  source_entity_type: string | null;
  priority: string;
  severity: string | null;
  status: string;
  category: string;
  assigned_owner_id: number | null;
  reviewer_id: number | null;
  created_by_id: number | null;
  due_date: string | null;
  sla_days: number | null;
  sla_status: string;
  escalation_level: number;
  linked_risk_id: number | null;
  linked_control_id: number | null;
  linked_finding_id: number | null;
  linked_vulnerability_id: number | null;
  evidence_notes: string | null;
  completed_at: string | null;
  verified_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  assigned_owner: TaskUser | null;
  reviewer: TaskUser | null;
  created_by: TaskUser | null;
  sub_tasks: SubTask[];
  comments: TaskComment[];
  history: TaskHistoryEntry[];
  recurrence_pattern: string | null;
  recurrence_interval: number | null;
  approval_required: boolean;
  approval_status: string | null;
  approved_by_id: number | null;
  approved_at: string | null;
  approved_by: TaskUser | null;
  approvals?: Array<{
    id: number;
    action: string;
    comment: string | null;
    user: TaskUser | null;
    created_at: string | null;
  }>;
}

const PRIORITY_COLORS: Record<string, string> = {
  Critical: 'bg-red-50 text-red-700 border-red-200',
  High: 'bg-orange-50 text-orange-700 border-orange-200',
  Medium: 'bg-amber-50 text-amber-700 border-amber-200',
  Low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

const STATUS_COLORS: Record<string, string> = {
  Open: 'bg-blue-50 text-blue-700 border-blue-200',
  'In Progress': 'bg-amber-50 text-amber-700 border-amber-200',
  'Under Review': 'bg-purple-50 text-purple-700 border-purple-200',
  Completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  Verified: 'bg-green-50 text-green-700 border-green-200',
  Reopened: 'bg-red-50 text-red-700 border-red-200',
};

const SLA_COLORS: Record<string, string> = {
  'On Track': 'text-emerald-700 bg-emerald-50 border-emerald-200',
  'At Risk': 'text-amber-700 bg-amber-50 border-amber-200',
  Breached: 'text-red-700 bg-red-50 border-red-200',
  Completed: 'text-slate-600 bg-slate-100 border-slate-200',
  'No SLA': 'text-slate-600 bg-slate-100 border-slate-200',
};

const VALID_TRANSITIONS: Record<string, string[]> = {
  Open: ['In Progress'],
  'In Progress': ['Under Review', 'Open'],
  'Under Review': ['Completed', 'In Progress', 'Reopened'],
  Completed: ['Verified', 'Reopened'],
  Verified: ['Reopened'],
  Reopened: ['In Progress'],
};

const SOURCES = ['Audit', 'Risk', 'Compliance', 'Vulnerability', 'Manual'];
const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
const CATEGORIES = ['Remediation', 'Implementation', 'Review', 'Reporting', 'Other'];
const SOURCE_MODULES = ['Audit Findings', 'Risk Register', 'Compliance Assessment', 'Vulnerability Scan', 'Manual'];

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { hasPermission } = usePermissions();
  const canEdit = hasPermission('tasks:task_management:edit');
  const canDelete = hasPermission('tasks:task_management:delete');
  const taskId = Number(params.id);

  const [activeTab, setActiveTab] = useState<'details' | 'subtasks' | 'comments' | 'evidence' | 'history'>('details');
  const [commentText, setCommentText] = useState('');
  const [newSubTask, setNewSubTask] = useState('');
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState<Record<string, string | number | null>>({});
  const [transitionComment, setTransitionComment] = useState('');
  const [users, setUsers] = useState<TaskUser[]>([]);
  const [riskOptions, setRiskOptions] = useState<Array<{ id: number; label: string }>>([]);
  const [controlOptions, setControlOptions] = useState<Array<{ id: number; label: string }>>([]);
  const [vulnOptions, setVulnOptions] = useState<Array<{ id: number; label: string }>>([]);
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiRootCause, setAiRootCause] = useState<Record<string, unknown> | null>(null);
  const [aiDescription, setAiDescription] = useState<Record<string, unknown> | null>(null);
  const [approvalComment, setApprovalComment] = useState('');

  useEffect(() => {
    criticalTasksApi.getTenantUsers().then(r => setUsers(r.data || [])).catch(() => setUsers([]));
  }, []);

  useEffect(() => {
    let active = true;
    const normalizeList = (value: unknown): Record<string, unknown>[] => {
      if (Array.isArray(value)) return value as Record<string, unknown>[];
      const maybeItems = (value as Record<string, unknown> | undefined)?.items;
      return Array.isArray(maybeItems) ? (maybeItems as Record<string, unknown>[]) : [];
    };

    Promise.all([
      risksApi.getAll().then(r => normalizeList(r.data)).catch(() => []),
      ermApi.internalControls.getAll().then(r => normalizeList(r.data)).catch(() => []),
      vulnManagementApi.vulnerabilities.getAll().then(r => normalizeList(r.data)).catch(() => []),
    ]).then(([risks, controls, vulnerabilities]) => {
      if (!active) return;
      setRiskOptions(
        risks
          .map((r) => {
            const id = Number(r.id);
            if (!id) return null;
            const label = String(r.title || r.name || r.risk_event || r.risk_description || `Risk #${id}`);
            return { id, label };
          })
          .filter(Boolean) as Array<{ id: number; label: string }>
      );
      setControlOptions(
        controls
          .map((c) => {
            const id = Number(c.id);
            if (!id) return null;
            const base = String(c.name || c.control_name || c.title || `Control #${id}`);
            const code = c.control_id ? `${String(c.control_id)} - ` : '';
            return { id, label: `${code}${base}` };
          })
          .filter(Boolean) as Array<{ id: number; label: string }>
      );
      setVulnOptions(
        vulnerabilities
          .map((v) => {
            const id = Number(v.id);
            if (!id) return null;
            const label = String(v.title || v.vulnerability_name || v.cve_id || `Vulnerability #${id}`);
            return { id, label };
          })
          .filter(Boolean) as Array<{ id: number; label: string }>
      );
    });

    return () => {
      active = false;
    };
  }, []);

  const { data: task, isLoading } = useQuery<CriticalTaskDetail>({
    queryKey: ['critical-task', taskId],
    queryFn: async () => {
      const res = await criticalTasksApi.get(taskId);
      return res.data;
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => criticalTasksApi.update(taskId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['critical-task', taskId] });
      setEditing(false);
    },
  });

  const transitionMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => criticalTasksApi.transition(taskId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['critical-task', taskId] });
      setTransitionComment('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => criticalTasksApi.delete(taskId),
    onSuccess: () => router.push('/tasks'),
  });

  const commentMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => criticalTasksApi.addComment(taskId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['critical-task', taskId] });
      setCommentText('');
    },
  });

  const subTaskMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => criticalTasksApi.createSubTask(taskId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['critical-task', taskId] });
      setNewSubTask('');
    },
  });

  const subTaskUpdateMutation = useMutation({
    mutationFn: ({ subId, data }: { subId: number; data: Record<string, unknown> }) =>
      criticalTasksApi.updateSubTask(taskId, subId, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['critical-task', taskId] }),
  });

  const subTaskDeleteMutation = useMutation({
    mutationFn: (subId: number) => criticalTasksApi.deleteSubTask(taskId, subId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['critical-task', taskId] }),
  });

  const approvalMutation = useMutation({
    mutationFn: ({ action, comment }: { action: string; comment: string }) => {
      if (action === 'request') return criticalTasksApi.requestApproval(taskId, { comment });
      if (action === 'approve') return criticalTasksApi.approveTask(taskId, { comment });
      return criticalTasksApi.rejectTask(taskId, { comment });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['critical-task', taskId] });
      setApprovalComment('');
    },
  });

  const handleAiRootCause = async () => {
    setAiLoading('root-cause');
    try {
      const res = await criticalTasksApi.aiRootCause(taskId);
      setAiRootCause(res.data?.analysis || res.data);
    } catch { /* handled */ }
    setAiLoading(null);
  };

  const handleAiDescription = async () => {
    setAiLoading('description');
    try {
      const res = await criticalTasksApi.aiGenerateDescription({
        title: task?.title || '',
        context: task?.description || '',
        category: task?.category || '',
        source: task?.source || '',
      });
      setAiDescription(res.data?.description || res.data);
    } catch { /* handled */ }
    setAiLoading(null);
  };

  const startEdit = () => {
    if (!task) return;
    setEditForm({
      title: task.title,
      description: task.description || '',
      source: task.source,
      priority: task.priority,
      category: task.category,
      severity: task.severity || '',
      assigned_owner_id: task.assigned_owner_id ? String(task.assigned_owner_id) : '',
      reviewer_id: task.reviewer_id ? String(task.reviewer_id) : '',
      due_date: task.due_date ? task.due_date.split('T')[0] : '',
      sla_days: task.sla_days ? String(task.sla_days) : '',
      evidence_notes: task.evidence_notes || '',
      source_module: task.source_module || '',
      source_entity_type: task.source_entity_type || '',
      linked_risk_id: task.linked_risk_id ? String(task.linked_risk_id) : '',
      linked_control_id: task.linked_control_id ? String(task.linked_control_id) : '',
      linked_vulnerability_id: task.linked_vulnerability_id ? String(task.linked_vulnerability_id) : '',
    });
    setEditing(true);
  };

  const saveEdit = () => {
    const payload: Record<string, unknown> = { ...editForm };
    if (payload.assigned_owner_id) payload.assigned_owner_id = Number(payload.assigned_owner_id);
    else payload.assigned_owner_id = null;
    if (payload.reviewer_id) payload.reviewer_id = Number(payload.reviewer_id);
    else payload.reviewer_id = null;
    if (payload.sla_days) payload.sla_days = Number(payload.sla_days);
    else payload.sla_days = null;
    if (payload.linked_risk_id) payload.linked_risk_id = Number(payload.linked_risk_id);
    else payload.linked_risk_id = null;
    if (payload.linked_control_id) payload.linked_control_id = Number(payload.linked_control_id);
    else payload.linked_control_id = null;
    if (payload.linked_vulnerability_id) payload.linked_vulnerability_id = Number(payload.linked_vulnerability_id);
    else payload.linked_vulnerability_id = null;
    if (!payload.severity) payload.severity = null;
    if (!payload.source_module) payload.source_module = null;
    if (!payload.source_entity_type) payload.source_entity_type = null;
    if (!payload.due_date) payload.due_date = null;
    if (!payload.evidence_notes) payload.evidence_notes = null;
    updateMutation.mutate(payload);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-blue-600" size={32} />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="text-center py-20">
        <p className="text-[var(--color-muted)]">Task not found</p>
        <Link href="/tasks" className="text-blue-600 hover:text-blue-700 mt-2 inline-block">Back to Task Board</Link>
      </div>
    );
  }

  const allowedTransitions = VALID_TRANSITIONS[task.status] || [];

  return (
    <div className="space-y-6 text-[var(--color-text)]">
      <div className="flex items-center gap-4">
        <Link href="/tasks" className="cw-btn-secondary rounded-lg p-2">
          <ArrowLeft size={18} />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-[var(--color-text)]">{task.title}</h1>
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[task.priority] || ''}`}>
              {task.priority}
            </span>
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[task.status] || ''}`}>
              {task.status}
            </span>
          </div>
          <p className="text-sm text-[var(--color-muted)] mt-1">
            Task #{task.id} · {task.source} · {task.category}
            {task.source_module && <span className="text-blue-600/70"> · via {task.source_module}</span>}
            {task.escalation_level > 0 && <span className="text-red-600"> · Escalation Level {task.escalation_level}</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={handleAiRootCause} disabled={aiLoading === 'root-cause'}
            className="flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-sm text-purple-700 hover:bg-purple-100 disabled:opacity-50">
            {aiLoading === 'root-cause' ? <Loader2 className="animate-spin" size={14} /> : <Sparkles size={14} />} Root Cause
          </button>
          <button onClick={handleAiDescription} disabled={aiLoading === 'description'}
            className="flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-sm text-purple-700 hover:bg-purple-100 disabled:opacity-50">
            {aiLoading === 'description' ? <Loader2 className="animate-spin" size={14} /> : <FileText size={14} />} AI Description
          </button>
          {canEdit && <button onClick={startEdit} className="cw-btn-secondary flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm">
            <Pencil size={14} /> Edit
          </button>}
          {canDelete && <button onClick={() => { if (confirm('Delete this task?')) deleteMutation.mutate(); }}
            className="cw-btn-danger flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm">
            <Trash2 size={14} /> Delete
          </button>}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <div className={`rounded-lg border p-3 ${SLA_COLORS[task.sla_status] || ''}`}>
          <div className="text-xs font-medium opacity-70">SLA Status</div>
          <div className="text-lg font-semibold">{task.sla_status}</div>
          {task.due_date && <div className="text-xs opacity-70 mt-1">Due: {new Date(task.due_date).toLocaleDateString()}</div>}
        </div>
        <div className="cw-card p-3">
          <div className="text-xs font-medium text-[var(--color-muted)]">Owner</div>
          <div className="text-sm text-[var(--color-text)] font-medium mt-1">{task.assigned_owner?.display_name || task.assigned_owner?.username || 'Unassigned'}</div>
        </div>
        <div className="cw-card p-3">
          <div className="text-xs font-medium text-[var(--color-muted)]">Reviewer</div>
          <div className="text-sm text-[var(--color-text)] font-medium mt-1">{task.reviewer?.display_name || task.reviewer?.username || 'None'}</div>
        </div>
        <div className="cw-card p-3">
          <div className="text-xs font-medium text-[var(--color-muted)]">Created</div>
          <div className="text-sm text-[var(--color-text)] font-medium mt-1">{task.created_at ? new Date(task.created_at).toLocaleDateString() : '—'}</div>
          <div className="text-xs text-[var(--color-muted)] mt-0.5">by {task.created_by?.display_name || task.created_by?.username || 'System'}</div>
        </div>
      </div>

      {allowedTransitions.length > 0 && (
        <div className="cw-card p-4">
          <h3 className="text-sm font-medium text-[var(--color-text)] mb-3">Status Transitions</h3>
          <div className="flex items-center gap-3 flex-wrap">
            {allowedTransitions.map(status => (
              <button key={status}
                onClick={() => transitionMutation.mutate({ new_status: status, comment: transitionComment || undefined })}
                disabled={transitionMutation.isPending}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${STATUS_COLORS[status]} hover:opacity-80`}>
                {status}
              </button>
            ))}
            <input type="text" value={transitionComment} onChange={e => setTransitionComment(e.target.value)}
              placeholder="Optional transition comment..."
              className="cw-field flex-1 min-w-[200px] px-3 py-1.5 text-sm" />
          </div>
        </div>
      )}

      {task.approval_required && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-amber-700 flex items-center gap-2"><Shield size={14} /> Approval Workflow</h3>
            <span className={`text-xs px-2 py-0.5 rounded-full border ${
              task.approval_status === 'Approved' ? 'border-emerald-200 text-emerald-700 bg-emerald-50' :
              task.approval_status === 'Rejected' ? 'border-red-200 text-red-700 bg-red-50' :
              task.approval_status === 'Pending' ? 'border-amber-200 text-amber-700 bg-amber-50' :
              'border-[var(--color-border)] text-[var(--color-muted)] bg-[var(--color-subtle)]'
            }`}>{task.approval_status || 'Not Requested'}</span>
          </div>
          {task.approved_by && task.approved_at && (
            <p className="text-xs text-[var(--color-muted)] mb-3">
              {task.approval_status === 'Approved' ? 'Approved' : 'Reviewed'} by {task.approved_by.display_name || task.approved_by.username} on {new Date(task.approved_at).toLocaleString()}
            </p>
          )}
          <div className="flex items-center gap-2">
            <input type="text" value={approvalComment} onChange={e => setApprovalComment(e.target.value)}
              placeholder="Approval comment..."
              className="cw-field flex-1 px-3 py-1.5 text-sm" />
            {(!task.approval_status || task.approval_status === 'Rejected') && (
              <button onClick={() => approvalMutation.mutate({ action: 'request', comment: approvalComment })}
                disabled={approvalMutation.isPending}
                className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-sm text-amber-700 hover:bg-amber-100 disabled:opacity-50">
                <Shield size={14} /> {task.approval_status === 'Rejected' ? 'Re-Request' : 'Request'}
              </button>
            )}
            {task.approval_status === 'Pending' && (
              <>
                <button onClick={() => approvalMutation.mutate({ action: 'approve', comment: approvalComment })}
                  disabled={approvalMutation.isPending}
                  className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-700 disabled:opacity-50">
                  <ShieldCheck size={14} /> Approve
                </button>
                <button onClick={() => approvalMutation.mutate({ action: 'reject', comment: approvalComment })}
                  disabled={approvalMutation.isPending}
                  className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50">
                  <ShieldX size={14} /> Reject
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {task.recurrence_pattern && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 flex items-center gap-3">
          <RefreshCw size={16} className="text-blue-600" />
          <span className="text-sm text-blue-700">
            Recurring: every {task.recurrence_interval || 1} {task.recurrence_pattern}(s)
          </span>
        </div>
      )}

      <div className="border-b border-[var(--color-border)]">
        <nav className="flex gap-6">
          {(['details', 'subtasks', 'comments', 'evidence', 'history'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium transition-colors border-b-2 ${
                activeTab === tab ? 'border-blue-600 text-blue-700' : 'border-transparent text-[var(--color-muted)] hover:text-[var(--color-text)]'
              }`}>
              {tab === 'details' ? 'Details' : tab === 'subtasks' ? `Sub-tasks (${task.sub_tasks?.length || 0})` :
               tab === 'comments' ? `Comments (${task.comments?.length || 0})` : tab === 'evidence' ? 'Evidence' : 'History'}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'details' && (
        <div className="cw-card p-6 space-y-4">
          <div>
            <h3 className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wider mb-2">Description</h3>
            <p className="text-sm text-[var(--color-text)] whitespace-pre-wrap">{task.description || 'No description provided.'}</p>
          </div>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <h3 className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wider mb-2">Task Information</h3>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-[var(--color-muted)]">Source</dt><dd className="text-[var(--color-text)]">{task.source}</dd></div>
                <div className="flex justify-between"><dt className="text-[var(--color-muted)]">Source Module</dt><dd className="text-[var(--color-text)]">{task.source_module || '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-[var(--color-muted)]">Source Entity</dt><dd className="text-[var(--color-text)]">{task.source_entity_type ? `${task.source_entity_type} #${task.source_entity_id}` : '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-[var(--color-muted)]">Category</dt><dd className="text-[var(--color-text)]">{task.category}</dd></div>
                <div className="flex justify-between"><dt className="text-[var(--color-muted)]">Severity</dt><dd className="text-[var(--color-text)]">{task.severity || '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-[var(--color-muted)]">SLA Days</dt><dd className="text-[var(--color-text)]">{task.sla_days || '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-[var(--color-muted)]">Escalation Level</dt><dd className="text-[var(--color-text)]">{task.escalation_level}</dd></div>
              </dl>
            </div>
            <div>
              <h3 className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wider mb-2">Linked Entities</h3>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-[var(--color-muted)]">Risk</dt><dd className="text-[var(--color-text)]">{task.linked_risk_id ? `#${task.linked_risk_id}` : '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-[var(--color-muted)]">Control</dt><dd className="text-[var(--color-text)]">{task.linked_control_id ? `#${task.linked_control_id}` : '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-[var(--color-muted)]">Finding</dt><dd className="text-[var(--color-text)]">{task.linked_finding_id ? `#${task.linked_finding_id}` : '—'}</dd></div>
                <div className="flex justify-between"><dt className="text-[var(--color-muted)]">Vulnerability</dt><dd className="text-[var(--color-text)]">{task.linked_vulnerability_id ? `#${task.linked_vulnerability_id}` : '—'}</dd></div>
              </dl>
            </div>
          </div>
          {(task.completed_at || task.verified_at) && (
            <div>
              <h3 className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wider mb-2">Completion</h3>
              <dl className="space-y-2 text-sm">
                {task.completed_at && <div className="flex justify-between"><dt className="text-[var(--color-muted)]">Completed At</dt><dd className="text-[var(--color-text)]">{new Date(task.completed_at).toLocaleString()}</dd></div>}
                {task.verified_at && <div className="flex justify-between"><dt className="text-[var(--color-muted)]">Verified At</dt><dd className="text-[var(--color-text)]">{new Date(task.verified_at).toLocaleString()}</dd></div>}
              </dl>
            </div>
          )}
        </div>
      )}

      {activeTab === 'subtasks' && (
        <div className="cw-card p-6 space-y-4">
          <div className="flex items-center gap-2">
            <input type="text" value={newSubTask} onChange={e => setNewSubTask(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && newSubTask.trim()) subTaskMutation.mutate({ title: newSubTask.trim() }); }}
              placeholder="Add a sub-task..."
              className="cw-field flex-1 px-3 py-2 text-sm" />
            <button onClick={() => { if (newSubTask.trim()) subTaskMutation.mutate({ title: newSubTask.trim() }); }}
              disabled={!newSubTask.trim() || subTaskMutation.isPending}
              className="cw-btn-primary rounded-lg px-3 py-2 text-sm disabled:opacity-50">
              <Plus size={16} />
            </button>
          </div>
          {(task.sub_tasks || []).length === 0 ? (
            <p className="text-sm text-[var(--color-muted)] text-center py-6">No sub-tasks yet</p>
          ) : (
            <div className="space-y-2">
              {task.sub_tasks.map((st: SubTask) => (
                <div key={st.id} className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5">
                  <button onClick={() => subTaskUpdateMutation.mutate({
                    subId: st.id, data: { status: st.status === 'Completed' ? 'Open' : 'Completed' }
                  })}>
                    <CheckCircle2 size={18} className={st.status === 'Completed' ? 'text-emerald-600' : 'text-[var(--color-muted)]'} />
                  </button>
                  <span className={`flex-1 text-sm ${st.status === 'Completed' ? 'text-[var(--color-muted)] line-through' : 'text-[var(--color-text)]'}`}>
                    {st.title}
                  </span>
                  {st.assigned_owner && <span className="text-xs text-[var(--color-muted)]">{st.assigned_owner.display_name || st.assigned_owner.username}</span>}
                  {st.due_date && <span className="text-xs text-[var(--color-muted)]">{new Date(st.due_date).toLocaleDateString()}</span>}
                  {canDelete && <button onClick={() => subTaskDeleteMutation.mutate(st.id)} className="text-[var(--color-muted)] hover:text-red-600">
                    <Trash2 size={14} />
                  </button>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'comments' && (
        <div className="cw-card p-6 space-y-4">
          <div className="flex items-start gap-3">
            <textarea value={commentText} onChange={e => setCommentText(e.target.value)}
              placeholder="Add a comment..."
              className="cw-field flex-1 px-3 py-2 text-sm"
              rows={2} />
            <button onClick={() => { if (commentText.trim()) commentMutation.mutate({ content: commentText.trim() }); }}
              disabled={!commentText.trim() || commentMutation.isPending}
              className="cw-btn-primary rounded-lg px-3 py-2 disabled:opacity-50">
              <Send size={16} />
            </button>
          </div>
          {(task.comments || []).length === 0 ? (
            <p className="text-sm text-[var(--color-muted)] text-center py-6">No comments yet</p>
          ) : (
            <div className="space-y-3">
              {task.comments.map((c: TaskComment) => (
                <div key={c.id} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-[var(--color-text)]">{c.user?.display_name || c.user?.username || 'Unknown'}</span>
                    <span className="text-xs text-[var(--color-muted)]">{c.created_at ? new Date(c.created_at).toLocaleString() : ''}</span>
                  </div>
                  <p className="text-sm text-[var(--color-text)] whitespace-pre-wrap">{c.content}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'evidence' && (
        <div className="cw-card p-6">
          <h3 className="text-sm font-medium text-[var(--color-text)] mb-3">Evidence & Attachments</h3>
          <div className="text-sm text-[var(--color-text)] whitespace-pre-wrap">
            {task.evidence_notes || 'No evidence or notes attached to this task.'}
          </div>
        </div>
      )}

      {activeTab === 'history' && (
        <div className="cw-card p-6">
          {(task.history || []).length === 0 ? (
            <p className="text-sm text-[var(--color-muted)] text-center py-6">No history yet</p>
          ) : (
            <div className="space-y-3">
              {task.history.map((h: TaskHistoryEntry) => (
                <div key={h.id} className="flex items-start gap-3 text-sm">
                  <div className="mt-1 w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[var(--color-text)]">{h.action}</span>
                      {h.field_changed && <span className="text-[var(--color-muted)]">({h.field_changed})</span>}
                    </div>
                    {(h.old_value || h.new_value) && (
                      <p className="text-xs text-[var(--color-muted)] mt-0.5">
                        {h.old_value && <span className="line-through text-red-400/70">{h.old_value}</span>}
                        {h.old_value && h.new_value && <span className="mx-1">→</span>}
                        {h.new_value && <span className="text-emerald-400/70">{h.new_value}</span>}
                      </p>
                    )}
                    <p className="text-xs text-[var(--color-muted)] mt-0.5">
                      {h.user?.display_name || h.user?.username || 'System'} · {h.created_at ? new Date(h.created_at).toLocaleString() : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {aiRootCause && (
        <div className="rounded-lg border border-purple-200 bg-purple-50 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-purple-700 flex items-center gap-2"><Sparkles size={14} /> AI Root Cause Analysis</h3>
            <button onClick={() => setAiRootCause(null)} className="text-[var(--color-muted)] hover:text-[var(--color-text)]"><X size={16} /></button>
          </div>
          {(aiRootCause.summary as string) && (
            <p className="text-sm text-[var(--color-text)]">{aiRootCause.summary as string}</p>
          )}
          {(aiRootCause.root_causes as Array<Record<string, unknown>>)?.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wider mb-2">Root Causes</h4>
              <ul className="space-y-1">
                {(aiRootCause.root_causes as Array<Record<string, unknown>>).map((c, i: number) => (
                  <li key={i} className="text-sm text-[var(--color-text)] flex items-start gap-2">
                    <span className="text-purple-600 mt-0.5">•</span>
                    <span>{typeof c === 'string' ? c : (c.cause as string || JSON.stringify(c))}{c.category ? ` (${c.category})` : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(aiRootCause.remediation_actions as Array<Record<string, unknown>>)?.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wider mb-2">Remediation Actions</h4>
              <ul className="space-y-1">
                {(aiRootCause.remediation_actions as Array<Record<string, unknown>>).map((a, i: number) => (
                  <li key={i} className="text-sm text-[var(--color-text)] flex items-start gap-2">
                    <span className="text-emerald-600 mt-0.5">→</span>
                    <span>{typeof a === 'string' ? a : (a.action as string || JSON.stringify(a))}{a.priority ? ` [${a.priority}]` : ''}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {aiDescription && (
        <div className="rounded-lg border border-purple-200 bg-purple-50 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-purple-700 flex items-center gap-2"><FileText size={14} /> AI Generated Description</h3>
            <button onClick={() => setAiDescription(null)} className="text-[var(--color-muted)] hover:text-[var(--color-text)]"><X size={16} /></button>
          </div>
          {(aiDescription.summary as string) && (
            <div>
              <h4 className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wider mb-1">Summary</h4>
              <p className="text-sm text-[var(--color-text)]">{aiDescription.summary as string}</p>
            </div>
          )}
          {(aiDescription.detailed_description as string) && (
            <div>
              <h4 className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wider mb-1">Detailed Description</h4>
              <p className="text-sm text-[var(--color-text)] whitespace-pre-wrap">{aiDescription.detailed_description as string}</p>
            </div>
          )}
          {(aiDescription.acceptance_criteria as string[])?.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wider mb-2">Acceptance Criteria</h4>
              <ul className="space-y-1">
                {(aiDescription.acceptance_criteria as string[]).map((c: string, i: number) => (
                  <li key={i} className="text-sm text-[var(--color-text)] flex items-start gap-2">
                    <CheckCircle2 size={12} className="text-emerald-600 mt-0.5 shrink-0" /> {c}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(aiDescription.suggested_sub_tasks as string[])?.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-[var(--color-muted)] uppercase tracking-wider mb-2">Suggested Sub-tasks</h4>
              <ul className="space-y-1">
                {(aiDescription.suggested_sub_tasks as string[]).map((s: string, i: number) => (
                  <li key={i} className="text-sm text-[var(--color-text)] flex items-start gap-2">
                    <span className="text-blue-600 mt-0.5">○</span> {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button onClick={() => {
            if (aiDescription.detailed_description) {
              updateMutation.mutate({ description: aiDescription.detailed_description as string });
              setAiDescription(null);
            }
          }} className="flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-sm text-white hover:bg-purple-700">
            Apply Description to Task
          </button>
        </div>
      )}

      {editing && (
        <div className="fixed inset-0 z-50 flex items-center justify-center cw-overlay p-4">
          <div className="cw-modal-panel rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-[var(--color-text)]">Edit Task</h2>
              <button onClick={() => setEditing(false)} className="text-[var(--color-muted)] hover:text-[var(--color-text)]"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Title</label>
                <input type="text" value={editForm.title ?? ''} onChange={e => setEditForm(f => ({ ...f, title: e.target.value }))}
                  className="cw-field w-full px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Description</label>
                <textarea value={(editForm.description as string) ?? ''} onChange={e => setEditForm(f => ({ ...f, description: e.target.value }))}
                  className="cw-field w-full px-3 py-2 text-sm" rows={3} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Source</label>
                  <select value={(editForm.source as string) ?? ''} onChange={e => setEditForm(f => ({ ...f, source: e.target.value }))}
                    className="cw-field w-full px-3 py-2 text-sm">
                    {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Priority</label>
                  <select value={(editForm.priority as string) ?? ''} onChange={e => setEditForm(f => ({ ...f, priority: e.target.value }))}
                    className="cw-field w-full px-3 py-2 text-sm">
                    {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Category</label>
                  <select value={(editForm.category as string) ?? ''} onChange={e => setEditForm(f => ({ ...f, category: e.target.value }))}
                    className="cw-field w-full px-3 py-2 text-sm">
                    {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Severity</label>
                  <select value={(editForm.severity as string) ?? ''} onChange={e => setEditForm(f => ({ ...f, severity: e.target.value }))}
                    className="cw-field w-full px-3 py-2 text-sm">
                    <option value="">None</option>
                    <option value="Critical">Critical</option><option value="High">High</option>
                    <option value="Medium">Medium</option><option value="Low">Low</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Source Module</label>
                  <select value={(editForm.source_module as string) ?? ''} onChange={e => setEditForm(f => ({ ...f, source_module: e.target.value }))}
                    className="cw-field w-full px-3 py-2 text-sm">
                    <option value="">None</option>
                    {SOURCE_MODULES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Source Entity Type</label>
                  <select value={(editForm.source_entity_type as string) ?? ''} onChange={e => setEditForm(f => ({ ...f, source_entity_type: e.target.value }))}
                    className="cw-field w-full px-3 py-2 text-sm">
                    <option value="">None</option>
                    <option value="risk">Risk</option><option value="control">Control</option>
                    <option value="finding">Audit Finding</option><option value="vulnerability">Vulnerability</option>
                    <option value="compliance_gap">Compliance Gap</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Owner</label>
                  <select value={(editForm.assigned_owner_id as string) ?? ''} onChange={e => setEditForm(f => ({ ...f, assigned_owner_id: e.target.value }))}
                    className="cw-field w-full px-3 py-2 text-sm">
                    <option value="">Unassigned</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.display_name || u.username}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Reviewer</label>
                  <select value={(editForm.reviewer_id as string) ?? ''} onChange={e => setEditForm(f => ({ ...f, reviewer_id: e.target.value }))}
                    className="cw-field w-full px-3 py-2 text-sm">
                    <option value="">None</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.display_name || u.username}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Due Date</label>
                  <input type="date" value={(editForm.due_date as string) ?? ''} onChange={e => setEditForm(f => ({ ...f, due_date: e.target.value }))}
                    className="cw-field w-full px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-1">SLA Days</label>
                  <input type="number" value={(editForm.sla_days as string) ?? ''} onChange={e => setEditForm(f => ({ ...f, sla_days: e.target.value }))}
                    className="cw-field w-full px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Evidence / Notes</label>
                <textarea value={(editForm.evidence_notes as string) ?? ''} onChange={e => setEditForm(f => ({ ...f, evidence_notes: e.target.value }))}
                  className="cw-field w-full px-3 py-2 text-sm" rows={2} />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Risk</label>
                  <select value={(editForm.linked_risk_id as string) ?? ''} onChange={e => setEditForm(f => ({ ...f, linked_risk_id: e.target.value }))}
                    className="cw-field w-full px-3 py-2 text-sm">
                    <option value="">None</option>
                    {riskOptions.map((risk) => <option key={risk.id} value={risk.id}>{risk.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Internal Control</label>
                  <select value={(editForm.linked_control_id as string) ?? ''} onChange={e => setEditForm(f => ({ ...f, linked_control_id: e.target.value }))}
                    className="cw-field w-full px-3 py-2 text-sm">
                    <option value="">None</option>
                    {controlOptions.map((control) => <option key={control.id} value={control.id}>{control.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text)] mb-1">Vulnerability</label>
                  <select value={(editForm.linked_vulnerability_id as string) ?? ''} onChange={e => setEditForm(f => ({ ...f, linked_vulnerability_id: e.target.value }))}
                    className="cw-field w-full px-3 py-2 text-sm">
                    <option value="">None</option>
                    {vulnOptions.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button onClick={() => setEditing(false)} className="cw-btn-secondary px-4 py-2 text-sm">Cancel</button>
              <button onClick={saveEdit} disabled={updateMutation.isPending}
                className="cw-btn-primary flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
                {updateMutation.isPending && <Loader2 className="animate-spin" size={14} />}
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
