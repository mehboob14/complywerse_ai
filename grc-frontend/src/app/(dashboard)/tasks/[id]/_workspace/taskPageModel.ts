// The rules of a task's page, apart from React so `node --test` can pin them (taskPageModel.test.ts): what the page reads, who the in-place editors are open to (the rights the page has
// always checked, nothing new), the body each editor sends, what the approval part of the rail offers to WHOM (what the SERVER lets act today, taskRecord.mayDecide), the one line of facts
// under the title, the progress of the sub-tasks and where an old ?tab= address lands. Nothing here decides who may do what: the server does; where a rule copies it, the copy says so.
import type { FieldDef } from '../../../../../components/settings/CustomFields.tsx';
import { canDeleteTask, isDocumentTask } from '../../../../../lib/documentTasks.ts';
import { formatDate } from '../../../../../lib/format.ts';
import { norm } from '../../../../../lib/status.ts';
import { KIND_LABEL, kindOf, mayDecide, sourceLink, type LinkedRecord } from '../../taskRecord.ts';
import { personName, titleProblem, type TaskDetail, type TaskUser } from '../../tasksModel.ts';

// ── what the page reads ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** One row of the task's history as the page gets it: the values as the server stored them, and the words for the people in them (`old_label`/`new_label`: "Rana Shah", "Nobody"). */
export interface HistoryRow {
  id: number;
  action: string;
  field_changed: string | null;
  old_value: string | null;
  new_value: string | null;
  old_label?: string | null;
  new_label?: string | null;
  user: TaskUser | null;
  created_at: string | null;
}

/** `GET /critical-tasks/{id}`: the task, and what the server resolves for the page (where it came from, the titles of what it is linked to, the custom values, the history with names). */
export interface TaskPageData extends Omit<TaskDetail, 'history'> {
  history: HistoryRow[];
  links?: LinkedRecord[];
  source_label?: string | null;
  source_href?: string | null;
  custom_values?: Record<string, unknown> | null;
  linked_framework_id?: number | null;
  linked_requirement_id?: number | null;
}

// ── who may use the editors ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface RailRights {
  /** the property editors (the Edit button's literal, `tasks:task_management:edit`: administrators in effect; the server lets any viewer: recorded for the owner) */
  edit: boolean;
  /** a document request's task keeps its person, its due date and its status: they follow the request (the server refuses a change) */
  ownersLocked: boolean;
  dueLocked: boolean;
  statusLocked: boolean;
  /** Delete: the right to delete; a document request's task only administrators */
  canDelete: boolean;
}

export function railRights(task: Parameters<typeof isDocumentTask>[0], who: { canEdit: boolean; canDelete: boolean; isAdmin: boolean }): RailRights {
  const doc = isDocumentTask(task);
  return { edit: who.canEdit, ownersLocked: doc, dueLocked: doc, statusLocked: doc, canDelete: canDeleteTask(task, { isAdmin: who.isAdmin, hasDeleteRight: who.canDelete }) };
}

// ── the bodies the editors send (PUT /critical-tasks/{id}: only the fields that changed) ───────────────────────────────────────────────────
/** The owners: the server's canonical list. It keeps the legacy single owner equal to the first (and clears it for an empty list). */
export const ownersPatch = (ids: readonly string[]): { assigned_user_ids: number[] } => ({ assigned_user_ids: ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) });

export const reviewerPatch = (id: string | null): { reviewer_id: number | null } => ({ reviewer_id: id ? Number(id) : null });

/** The due DAY as the date input holds it ("2026-11-12"), or null for none. */
export const duePatch = (day: string): { due_date: string | null } => ({ due_date: day.trim() ? day.trim() : null });

/** Why SLA days cannot be saved, or null: empty clears them; otherwise a whole number of at least 1. */
export function slaDaysProblem(text: string): string | null {
  if (!text.trim()) return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= 3650 ? null : 'Enter a whole number of days, 1 or more';
}
export const slaDaysPatch = (text: string): { sla_days: number | null } => ({ sla_days: text.trim() ? Number(text) : null });

export const REPEATS = [{ value: 'daily', label: 'Daily', unit: 'day' }, { value: 'weekly', label: 'Weekly', unit: 'week' }, { value: 'monthly', label: 'Monthly', unit: 'month' }, { value: 'quarterly', label: 'Quarterly', unit: 'quarter' }] as const;

/** How a task repeats, in words ("Every month", "Every 2 weeks"), or null for a task that does not. */
export function repeatWords(pattern: string | null | undefined, interval: number | null | undefined): string | null {
  if (!pattern) return null;
  const unit = REPEATS.find((r) => r.value === pattern)?.unit ?? pattern;
  const n = interval && interval > 1 ? interval : 1;
  return n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
}

/** Clearing a repeat sends the pattern alone (the interval is left as it was); setting one sends both, the interval a whole number of at least 1. */
export function recurrencePatch(pattern: string, interval: string): { recurrence_pattern: string | null; recurrence_interval?: number } {
  if (!pattern) return { recurrence_pattern: null };
  return { recurrence_pattern: pattern, recurrence_interval: Math.max(1, Math.floor(Number(interval)) || 1) };
}

