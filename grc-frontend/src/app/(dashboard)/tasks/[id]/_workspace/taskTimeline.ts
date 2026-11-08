// A task's Activity, apart from React so `node --test` can pin it (taskTimeline.test.ts): the comments and the history of the task merged into ONE feed, newest first, and every history
// row said in words. The server stores a change as a field name and two values ("assigned_owner_id", "4" -> "7", "due_date", "2026-11-10 00:00:00"); the page says "changed the owners from
// Rana Shah to Omar Khan", "changed the due date from 3 Nov 2026 to 12 Nov 2026". No field name, no id, no Python text ("None", "True", "[1, 2]") reaches the screen (rule U1). The words
// are written for the actions the server writes (critical_tasks_router, governance/doc_lifecycle, regulatory_tasks, committee_tasks): taskTimeline.test.ts re-reads those files, so an
// action nobody listed fails a test until it is listed here.
import { formatDate, truncate } from '../../../../../lib/format.ts';
import { parseUtc } from '../../../../../lib/serverTime.ts';
import { statusPill } from '../../../../../lib/status.ts';
import { taskStatus } from '../../../../../lib/statuses/tasks.ts';
import type { ActivityFilter, HistoryRow } from './taskPageModel.ts';
import { personName, type TaskComment } from '../../tasksModel.ts';

/** a row of the feed: a comment as written, or a change in words after the person's name */
export interface FeedRow {
  key: string;
  kind: 'comment' | 'event';
  at: string | null;
  /** the person's name; null for the platform itself (an escalation, a repeat) */
  who: string | null;
  /** a comment: what was written. An event: "changed the owners from A to B" (starts with a verb, follows the name) */
  text: string;
}

const VALUE_MAX = 80;
const clip = (s: string) => truncate(s, VALUE_MAX).text;

/** what the field is called in a sentence */
const FIELD_WORDS: Record<string, string> = {
  title: 'title', description: 'description', source: 'source', source_module: 'source', source_entity_type: 'source', source_entity_id: 'source', priority: 'priority', severity: 'severity',
  category: 'category', assigned_owner_id: 'owners', assigned_user_ids: 'owners', reviewer_id: 'reviewer', due_date: 'due date', sla_days: 'SLA days', evidence_notes: 'notes',
  recurrence_pattern: 'repeat', recurrence_interval: 'repeat', recurrence: 'repeat', approval_required: 'approval requirement', approval_status: 'approval', approved_by_id: 'approver',
  custom_values: 'custom fields', status: 'status', escalation_level: 'escalation', linked_risk_id: 'linked risk', linked_control_id: 'linked control', linked_vulnerability_id: 'linked vulnerability',
  linked_framework_id: 'linked framework', linked_requirement_id: 'linked requirement', linked_regulatory_change_id: 'linked regulatory change', linked_issue_id: 'linked issue',
  source_entity: 'source',
};
const PEOPLE_FIELDS = ['assigned_owner_id', 'assigned_user_ids', 'reviewer_id', 'approved_by_id'];
/** fields whose values are not worth quoting: the sentence says that it changed (a description, notes, custom fields, ids of a record) */
const NO_VALUES = ['description', 'evidence_notes', 'custom_values', 'source_entity_id', 'source_entity_type', 'source_module', 'source_entity', 'linked_risk_id', 'linked_control_id', 'linked_vulnerability_id', 'linked_framework_id', 'linked_requirement_id', 'linked_regulatory_change_id', 'linked_issue_id'];

const blank = (v: string | null | undefined): boolean => v == null || v.trim() === '' || v.trim() === 'None';

/** a stored value as the platform would write it, or null for none */
function valueWords(field: string, raw: string | null | undefined, label: string | null | undefined): string | null {
  if (PEOPLE_FIELDS.includes(field)) return label && label !== 'Nobody' ? label : null;
  if (blank(raw)) return null;
  const v = (raw as string).trim();
  switch (field) {
    case 'due_date': return formatDate(v.slice(0, 10), { calendar: true, empty: '' }) || null;
    case 'status': return statusPill(taskStatus, v).label;
    case 'sla_days': return `${v} ${v === '1' ? 'day' : 'days'}`;
    case 'approval_required': return /^true$/i.test(v) ? 'required' : 'not required';
    case 'escalation_level': return `level ${v}`;
    case 'recurrence_pattern': return v.toLowerCase();
    default: return clip(v);
  }
}

/** "changed the due date from A to B", "set the due date to B", "removed the due date (it was A)" */
function change(field: string, from: string | null, to: string | null): string {
  const what = FIELD_WORDS[field] ?? field.replace(/_id$/, '').replace(/_/g, ' ');
  if (from && to) return `changed the ${what} from ${from} to ${to}`;
  if (to) return `set the ${what} to ${to}`;
  if (from) return `removed the ${what} (it was ${from})`;
  return `changed the ${what}`;
}

/** a "linked ..." field: the sentence knows only that one was set, cleared or swapped (the record's title is on the page's Linked rows) */
function linkChange(field: string, from: string | null | undefined, to: string | null | undefined): string {
  const what = (FIELD_WORDS[field] ?? 'link').replace(/^linked /, '');
  if (!blank(to) && blank(from)) return `linked a ${what}`;
  if (blank(to)) return `removed the linked ${what}`;
  return `changed the linked ${what}`;
}

