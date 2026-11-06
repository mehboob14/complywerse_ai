// The rules of the Task Management pages, apart from React so `node --test` can pin them (tasksModel.test.ts): the words and lists the pages offer, what lives in the
// address, the exact list request, how a form becomes the payload the server has always been sent (moved from the old pages and checked against frozen copies of them),
// the Kanban grouping, what a bulk write says, the counts of My Tasks and of the Reports, and the limits the table holds (a title is VARCHAR(255)).
// Nothing here decides who may do what: the rights stay where the pages check them.
import { flag, integer, oneOf, sortOf, text, type AddressState } from '../../../lib/addressState.ts';
import { isDocumentTask, withoutLocked, type DocumentRequest } from '../../../lib/documentTasks.ts';
import { norm } from '../../../lib/status.ts';
import type { SortState } from '../../../components/ui/ds/tableModel.ts';

// ── what a task row carries (the fields the pages read) ──────────────────────────────────────────────────────────────────────────────────
export interface TaskUser { id: number; username?: string | null; display_name: string | null; email: string }

export interface TaskRow {
  id: number;
  title: string;
  description: string | null;
  source: string;
  source_module: string | null;
  linked_regulatory_change_id?: number | null;
  document_request?: DocumentRequest | null;
  source_entity_id: number | null;
  source_entity_type: string | null;
  priority: string;
  severity: string | null;
  status: string;
  category: string;
  assigned_owner_id: number | null;
  /** everyone on the task (the server sends them next to the legacy single owner) */
  assignees?: TaskUser[];
  assigned_user_ids?: number[];
  reviewer_id: number | null;
  created_by_id: number | null;
  due_date: string | null;
  sla_days: number | null;
  sla_status: string;
  escalation_level: number;
  completed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  assigned_owner: TaskUser | null;
  reviewer: TaskUser | null;
  created_by: TaskUser | null;
}

export interface TaskListResponse {
  items: TaskRow[];
  total: number;
  /** 'mine': the tasks the person takes part in (owner, assignee, reviewer, creator); 'all': an administrator or view_all */
  scope?: 'all' | 'mine';
  /** with 'mine': the owners of the person's tasks, for the Owner filter */
  owners?: TaskUser[];
}

// ── the words and lists ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** the create form's own lists (unchanged); the tenant can replace them in Settings (listOptions) */
export const SOURCES = ['Audit', 'Risk', 'Compliance', 'Vulnerability', 'Manual'];
export const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
export const STATUSES = ['Open', 'In Progress', 'Under Review', 'Completed', 'Verified', 'Reopened'];
export const CATEGORIES = ['Remediation', 'Implementation', 'Review', 'Reporting', 'Other'];
export const SOURCE_MODULES = ['Audit Findings', 'Risk Register', 'Compliance Assessment', 'Vulnerability Scan', 'Manual'];
export const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];

/** The `source` words other modules write (backend: doc_lifecycle.py, committee_tasks.py, regulatory_tasks.py, tpra/findings.py, tpra/service.py, issue_management/routers/
 *  actions.py, workflow_engine/services/action_handlers.py); the board's Source filter lists them so the tasks that exist can be found. tasksModel.test.ts re-reads those files. */
export const SYSTEM_SOURCES = ['Governance document', 'Committee Action', 'Regulatory Change', 'Vendor Finding', 'Vendor Approval', 'Issue Management', 'Workflow'];
/** the categories those modules write (document tasks: the Governance setting, default Compliance; committee actions: Governance) */
export const SYSTEM_CATEGORIES = ['Compliance', 'Governance'];
export const FILTER_SOURCES: string[] = SOURCES.concat(SYSTEM_SOURCES);
export const FILTER_CATEGORIES: string[] = CATEGORIES.concat(SYSTEM_CATEGORIES);

/** A task has the status steps the server allows (critical_tasks_router.VALID_TRANSITIONS; the test compares them). */
export const VALID_TRANSITIONS: Record<string, string[]> = {
  Open: ['In Progress'],
  'In Progress': ['Under Review', 'Open'],
  'Under Review': ['Completed', 'In Progress', 'Reopened'],
  Completed: ['Verified', 'Reopened'],
  Verified: ['Reopened'],
  Reopened: ['In Progress'],
};

