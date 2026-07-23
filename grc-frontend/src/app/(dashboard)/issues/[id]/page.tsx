'use client';

export const dynamic = 'force-dynamic';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import {
  ArrowLeft, ClipboardList, ListChecks, Activity as ActivityIcon, MessageSquare,
  Bug, AlertTriangle, Shield, FileCheck, Server, Building2, Loader2, CheckCircle2,
  X, Plus, ExternalLink, Rocket, Calendar, User, Trash2, ShieldCheck, ChevronRight,
} from 'lucide-react';
import { apiClient, issuesApi } from '@/lib/api';
import { InlineLinkPicker } from '@/components/ui';
import { SeverityChip, StateChip, SourceChip, formatDate, timeAgo } from '../_components/shared';

interface IssueDetail {
  id: number;
  code: string | null;
  tenant_id: number;
  title: string;
  description: string | null;
  severity: string | null;
  severity_override: string | null;
  severity_override_reason: string | null;
  issue_type: string | null;
  category: string | null;
  impact: string | null;
  urgency: string | null;
  workflow_state: string;
  status: string;
  owner: { id?: number; display_name?: string | null } | null;
  reporter: { id?: number; display_name?: string | null } | null;
  assignee: { id?: number; display_name?: string | null } | null;
  approved_by: { id?: number; display_name?: string | null } | null;
  source_type: string | null;
  source_id: number | null;
  root_cause?: string | null;
  root_cause_analysis?: string | null;
  closure_notes?: string | null;
  detected_at: string | null;
  due_date: string | null;
  target_closure_date: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  approved_at: string | null;
  sla_breached: boolean;
  created_at: string | null;
  link_counts: {
    vulnerabilities: number; risks: number; assets: number;
    controls: number; evidence: number; vendors: number;
    actions: number; comments: number;
  };
}

const LINK_TABS: Array<{ key: keyof IssueDetail['link_counts']; label: string; icon: React.ElementType; api: 'vulns' | 'risks' | 'assets' | 'controls' | 'evidence' | 'vendors' }> = [
  { key: 'vulnerabilities', label: 'Vulnerabilities', icon: Bug,         api: 'vulns' },
  { key: 'risks',           label: 'Risks',           icon: AlertTriangle,api: 'risks' },
  { key: 'assets',          label: 'Assets',          icon: Server,      api: 'assets' },
  { key: 'controls',        label: 'Controls',        icon: Shield,      api: 'controls' },
  { key: 'evidence',        label: 'Evidence',        icon: FileCheck,   api: 'evidence' },
  { key: 'vendors',         label: 'Vendors',         icon: Building2,   api: 'vendors' },
];

type LinkFamily = typeof LINK_TABS[number]['api'];

// Defensive: the list endpoints return either a bare array or {items:[]}.
function rowsToOptions(
  raw: unknown,
  label: (x: any) => string | undefined,
  sub: (x: any) => string | undefined,
): { value: string; label: string; subLabel?: string }[] {
  const rows = (Array.isArray(raw) ? raw : (raw as any)?.items ?? (raw as any)?.data ?? []) as any[];
  return rows
    .filter((x) => x && x.id != null)
    .map((x) => ({ value: String(x.id), label: label(x) || `#${x.id}`, subLabel: sub(x) || undefined }));
}

// Searchable "Link" dropdown per family: candidate source + the add-body shape
// for issuesApi.links[family].add. Uses the global InlineLinkPicker UI.
const LINK_PICKER: Record<LinkFamily, {
  fetch: () => Promise<{ value: string; label: string; subLabel?: string }[]>;
  addBody: (id: number) => Record<string, unknown>;
}> = {
  vulns: {
    fetch: async () => rowsToOptions((await apiClient.get('/vuln-management/vulnerabilities')).data, (x) => x.title || x.cve_id || x.name, (x) => x.cve_id),
    addBody: (id) => ({ vulnerability_id: id }),
  },
  risks: {
    fetch: async () => rowsToOptions((await apiClient.get('/risks')).data, (x) => x.title, (x) => x.category),
    addBody: (id) => ({ risk_id: id }),
  },
  assets: {
    fetch: async () => rowsToOptions((await apiClient.get('/assets')).data, (x) => x.name, (x) => x.asset_type),
    addBody: (id) => ({ asset_id: id }),
  },
  controls: {
    fetch: async () => rowsToOptions((await apiClient.get('/control-library')).data, (x) => x.name || x.title || x.code, (x) => x.code),
    addBody: (id) => ({ target_type: 'normalized', control_id: id }),
  },
  evidence: {
    fetch: async () => rowsToOptions((await apiClient.get('/evidence')).data, (x) => x.name, () => undefined),
    addBody: (id) => ({ evidence_id: id }),
  },
  vendors: {
    fetch: async () => rowsToOptions((await apiClient.get('/vendor-risk/vendors')).data, (x) => x.name || x.vendor_name, (x) => x.category),
    addBody: (id) => ({ vendor_id: id }),
  },
};

const TRANSITIONS: Record<string, string[]> = {
  new:             ['triage', 'in_progress', 'cancelled'],
  triage:          ['in_progress', 'cancelled'],
  in_progress:     ['resolution', 'closure_review', 'cancelled'],
  resolution:      ['closure_review', 'in_progress', 'cancelled'],
  closure_review:  ['closed', 'in_progress'],
  closed:          ['in_progress'],
  cancelled:       ['new'],
};