const PLACES: Array<[RegExp, string]> = [
  [/governance documents?/i, 'a document request'], [/regulatory[ _]changes?/i, 'a regulatory change'], [/committees?/i, 'a committee action'], [/vendor/i, 'a vendor record'],
  [/issue/i, 'an issue'], [/workflow/i, 'a workflow'],
];
/** a module's name as it reads after "from": "a committee action" */
const placeOf = (module: string): string => PLACES.find(([re]) => re.test(module))?.[1] ?? `the ${module.replace(/_/g, ' ').toLowerCase()}`;

/** what one field change says, with the people's names the server resolved */
function fieldWords(h: HistoryRow): string {
  const field = h.field_changed ?? '';
  if (!field) return h.action.toLowerCase();
  if (field.startsWith('linked_')) return linkChange(field, h.old_value, h.new_value);
  if (field === 'title') return blank(h.old_value) || blank(h.new_value) ? 'renamed the task' : `renamed the task from “${clip(h.old_value as string)}” to “${clip(h.new_value as string)}”`;
  if (field === 'description') return 'edited the description';
  if (field === 'evidence_notes') return 'edited the notes';
  if (field === 'custom_values') return 'changed the custom fields';
  if (field === 'status') return `moved the task${valueWords('status', h.old_value, null) ? ` from ${valueWords('status', h.old_value, null)}` : ''} to ${valueWords('status', h.new_value, null) ?? 'a new status'}`;
  if (NO_VALUES.includes(field)) return `changed the ${FIELD_WORDS[field] ?? 'details'}`;
  return change(field, valueWords(field, h.old_value, h.old_label), valueWords(field, h.new_value, h.new_label));
}

/** One history row in words, or null when the feed leaves it out (a comment is its own row). The sentence follows the person's name: "changed the owners from A to B". */
export function historyWords(h: HistoryRow): string | null {
  const action = h.action.trim();
  if (action === 'Comment Added') return null;
  if (action === 'Created') return 'created the task';
  if (action === 'Created from Template') return `created the task from ${blank(h.new_value) || h.new_value === 'custom' ? 'a template' : `the template “${clip(h.new_value as string)}”`}`;
  const created = /^Created from (.+)$/.exec(action);
  if (created) return `created the task from ${placeOf(created[1])}`;
  if (action === 'Sub-task Added') return `added the sub-task “${clip(h.new_value ?? '')}”`;
  if (action === 'Approval Requested') return 'asked for approval';
  if (action === 'Approved') return 'approved the task';
  if (action === 'Rejected') return 'refused the approval';
  if (action === 'Auto-Escalated') return `raised the escalation to level ${blank(h.new_value) ? 'higher' : h.new_value}`;
  if (action === 'Auto-Created') {
    const again = /^Repeated from [“"](.*)[”"]$/.exec((h.new_value ?? '').trim());
    return again ? `created this task because “${clip(again[1])}” repeats` : 'created this task because the one before it repeats';
  }
  if (action === 'Completed in the document') return 'completed the request in the document';
  if (/^Reopened: complete this in the document/i.test(action)) return 'reopened the request: it is completed in the document';
  const synced = /^Synced from (.+)$/.exec(action);
  if (synced) return `${fieldWords(h)} (from ${placeOf(synced[1])})`;
  // Updated, Status Changed, Bulk Update, Bulk Assign, Bulk Status Change, and any action nobody listed: the change itself
  if (h.field_changed) return fieldWords(h);
  return action.charAt(0).toLowerCase() + action.slice(1);
}

const at = (iso: string | null | undefined): number => parseUtc(iso)?.getTime() ?? Number.NEGATIVE_INFINITY;

/** The feed, newest first: the comments, and with `all` the changes too. A change that only says a comment was added is left out (the comment is the row). */
export function feedOf(task: { comments?: readonly TaskComment[] | null; history?: readonly HistoryRow[] | null }, filter: ActivityFilter): FeedRow[] {
  const rows: Array<FeedRow & { time: number; order: number }> = [];
  (task.comments ?? []).forEach((c) => rows.push({ key: `c${c.id}`, kind: 'comment', at: c.created_at, who: personName(c.user), text: c.content, time: at(c.created_at), order: c.id }));
  if (filter === 'all') {
    (task.history ?? []).forEach((h) => {
      const words = historyWords(h);
      if (words) rows.push({ key: `h${h.id}`, kind: 'event', at: h.created_at, who: personName(h.user), text: words, time: at(h.created_at), order: h.id });
    });
  }
  rows.sort((a, b) => b.time - a.time || b.order - a.order);
  return rows.map((r) => ({ key: r.key, kind: r.kind, at: r.at, who: r.who, text: r.text }));
}

/** how many rows each filter holds (the comments, and everything with the changes that are shown) */
export function feedCounts(task: { comments?: readonly TaskComment[] | null; history?: readonly HistoryRow[] | null }): { comments: number; all: number } {
  return { comments: (task.comments ?? []).length, all: feedOf(task, 'all').length };
}