/** The steps a task's page offers: none for a document task (it closes by itself when the person does the step in the document). */
export function allowedTransitions(task: { status: string } & Parameters<typeof isDocumentTask>[0]): string[] {
  return isDocumentTask(task) ? [] : VALID_TRANSITIONS[task.status] || [];
}

/** a title is VARCHAR(255) in grc_critical_tasks and grc_critical_task_subtasks: a longer one is a bare 500 from the server */
export const TITLE_MAX = 255;

/** Why a title cannot be sent, or null: nothing typed, or longer than the table holds. */
export function titleProblem(title: string, noun = 'title'): string | null {
  if (title.trim() === '') return `Enter a ${noun}`;
  if (title.length > TITLE_MAX) return `A ${noun} can be ${TITLE_MAX} characters at most. This one has ${title.length}.`;
  return null;
}

// ── tabs ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const TASK_TABS = ['board', 'my-tasks', 'sla', 'reports'] as const;
export type TaskTab = (typeof TASK_TABS)[number];
/** an old name for a tab: the "Settings" tab is the one called `sla` */
export const TAB_ALIASES: Readonly<Record<string, TaskTab>> = { settings: 'sla', mine: 'my-tasks', report: 'reports' };
export const TAB_LABELS: Record<TaskTab, string> = { board: 'Task Board', 'my-tasks': 'My Tasks', sla: 'Settings', reports: 'Reports' };

export const DETAIL_TABS = ['details', 'subtasks', 'comments', 'evidence', 'history'] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];

// ── the board in the address ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** the columns the server can sort by (critical_tasks_router.SORTABLE_COLUMNS) */
export const SORT_KEYS = ['created_at', 'updated_at', 'title', 'priority', 'status', 'due_date', 'source', 'category'];
/** what the list was in before anyone sorted it: newest first */
export const DEFAULT_SORT = { key: 'created_at', dir: 'desc' } as const;
export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 50;
/** the Kanban loads one request of this many: the server's own default, what the board always showed (it does not page) */
export const KANBAN_LIMIT = 100;

export const BOARD_SCHEMA = {
  q: text(),
  source: text(),
  priority: text(),
  status: text(),
  category: text(),
  owner: text(),
  sort: sortOf(SORT_KEYS, DEFAULT_SORT),
  page: integer(1, { min: 1 }),
  size: integer(DEFAULT_PAGE_SIZE, { min: 1, max: 100 }),
  view: oneOf(['table', 'kanban'] as const, 'table'),
  mine: flag(),
};
export type BoardState = AddressState<typeof BOARD_SCHEMA>;

/** a page size the pager offers: anything else in the address is the default */
export const pageSizeOf = (n: number): number => ((PAGE_SIZES as readonly number[]).indexOf(n) >= 0 ? n : DEFAULT_PAGE_SIZE);

/** how many filters are on (the Clear button and the "no match" state read it) */
export function filterCount(s: Pick<BoardState, 'q' | 'source' | 'priority' | 'status' | 'category' | 'owner'>): number {
  return [s.q.trim(), s.source, s.priority, s.status, s.category, s.owner].filter(Boolean).length;
}

/** The request the board sends: what it always sent (sort_by, sort_order, and each filter that is set, named as the server names it), now with the page it shows. */
export function listParams(s: Pick<BoardState, 'q' | 'source' | 'priority' | 'status' | 'category' | 'owner' | 'sort' | 'view' | 'page' | 'size'>): Record<string, unknown> {
  const sort = s.sort ?? DEFAULT_SORT;
  const params: Record<string, unknown> = { sort_by: sort.key, sort_order: sort.dir };
  if (s.q) params.search = s.q;
  if (s.source) params.source = s.source;
  if (s.priority) params.priority = s.priority;
  if (s.status) params.status = s.status;
  if (s.category) params.category = s.category;
  if (s.owner) params.assigned_owner_id = s.owner;
  if (s.view === 'kanban') {
    params.skip = 0;
    params.limit = KANBAN_LIMIT;
  } else {
    const size = pageSizeOf(s.size);
    params.skip = (Math.max(1, s.page) - 1) * size;
    params.limit = size;
  }
  return params;
}

