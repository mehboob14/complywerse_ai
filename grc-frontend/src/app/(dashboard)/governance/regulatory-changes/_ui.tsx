'use client';

// Shared parts of the regulatory change pages: how each status looks, the
// queries every tab reads (one cache, so the counts and the lists agree), and
// the small pieces the popups are built from.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Check, Loader2, Search, UserPlus } from 'lucide-react';
import { AnimatedModal } from '@/components/ui';
import { adminApi, regulatoryApi } from '@/lib/api';

export interface RegulatoryChange {
  id: number;
  title: string;
  description?: string | null;
  source: string;
  regulatory_body?: string | null;
  reference_number?: string | null;
  effective_date?: string | null;
  publication_date?: string | null;
  status: string;
  priority: string;
  impact_summary?: string | null;
  gap_count?: number;
  assigned_to?: number | null;
  assignee_name?: string | null;
  creator_name?: string | null;
  assessment_count?: number;
  task_count?: number;
  completed_task_count?: number;
  created_at: string;
  updated_at?: string;
  closed_at?: string | null;
  closed_by_name?: string | null;
  /** The circular analysis in progress or last run (backend regulatory_engine). */
  analysis?: {
    status: 'queued' | 'running' | 'done' | 'failed';
    step?: string; done_steps?: number; total_steps?: number; found?: number; error?: string; seconds?: number;
    counts?: { obligations?: number; verified?: number; unverified?: number; tasks_created?: number;
      assessments_created?: number; sections?: number; failed?: string[] };
  } | null;
}

export interface Assessment {
  id: number;
  assessment_type?: string;
  impacted_item_id?: number | null;
  impacted_item_type?: string | null;
  impacted_item_name?: string | null;
  impact_level: string;
  impact_description?: string | null;
  affected_areas?: string | null;
  gap_identified?: boolean;
  gap_description?: string | null;
  compliance_gaps?: string | null;
  recommendations?: string | null;
  assessor_name?: string | null;
  assessment_date?: string | null;
}

export interface Task {
  id: number;
  title: string;
  description?: string | null;
  task_type: string;
  status: string;
  priority?: string;
  assigned_to?: number | null;
  assignee_name?: string | null;
  assignee_department?: string | null;
  creator_name?: string | null;
  /** Everyone on it (assigned_to is the first of them). */
  assignee_ids?: number[];
  assignees?: Array<{ id: number; display_name: string; department?: string | null }>;
  due_date?: string | null;
  completed_at?: string | null;
  created_at?: string;
  is_overdue?: boolean;
  impact_assessment_id?: number | null;
  /** The obligation it was raised from. */
  obligation_id?: number | null;
  /** Its twin in Task Management (/tasks/:id). */
  critical_task_id?: number | null;
  linked_policy_id?: number | null;
  linked_policy_title?: string | null;
  linked_control_id?: number | null;
  linked_control_name?: string | null;
}

export interface Obligation {
  id: number; ref: string | null; quote: string | null; summary: string; obligation_type: string;
  applies_to: string[]; deadline: string | null; deadline_text: string | null; priority: string; verified: boolean;
  match_score: number | null; compliance_status: string; owner_id: number | null; owner_name: string | null;
  owner_ids?: number[]; owners?: Array<{ id: number; display_name: string }>;
  department: string | null; notes: string | null; source: 'ai' | 'manual';
}

/** Everyone on a task / every owner of an obligation, including rows from before several were allowed. */
export const assigneesOf = (t: Pick<Task, 'assignee_ids' | 'assigned_to'>) =>
  t.assignee_ids?.length ? t.assignee_ids : t.assigned_to ? [t.assigned_to] : [];
export const ownersOf = (o: Pick<Obligation, 'owner_ids' | 'owner_id'>) =>
  o.owner_ids?.length ? o.owner_ids : o.owner_id ? [o.owner_id] : [];

/** An obligation linked to a control (regulatory_links.py). */
export interface RegLink {
  id: number; obligation_id: number | null; target_type: string; target_id: number; target_ref: string | null;
  target_label: string | null; rationale: string | null; score: number | null;
  status: 'proposed' | 'confirmed' | 'rejected'; source: 'ai' | 'match' | 'manual'; decided_by: string | null;
}

export type Option = { value: string; label: string; tone: string };

