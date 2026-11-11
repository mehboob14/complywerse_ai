// node --test "src/components/compliance/onboarding/fieldModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  answered, askedByText, choiceLayout, cleanRow, cleanRows, confidenceWord, departmentTree, draftOfPerson, filesOf, fromYesNo, hasSingleControl, hasValue, isBlank, levelWord,
  makeVisible, newRowId, orgRowsOf, parseNumberText, personFromDraft, personKind, rowAbout, rowComplete, rowMissing, rowStarted, rowTitle, safeUrls, sameRows,
  tableLayout, toYesNo, toggleId, toggleOption, whenHolds, withSaved, type AnyField, type Lookup,
} from './fieldModel.ts';
import { COUNTRIES, countryChoices } from './countries.ts';
import type { When } from '@/lib/frameworkOnboarding';

const col = (key: string, type: string, extra: Record<string, unknown> = {}) => ({ key, label: key, type, ...extra }) as never;
const regulators = { key: 'regulators', label: 'Regulators', type: 'table', level: 'required', note: '', min_rows: 1,
  columns: [col('regulator', 'text', { required: true }), col('country', 'country', { required: true }), col('relationship', 'choice', { required: true, options: ['Licensed by', 'Supervised by'] }), col('reference', 'text')] } as never;
const COLS = (regulators as { columns: never[] }).columns;

test('blank is nothing there: null, spaces, an empty list; a zero and a false are values', () => {
  for (const v of [null, undefined, '', '   ', [], {}]) assert.equal(isBlank(v), true, JSON.stringify(v));
  for (const v of [0, false, 'x', [1], { a: 1 }]) assert.equal(isBlank(v), false, JSON.stringify(v));
});

test('a row is started when any cell holds something, and complete when its required cells do too', () => {
  assert.equal(rowStarted(COLS, {}), false);
  assert.equal(rowStarted(COLS, { id: 'a', regulator: '  ' }), false, 'spaces are nothing');
  assert.equal(rowStarted(COLS, { reference: 'R-1' }), true);
  assert.deepEqual(rowMissing(COLS, {}).map((c) => c.key), [], 'a row nobody began lacks nothing');
  assert.deepEqual(rowMissing(COLS, { reference: 'R-1' }).map((c) => c.key), ['regulator', 'country', 'relationship']);
  assert.equal(rowComplete(COLS, { reference: 'R-1' }), false);
  assert.equal(rowComplete(COLS, { regulator: 'SBP', country: 'Pakistan', relationship: 'Supervised by' }), true);
});

test('a bool column set to false counts as begun (a "no" is an answer)', () => {
  const cols = [col('name', 'text', { required: true }), col('regulated', 'bool')];
  assert.equal(rowStarted(cols, { regulated: false }), true);
  assert.deepEqual(rowMissing(cols, { regulated: false }).map((c) => c.key), ['name']);
});

test('rows are cleaned the way the server keeps them: the id, and the cells that hold something; unbegun rows go', () => {
  assert.deepEqual(cleanRow(COLS, { id: 'r1', regulator: 'SBP', country: '', stray: 'x' }), { id: 'r1', regulator: 'SBP' });
  assert.deepEqual(cleanRows(COLS, [{ id: 'a' }, { id: 'b', regulator: 'SBP' }, { id: 'c', country: ' ' }]), [{ id: 'b', regulator: 'SBP' }]);
  assert.equal(sameRows(COLS, [{ id: 'b', regulator: 'SBP' }, { id: 'new' }], [{ regulator: 'SBP', id: 'b', country: '' }]), true, 'a draft row and cell order do not matter');
  assert.equal(sameRows(COLS, [{ id: 'b', regulator: 'SBP' }], [{ id: 'b', regulator: 'SAMA' }]), false);
  assert.equal(sameRows(COLS, [{ id: 'b', regulator: 'SBP' }], [{ id: 'z', regulator: 'SBP' }]), false, 'the id is part of a row');
});

test('a new row id is short, made of letters and digits, and different each time', () => {
  const a = newRowId();
  assert.match(a, /^n[a-z0-9]{9}$/);
  assert.ok(a.length <= 24, 'the server keeps an id up to 24 characters');
  assert.notEqual(a, newRowId());
  assert.equal(newRowId(() => 0), 'n000000000');
});

