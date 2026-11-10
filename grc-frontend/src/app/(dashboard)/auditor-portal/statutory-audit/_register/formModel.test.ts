// node --test "src/app/(dashboard)/auditor-portal/statutory-audit/_register/formModel.test.ts"   (or the whole suite: npm test)
// What the form sends: a new observation in a status the organisation has, an edit with only the fields that changed, a copy of a register finding never sending back what the register owns.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { changes, createPayload, draftOf, initialStatus, isDirty, problems } from './formModel.ts';
import type { ObservationRow } from './observationModel.ts';

const row = (over: Partial<ObservationRow> = {}): ObservationRow => ({
  id: 1, code: 'SAO-001', title: 'AML thresholds', description: 'Strengthen the monitoring thresholds.', observation_type: 'finding', regulator_source: 'SBP', regulation_reference: 'Circular 12', priority: 'high',
  status: 'open', audit_period: 'FY2025', due_date: '2026-11-30T00:00:00', management_response: null, notes: null, area_domain: 'AML', category: 'Inspection', owner_id: 7, owner_name: 'Ada Admin',
  created_by_name: null, closed_at: null, source_document_name: null, created_at: null, updated_at: null, custom_values: { ref: 'X1' }, sla: null, evidence_count: 0, control_count: 0, risk_count: 0,
  issue_count: 0, document_count: 0, mirrored: false, mirrored_issue_id: null, ...over,
});

test('the form opens on the observation as it is, and a new one on sensible defaults', () => {
  const d = draftOf(row());
  assert.equal(d.due_date, '2026-11-30', 'the calendar day of a due date, never shifted by a time zone');
  assert.equal(d.owner, '7');
  assert.deepEqual(d.custom, { ref: 'X1' });
  assert.deepEqual([draftOf(null).observation_type, draftOf(null).priority, draftOf(null).owner, draftOf(null).title], ['requirement', 'medium', null, '']);
  assert.equal(isDirty(d, draftOf(row())), false);
  assert.equal(isDirty(d, { ...d, notes: 'x' }), true);
  assert.equal(isDirty(d, { ...d, custom: { ref: 'X2' } }), true);
});

test('a title is required, and a date must be a date', () => {
  assert.deepEqual(problems(draftOf(null)), { title: 'Enter a title.' });
  assert.deepEqual(problems({ ...draftOf(null), title: '   ' }), { title: 'Enter a title.' });
  assert.deepEqual(problems({ ...draftOf(null), title: 'ok' }), {});
  assert.equal(problems({ ...draftOf(null), title: 'x'.repeat(501) }).title, 'Keep the title to 500 characters.');
  assert.equal(problems({ ...draftOf(null), title: 'ok', due_date: '30/11/2026' }).due_date, 'Choose a date.');
});

test('a new observation starts in "open", or in the organisation\'s first level when it has no such level', () => {
  assert.equal(initialStatus([{ key: 'open' }, { key: 'closed' }]), 'open');
  assert.equal(initialStatus([{ key: 'raised' }, { key: 'closed' }]), 'raised');
  assert.equal(initialStatus([]), 'open');
});

test('the body of a new observation: trimmed, blanks are null, the owner is a number, the extra fields go along', () => {
  const body = createPayload({ ...draftOf(null), title: '  New one ', category: ' AML ', regulator_source: '', owner: '9', due_date: '2026-12-01', custom: { ref: 'Z' } }, 'raised');
  assert.deepEqual(body, {
    title: 'New one', description: null, observation_type: 'requirement', priority: 'medium', status: 'raised', category: 'AML', regulator_source: null, regulation_reference: null, audit_period: null,
    due_date: '2026-12-01', area_domain: null, owner_id: 9, management_response: null, notes: null, custom_values: { ref: 'Z' },
  });
});

test('an edit sends only what changed', () => {
  const opened = draftOf(row());
  assert.deepEqual(changes(opened, opened, false), {});
  assert.deepEqual(changes(opened, { ...opened, priority: 'low', notes: 'Chased', owner: null }, false), { priority: 'low', notes: 'Chased', owner_id: null });
  assert.deepEqual(changes(opened, { ...opened, due_date: '' }, false), { due_date: null }, 'a cleared date is sent as null');
  assert.deepEqual(changes(opened, { ...opened, title: ' AML thresholds ' }, false), {}, 'a space is not a change');
  assert.deepEqual(changes(opened, { ...opened, category: '  ' }, false), { category: null });
  assert.deepEqual(changes(opened, { ...opened, custom: { ref: 'X2' } }, false), { custom_values: { ref: 'X2' } });
});

test('on a copy of a register finding the fields the register owns are never sent back; the person\'s own are', () => {
  const copy = row({ mirrored: true, mirrored_issue_id: 5 });
  const opened = draftOf(copy);
  const everything = { ...opened, title: 'Edited', description: 'D', priority: 'low', category: 'Other', regulator_source: 'X', regulation_reference: 'Y', audit_period: 'Z', due_date: '2027-01-01', area_domain: 'Q', owner: null, management_response: 'R',
    notes: 'My note', observation_type: 'requirement', custom: { ref: 'X9' } };
  assert.deepEqual(changes(opened, everything, true), { observation_type: 'requirement', notes: 'My note', custom_values: { ref: 'X9' } });
  assert.equal(Object.keys(changes(opened, everything, false)).length, 14, 'a hand-made observation sends every field that changed');
});
