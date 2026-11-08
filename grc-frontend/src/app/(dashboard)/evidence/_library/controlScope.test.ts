// node --test "src/app/(dashboard)/evidence/_library/controlScope.test.ts"
// "Evidence for this control": the links other pages send read as one control of one kind, and the Library narrows to that control's files without changing anything else.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress, writeAddress } from '../../../../lib/addressState.ts';
import { LIBRARY_SCHEMA, pageOf, type LibraryAddress } from './libraryAddress.ts';
import { NO_SCOPE, idsOf, scopeOf, scopeWords, withControlScope, type ControlAnswer } from './controlScope.ts';
import { evaluate, indexRows } from '../../../../components/records/facetEngine.ts';

const read = (search: string) => readAddress(LIBRARY_SCHEMA, search) as unknown as LibraryAddress;

test('the links the other pages send read as the control they mean: control = a framework control, control_id = a control of an uploaded framework, kind says otherwise', () => {
  assert.deepEqual(scopeOf({ control: '41' }), { ref: '41', kind: 'framework' });
  assert.deepEqual(scopeOf({ control_id: '77' }), { ref: '77', kind: 'parsed' });
  assert.deepEqual(scopeOf({ control: 'IAC-01', kind: 'common' }), { ref: 'IAC-01', kind: 'common' });
  assert.deepEqual(scopeOf({ control: '41', kind: 'parsed' }), { ref: '41', kind: 'parsed' });
  assert.deepEqual(scopeOf({ control: ' 41 ', kind: 'JUNK' }), { ref: '41', kind: 'framework' }, 'a kind nobody knows is the default for the name used');
  assert.deepEqual(scopeOf({ control: '9', control_id: '77' }), { ref: '9', kind: 'framework' }, 'control wins over its alias');
  assert.equal(scopeOf({}), null);
  assert.equal(scopeOf({ control: '  ', control_id: '' }), null);
});

test('the address carries the scope: the three names are read, the old ?type= of the gaps page is ignored, and the plain address has none', () => {
  const page = pageOf(read('?control=41&type=policy'));
  assert.deepEqual(page.control, { ref: '41', kind: 'framework' });
  assert.deepEqual(page.filters.type, [], 'the missing evidence type the gaps page names is not a filter');
  assert.deepEqual(pageOf(read('?control_id=77&status=approved')).control, { ref: '77', kind: 'parsed' });
  assert.deepEqual(pageOf(read('?control=IAC-01&kind=common')).control, { ref: 'IAC-01', kind: 'common' });
  assert.equal(pageOf(read('')).control, null, 'no control in the address: the Library is as it always was');
});

test('"Show all evidence" takes the scope off and leaves every other name alone', () => {
  const state = read('?control=41&kind=parsed&status=approved&open=7&view=board');
  const next = writeAddress(LIBRARY_SCHEMA, '?control=41&kind=parsed&status=approved&open=7&view=board', { ...state, ...NO_SCOPE } as never);
  assert.deepEqual(Array.from(new URLSearchParams(next).keys()).sort(), ['open', 'status', 'view']);
});

const row = (id: number, status = 'approved') => ({ id, status, name: `File ${id}` });
const rows = [row(1), row(2), row(3, 'draft'), row(4)];
const index = indexRows(rows, [{ key: 'status', values: (r) => [r.status] }], (r) => r.name.toLowerCase());

test('the scope narrows the complete load to the control\'s files, together with the facets, the search and a quick view, and never adds a file', () => {
  const rule = withControlScope({ terms: [] }, new Set([1, 3, 99]));
  assert.deepEqual(evaluate(index, {}, rule).matches.map((r) => r.id), [1, 3], 'file 99 is not in the load, so it is not shown');
  assert.deepEqual(evaluate(index, { status: ['approved'] }, rule).matches.map((r) => r.id), [1]);
  assert.deepEqual(evaluate(index, {}, withControlScope({ terms: ['file 3'] }, new Set([1, 3]))).matches.map((r) => r.id), [3]);
  assert.deepEqual(evaluate(index, {}, withControlScope({ extra: (r) => r.status === 'draft' }, new Set([1, 3]))).matches.map((r) => r.id), [3], 'a quick view still applies');
  const none = evaluate(index, {}, withControlScope({}, new Set<number>()));
  assert.deepEqual(none.matches, [], 'a control with no files shows none');
  const plain = { terms: [] };
  assert.equal(withControlScope(plain, null), plain, 'no scope: the very same rule');
  assert.deepEqual(evaluate(index, {}, withControlScope(plain, null)).matches.map((r) => r.id), [1, 2, 3, 4]);
});

test('the files are those of a control that exists; a control that does not exist narrows nothing and says so', () => {
  const found: ControlAnswer = { control: { kind: 'framework', id: 41, code: 'A.5.3', title: 'Segregation of duties', framework: 'ISO 27001' }, evidence_ids: [1, 3] };
  assert.deepEqual(Array.from(idsOf(found) ?? []), [1, 3]);
  assert.equal(idsOf({ control: null, evidence_ids: [] }), null);
  assert.equal(idsOf(undefined), null);
  assert.deepEqual(scopeWords(found), { title: 'Evidence linked to A.5.3 · Segregation of duties in ISO 27001', message: '2 files are linked to it.', found: true });
  assert.equal(scopeWords({ ...found, evidence_ids: [5] }).message, '1 file is linked to it.');
  assert.equal(scopeWords({ ...found, evidence_ids: [] }).message, 'No file is linked to this control yet.');
  const loaded = [{ id: 1, status: 'approved' }, { id: 3, status: 'archived' }, { id: 7, status: 'draft' }];
  assert.equal(scopeWords(found, loaded).message, '1 file is linked to it, and 1 archived (choose Archived under Status to see it).', 'the sentence counts what the list shows and says what it keeps out');
  assert.equal(scopeWords({ ...found, evidence_ids: [3] }, loaded).message, 'The only file linked to it is archived (choose Archived under Status to see it).');
  assert.equal(scopeWords({ ...found, evidence_ids: [9] }, loaded).message, 'No file is linked to this control yet.');
  const gone = scopeWords({ control: null, evidence_ids: [] });
  assert.deepEqual([gone.found, gone.title], [false, 'That control was not found']);
  assert.equal(scopeWords({ control: { kind: 'common', id: 5, code: 'IAC-01', title: null, framework: null }, evidence_ids: [] }).title, 'Evidence linked to IAC-01');
});
