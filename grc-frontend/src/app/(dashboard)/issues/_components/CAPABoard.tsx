'use client';

// CAPA Board — cross-issue Kanban grouped by action status.
// Operators can Start / Complete / Verify inline, or open a detail panel
// to update assignee, due date, description, and status.

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  CheckCircle2, Clock, ShieldCheck, AlertOctagon, Ban, ListChecks, Loader2, X, Pencil, Plus,
} from 'lucide-react';
import { apiClient, issuesApi } from '@/lib/api';
import { formatDate, daysFromNow } from './shared';

interface ActionRow {
  id: number;
  issue_id: number;
  action_type: string;
  title: string;
  description?: string | null;
  status: string;
  assignee_id?: number | null;
  assignee_name: string | null;
  due_date: string | null;
  verified_at?: string | null;
  linked_critical_task_id?: number | null;
}

const COLUMNS: Array<{ id: string; label: string; icon: React.ElementType; accent: string }> = [
  { id: 'planned',     label: 'Planned',     icon: ListChecks,    accent: 'border-slate-200 bg-slate-50' },
  { id: 'in_progress', label: 'In Progress', icon: Clock,         accent: 'border-primary-200 bg-primary-50/40' },
  { id: 'blocked',     label: 'Blocked',     icon: AlertOctagon,  accent: 'border-amber-200 bg-amber-50/40' },
  { id: 'completed',   label: 'Completed',   icon: CheckCircle2,  accent: 'border-emerald-200 bg-emerald-50/40' },
  { id: 'verified',    label: 'Verified',    icon: ShieldCheck,   accent: 'border-emerald-300 bg-emerald-50/40' },
  { id: 'cancelled',   label: 'Cancelled',   icon: Ban,           accent: 'border-slate-200 bg-slate-100' },
];

const TYPE_TONE: Record<string, string> = {
  corrective:   'border-primary-200 bg-primary-50 text-primary-700',
  preventive:   'border-emerald-200 bg-emerald-50 text-emerald-700',
  containment:  'border-amber-200 bg-amber-50 text-amber-700',
  verification: 'border-slate-200 bg-slate-50 text-slate-700',
};

