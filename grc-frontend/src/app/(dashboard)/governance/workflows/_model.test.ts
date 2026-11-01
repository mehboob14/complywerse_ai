// node --test "src/app/(dashboard)/governance/workflows/_model.test.ts"
// The rules of the legacy Approval Workflows page (_model.ts): how a list answer is read (an object, never an array), what an overdue step says (never a stray
// 0), how rows are ordered and paged, what each form starts with (the record's own values: Edit used to open blank), what is wrong with a form, the exact payload of
// every write (pinned against the objects the old page built), the reorder rule (pinned against the old expression) and the address the page keeps.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress, writeAddress } from '../../../../lib/addressState.ts';
import { sortRows } from '../../../../components/ui/ds/tableModel.ts';
import {
  ADDRESS, TENANT_ID, approvalModeLabel, approvalSortValue, asPage, createStepPayload, createTemplatePayload, cutTitle, docTypeLabel, documentHref, emptyStepForm,
  emptyTemplateForm, nextSequence, notOverdue, overdueWords, reorderPayload, sameStepForm, sameTemplateForm, sliceOf, stepCount, stepErrors, stepFormFrom,
  stepTypeLabel, stepsInOrder, templateErrors, templateFormFrom, templatesHref, timeoutDays, toggleDocType, updateStepPayload, updateTemplatePayload, withCurrent,
  withDays, type PendingStep, type WorkflowStep, type WorkflowTemplate,
} from './_model.ts';

const json = (value: unknown): unknown => JSON.parse(JSON.stringify(value));          // what goes over the wire: undefined fields are gone

const pend = (id: number, o: Partial<PendingStep> = {}): PendingStep => ({
  step_id: id, document_id: 100 + id, document_title: `Document ${id}`, doc_type: 'policy', step_sequence: 1, step_name: 'Document Review', is_overdue: false, ...o,
});
const step = (id: number, sequence: number, o: Partial<WorkflowStep> = {}): WorkflowStep => ({
  id, template_id: 7, name: `Step ${id}`, sequence, step_type: 'approval', approval_mode: 'any', is_required: true, ...o,
});
const template = (o: Partial<WorkflowTemplate> = {}): WorkflowTemplate => ({
  id: 7, tenant_id: 1, name: 'Standard approval', description: 'Review, then approval', doc_types: ['policy', 'standard'], is_default: true, is_active: true,
  allow_skip: true, require_all_approvers: false, auto_publish_on_complete: true, ...o,
});

// ── reading a list answer ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a list answer is { items, total }; the total is the server\'s, never smaller than what came; anything else is not a page', () => {
  assert.deepEqual(asPage({ items: [1, 2], total: 187, skip: 0, limit: 100 }), { items: [1, 2], total: 187 });
  assert.deepEqual(asPage({ items: [1, 2, 3] }), { items: [1, 2, 3], total: 3 }, 'no total: the length');
  assert.deepEqual(asPage({ items: [1, 2, 3], total: 2 }), { items: [1, 2, 3], total: 3 }, 'a total smaller than what came cannot be true');
  assert.deepEqual(asPage({ items: [], total: 0 }), { items: [], total: 0 });
  assert.equal(asPage([{ id: 1 }]), null, 'an ARRAY is what the Assessments approvals page keeps under the same React Query key: not ours to read');
  for (const junk of [null, undefined, 'x', 7, {}, { items: 'x' }, { items: null, total: 3 }]) assert.equal(asPage(junk), null, String(junk));
  assert.deepEqual(asPage({ items: [1], total: Number.NaN }), { items: [1], total: 1 });
});

test('a list the server holds more of says so, with the true total; a whole list says nothing', () => {
  assert.equal(cutTitle(100, 187, 'pending approvals'), 'Showing the first 100 of 187 pending approvals');
  assert.equal(cutTitle(100, 1240, 'templates'), 'Showing the first 100 of 1,240 templates');
  assert.equal(cutTitle(8, 8, 'pending approvals'), null);
  assert.equal(cutTitle(8, undefined, 'pending approvals'), null);
  assert.equal(cutTitle(8, null, 'pending approvals'), null);
});

