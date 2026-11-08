// node --test "src/lib/rcsa/findingsModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { actionBlock, csvOf, isLate, isOpen, linksText, movedWords, nextStep, otherMoves, severityRank, type FindingRow } from './findingsModel.ts';

const NOW = new Date('2026-06-30T10:00:00Z');
const f = (extra: Partial<FindingRow> = {}): FindingRow => ({ id: 1, assessment_id: 1, finding_type: 'control_gap', severity: 'high', title: 'Weak control', status: 'open', created_at: '2026-06-01T08:00:00', ...extra });

test('open findings are open and in progress, the ones the dashboard counts', () => {
  assert.deepEqual(['open', 'in_progress', 'remediated', 'accepted', 'closed'].map((status) => isOpen({ status })), [true, true, false, false, false]);
});

test('a finding is late the day after its fix-by day, never when finished', () => {
  assert.equal(isLate(f({ remediation_due_date: '2026-06-30T00:00:00' }), NOW), false);
  assert.equal(isLate(f({ remediation_due_date: '2026-06-29T00:00:00' }), NOW), true);
  assert.equal(isLate(f({ remediation_due_date: '2026-06-29T00:00:00', status: 'closed' }), NOW), false);
  assert.equal(isLate(f(), NOW), false);
});

test('severity sorts critical first and an unknown word last', () => {
  assert.deepEqual(['low', 'critical', 'medium', 'high', 'odd'].sort((a, b) => severityRank(b) - severityRank(a)), ['critical', 'high', 'medium', 'low', 'odd']);
});

test('each status has a natural next step; the other moves are offered beside it and never the status it has', () => {
  assert.deepEqual([nextStep('open')?.to, nextStep('in_progress')?.to, nextStep('remediated')?.to, nextStep('accepted')?.to, nextStep('closed')], ['in_progress', 'remediated', 'closed', 'closed', null]);
  for (const status of ['open', 'in_progress', 'remediated', 'accepted', 'closed']) {
    const moves = otherMoves(status).map((m) => m.to);
    assert.ok(!moves.includes(status), status);
    assert.ok(!moves.includes(nextStep(status)?.to ?? ''), `${status}: the next step is not repeated`);
  }
  assert.equal(otherMoves('closed').find((m) => m.to === 'open')?.label, 'Reopen');
  assert.equal(otherMoves('in_progress').find((m) => m.to === 'open')?.label, 'Back to open');
});

test('the words said when a move is done name the finding', () => {
  assert.equal(movedWords('closed', 'Weak control'), 'Closed "Weak control"');
  assert.equal(movedWords('open', 'X'), '"X" is open again');
});

test('the links read in words and an action needs a risk first', () => {
  assert.equal(linksText(f()), 'Not linked');
  assert.equal(linksText(f({ linked_risk_id: 1, linked_mitigation_action_id: 2 })), 'Risk, Action');
  assert.match(actionBlock(f()) ?? '', /Link a risk first/);
  assert.match(actionBlock(f({ linked_risk_id: 1, linked_mitigation_action_id: 5 })) ?? '', /already made/);
  assert.equal(actionBlock(f({ linked_risk_id: 1 })), null);
});

test('the export has one line a finding with days as days', () => {
  const out = csvOf([f({ remediation_due_date: '2026-07-15T00:00:00', business_unit_name: 'Treasury' })]);
  assert.equal(out.header.length, out.rows[0].length);
  assert.equal(out.rows[0][7], '2026-07-15');
});