export const CHANGE_STATUSES: Option[] = [
  { value: 'identified', label: 'Identified', tone: 'bg-teal-50 text-teal-700' },
  { value: 'under_assessment', label: 'Under assessment', tone: 'bg-amber-50 text-amber-700' },
  { value: 'implementation', label: 'Implementation', tone: 'bg-violet-50 text-violet-700' },
  { value: 'completed', label: 'Completed', tone: 'bg-emerald-50 text-emerald-700' },
  { value: 'not_applicable', label: 'Not applicable', tone: 'bg-slate-100 text-slate-600' },
];
export const PRIORITIES: Option[] = [
  { value: 'critical', label: 'Critical', tone: 'bg-rose-50 text-rose-700' },
  { value: 'high', label: 'High', tone: 'bg-orange-50 text-orange-700' },
  { value: 'medium', label: 'Medium', tone: 'bg-amber-50 text-amber-700' },
  { value: 'low', label: 'Low', tone: 'bg-teal-50 text-teal-700' },
];
export const TASK_STATUSES: Option[] = [
  { value: 'pending', label: 'Pending', tone: 'bg-slate-100 text-slate-700' },
  { value: 'in_progress', label: 'In progress', tone: 'bg-amber-50 text-amber-700' },
  { value: 'blocked', label: 'Blocked', tone: 'bg-rose-50 text-rose-700' },
  { value: 'completed', label: 'Completed', tone: 'bg-emerald-50 text-emerald-700' },
];
export const TASK_TYPES: Option[] = [
  { value: 'policy_update', label: 'Policy update', tone: 'bg-teal-50 text-teal-700' },
  { value: 'control_update', label: 'Control update', tone: 'bg-violet-50 text-violet-700' },
  { value: 'process_change', label: 'Process change', tone: 'bg-cyan-50 text-cyan-700' },
  { value: 'training', label: 'Training', tone: 'bg-emerald-50 text-emerald-700' },
  { value: 'communication', label: 'Communication', tone: 'bg-amber-50 text-amber-700' },
];
export const COMPLIANCE: Option[] = [
  { value: 'not_assessed', label: 'Not assessed', tone: 'bg-slate-100 text-slate-700' },
  { value: 'compliant', label: 'Compliant', tone: 'bg-emerald-50 text-emerald-700' },
  { value: 'partially_compliant', label: 'Partial', tone: 'bg-amber-50 text-amber-800' },
  { value: 'non_compliant', label: 'Non-compliant', tone: 'bg-rose-50 text-rose-700' },
  { value: 'not_applicable', label: 'N/A', tone: 'bg-slate-50 text-slate-500' },
];
export const OBLIGATION_TYPES = ['requirement', 'prohibition', 'reporting', 'deadline', 'governance', 'disclosure', 'record_keeping'];
export const IMPACT_LEVELS = PRIORITIES;

export const REGULATORS = [
  { value: 'SBP', label: 'SBP Circular', hint: 'State Bank of Pakistan' },
  { value: 'SAMA', label: 'SAMA Circular', hint: 'Saudi Central Bank' },
  { value: 'QCB', label: 'QCB Circular', hint: 'Qatar Central Bank' },
  { value: 'MAS', label: 'MAS Notice', hint: 'Monetary Authority of Singapore' },
  { value: 'NCA', label: 'NCA Circular', hint: 'National Cybersecurity Authority' },
  { value: 'OCC', label: 'OCC Bulletin', hint: 'US Comptroller of the Currency' },
  { value: 'Fed', label: 'Fed Guidance', hint: 'US Federal Reserve' },
  { value: 'EBA', label: 'EBA Guideline', hint: 'European Banking Authority' },
  { value: 'PRA', label: 'PRA Statement', hint: 'UK Prudential Regulation Authority' },
  { value: 'SEC', label: 'SEC Release', hint: 'US Securities & Exchange Commission' },
  { value: 'FINRA', label: 'FINRA Notice', hint: 'Financial Industry Regulatory Authority' },
  { value: 'custom', label: 'Other Circular', hint: 'Custom / other regulator' },
];
export const regulatorName = (source?: string | null) => REGULATORS.find((r) => r.value === source)?.hint || source || '—';

/** Where a link on the Overview lands: a tab, already filtered to what it named. */
export type TabFilter = { status?: string; control?: string; toCheck?: boolean; who?: string; late?: boolean; gapsOnly?: boolean };

export const words = (v?: string | null) => (v || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
export const toneOf = (list: Option[], value?: string | null) =>
  list.find((o) => o.value === value)?.tone || 'bg-slate-100 text-slate-700';
export const labelOf = (list: Option[], value?: string | null) => list.find((o) => o.value === value)?.label || words(value);

/** A date-only value ("2026-12-31") is a calendar day where you are, not midnight in London. */
const toDate = (v: string) => {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return day ? new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3])) : new Date(v);
};
export const fmtDate = (v?: string | null) =>
  v ? toDate(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const inDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return isoDay(d); };

/** Whole days from today to a date: negative once it has passed. */
export function daysUntil(v?: string | null): number | null {
  if (!v) return null;
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((day(toDate(v)) - day(new Date())) / 86400000);
}

