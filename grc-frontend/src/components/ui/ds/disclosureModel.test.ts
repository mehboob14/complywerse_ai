// node --test "src/components/ui/ds/disclosureModel.test.ts"
// The rules of Disclosure and AccordionRow apart from React: controlled or not, what a press asks for, the ids, the count words, long titles, heading levels.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { LONG_TITLE, disclosureIds, groupCount, headingLevel, isOpen, pressedState, repeatsTitle } from './disclosureModel.ts';

test('the page holds the state when it passes `open`; else the component does', () => {
  assert.equal(isOpen({ open: undefined, inner: true }), true);
  assert.equal(isOpen({ open: undefined, inner: false }), false);
  assert.equal(isOpen({ open: false, inner: true }), false);                 // controlled: the page wins over what the component remembers
  assert.equal(isOpen({ open: true, inner: false }), true);
});

test('a press asks for the opposite; the component keeps it only when it is uncontrolled', () => {
  assert.deepEqual(pressedState({ open: undefined, inner: false }), { next: true, keep: true });
  assert.deepEqual(pressedState({ open: undefined, inner: true }), { next: false, keep: true });
  assert.deepEqual(pressedState({ open: true, inner: false }), { next: false, keep: false });
  assert.deepEqual(pressedState({ open: false, inner: true }), { next: true, keep: false });
});

test('the button and the panel have ids that are the same every time for one base', () => {
  assert.deepEqual(disclosureIds(':r1:'), { button: ':r1:-header', panel: ':r1:-panel' });
  assert.notEqual(disclosureIds('a').panel, disclosureIds('b').panel);
});

test('the number beside a group says how many are chosen, true, and nothing when none is', () => {
  assert.equal(groupCount(2), '2');
  assert.equal(groupCount(1247), '1,247');
  assert.equal(groupCount(0), '');
  assert.equal(groupCount(-1), '');
  for (const none of [undefined, null, NaN, Infinity]) assert.equal(groupCount(none as number), '', String(none));
});

test('a long title is repeated in full inside the open row; a short one is not', () => {
  assert.equal(repeatsTitle('Review the minutes of the last meeting'), false);
  assert.equal(repeatsTitle('x'.repeat(LONG_TITLE)), false);
  assert.equal(repeatsTitle('x'.repeat(LONG_TITLE + 1)), true);
  assert.equal(repeatsTitle('  ' + 'x'.repeat(LONG_TITLE) + '  '), false);        // spaces do not count
  assert.equal(repeatsTitle('abcdef', 3), true);
});

test('the heading level is 2 to 6, else 3', () => {
  for (const l of [2, 3, 4, 5, 6]) assert.equal(headingLevel(l), l);
  for (const l of [undefined, 0, 1, 7, NaN, 3.5]) assert.equal(headingLevel(l as number), 3, String(l));
});
