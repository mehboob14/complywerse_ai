// node --test "src/components/ui/ds/listboxModel.test.ts"
// The rules of the searchable selects (MultiSelect, Combobox): the search and its fold, the active option, type-ahead, what a toggle / select all / clear do to
// the chosen values, and what the trigger says. Pure and tested here; the keyboard, the focus and the popover were checked in a browser on the style guide.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fold as libraryFold } from '../../../app/(dashboard)/governance/documents/_workspace/libraryModel.ts';
import {
  filterOptions, fold, initialActive, isTyping, moveActive, selectAll, selectNone, summaryOf, toggleValue, typeAhead, typeAheadIndex, type ListOption,
} from './listboxModel.ts';

const STATUSES: ListOption[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'pending_review', label: 'In review' },
  { value: 'pending_approval', label: 'In approval' },
  { value: 'approved', label: 'Approved' },
  { value: 'published', label: 'Published' },
  { value: 'expired', label: 'Expired', disabled: true },
  { value: 'archived', label: 'Archived' },
];
const values = (options: readonly ListOption[]) => options.map((o) => o.value);

// ── the fold ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the fold is the Documents library\'s own: lower case, no accents, compatibility forms', () => {
  for (const text of ['Zürich', 'ZÜRICH', 'Crème brûlée', 'São Paulo', 'ﬁnance', 'Ångström', 'İstanbul', 'Ⅻ', 'Straße', '', '  spaces  ', 'MiXeD 123', 'سياسة', '東京']) {
    assert.equal(fold(text), libraryFold(text), JSON.stringify(text));
  }
  assert.equal(fold('Zürich'), 'zurich');
  assert.equal(fold('ﬁnance'), 'finance');
});

// ── search ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('no query, or only spaces, leaves every option (a copy, in the same order)', () => {
  assert.deepEqual(values(filterOptions(STATUSES, '')), values(STATUSES));
  assert.deepEqual(values(filterOptions(STATUSES, '   ')), values(STATUSES));
  assert.notEqual(filterOptions(STATUSES, ''), STATUSES);
});

test('a search keeps the options that hold the text, in any case and without accents', () => {
  assert.deepEqual(values(filterOptions(STATUSES, 'REV')), ['pending_review']);
  assert.deepEqual(values(filterOptions(STATUSES, 'in ')), ['pending_review', 'pending_approval']);
  assert.deepEqual(values(filterOptions([{ value: 'z', label: 'Zürich office' }], 'zurich')), ['z']);
  assert.deepEqual(filterOptions(STATUSES, 'nothing like this'), []);
});

test('every word must be found (in any order), in the label or the description', () => {
  const people: ListOption[] = [
    { value: '1', label: 'Dana Okafor', description: 'dana@example.com' },
    { value: '2', label: 'Sam Rivera', description: 'sam.rivera@example.com' },
    { value: '3', label: 'Danielle Rivera', description: 'danielle@example.org' },
  ];
  assert.deepEqual(values(filterOptions(people, 'rivera')), ['2', '3']);
  assert.deepEqual(values(filterOptions(people, 'rivera dan')), ['3']);
  assert.deepEqual(values(filterOptions(people, 'dan rivera')), ['3']);
  assert.deepEqual(values(filterOptions(people, 'example.org')), ['3']);                          // the description is searched
  assert.deepEqual(values(filterOptions(people, 'sam okafor')), []);
});

// ── the active option ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the list opens on the first chosen option, else on the first that can be chosen', () => {
  assert.equal(initialActive(STATUSES, []), 0);
  assert.equal(initialActive(STATUSES, ['approved', 'draft']), 0);                                // the first in the LIST, not in the choice
  assert.equal(initialActive(STATUSES, ['published']), 4);
  assert.equal(initialActive(STATUSES, ['expired']), 0);                                          // chosen but disabled: not a place to stand
  assert.equal(initialActive(STATUSES, ['gone']), 0);
  assert.equal(initialActive([], ['x']), -1);
  assert.equal(initialActive([{ value: 'a', label: 'A', disabled: true }], []), -1);
});

test('ArrowDown and ArrowUp step with a wrap and skip a disabled option; Home and End go to the ends', () => {
  assert.equal(moveActive(STATUSES, 0, 'ArrowDown'), 1);
  assert.equal(moveActive(STATUSES, 4, 'ArrowDown'), 6);                                          // Expired (5) is disabled
  assert.equal(moveActive(STATUSES, 6, 'ArrowDown'), 0);                                          // wraps
  assert.equal(moveActive(STATUSES, 0, 'ArrowUp'), 6);
  assert.equal(moveActive(STATUSES, 6, 'ArrowUp'), 4);
  assert.equal(moveActive(STATUSES, 3, 'Home'), 0);
  assert.equal(moveActive(STATUSES, 3, 'End'), 6);
  assert.equal(moveActive(STATUSES, -1, 'ArrowDown'), 0);                                         // nothing active yet
  assert.equal(moveActive(STATUSES, -1, 'ArrowUp'), 6);
});