/** the sort the header asks for becomes the address: clearing a column's sort returns to the default order (newest first) */
export const sortFromHeader = (next: SortState): { key: string; dir: 'asc' | 'desc' } => next ?? { ...DEFAULT_SORT };

/** The last page there is for `total` rows (never less than 1): a filter that leaves fewer pages than the address says is not an empty page. */
export function lastPage(total: number, size: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, size)));
}

/** Whether a list holds fewer rows than the server has, and how many of each. The Kanban says "Showing the first 100 of 184". */
export function coverage(loaded: number, total: number | null | undefined): { loaded: number; total: number; cut: boolean } {
  const all = typeof total === 'number' && Number.isFinite(total) ? total : loaded;
  return { loaded, total: Math.max(all, loaded), cut: all > loaded };
}

// ── Kanban ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** One column per status of the workflow; a task whose status is none of them (a module wrote its own word) goes in `other`, never nowhere. */
export function kanbanColumns<T extends { status: string }>(tasks: readonly T[]): { columns: Array<{ status: string; tasks: T[] }>; other: T[] } {
  const columns = STATUSES.map((status) => ({ status, tasks: [] as T[] }));
  const other: T[] = [];
  tasks.forEach((task) => {
    const column = columns.filter((c) => norm(c.status) === norm(task.status))[0];
    if (column) column.tasks.push(task);
    else other.push(task);
  });
  return { columns, other };
}

// ── the people of a task ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export const personName = (u: Pick<TaskUser, 'display_name' | 'username' | 'email'> | null | undefined): string | null => u?.display_name || u?.username || u?.email || null;

/** Everyone on the task, by name, the owner first (what the Owner column has always shown) and then the other assignees the server lists: editing a task's owner changes the
 *  owner but not the assignee list (the server syncs only the other way), so the two can differ and both are on the task. An older answer without `assignees` has the owner alone. */
export function assigneeNames(task: Pick<TaskRow, 'assignees' | 'assigned_owner'>): string[] {
  const owner = task.assigned_owner;
  const names: string[] = [];
  const first = personName(owner);
  if (first) names.push(first);
  (task.assignees ?? []).forEach((u) => {
    const name = personName(u);
    if (name && !(owner && u.id === owner.id)) names.push(name);
  });
  return names;
}

/** A task as its own page reads it: the list's fields and the rest of the record (people, links, approval, recurrence, sub-tasks, comments, history). */
export interface SubTask { id: number; title: string; status: string; assigned_owner_id: number | null; assigned_owner: TaskUser | null; due_date: string | null; completed_at: string | null; created_at: string | null }
export interface TaskComment { id: number; content: string; user: TaskUser | null; created_at: string | null }
export interface TaskHistoryEntry { id: number; action: string; field_changed: string | null; old_value: string | null; new_value: string | null; user: TaskUser | null; created_at: string | null }
export interface TaskDetail extends TaskRow {
  tenant_id: number;
  linked_risk_id: number | null;
  linked_control_id: number | null;
  linked_finding_id: number | null;
  linked_vulnerability_id: number | null;
  linked_issue_id?: number | null;
  evidence_notes: string | null;
  verified_at: string | null;
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
}

/** A person as a choice in a list (the Owner filter, the owners and reviewer pickers): the name the old pickers showed, the e-mail under it. */
export interface PersonOption { value: string; label: string; description?: string }
export function userOptions(users: readonly TaskUser[] | null | undefined): PersonOption[] {
  return (users ?? []).map((u) => ({ value: String(u.id), label: u.display_name || u.username || u.email || `User #${u.id}`, description: u.email || undefined }));
}

// ── the create form (moved from tasks/page.tsx; `createPayload` is what handleCreate sent) ────────────────────────────────────────────────
export type SlaLevel = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface NewTaskForm {
  title: string; description: string; source: string; priority: string; severity: string; category: string;
  /** the legacy single owner; the server reads `assigned_user_ids` and syncs this to its first entry */
  assigned_owner_id: string;
  assigned_user_ids: string[];
  reviewer_id: string; due_date: string; sla_level: SlaLevel | ''; sla_days: string; evidence_notes: string;
  source_module: string; source_entity_type: string;
  linked_risk_id: string; linked_control_id: string; linked_vulnerability_id: string;
  linked_regulatory_change_id: string; linked_committee_id: string;
  linked_framework_id: string; linked_requirement_id: string;
  recurrence_pattern: string; recurrence_interval: string; approval_required: boolean;
}

