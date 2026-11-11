// node --test "src/app/(dashboard)/governance/documents/_workspace/libraryNeedsYou.test.ts"
// The "Needs you" strip: the person's own document tasks from the shared inbox, said in plain words, the late ones first, at most five, the true total kept.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildInbox, type SourceInput } from '../../../../../lib/inbox/buildInbox.ts';
import { workOf } from '../../../../../components/overview/workList.ts';
import { NEEDS_YOU_LIMIT, NEEDS_YOU_SOURCES, needsYou, sentHint } from './libraryNeedsYou.ts';

const NOW = new Date('2026-11-11T12:00:00Z');
const ready: SourceInput['state'] = { state: 'ready', at: 1 };
const row = (id: number, kind: string, extra: object = {}) => ({ id, document_id: 100 + id, kind, title: `Policy ${id}`, doc_type: 'policy', version: '1.0', status: 'pending_review', ...extra });
const strip = (items: object[], more: SourceInput[] = []) => needsYou(workOf(buildInbox([{ id: 'doc.lifecycle', state: ready, raw: { enabled: true, items } }, ...more], NOW), NEEDS_YOU_SOURCES), NOW);

test('each task is a plain verb and the title, a plain word (Late or Needs you) and one hint', () => {
  const s = strip([
    row(1, 'acknowledgement', { due_date: '2026-11-16T00:00:00', requested_by_name: 'Sara Khan', requested_at: '2026-11-05T09:00:00' }),
    row(2, 'review', { requested_by_name: 'Bina Branch', requested_at: '2026-11-05T09:00:00' }),
    row(3, 'approval', { due_date: '2026-11-08T00:00:00', overdue: true }),
  ]);
  const by = Object.fromEntries(s.rows.map((r) => [r.title, r]));
  assert.equal(by['Read and confirm: Policy 1'].word, 'Needs you');
  assert.equal(by['Read and confirm: Policy 1'].hint, 'Due in 5 days');
  assert.equal(by['Check and comment on: Policy 2'].hint, 'Bina Branch sent this to you 6 days ago');
  assert.equal(by['Sign off: Policy 3'].word, 'Late');
  assert.equal(by['Sign off: Policy 3'].hint, 'Overdue by 3 days');
  assert.ok(s.rows.every((r) => r.href.startsWith('/')));
});

test('the late ones come first, then the inbox’s own order; five at most, and the total and the late count are the true ones', () => {
  const items = [row(1, 'acknowledgement'), row(2, 'review'), row(3, 'review', { overdue: true, due_date: '2026-11-01T00:00:00' }), row(4, 'acknowledgement', { overdue: true, due_date: '2026-11-02T00:00:00' }),
    row(5, 'approval'), row(6, 'review'), row(7, 'review')];
  const s = strip(items);
  assert.equal(s.rows.length, NEEDS_YOU_LIMIT);
  assert.equal(s.total, 7);
  assert.equal(s.late, 2);
  assert.ok(s.cut);
  assert.deepEqual(s.rows.slice(0, 2).map((r) => r.word), ['Late', 'Late']);
  assert.ok(s.rows.slice(2).every((r) => r.word === 'Needs you'));
});

test('nothing to do is an empty strip, not an invented row; a task the inbox does not hold is never made up; sent requests are not tasks', () => {
  const s = strip([], [{ id: 'doc.sent', state: ready, raw: { enabled: true, items: [{ document_id: 9, kind: 'review', title: 'Sent', pending: 1, waiting: ['X'], status: 'pending_review' }] } }]);
  assert.deepEqual(s, { rows: [], total: 0, late: 0, cut: false });
  // a task on something that is not a document (evidence) is not on this strip
  const evidence = needsYou(workOf(buildInbox([{ id: 'assessment.evidence', state: ready, raw: { pending_approvals: [{ id: 5, evidence_name: 'Scan' }] } }], NOW), NEEDS_YOU_SOURCES), NOW);
  assert.equal(evidence.total, 0);
});

test('the sent hint says who and when, as a person would', () => {
  assert.equal(sentHint({ createdAt: '2026-11-11T08:00:00', requester: null }, NOW), 'Sent to you today');
  assert.equal(sentHint({ createdAt: '2026-11-10T08:00:00', requester: 'Sara Khan' }, NOW), 'Sara Khan sent this to you yesterday');
  assert.equal(sentHint({ createdAt: null, requester: 'Sara Khan' }, NOW), 'Sent to you by Sara Khan');
  assert.equal(sentHint({ createdAt: null, requester: null }, NOW), '');
});
