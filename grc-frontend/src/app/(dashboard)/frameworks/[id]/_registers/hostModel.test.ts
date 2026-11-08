// node --test "src/app/(dashboard)/frameworks/\[id\]/_registers/hostModel.test.ts"
// The Registers tab's list: registers then documents, empty groups left out, and the arrow keys through both groups as one list.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LEAVE_QUESTION, groupItems, stepItem, type HostItem } from './hostModel.ts';

const items: HostItem[] = [
  { id: 'd1', label: 'Scope', kind: 'document' },
  { id: 'r1', label: 'Gap', kind: 'register' },
  { id: 'r2', label: 'Risk', kind: 'register' },
  { id: 'd2', label: 'Policy', kind: 'document' },
];

test('registers come first, documents second, each in the order given, and an empty group is not drawn', () => {
  const g = groupItems(items);
  assert.deepEqual(g.map((x) => [x.title, x.items.map((i) => i.id)]), [['Registers', ['r1', 'r2']], ['Documents', ['d1', 'd2']]]);
  assert.deepEqual(groupItems(items.filter((i) => i.kind === 'document')).map((x) => x.key), ['document']);
  assert.deepEqual(groupItems([]), []);
});

test('the arrow keys walk the list as drawn, across the groups, and stop at the ends', () => {
  assert.equal(stepItem(items, 'r1', 'ArrowDown'), 'r2');
  assert.equal(stepItem(items, 'r2', 'ArrowDown'), 'd1', 'from the last register to the first document');
  assert.equal(stepItem(items, 'd2', 'ArrowDown'), 'd2');
  assert.equal(stepItem(items, 'r1', 'ArrowUp'), 'r1');
  assert.equal(stepItem(items, 'd1', 'ArrowUp'), 'r2');
  assert.equal(stepItem(items, 'd2', 'Home'), 'r1');
  assert.equal(stepItem(items, 'r1', 'End'), 'd2');
  assert.equal(stepItem(items, null, 'ArrowDown'), 'r1');
  assert.equal(stepItem(items, 'gone', 'ArrowUp'), 'r1');
  assert.equal(stepItem([], 'r1', 'ArrowDown'), null);
});

test('the question asked before unsaved text is left says what is lost and offers the way back', () => {
  assert.equal(LEAVE_QUESTION.cancelLabel, 'Keep editing');
  assert.match(LEAVE_QUESTION.confirmLabel, /^Leave/);
  assert.doesNotMatch(JSON.stringify(LEAVE_QUESTION), /OK\b/);
});
