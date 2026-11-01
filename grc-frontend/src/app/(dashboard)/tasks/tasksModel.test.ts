// node --test "src/app/(dashboard)/tasks/tasksModel.test.ts"
// The rules of the Task Management pages (tasksModel.ts): the payloads the forms send are the ones the old pages sent (frozen copies of their code are compared on many forms), the
// list request keeps its parameters and gains the page, the lists the pages offer are the words the backend writes, and what a bulk write, My Tasks and the Reports say.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { readAddress, writeAddress } from '../../../lib/addressState.ts';
import { withoutLocked } from '../../../lib/documentTasks.ts';
import {
  BOARD_SCHEMA, DEFAULT_PAGE_SIZE, FILTER_CATEGORIES, FILTER_SOURCES, KANBAN_LIMIT, SORT_KEYS, STATUSES, SYSTEM_CATEGORIES, SYSTEM_SOURCES, TITLE_MAX, VALID_TRANSITIONS,
  activeCount, aiContextOf, aiContextRequest, aiDescriptionText, allowedTransitions, applyAiContext, assigneeNames, bars, bulkReport, coverage, createPayload, editDirty,
  editFormOf, editPayload, emptyTask, fallbackFill, filterCount, formDirty, kanbanColumns, lastPage, listParams, myTasksView, pageSizeOf, pickerOptions, rowsOf, sortFromHeader,
  titleProblem, trendHeight, trendMax, workloadBars, type EditForm, type NewTaskForm, type PickerOption, type TaskRow,
} from './tasksModel.ts';

const BACKEND = new URL('../../../../../backend/grc/', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, BACKEND), 'utf8');
const have = existsSync(new URL('routers/critical_tasks_router.py', BACKEND));

