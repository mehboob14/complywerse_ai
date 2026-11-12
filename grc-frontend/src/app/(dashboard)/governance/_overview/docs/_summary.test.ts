// node --test "src/app/(dashboard)/governance/_overview/docs/_summary.test.ts"
// What the document cards of the Summary draw: the bars of the status (the five steps, then only the states some document is in), the slices of the types and of the
// review dates (each opening the library, which reads the address back), the three request bars, and the severity of the "Needs attention" tile.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { STATUS } from '../../../../../components/overview/charts/palette.ts';
import { fromParams } from '../../documents/_workspace/libraryModel.ts';
import { WHOLE } from './_fixture.ts';
import { STATUS_COLOR } from './_chart.ts';
import { noRequests, requestBars, reviewSlices, severity, statusBarRows, typeSlices } from './_summary.ts';
import type { Overview } from './_model.ts';

const filters = (href: string) => fromParams(new URLSearchParams(href.split('?')[1])).filters;
/** WHOLE with the review and expiry addresses the server writes. */
const D: Overview = {
  ...WHOLE,
  links: {
    ...WHOLE.links,
    'reviews.overdue': { review: 'overdue' }, 'reviews.due_soon': { review: 'due_soon' }, 'reviews.unscheduled': { review: 'unscheduled' }, 'reviews.up_to_date': { review: 'ok' },
    'requests.review.pending': { status: 'pending_review' }, 'requests.review.overdue': { attn: 'late_approvals' }, 'requests.approval.pending': { status: 'pending_approval' },
  },
};

test('the status bars are the five steps with a step nobody is at saying 0, then the states outside the flow only while some document is in them, each in its own colour and opening the library', () => {
  const rows = statusBarRows(D);
  assert.deepEqual(rows.map((r) => [r.label, r.value]), [['Draft', 1], ['In review', 1], ['In approval', 1], ['Approved', 0], ['Published', 4]]);
  assert.equal(new Set(rows.map((r) => r.color)).size, rows.length, 'no two statuses share a colour');
  assert.equal(rows[4].color, STATUS_COLOR.published);
  assert.deepEqual(filters(rows[1].href as string).statuses, ['pending_review']);
  const out = statusBarRows({ ...D, by_status: D.by_status.map((s) => (s.status === 'expired' ? { ...s, count: 2 } : s)) });
  assert.deepEqual(out.slice(5).map((r) => [r.label, r.value]), [['Expired', 2]], 'a state nobody is in is left out');
  assert.deepEqual(statusBarRows({ by_status: [], links: {} }).map((r) => r.value), [0, 0, 0, 0, 0]);
  assert.equal(statusBarRows({ by_status: [], links: {} })[0].href, undefined, 'no address from the server: text, not a link');
});

test('the types are the five biggest, the rest folded into Other, and a kind opens the library on it', () => {
  const slices = typeSlices(D);
  assert.deepEqual(slices.map((s) => [s.label, s.value]), [['Policy', 4], ['Guideline', 1], ['Procedure', 1], ['Standard', 1]]);
  assert.deepEqual(filters(slices[0].href as string).types, ['policy']);
  const many = typeSlices({ links: {}, by_type: Array.from({ length: 8 }, (_, i) => ({ key: `type:t${i}`, doc_type: `t${i}`, label: `T${i}`, count: 10 - i, in_force: 0, in_force_key: '' })) });
  assert.equal(many.length, 6);
  assert.deepEqual([many[5].label, many[5].value], ['Other', 3 + 4 + 5]);
  assert.deepEqual(typeSlices({ links: {}, by_type: [] }), []);
  assert.deepEqual(typeSlices({ links: {}, by_type: [{ key: 'type:x', doc_type: 'x', label: 'X', count: 0, in_force: 0, in_force_key: '' }] }), [], 'a kind nobody has is no slice');
});

test('the review dates are four states in status colours, worst first, each opening the library on it', () => {
  const slices = reviewSlices(D);
  assert.deepEqual(slices.map((s) => [s.label, s.value]), [['Overdue', 1], ['Due in 30 days', 0], ['No review date', 3], ['Up to date', 0]]);
  assert.deepEqual(slices.map((s) => s.color), [STATUS.bad, STATUS.warn, STATUS.neutral, STATUS.good]);
  assert.deepEqual(filters(slices[0].href as string).review, ['overdue']);
});

test('one bar for each kind of request: overdue, due within 7 days and the rest, the three adding up to the pending requests and none counted twice', () => {
  const bars = requestBars(D);
  assert.deepEqual(bars.map((b) => b.label), ['Review', 'Approval', 'Acknowledgement']);
  const v = (b: (typeof bars)[number]) => b.parts.map((p) => [p.key, p.value]);
  assert.deepEqual(v(bars[0]), [['overdue', 1], ['soon', 0], ['later', 0]]);
  assert.deepEqual(v(bars[1]), [['overdue', 0], ['soon', 1], ['later', 0]]);
  assert.deepEqual(v(bars[2]), [['overdue', 1], ['soon', 1], ['later', 0]]);
  for (const b of bars) assert.equal(b.parts.reduce((n, p) => n + p.value, 0), b.pending, b.label);
  assert.deepEqual(bars[0].parts.map((p) => p.color), [STATUS.bad, STATUS.warn, STATUS.pending]);
  assert.equal(bars[2].parts[2].href, undefined, 'a pending acknowledgement has no filter: no link');
  assert.equal(noRequests(bars), false);
  assert.equal(noRequests(requestBars({ ...D, requests: { review: { pending: 0, overdue: 0, due_soon: 0, oldest_days_late: null }, approval: { pending: 0, overdue: 0, due_soon: 0, oldest_days_late: null }, acknowledgement: { pending: 0, overdue: 0, due_soon: 0, oldest_days_late: null } } })), true);
});

test('the severity splits the issue kinds into urgent (stuck, late approvals, expired) and to follow up (on hold, late acknowledgements, no owner, an exception), and keeps the documents counted once', () => {
  const s = severity({ ...D, issues: { no_owner: 2, expired: 1, exception_applied: 1, stuck: 3, on_hold: 1, late_acknowledgements: 4, late_approvals: 2, documents: 9 } });
  assert.equal(s.documents, 9);
  assert.deepEqual(s.parts.map((p) => [p.key, p.value]), [['urgent', 6], ['follow', 8]]);
  assert.deepEqual(s.parts.map((p) => p.color), [STATUS.bad, STATUS.warn]);
  assert.equal(severity({ ...D, issues: { ...D.issues, no_owner: 0, expired: 0, exception_applied: 0, stuck: 0, on_hold: 0, late_acknowledgements: 0, late_approvals: 0, documents: 0 } }).parts.every((p) => p.value === 0), true);
});