test('any other key is not for the active option (null), and a list with nothing to choose has no active option', () => {
  for (const key of ['a', 'Enter', ' ', 'Escape', 'Tab', 'PageDown']) assert.equal(moveActive(STATUSES, 2, key), null, key);
  const locked: ListOption[] = [{ value: 'a', label: 'A', disabled: true }, { value: 'b', label: 'B', disabled: true }];
  for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) assert.equal(moveActive(locked, 0, key), -1, key);
  assert.equal(moveActive([], -1, 'ArrowDown'), -1);
});

// ── type-ahead ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('typing a letter goes to the next option that starts with it, and the same letter again goes on to the one after', () => {
  const list: ListOption[] = [{ value: 'a', label: 'Apple' }, { value: 'b', label: 'Banana' }, { value: 'c', label: 'Avocado' }, { value: 'd', label: 'Apricot' }, { value: 'e', label: 'Cherry' }];
  assert.equal(typeAheadIndex(list, -1, 'a'), 0);
  assert.equal(typeAheadIndex(list, 0, 'a'), 2);
  assert.equal(typeAheadIndex(list, 2, 'a'), 3);
  assert.equal(typeAheadIndex(list, 3, 'a'), 0);                                                  // wraps
  assert.equal(typeAheadIndex(list, 0, 'aa'), 2);                                                 // "aa" is the same letter twice: it cycles too
  assert.equal(typeAheadIndex(list, 0, 'c'), 4);
  assert.equal(typeAheadIndex(list, 0, 'z'), -1);
});

test('letters that make a word keep the active option while it still starts with them', () => {
  const list: ListOption[] = [{ value: 'a', label: 'Apple' }, { value: 'b', label: 'Avocado' }, { value: 'c', label: 'Apricot' }];
  assert.equal(typeAheadIndex(list, 2, 'ap'), 2);                                                 // Apricot starts with "ap" and is active: stay
  assert.equal(typeAheadIndex(list, 1, 'ap'), 2);                                                 // Avocado does not: on to the next that does
  assert.equal(typeAheadIndex(list, 1, 'av'), 1);
  assert.equal(typeAheadIndex(list, -1, 'apr'), 2);
});

test('type-ahead folds case and accents and skips a disabled option', () => {
  const list: ListOption[] = [{ value: 'a', label: 'Éclair' }, { value: 'b', label: 'Eclipse', disabled: true }, { value: 'c', label: 'Echo' }];
  assert.equal(typeAheadIndex(list, -1, 'e'), 0);
  assert.equal(typeAheadIndex(list, 0, 'e'), 2);                                                  // Eclipse is skipped
  assert.equal(typeAheadIndex(list, -1, 'ECL'), 0);
  assert.equal(typeAheadIndex(list, -1, 'ecli'), -1);                                             // only the disabled one starts with it
});

test('nothing typed, or no options, is nowhere', () => {
  assert.equal(typeAheadIndex(STATUSES, 0, ''), -1);
  assert.equal(typeAheadIndex([], 0, 'a'), -1);
});

test('the letters typed within 700 ms make one word; a pause starts again', () => {
  const a = typeAhead(null, 'a', 1000);
  assert.deepEqual(a, { text: 'a', at: 1000 });
  const ap = typeAhead(a, 'p', 1500);
  assert.deepEqual(ap, { text: 'ap', at: 1500 });
  assert.deepEqual(typeAhead(ap, 'r', 2200), { text: 'apr', at: 2200 });                          // exactly 700 ms after the last: still the same word
  assert.deepEqual(typeAhead(ap, 'r', 2201), { text: 'r', at: 2201 });                            // 701: a new word
  assert.deepEqual(typeAhead(ap, 'r', 9000, 5000), { text: 'r', at: 9000 });
});