export const emptyTask = (): NewTaskForm => ({
  title: '', description: '', source: 'Manual', priority: 'Medium', severity: '', category: 'Other',
  assigned_owner_id: '', assigned_user_ids: [],
  reviewer_id: '', due_date: '', sla_level: '', sla_days: '', evidence_notes: '',
  source_module: '', source_entity_type: '',
  linked_risk_id: '', linked_control_id: '', linked_vulnerability_id: '',
  linked_regulatory_change_id: '', linked_committee_id: '',
  linked_framework_id: '', linked_requirement_id: '',
  recurrence_pattern: '', recurrence_interval: '1', approval_required: false,
});

/** Whether the person has typed or chosen anything (the drawer then asks before it closes). */
export function formDirty(form: NewTaskForm, custom: Record<string, unknown> = {}): boolean {
  const blank = emptyTask();
  const same = (Object.keys(blank) as Array<keyof NewTaskForm>).every((k) => JSON.stringify(form[k]) === JSON.stringify(blank[k]));
  return !same || Object.keys(custom).length > 0;
}

/** The payload of Create Task, exactly as handleCreate built it: the owners as numbers (the first one also as the legacy owner), the reviewer, SLA days and every link as
 *  numbers, empty fields left out, the recurrence interval only with a pattern. `custom` is the custom fields' values as the settings editor saved them (or undefined). */
export function createPayload(form: NewTaskForm, custom?: Record<string, unknown>): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...form };
  const assignedIds = (form.assigned_user_ids || []).map(Number).filter((n) => !Number.isNaN(n) && n > 0);
  if (assignedIds.length > 0) {
    payload.assigned_user_ids = assignedIds;
    payload.assigned_owner_id = assignedIds[0];
  } else if (payload.assigned_owner_id) {
    payload.assigned_owner_id = Number(payload.assigned_owner_id);
  } else {
    delete payload.assigned_owner_id;
    delete payload.assigned_user_ids;
  }
  if (payload.reviewer_id) payload.reviewer_id = Number(payload.reviewer_id);
  else delete payload.reviewer_id;
  delete payload.sla_level;                                          // a helper of the form: it resolves to sla_days
  if (payload.sla_days) payload.sla_days = Number(payload.sla_days);
  else delete payload.sla_days;
  if (!payload.source_module) delete payload.source_module;
  if (!payload.source_entity_type) delete payload.source_entity_type;
  ['linked_risk_id', 'linked_control_id', 'linked_vulnerability_id', 'linked_regulatory_change_id', 'linked_committee_id', 'linked_framework_id', 'linked_requirement_id'].forEach((k) => {
    if (payload[k]) payload[k] = Number(payload[k]);
    else delete payload[k];
  });
  if (!payload.due_date) delete payload.due_date;
  if (!payload.severity) delete payload.severity;
  if (!payload.evidence_notes) delete payload.evidence_notes;
  if (payload.recurrence_pattern) {
    payload.recurrence_interval = Number(payload.recurrence_interval) || 1;
  } else {
    delete payload.recurrence_pattern;
    delete payload.recurrence_interval;
  }
  if (!payload.approval_required) delete payload.approval_required;
  if (custom) payload.custom_values = custom;
  return payload;
}

// ── the record pickers of the create and edit forms ────────────────────────────────────────────────────────────────────────────────────
export interface PickerOption { id: number; label: string }
export type PickerKind = 'risk' | 'control' | 'vulnerability' | 'regulatory' | 'committee';

/** a list the server answers as an array or as `{ items }` */
export function rowsOf(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  const items = (value as Record<string, unknown> | undefined)?.items;
  return Array.isArray(items) ? (items as Record<string, unknown>[]) : [];
}