// ── the frozen copies of what the old pages did ─────────────────────────────────────────────────────────────────────────────────────────
/** tasks/page.tsx handleCreate before the rebuild (the custom fields' values are added by the caller there too) */
function oldCreate(newTask: NewTaskForm, custom?: Record<string, unknown>) {
  const payload: Record<string, unknown> = { ...newTask };
  const assignedIds = (newTask.assigned_user_ids || []).map(Number).filter((n) => !Number.isNaN(n) && n > 0);
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
  delete payload.sla_level;
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

/** tasks/[id]/page.tsx saveEdit before the rebuild */
function oldSave(editForm: EditForm, task: Parameters<typeof withoutLocked>[0] | undefined) {
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
  return task ? withoutLocked(task, payload) : payload;
}

const FORMS: Array<[string, Partial<NewTaskForm>]> = [
  ['an empty form', {}],
  ['a title only', { title: 'Patch the gateway' }],
  ['owners: the first is the legacy owner too', { title: 'x', assigned_user_ids: ['7', '9', '3'] }],
  ['owners with a junk id', { title: 'x', assigned_user_ids: ['7', 'abc', '0', '-2'] }],
  ['the legacy owner only', { title: 'x', assigned_owner_id: '12' }],
  ['a reviewer and an SLA', { title: 'x', reviewer_id: '4', sla_level: 'high', sla_days: '30' }],
  ['every link', { title: 'x', linked_risk_id: '1', linked_control_id: '2', linked_vulnerability_id: '3', linked_regulatory_change_id: '4', linked_committee_id: '5', linked_framework_id: '6', linked_requirement_id: '7' }],
  ['recurrence without an interval', { title: 'x', recurrence_pattern: 'weekly', recurrence_interval: '' }],
  ['recurrence with an interval', { title: 'x', recurrence_pattern: 'monthly', recurrence_interval: '3' }],
  ['an interval with no pattern', { title: 'x', recurrence_interval: '5' }],
  ['approval, evidence, severity, a due day', { title: 'x', approval_required: true, evidence_notes: 'in the drive', severity: 'High', due_date: '2026-11-20' }],
  ['a source module and entity type', { title: 'x', source_module: 'Risk Register', source_entity_type: 'risk' }],
  ['everything', {
    title: 'Everything', description: 'd', source: 'Audit', priority: 'Critical', severity: 'Low', category: 'Review', assigned_user_ids: ['2'], reviewer_id: '8', due_date: '2026-12-01',
    sla_days: '7', evidence_notes: 'n', linked_risk_id: '10', approval_required: true, recurrence_pattern: 'daily', recurrence_interval: '2',
  }],
];

test('Create Task sends exactly what the old page sent, on every kind of form (custom fields included)', () => {
  for (const [name, patch] of FORMS) {
    const form = { ...emptyTask(), ...patch };
    assert.deepEqual(createPayload(form), oldCreate(form), name);
    assert.deepEqual(createPayload(form, { team: 'a' }), oldCreate(form, { team: 'a' }), `${name} with custom fields`);
  }
  assert.equal('custom_values' in createPayload(emptyTask()), false, 'no custom fields: the key is absent');
});

test('Save Changes sends exactly what the old page sent: ids and days as numbers, an emptied field as null, a document task without its locked fields', () => {
  const plain: TaskRow & { linked_risk_id: number | null; linked_control_id: number | null; linked_vulnerability_id: number | null; evidence_notes: string | null } = {
    id: 1, title: 'T', description: null, source: 'Manual', source_module: null, source_entity_id: null, source_entity_type: null, priority: 'High', severity: null, status: 'Open', category: 'Other',
    assigned_owner_id: 5, reviewer_id: null, created_by_id: 1, due_date: '2026-11-05T00:00:00', sla_days: 30, sla_status: 'On Track', escalation_level: 0, completed_at: null, created_at: null, updated_at: null,
    assigned_owner: null, reviewer: null, created_by: null, linked_risk_id: 9, linked_control_id: null, linked_vulnerability_id: null, evidence_notes: 'n',
  };
  const doc = { ...plain, source_module: 'document_lifecycle', source_entity_type: 'DocumentObligation', document_request: { request_id: 1 } as never };
  const cases: EditForm[] = [editFormOf(plain), { ...editFormOf(plain), assigned_owner_id: '', due_date: '', severity: '', evidence_notes: '', sla_days: '' }, { ...editFormOf(plain), reviewer_id: '3', linked_control_id: '44' }];
  for (const form of cases) {
    assert.deepEqual(editPayload(form, plain), oldSave(form, plain));
    assert.deepEqual(editPayload(form, doc), oldSave(form, doc));
  }
  const locked = editPayload(editFormOf(plain), doc);
  for (const key of ['assigned_owner_id', 'due_date', 'source_module', 'source_entity_type']) assert.equal(key in locked, false, `${key} follows the request and is not sent`);
  assert.equal(editFormOf(plain).due_date, '2026-11-05', 'a due date is its day');
  assert.equal(editFormOf(plain).assigned_owner_id, '5');
});

test('the form knows when it has been typed in, and the edit form when it differs from its task', () => {
  assert.equal(formDirty(emptyTask()), false);
  assert.equal(formDirty({ ...emptyTask(), title: 'a' }), true);
  assert.equal(formDirty({ ...emptyTask(), assigned_user_ids: ['1'] }), true);
  assert.equal(formDirty(emptyTask(), { x: 1 }), true, 'a custom field value counts');
  assert.equal(editDirty({ a: '1', b: null }, { a: '1', b: '' }), false, 'null and empty are the same nothing');
  assert.equal(editDirty({ a: '2' }, { a: '1' }), true);
});

test('a title is checked against the table: empty, or longer than VARCHAR(255) (a longer one is a 500)', () => {
  assert.equal(titleProblem(''), 'Enter a title');
  assert.equal(titleProblem('   '), 'Enter a title');
  assert.equal(titleProblem('ok'), null);
  assert.equal(titleProblem('x'.repeat(TITLE_MAX)), null);
  assert.match(titleProblem('x'.repeat(TITLE_MAX + 1)) ?? '', /255 characters at most.*has 256/);
  assert.equal(titleProblem('', 'sub-task title'), 'Enter a sub-task title');
});

// ── the list request ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const state = (search = '') => readAddress(BOARD_SCHEMA, search);

test('the list asks for what it always asked for (sort_by, sort_order, each filter under the server\'s name) and now for the page it shows', () => {
  assert.deepEqual(listParams(state()), { sort_by: 'created_at', sort_order: 'desc', skip: 0, limit: DEFAULT_PAGE_SIZE });
  assert.deepEqual(listParams(state('?q=gateway&source=Audit&priority=High&status=Open&category=Review&owner=7&sort=title:asc&page=3&size=25')), {
    sort_by: 'title', sort_order: 'asc', search: 'gateway', source: 'Audit', priority: 'High', status: 'Open', category: 'Review', assigned_owner_id: '7', skip: 50, limit: 25,
  });
  assert.deepEqual(listParams(state('?view=kanban&page=4')), { sort_by: 'created_at', sort_order: 'desc', skip: 0, limit: KANBAN_LIMIT }, 'the Kanban is one request of the server\'s own default');
  assert.equal(listParams(state('?size=7')).limit, DEFAULT_PAGE_SIZE, 'a size the pager does not offer is the default');
  assert.equal(pageSizeOf(100), 100);
});

test('the board lives in the address: every filter, the sort, the page and the view; junk is the default; the plain address is the default state', () => {
  const s = state('?status=Reopened&sort=due_date:desc&page=2&view=kanban&mine=1&q=%20patch%20');
  assert.equal(s.status, 'Reopened');
  assert.deepEqual(s.sort, { key: 'due_date', dir: 'desc' });
  assert.equal(s.page, 2);
  assert.equal(s.view, 'kanban');
  assert.equal(writeAddress(BOARD_SCHEMA, '', state()), '');
  const junk = state('?sort=nope:asc&page=-3&size=abc&view=cards');
  assert.deepEqual([junk.sort, junk.page, junk.size, junk.view], [{ key: 'created_at', dir: 'desc' }, 1, DEFAULT_PAGE_SIZE, 'table']);
  assert.equal(filterCount(state('?q=a&status=Open&owner=3')), 3);
  assert.equal(filterCount(state('?page=2&view=kanban')), 0, 'the page and the view are not filters');
  assert.deepEqual(sortFromHeader(null), { key: 'created_at', dir: 'desc' }, 'clearing a sort returns to newest first');
  assert.deepEqual(sortFromHeader({ key: 'title', dir: 'asc' }), { key: 'title', dir: 'asc' });
});

test('how many pages there are and whether a list is cut: counts are the server\'s total, never the length of what loaded', () => {
  assert.equal(lastPage(184, 50), 4);
  assert.equal(lastPage(0, 50), 1);
  assert.equal(lastPage(100, 100), 1);
  assert.deepEqual(coverage(100, 184), { loaded: 100, total: 184, cut: true });
  assert.deepEqual(coverage(61, 61), { loaded: 61, total: 61, cut: false });
  assert.deepEqual(coverage(5, undefined), { loaded: 5, total: 5, cut: false });
});

test('the Source and Category filters list what the other modules write, and the backend writes those words', { skip: !have }, () => {
  const sources = {
    'Governance document': 'modules/governance/doc_lifecycle.py', 'Committee Action': 'modules/governance/committee_tasks.py', 'Regulatory Change': 'modules/governance/regulatory_tasks.py',
    'Vendor Finding': 'modules/vendor_risk/tpra/findings.py', 'Vendor Approval': 'modules/vendor_risk/tpra/service.py', 'Issue Management': 'modules/issue_management/routers/actions.py',
    Workflow: 'modules/workflow_engine/services/action_handlers.py',
  };
  assert.deepEqual(Object.keys(sources).sort(), SYSTEM_SOURCES.slice().sort(), 'every system source is checked, and every checked one is offered');
  for (const word of Object.keys(sources)) assert.ok(read((sources as Record<string, string>)[word]).includes(`"${word}"`), `${word} is written by ${(sources as Record<string, string>)[word]}`);
  assert.ok(read('modules/governance/committee_tasks.py').includes('"Governance"') || read('modules/governance/committee_tasks.py').includes("'Governance'"), 'committee actions are category Governance');
  assert.deepEqual(SYSTEM_CATEGORIES, ['Compliance', 'Governance']);
  assert.ok(FILTER_SOURCES.includes('Manual') && FILTER_SOURCES.includes('Committee Action'));
  assert.equal(new Set(FILTER_CATEGORIES).size, FILTER_CATEGORIES.length, 'no word twice');
});

test('the status steps and the sortable columns are the server\'s', { skip: !have }, () => {
  const router = read('routers/critical_tasks_router.py');
  const block = /VALID_TRANSITIONS = \{([\s\S]*?)\n\}/.exec(router)?.[1] ?? '';
  const serverSteps: Record<string, string[]> = {};
  const row = /"([A-Za-z ]+)": \[([^\]]*)\]/g;
  let m: RegExpExecArray | null;
  while ((m = row.exec(block)) !== null) serverSteps[m[1]] = (m[2].match(/"([^"]+)"/g) ?? []).map((s) => s.replace(/"/g, ''));
  assert.deepEqual(VALID_TRANSITIONS, serverSteps);
  assert.deepEqual(Object.keys(VALID_TRANSITIONS), STATUSES, 'the six columns are the six statuses');
  const sortable = /SORTABLE_COLUMNS = \{([^}]*)\}/.exec(router)?.[1] ?? '';
  assert.deepEqual((sortable.match(/"([a-z_]+)"/g) ?? []).map((s) => s.replace(/"/g, '')).sort(), SORT_KEYS.slice().sort());
  assert.match(read('models/_36_is_projects_critical_tasks_models.py'), /class CriticalTask\(Base\)[\s\S]*?title = Column\(String\(255\)/, 'a title is VARCHAR(255)');
  assert.equal(TITLE_MAX, 255);
});

test('a document task has no status steps; another task has the server\'s', () => {
  assert.deepEqual(allowedTransitions({ status: 'Open', source_module: 'document_lifecycle', source_entity_type: 'DocumentObligation' }), []);
  assert.deepEqual(allowedTransitions({ status: 'Open', source_module: null, source_entity_type: null }), ['In Progress']);
  assert.deepEqual(allowedTransitions({ status: 'planned', source_module: null, source_entity_type: null }), [], 'a status the workflow does not know has no step');
});

// ── Kanban and the people of a task ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('the Kanban has a column per status and a place for a task whose status is none of them', () => {
  const k = kanbanColumns([{ id: 1, status: 'Open' }, { id: 2, status: 'in progress' }, { id: 3, status: 'planned' }, { id: 4, status: 'Verified' }, { id: 5, status: 'Open' }]);
  assert.deepEqual(k.columns.map((c) => [c.status, c.tasks.length]), [['Open', 2], ['In Progress', 1], ['Under Review', 0], ['Completed', 0], ['Verified', 1], ['Reopened', 0]]);
  assert.deepEqual(k.other.map((t) => t.id), [3]);
  assert.deepEqual(kanbanColumns([]).other, []);
});

