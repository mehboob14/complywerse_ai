import { test } from 'node:test';
import assert from 'node:assert/strict';

import { VIEW_NAME_MAX, exportTitle, filterChips, removeChip, resultText, validViewName, type FilterOptions } from './libraryFiltersLogic.ts';
import { NO_FILTERS, filterCount, type Filters } from './libraryModel.ts';

const OPTIONS: FilterOptions = {
  types: [{ value: 'policy', label: 'Policy' }, { value: 'standard', label: 'Standard' }],
  statuses: [{ value: 'draft', label: 'Draft' }, { value: 'pending_review', label: 'In Review' }, { value: 'archived', label: 'Archived' }],
  owners: [{ value: '1', label: 'Olivia Owner', subLabel: 'olivia@example.com' }, { value: 'none', label: 'No owner' }],
  departments: [{ value: '10', label: 'Operations' }],
  frameworks: [{ value: '1', label: 'NCA', subLabel: 'NCA Essential Cybersecurity Controls' }],
  classifications: [{ value: 'internal', label: 'Internal' }],
};
const f = (over: Partial<Filters>): Filters => ({ ...NO_FILTERS, ...over });
const labelsOf = (filters: Filters) => filterChips(filters, OPTIONS).map((c) => c.label);

// ── chips ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('no filters, no chips', () => {
  assert.deepEqual(filterChips(NO_FILTERS, OPTIONS), []);
  assert.deepEqual(filterChips(f({ search: '   ' }), OPTIONS), []);
});

test('each chip reads its words from the options, the label maps, or the filters themselves', () => {
  const all = f({
    types: ['policy'], statuses: ['pending_review'], owners: ['1'], departments: ['10'], frameworks: ['1'],
    review: ['overdue'], attestation: ['not_started'], classifications: ['internal'], search: ' data ', mine: true,
  });
  assert.deepEqual(labelsOf(all), [
    'Type: Policy', 'Status: In Review', 'Owner: Olivia Owner', 'Department: Operations', 'Framework: NCA',
    'Review: Overdue', 'Attestation: Nobody yet', 'Classification: Internal', 'Search: “data”', 'My documents',
  ]);
  assert.deepEqual(filterChips(f({ search: ' data ', mine: true }), OPTIONS).map((c) => [c.key, c.facet, c.value]), [['search', 'search', ' data '], ['mine', 'mine', 'mine']]);
});

test('one chip per value, in the order chosen, each with its own key', () => {
  const chips = filterChips(f({ types: ['standard', 'policy'], review: ['due_soon', 'overdue'] }), OPTIONS);
  assert.deepEqual(chips.map((c) => c.label), ['Type: Standard', 'Type: Policy', 'Review: Due in 30 days', 'Review: Overdue']);
  assert.equal(new Set(chips.map((c) => c.key)).size, 4);
});

test('a value the options do not know shows as it is, even a name that exists on every object', () => {
  assert.deepEqual(labelsOf(f({ types: ['procedure'], owners: ['999', 'constructor'], departments: ['__proto__'] })),
    ['Type: procedure', 'Owner: 999', 'Owner: constructor', 'Department: __proto__']);
  assert.deepEqual(labelsOf(f({ owners: ['none'] })), ['Owner: No owner']);
});

test('the chips are as many as the filters that are on (a search or My documents is one each)', () => {
  const some = f({ types: ['policy', 'standard'], search: 'x', mine: true });
  assert.equal(filterChips(some, OPTIONS).length, 4);
  assert.equal(filterCount(some), 3);        // the count of the model counts a facet once; the chips are per value
});

// ── taking a chip off ─────────────────────────────────────────────────────────────────────────────────────────────────────

test('removing a chip takes off that value only', () => {
  const start = f({ types: ['policy', 'standard'], owners: ['1'], review: ['overdue', 'ok'], search: 'data', mine: true });
  const chips = filterChips(start, OPTIONS);
  const chip = (key: string) => chips.find((c) => c.key === key)!;
  assert.deepEqual(removeChip(start, chip('types:policy')).types, ['standard']);
  assert.deepEqual(removeChip(start, chip('review:overdue')).review, ['ok']);
  assert.deepEqual(removeChip(start, chip('owners:1')).owners, []);
  assert.equal(removeChip(start, chip('search')).search, '');
  assert.equal(removeChip(start, chip('mine')).mine, false);
  assert.deepEqual(removeChip(start, chip('search')).types, ['policy', 'standard']);      // the rest stays
  assert.deepEqual(start.types, ['policy', 'standard']);                                  // and the filters it was given are not changed
});

test('removing a status chip follows the status rule: Archived stands alone', () => {
  const live = f({ statuses: ['draft', 'pending_review'] });
  assert.deepEqual(removeChip(live, filterChips(live, OPTIONS)[0]).statuses, ['pending_review']);
  const archived = f({ statuses: ['archived'] });
  assert.deepEqual(removeChip(archived, filterChips(archived, OPTIONS)[0]).statuses, []);
});

test('taking off every chip leaves no filter at all', () => {
  let state = f({
    types: ['policy'], statuses: ['draft', 'pending_review'], owners: ['1'], departments: ['10'], frameworks: ['1'],
    review: ['overdue'], attestation: ['none', 'complete'], classifications: ['internal'], search: 'data', mine: true,
  });
  for (let chips = filterChips(state, OPTIONS); chips.length; chips = filterChips(state, OPTIONS)) state = removeChip(state, chips[0]);
  assert.deepEqual(state, NO_FILTERS);
});

// ── view names ────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a view needs a name', () => {
  assert.equal(validViewName('', []), 'Give the view a name.');
  assert.equal(validViewName('    ', []), 'Give the view a name.');
  assert.equal(validViewName('Overdue policies', []), null);
});

test('a view name is at most 40 characters, counted after trimming', () => {
  assert.equal(VIEW_NAME_MAX, 40);
  assert.equal(validViewName('x'.repeat(40), []), null);
  assert.equal(validViewName(`  ${'x'.repeat(40)}  `, []), null);
  assert.equal(validViewName('x'.repeat(41), []), 'Use 40 characters or fewer.');
});

test('two of the person\'s views cannot share a name, whatever the case or the spaces around it', () => {
  const mine = ['Overdue policies', ' Board pack '];
  assert.equal(validViewName('overdue POLICIES', mine), 'You already have a view with this name.');
  assert.equal(validViewName('  Board pack', mine), 'You already have a view with this name.');
  assert.equal(validViewName('Board packs', mine), null);
  assert.equal(validViewName('Overdue policies', []), null);
});

// ── the bar's lines ───────────────────────────────────────────────────────────────────────────────────────────────────────

test('the count says "12 of 48 documents" only while filtering', () => {
  assert.equal(resultText(48, 48, false), '48 documents');
  assert.equal(resultText(12, 48, true), '12 of 48 documents');
  assert.equal(resultText(1, 48, false), '1 document');
  assert.equal(resultText(1, 1, true), '1 of 1 document');
  assert.equal(resultText(0, 48, true), '0 of 48 documents');
  assert.equal(resultText(1204, 1204, false), '1,204 documents');
});

test('Export CSV says what it exports, or why it cannot', () => {
  assert.equal(exportTitle(12, true), 'Exports the 12 documents shown');
  assert.equal(exportTitle(1, true), 'Exports the 1 document shown');
  assert.equal(exportTitle(0, false), 'Nothing to export');
});
