// node --test "src/lib/rcsa/registerModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  csvRow, evidenceText, evidenceValue, exportFileName, fieldGroups, hasEdits, inputKind, isForbidden, keyColumns, levelOptions, levelSort, levelValue, levelWord, linkedValue, mergedData,
  ownerOptions, ownerValue, referenceOf, retryUnlessRefused, safeFileName, scoreText, searchTextOf, sizeText, storedValue, titleOf, type ColumnSchema, type RegisterRow,
} from './registerModel.ts';

const col = (key: string, extra = {}) => ({ key, label: key.replace(/_/g, ' '), data_type: 'text', ...extra });
const schema: ColumnSchema = {
  groups: [
    { key: 'a', label: 'Risk', columns: [col('risk_id'), col('process'), col('risk_description')] },
    { key: 'b', label: 'Inherent', columns: [col('inherent_overall_risk', { data_type: 'score' }), col('likelihood', { data_type: 'number' })] },
  ],
  flat_columns: [col('risk_id'), col('process'), col('risk_description'), col('inherent_overall_risk', { data_type: 'score' }), col('likelihood', { data_type: 'number' })],
};
const row = (extra: Partial<RegisterRow> = {}): RegisterRow => ({ id: 1, data: { risk_id: 'R-12', process: 'Payments', risk_description: 'Wire fraud' }, ...extra });

test('the title is the risk description, else the process, else the risk id, else the first column; the others become their own columns', () => {
  const k = keyColumns(schema);
  assert.deepEqual([k.title?.key, k.reference?.key, k.process?.key], ['risk_description', 'risk_id', 'process']);
  assert.equal(titleOf(row(), k), 'Wire fraud');
  assert.equal(referenceOf(row(), k), 'R-12');
  const noDescription = keyColumns({ flat_columns: [col('risk_id'), col('process')] });
  assert.deepEqual([noDescription.title?.key, noDescription.reference?.key, noDescription.process], ['process', 'risk_id', null]);
  const plain = keyColumns({ flat_columns: [col('control'), col('owner_team'), col('frequency')] });
  assert.deepEqual([plain.title?.key, plain.reference?.key, plain.process?.key], ['control', 'owner_team', 'frequency'], 'with no hint the first columns are used');
  assert.deepEqual(keyColumns(null), { title: null, reference: null, process: null });
});

test('an item with no title is named in words, never by its number', () => {
  const k = keyColumns(schema);
  assert.equal(titleOf({ id: 99, data: {} }, k), 'Untitled item');
  assert.equal(titleOf({ id: 99, data: {}, risk_id_text: 'R-7' }, k), 'R-7');
});

test('the drawer groups the columns as the sheet did; a schema with no groups is one group; a column in no group joins the last', () => {
  assert.deepEqual(fieldGroups(schema).map((g) => [g.label, g.columns.length]), [['Risk', 3], ['Inherent', 2]]);
  assert.deepEqual(fieldGroups({ flat_columns: [col('a'), col('b')] }).map((g) => [g.label, g.columns.length]), [['Details', 2]]);
  const stray = fieldGroups({ groups: schema.groups, flat_columns: (schema.flat_columns ?? []).concat([col('extra')]) });
  assert.deepEqual(stray[1].columns.map((c) => c.key), ['inherent_overall_risk', 'likelihood', 'extra']);
  assert.deepEqual(fieldGroups(undefined), []);
});

test('the control of a field follows its data type, then whether its label or sample says it holds sentences', () => {
  assert.equal(inputKind({ data_type: 'yes_no', label: 'Is it automated' }), 'yes_no');
  assert.equal(inputKind({ data_type: 'score', label: 'Score' }), 'number');
  assert.equal(inputKind({ data_type: 'number', label: 'Likelihood' }), 'number');
  assert.equal(inputKind({ data_type: 'date', label: 'Next review' }), 'date');
  assert.equal(inputKind({ data_type: 'text', label: 'Risk description' }), 'long');
  assert.equal(inputKind({ data_type: 'text', label: 'Mitigation actions' }), 'long');
  assert.equal(inputKind({ data_type: 'text', label: 'Process' }), 'text');
  assert.equal(inputKind({ data_type: 'text', label: 'Control', sample_values: ['x'.repeat(120)] }), 'long');
});