/** "in 5 days", "today", "3 days late". */
export function dueIn(v?: string | null): { text: string; late: boolean } | null {
  const d = daysUntil(v);
  if (d === null) return null;
  if (d < 0) return { text: `${-d} day${d === -1 ? '' : 's'} late`, late: true };
  return { text: d === 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'}`, late: false };
}

export const apiError = (e: unknown, fallback = 'That did not save. Try again.') =>
  (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;

export const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20';

export function Pill({ tone, children, className = '' }: { tone: string; children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${tone} ${className}`}>
      {children}
    </span>
  );
}

const CHEVRON = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%2364748b'%3E%3Cpath d='M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4z'/%3E%3C/svg%3E\")";

/** A status changed in one click: a select dressed as its own pill. */
export function PillSelect({ value, options, onChange, label, disabled = false, size = 'sm' }: {
  value: string; options: Option[]; onChange: (v: string) => void; label: string; disabled?: boolean; size?: 'sm' | 'md';
}) {
  // A value from elsewhere (a legacy status) still shows as itself.
  if (value && !options.some((o) => o.value === value)) options = [{ value, label: words(value), tone: 'bg-slate-100 text-slate-700' }, ...options];
  return (
    <select
      value={value}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
      style={{ backgroundImage: CHEVRON, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.35rem center', backgroundSize: '0.8rem' }}
      className={`cursor-pointer appearance-none rounded-full border-0 font-medium focus:outline-none focus:ring-2 focus:ring-primary-500/30 disabled:cursor-default disabled:opacity-60 ${
        size === 'md' ? 'py-1 pl-3 pr-6 text-xs' : 'py-0.5 pl-2 pr-5 text-[11px]'} ${toneOf(options, value)}`}
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** A handful of choices, one click each. */
export function Segmented({ value, options, onChange, label }: {
  value: string; options: Option[]; onChange: (v: string) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
            className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
              on ? `${o.tone} ring-2 ring-primary-500/40` : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Field({ label, hint, children, className = '' }: {
  label: string; hint?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <div className={className}>
      <p className="mb-1 text-xs font-medium text-slate-600">{label}</p>
      {children}
      {hint && <p className="mt-1 text-[11px] text-slate-500">{hint}</p>}
    </div>
  );
}

/** Label and value, side by side, for the facts of a record. */
export function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-slate-900">{children}</dd>
    </div>
  );
}

/** "Are you sure?" before anything is deleted. */
export function ConfirmDialog({ open, title, message, confirmLabel = 'Delete', busy = false, onConfirm, onCancel }: {
  open: boolean; title: string; message: React.ReactNode; confirmLabel?: string; busy?: boolean;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <AnimatedModal isOpen={open} onClose={onCancel} title={title} size="md" footer={(
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Cancel
        </button>
        <button type="button" onClick={onConfirm} disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-60">
          {busy && <Loader2 className="h-4 w-4 animate-spin" />} {confirmLabel}
        </button>
      </div>
    )}>
      <div className="px-5 py-4 text-sm text-slate-600">{message}</div>
    </AnimatedModal>
  );
}

// ── The queries every tab shares ─────────────────────────────────────────────

export const useObligations = (changeId: number) => useQuery({
  queryKey: ['regulatory-obligations', changeId],
  queryFn: async () => ((await regulatoryApi.getObligations(changeId)).data?.items || []) as Obligation[],
});

export const useLinks = (changeId: number) => useQuery({
  queryKey: ['regulatory-links', changeId],
  queryFn: async () => ((await regulatoryApi.getLinks(changeId)).data?.items || []) as RegLink[],
});

export const useTasks = (changeId: number) => useQuery({
  queryKey: ['regulatory-tasks', changeId],
  queryFn: async () => ((await regulatoryApi.getTasks(changeId)).data || []) as Task[],
});

export const useAssessments = (changeId: number) => useQuery({
  queryKey: ['regulatory-assessments', changeId],
  queryFn: async () => ((await regulatoryApi.getAssessments(changeId)).data || []) as Assessment[],
});

/** People to pick from, and the departments they belong to. */
export function useUsers() {
  const { data = [] } = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => ((await adminApi.getUsers()).data || []) as Array<{ id: number; display_name: string; department?: string | null; email?: string }>,
    staleTime: 5 * 60 * 1000,
  });
  return useMemo(() => ({
    users: data,
    people: data.map((u) => ({ value: String(u.id), label: u.display_name, subLabel: u.department || u.email || undefined })),
    departments: Array.from(new Set(data.map((u) => (u.department || '').trim()).filter(Boolean))).sort()
      .map((d) => ({ value: d, label: d })),
  }), [data]);
}

// ── People ───────────────────────────────────────────────────────────────────

const FACE_TONES = ['bg-teal-100 text-teal-800', 'bg-violet-100 text-violet-800', 'bg-amber-100 text-amber-800',
  'bg-sky-100 text-sky-800', 'bg-rose-100 text-rose-800', 'bg-emerald-100 text-emerald-800'];

export function Face({ id, name, className = '' }: { id: number; name: string; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
  return (
    <span title={name} className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ring-2 ring-white ${FACE_TONES[id % FACE_TONES.length]} ${className}`}>
      {initials}
    </span>
  );
}

/** Who is on it: their faces and names; click to tick one or several. Each tick saves. */
export function PeoplePicker({ value, onChange, label, placeholder = 'Unassigned', block = false }: {
  value: number[]; onChange: (ids: number[]) => void; label: string; placeholder?: string;
  /** Fill the width, like a form field, instead of sitting inline in a row. */
  block?: boolean;
}) {
  const { users } = useUsers();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<number[]>(value);
  const [q, setQ] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  // Ticks accumulate while the list is open; the saved value is followed while it is shut.
  const shown = open ? draft : value;
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!trigger.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    const shut = () => setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key, true);      // before a popup's own Escape closes the popup
    window.addEventListener('resize', shut);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', shut);
    };
  }, [open]);

  const toggleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    const r = trigger.current?.getBoundingClientRect();
    if (r) {
      const up = window.innerHeight - r.bottom < 320;
      setPos({ top: up ? r.top - 6 : r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - 280)), up });
    }
    setDraft(value);
    setQ('');
    setOpen(true);
  };
  const tick = (id: number) => {
    const next = draft.includes(id) ? draft.filter((x) => x !== id) : [...draft, id];
    setDraft(next);
    onChange(next);
  };
  const byId = new Map(users.map((u) => [u.id, u]));
  const chosen = shown.map((id) => byId.get(id)).filter(Boolean) as typeof users;
  const needle = q.trim().toLowerCase();
  const list = users.filter((u) => !needle || `${u.display_name} ${u.department || ''}`.toLowerCase().includes(needle));

  return (
    <>
      <button ref={trigger} type="button" onClick={toggleOpen} aria-label={label} aria-haspopup="listbox" aria-expanded={open}
        className={`flex min-w-0 items-center gap-1.5 rounded-lg text-left text-xs transition-colors ${block
          ? 'w-full border border-slate-300 bg-white px-2.5 py-1.5 hover:border-slate-400'
          : 'max-w-full px-1.5 py-1 hover:bg-slate-100'} ${open ? 'ring-2 ring-primary-500/30' : ''}`}>
        {chosen.length === 0 ? (
          <span className="flex items-center gap-1.5 text-slate-400"><UserPlus className="h-3.5 w-3.5" /> {placeholder}</span>
        ) : (
          <>
            <span className="flex -space-x-1.5">
              {chosen.slice(0, 3).map((u) => <Face key={u.id} id={u.id} name={u.display_name} />)}
            </span>
            <span className="min-w-0 truncate text-slate-800">
              {chosen.length === 1 ? chosen[0].display_name : `${chosen[0].display_name.split(' ')[0]} +${chosen.length - 1}`}
            </span>
          </>
        )}
      </button>
      {open && pos && typeof document !== 'undefined' && createPortal(
        <div ref={pop} role="listbox" aria-multiselectable aria-label={label} onClick={(e) => e.stopPropagation()}
          style={{ top: pos.top, left: pos.left, transform: pos.up ? 'translateY(-100%)' : undefined }}
          className="fixed z-[9999] w-[17rem] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="relative border-b border-slate-100 p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people"
              className="w-full rounded-lg border border-slate-200 py-1.5 pl-7 pr-2 text-xs focus:border-primary-500 focus:outline-none" />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {list.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">No one matches.</li>}
            {list.map((u) => {
              const on = draft.includes(u.id);
              return (
                <li key={u.id}>
                  <button type="button" role="option" aria-selected={on} onClick={() => tick(u.id)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-50 ${on ? 'bg-primary-50/50' : ''}`}>
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? 'border-primary-600 bg-primary-600 text-white' : 'border-slate-300'}`}>
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <Face id={u.id} name={u.display_name} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-slate-800">{u.display_name}</span>
                      {u.department && <span className="block truncate text-[10px] text-slate-500">{u.department}</span>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between border-t border-slate-100 px-3 py-1.5 text-xs">
            <button type="button" disabled={draft.length === 0} onClick={() => { setDraft([]); onChange([]); }}
              className="text-slate-500 hover:text-rose-600 disabled:opacity-40">Clear</button>
            <button type="button" onClick={() => setOpen(false)} className="font-medium text-primary-700 hover:underline">Done</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
