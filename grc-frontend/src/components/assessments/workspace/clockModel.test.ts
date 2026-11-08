// node --test "src/components/assessments/workspace/clockModel.test.ts"
// The Remediation clock: the server's counts pass through untouched, due soon and the ageing follow the server's due-date rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { barShares, remediationClock } from './clockModel.ts';
import { normaliseItem, type RawItem } from './itemModel.ts';

const NOW = Date.parse('2026-03-01T00:00:00Z');
const it = (id: number, over: Partial<RawItem>) => normaliseItem({ id, item_number: `C-${id}`, area_domain: 'A', control_description: 'x', compliance_status: 'not_complied', priority: 'medium', created_at: '2026-01-01T00:00:00', ...over });

// raised 1 Jan 2026: critical = 31 Jan, high = 2 Mar, medium = 1 Apr, low = 30 Jun (30 / 60 / 90 / 180 days)
const ITEMS = [
  it(1, { priority: 'critical' }),                                         // 31 Jan: overdue
  it(2, { priority: 'high' }),                                             // 2 Mar: 1 day: due soon, within 30
  it(3, { priority: 'medium' }),                                           // 1 Apr: 31 days: not due soon (30), within 60
  it(4, { priority: 'low' }),                                              // 30 Jun: 121 days: later
  it(5, { priority: 'high', target_date: '2026-05-20T00:00:00' }),         // 80 days: within 90
  it(6, { priority: 'low', compliance_status: 'complied' }),               // not a gap
  it(7, { priority: 'critical', remediation_status: 'closed', closed_at: '2026-02-10T00:00:00' }),   // closed
  it(8, { priority: 'critical', created_at: null }),                       // no date at all
];

test('the headline numbers are the server\'s; none are invented when the board does not count the assessment', () => {
  const c = remediationClock(ITEMS, undefined, NOW, { gaps: 7, closed: 1, open: 6, overdue: 1 });
  assert.deepEqual([c.gaps, c.open, c.overdue, c.closed], [7, 6, 1, 1]);
  const n = remediationClock(ITEMS, undefined, NOW, null);
  assert.deepEqual([n.gaps, n.open, n.overdue, n.closed], [null, null, null, null], 'a missing answer is not zero');
  assert.deepEqual(remediationClock([], undefined, NOW, { gaps: 0, closed: 0, open: 0, overdue: 0 }).aging.map((b) => b.count), [0, 0, 0, 0, 0, 0]);
});

test('open gaps age by how far off their date is, with the server\'s due date; due soon is inside the policy\'s days and not yet overdue', () => {
  const c = remediationClock(ITEMS, undefined, NOW, null);
  assert.deepEqual(c.aging.map((b) => [b.key, b.count]), [['overdue', 1], ['d30', 1], ['d60', 1], ['d90', 1], ['later', 1], ['none', 1]]);
  assert.equal(c.agingTotal, 6, 'open gaps only: the complied control and the closed gap are not in it');
  assert.equal(c.dueSoon, 1);
  assert.equal(c.dueSoonDays, 30);
  assert.equal(remediationClock(ITEMS, { critical_days: 30, high_days: 60, medium_days: 90, low_days: 180, due_soon_days: 45 }, NOW, null).dueSoon, 2, 'the tenant\'s own horizon');
});

test('closed on time is read from the server\'s metric, and only when something was closed', () => {
  const metric = { key: 'on_time', label: 'Closed on time', weight: 0.4, score: 100, numerator: 3, denominator: 4, formula: '' };
  assert.deepEqual(remediationClock(ITEMS, undefined, NOW, null, [metric]).closedOnTime, { done: 3, of: 4 });
  assert.equal(remediationClock(ITEMS, undefined, NOW, null, [{ ...metric, denominator: 0 }]).closedOnTime, null);
  assert.equal(remediationClock(ITEMS, undefined, NOW, null, []).closedOnTime, null);
});

test('barShares: whole percents, a single gap is still a visible mark, an empty bar has no shares', () => {
  const c = remediationClock(ITEMS, undefined, NOW, null);
  assert.deepEqual(barShares(c.aging), [17, 17, 17, 17, 17, 17]);
  assert.deepEqual(barShares(remediationClock([], undefined, NOW, null).aging), [0, 0, 0, 0, 0, 0]);
  const many = remediationClock(Array.from({ length: 60 }, (_, i) => it(i + 100, { priority: 'critical' })).concat([it(999, { priority: 'low' })]), undefined, NOW, null);
  const shares = barShares(many.aging);
  assert.equal(shares[0], 98);
  assert.equal(shares[4], 2, 'one gap among sixty is not rounded away');
});