test('a table is answered by its complete rows; a list by its length; a yes or a no both answer', () => {
  assert.equal(answered(regulators, []), false);
  assert.equal(answered(regulators, [{ id: 'a', regulator: 'SBP' }]), false, 'one cell is not a row');
  assert.equal(answered(regulators, [{ id: 'a', regulator: 'SBP', country: 'Pakistan', relationship: 'Supervised by' }]), true);
  const bool = { key: 'b', label: 'B', type: 'bool', level: 'required', note: '' } as AnyField;
  assert.deepEqual([null, true, false].map((v) => answered(bool, v)), [false, true, true]);
  assert.deepEqual([null, true, false].map((v) => hasValue(bool, v)), [false, true, false], 'a statement holds only when ticked');
  const countries = { key: 'c', label: 'C', type: 'countries', level: 'required', note: '', min_rows: 2 } as AnyField;
  assert.equal(answered(countries, ['Oman']), false);
  assert.equal(answered(countries, ['Oman', 'Qatar']), true);
  const text = { key: 't', label: 'T', type: 'text', level: 'required', note: '' } as AnyField;
  assert.deepEqual([undefined, '', ' x '].map((v) => answered(text, v)), [false, false, true]);
  const person = { key: 'p', label: 'P', type: 'person', level: 'required', note: '' } as AnyField;
  assert.deepEqual([null, {}, { user_id: 4 }, { name: 'A. Khan' }, { name: ' ' }].map((v) => answered(person, v)), [false, false, true, true, false]);
});

// the profile's own conditions: "tick that there is none, and the list goes"
const noRegulator = { key: 'no_regulator', label: 'No regulator', type: 'bool', level: 'optional', note: '' } as AnyField;
const profileFields: Record<string, AnyField & { when?: When }> = {
  'reg.regulators': { ...(regulators as object), when: { field: 'reg.no_regulator', ne: true } } as never,
  'reg.no_regulator': noRegulator as never,
  'reg.next': { key: 'next', label: 'Next', type: 'date', level: 'optional', note: '', when: { field: 'reg.regulators', truthy: true } } as never,
  'reg.region': { key: 'region', label: 'Region', type: 'choice', level: 'optional', note: '', options: ['A', 'B'], when: { field: 'reg.scope', in: ['GCC', 'EU'] } } as never,
  'reg.scope': { key: 'scope', label: 'Scope', type: 'multichoice', level: 'optional', note: '', options: ['GCC', 'EU'] } as never,
  'reg.eu': { key: 'eu', label: 'EU', type: 'text', level: 'optional', note: '', when: { field: 'reg.scope', includes: 'EU' } } as never,
  'reg.kind': { key: 'kind', label: 'Kind', type: 'choice', level: 'optional', note: '', options: ['X', 'Y'] } as never,
  'reg.nonx': { key: 'nonx', label: 'Not X', type: 'text', level: 'optional', note: '', when: { field: 'reg.kind', eq: 'X' } } as never,
};
const lookIn = (values: Record<string, unknown>): Lookup => (ref) => ({ field: profileFields[ref], value: values[ref] });

test('"ne true" asks for the list until the none box is ticked (an unanswered box is not a tick)', () => {
  const when = { field: 'reg.no_regulator', ne: true };
  assert.equal(whenHolds(when, lookIn({})), true);
  assert.equal(whenHolds(when, lookIn({ 'reg.no_regulator': false })), true);
  assert.equal(whenHolds(when, lookIn({ 'reg.no_regulator': true })), false);
});

