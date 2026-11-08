// node --test "src/app/(dashboard)/issues/[id]/_overview/issueEdit.test.ts"
// The "Edit details" panel of an issue: it starts from the issue as it is, sends only what changed (so the timeline gets one line per change and the severity is recomputed only when it
// should be), clears an optional field with null, keeps a due date as a day, and checks the title, the root cause and the reason for a chosen severity.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ROOT_CAUSE_MAX, TITLE_MAX, draftOf, editErrors, isDirty, movesTheTarget, patchBody, type EditableIssue } from './issueEdit.ts';

const ISSUE: EditableIssue = {
  title: 'Unpatched gateway', description: 'The edge gateway runs a build from 2023.', issue_type: 'non_conformance', category: 'security', impact: 'high', urgency: 'medium',
  severity_override: null, severity_override_reason: null, assignee: { id: 7 }, owner: null, due_date: '2026-12-01T00:00:00', root_cause: 'No patch window', root_cause_analysis: null,
};

test('the form starts from the issue: people as ids, the due date as the day it was written, nothing missing as "null"', () => {
  assert.deepEqual(draftOf(ISSUE), {
    title: 'Unpatched gateway', description: 'The edge gateway runs a build from 2023.', issue_type: 'non_conformance', category: 'security', impact: 'high', urgency: 'medium',
    override: '', overrideReason: '', assignee: '7', owner: null, due: '2026-12-01', rootCause: 'No patch window', analysis: '',
  });
  const bare = draftOf({ title: 'T' });
  assert.deepEqual([bare.issue_type, bare.impact, bare.assignee, bare.due, bare.rootCause], ['', '', null, '', '']);
});

test('nothing changed sends nothing, and the panel is not dirty', () => {
  const opened = draftOf(ISSUE);
  assert.deepEqual(patchBody(opened, { ...opened }), {});
  assert.equal(isDirty(opened, { ...opened }), false);
  assert.equal(isDirty(opened, { ...opened, title: 'Unpatched edge gateway' }), true);
});

test('only the changed fields are sent, each under the server\'s name', () => {
  const opened = draftOf(ISSUE);
  const body = patchBody(opened, { ...opened, title: '  Unpatched edge gateway ', assignee: '9', owner: '3', due: '2026-12-15', category: 'operations', analysis: 'Why 1\nWhy 2' });
  assert.deepEqual(body, { title: 'Unpatched edge gateway', assignee_id: 9, owner_id: 3, due_date: '2026-12-15', category: 'operations', root_cause_analysis: 'Why 1\nWhy 2' });
  assert.equal(movesTheTarget(body), false, 'people, dates and words do not move the severity');
});

test('an optional field is cleared with null, never with an empty string or a missing key', () => {
  const opened = draftOf(ISSUE);
  assert.deepEqual(patchBody(opened, { ...opened, assignee: null, due: '', rootCause: '   ', description: '' }), { assignee_id: null, due_date: null, root_cause: null, description: null });
  assert.deepEqual(patchBody({ ...opened, owner: '3' }, { ...opened, owner: null }), { owner_id: null });
});

test('a title is never cleared: a blank one is an error, not a request', () => {
  const opened = draftOf(ISSUE);
  assert.deepEqual(editErrors({ ...opened, title: '   ' }), { title: 'Enter a title.' });
  assert.match(editErrors({ ...opened, title: 'x'.repeat(TITLE_MAX + 1) }).title ?? '', /under 255/);
  assert.deepEqual(editErrors({ ...opened, title: 'x'.repeat(TITLE_MAX) }), {});
  assert.match(editErrors({ ...opened, rootCause: 'x'.repeat(ROOT_CAUSE_MAX + 1) }).rootCause ?? '', /analysis has room/);
});

test('a change of impact or urgency says it moves the target; an unset one is never sent as an empty word', () => {
  const opened = draftOf(ISSUE);
  const body = patchBody(opened, { ...opened, impact: 'low' });
  assert.deepEqual(body, { impact: 'low' });
  assert.equal(movesTheTarget(body), true);
  assert.deepEqual(patchBody(draftOf({ title: 'T' }), draftOf({ title: 'T' })), {}, 'an old issue with no impact stays as it is');
  assert.deepEqual(patchBody(draftOf({ title: 'T' }), { ...draftOf({ title: 'T' }), impact: '' }), {});
});

test('a severity chosen by a person travels with its reason, and goes away with it', () => {
  const opened = draftOf(ISSUE);
  assert.deepEqual(editErrors({ ...opened, override: 'critical' }), { overrideReason: 'Say why the severity is changed.' });
  assert.deepEqual(editErrors({ ...opened, override: 'critical', overrideReason: 'Customer data' }), {});
  assert.deepEqual(patchBody(opened, { ...opened, override: 'critical', overrideReason: ' Customer data ' }), { severity_override: 'critical', severity_override_reason: 'Customer data' });

  const chosen = { ...opened, override: 'critical', overrideReason: 'Customer data' };
  assert.deepEqual(patchBody(chosen, { ...chosen, overrideReason: 'Customer data and cards' }), { severity_override: 'critical', severity_override_reason: 'Customer data and cards' }, 'the reason alone is sent with its severity: the server would clear it otherwise');
  assert.deepEqual(patchBody(chosen, { ...chosen, override: '', overrideReason: '' }), { severity_override: null, severity_override_reason: null }, 'back to the worked-out severity');
  assert.equal(movesTheTarget(patchBody(chosen, { ...chosen, override: '', overrideReason: '' })), true);
});