test('everyone on a task is named, not only the first; an older answer has the single owner; nobody is an empty list', () => {
  const user = (id: number, name: string | null) => ({ id, display_name: name, username: `u${id}`, email: `u${id}@x.test` });
  assert.deepEqual(assigneeNames({ assignees: [user(1, 'Ann'), user(2, null)], assigned_owner: user(1, 'Ann') }), ['Ann', 'u2']);
  assert.deepEqual(assigneeNames({ assigned_owner: user(3, 'Cy') }), ['Cy']);
  assert.deepEqual(assigneeNames({ assignees: [], assigned_owner: null }), []);
});

// ── pickers and AI Generate ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the pickers label a record the way the old pages did, leave out one with no id, and read a list or an { items } answer', () => {
  assert.deepEqual(rowsOf([{ id: 1 }]), [{ id: 1 }]);
  assert.deepEqual(rowsOf({ items: [{ id: 2 }] }), [{ id: 2 }]);
  assert.deepEqual(rowsOf({ nope: 1 }), []);
  assert.deepEqual(rowsOf(null), []);
  assert.deepEqual(pickerOptions('risk', [{ id: 1, title: 'Data loss' }, { id: 2 }, { id: 0, title: 'x' }, { id: 3, risk_event: 'Fire' }]), [{ id: 1, label: 'Data loss' }, { id: 2, label: 'Risk #2' }, { id: 3, label: 'Fire' }]);
  assert.deepEqual(pickerOptions('control', [{ id: 1, control_id: 'AC-1', name: 'Access' }, { id: 2 }]), [{ id: 1, label: 'AC-1 - Access' }, { id: 2, label: 'Control #2' }]);
  assert.deepEqual(pickerOptions('vulnerability', [{ id: 1, cve_id: 'CVE-1' }]), [{ id: 1, label: 'CVE-1' }]);
  assert.deepEqual(pickerOptions('regulatory', [{ id: 1, reference_number: 'R1', title: 'Circular' }, { id: 2 }]), [{ id: 1, label: 'R1 - Circular' }, { id: 2, label: 'Change #2' }]);
  assert.deepEqual(pickerOptions('committee', [{ id: 1, committee_name: 'Audit' }]), [{ id: 1, label: 'Audit' }]);
});