// ── the address ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the bare path is Approvals > Pending (every link into the page); the address keeps the tab, the list and the open template, and junk is the default', () => {
  assert.deepEqual(readAddress(ADDRESS, ''), { tab: 'approvals', list: 'pending', template: 0 });
  assert.deepEqual(readAddress(ADDRESS, '?tab=templates&template=7'), { tab: 'templates', list: 'pending', template: 7 });
  assert.deepEqual(readAddress(ADDRESS, '?list=ALL&tab=Approvals'), { tab: 'approvals', list: 'all', template: 0 });
  assert.deepEqual(readAddress(ADDRESS, '?tab=history&list=archived&template=abc'), { tab: 'approvals', list: 'pending', template: 0 });
  assert.deepEqual(readAddress(ADDRESS, '?template=-3'), { tab: 'approvals', list: 'pending', template: 0 });
  assert.equal(writeAddress(ADDRESS, '', { tab: 'approvals', list: 'pending', template: 0 }), '', 'the defaults have the plain address');
  assert.equal(writeAddress(ADDRESS, '', { tab: 'templates', list: 'pending', template: 7 }), 'tab=templates&template=7');
  assert.equal(writeAddress(ADDRESS, '?x=1', { tab: 'approvals', list: 'rejected', template: 0 }), 'x=1&list=rejected', 'a param that is not the page\'s stays');
  assert.equal(templatesHref(), '/governance/workflows?tab=templates');
  assert.equal(templatesHref(7), '/governance/workflows?tab=templates&template=7');
  assert.deepEqual(readAddress(ADDRESS, templatesHref(7).split('?')[1]), { tab: 'templates', list: 'pending', template: 7 }, 'a link reads back as the state it was made from');
});

// ── what is said ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a document type reads as itself: the six keep their words, a charter or a framework is not "Other", none is the dash', () => {
  assert.equal(docTypeLabel('policy'), 'Policy');
  assert.equal(docTypeLabel('other'), 'Other');
  assert.equal(docTypeLabel('charter'), 'Charter');
  assert.equal(docTypeLabel('risk_framework'), 'Risk framework');
  assert.equal(docTypeLabel(null), '—');
  assert.equal(stepTypeLabel('review'), 'Review');
  assert.equal(stepTypeLabel('auto'), 'Auto');
  assert.equal(approvalModeLabel('sequential'), 'Sequential');
  assert.equal(approvalModeLabel('any'), 'Any approver');
});

test('a select keeps the value in force even when the form does not offer it', () => {
  assert.deepEqual(withCurrent([{ value: 'a', label: 'A' }], 'a'), [{ value: 'a', label: 'A' }]);
  assert.deepEqual(withCurrent([{ value: 'a', label: 'A' }], 'auto'), [{ value: 'a', label: 'A' }, { value: 'auto', label: 'Auto' }]);
  assert.deepEqual(withCurrent([{ value: 'a', label: 'A' }], ''), [{ value: 'a', label: 'A' }]);
});

test('an overdue step says how late it is in whole days, and never prints the 0 the server sends for the first 24 hours', () => {
  assert.equal(overdueWords({ is_overdue: false }), '');
  assert.equal(overdueWords({ is_overdue: false, days_overdue: 5 }), '', 'not overdue: nothing, whatever the days say');
  assert.equal(overdueWords({ is_overdue: true }), 'Overdue');
  assert.equal(overdueWords({ is_overdue: true, days_overdue: 0 }), 'Overdue', 'the old page printed "Due: Oct 31, 20260" here');
  assert.equal(overdueWords({ is_overdue: true, days_overdue: 1 }), '1 day overdue');
  assert.equal(overdueWords({ is_overdue: true, days_overdue: 3 }), '3 days overdue');
  assert.equal(overdueWords({ is_overdue: true, days_overdue: 1200 }), '1,200 days overdue');
});