test('letters are being typed for 700 ms after the last one: a Space then is part of the word, and a Space on its own chooses', () => {
  const buffer = typeAhead(null, 'i', 1000);
  assert.equal(isTyping(buffer, 1000), true);
  assert.equal(isTyping(buffer, 1700), true);                                                    // exactly 700 ms
  assert.equal(isTyping(buffer, 1701), false);
  assert.equal(isTyping(null, 1000), false);
  assert.equal(isTyping(buffer, 1701, 1000), true);                                              // a longer window
  // "in ap": the Space is typed inside the word, so the word goes on and reaches "In approval"
  const list: ListOption[] = [{ value: 'a', label: 'In review' }, { value: 'b', label: 'In approval' }, { value: 'c', label: 'Approved' }];
  let word = typeAhead(null, 'i', 0);
  for (const [key, at] of [['n', 100], [' ', 200], ['a', 300], ['p', 400]] as const) word = typeAhead(word, key, at);
  assert.equal(word.text, 'in ap');
  assert.equal(typeAheadIndex(list, 0, word.text), 1);
});

// ── what is chosen ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a toggle adds a value at the end, or takes it out; the rest keep their order and the input is not touched', () => {
  const chosen = ['draft', 'approved'];
  assert.deepEqual(toggleValue(chosen, 'published'), ['draft', 'approved', 'published']);
  assert.deepEqual(toggleValue(chosen, 'draft'), ['approved']);
  assert.deepEqual(toggleValue([], 'x'), ['x']);
  assert.deepEqual(chosen, ['draft', 'approved']);
});

test('select all chooses what can be chosen among the shown options: what was chosen stays, a disabled one is not added, nothing twice', () => {
  assert.deepEqual(selectAll(STATUSES, []), ['draft', 'pending_review', 'pending_approval', 'approved', 'published', 'archived']);
  assert.deepEqual(selectAll(STATUSES, ['approved', 'draft']), ['approved', 'draft', 'pending_review', 'pending_approval', 'published', 'archived']);
  assert.deepEqual(selectAll(STATUSES, ['expired']), ['expired', 'draft', 'pending_review', 'pending_approval', 'approved', 'published', 'archived']);
  assert.deepEqual(selectAll([], ['draft']), ['draft']);
});

test('select all on a search\'s result chooses only those', () => {
  const shown = filterOptions(STATUSES, 'in ');
  assert.deepEqual(selectAll(shown, ['published']), ['published', 'pending_review', 'pending_approval']);
});

test('clear un-chooses the shown options: a value the search hides stays, and so does one that is disabled', () => {
  assert.deepEqual(selectNone(STATUSES, ['draft', 'approved']), []);
  assert.deepEqual(selectNone(STATUSES, ['draft', 'expired']), ['expired']);                      // Expired is locked on
  assert.deepEqual(selectNone(filterOptions(STATUSES, 'in '), ['draft', 'pending_review', 'published']), ['draft', 'published']);
  assert.deepEqual(selectNone(STATUSES, ['gone', 'draft']), ['gone']);                            // not in the list at all: not this list's to clear
  assert.deepEqual(selectNone([], ['draft']), ['draft']);
});

// ── the trigger ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('nothing chosen says the placeholder', () => {
  assert.deepEqual(summaryOf(STATUSES, [], 'count', 'All statuses'), { empty: true, text: 'All statuses', chips: [], more: 0, labels: [] });
  assert.equal(summaryOf(STATUSES, []).text, '');
});

test('one chosen is its label; several are counted ("3 selected") and the tooltip lists them in the order they were chosen', () => {
  assert.equal(summaryOf(STATUSES, ['approved']).text, 'Approved');
  const s = summaryOf(STATUSES, ['published', 'draft', 'approved']);
  assert.equal(s.text, '3 selected');
  assert.deepEqual(s.labels, ['Published', 'Draft', 'Approved']);
  assert.equal(s.empty, false);
});

test('chips: the first two labels and how many more, in words too', () => {
  const one = summaryOf(STATUSES, ['draft'], 'chips');
  assert.deepEqual([one.chips, one.more, one.text], [['Draft'], 0, 'Draft']);
  const two = summaryOf(STATUSES, ['draft', 'approved'], 'chips');
  assert.deepEqual([two.chips, two.more, two.text], [['Draft', 'Approved'], 0, 'Draft, Approved']);
  const four = summaryOf(STATUSES, ['draft', 'approved', 'published', 'archived'], 'chips');
  assert.deepEqual([four.chips, four.more, four.text], [['Draft', 'Approved'], 2, 'Draft, Approved +2']);
});

test('a chosen value whose option is not there (not loaded yet) is shown as it is: a filter in force is never drawn as "nothing chosen"', () => {
  assert.equal(summaryOf([], ['17']).text, '17');
  assert.equal(summaryOf([], ['17', '18']).text, '2 selected');
  assert.deepEqual(summaryOf(STATUSES, ['draft', '99'], 'chips').chips, ['Draft', '99']);
});