test('saving: only edited fields change, a number field stores a number, an untouched field keeps its stored type', () => {
  const original = { risk_id: 'R-12', likelihood: 3, note: 'old' };
  const columns = [col('risk_id'), col('likelihood', { data_type: 'number' }), col('note')];
  assert.deepEqual(mergedData(original, { risk_id: 'R-12', likelihood: '3', note: 'new' }, columns), { risk_id: 'R-12', likelihood: 3, note: 'new' });
  assert.deepEqual(mergedData(original, { likelihood: '4.5' }, columns), { risk_id: 'R-12', likelihood: 4.5, note: 'old' });
  assert.deepEqual(mergedData(original, { likelihood: 'n/a' }, columns).likelihood, 'n/a');
  assert.deepEqual(mergedData(original, { likelihood: '' }, columns).likelihood, '');
  assert.equal(hasEdits(original, { likelihood: '3', note: 'old' }), false, 'typing the stored value back is no change');
  assert.equal(hasEdits(original, { note: 'x' }), true);
  assert.equal(storedValue('yes_no', 'Yes'), 'Yes');
});

test('levels: the sheet\'s label becomes a registry word, sorts by its score and then by its rank, and items with neither sort last', () => {
  assert.equal(levelWord('Very High'), 'very_high');
  assert.equal(levelValue(null), 'none');
  assert.equal(levelSort('Low', 20), 20, 'the score the sheet gave wins');
  assert.equal(levelSort('High', null), 4);
  assert.equal(levelSort('Very High', undefined), 5);
  assert.equal(levelSort('Mystery', null), null);
  assert.equal(levelSort(null, null), null);
  assert.equal(scoreText(12), 'Score 12');
  assert.equal(scoreText(null), '');
});

test('facets: owners with Unassigned first, levels most serious first with unknown words and Not rated at the end, evidence and the register as yes/no', () => {
  const rows = [row({ id: 1, assigned_user_id: 5, assigned_user_name: 'Zed', evidence_count: 2, linked_risk_id: 9, residual_overall_label: 'High' }), row({ id: 2, assigned_user_id: 3, assigned_user_name: 'Amy', residual_overall_label: 'Low' }), row({ id: 3, residual_overall_label: 'Bespoke' }), row({ id: 4 })];
  assert.deepEqual(ownerOptions(rows).map((o) => o.label), ['Unassigned', 'Amy', 'Zed']);
  assert.deepEqual(rows.map(ownerValue), ['5', '3', 'none', 'none']);
  assert.deepEqual(rows.map(evidenceValue), ['with', 'without', 'without', 'without']);
  assert.deepEqual(rows.map(linkedValue), ['yes', 'no', 'no', 'no']);
  const options = levelOptions(rows, (r) => r.residual_overall_label, (w) => w.toUpperCase());
  assert.deepEqual(options.map((o) => o.value), ['high', 'low', 'bespoke', 'none']);
  assert.equal(options[3].label, 'Not rated');
});

test('the search looks in every value of the item, its owner and its levels', () => {
  const text = searchTextOf(row({ assigned_user_name: 'Amy Khan', residual_overall_label: 'High' }));
  assert.match(text, /Wire fraud/);
  assert.match(text, /Amy Khan/);
  assert.match(text, /High/);
});

test('the export row names the item, never a number, and says Unassigned', () => {
  const k = keyColumns(schema);
  assert.deepEqual(csvRow(row({ inherent_overall_label: 'High', inherent_overall_score: 15, evidence_count: 2, linked_risk_id: 4 }), k), ['R-12', 'Wire fraud', 'High', 15, '', '', 'Unassigned', 2, 'Yes']);
});

test('file names: the export keeps the workbook\'s name for .xlsx and .xlsm, a saved name has no folder', () => {
  assert.equal(exportFileName('Treasury RCSA.xlsx'), 'Treasury RCSA_export.xlsx');
  assert.equal(exportFileName('Treasury RCSA.XLSM'), 'Treasury RCSA_export.xlsx');
  assert.equal(exportFileName(''), 'register_export.xlsx');
  assert.equal(safeFileName('C:\\fake\\path/evidence: 1?.pdf', 'file'), 'evidence 1.pdf');
  assert.equal(safeFileName('', 'file'), 'file');
});

test('words: forbidden is a 403, evidence and sizes read as a person would say them', () => {
  assert.equal(isForbidden({ response: { status: 403 } }), true);
  assert.equal(isForbidden({ response: { status: 500 } }), false);
  assert.equal(isForbidden(null), false);
  assert.deepEqual([evidenceText(0), evidenceText(1), evidenceText(4)], ['None', '1 file', '4 files']);
  assert.deepEqual([sizeText(500), sizeText(2048), sizeText(1.5 * 1024 * 1024), sizeText(null)], ['500 B', '2 KB', '1.5 MB', '']);
});

test('a refused request is shown at once, a failing one is tried twice more', () => {
  assert.equal(retryUnlessRefused(0, { response: { status: 403 } }), false);
  assert.equal(retryUnlessRefused(0, { response: { status: 404 } }), false);
  assert.equal(retryUnlessRefused(0, { response: { status: 500 } }), true);
  assert.equal(retryUnlessRefused(1, new Error('network')), true);
  assert.equal(retryUnlessRefused(2, new Error('network')), false);
});