export default function IssueDetailPage() {
  const params = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const issueId = Number(params.id);

  const [showClose, setShowClose] = useState(false);
  const [openSection, setOpenSection] = useState<null | 'capa' | 'linked' | 'comments' | 'activity'>(null);
  const [closeNotes, setCloseNotes] = useState('');

  const { data, isLoading, error } = useQuery<IssueDetail>({
    queryKey: ['issue-detail', issueId],
    queryFn: async () => (await issuesApi.get(issueId)).data,
    staleTime: 15_000,
  });

  const transitionMutation = useMutation({
    mutationFn: (to_state: string) => issuesApi.transition(issueId, { to_state }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['issue-detail', issueId] }),
  });

  const closeMutation = useMutation({
    mutationFn: () => issuesApi.close(issueId, { closure_notes: closeNotes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issue-detail', issueId] });
      setShowClose(false);
      setCloseNotes('');
    },
  });

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /></div>;
  }
  if (error || !data) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-700">
        Could not load issue. <Link href="/issues" className="underline">Back to Issues</Link>.
      </div>
    );
  }
  const allowed = TRANSITIONS[data.workflow_state] || [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start gap-3">
          <Link href="/issues" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-bold text-slate-500">{data.code || `ISS-${data.id}`}</span>
              <SeverityChip severity={data.severity} />
              <StateChip state={data.workflow_state} />
              <SourceChip sourceType={data.source_type} />
              {data.sla_breached && (
                <span className="rounded border border-rose-300 bg-rose-50 px-1.5 py-px text-[10px] font-semibold uppercase text-rose-700">
                  SLA Breached
                </span>
              )}
              {data.severity_override && (
                <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-px text-[10px] font-semibold uppercase text-amber-700" title={data.severity_override_reason || 'Severity overridden'}>
                  Override
                </span>
              )}
            </div>
            <h1 className="mt-1 text-lg font-semibold text-slate-900">{data.title}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
              {data.assignee && <span>Assignee: <span className="text-slate-700 font-medium">{data.assignee.display_name}</span></span>}
              {data.reporter && <span>Reporter: {data.reporter.display_name}</span>}
              <span>Created: {formatDate(data.created_at)}</span>
              {data.target_closure_date && <span>Target close: {formatDate(data.target_closure_date)}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {allowed.map((s) => (
              <button
                key={s}
                onClick={() => transitionMutation.mutate(s)}
                disabled={transitionMutation.isPending}
                className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {s.replace(/_/g, ' ')}
              </button>
            ))}
            {data.workflow_state === 'closure_review' && (
              <button
                onClick={() => setShowClose(true)}
                className="inline-flex items-center gap-1 rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-100"
              >
                <CheckCircle2 className="h-3 w-3" /> Approve Closure
              </button>
            )}
            {data.workflow_state === 'closed' && (
              <button
                onClick={() => {
                  const reason = prompt('Reason for reopening?');
                  if (reason) issuesApi.reopen(issueId, { reason }).then(() => qc.invalidateQueries({ queryKey: ['issue-detail', issueId] }));
                }}
                className="inline-flex items-center gap-1 rounded border border-primary-200 bg-primary-50 px-2 py-1 text-[10px] font-medium text-primary-700 hover:bg-primary-100"
              >
                Reopen
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Overview inline; the detailed areas are compact cards that open in a
          popup — keeps the record short instead of one long scroll. */}
      <div className="space-y-4">
        <OverviewTab data={data} />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {([
            { key: 'capa', label: 'CAPA Actions', icon: ListChecks, count: data.link_counts.actions },
            { key: 'linked', label: 'Linked Items', icon: Shield, count:
                data.link_counts.vulnerabilities + data.link_counts.risks + data.link_counts.assets +
                data.link_counts.controls + data.link_counts.evidence + data.link_counts.vendors },
            { key: 'comments', label: 'Comments', icon: MessageSquare, count: data.link_counts.comments },
            { key: 'activity', label: 'Activity', icon: ActivityIcon, count: null },
          ] as const).map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.key}
                onClick={() => setOpenSection(s.key)}
                className="group flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white p-3.5 text-left shadow-sm transition-colors hover:border-primary-300 hover:bg-slate-50"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-600"><Icon className="h-4 w-4" /></span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-800">{s.label}</span>
                    {s.count != null && <span className="block text-xs text-slate-400">{s.count} {s.count === 1 ? 'item' : 'items'}</span>}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-primary-500" />
              </button>
            );
          })}
        </div>
      </div>

      {/* Section popup — full detail for the clicked card. */}
      {openSection && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setOpenSection(null)}>
          <div className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-slate-200 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
              <h4 className="text-sm font-semibold text-slate-900">
                {openSection === 'capa' ? 'CAPA Actions' : openSection === 'linked' ? 'Linked Items' : openSection === 'comments' ? 'Comments' : 'Activity'}
              </h4>
              <button onClick={() => setOpenSection(null)}><X className="h-4 w-4 text-slate-400" /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {openSection === 'capa' && <CAPATab issueId={issueId} />}
              {openSection === 'linked' && <LinkedItemsTab issueId={issueId} counts={data.link_counts} />}
              {openSection === 'comments' && <CommentsTab issueId={issueId} />}
              {openSection === 'activity' && <ActivityTab issueId={issueId} />}
            </div>
          </div>
        </div>
      )}

      {/* Closure modal */}
      {showClose && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setShowClose(false)}>
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl border border-slate-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
              <h4 className="text-sm font-semibold text-slate-900">Approve Closure</h4>
              <button onClick={() => setShowClose(false)}><X className="h-4 w-4 text-slate-400" /></button>
            </div>
            <div className="px-4 py-3 space-y-2">
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Closure Notes (required)</label>
              <textarea value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} rows={5}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs"
                placeholder="What was done, verification evidence, lessons learned…" />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-2.5 bg-slate-50">
              <button onClick={() => setShowClose(false)} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">Cancel</button>
              <button onClick={() => closeMutation.mutate()} disabled={!closeNotes.trim() || closeMutation.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-300">
                {closeMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                Approve Closure
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tab: Overview ──────────────────────────────────────────────────────
function OverviewTab({ data }: { data: IssueDetail }) {
  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600">Description</h3>
          <p className="text-sm text-slate-800 whitespace-pre-wrap">{data.description || <span className="text-slate-400">No description provided</span>}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600">Root Cause Analysis</h3>
          <p className="text-sm text-slate-800 whitespace-pre-wrap">{data.root_cause_analysis || data.root_cause || <span className="text-slate-400">Not yet documented</span>}</p>
        </div>
        {data.closure_notes && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 shadow-sm">
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-emerald-700">Closure Notes</h3>
            <p className="text-sm text-slate-800 whitespace-pre-wrap">{data.closure_notes}</p>
          </div>
        )}
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">Properties</h3>
        <Prop label="Type"     value={data.issue_type ? data.issue_type.replace(/_/g, ' ') : '—'} />
        <Prop label="Category" value={data.category || '—'} />
        <Prop label="Impact"   value={data.impact || '—'} />
        <Prop label="Urgency"  value={data.urgency || '—'} />
        <Prop label="Owner"    value={data.owner?.display_name || '—'} />
        <Prop label="Detected" value={formatDate(data.detected_at)} />
        <Prop label="Due"      value={formatDate(data.due_date)} />
        <Prop label="Resolved" value={formatDate(data.resolved_at)} />
        <Prop label="Closed"   value={formatDate(data.closed_at)} />
        <Prop label="Approved by" value={data.approved_by?.display_name || '—'} />
      </div>
    </div>
  );
}