export const approvalRequiredPatch = (on: boolean): { approval_required: boolean } => ({ approval_required: on });

export interface DetailsForm { title: string; description: string; evidence_notes: string }
export const detailsOf = (task: Pick<TaskPageData, 'title' | 'description' | 'evidence_notes'>): DetailsForm => ({ title: task.title, description: task.description ?? '', evidence_notes: task.evidence_notes ?? '' });

export const detailsDirty = (now: DetailsForm, start: DetailsForm): boolean => now.title !== start.title || now.description !== start.description || now.evidence_notes !== start.evidence_notes;

/** Why the details cannot be saved (the title: not empty, 255 at most), or null. */
export const detailsProblem = (now: DetailsForm): string | null => titleProblem(now.title);

/** Only what changed: the title trimmed, an emptied description or note as null (what the old Edit form sent). */
export function detailsPatch(now: DetailsForm, start: DetailsForm): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  if (now.title !== start.title) out.title = now.title.trim();
  if (now.description !== start.description) out.description = now.description.trim() ? now.description : null;
  if (now.evidence_notes !== start.evidence_notes) out.evidence_notes = now.evidence_notes.trim() ? now.evidence_notes : null;
  return out;
}

export interface LinkIds { risk: string; control: string; vulnerability: string }
export const linkIdsOf = (task: Pick<TaskPageData, 'linked_risk_id' | 'linked_control_id' | 'linked_vulnerability_id'>): LinkIds => ({
  risk: task.linked_risk_id ? String(task.linked_risk_id) : '',
  control: task.linked_control_id ? String(task.linked_control_id) : '',
  vulnerability: task.linked_vulnerability_id ? String(task.linked_vulnerability_id) : '',
});

/** The links that changed, as ids (null clears one): the three records the old Edit form linked. */
export function linksPatch(now: LinkIds, start: LinkIds): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  (['risk', 'control', 'vulnerability'] as const).forEach((k) => { if (now[k] !== start[k]) out[`linked_${k}_id`] = now[k] ? Number(now[k]) : null; });
  return out;
}

// ── the approval part of the rail ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface ApprovalView {
  state: 'not_needed' | 'not_requested' | 'pending' | 'approved' | 'rejected';
  /** Request approval (again): the server accepts it from anyone who can see the task, so every viewer is offered it; not on a task that is finished (Verified) */
  canRequest: boolean;
  requestLabel: string;
  /** the status the request is for: the next gate (Under Review -> Completed, Completed -> Verified); the server's own default (Completed) otherwise */
  requestFor?: string;
  /** Approve and Reject: only the reviewer who is not the owner (what the server lets act; an administrator who is not the reviewer is refused today) */
  canDecide: boolean;
  /** in words, why a pending approval has no button for this person; null when there is none to explain */
  note: string | null;
}

export function approvalView(task: Pick<TaskPageData, 'approval_required' | 'approval_status' | 'status' | 'reviewer_id' | 'reviewer' | 'assigned_owner_id'>, me: number | null): ApprovalView {
  if (!task.approval_required) return { state: 'not_needed', canRequest: false, requestLabel: '', canDecide: false, note: null };
  const status = task.approval_status;
  const state = status === 'Pending' ? 'pending' : status === 'Approved' ? 'approved' : status === 'Rejected' ? 'rejected' : 'not_requested';
  const from = norm(task.status);
  const finished = from === 'verified';
  const canRequest = !finished && (state === 'not_requested' || state === 'rejected');
  const canDecide = state === 'pending' && mayDecide(task, me);
  let note: string | null = null;
  if (state === 'pending' && !canDecide) {
    const reviewer = personName(task.reviewer);
    if (!task.reviewer_id) note = 'No reviewer is set, so nobody can approve it. Choose a reviewer first.';
    else if (me != null && task.reviewer_id === me) note = 'You own this task, so another person has to approve it.';
    else note = `Waiting for ${reviewer ?? 'the reviewer'} to approve it.`;
  }
  return { state, canRequest, requestLabel: state === 'rejected' ? 'Request approval again' : 'Request approval', requestFor: from === 'under_review' ? 'Completed' : from === 'completed' ? 'Verified' : undefined, canDecide, note };
}

// ── the head ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** One line of facts under the title, in words: where it came from, its category, who made it and when, an escalation. */
export function factsLine(task: Pick<TaskPageData, 'source_module' | 'source_entity_type' | 'document_request' | 'linked_regulatory_change_id' | 'source_label' | 'category' | 'created_by' | 'created_at' | 'escalation_level'>): string {
  const kind = kindOf(task);
  const from = task.source_label || (kind === 'task' ? null : KIND_LABEL[kind]);
  const by = personName(task.created_by);
  const made = task.created_at ? `Made${by ? ` by ${by}` : ''} on ${formatDate(task.created_at)}` : by ? `Made by ${by}` : null;
  const level = task.escalation_level > 0 ? `Escalated to level ${task.escalation_level}` : null;
  return [from, task.category, made, level].filter(Boolean).join(' · ');
}