test('eq, in, includes and truthy follow the server, and a field with no condition is always asked', () => {
  assert.equal(whenHolds(undefined, lookIn({})), true);
  assert.equal(whenHolds({ field: 'reg.kind', eq: 'X' }, lookIn({ 'reg.kind': 'X' })), true);
  assert.equal(whenHolds({ field: 'reg.kind', eq: 'X' }, lookIn({ 'reg.kind': 'Y' })), false);
  assert.equal(whenHolds({ field: 'reg.kind', eq: 'X' }, lookIn({})), false);
  assert.equal(whenHolds({ field: 'reg.kind', ne: 'X' }, lookIn({})), true, 'nothing answered is not X');
  assert.equal(whenHolds({ field: 'reg.scope', in: ['GCC', 'EU'] }, lookIn({ 'reg.scope': 'GCC' })), true);
  assert.equal(whenHolds({ field: 'reg.scope', in: ['GCC'] }, lookIn({ 'reg.scope': 'EU' })), false);
  assert.equal(whenHolds({ field: 'reg.scope', includes: 'EU' }, lookIn({ 'reg.scope': ['GCC', 'EU'] })), true);
  assert.equal(whenHolds({ field: 'reg.scope', includes: 'EU' }, lookIn({ 'reg.scope': 'EU' })), false, 'includes looks in a list only');
  assert.equal(whenHolds({ field: 'reg.regulators', truthy: true }, lookIn({ 'reg.regulators': [{ id: 'a', regulator: 'SBP' }] })), false, 'an incomplete row is not a filled list');
  assert.equal(whenHolds({ field: 'reg.regulators', truthy: true }, lookIn({ 'reg.regulators': [{ id: 'a', regulator: 'SBP', country: 'Pakistan', relationship: 'Supervised by' }] })), true);
  assert.equal(whenHolds({ field: 'reg.regulators', truthy: false }, lookIn({})), true);
});

test('a field is asked only when the field its condition points at is asked too', () => {
  const values = { 'reg.no_regulator': true, 'reg.regulators': [{ id: 'a', regulator: 'SBP', country: 'Pakistan', relationship: 'Supervised by' }] };
  const visible = makeVisible(profileFields, lookIn(values));
  assert.equal(visible('reg.regulators'), false, 'ticked none: the list is not asked');
  assert.equal(visible('reg.next'), false, 'its condition looks at a hidden list: a stale answer is ignored');
  assert.equal(visible('reg.kind'), true);
  assert.equal(visible('reg.unknown'), true, 'a reference nobody defined is not hidden');
  const open = makeVisible(profileFields, lookIn({ 'reg.regulators': values['reg.regulators'] }));
  assert.equal(open('reg.next'), true);
});

test('a condition that points at itself or round a loop cannot hang', () => {
  const loop: Record<string, never> = {
    'a.x': { key: 'x', label: 'X', type: 'bool', level: 'optional', note: '', when: { field: 'a.y', truthy: true } } as never,
    'a.y': { key: 'y', label: 'Y', type: 'bool', level: 'optional', note: '', when: { field: 'a.x', truthy: true } } as never,
  };
  const visible = makeVisible(loop, (ref) => ({ field: loop[ref], value: true }));
  assert.equal(typeof visible('a.x'), 'boolean');
});

test('two to four short answers are segments; the rest is a list', () => {
  assert.equal(choiceLayout(['Maintained', 'Partial', 'None']), 'segmented');
  assert.equal(choiceLayout(['Yes', 'No']), 'segmented');
  assert.equal(choiceLayout(['Approved and current', 'Draft', 'None']), 'select', 'one long answer');
  assert.equal(choiceLayout(['A', 'B', 'C', 'D', 'E']), 'select', 'five');
  assert.equal(choiceLayout(['Only']), 'select');
  assert.equal(choiceLayout([]), 'select');
});

test('a saved answer the catalog no longer offers is still offered, once', () => {
  assert.deepEqual(withSaved(['A', 'B'], ['B', 'Old', 'Old', '', null]), ['A', 'B', 'Old']);
});

test('ticking a group keeps the order of the options and drops what no option names', () => {
  const opts = ['On premises', 'Colocation', 'Hybrid'];
  assert.deepEqual(toggleOption(opts, ['Hybrid'], 'On premises', true), ['On premises', 'Hybrid']);
  assert.deepEqual(toggleOption(opts, ['On premises', 'Hybrid'], 'Hybrid', false), ['On premises']);
  assert.deepEqual(toggleOption(opts, undefined, 'Colocation', true), ['Colocation']);
  assert.deepEqual(toggleOption(opts, ['Gone', 'Hybrid'], 'Colocation', true), ['Colocation', 'Hybrid']);
  assert.deepEqual(toggleId([3, 1], 2, true), [3, 1, 2]);
  assert.deepEqual(toggleId([3, 1], 3, false), [1]);
  assert.deepEqual(toggleId(['a'], 'a', true), ['a'], 'ticking twice adds once');
});

