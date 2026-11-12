import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupQuestions, newVersionNotice, questionGroup } from './questionLinks.ts';

test('a question linked to a register risk groups under the risk, others under their section', () => {
  assert.equal(questionGroup({ section: 'Payments', risk_id: 5, risk_title: 'Card fraud' }), 'Risk: Card fraud');
  assert.equal(questionGroup({ section: 'Payments' }), 'Payments');
  assert.equal(questionGroup({ risk_id: 9 }), 'Risk: #9');
  assert.equal(questionGroup({}), 'General');
});

test('groups keep the order of their first question', () => {
  const qs = [
    { id: 1, section: 'A', risk_id: 5, risk_title: 'Card fraud' },
    { id: 2, section: 'A' },
    { id: 3, section: 'B', risk_id: 5, risk_title: 'Card fraud' },
  ];
  assert.deepEqual(groupQuestions(qs).map(([key, items]) => [key, items.map((q) => q.id)]), [
    ['Risk: Card fraud', [1, 3]],
    ['A', [2]],
  ]);
});

test('a save that came back with another id was kept as the next version', () => {
  assert.equal(newVersionNotice(1, { id: 1, version: '1.0' }), null);
  assert.match(newVersionNotice(1, { id: 7, version: '2.0' }) ?? '', /^Saved as version 2\.0\./);
});