function Prop({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[11px] py-0.5">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-800 font-medium capitalize">{value}</span>
    </div>
  );
}

// ─── Tab: CAPA ──────────────────────────────────────────────────────────
interface CAPAActionRow {
  id: number;
  action_type: string;
  title: string;
  description: string | null;
  status: string;
  assignee_id?: number | null;
  assignee_name: string | null;
  due_date: string | null;
  completed_at?: string | null;
  verified_at?: string | null;
  verified_by_name?: string | null;
  effectiveness_review_at?: string | null;
  created_at?: string | null;
  linked_critical_task_id?: number | null;
}

const CAPA_STATUS_TONES: Record<string, { bg: string; text: string; border: string; label: string }> = {
  planned:      { bg: 'bg-slate-50',    text: 'text-slate-700',   border: 'border-slate-200',   label: 'Planned' },
  in_progress:  { bg: 'bg-primary-50',  text: 'text-primary-700', border: 'border-primary-200', label: 'In Progress' },
  blocked:      { bg: 'bg-amber-50',    text: 'text-amber-700',   border: 'border-amber-200',   label: 'Blocked' },
  completed:    { bg: 'bg-emerald-50',  text: 'text-emerald-700', border: 'border-emerald-200', label: 'Completed' },
  verified:     { bg: 'bg-emerald-100', text: 'text-emerald-800', border: 'border-emerald-300', label: 'Verified' },
  cancelled:    { bg: 'bg-slate-100',   text: 'text-slate-500',   border: 'border-slate-200',   label: 'Cancelled' },
};

function CAPAStatusBadge({ status }: { status: string }) {
  const t = CAPA_STATUS_TONES[status] ?? CAPA_STATUS_TONES.planned;
  return (
    <span className={`inline-flex items-center rounded-full border px-1.5 py-px text-[10px] font-medium ${t.bg} ${t.text} ${t.border}`}>
      {t.label}
    </span>
  );
}

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const due = new Date(iso).getTime();
  if (Number.isNaN(due)) return null;
  return Math.round((due - Date.now()) / (1000 * 60 * 60 * 24));
}