test('yes and no are a pair of words; nothing chosen is nothing', () => {
  assert.deepEqual([true, false, null, undefined].map(toYesNo), ['yes', 'no', '', '']);
  assert.deepEqual(['yes', 'no', ''].map(fromYesNo), [true, false, null]);
});

test('a number box says null when empty, a number when it is one, and nothing while it is only half typed', () => {
  assert.equal(parseNumberText(''), null);
  assert.equal(parseNumberText(' 12 '), 12);
  assert.equal(parseNumberText('1.5'), 1.5);
  assert.equal(parseNumberText('0'), 0);
  assert.equal(parseNumberText('-'), undefined);
  assert.equal(parseNumberText('12abc'), undefined);
  assert.equal(parseNumberText('Infinity'), undefined);
});

test('a person is a user, someone outside with a name, or nobody', () => {
  assert.equal(personKind({ user_id: 7 }), 'user');
  assert.equal(personKind({ name: 'A. Khan', email: 'a@x.test' }), 'outside');
  for (const v of [null, undefined, {}, { name: '  ' }, 'x', { user_id: null }]) assert.equal(personKind(v), null, JSON.stringify(v));
  assert.deepEqual(draftOfPerson({ name: 'A. Khan', organisation: 'Acme' }), { name: 'A. Khan', email: '', organisation: 'Acme' });
  assert.deepEqual(draftOfPerson({ user_id: 7 }), { name: '', email: '', organisation: '' });
});

test('three boxes become a person only when they hold a name: an email alone waits, so the save is never refused for it', () => {
  assert.equal(personFromDraft({ name: '', email: '', organisation: '' }), null);
  assert.equal(personFromDraft({ name: ' ', email: '', organisation: '' }), null);
  assert.equal(personFromDraft({ name: '', email: 'a@x.test', organisation: '' }), 'incomplete');
  assert.equal(personFromDraft({ name: '', email: '', organisation: 'Acme' }), 'incomplete');
  assert.deepEqual(personFromDraft({ name: ' A. Khan ', email: '', organisation: '' }), { name: 'A. Khan' });
  assert.deepEqual(personFromDraft({ name: 'A. Khan', email: 'a@x.test', organisation: 'Acme' }), { name: 'A. Khan', email: 'a@x.test', organisation: 'Acme' });
});

test('a row of the profile is picked by its name, never its id', () => {
  assert.equal(rowTitle('sites', { id: 'r1', name: 'Karachi HQ', kind: 'Head office' }), 'Karachi HQ');
  assert.equal(rowTitle('data_types', { id: 'r2', type: 'Personal data', classification: 'Confidential' }), 'Personal data');
  assert.equal(rowTitle('entities', { id: 'r3' }), 'Unnamed row');
  assert.equal(rowAbout('sites', { id: 'r1', name: 'Karachi HQ', kind: 'Head office', city: 'Karachi', country: 'Pakistan' }), 'Head office · Karachi · Pakistan');
  assert.equal(rowAbout('third_parties', { id: 'r4', name: 'Acme', kind: 'Cloud provider' }), 'Cloud provider');
  assert.deepEqual(orgRowsOf({ entities: [{ id: 'e' }], sites: [], third_parties: [], data_types: [] }, 'entities'), [{ id: 'e' }]);
  assert.deepEqual(orgRowsOf(undefined, 'sites'), []);
  assert.deepEqual(orgRowsOf({ entities: [{ id: 'e' }], sites: [], third_parties: [], data_types: [] }, 'systems'), []);
});

test('departments are listed as a tree, a parent before its children, however the server ordered them', () => {
  const tree = departmentTree([
    { id: 3, name: 'Payments', parent_id: 2 }, { id: 2, name: 'Technology', parent_id: null }, { id: 1, name: 'Compliance', parent_id: null }, { id: 4, name: 'Cards', parent_id: 3 },
  ]);
  assert.deepEqual(tree.map((d) => [d.name, d.depth]), [['Compliance', 0], ['Technology', 0], ['Payments', 1], ['Cards', 2]]);
});

