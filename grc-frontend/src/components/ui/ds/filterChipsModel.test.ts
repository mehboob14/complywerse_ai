// node --test "src/components/ui/ds/filterChipsModel.test.ts"
// The rules of a row of FilterChips apart from React: the count reads true ("1,247"), what stays in the row and what goes to "+N more", what a chip says,
// the roving tab stop and the arrow keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { chipStop, chipText, countText, moreItems, moreText, nextChip, splitChips, type ChipLike } from './filterChipsModel.ts';

const chip = (key: string, extra: Partial<ChipLike> = {}): ChipLike => ({ key, label: key[0].toUpperCase() + key.slice(1), ...extra });

test('a count reads true: 1,247, never 99+; 0 is a count; nothing is nothing', () => {
  assert.equal(countText(1247), '1,247');
  assert.equal(countText(99), '99');
  assert.equal(countText(100), '100');
  assert.equal(countText(1234567), '1,234,567');
  assert.equal(countText(0), '0');
  assert.equal(countText(-4), '0');
  assert.equal(countText(12.6), '13');
  for (const none of [undefined, null, NaN, Infinity]) assert.equal(countText(none as number), '', String(none));
});

test('a chip says its label, its count and its flag in words', () => {
  assert.equal(chipText(chip('all', { count: 1247 })), 'All, 1,247');
  assert.equal(chipText(chip('mine')), 'Mine');
  assert.equal(chipText(chip('audit', { label: ' Audit Committee ', count: 3, flag: { tone: 'danger', text: 3, label: '3 overdue actions' } })), 'Audit Committee, 3, 3 overdue actions');
  assert.equal(chipText(chip('live', { flag: { tone: 'info', label: 'meeting in progress' } })), 'Live, meeting in progress');
  assert.equal(chipText(chip('zero', { count: 0 })), 'Zero, 0');
});

test('with no maxVisible every shown chip stays in the row; a hidden chip is in neither list', () => {
  const chips = [chip('a'), chip('b', { hidden: true }), chip('c')];
  assert.deepEqual(splitChips(chips).row.map((c) => c.key), ['a', 'c']);
  assert.deepEqual(splitChips(chips).more, []);
  assert.deepEqual(splitChips(chips, undefined).more, []);
  assert.deepEqual(splitChips(chips, Infinity).more, []);
  assert.deepEqual(splitChips([], 3), { row: [], more: [] });
});

test('maxVisible cuts the row and the rest go to the menu, in order; a cut that would leave one chip in the menu is not made', () => {
  const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((k) => chip(k));
  const cut = splitChips(six, 3);
  assert.deepEqual(cut.row.map((c) => c.key), ['a', 'b', 'c']);
  assert.deepEqual(cut.more.map((c) => c.key), ['d', 'e', 'f']);
  const five = six.slice(0, 5);
  assert.deepEqual(splitChips(five, 3).more.map((c) => c.key), ['d', 'e']);
  const four = six.slice(0, 4);
  assert.deepEqual(splitChips(four, 3).more, []);                                // "+1 more" saves nothing
  assert.deepEqual(splitChips(four, 3).row.map((c) => c.key), ['a', 'b', 'c', 'd']);
  assert.deepEqual(splitChips(six, 0).row.map((c) => c.key), ['a']);              // at least one chip stays
  assert.deepEqual(splitChips(six, 2.9).row.map((c) => c.key), ['a', 'b']);
});

test('the "+N more" trigger says how many, and how many of them are on, so an applied filter is never out of sight', () => {
  assert.deepEqual(moreText([chip('d'), chip('e'), chip('f')]), { text: '+3 more', on: 0 });
  assert.deepEqual(moreText([chip('d'), chip('e', { active: true }), chip('f')]), { text: '+3 more · 1 on', on: 1 });
  assert.deepEqual(moreText([chip('d', { active: true }), chip('e', { active: true })]), { text: '+2 more · 2 on', on: 2 });
});

test('the menu items carry the label (and the flag in words), the true count at the end and a check for the chips that are on', () => {
  const items = moreItems([chip('d', { count: 1247, active: true }), chip('e', { flag: { tone: 'warning', label: 'overdue' } }), chip('f', { count: 0, disabled: true })]);
  assert.deepEqual(items, [
    { key: 'd', label: 'D', checked: true, trailing: '1,247', disabled: undefined },
    { key: 'e', label: 'E (overdue)', checked: false, trailing: undefined, disabled: undefined },
    { key: 'f', label: 'F', checked: false, trailing: '0', disabled: true },
  ]);
});

test('one tab stop: the chip that last had focus, else the first that is on, else the first that can be reached', () => {
  const chips = [chip('a', { disabled: true }), chip('b'), chip('c', { active: true }), chip('d')];
  assert.equal(chipStop(chips, null), 'c');
  assert.equal(chipStop(chips, 'd'), 'd');
  assert.equal(chipStop(chips, 'a'), 'c');                                        // a disabled chip cannot hold the stop
  assert.equal(chipStop(chips, 'gone'), 'c');
  assert.equal(chipStop([chip('a'), chip('b')], null), 'a');
  assert.equal(chipStop([chip('a', { disabled: true })], null), null);
  assert.equal(chipStop([], null), null);
  assert.equal(chipStop([chip('a', { active: true, disabled: true }), chip('b')], null), 'b');   // an "on" chip that is disabled is not a stop
});

test('arrows move between chips with a wrap, Home and End jump, a disabled chip is skipped, any other key is not ours', () => {
  const chips = [chip('a'), chip('b', { disabled: true }), chip('c'), chip('d')];
  assert.equal(nextChip(chips, 'a', 'ArrowRight'), 'c');
  assert.equal(nextChip(chips, 'd', 'ArrowRight'), 'a');
  assert.equal(nextChip(chips, 'a', 'ArrowLeft'), 'd');
  assert.equal(nextChip(chips, 'c', 'ArrowLeft'), 'a');
  assert.equal(nextChip(chips, 'c', 'Home'), 'a');
  assert.equal(nextChip(chips, 'a', 'End'), 'd');
  for (const key of ['Enter', ' ', 'ArrowUp', 'ArrowDown', 'Tab', 'x']) assert.equal(nextChip(chips, 'a', key), null, key);
  assert.equal(nextChip([], 'a', 'ArrowRight'), null);
});