export function CAPABoard() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<ActionRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading } = useQuery<ActionRow[]>({
    queryKey: ['capa-actions'],
    queryFn: async () => (await issuesApi.actions.listAll()).data,
    staleTime: 15_000,
  });

  const { data: tenantUsers } = useQuery({
    queryKey: ['capa.tenant-users'],
    queryFn: async () => {
      const r = await apiClient.get<Array<{ id: number; display_name: string; email: string }>>('/assets/tenant-users');
      return r.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['capa-actions'] });
    qc.invalidateQueries({ queryKey: ['issues'] });
  };

  const verifyMutation = useMutation({
    mutationFn: (id: number) => issuesApi.actions.verify(id, {}),
    onSuccess: () => { setActionError(null); invalidate(); setSelected(null); },
    onError: (err: any) => setActionError(err?.response?.data?.detail || 'Verify failed'),
  });
  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      issuesApi.actions.patch(id, { status }),
    onSuccess: () => { setActionError(null); invalidate(); },
    onError: (err: any) => setActionError(err?.response?.data?.detail || 'Update failed'),
  });
  const patchMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      issuesApi.actions.patch(id, body),
    onSuccess: () => { setActionError(null); invalidate(); setSelected(null); },
    onError: (err: any) => setActionError(err?.response?.data?.detail || 'Save failed'),
  });
  const createMutation = useMutation({
    mutationFn: ({ issueId, body }: { issueId: number; body: Record<string, unknown> }) =>
      issuesApi.actions.create(issueId, body),
    onSuccess: () => { setActionError(null); invalidate(); setCreating(false); },
    onError: (err: any) => setActionError(err?.response?.data?.detail || 'Create failed'),
  });

  if (isLoading) {
    return (
      <div className="flex h-[200px] items-center justify-center text-slate-400 gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading CAPA actions…
      </div>
    );
  }

  const actions = data || [];
  const byStatus = COLUMNS.reduce<Record<string, ActionRow[]>>((acc, c) => {
    acc[c.id] = actions.filter((a) => a.status === c.id);
    return acc;
  }, {});

  return (
    <div className="space-y-2">
      {actionError && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {actionError}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-500">
          {actions.length} CAPA action{actions.length === 1 ? '' : 's'} across issues
        </p>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-2.5 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-700"
        >
          <Plus className="h-3.5 w-3.5" /> New action
        </button>
      </div>
      {actions.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white py-10 text-center">
          <ListChecks className="mb-2 h-7 w-7 text-slate-300" />
          <h3 className="text-sm font-semibold text-slate-700">No CAPA actions yet</h3>
          <p className="mt-1 max-w-sm text-xs text-slate-500">
            Create one directly with “New action”, or open an Issue and add a corrective / preventive action.
            Auto-generated issues also receive an initial CAPA you can manage here.
          </p>
        </div>
      ) : (
      <div className="grid gap-2 lg:grid-cols-3 xl:grid-cols-6">
        {COLUMNS.map((col) => {
          const Icon = col.icon;
          const items = byStatus[col.id] || [];
          return (
            <div key={col.id} className={`rounded-xl border ${col.accent} flex flex-col min-h-[200px]`}>
              <div className="flex items-center gap-1.5 border-b border-slate-200 px-3 py-1.5">
                <Icon className="h-3.5 w-3.5 text-slate-600" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-700">{col.label}</span>
                <span className="ml-auto rounded bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-700 border border-slate-200">{items.length}</span>
              </div>
              <div className="p-2 space-y-1.5 overflow-y-auto max-h-[420px]">
                {items.map((a) => {
                  const days = daysFromNow(a.due_date);
                  const overdue = days != null && days < 0 && !['completed', 'verified', 'cancelled'].includes(a.status);
                  return (
                    <div key={a.id} className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm">
                      <div className="flex items-center gap-1 mb-1">
                        <span className={`rounded border px-1 py-px text-[9px] font-medium uppercase ${TYPE_TONE[a.action_type] || 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                          {a.action_type}
                        </span>
                        <Link href={`/issues/${a.issue_id}`} className="ml-auto text-[10px] font-semibold text-slate-500 hover:text-primary-700">
                          #{a.issue_id}
                        </Link>
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelected(a)}
                        className="block w-full text-left text-xs font-medium text-slate-900 line-clamp-2 hover:text-primary-700"
                        title="Open to update this action"
                      >
                        {a.title}
                      </button>
                      <div className="mt-1.5 flex items-center justify-between text-[10px]">
                        <span className="text-slate-500 truncate">{a.assignee_name || 'Unassigned'}</span>
                        {a.due_date && (
                          <span className={overdue ? 'text-rose-700 font-semibold' : 'text-slate-500'}>
                            {formatDate(a.due_date)}
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex gap-1">
                        {col.id === 'planned' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              updateStatusMutation.mutate({ id: a.id, status: 'in_progress' });
                            }}
                            disabled={updateStatusMutation.isPending}
                            className="flex-1 rounded border border-primary-200 bg-white px-2 py-1 text-[10px] font-medium text-primary-700 hover:bg-primary-50 disabled:opacity-50"
                          >
                            Start
                          </button>
                        )}
                        {col.id === 'in_progress' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              updateStatusMutation.mutate({ id: a.id, status: 'completed' });
                            }}
                            disabled={updateStatusMutation.isPending}
                            className="flex-1 rounded border border-emerald-200 bg-white px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                          >
                            Mark Complete
                          </button>
                        )}
                        {col.id === 'completed' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              verifyMutation.mutate(a.id);
                            }}
                            disabled={verifyMutation.isPending}
                            className="flex-1 rounded border border-emerald-300 bg-white px-2 py-1 text-[10px] font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                          >
                            Verify
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setSelected(a)}
                          className="inline-flex items-center justify-center rounded border border-slate-200 bg-white px-1.5 py-1 text-slate-500 hover:bg-slate-50"
                          title="Edit / update"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  );
                })}
                {items.length === 0 && (
                  <p className="px-1 py-2 text-[10px] text-slate-400 text-center">—</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
      )}

      {selected && (
        <BoardActionEditor
          action={selected}
          tenantUsers={tenantUsers || []}
          onClose={() => setSelected(null)}
          isSaving={patchMutation.isPending}
          onSave={(body) => patchMutation.mutate({ id: selected.id, body })}
        />
      )}
      {creating && (
        <NewActionModal
          tenantUsers={tenantUsers || []}
          onClose={() => setCreating(false)}
          isSaving={createMutation.isPending}
          onCreate={(issueId, body) => createMutation.mutate({ issueId, body })}
        />
      )}
    </div>
  );
}

function BoardActionEditor({
  action,
  tenantUsers,
  onClose,
  onSave,
  isSaving,
}: {
  action: ActionRow;
  tenantUsers: Array<{ id: number; display_name: string; email: string }>;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => void;
  isSaving: boolean;
}) {
  const [status, setStatus] = useState(action.status);
  const [assigneeId, setAssigneeId] = useState(action.assignee_id ? String(action.assignee_id) : '');
  const [dueDate, setDueDate] = useState(
    action.due_date ? new Date(action.due_date).toISOString().slice(0, 10) : '',
  );
  const [description, setDescription] = useState(action.description ?? '');
  const [title, setTitle] = useState(action.title);

  const modal = (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-3">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Update CAPA action</p>
            <p className="text-sm font-semibold text-slate-900">#{action.id} · Issue {action.issue_id}</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3 px-4 py-3">
          <div>
            <label className="mb-1 block text-[10px] font-medium text-slate-600">Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[10px] font-medium text-slate-600">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs">
                <option value="planned">Planned</option>
                <option value="in_progress">In Progress</option>
                <option value="blocked">Blocked</option>
                <option value="completed">Completed</option>
                <option value="verified">Verified</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-medium text-slate-600">Due date</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-medium text-slate-600">Assignee</label>
            <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs">
              <option value="">— Unassigned —</option>
              {tenantUsers.map((u) => (
                <option key={u.id} value={u.id}>{u.display_name}{u.email ? ` (${u.email})` : ''}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-medium text-slate-600">Notes</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs resize-none" />
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5">
          <Link href={`/issues/${action.issue_id}`} className="text-[11px] font-medium text-primary-700 hover:underline">
            Open parent issue →
          </Link>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100">Cancel</button>
            <button
              type="button"
              disabled={!title.trim() || isSaving}
              onClick={() => onSave({
                title: title.trim(),
                status,
                description: description || null,
                assignee_id: assigneeId ? Number(assigneeId) : null,
                due_date: dueDate ? new Date(`${dueDate}T00:00:00Z`).toISOString() : null,
              })}
              className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-700 disabled:bg-slate-300"
            >
              {isSaving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return modal;
  return createPortal(modal, document.body);
}

// Create a CAPA action directly from the board. Because every action is tracked
// under an issue, the operator picks the parent issue here rather than opening it.
function NewActionModal({
  tenantUsers,
  onClose,
  onCreate,
  isSaving,
}: {
  tenantUsers: Array<{ id: number; display_name: string; email: string }>;
  onClose: () => void;
  onCreate: (issueId: number, body: Record<string, unknown>) => void;
  isSaving: boolean;
}) {
  const [issueId, setIssueId] = useState('');
  const [actionType, setActionType] = useState('corrective');
  const [title, setTitle] = useState('');
  const [status, setStatus] = useState('planned');
  const [assigneeId, setAssigneeId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [description, setDescription] = useState('');

  const { data: issues, isLoading: issuesLoading } = useQuery({
    queryKey: ['capa.issues-for-picker'],
    queryFn: async () => {
      const r = await issuesApi.list({ limit: 500, sort_by: 'created_at', sort_order: 'desc' });
      return (r.data as { items?: Array<{ id: number; code: string | null; title: string }> }).items || [];
    },
    staleTime: 60_000,
  });

  const canSave = !!issueId && !!title.trim() && !isSaving;

  const modal = (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-3">
      <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">New CAPA action</p>
            <p className="text-sm font-semibold text-slate-900">Add a corrective / preventive action</p>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-3 px-4 py-3">
          <div>
            <label className="mb-1 block text-[10px] font-medium text-slate-600">Issue <span className="text-rose-500">*</span></label>
            <select value={issueId} onChange={(e) => setIssueId(e.target.value)} disabled={issuesLoading}
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs">
              <option value="">{issuesLoading ? 'Loading issues…' : '— Select the issue this action belongs to —'}</option>
              {(issues || []).map((i) => (
                <option key={i.id} value={i.id}>{i.code ? `${i.code} · ` : `#${i.id} · `}{i.title}</option>
              ))}
            </select>
            <p className="mt-1 text-[10px] text-slate-400">Every CAPA action is tracked under an issue.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[10px] font-medium text-slate-600">Type</label>
              <select value={actionType} onChange={(e) => setActionType(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs">
                <option value="corrective">Corrective</option>
                <option value="preventive">Preventive</option>
                <option value="containment">Containment</option>
                <option value="verification">Verification</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-medium text-slate-600">Status</label>
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs">
                <option value="planned">Planned</option>
                <option value="in_progress">In Progress</option>
                <option value="blocked">Blocked</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-medium text-slate-600">Title <span className="text-rose-500">*</span></label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Patch affected servers"
              className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-[10px] font-medium text-slate-600">Assignee</label>
              <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs">
                <option value="">— Unassigned —</option>
                {tenantUsers.map((u) => (
                  <option key={u.id} value={u.id}>{u.display_name}{u.email ? ` (${u.email})` : ''}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] font-medium text-slate-600">Due date</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-medium text-slate-600">Notes</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full rounded border border-slate-300 px-2 py-1.5 text-xs resize-none" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100">Cancel</button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => onCreate(Number(issueId), {
              title: title.trim(),
              action_type: actionType,
              status,
              description: description || null,
              assignee_id: assigneeId ? Number(assigneeId) : null,
              due_date: dueDate ? new Date(`${dueDate}T00:00:00Z`).toISOString() : null,
            })}
            className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-700 disabled:bg-slate-300"
          >
            {isSaving ? 'Creating…' : 'Create action'}
          </button>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') return modal;
  return createPortal(modal, document.body);
}
