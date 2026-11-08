// node --test "src/app/(dashboard)/tasks/tasksModel.test.ts"
// The rules of the Task Management pages (tasksModel.ts): the payloads the forms send are the ones the old pages sent (frozen copies of their code are compared on many forms), the
// list request keeps its parameters and gains the page, the lists the pages offer are the words the backend writes, and what a bulk write, My Tasks and the Reports say.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { withoutLocked } from '../../../lib/documentTasks.ts';
import {
  DEFAULT_PAGE_SIZE, FILTER_CATEGORIES, FILTER_SOURCES, SORT_KEYS, STATUSES, SYSTEM_CATEGORIES, SYSTEM_SOURCES, TITLE_MAX, VALID_TRANSITIONS,
  activeCount, aiContextOf, aiContextRequest, aiDescriptionText, allowedTransitions, applyAiContext, assigneeNames, bars, bulkReport, coverage, createPayload, editDirty,
  editFormOf, editPayload, emptyTask, fallbackFill, formDirty, lastPage, myTasksView, orderBars, pageSizeOf, pickerOptions, recentlyCompleted, rowsOf,
  titleProblem, trendHeight, trendMax, userOptions, workloadBars, type EditForm, type NewTaskForm, type PickerOption, type TaskRow,
} from './tasksModel.ts';
import { TASK_SLA_DEFAULTS, TASK_SLA_ORDER, daysFromDraft } from './slaConfig.ts';

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

// ── paging ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('a page size the pager does not offer is the default', () => {
  assert.equal(pageSizeOf(100), 100);
  assert.equal(pageSizeOf(25), 25);
  assert.equal(pageSizeOf(7), DEFAULT_PAGE_SIZE);
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

// ── the people of a task ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('a person in a list is their name (else the user name, else the address, else the id) with the address under it', () => {
  assert.deepEqual(userOptions([{ id: 1, display_name: 'Ann', username: 'ann', email: 'a@x.test' }, { id: 2, display_name: null, username: 'bo', email: 'b@x.test' }, { id: 3, display_name: null, username: null, email: '' }]),
    [{ value: '1', label: 'Ann', description: 'a@x.test' }, { value: '2', label: 'bo', description: 'b@x.test' }, { value: '3', label: 'User #3', description: undefined }]);
  assert.deepEqual(userOptions(null), []);
});

test('everyone on a task is named, not only the first; an older answer has the single owner; nobody is an empty list', () => {
  const user = (id: number, name: string | null) => ({ id, display_name: name, username: `u${id}`, email: `u${id}@x.test` });
  assert.deepEqual(assigneeNames({ assignees: [user(1, 'Ann'), user(2, null)], assigned_owner: user(1, 'Ann') }), ['Ann', 'u2']);
  assert.deepEqual(assigneeNames({ assigned_owner: user(3, 'Cy') }), ['Cy']);
  assert.deepEqual(assigneeNames({ assignees: [], assigned_owner: null }), []);
  // editing the owner of a task changes the owner but not the assignee list: the owner stays first, the others follow, nobody twice
  assert.deepEqual(assigneeNames({ assignees: [user(2, 'Bo'), user(3, 'Cy')], assigned_owner: user(1, 'Ann') }), ['Ann', 'Bo', 'Cy']);
  assert.deepEqual(assigneeNames({ assignees: [user(2, 'Bo'), user(1, 'Ann')], assigned_owner: user(1, 'Ann') }), ['Ann', 'Bo']);
  assert.deepEqual(assigneeNames({ assignees: [user(2, 'Bo')], assigned_owner: null }), ['Bo'], 'no owner: the assignees alone');
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

test('SLA days typed on the SLA page: a whole number of at least one (what the page has always stored)', () => {
  assert.equal(daysFromDraft('30'), 30);
  assert.equal(daysFromDraft('12.9'), 12);
  assert.equal(daysFromDraft('0'), 1);
  assert.equal(daysFromDraft('-5'), 1);
  assert.equal(daysFromDraft(''), 1);
  assert.equal(daysFromDraft('abc'), 1);
  assert.equal(daysFromDraft(7), 7);
  assert.deepEqual(TASK_SLA_ORDER, ['critical', 'high', 'medium', 'low', 'info']);
  assert.deepEqual(TASK_SLA_ORDER.map((l) => TASK_SLA_DEFAULTS[l]), [7, 30, 90, 180, 365]);
});

test('Recently completed lists the latest completions first, a task with no completion time last, and no more than ten', () => {
  const t = (id: number, at: string | null) => ({ id, completed_at: at });
  const list = [t(1, '2026-10-01T09:00:00'), t(2, null), t(3, '2026-10-05T09:00:00'), t(4, '2026-10-03T09:00:00'), t(5, '2026-10-05T09:00:00')];
  assert.deepEqual(recentlyCompleted(list).map((x) => x.id), [3, 5, 4, 1, 2], 'newest first, ties keep their order, none last');
  assert.deepEqual(recentlyCompleted(list, 2).map((x) => x.id), [3, 5]);
  assert.equal(recentlyCompleted(Array.from({ length: 25 }, (_, i) => t(i, `2026-10-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00`))).length, 10);
  assert.deepEqual(recentlyCompleted([]), []);
});

test('Reports list the statuses in the workflow\'s order and the priorities from Critical to Low, whatever order the server sent; a word nobody knows follows', () => {
  const rows = bars({ Verified: 1, Open: 5, Reopened: 2, planned: 3, 'In Progress': 4 }, 15);
  assert.deepEqual(orderBars(rows, STATUSES).map((b) => b.label), ['Open', 'In Progress', 'Verified', 'Reopened', 'planned']);
  assert.deepEqual(orderBars(bars({ low: 1, Critical: 2, Medium: 3 }, 6), ['Critical', 'High', 'Medium', 'Low']).map((b) => b.label), ['Critical', 'Medium', 'low']);
  assert.deepEqual(orderBars([], STATUSES), []);
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