export interface SubTaskProgress { done: number; total: number; percent: number }
/** How many sub-tasks are ticked (status Completed). */
export function subTaskProgress(subs: ReadonlyArray<{ status: string }> | null | undefined): SubTaskProgress {
  const list = subs ?? [];
  const done = list.filter((s) => s.status === 'Completed').length;
  return { done, total: list.length, percent: list.length ? Math.round((done / list.length) * 100) : 0 };
}

// ── the address ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type ActivityFilter = 'all' | 'comments';
export const SECTION_IDS = { details: 'task-description', subtasks: 'task-subtasks', activity: 'task-activity' } as const;

/** Where an old `?tab=` address lands: the section of the page that holds what the tab held (the tabs are gone, the addresses keep working). */
export function anchorOf(tab: string | null | undefined): { id: string; filter?: ActivityFilter } | null {
  switch ((tab ?? '').trim().toLowerCase()) {
    case 'details':
    case 'evidence': return { id: SECTION_IDS.details };
    case 'subtasks': return { id: SECTION_IDS.subtasks };
    case 'comments': return { id: SECTION_IDS.activity, filter: 'comments' };
    case 'history': return { id: SECTION_IDS.activity, filter: 'all' };
    default: return null;
  }
}

/** The task's source for the rail: the server's label and page, else what the row says (taskRecord.sourceLink). */
export const sourceOf = (task: Parameters<typeof sourceLink>[0]) => sourceLink(task);

// ── the organization's own fields ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface CustomFact { key: string; label: string; /** null: no value (the page says so) */ text: string | null; removed: boolean }

const blankValue = (v: unknown): boolean => v == null || v === '' || (Array.isArray(v) && v.length === 0);

/** The custom fields of the task as label and value in words: the fields the organization has (in its order), plus a removed field that still holds a value (marked); a person field by name, a
 *  yes/no as Yes or No, a date as the platform writes it, a list as its items. `nameOf` says who a person field points at (null when unknown: shown as no value, never an id). */
export function customFacts(fields: readonly FieldDef[] | null | undefined, values: Record<string, unknown> | null | undefined, nameOf: (id: number) => string | null): CustomFact[] {
  const held = values ?? {};
  return (fields ?? [])
    .filter((f) => !f.archived || !blankValue(held[f.key]))
    .slice()
    .sort((a, b) => Number(!!a.archived) - Number(!!b.archived) || a.order - b.order)
    .map((f) => {
      const v = held[f.key];
      let text: string | null = null;
      if (!blankValue(v)) {
        if (Array.isArray(v)) text = v.map(String).join(', ');
        else if (typeof v === 'boolean') text = v ? 'Yes' : 'No';
        else if (f.type === 'user') text = nameOf(Number(v));
        else if (f.type === 'date') text = formatDate(String(v), { calendar: true, empty: '' }) || String(v);
        else text = String(v);
      }
      return { key: f.key, label: f.label, text, removed: !!f.archived };
    });
}

// ── a sub-task ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface SubForm { title: string; owner: string; due: string }
export const emptySub = (): SubForm => ({ title: '', owner: '', due: '' });
export const subFormOf = (s: { title: string; assigned_owner_id: number | null; due_date: string | null }): SubForm => ({ title: s.title, owner: s.assigned_owner_id ? String(s.assigned_owner_id) : '', due: s.due_date ? s.due_date.slice(0, 10) : '' });

/** Why a sub-task cannot be saved (its title: not empty, 255 at most), or null. */
export const subProblem = (form: SubForm): string | null => titleProblem(form.title, 'sub-task title');

/** A new sub-task: the trimmed title, and the owner and the day only when chosen (what the API takes). */
export function subCreateBody(form: SubForm): { title: string; assigned_owner_id?: number; due_date?: string } {
  return { title: form.title.trim(), ...(form.owner ? { assigned_owner_id: Number(form.owner) } : {}), ...(form.due ? { due_date: form.due } : {}) };
}

/** What changed on a sub-task, as the update sends it: the title trimmed, an emptied owner or day as null. */
export function subPatch(now: SubForm, start: SubForm): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  if (now.title !== start.title) out.title = now.title.trim();
  if (now.owner !== start.owner) out.assigned_owner_id = now.owner ? Number(now.owner) : null;
  if (now.due !== start.due) out.due_date = now.due || null;
  return out;
}

/** The checklist in the order it was made (the server sends no order): oldest first, then by id. */
export function sortSubTasks<T extends { id: number; created_at: string | null }>(subs: readonly T[] | null | undefined): T[] {
  const at = (s: T) => { const t = s.created_at ? Date.parse(/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(s.created_at) ? s.created_at : `${s.created_at}Z`) : NaN; return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t; };
  return (subs ?? []).slice().sort((a, b) => at(a) - at(b) || a.id - b.id);
}