test('the days a step is overdue come from the overdue list for the pending rows that lack them; nothing else changes and the input is not touched', () => {
  const pending = [pend(1), pend(2, { is_overdue: true }), pend(3, { is_overdue: true, days_overdue: 9 }), pend(4, { is_overdue: true })];
  const overdue = [pend(2, { is_overdue: true, days_overdue: 3 }), pend(3, { is_overdue: true, days_overdue: 1 })];
  const merged = withDays(pending, overdue);
  assert.deepEqual(merged.map((s) => s.days_overdue), [undefined, 3, 9, undefined], 'row 3 keeps its own; row 4 is not in the overdue list; row 1 is not overdue');
  assert.equal(pending[1].days_overdue, undefined);
  assert.equal(merged[0], pending[0], 'a row that needs nothing is the same object');
});

test('the Pending tab\'s second group is the pending rows that are not overdue', () => {
  assert.deepEqual(notOverdue([pend(1), pend(2, { is_overdue: true }), pend(3)]).map((s) => s.step_id), [1, 3]);
  assert.equal(documentHref(42), '/governance/documents/42');
});

// ── order and pages ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('columns sort by title, owner, due and requested moment; a row with no value is last whichever way it sorts', () => {
  const rows = [
    pend(1, { document_title: 'beta', owner_name: 'Zed', due_date: '2026-11-09T10:00:00', requested_at: '2026-11-01T08:00:00' }),
    pend(2, { document_title: 'Alpha', owner_name: null, due_date: null, requested_at: '2026-10-30T08:00:00' }),
    pend(3, { document_title: 'gamma', owner_name: 'Amy', due_date: '2026-11-02T10:00:00', requested_at: null }),
  ];
  const ids = (key: string, dir: 'asc' | 'desc') => sortRows(rows, { key, dir }, approvalSortValue).map((s) => s.step_id);
  assert.deepEqual(ids('document', 'asc'), [2, 1, 3], 'natural order, any case');
  assert.deepEqual(ids('owner', 'asc'), [3, 1, 2]);
  assert.deepEqual(ids('owner', 'desc'), [1, 3, 2], 'no owner is last both ways');
  assert.deepEqual(ids('due', 'asc'), [3, 1, 2]);
  assert.deepEqual(ids('due', 'desc'), [1, 3, 2]);
  assert.deepEqual(ids('requested', 'asc'), [2, 1, 3]);
  assert.equal(approvalSortValue(rows[0], 'nope'), null);
});

test('a page of a client-held list, and a page past the end is the last one (a decision shortens the list)', () => {
  const rows = Array.from({ length: 60 }, (_, i) => i + 1);
  assert.deepEqual(sliceOf(rows, 1, 25), { rows: rows.slice(0, 25), page: 1 });
  assert.deepEqual(sliceOf(rows, 3, 25), { rows: rows.slice(50), page: 3 });
  assert.deepEqual(sliceOf(rows, 9, 25), { rows: rows.slice(50), page: 3 });
  assert.deepEqual(sliceOf([], 1, 25), { rows: [], page: 1 });
  assert.deepEqual(sliceOf(rows, 0, 25).page, 1);
});

// ── steps ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('steps run in sequence order, a template counts its steps from the list route or the steps it carries, and a new step goes last', () => {
  const steps = [step(3, 3), step(1, 1), step(2, 2)];
  assert.deepEqual(stepsInOrder(steps).map((s) => s.id), [1, 2, 3]);
  assert.deepEqual(steps.map((s) => s.id), [3, 1, 2], 'the input is not sorted in place');
  assert.deepEqual(stepsInOrder(undefined), []);
  assert.equal(stepCount({ steps_count: 4 }), 4);
  assert.equal(stepCount({ steps_count: 0 }), 0);
  assert.equal(stepCount({ steps: steps }), 3);
  assert.equal(stepCount({}), null, 'unknown is not "0 steps"');
  assert.equal(nextSequence(steps), 4);
  assert.equal(nextSequence([]), 1);
  assert.equal(nextSequence(undefined), 1);
});