function CAPATab({ issueId }: { issueId: number }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<CAPAActionRow[]>({
    queryKey: ['issue-actions', issueId],
    queryFn: async () => (await issuesApi.actions.listForIssue(issueId)).data,
  });
  // Tenant users for the assignee picker. Re-uses the same endpoint that
  // the Vulnerability mitigation modal queries, so any user listed there
  // is also pickable here without an extra route.
  const { data: tenantUsers } = useQuery({
    queryKey: ['capa.tenant-users'],
    queryFn: async () => {
      const r = await apiClient.get<Array<{ id: number; display_name: string; email: string }>>('/assets/tenant-users');
      return r.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const [showAdd, setShowAdd] = useState(false);
  const [title, setTitle] = useState('');
  const [actionType, setActionType] = useState('corrective');
  const [description, setDescription] = useState('');
  // New fields the create form now collects — backend already supports both;
  // assignee defaults to "—Unassigned—" so a quick add still works.
  const [dueDate, setDueDate] = useState('');
  const [assigneeId, setAssigneeId] = useState<string>('');
  const [promotingId, setPromotingId] = useState<number | null>(null);
  const [selectedAction, setSelectedAction] = useState<CAPAActionRow | null>(null);

  const resetForm = () => {
    setTitle(''); setDescription(''); setDueDate(''); setAssigneeId(''); setActionType('corrective');
  };

  const addMutation = useMutation({
    mutationFn: () => issuesApi.actions.create(issueId, {
      title,
      action_type: actionType,
      description: description || undefined,
      due_date: dueDate ? new Date(`${dueDate}T00:00:00Z`).toISOString() : undefined,
      assignee_id: assigneeId ? Number(assigneeId) : undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issue-actions', issueId] });
      qc.invalidateQueries({ queryKey: ['issue-detail', issueId] });
      qc.invalidateQueries({ queryKey: ['capa-actions'] });
      resetForm();
      setShowAdd(false);
    },
  });

  const patchMutation = useMutation({
    mutationFn: ({ actionId, body }: { actionId: number; body: Record<string, unknown> }) =>
      issuesApi.actions.patch(actionId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issue-actions', issueId] });
      qc.invalidateQueries({ queryKey: ['issue-detail', issueId] });
      qc.invalidateQueries({ queryKey: ['capa-actions'] });
      setSelectedAction(null);
    },
  });

  const verifyMutation = useMutation({
    mutationFn: ({ actionId, body }: { actionId: number; body: { effectiveness_review_at?: string; notes?: string } }) =>
      issuesApi.actions.verify(actionId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issue-actions', issueId] });
      qc.invalidateQueries({ queryKey: ['issue-detail', issueId] });
      setSelectedAction(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (actionId: number) => issuesApi.actions.delete(actionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issue-actions', issueId] });
      qc.invalidateQueries({ queryKey: ['issue-detail', issueId] });
      qc.invalidateQueries({ queryKey: ['capa-actions'] });
      setSelectedAction(null);
    },
  });

  const promoteMutation = useMutation({
    mutationFn: (actionId: number) => issuesApi.actions.promoteToTask(actionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issue-actions', issueId] });
      qc.invalidateQueries({ queryKey: ['issue-activity', issueId] });
      qc.invalidateQueries({ queryKey: ['critical-tasks'] });
      setPromotingId(null);
    },
    onError: () => setPromotingId(null),
  });

  if (isLoading) return <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">CAPA Actions</h3>
        <button onClick={() => setShowAdd((s) => !s)} className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50">
          <Plus className="h-3 w-3" /> Add Action
        </button>
      </div>

      {showAdd && (
        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Action title"
            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={actionType}
              onChange={(e) => setActionType(e.target.value)}
              className="rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
              title="Action type — Corrective fixes a defect, Preventive stops recurrence, Containment limits impact while a fix is in flight, Verification confirms effectiveness"
            >
              <option value="corrective">Corrective</option>
              <option value="preventive">Preventive</option>
              <option value="containment">Containment</option>
              <option value="verification">Verification</option>
            </select>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
              title="Due date (optional)"
            />
          </div>
          <select
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
            title="Assignee (optional)"
          >
            <option value="">— Unassigned —</option>
            {(tenantUsers || []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.display_name} {u.email ? `(${u.email})` : ''}
              </option>
            ))}
          </select>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder="Description / acceptance criteria (optional)"
            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs resize-none"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setShowAdd(false); resetForm(); }}
              className="rounded-lg px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              onClick={() => addMutation.mutate()}
              disabled={!title.trim() || addMutation.isPending}
              className="rounded-lg bg-primary-600 px-3 py-1 text-xs font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:bg-slate-300 disabled:text-slate-500"
            >
              {addMutation.isPending ? 'Adding…' : 'Add Action'}
            </button>
          </div>
        </div>
      )}

      {(data?.length || 0) === 0 ? (
        <p className="py-6 text-center text-xs text-slate-400">
          No actions yet. Add a corrective or preventive action above.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {data!.map((a) => {
            const dueIn = daysUntil(a.due_date);
            const isOverdue = dueIn !== null && dueIn < 0 && a.status !== 'completed' && a.status !== 'verified' && a.status !== 'cancelled';
            const isDueSoon = dueIn !== null && dueIn >= 0 && dueIn <= 7 && a.status !== 'completed' && a.status !== 'verified' && a.status !== 'cancelled';
            return (
              <li
                key={a.id}
                onClick={() => setSelectedAction(a)}
                className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white p-2 hover:bg-slate-50 cursor-pointer transition-colors"
                title="Click to view / edit details"
              >
                <span className="rounded border border-slate-200 bg-slate-50 px-1 py-px text-[9px] font-medium uppercase text-slate-600 shrink-0">
                  {a.action_type}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-slate-800">{a.title}</div>
                  {a.description && (
                    <p className="text-[11px] text-slate-600 mt-0.5 line-clamp-2">{a.description}</p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {a.assignee_name && (
                      <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-px text-[10px] text-slate-600">
                        <User className="h-2.5 w-2.5 text-slate-400" />
                        {a.assignee_name}
                      </span>
                    )}
                    {a.due_date && (
                      <span
                        className={`inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10px] ${
                          isOverdue
                            ? 'border-rose-200 bg-rose-50 text-rose-700'
                            : isDueSoon
                              ? 'border-amber-200 bg-amber-50 text-amber-700'
                              : 'border-slate-200 bg-white text-slate-600'
                        }`}
                      >
                        <Calendar className="h-2.5 w-2.5" />
                        {new Date(a.due_date).toLocaleDateString()}
                        {isOverdue && <span className="font-semibold ml-0.5">· {Math.abs(dueIn!)}d overdue</span>}
                        {isDueSoon && <span className="font-semibold ml-0.5">· {dueIn}d</span>}
                      </span>
                    )}
                    {a.linked_critical_task_id && (
                      <a
                        href={`/tasks/${a.linked_critical_task_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-0.5 rounded border border-primary-200 bg-primary-50 px-1.5 py-px text-[10px] font-medium text-primary-700 hover:bg-primary-100"
                        title="Mirrored into Critical Tasks register"
                      >
                        <Rocket className="h-2.5 w-2.5" />
                        Task #{a.linked_critical_task_id}
                        <ExternalLink className="h-2 w-2" />
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <CAPAStatusBadge status={a.status} />
                  {!a.linked_critical_task_id && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPromotingId(a.id);
                        promoteMutation.mutate(a.id);
                      }}
                      disabled={promoteMutation.isPending && promotingId === a.id}
                      className="inline-flex items-center gap-0.5 rounded border border-primary-200 bg-white px-1.5 py-px text-[10px] font-medium text-primary-700 hover:bg-primary-50 disabled:opacity-50"
                      title="Promote this CAPA to a Critical Task — status syncs back automatically"
                    >
                      {promoteMutation.isPending && promotingId === a.id ? (
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                      ) : (
                        <Rocket className="h-2.5 w-2.5" />
                      )}
                      Promote
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Detail / edit modal — opens when a row is clicked. Lets the operator
          view every field on the action and inline-edit status / due-date /
          assignee / description / verify / delete without leaving the tab. */}
      {selectedAction && (
        <CAPADetailModal
          action={selectedAction}
          tenantUsers={tenantUsers || []}
          onClose={() => setSelectedAction(null)}
          onSave={(body) => patchMutation.mutate({ actionId: selectedAction.id, body })}
          onVerify={(body) => verifyMutation.mutate({ actionId: selectedAction.id, body })}
          onDelete={() => {
            if (confirm(`Delete action "${selectedAction.title}"? This cannot be undone.`)) {
              deleteMutation.mutate(selectedAction.id);
            }
          }}
          isSaving={patchMutation.isPending}
          isVerifying={verifyMutation.isPending}
          isDeleting={deleteMutation.isPending}
        />
      )}
    </div>
  );
}

// ─── CAPA detail / edit modal ───────────────────────────────────────────────

function CAPADetailModal({
  action, tenantUsers, onClose, onSave, onVerify, onDelete,
  isSaving, isVerifying, isDeleting,
}: {
  action: CAPAActionRow;
  tenantUsers: Array<{ id: number; display_name: string; email: string }>;
  onClose: () => void;
  onSave: (body: Record<string, unknown>) => void;
  onVerify: (body: { effectiveness_review_at?: string; notes?: string }) => void;
  onDelete: () => void;
  isSaving: boolean;
  isVerifying: boolean;
  isDeleting: boolean;
}) {
  // Initialise from the action — uncontrolled-style state per field so the
  // operator can scrub one value without retyping the others.
  const [status, setStatus] = useState(action.status);
  const [assigneeId, setAssigneeId] = useState<string>(action.assignee_id ? String(action.assignee_id) : '');
  const [dueDate, setDueDate] = useState<string>(
    action.due_date ? new Date(action.due_date).toISOString().slice(0, 10) : '',
  );
  const [description, setDescription] = useState(action.description ?? '');
  const [actionType, setActionType] = useState(action.action_type);
  const [effectivenessDate, setEffectivenessDate] = useState<string>(
    action.effectiveness_review_at ? new Date(action.effectiveness_review_at).toISOString().slice(0, 10) : '',
  );
  const [verifyNotes, setVerifyNotes] = useState('');

  const handleSave = () => {
    const body: Record<string, unknown> = {
      status,
      action_type: actionType,
      description: description || null,
      assignee_id: assigneeId ? Number(assigneeId) : null,
      due_date: dueDate ? new Date(`${dueDate}T00:00:00Z`).toISOString() : null,
    };
    onSave(body);
  };

  const handleVerify = () => {
    onVerify({
      effectiveness_review_at: effectivenessDate
        ? new Date(`${effectivenessDate}T00:00:00Z`).toISOString()
        : undefined,
      notes: verifyNotes || undefined,
    });
  };

  const canVerify = action.status === 'completed' && !action.verified_at;
  const dueIn = daysUntil(action.due_date);
  const isOverdue = dueIn !== null && dueIn < 0 && status !== 'completed' && status !== 'verified' && status !== 'cancelled';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-3">
      <div className="w-full max-w-2xl max-h-[92vh] overflow-y-auto rounded-xl bg-white shadow-2xl">
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-200 bg-white px-5 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="rounded border border-slate-200 bg-slate-50 px-1.5 py-px text-[10px] font-medium uppercase text-slate-600">
                {action.action_type}
              </span>
              <CAPAStatusBadge status={action.status} />
              {action.verified_at && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-100 px-1.5 py-px text-[10px] font-medium text-emerald-800">
                  <ShieldCheck className="h-2.5 w-2.5" />
                  Verified
                </span>
              )}
            </div>
            <h3 className="text-sm font-semibold text-slate-900 truncate">{action.title}</h3>
            <p className="mt-0.5 text-[11px] text-slate-500">
              Action #{action.id}
              {action.created_at && ` · created ${new Date(action.created_at).toLocaleDateString()}`}
            </p>
          </div>
          <button onClick={onClose} className="ml-3 text-slate-500 hover:text-slate-900 shrink-0">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* Read-only summary */}
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-slate-500">Assignee</dt>
              <dd className="mt-0.5 text-slate-800">{action.assignee_name || '— Unassigned —'}</dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-slate-500">Due date</dt>
              <dd className={`mt-0.5 ${isOverdue ? 'text-rose-700 font-semibold' : 'text-slate-800'}`}>
                {action.due_date ? new Date(action.due_date).toLocaleDateString() : '—'}
                {isOverdue && <span className="ml-1 text-[10px]">({Math.abs(dueIn!)}d overdue)</span>}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-slate-500">Completed at</dt>
              <dd className="mt-0.5 text-slate-800">
                {action.completed_at ? new Date(action.completed_at).toLocaleString() : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-[10px] uppercase tracking-wide text-slate-500">Verified by</dt>
              <dd className="mt-0.5 text-slate-800">
                {action.verified_at
                  ? `${action.verified_by_name || 'verifier'} · ${new Date(action.verified_at).toLocaleDateString()}`
                  : '—'}
              </dd>
            </div>
          </dl>

          {/* Inline edit */}
          <div className="rounded-lg border border-slate-200 bg-slate-50/40 p-3 space-y-3">
            <h4 className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Update</h4>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-medium text-slate-600 mb-1">Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
                >
                  <option value="planned">Planned</option>
                  <option value="in_progress">In Progress</option>
                  <option value="blocked">Blocked</option>
                  <option value="completed">Completed</option>
                  <option value="verified">Verified</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-medium text-slate-600 mb-1">Action type</label>
                <select
                  value={actionType}
                  onChange={(e) => setActionType(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
                >
                  <option value="corrective">Corrective</option>
                  <option value="preventive">Preventive</option>
                  <option value="containment">Containment</option>
                  <option value="verification">Verification</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-medium text-slate-600 mb-1">Due date</label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-slate-600 mb-1">Assignee</label>
                <select
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs"
                >
                  <option value="">— Unassigned —</option>
                  {tenantUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.display_name} {u.email ? `(${u.email})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-medium text-slate-600 mb-1">Description / notes</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Update on progress, blockers, acceptance criteria…"
                className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs resize-none"
              />
            </div>

            <div className="flex justify-end">
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:bg-slate-300 disabled:text-slate-500"
              >
                {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
                {isSaving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>

          {/* Verify panel — only meaningful when status reached 'completed' */}
          {canVerify && (
            <div className="rounded-lg border border-primary-200 bg-primary-50/40 p-3 space-y-2">
              <h4 className="text-[10px] font-semibold uppercase tracking-wider text-primary-700 inline-flex items-center gap-1">
                <ShieldCheck className="h-3 w-3" />
                Verify effectiveness
              </h4>
              <p className="text-[11px] text-slate-700">
                A completed action stays open for effectiveness review. Verifying it
                marks the CAPA as durably effective and stamps you as the verifier.
              </p>
              <div>
                <label className="block text-[10px] font-medium text-primary-700 mb-1">
                  Effectiveness review date (optional)
                </label>
                <input
                  type="date"
                  value={effectivenessDate}
                  onChange={(e) => setEffectivenessDate(e.target.value)}
                  className="w-full rounded border border-primary-300 bg-white px-2 py-1.5 text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] font-medium text-primary-700 mb-1">
                  Verification notes (optional)
                </label>
                <textarea
                  value={verifyNotes}
                  onChange={(e) => setVerifyNotes(e.target.value)}
                  rows={2}
                  placeholder="Evidence reviewed, residual risk, follow-ups…"
                  className="w-full rounded border border-primary-300 bg-white px-2 py-1.5 text-xs resize-none"
                />
              </div>
              <div className="flex justify-end">
                <button
                  onClick={handleVerify}
                  disabled={isVerifying}
                  className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-[#0a0a0a] hover:bg-primary-700 disabled:bg-slate-300 disabled:text-slate-500"
                >
                  {isVerifying ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
                  {isVerifying ? 'Verifying…' : 'Verify effectiveness'}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-slate-200 bg-white px-5 py-3">
          <button
            onClick={onDelete}
            disabled={isDeleting}
            className="inline-flex items-center gap-1 text-xs text-rose-600 hover:underline disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" />
            {isDeleting ? 'Deleting…' : 'Delete action'}
          </button>
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Tab: Linked Items ──────────────────────────────────────────────────
function LinkedItemsTab({ issueId, counts }: { issueId: number; counts: IssueDetail['link_counts'] }) {
  const [linkTab, setLinkTab] = useState<typeof LINK_TABS[number]['api']>(LINK_TABS[0].api);
  const tabMeta = LINK_TABS.find((t) => t.api === linkTab)!;
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<Array<Record<string, unknown>>>({
    queryKey: ['issue-links', issueId, linkTab],
    queryFn: async () => {
      // The six linkage families share a uniform `.list(issueId)` shape but
      // diverge on the row payload; xtsc has trouble inferring the union.
      const api = issuesApi.links[linkTab] as { list: (id: number) => Promise<{ data: Array<Record<string, unknown>> }> };
      return (await api.list(issueId)).data;
    },
  });

  // Candidate pool for the active family + the "Link" mutation.
  const { data: candidates } = useQuery({
    queryKey: ['issue-link-candidates', linkTab],
    queryFn: () => LINK_PICKER[linkTab].fetch(),
    staleTime: 60_000,
  });
  const addMut = useMutation({
    mutationFn: (id: number) =>
      (issuesApi.links[linkTab] as unknown as { add: (i: number, b: Record<string, unknown>) => Promise<unknown> })
        .add(issueId, LINK_PICKER[linkTab].addBody(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issue-links', issueId, linkTab] });
      qc.invalidateQueries({ queryKey: ['issue-detail', issueId] });
    },
  });

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
        {LINK_TABS.map((t) => {
          const Icon = t.icon;
          const active = linkTab === t.api;
          return (
            <button
              key={t.api}
              onClick={() => setLinkTab(t.api)}
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-medium ${
                active ? 'border-primary-300 bg-primary-50 text-primary-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Icon className="h-3 w-3" /> {t.label}
              <span className="ml-1 text-[9px] text-slate-400">{counts[t.key]}</span>
            </button>
          );
        })}
        </div>
        <InlineLinkPicker
          triggerLabel={`Link ${tabMeta.label.toLowerCase()}`}
          triggerClassName="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          triggerIcon={<Plus className="h-3.5 w-3.5" />}
          items={candidates || []}
          isLoading={addMut.isPending}
          emptyText={`No ${tabMeta.label.toLowerCase()} available`}
          searchPlaceholder={`Search ${tabMeta.label.toLowerCase()}`}
          popoverWidth={320}
          onSelect={(v) => addMut.mutate(Number(v))}
        />
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm min-h-[200px]">
        {isLoading ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /> :
          (!data || data.length === 0) ? (
            <div className="flex flex-col items-center justify-center py-8 text-center">
              <tabMeta.icon className="h-7 w-7 text-slate-300" />
              <p className="mt-2 text-xs text-slate-500">No {tabMeta.label.toLowerCase()} linked yet.</p>
            </div>
          ) : (
            <ul className="space-y-1.5">
              {data.map((row, i) => (
                <li key={i} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/40 p-2">
                  <tabMeta.icon className="h-3.5 w-3.5 text-slate-500 shrink-0" />
                  <span className="text-xs font-medium text-slate-800 truncate">
                    {(row.title || row.name || row.code || row.vuln_id || `#${row.id}`) as string}
                  </span>
                  {row.severity ? <SeverityChip severity={row.severity as string} /> : null}
                </li>
              ))}
            </ul>
          )
        }
      </div>
    </div>
  );
}

// ─── Tab: Comments ──────────────────────────────────────────────────────
function CommentsTab({ issueId }: { issueId: number }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<Array<{ id: number; body: string; created_at: string; user: { display_name?: string | null } }>>({
    queryKey: ['issue-comments', issueId],
    queryFn: async () => (await issuesApi.comments.list(issueId)).data,
  });
  const [body, setBody] = useState('');
  const postMutation = useMutation({
    mutationFn: () => issuesApi.comments.create(issueId, { body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['issue-comments', issueId] });
      qc.invalidateQueries({ queryKey: ['issue-detail', issueId] });
      qc.invalidateQueries({ queryKey: ['issue-activity', issueId] });
      setBody('');
    },
  });

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3}
        placeholder="Add a comment…"
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs resize-none" />
      <div className="flex justify-end">
        <button onClick={() => postMutation.mutate()} disabled={!body.trim() || postMutation.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-[#0a0a0a] hover:bg-primary-700 disabled:bg-slate-300 disabled:text-slate-500">
          {postMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
          Post Comment
        </button>
      </div>
      <div className="border-t border-slate-100 pt-3">
        {isLoading ? <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" /> :
          (data?.length || 0) === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">No comments yet — start the conversation.</p>
          ) : (
            <ul className="space-y-2">
              {data!.map((c) => (
                <li key={c.id} className="rounded-lg border border-slate-200 bg-slate-50/40 p-2.5">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-slate-800">{c.user?.display_name || 'Unknown'}</span>
                    <span className="text-slate-400">{timeAgo(c.created_at)}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-800 whitespace-pre-wrap">{c.body}</p>
                </li>
              ))}
            </ul>
          )
        }
      </div>
    </div>
  );
}

// ─── Tab: Activity (full audit log) ────────────────────────────────────
// Renders the IssueActivity rows backing the /issues/{id}/activity endpoint.
// Each entry shows the action icon, a human-readable verb, the acting user,
// any payload details (field changes, transitions, link names), an
// absolute timestamp, and a relative "12m ago" hint. Rows are grouped by
// day so the audit trail reads naturally instead of as a flat list.

type ActivityRow = {
  id: number;
  type: string;
  user: { display_name?: string | null };
  payload: Record<string, unknown> | null;
  created_at: string;
};

const ACTIVITY_META: Record<
  string,
  { label: string; icon: typeof ActivityIcon; tone: string }
> = {
  created:           { label: 'Created the issue',       icon: Plus,           tone: 'bg-primary-50 text-primary-700 border-primary-200' },
  updated:           { label: 'Updated fields',          icon: ListChecks,     tone: 'bg-slate-50 text-slate-700 border-slate-200' },
  severity_change:   { label: 'Changed severity',        icon: AlertTriangle,  tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  status_change:     { label: 'Changed status',          icon: ActivityIcon,   tone: 'bg-primary-50 text-primary-700 border-primary-200' },
  approved:          { label: 'Approved closure',        icon: CheckCircle2,   tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  reopened:          { label: 'Reopened the issue',      icon: Rocket,         tone: 'bg-rose-50 text-rose-700 border-rose-200' },
  cancelled:         { label: 'Cancelled the issue',     icon: X,              tone: 'bg-rose-50 text-rose-700 border-rose-200' },
  commented:         { label: 'Added a comment',         icon: MessageSquare,  tone: 'bg-slate-50 text-slate-700 border-slate-200' },
  action_added:      { label: 'Added a CAPA action',     icon: ClipboardList,  tone: 'bg-primary-50 text-primary-700 border-primary-200' },
  action_updated:    { label: 'Updated a CAPA action',   icon: ClipboardList,  tone: 'bg-slate-50 text-slate-700 border-slate-200' },
  action_completed:  { label: 'Completed a CAPA action', icon: CheckCircle2,   tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  action_verified:   { label: 'Verified a CAPA action',  icon: ShieldCheck,    tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  action_deleted:    { label: 'Deleted a CAPA action',   icon: Trash2,         tone: 'bg-rose-50 text-rose-700 border-rose-200' },
  linked:            { label: 'Linked a related item',   icon: ExternalLink,   tone: 'bg-primary-50 text-primary-700 border-primary-200' },
  unlinked:          { label: 'Unlinked a related item', icon: ExternalLink,   tone: 'bg-slate-50 text-slate-700 border-slate-200' },
  action_promoted_to_task: { label: 'Promoted action to task', icon: Rocket,   tone: 'bg-primary-50 text-primary-700 border-primary-200' },
};

function activityMeta(type: string) {
  return (
    ACTIVITY_META[type] ?? {
      label: type.replace(/_/g, ' '),
      icon: ActivityIcon,
      tone: 'bg-slate-50 text-slate-700 border-slate-200',
    }
  );
}

function formatPayloadValue(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(formatPayloadValue).join(', ');
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if ('old' in obj || 'new' in obj) {
      return `${formatPayloadValue(obj.old)} → ${formatPayloadValue(obj.new)}`;
    }
    return JSON.stringify(obj);
  }
  return String(v);
}

function renderPayloadDetails(type: string, payload: Record<string, unknown> | null) {
  if (!payload || Object.keys(payload).length === 0) return null;

  // Field-level diff: e.g. {changes: {title: {old, new}}}
  const changes = payload.changes as Record<string, unknown> | undefined;
  if (changes && typeof changes === 'object') {
    return (
      <dl className="mt-1 space-y-0.5 text-[11px] text-slate-600">
        {Object.entries(changes).map(([field, diff]) => (
          <div key={field} className="flex flex-wrap items-baseline gap-1.5">
            <dt className="font-mono text-slate-500">{field}</dt>
            <dd>{formatPayloadValue(diff)}</dd>
          </div>
        ))}
      </dl>
    );
  }

  // Status transition: {from_state, to_state}
  if ('from_state' in payload || 'to_state' in payload) {
    return (
      <p className="mt-1 text-[11px] text-slate-600">
        <span className="font-mono">{String(payload.from_state ?? '—')}</span>
        {' → '}
        <span className="font-mono">{String(payload.to_state ?? '—')}</span>
      </p>
    );
  }

  // Reason / closure_notes / notes (close, reopen, cancel)
  const reasonLike = (payload.reason ?? payload.closure_notes ?? payload.notes) as
    | string
    | undefined;
  if (reasonLike) {
    return <p className="mt-1 text-[11px] text-slate-600 italic">“{reasonLike}”</p>;
  }

  // Link / unlink — denormalised name + ref
  if (type === 'linked' || type === 'unlinked') {
    const name = (payload.name ?? payload.title ?? payload.code) as string | undefined;
    const family = (payload.family ?? payload.kind ?? payload.target_type) as string | undefined;
    if (name) {
      return (
        <p className="mt-1 text-[11px] text-slate-600">
          {family && <span className="font-mono text-slate-500">{family}: </span>}
          {name}
        </p>
      );
    }
  }

  // Fallback — render the raw JSON in a compact block.
  return (
    <pre className="mt-1 max-w-full overflow-x-auto rounded bg-slate-50 px-1.5 py-1 text-[10px] text-slate-600">
      {JSON.stringify(payload, null, 0).slice(0, 220)}
    </pre>
  );
}

function activityDayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown date';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const that = new Date(d);
  that.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - that.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function ActivityTab({ issueId }: { issueId: number }) {
  const { data, isLoading } = useQuery<ActivityRow[]>({
    queryKey: ['issue-activity', issueId],
    queryFn: async () => (await issuesApi.activity.list(issueId)).data,
  });

  if (isLoading) {
    return <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />;
  }
  if (!data || data.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-400">
        No activity yet.
      </div>
    );
  }

  // Group rows by day label (preserves the desc order coming from the API).
  const groups: Array<{ label: string; rows: ActivityRow[] }> = [];
  for (const row of data) {
    const label = activityDayLabel(row.created_at);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.rows.push(row);
    else groups.push({ label, rows: [row] });
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm divide-y divide-slate-100">
      <div className="px-4 py-2.5 flex items-center justify-between bg-slate-50 rounded-t-xl">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Audit Log
        </h3>
        <span className="text-[10px] text-slate-500">{data.length} entries</span>
      </div>
      {groups.map((g) => (
        <section key={g.label} className="p-3">
          <p className="mb-2 px-1 text-[10px] font-medium uppercase tracking-wider text-slate-400">
            {g.label}
          </p>
          <ol className="relative ml-3 border-l border-slate-200">
            {g.rows.map((a) => {
              const meta = activityMeta(a.type);
              const Icon = meta.icon;
              const fullTimestamp = (() => {
                const d = new Date(a.created_at);
                return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
              })();
              return (
                <li key={a.id} className="relative pl-5 pb-3 last:pb-1">
                  <span
                    className={`absolute -left-[9px] top-0 inline-flex h-4 w-4 items-center justify-center rounded-full border ${meta.tone}`}
                    title={a.type}
                  >
                    <Icon className="h-2.5 w-2.5" />
                  </span>
                  <div className="flex flex-wrap items-baseline gap-1.5 text-xs">
                    <span className="font-medium text-slate-900">
                      {a.user?.display_name || 'System'}
                    </span>
                    <span className="text-slate-700">{meta.label.toLowerCase()}</span>
                    <span
                      className="ml-auto shrink-0 text-[10px] text-slate-400"
                      title={fullTimestamp}
                    >
                      {timeAgo(a.created_at)}
                    </span>
                  </div>
                  {renderPayloadDetails(a.type, a.payload)}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