test('AI Generate: the linked records become the context, the first one gives the working title, category and source; it fills only what is empty', () => {
  const options: Record<'risk' | 'control' | 'vulnerability' | 'regulatory' | 'committee', PickerOption[]> = {
    risk: [{ id: 1, label: 'Data loss' }], control: [{ id: 2, label: 'AC-1 - Access' }], vulnerability: [{ id: 3, label: 'CVE-9' }], regulatory: [{ id: 4, label: 'Circular' }], committee: [{ id: 5, label: 'Audit' }],
  };
  const form = { ...emptyTask(), linked_control_id: '2', linked_vulnerability_id: '3', linked_committee_id: '5' };
  const ctx = aiContextOf(form, options);
  assert.deepEqual(ctx, [{ source: 'Internal Control', label: 'AC-1 - Access' }, { source: 'Vulnerability', label: 'CVE-9' }, { source: 'Committee', label: 'Audit' }]);
  assert.deepEqual(aiContextOf(emptyTask(), options), []);
  const request = aiContextRequest(ctx, '');
  assert.deepEqual(request, { title: 'Action for Internal Control: AC-1 - Access', category: 'Compliance', source: 'Control', priority: 'Medium', context: 'Internal Control: AC-1 - Access\nVulnerability: CVE-9\nCommittee: Audit' });
  assert.equal(aiContextRequest([{ source: 'Vulnerability', label: 'v' }], 'High').category, 'Security');
  const filled = applyAiContext({ ...form, title: 'Mine', category: 'Review' }, ctx, request, { title: 'AI title', summary: 'S', detailed_description: 'D', acceptance_criteria: ['a', 'b'] });
  assert.equal(filled.title, 'Mine', 'a typed title stays');
  assert.equal(filled.category, 'Review', 'a chosen category stays');
  assert.equal(filled.source, 'Control', 'the default source is replaced');
  assert.equal(filled.description, 'S\n\nD\n\n\nAcceptance Criteria:\n- a\n- b');
  assert.equal(applyAiContext(form, ctx, request, null).title, 'Action for Internal Control: AC-1 - Access');
  assert.equal(applyAiContext(form, ctx, request, null).description, 'Internal Control: AC-1 - Access\nVulnerability: CVE-9\nCommittee: Audit');
  assert.equal(aiDescriptionText(undefined), '');
  assert.equal(fallbackFill(form, ctx).description, 'Internal Control: AC-1 - Access\nVulnerability: CVE-9\nCommittee: Audit');
});

