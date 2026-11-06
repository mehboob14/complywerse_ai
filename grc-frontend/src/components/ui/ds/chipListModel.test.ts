// node --test "src/components/ui/ds/chipListModel.test.ts"
// The rules of ChipList apart from React: the items it takes, the first two and the "+N", when the full list is searchable, how a search narrows it,
// and the names a screen reader gets.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SEARCH_FROM, SHOWN, chipItems, dialogName, filterItems, moreName, resultLine, searchable, splitItems } from './chipListModel.ts';

test('items are strings or {label, href}; a blank one is left out, an empty address is no address, nothing is trimmed into a different word', () => {
  assert.deepEqual(chipItems(['ISO 27001', ' SOC 2 ', '', '   ']), [{ label: 'ISO 27001' }, { label: 'SOC 2' }]);
  assert.deepEqual(chipItems([{ label: 'PCI DSS', href: '/frameworks/3' }, { label: 'NCA', href: '' }, { label: '  ' }]), [{ label: 'PCI DSS', href: '/frameworks/3' }, { label: 'NCA' }]);
  for (const none of [null, undefined, []]) assert.deepEqual(chipItems(none as string[]), []);
  assert.deepEqual(chipItems([null as unknown as string, 7 as unknown as string, { label: 'Fine' }]), [{ label: 'Fine' }]);   // junk is left out and does not throw
});

test('the first two are chips and the rest is the +N; with two or fewer there is no +N', () => {
  assert.equal(SHOWN, 2);
  const items = chipItems(['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(splitItems(items), { visible: [{ label: 'a' }, { label: 'b' }], more: 3 });
  assert.deepEqual(splitItems(items, 4), { visible: items.slice(0, 4), more: 1 });
  assert.deepEqual(splitItems(items.slice(0, 2)), { visible: items.slice(0, 2), more: 0 });
  assert.deepEqual(splitItems(items.slice(0, 1)), { visible: items.slice(0, 1), more: 0 });
  assert.deepEqual(splitItems([]), { visible: [], more: 0 });
  assert.equal(splitItems(items.slice(0, 3)).more, 1);                                  // "+1" is a count like any other, as in PersonStack
});

test('the full list is searchable from eight items', () => {
  assert.equal(SEARCH_FROM, 8);
  assert.equal(searchable(7), false);
  assert.equal(searchable(8), true);
  assert.equal(searchable(300), true);
  assert.equal(searchable(5, 3), true);
});

test('a search keeps the items that have every word, in any case and without accents; no query keeps all', () => {
  const items = chipItems(['ISO 27001', 'ISO 22301', 'SOC 2 Type II', 'Zürich Cantonal Bank code', 'PCI DSS 4.0']);
  assert.deepEqual(filterItems(items, 'iso').map((i) => i.label), ['ISO 27001', 'ISO 22301']);
  assert.deepEqual(filterItems(items, 'iso 22').map((i) => i.label), ['ISO 22301']);
  assert.deepEqual(filterItems(items, '  type   ii ').map((i) => i.label), ['SOC 2 Type II']);
  assert.deepEqual(filterItems(items, 'zurich').map((i) => i.label), ['Zürich Cantonal Bank code']);
  assert.deepEqual(filterItems(items, 'nothing like this'), []);
  assert.equal(filterItems(items, '').length, 5);
  assert.equal(filterItems(items, '   ').length, 5);
  assert.notEqual(filterItems(items, ''), items);                                       // a copy: the caller's list is never handed back to be changed
});

test('a search keeps the address of an item and its place in the list', () => {
  const items = chipItems([{ label: 'Alpha', href: '/a' }, { label: 'Beta', href: '/b' }, { label: 'Alpine', href: '/c' }]);
  assert.deepEqual(filterItems(items, 'alp'), [{ label: 'Alpha', href: '/a' }, { label: 'Alpine', href: '/c' }]);
});

test('the +N button starts with the words on it, the list is named for what it holds, a search says how many it left', () => {
  assert.equal(moreName(3, 'frameworks'), '+3 more frameworks');
  assert.equal(moreName(1, ' owners '), '+1 more owners');
  assert.equal(moreName(12, ''), '+12 more');
  assert.equal(dialogName('frameworks'), 'All frameworks');
  assert.equal(dialogName(' '), 'All');
  assert.equal(resultLine(3, 12), '3 of 12');
  assert.equal(resultLine(12, 12), '');
  assert.equal(resultLine(0, 12), '0 of 12');
});
