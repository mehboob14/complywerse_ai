// node --test "src/lib/rcsa/worklist.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { csvCell, csvName, toCsv } from './csv.ts';
import { allClear, countersOf, rowsFor, rowView, totalFor, type MyWork, type WorkRow } from './worklist.ts';

const row = (extra: Partial<WorkRow>): WorkRow => ({ kind: 'complete', key: 'a-1', assessment_id: 1, campaign_id: 1, campaign_name: 'Q2 RCSA', business_unit_name: 'Treasury', status: 'in_progress', due_date: '2026-06-30T00:00:00', overdue: false, progress: 41, ...extra });
const work = (extra: Partial<MyWork> = {}): MyWork => ({
  counts: { to_complete: 3, returned: 1, to_review: 2, findings_owned: 4, overdue: 1, open_findings: 12, late_units: 5, actions: 10 },
  rows: [], total: 10, campaigns: [], campaigns_total: 0, roles: { manage: false, review: true, assess: true }, ...extra,
});

test('the band shows the counters that concern the person, with true totals from the server', () => {
  assert.deepEqual(countersOf(work()).map((c) => [c.key, c.value]), [['complete', 3], ['returned', 1], ['review', 2], ['overdue', 1], ['owned', 4], ['findings', 12]]);
});

test('an assessor with nothing to review has no review counter, a reviewer with no unit has no unit counters, the risk team also sees late units', () => {
  assert.ok(!countersOf(work({ roles: { manage: false, review: false, assess: true } })).some((c) => c.key === 'review'));
  const reviewerOnly = work({ roles: { manage: false, review: true, assess: false }, counts: { ...work().counts, to_complete: 0, returned: 0, overdue: 0 } });
  assert.deepEqual(countersOf(reviewerOnly).map((c) => c.key), ['review', 'owned', 'findings']);
  assert.ok(countersOf(work({ roles: { manage: true, review: true, assess: false } })).some((c) => c.key === 'late' && c.href === '/erm/rcsa/campaigns?show=late'));
});

test('a counter opens the rows it counts, and the number under a filter is the server\'s, not the rows sent', () => {
  const rows = [row({ kind: 'complete' }), row({ kind: 'returned', key: 'a-2' }), row({ kind: 'review', key: 'a-3', overdue: true }), row({ kind: 'finding', key: 'f-1' })];
  assert.deepEqual(rowsFor(rows, 'review').map((r) => r.key), ['a-3']);
  assert.deepEqual(rowsFor(rows, 'overdue').map((r) => r.key), ['a-3']);
  assert.equal(rowsFor(rows, 'all').length, 4);
  assert.equal(totalFor(work(), 'complete'), 3);
  assert.equal(totalFor(work(), 'all'), 10);
});

test('each kind of row is one WorkRow with one action that opens the right place', () => {
  const go = rowView(row({}));
  assert.deepEqual([go.kind.label, go.title, go.context, go.action.label, go.action.href], ['To complete', 'Treasury · Q2 RCSA', '41% of the required questions answered', 'Continue', '/erm/rcsa/assessments/1']);
  assert.equal(rowView(row({ status: 'not_started', progress: 0 })).action.label, 'Start');
  const back = rowView(row({ kind: 'returned', return_comment: 'Add evidence for Q2' }));
  assert.deepEqual([back.kind.label, back.context, back.action.label], ['Sent back', 'Reviewer: Add evidence for Q2', 'Fix']);
  const review = rowView(row({ kind: 'review', assessor_name: 'Ayesha', tier: 2, total_tiers: 3 }));
  assert.deepEqual([review.kind.label, review.context, review.action.label], ['To review', 'Submitted by Ayesha · step 2 of 3', 'Review']);
  assert.doesNotMatch(rowView(row({ kind: 'review', tier: 1, total_tiers: 1 })).context, /step/);
  const finding = rowView(row({ kind: 'finding', finding_id: 9, title: 'Weak control', severity: 'high' }));
  assert.deepEqual([finding.title, finding.context, finding.action.href], ['Weak control', 'High severity · Q2 RCSA', '/erm/rcsa/findings?open=9']);
});

test('the all-clear line says what the person is, not a generic sentence', () => {
  assert.match(allClear(work()), /all caught up/);
  assert.match(allClear(work({ roles: { manage: true, review: true, assess: false } })), /Campaigns you run/);
  assert.match(allClear(work({ roles: { manage: false, review: false, assess: false } })), /Nothing is assigned/);
});

test('a CSV cell is quoted when it must be and a formula is made harmless', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=SUM(A1)'), "'=SUM(A1)");
  assert.equal(csvCell(null), '');
  assert.equal(toCsv(['Title', 'Severity'], [['Weak, control', 'high']]), 'Title,Severity\r\n"Weak, control",high\r\n');
  assert.equal(csvName('findings', new Date('2026-11-08T10:00:00Z')), 'rcsa-findings-2026-11-08.csv');
});