// ── bulk, My Tasks, Reports ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('a bulk write says what changed and why the rest did not: never "done" when nothing changed', () => {
  assert.deepEqual(bulkReport({ action: 'change_priority', selected: 3, updated: 3, left: 0 }), { kind: 'success', title: 'Updated 3 of 3 tasks', message: undefined });
  const none = bulkReport({ action: 'change_status', selected: 4, updated: 0, left: 0 });
  assert.equal(none.kind, 'warning');
  assert.equal(none.title, 'No task was changed');
  assert.match(none.message ?? '', /4 tasks could not move to that status.*one step at a time/);
  const mixed = bulkReport({ action: 'assign', selected: 5, updated: 2, left: 2 });
  assert.equal(mixed.kind, 'success');
  assert.equal(mixed.title, 'Updated 2 of 5 tasks');
  assert.match(mixed.message ?? '', /2 tasks from a document request were left as they were/);
  assert.match(mixed.message ?? '', /1 task could not be changed/);
  assert.match(bulkReport({ action: 'change_status', selected: 1, updated: 0, left: 1 }).message ?? '', /1 task from a document request was left as it was/);
});

test('My Tasks: active, overdue (Breached), at risk, completed; priorities group by their word however it is written; a priority nobody knows is not dropped', () => {
  const t = (id: number, status: string, priority: string, sla: string) => ({ id, status, priority, sla_status: sla });
  const v = myTasksView([t(1, 'Open', 'Critical', 'Breached'), t(2, 'In Progress', 'high', 'At Risk'), t(3, 'Completed', 'Low', 'Completed'), t(4, 'Verified', 'High', 'Completed'), t(5, 'Open', 'Informational', 'On Track'), t(6, 'Reopened', 'Medium', 'Breached')]);
  assert.deepEqual(v.active.map((x) => x.id), [1, 2, 5, 6]);
  assert.deepEqual(v.completed.map((x) => x.id), [3, 4]);
  assert.deepEqual(v.overdue.map((x) => x.id), [1, 6]);
  assert.deepEqual(v.atRisk.map((x) => x.id), [2]);
  assert.deepEqual(v.groups.map((g) => [g.priority, g.tasks.map((x) => x.id)]), [['Critical', [1]], ['High', [2]], ['Medium', [6]], ['Low', []]]);
  assert.deepEqual(v.other.map((x) => x.id), [5]);
  assert.equal(v.active.length, v.groups.reduce((n, g) => n + g.tasks.length, 0) + v.other.length, 'every active task is in a group');
});