/** the expression the page has always used to move a step (handleMoveStep), kept here as the reference */
function legacyReorder(templateSteps: WorkflowStep[], s: WorkflowStep, direction: 'up' | 'down') {
  const steps = [...templateSteps].sort((a, b) => a.sequence - b.sequence);
  const currentIndex = steps.findIndex((x) => x.id === s.id);
  const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
  if (newIndex < 0 || newIndex >= steps.length) return null;
  return steps.map((x, idx) => {
    if (idx === currentIndex) return { step_id: x.id, sequence: newIndex + 1 };
    if (idx === newIndex) return { step_id: x.id, sequence: currentIndex + 1 };
    return { step_id: x.id, sequence: idx + 1 };
  });
}

test('moving a step sends what the old expression sent, for every step of several lists, up and down (and nothing at the ends)', () => {
  const lists: WorkflowStep[][] = [
    [step(10, 1), step(11, 2), step(12, 3)],
    [step(5, 4), step(3, 2), step(9, 7), step(1, 1)],                 // out of order and with gaps
    [step(1, 1)],
    [step(2, 1), step(3, 2)],
  ];
  let moves = 0;
  for (const steps of lists) {
    for (const s of steps) {
      for (const direction of ['up', 'down'] as const) {
        assert.deepEqual(reorderPayload(steps, s.id, direction), legacyReorder(steps, s, direction), `${s.id} ${direction}`);
        moves += 1;
      }
    }
  }
  assert.equal(moves, 20);
  assert.equal(reorderPayload(lists[0], 10, 'up'), null);
  assert.equal(reorderPayload(lists[0], 12, 'down'), null);
  assert.equal(reorderPayload(lists[0], 999, 'down'), null, 'a step that is not there');
  assert.deepEqual(reorderPayload(lists[0], 11, 'up'), [{ step_id: 10, sequence: 2 }, { step_id: 11, sequence: 1 }, { step_id: 12, sequence: 3 }]);
});

// ── the template form ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('editing a template starts with ITS values (the old panel opened blank), a copy that is not shared, and is clean until something changes', () => {
  const t = template();
  const form = templateFormFrom(t);
  assert.deepEqual(form, { name: 'Standard approval', description: 'Review, then approval', doc_types: ['policy', 'standard'], allow_skip: true, require_all_approvers: false, auto_publish_on_complete: true });
  assert.notEqual(form.doc_types, t.doc_types);
  assert.equal(sameTemplateForm(form, templateFormFrom(t)), true);
  assert.equal(sameTemplateForm(form, { ...form, name: 'Standard approvals' }), false);
  assert.equal(sameTemplateForm(form, { ...form, doc_types: ['standard', 'policy'] }), false, 'the order they were ticked in is what is sent');
  assert.deepEqual(templateFormFrom(template({ description: null, doc_types: null })), { ...form, description: '', doc_types: [] });
  assert.deepEqual(emptyTemplateForm(), { name: '', description: '', doc_types: [], allow_skip: false, require_all_approvers: false, auto_publish_on_complete: false });
});

test('document types are ticked and unticked in the order the person did it', () => {
  assert.deepEqual(toggleDocType([], 'standard'), ['standard']);
  assert.deepEqual(toggleDocType(['standard'], 'policy'), ['standard', 'policy']);
  assert.deepEqual(toggleDocType(['standard', 'policy'], 'standard'), ['policy']);
});

test('a template needs a name; the request carries what it always carried, and tenant 1 as before', () => {
  assert.deepEqual(templateErrors({ ...emptyTemplateForm(), name: '   ' }), { name: 'Enter a name' });
  assert.deepEqual(templateErrors({ ...emptyTemplateForm(), name: 'x' }), {});
  assert.equal(TENANT_ID, 1);
  const f = { name: 'Fixture ', description: '', doc_types: ['policy', 'other'], allow_skip: true, require_all_approvers: false, auto_publish_on_complete: true };
  // what the old page built from the same form data
  assert.deepEqual(createTemplatePayload(f), { tenant_id: 1, name: 'Fixture ', description: '', doc_types: ['policy', 'other'], allow_skip: true, require_all_approvers: false, auto_publish_on_complete: true });
  assert.deepEqual(updateTemplatePayload(f), { name: 'Fixture ', description: '', doc_types: ['policy', 'other'], allow_skip: true, require_all_approvers: false, auto_publish_on_complete: true });
  assert.deepEqual(Object.keys(createTemplatePayload(f)), ['tenant_id', 'name', 'description', 'doc_types', 'allow_skip', 'require_all_approvers', 'auto_publish_on_complete']);
});

