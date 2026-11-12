// node --test "src/components/overview/myWork.test.ts"
// The slim "My work" card (MyWorkCard): never more than three one-line rows by default, a header with the true count and how many are late, a due pill whose WORD
// is short enough for one line ("Overdue 3d", "Due today"), a link named "<action>: <title>", and the same list as the inbox (workOf) in every state. The card
// itself is pinned as source text in overviewKit.test.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildInbox, type SourceId, type SourceInput, type SourceState } from '../../lib/inbox/buildInbox.ts';
import { MY_WORK_ROWS, compactDue, itemsFor, lengthOf, rowLinkName, rowOf, workHeader, workOf } from './workList.ts';

const NOW = new Date('2026-11-12T12:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString().replace(/\.\d+Z$/, '');
const READY: SourceState = { state: 'ready', at: 1 };
const DOCS: SourceId[] = ['doc.lifecycle', 'doc.signoff'];
let seq = 200;
const life = (kind: string, over: Record<string, unknown> = {}) => ({
  id: ++seq, kind, document_id: 10 + seq, title: `Policy ${seq}`, doc_type: 'policy', status: 'pending_review', version: '1.0', due_date: day(3), overdue: false, escalation_level: 0,
  again: null, proposal_id: null, requested_at: day(-2), requested_by_id: 7, requested_by_name: 'Olivia Owner', ...over,
});
const input = (id: SourceId, raw: unknown, state: SourceState = READY): SourceInput => ({ id, state, raw });
const lifeInput = (...rows: unknown[]) => input('doc.lifecycle', { enabled: true, total: rows.length, items: rows });

test('the slim card shows three rows, not ten', () => {
  assert.equal(MY_WORK_ROWS, 3);
  const work = workOf(buildInbox([lifeInput(...Array.from({ length: 9 }, () => life('approval')))], NOW), DOCS);
  const page = lengthOf(itemsFor(work, 'all'), MY_WORK_ROWS);
  assert.deepEqual([page.rows.length, page.total, page.cut], [3, 9, true]);
});

test('the header says the true count and how many are late, and nothing while it is not known', () => {
  const work = workOf(buildInbox([lifeInput(life('approval'), life('review', { due_date: day(-4), overdue: true }), life('acknowledgement', { due_date: day(-1), overdue: true }))], NOW), DOCS);
  assert.deepEqual(workHeader(work), { count: '3', overdue: '2 overdue' });
  const calm = workOf(buildInbox([lifeInput(life('approval'))], NOW), DOCS);
  assert.deepEqual(workHeader(calm), { count: '1', overdue: '' });
  assert.equal(workHeader(workOf(buildInbox([input('doc.lifecycle', null, { state: 'loading' })], NOW), DOCS)), null);
  assert.equal(workHeader(workOf(buildInbox([lifeInput()], NOW), DOCS)), null, 'all caught up has no count');
});

test('every state of the list is the inbox\'s own: loading, failed, all clear', () => {
  assert.equal(workOf(buildInbox([input('doc.lifecycle', null, { state: 'loading' })], NOW), DOCS).state, 'loading');
  assert.equal(workOf(buildInbox([input('doc.lifecycle', null, { state: 'unavailable', error: 'Could not reach the server.' })], NOW), DOCS).state, 'unavailable', 'never "all caught up" over a failure');
  assert.equal(workOf(buildInbox([lifeInput()], NOW), DOCS).state, 'empty');
});

test('a due date is a short word on one line: the day count is "3d", the word stays', () => {
  const at = (n: number, overdue?: boolean) => compactDue({ due: day(n), overdue: overdue ?? n < 0 }, NOW);
  assert.deepEqual(at(-3), { text: 'Overdue 3d', tone: 'danger' });
  assert.deepEqual(at(-1), { text: 'Overdue 1d', tone: 'danger' });
  assert.deepEqual(at(0), { text: 'Due today', tone: 'warning' });
  assert.deepEqual(at(1), { text: 'Due tomorrow', tone: 'warning' });
  assert.deepEqual(at(3), { text: 'Due in 3d', tone: 'warning' });
  assert.deepEqual(at(6), { text: 'Due in 6d', tone: 'neutral' });
  assert.equal(at(40).text.startsWith('Due '), true);
  assert.deepEqual(compactDue({ due: null, overdue: true }, NOW), { text: 'Overdue', tone: 'danger' }, 'a breach with no date still says overdue');
  assert.deepEqual(compactDue({ due: null, overdue: false }, NOW), { text: 'No due date', tone: 'neutral' });
});

test('a row\'s link is named by its action first, then what it is about', () => {
  const work = workOf(buildInbox([lifeInput(life('approval', { title: 'Information security policy' }))], NOW), DOCS);
  const r = rowOf(itemsFor(work, 'all')[0]);
  assert.equal(rowLinkName(r), `${r.action.label}: Information security policy`);
});
