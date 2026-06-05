'use client';

// ActivityPanel — per-item audit log feed for a criticality assessment.
// Renders the rows behind `/criticality-assessments/{kind}/{id}/activity`
// with the same visual language as the Issues activity tab: icon per
// event type, day-grouped, payload diff rendered inline.

import { useQuery } from '@tanstack/react-query';
import {
  Plus, ListChecks, AlertTriangle, Activity, CheckCircle2,
  Rocket, X, MessageSquare, Paperclip, Trash2, ShieldCheck, FileText,
  Loader2, ExternalLink,
} from 'lucide-react';
import {
  criticalityApi,
  type CriticalityActivityRow,
  type CriticalityKind,
} from '@/lib/api';

const META: Record<string, { label: string; icon: typeof Activity; tone: string }> = {
  created:           { label: 'Created the assessment',  icon: Plus,           tone: 'bg-blue-50 text-blue-700 border-blue-200' },
  updated:           { label: 'Updated fields',          icon: ListChecks,     tone: 'bg-slate-50 text-slate-700 border-slate-200' },
  score_changed:     { label: 'Changed scoring',         icon: AlertTriangle,  tone: 'bg-amber-50 text-amber-700 border-amber-200' },
  submitted:         { label: 'Submitted for review',    icon: Rocket,         tone: 'bg-blue-50 text-blue-700 border-blue-200' },
  approved:          { label: 'Approved',                icon: CheckCircle2,   tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  rejected:          { label: 'Rejected',                icon: X,              tone: 'bg-rose-50 text-rose-700 border-rose-200' },
  returned:          { label: 'Returned for changes',    icon: AlertTriangle,  tone: 'bg-orange-50 text-orange-700 border-orange-200' },
  commented:         { label: 'Added a comment',         icon: MessageSquare,  tone: 'bg-violet-50 text-violet-700 border-violet-200' },
  evidence_uploaded: { label: 'Uploaded evidence',       icon: Paperclip,      tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  evidence_deleted:  { label: 'Deleted evidence',        icon: Trash2,         tone: 'bg-rose-50 text-rose-700 border-rose-200' },
  promoted_to_risk:  { label: 'Promoted to Risk',        icon: ShieldCheck,    tone: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  task_created:      { label: 'Created follow-up task',  icon: ExternalLink,   tone: 'bg-blue-50 text-blue-700 border-blue-200' },
};

function meta(type: string) {
  return META[type] || { label: type.replace(/_/g, ' '), icon: Activity, tone: 'bg-slate-50 text-slate-700 border-slate-200' };
}

function timeAgo(iso: string) {
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (Number.isNaN(diff) || diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown date';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const that = new Date(d);
  that.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - that.getTime()) / 86_400_000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(formatVal).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('old' in o || 'new' in o) return `${formatVal(o.old)} → ${formatVal(o.new)}`;
    return JSON.stringify(o);
  }
  return String(v);
}

function renderPayload(type: string, payload: Record<string, unknown>) {
  if (!payload || Object.keys(payload).length === 0) return null;
  const changes = payload.changes as Record<string, unknown> | undefined;
  if (changes && typeof changes === 'object') {
    return (
      <dl className="mt-1 space-y-0.5 text-[11px] text-slate-600">
        {Object.entries(changes).map(([field, diff]) => (
          <div key={field} className="flex flex-wrap items-baseline gap-1.5">
            <dt className="font-mono text-slate-500">{field}</dt>
            <dd>{formatVal(diff)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  if (type === 'submitted' || type === 'approved' || type === 'returned') {
    const reason = payload.reason || payload.notes;
    const toState = payload.to_state;
    return (
      <p className="mt-1 text-[11px] text-slate-600">
        {toState ? <>→ <span className="font-mono">{String(toState)}</span></> : null}
        {reason ? <span className="ml-1 italic">“{String(reason)}”</span> : null}
      </p>
    );
  }
  if (type === 'rejected' && payload.reason) {
    return <p className="mt-1 text-[11px] text-rose-700 italic">“{String(payload.reason)}”</p>;
  }
  if (type === 'commented' && payload.excerpt) {
    return <p className="mt-1 text-[11px] text-slate-600 italic">“{String(payload.excerpt)}”</p>;
  }
  if ((type === 'evidence_uploaded' || type === 'evidence_deleted') && payload.file_name) {
    return <p className="mt-1 text-[11px] text-slate-600">{String(payload.file_name)}</p>;
  }
  if (type === 'promoted_to_risk' && payload.risk_id) {
    return (
      <p className="mt-1 text-[11px] text-slate-600">
        Risk #<span className="font-mono">{String(payload.risk_id)}</span>
      </p>
    );
  }
  if (type === 'task_created' && payload.task_id) {
    return (
      <p className="mt-1 text-[11px] text-slate-600">
        Task #<span className="font-mono">{String(payload.task_id)}</span>
        {payload.title ? ` — ${payload.title}` : ''}
      </p>
    );
  }
  return null;
}

export function ActivityPanel({
  kind, itemId,
}: { kind: CriticalityKind; itemId: number }) {
  const { data, isLoading } = useQuery<CriticalityActivityRow[]>({
    queryKey: ['criticality.activity', kind, itemId],
    queryFn: async () => (await criticalityApi.activity.list(kind, itemId)).data,
  });

  if (isLoading) {
    return <Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" />;
  }
  if (!data || data.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-xs text-slate-400">
        <FileText className="mx-auto h-6 w-6 text-slate-300" />
        <p className="mt-2">No activity yet.</p>
      </div>
    );
  }

  // Day grouping. Server returns DESC by created_at.
  const groups: Array<{ label: string; rows: CriticalityActivityRow[] }> = [];
  for (const row of data) {
    const label = dayLabel(row.created_at);
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
              const m = meta(a.type);
              const Icon = m.icon;
              return (
                <li key={a.id} className="relative pl-5 pb-3 last:pb-1">
                  <span
                    className={`absolute -left-[9px] top-0 inline-flex h-4 w-4 items-center justify-center rounded-full border ${m.tone}`}
                    title={a.type}
                  >
                    <Icon className="h-2.5 w-2.5" />
                  </span>
                  <div className="flex flex-wrap items-baseline gap-1.5 text-xs">
                    <span className="font-medium text-slate-900">
                      {a.user?.display_name || 'System'}
                    </span>
                    <span className="text-slate-700">{m.label.toLowerCase()}</span>
                    <span
                      className="ml-auto shrink-0 text-[10px] text-slate-400"
                      title={new Date(a.created_at).toLocaleString()}
                    >
                      {timeAgo(a.created_at)}
                    </span>
                  </div>
                  {renderPayload(a.type, a.payload)}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