test('a department whose parent is missing, or a loop, is still listed', () => {
  assert.deepEqual(departmentTree([{ id: 5, name: 'Orphan', parent_id: 99 }]).map((d) => d.name), ['Orphan']);
  const loop = departmentTree([{ id: 1, name: 'A', parent_id: 2 }, { id: 2, name: 'B', parent_id: 1 }]);
  assert.deepEqual(loop.map((d) => d.name).sort(), ['A', 'B']);
  assert.deepEqual(departmentTree([{ id: 1, name: 'Self', parent_id: 1 }]).map((d) => d.name), ['Self']);
});

test('the words around a field: required says nothing, a weak source says so, a link is a web address', () => {
  assert.deepEqual(['required', 'advised', 'optional', undefined].map((l) => levelWord(l as never)), [null, 'advised', 'optional', null]);
  assert.deepEqual(['verified', 'secondary', 'unverified', undefined].map((c) => confidenceWord(c as never)), [null, 'Secondary source', 'Unverified', null]);
  assert.equal(askedByText('certification body, auditor'), 'Asked by certification body, auditor');
  assert.equal(askedByText('  '), '');
  assert.deepEqual(safeUrls(['https://a.test/x', 'javascript:alert(1)', 'https://a.test/x', 'http://b.test', 'ftp://c.test']), ['https://a.test/x', 'http://b.test']);
  assert.deepEqual(safeUrls(undefined), []);
});

test('a label points at a single control only where there is one', () => {
  const f = (type: string, extra: Record<string, unknown> = {}) => ({ key: 'k', label: 'K', type, level: 'required', note: '', ...extra }) as AnyField;
  for (const t of ['text', 'longtext', 'number', 'date', 'country', 'countries', 'vendor_ref']) assert.equal(hasSingleControl(f(t)), true, t);
  for (const t of ['bool', 'multichoice', 'person', 'table', 'asset_refs', 'org_pick', 'departments_derived', 'files']) assert.equal(hasSingleControl(f(t)), false, t);
  assert.equal(hasSingleControl(f('choice', { options: ['Averse', 'Minimal', 'Cautious', 'Open', 'Hungry'] })), true, 'a list');
  assert.equal(hasSingleControl(f('choice', { options: ['Maintained', 'Partial', 'None'] })), false, 'segments name themselves');
});

test('five columns or fewer line up; more are cards', () => {
  assert.equal(tableLayout(COLS), 'grid');
  assert.equal(tableLayout([...COLS, ...COLS]), 'cards');
});

test('the countries are one list of unique names, and a saved value outside it is kept at the end', () => {
  assert.ok(COUNTRIES.length >= 190);
  assert.equal(new Set(COUNTRIES).size, COUNTRIES.length);
  for (const must of ['Pakistan', 'Saudi Arabia', 'United Arab Emirates', 'Qatar', 'Sri Lanka', 'Singapore', 'United States', 'Germany']) assert.ok(COUNTRIES.includes(must), must);
  assert.deepEqual(countryChoices(['Pakistan', 'Atlantis', 'Atlantis']).slice(-2), [COUNTRIES[COUNTRIES.length - 1], 'Atlantis']);
  assert.equal(countryChoices().length, COUNTRIES.length);
});

test('documents on an answer: a list of an id and a name each; anything else is left out; one counts as a value', () => {
  const docs = { key: 'soa_file', label: 'SoA document', type: 'files', level: 'advised', note: '' } as AnyField;
  assert.deepEqual(filesOf([{ id: 7, name: 'soa.pdf' }, { id: 'x', name: 'bad' }, null, { id: 8 }, 'soa.pdf']), [{ id: 7, name: 'soa.pdf' }]);
  assert.deepEqual(filesOf(undefined), []);
  assert.deepEqual([undefined, [], [{ id: 7, name: 'soa.pdf' }]].map((v) => hasValue(docs, v)), [false, false, true]);
  assert.deepEqual([undefined, [], [{ id: 7, name: 'soa.pdf' }]].map((v) => answered(docs, v)), [false, false, true]);
});