test('Reports: each bar is a share of the total (0 with no total), the workload is most first and relative to the busiest, Active is what is not done', () => {
  assert.deepEqual(bars({ Open: 5, Done: 5 }, 10), [{ label: 'Open', count: 5, percent: 50 }, { label: 'Done', count: 5, percent: 50 }]);
  assert.deepEqual(bars({ Open: 5 }, 0), [{ label: 'Open', count: 5, percent: 0 }]);
  assert.deepEqual(bars(null, 3), []);
  assert.deepEqual(workloadBars({ Ann: 2, Bo: 8, Cy: 4 }).map((b) => [b.label, b.percent]), [['Bo', 100], ['Cy', 50], ['Ann', 25]]);
  assert.deepEqual(workloadBars({}), []);
  assert.equal(activeCount({ total: 184, by_status: { Completed: 22, Verified: 11, Open: 98 } }), 151);
  assert.equal(activeCount({ total: 5 }), 5);
  assert.equal(trendMax([]), 1);
  assert.equal(trendMax([{ created: 3, completed: 9 }, { created: 4, completed: 1 }]), 9);
  assert.equal(trendHeight(3, 9), (3 / 9) * 100);
  assert.equal(trendHeight(9, 9), 100);
  assert.equal(trendHeight(3, 0), 0);
});
