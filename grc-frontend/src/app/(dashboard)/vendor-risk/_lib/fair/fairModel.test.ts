// node --test "src/app/(dashboard)/vendor-risk/_lib/fair/fairModel.test.ts"
// The Comply analysis form's rules: the numbers go to text and back unchanged (a share in percent), what is wrong with a range is said in words per row, the save carries the version it was read at, and
// a missing figure is "—", never 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GROUPS, fromText, get, isDirty, metaOf, money, oneIn, pct, problems, saveBody, toText, type FairAnalysis, type FairInputs,
} from './fairModel.ts';

const INPUTS: FairInputs = {
  tef: [0.5, 2, 6], vulnerability: [0.1, 0.35, 0.6],
  primary: { response: [1000, 5000, 20000], productivity: [0, 2000, 9000], replacement: [500, 800, 1200] },
  secondary: { probability: [0.2, 0.4, 0.7], fines: [0, 10000, 90000], reputation: [0, 3000, 40000], competitive: [0, 0, 0] },
  iterations: 5000,
};
const analysis = (over: Partial<FairAnalysis> = {}): FairAnalysis => ({
  id: 9, vendor: { id: 3, name: 'Payroll Co', tier: 'critical' }, name: 'Payroll: data breach', effect: 'confidentiality', scenario: null, asset: 'Payroll records', threat: null,
  status: 'draft', currency: 'USD', annual: null, liability_cap: null, updated_at: '2026-11-01T10:00:00', run_at: null, row_version: 4, insurance_cover: 250000, inputs: INPUTS, ...over,
});

test('the numbers go to the form and back unchanged; a share is shown in percent and sent as a share', () => {
  const text = toText(INPUTS);
  assert.deepEqual(text.vulnerability, ['10', '35', '60']);
  assert.deepEqual(text['primary.response'], ['1000', '5000', '20000']);
  assert.deepEqual(text['secondary.probability'], ['20', '40', '70']);
  assert.deepEqual(fromText(text, 5000), INPUTS);
  assert.equal(Object.keys(text).length, GROUPS.flatMap((g) => g.rows).length);
  assert.deepEqual(get(INPUTS, 'secondary.fines'), [0, 10000, 90000]);
});

test('a cell that is not a number is 0, as the form has always sent it, and a blank share is 0%', () => {
  const text = toText(INPUTS);
  text.tef = ['', 'x', '3'];
  assert.deepEqual(fromText(text, 5000).tef, [0, 0, 3]);
});

test('the form is dirty only when a number or the details differ from the saved analysis', () => {
  const a = analysis();
  assert.equal(isDirty(a, toText(INPUTS), metaOf(a)), false);
  const text = toText(INPUTS);
  text.tef = ['1', '2', '6'];
  assert.equal(isDirty(a, text, metaOf(a)), true);
  assert.equal(isDirty(a, toText(INPUTS), { ...metaOf(a), threat: 'Organised criminals' }), true);
  assert.equal(isDirty(a, toText(INPUTS), { ...metaOf(a), cover: '' }), true, 'taking the cover away is a change');
  assert.equal(isDirty(analysis({ inputs: undefined }), toText(INPUTS), metaOf(a)), false, 'an analysis not loaded has nothing to compare with');
});

test('what is wrong is said per row in words: order, negative, over 100%, not a number, no name', () => {
  const a = analysis();
  const text = toText(INPUTS);
  assert.deepEqual(problems(text, metaOf(a)), []);
  text.tef = ['5', '2', '6'];
  text.vulnerability = ['10', '35', '160'];
  text['primary.response'] = ['-1', '5', '9'];
  text['primary.productivity'] = ['a', '2', '3'];
  const found = problems(text, { name: ' ', cover: '-5' });
  assert.deepEqual(found.map((p) => p.path), ['tef', 'vulnerability', 'primary.response', 'primary.productivity', 'name', 'cover']);
  assert.equal(found[0].message, 'Threat events a year: least, most likely and most must go up in that order');
  assert.equal(found[1].message, 'Chance an attempt becomes a loss: a share is at most 100%');
  assert.equal(found[2].message, 'Response: a figure cannot be negative');
  assert.equal(found[3].message, 'Productivity: use numbers only');
});

test('a save carries the form, the supplier-facing details, the cover (empty is none) and the version the form was read at', () => {
  const a = analysis();
  const meta = { ...metaOf(a), name: 'Payroll: breach', cover: '' };
  const body = saveBody(a, toText(INPUTS), meta, { status: 'final' });
  assert.equal(body.row_version, 4);
  assert.equal(body.insurance_cover, null);
  assert.equal(body.status, 'final');
  assert.equal(body.name, 'Payroll: breach');
  assert.deepEqual(body.inputs, INPUTS);
  assert.equal(saveBody(a, toText(INPUTS), { ...meta, cover: '1500.5' }).insurance_cover, 1500.5);
});

test('money, shares and "one in" read as words, and a missing figure is a dash, never 0', () => {
  assert.equal(money(null), '—');
  assert.equal(money(undefined, 'EUR'), '—');
  assert.match(money(1200000, 'USD'), /1\.2M/);
  assert.match(money(1234567, 'USD', false), /1,234,567/);
  assert.equal(pct(0.4237), '42%');
  assert.equal(pct(0.4237, 1), '42.4%');
  assert.equal(pct(null), '—');
  assert.equal(oneIn(0), 'never in the simulated years');
  assert.equal(oneIn(0.07), 'about 1 year in 14');
  assert.equal(oneIn(2), 'about 1 year in 1');
});
