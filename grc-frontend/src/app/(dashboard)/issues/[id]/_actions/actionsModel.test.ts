// node --test "src/app/(dashboard)/issues/[[]id]/_actions/actionsModel.test.ts"
// The Actions tab of an issue: work still to do comes first (soonest due first, undated last), done work after it; the summary says how far the work has got and how much is late; the form
// starts from the action, sends a day for the due date, and an edit clears what was emptied.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { actionBody, actionErrors, draftOf, isDirty, orderActions, summarize, summaryLine, type IssueActionRow } from './actionsModel.ts';

const NOW = new Date('2026-11-08T12:00:00Z');
const a = (id: number, status: string, due: string | null = null, over: Partial<IssueActionRow> = {}): IssueActionRow => ({ id, issue_id: 1, title: `Action ${id}`, status, due_date: due, ...over });

test('open work first, the soonest due first and undated last; done work after; ties keep the order they were added', () => {
  const rows = [a(1, 'completed', '2026-11-01T00:00:00'), a(2, 'planned'), a(3, 'in_progress', '2026-11-20T00:00:00'), a(4, 'blocked', '2026-11-10T00:00:00'), a(5, 'planned'), a(6, 'verified'), a(7, 'cancelled')];
  assert.deepEqual(orderActions(rows).map((x) => x.id), [4, 3, 2, 5, 1, 6, 7]);
  assert.deepEqual(orderActions([]), []);
  assert.deepEqual(rows.map((x) => x.id), [1, 2, 3, 4, 5, 6, 7], 'the list it was given is not reordered');
});

test('the summary counts done, open and late actions, and says so in one line', () => {
  const rows = [a(1, 'completed'), a(2, 'verified'), a(3, 'in_progress', '2026-11-05T00:00:00'), a(4, 'planned', '2026-12-01T00:00:00'), a(5, 'cancelled', '2026-10-01T00:00:00')];
  const s = summarize(rows, NOW);
  assert.deepEqual(s, { total: 5, done: 2, open: 2, late: 1 });
  assert.equal(summaryLine(s), '2 of 5 done · 1 late');
  assert.equal(summaryLine(summarize([a(1, 'verified')], NOW)), '1 of 1 done');
  assert.equal(summaryLine(summarize([], NOW)), null);
});

test('the form starts from the action and a new one starts as a corrective action', () => {
  assert.deepEqual(draftOf(null), { title: '', type: 'corrective', due: '', assignee: null, notes: '' });
  assert.deepEqual(draftOf(a(1, 'planned', '2026-12-01T00:00:00', { action_type: 'preventive', assignee_id: 7, description: 'Notes' })), { title: 'Action 1', type: 'preventive', due: '2026-12-01', assignee: '7', notes: 'Notes' });
  const opened = draftOf(null);
  assert.equal(isDirty(opened, { ...opened }), false);
  assert.equal(isDirty(opened, { ...opened, notes: 'x' }), true);
});

test('a title is needed and kept short enough for its column', () => {
  assert.deepEqual(actionErrors({ ...draftOf(null), title: '  ' }), { title: 'Enter what has to be done.' });
  assert.match(actionErrors({ ...draftOf(null), title: 'x'.repeat(256) }).title ?? '', /255/);
  assert.deepEqual(actionErrors({ ...draftOf(null), title: 'Patch it' }), {});
});

test('a new action leaves out what is empty; an edit clears what was emptied; the due date is a day', () => {
  const d = { title: ' Patch it ', type: 'preventive', due: '', assignee: null, notes: '' };
  assert.deepEqual(actionBody(d, true), { title: 'Patch it', action_type: 'preventive', description: '', assignee_id: undefined, due_date: undefined });
  assert.deepEqual(actionBody(d, false), { title: 'Patch it', action_type: 'preventive', description: '', assignee_id: null, due_date: null });
  assert.deepEqual(actionBody({ ...d, due: '2026-12-01', assignee: '7' }, false), { title: 'Patch it', action_type: 'preventive', description: '', assignee_id: 7, due_date: '2026-12-01' });
});