// ── the step form ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a new step starts as the old form did; editing starts with the step\'s own values', () => {
  assert.deepEqual(emptyStepForm(4), { name: '', description: '', step_type: 'approval', approval_mode: 'any', is_required: true, timeout_days: '', sequence: 4 });
  const s = step(9, 2, { name: 'Peer review', description: 'First look', step_type: 'review', approval_mode: 'all', is_required: false, timeout_days: 5 });
  assert.deepEqual(stepFormFrom(s), { name: 'Peer review', description: 'First look', step_type: 'review', approval_mode: 'all', is_required: false, timeout_days: '5', sequence: 2 });
  assert.deepEqual(stepFormFrom(step(9, 2, { description: null, timeout_days: null })), { name: 'Step 9', description: '', step_type: 'approval', approval_mode: 'any', is_required: true, timeout_days: '', sequence: 2 });
  assert.equal(stepFormFrom(step(9, 2, { is_required: undefined as unknown as boolean })).is_required, true, 'as the old form: required unless it says not');
  assert.equal(sameStepForm(stepFormFrom(s), stepFormFrom(s)), true);
  assert.equal(sameStepForm(stepFormFrom(s), { ...stepFormFrom(s), approval_mode: 'any' }), false);
  assert.equal(sameStepForm(stepFormFrom(s), { ...stepFormFrom(s), timeout_days: ' 5 ' }), true, 'spaces round the number are not a change');
});

test('the timeout is a whole number of days, 1 or more, or nothing', () => {
  assert.equal(timeoutDays(''), null);
  assert.equal(timeoutDays('   '), null);
  assert.equal(timeoutDays('7'), 7);
  assert.equal(timeoutDays(' 30 '), 30);
  for (const bad of ['0', '-2', '2.5', '1e3', 'abc', '12 days', '99999999999']) assert.equal(timeoutDays(bad), undefined, bad);
  assert.equal(timeoutDays('2147483647'), 2147483647);
});

test('a step needs a name and a sensible timeout; the messages are the form\'s own', () => {
  assert.deepEqual(stepErrors(emptyStepForm(1)), { name: 'Enter a name' });
  assert.deepEqual(stepErrors({ ...emptyStepForm(1), name: 'x' }), {});
  assert.deepEqual(stepErrors({ ...emptyStepForm(1), name: 'x', timeout_days: '0' }), { timeout_days: 'Enter a whole number of days, 1 or more' });
  assert.deepEqual(stepErrors({ ...emptyStepForm(1), name: ' ', timeout_days: 'x' }), { name: 'Enter a name', timeout_days: 'Enter a whole number of days, 1 or more' });
});

test('a new step sends what it always sent (no timeout is no field); an edit sends the same fields, and a timeout taken out is null', () => {
  const f = { ...emptyStepForm(3), name: 'Manager review', description: '', step_type: 'review', approval_mode: 'sequential', is_required: false };
  assert.deepEqual(json(createStepPayload(f)), { name: 'Manager review', description: '', sequence: 3, step_type: 'review', approval_mode: 'sequential', is_required: false });
  assert.deepEqual(json(createStepPayload({ ...f, timeout_days: '14' })), { name: 'Manager review', description: '', sequence: 3, step_type: 'review', approval_mode: 'sequential', is_required: false, timeout_days: 14 });
  assert.equal('timeout_days' in createStepPayload(f), false);
  assert.deepEqual(json(updateStepPayload({ ...f, timeout_days: '14' })), { name: 'Manager review', description: '', step_type: 'review', approval_mode: 'sequential', is_required: false, timeout_days: 14 });
  assert.deepEqual(json(updateStepPayload(f)), { name: 'Manager review', description: '', step_type: 'review', approval_mode: 'sequential', is_required: false, timeout_days: null },
    'the old page dropped the field, so the server kept the timeout the person had cleared');
  assert.equal('sequence' in updateStepPayload(f), false, 'an edit never moved a step');
});
