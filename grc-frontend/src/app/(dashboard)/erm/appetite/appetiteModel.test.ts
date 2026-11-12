// node --test "src/app/(dashboard)/erm/appetite/appetiteModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { breachActions, excessExpiryRange, limitChangeLines, limitsSourceText, lineDiff, type BreachRecord } from './appetiteModel.ts';

const breach = (status: BreachRecord['status'], can_plan = false) => ({ status, can_plan }) as BreachRecord;

test('a line diff keeps shared lines and marks what was removed and added', () => {
  assert.deepEqual(lineDiff('We accept low risk.\nNo fraud.', 'We accept low risk.\nNo fraud at all.\nReview yearly.'), [
    { kind: 'same', text: 'We accept low risk.' },
    { kind: 'removed', text: 'No fraud.' },
    { kind: 'added', text: 'No fraud at all.' },
    { kind: 'added', text: 'Review yearly.' },
  ]);
  assert.deepEqual(lineDiff('', 'First'), [{ kind: 'added', text: 'First' }]);
  assert.deepEqual(lineDiff('Same', 'Same'), [{ kind: 'same', text: 'Same' }]);
});

test('the actions on a breach follow its state and who may act', () => {
  assert.deepEqual(breachActions(breach('open', true), true), ['plan']);
  assert.deepEqual(breachActions(breach('open', false), true), [], 'no plan yet: nothing to decide');
  assert.deepEqual(breachActions(breach('plan_proposed', true), true), ['plan', 'approve-plan', 'reject-plan', 'approve-excess']);
  assert.deepEqual(breachActions(breach('plan_proposed', true), false), ['plan'], 'an owner who is not an editor');
  assert.deepEqual(breachActions(breach('plan_approved', true), true), ['approve-excess']);
  assert.deepEqual(breachActions(breach('excess_approved', true), true), []);
  assert.deepEqual(breachActions(breach('resolved', true), true), []);
});

test('an excess runs out tomorrow at the earliest and within six months (the server allows 183 days to the second)', () => {
  assert.deepEqual(excessExpiryRange(new Date('2026-11-11T10:00:00Z')), { min: '2026-11-12', max: '2027-05-12' });
});

test('where the limits in force come from reads in words', () => {
  assert.equal(limitsSourceText({ version: 2, state: 'as_approved' }), 'In force as approved with version 2.');
  assert.equal(limitsSourceText({ version: 2, state: 'changed' }), 'Changed since version 2 by an approved limit change.');
  assert.equal(limitsSourceText({ version: 2, state: 'added' }), 'Added after version 2: not in an approved version.');
  assert.match(limitsSourceText({ version: 2, state: 'proposed' }), /not in force yet/);
  assert.match(limitsSourceText({ version: 1, state: 'not_recorded' }), /before limits were recorded/);
  assert.equal(limitsSourceText(null), 'No approved statement yet: limits change at once.');
});

test('a limit change reads as what moves from the limits in force', () => {
  const inForce = { tolerance_threshold: 10, limit_kri_ids: [4, 5], escalation_owner_id: 9, concentration_limit: null };
  assert.deepEqual(limitChangeLines(inForce, { tolerance_threshold: 15, limit_kri_ids: [] }),
    ['Tolerance threshold: 10 → 15', 'Limit KRIs: 2 linked → 0 linked']);
  assert.deepEqual(limitChangeLines(inForce, { escalation_owner_id: 7, concentration_limit: 3 }, (id) => (id === 9 ? 'Olu' : 'Ada')),
    ['Escalation owner: Olu → Ada', 'Concentration limit: — → 3']);
  assert.deepEqual(limitChangeLines(inForce, { tolerance_threshold: 15, remove: true }), ['Remove this limit']);
});