/** The picker options of a record list, labelled the way the old pages labelled them (a record with no id is left out). */
export function pickerOptions(kind: PickerKind, rows: Record<string, unknown>[]): PickerOption[] {
  const out: PickerOption[] = [];
  rows.forEach((r) => {
    const id = Number(r.id);
    if (!id) return;
    let label: string;
    if (kind === 'risk') label = String(r.title || r.name || r.risk_event || r.risk_description || `Risk #${id}`);
    else if (kind === 'control') label = `${r.control_id ? `${String(r.control_id)} - ` : ''}${String(r.name || r.control_name || r.title || `Control #${id}`)}`;
    else if (kind === 'vulnerability') label = String(r.title || r.vulnerability_name || r.cve_id || `Vulnerability #${id}`);
    else if (kind === 'regulatory') label = `${r.reference_number ? `${String(r.reference_number)} - ` : ''}${String(r.title || r.name || `Change #${id}`)}`;
    else label = String(r.name || r.committee_name || `Committee #${id}`);
    out.push({ id, label });
  });
  return out;
}

/** frameworks and their requirements, as the old create form labelled them */
export function frameworkOptions(rows: Record<string, unknown>[]): PickerOption[] {
  return rows.map((f) => ({ id: Number(f.id), label: String(f.framework_name || f.name || `Framework ${f.id}`) }));
}
export function requirementOptions(rows: Record<string, unknown>[]): PickerOption[] {
  return rows.map((c) => ({ id: Number(c.id), label: `${c.control_code || c.system_control_code || `#${c.id}`} — ${c.control_name || ''}`.trim() }));
}

// ── AI Generate on the create form (what the old handler built; the calls stay in the page) ────────────────────────────────────────────────
export interface AiContextItem { source: string; label: string }

/** The records the person linked, as the AI's context ("Risk", "Internal Control", "Vulnerability", "Regulatory Change", "Committee"). */
export function aiContextOf(form: NewTaskForm, options: Record<PickerKind, PickerOption[]>): AiContextItem[] {
  const find = (list: PickerOption[], id: string) => {
    const num = Number(id);
    return num ? list.filter((o) => o.id === num)[0] || null : null;
  };
  const out: AiContextItem[] = [];
  const add = (source: string, hit: PickerOption | null) => { if (hit) out.push({ source, label: hit.label }); };
  add('Risk', find(options.risk, form.linked_risk_id));
  add('Internal Control', find(options.control, form.linked_control_id));
  add('Vulnerability', find(options.vulnerability, form.linked_vulnerability_id));
  add('Regulatory Change', find(options.regulatory, form.linked_regulatory_change_id));
  add('Committee', find(options.committee, form.linked_committee_id));
  return out;
}

const CATEGORY_OF: Record<string, string> = { Vulnerability: 'Security', Risk: 'Risk Mitigation', 'Internal Control': 'Compliance', 'Regulatory Change': 'Compliance', Committee: 'Governance' };
const SOURCE_OF: Record<string, string> = { Vulnerability: 'Vulnerability', Risk: 'Risk', 'Internal Control': 'Control', 'Regulatory Change': 'Regulatory', Committee: 'Committee' };

/** What the AI is asked for the first linked record: a working title, the category and source that record implies, the priority, and every linked record as context. */
export function aiContextRequest(ctx: AiContextItem[], priority: string): { title: string; category: string; source: string; priority: string; context: string } {
  const primary = ctx[0];
  return {
    title: `Action for ${primary.source}: ${primary.label}`,
    category: CATEGORY_OF[primary.source] || 'Other',
    source: SOURCE_OF[primary.source] || 'Manual',
    priority: priority || 'Medium',
    context: ctx.map((c) => `${c.source}: ${c.label}`).join('\n'),
  };
}

/** The AI's description as text: summary, detailed description and the acceptance criteria as a list. '' when it gave nothing. */
export function aiDescriptionText(desc: { summary?: string; detailed_description?: string; acceptance_criteria?: string[] } | null | undefined): string {
  const parts: string[] = [];
  if (desc?.summary) parts.push(desc.summary);
  if (desc?.detailed_description) parts.push(desc.detailed_description);
  if (desc?.acceptance_criteria?.length) parts.push('\nAcceptance Criteria:\n' + desc.acceptance_criteria.map((c) => `- ${c}`).join('\n'));
  return parts.join('\n\n');
}

/** The form after AI Generate answered: it fills only what is empty (title, description) or still the default (category Other, source Manual). */
export function applyAiContext(form: NewTaskForm, ctx: AiContextItem[], request: ReturnType<typeof aiContextRequest>, desc: { title?: string; summary?: string; detailed_description?: string; acceptance_criteria?: string[] } | null | undefined): NewTaskForm {
  const text = aiDescriptionText(desc);
  const generatedDesc = text || ctx.map((c) => `${c.source}: ${c.label}`).join('\n');
  const generatedTitle = (desc?.title as string) || request.title;
  return {
    ...form,
    title: form.title || generatedTitle,
    description: form.description || generatedDesc,
    category: form.category && form.category !== 'Other' ? form.category : request.category,
    source: form.source && form.source !== 'Manual' ? form.source : request.source,
  };
}

/** When the AI cannot be reached, the form is still filled from what was linked (as the old page did, without saying so). */
export function fallbackFill(form: NewTaskForm, ctx: AiContextItem[]): NewTaskForm {
  return {
    ...form,
    title: form.title || `Action for ${ctx[0].source}: ${ctx[0].label}`,
    description: form.description || ctx.map((c) => `${c.source}: ${c.label}`).join('\n'),
  };
}

// ── the edit form of a task's page (moved from tasks/[id]/page.tsx) ──────────────────────────────────────────────────────────────────────
export type EditForm = Record<string, string | number | null>;

/** The edit form's start: the task's own values, ids as strings, a date as its day. */
export function editFormOf(task: TaskRow & { linked_risk_id: number | null; linked_control_id: number | null; linked_vulnerability_id: number | null; evidence_notes: string | null }): EditForm {
  return {
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
  };
}

/** The payload of Save Changes, exactly as saveEdit built it: ids and days as numbers, an emptied field as null, and for a document task without the fields its request owns. */
export function editPayload(form: EditForm, task: Parameters<typeof withoutLocked>[0]): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...form };
  ['assigned_owner_id', 'reviewer_id', 'sla_days', 'linked_risk_id', 'linked_control_id', 'linked_vulnerability_id'].forEach((k) => {
    payload[k] = payload[k] ? Number(payload[k]) : null;
  });
  ['severity', 'source_module', 'source_entity_type', 'due_date', 'evidence_notes'].forEach((k) => {
    if (!payload[k]) payload[k] = null;
  });
  return withoutLocked(task, payload);
}

/** Whether the edit form differs from the task it was opened on (the drawer then asks before it closes). */
export function editDirty(form: EditForm, start: EditForm): boolean {
  return Object.keys(start).some((k) => String(form[k] ?? '') !== String(start[k] ?? ''));
}

// ── a bulk write, in words ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type BulkAction = 'change_priority' | 'change_status' | 'assign';

export interface BulkReport { kind: 'success' | 'warning'; title: string; message?: string }

/** What the server did with `selected` tasks: it answers `updated` and `left_document_tasks`; the rest were not its to change (no such step from their status, or not the
 *  person's to see). Never "done" when nothing changed. */
export function bulkReport({ action, selected, updated, left }: { action: BulkAction; selected: number; updated: number; left: number }): BulkReport {
  const tasks = (n: number) => `${n} task${n === 1 ? '' : 's'}`;
  const unchanged = Math.max(0, selected - updated - left);
  const parts: string[] = [];
  if (left > 0) parts.push(`${tasks(left)} from a document request ${left === 1 ? 'was' : 'were'} left as ${left === 1 ? 'it was' : 'they were'}: their person and status follow the request.`);
  if (unchanged > 0) {
    parts.push(action === 'change_status'
      ? `${tasks(unchanged)} could not move to that status from where ${unchanged === 1 ? 'it is' : 'they are'}: a task moves one step at a time (Open, In Progress, Under Review, Completed).`
      : `${tasks(unchanged)} could not be changed.`);
  }
  if (updated === 0) return { kind: 'warning', title: 'No task was changed', message: parts.join(' ') || undefined };
  return { kind: 'success', title: `Updated ${updated} of ${selected} tasks`, message: parts.join(' ') || undefined };
}

// ── My Tasks ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const DONE = ['completed', 'verified'];
export const isDone = (status: string): boolean => DONE.indexOf(norm(status)) >= 0;

export interface MyTasksView<T> {
  active: T[];
  completed: T[];
  /** active and breached: the server says Breached when the due moment has passed (a task due today is breached from 00:00 UTC of its day) */
  overdue: T[];
  atRisk: T[];
  /** the active tasks by priority, Critical to Low; a priority the server wrote in another form ("high") joins its group, one that is none of the four is in `other` */
  groups: Array<{ priority: string; tasks: T[] }>;
  other: T[];
}

export function myTasksView<T extends { status: string; priority: string; sla_status: string }>(tasks: readonly T[]): MyTasksView<T> {
  const active = tasks.filter((t) => !isDone(t.status));
  const groups = PRIORITIES.map((priority) => ({ priority, tasks: [] as T[] }));
  const other: T[] = [];
  active.forEach((t) => {
    const group = groups.filter((g) => norm(g.priority) === norm(t.priority))[0];
    if (group) group.tasks.push(t);
    else other.push(t);
  });
  return {
    active,
    completed: tasks.filter((t) => isDone(t.status)),
    overdue: active.filter((t) => t.sla_status === 'Breached'),
    atRisk: active.filter((t) => t.sla_status === 'At Risk'),
    groups,
    other,
  };
}

/** how many completed tasks My Tasks lists */
export const COMPLETED_SHOWN = 10;

/** The completed tasks, the most recently completed first (a task with no completion time last), cut to the `COMPLETED_SHOWN` My Tasks lists. The server orders the whole list
 *  by due date, so its first ten were the oldest-due, not the latest done. */
export function recentlyCompleted<T extends { completed_at: string | null }>(done: readonly T[], shown: number = COMPLETED_SHOWN): T[] {
  const at = (t: T) => (t.completed_at ? Date.parse(/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(t.completed_at) ? t.completed_at : `${t.completed_at}Z`) : NaN);
  const rows = done.map((t, i) => ({ t, i, at: at(t) }));
  rows.sort((a, b) => {
    const none = [Number.isNaN(a.at), Number.isNaN(b.at)];
    if (none[0] || none[1]) return none[0] === none[1] ? a.i - b.i : none[0] ? 1 : -1;
    return b.at - a.at || a.i - b.i;
  });
  return rows.slice(0, Math.max(0, shown)).map((x) => x.t);
}

// ── Reports ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
export interface Bar { label: string; count: number; percent: number }

/** The bars of "Tasks by status": each count as a share of `total` (0 when there is no total), in the order the server sent them. */
export function bars(counts: Record<string, number> | null | undefined, total: number): Bar[] {
  return Object.keys(counts || {}).map((label) => {
    const count = Number((counts as Record<string, number>)[label]) || 0;
    return { label, count, percent: total > 0 ? (count / total) * 100 : 0 };
  });
}

/** The bars in the order of `order` (the workflow's statuses, the priorities from Critical to Low), however the words are written; a word that is not in `order` keeps the server's order after them. */
export function orderBars(rows: Bar[], order: readonly string[]): Bar[] {
  const rank = (b: Bar): number => {
    const at = order.map(norm).indexOf(norm(b.label));
    return at < 0 ? order.length : at;
  };
  return rows.map((b, i) => ({ b, i })).sort((x, y) => rank(x.b) - rank(y.b) || x.i - y.i).map((x) => x.b);
}

/** The owners by their active tasks, most first, each as a share of the busiest (so the longest bar is full). */
export function workloadBars(workload: Record<string, number> | null | undefined): Bar[] {
  const entries = Object.keys(workload || {}).map((label) => ({ label, count: Number((workload as Record<string, number>)[label]) || 0 }));
  const max = Math.max(0, ...entries.map((e) => e.count));
  return entries.sort((a, b) => b.count - a.count).map((e) => ({ ...e, percent: max > 0 ? (e.count / max) * 100 : 0 }));
}

/** the Active tile: every task that is not Completed or Verified */
export function activeCount(report: { total: number; by_status?: Record<string, number> }): number {
  return report.total - (report.by_status?.Completed || 0) - (report.by_status?.Verified || 0);
}

/** the trend's tallest bar (at least 1, so an empty year divides by something) */
export function trendMax(trend: Array<{ created: number; completed: number }>): number {
  return Math.max(...trend.map((t) => Math.max(t.created, t.completed)), 1);
}

/** a bar's height as a percent of the tallest */
export const trendHeight = (n: number, max: number): number => (max > 0 ? (n / max) * 100 : 0);
