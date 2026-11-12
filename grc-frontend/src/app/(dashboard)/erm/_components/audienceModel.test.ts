import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIENCE_VIEWS, NOT_TRACKED, barWidths, changeLabel, drillHref, formatRowValue, initialView, readStoredView, storeView,
  toMatrix, toSections,
} from './audienceModel.ts';

const memory = () => {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
};

test('five audiences, in the order of the template', () => {
  assert.deepEqual(AUDIENCE_VIEWS.map((v) => v.value), ['board', 'team', 'owner', 'audit', 'third_party']);
});

test('the risk team opens on its view, everyone else on their own items, and a last choice wins', () => {
  assert.equal(initialView(null, true), 'team');
  assert.equal(initialView(null, false), 'owner');
  assert.equal(initialView('audit', false), 'audit');
  assert.equal(initialView('everything', true), 'team', 'an unknown stored value is ignored');
});

test('the choice is remembered per person, and blocked storage is not an error', () => {
  const storage = memory();
  storeView(storage, 7, 'board');
  assert.equal(readStoredView(storage, 7), 'board');
  assert.equal(readStoredView(storage, 8), null, 'another person keeps their own default');
  const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.equal(readStoredView(blocked, 7), null);
  assert.doesNotThrow(() => storeView(blocked, 7, 'team'));
  assert.equal(readStoredView(undefined, 7), null);
});

test('a measure without data reads "Not tracked yet"; others read as count, percent, score or money per currency', () => {
  assert.equal(formatRowValue({ value: null, visual: 'bars' }), NOT_TRACKED);
  assert.equal(formatRowValue({ value: 0, visual: 'count' }), '0');
  assert.equal(formatRowValue({ value: 1234, visual: 'count_list' }), (1234).toLocaleString());
  assert.equal(formatRowValue({ value: 42.5, visual: 'figure', denominator: 8 }), '42.5%');
  assert.equal(formatRowValue({ value: 71.6, visual: 'score_card' }), '72 / 100');
  assert.equal(formatRowValue({ value: [], visual: 'paired_bars' }), 'No losses booked');
  const losses = [{ currency: 'EUR', this_quarter: 500, last_quarter: 0 }, { currency: 'USD', this_quarter: 800, last_quarter: 300 }];
  assert.equal(formatRowValue({ value: losses, visual: 'paired_bars' }), 'EUR 500 · USD 800', 'never one total across currencies');
});

test('in-page drill-downs have no link out', () => {
  assert.equal(drillHref({ link: '/erm/appetite' }), '/erm/appetite');
  assert.equal(drillHref({ link: '/erm#programme' }), null);
});

test('direction since the last approved review', () => {
  assert.equal(changeLabel(8), '+8');
  assert.equal(changeLabel(-2.26), '-2.3');
  assert.equal(changeLabel(0), 'No change');
  assert.equal(changeLabel(null), '—');
});

test('bars scale to the largest value', () => {
  assert.deepEqual(barWidths([2, 4, 1]), [50, 100, 25]);
  assert.deepEqual(barWidths([0, 0]), [0, 0]);
});

test('heatmap cells land on likelihood rows (5 at the top) and impact columns', () => {
  const m = toMatrix([{ likelihood: 5, impact: 1, count: 3 }, { likelihood: 1, impact: 5, count: 2 }, { likelihood: 9, impact: 1, count: 9 }]);
  assert.equal(m[0][0], 3);
  assert.equal(m[4][4], 2);
  assert.equal(m.flat().reduce((a, b) => a + b, 0), 5, 'off-scale cells are dropped');
});

test('section scores keep the Overview order and show counts', () => {
  const metric = { key: 'm', label: 'M', weight: 1, score: 50, numerator: 1, denominator: 2, formula: 'f' };
  const sections = toSections({
    sections: {
      kris: { key: 'kris', label: 'KRIs', weight: 0.1, score: null, metrics: [{ ...metric, denominator: 0 }] },
      register: { key: 'register', label: 'Register', weight: 0.2, score: 50, metrics: [metric] },
    },
    attention_queue: {}, performance: { score: null, grade: null },
  });
  assert.deepEqual(sections.map((s) => s.key), ['register', 'kris']);
  assert.equal(sections[0].metrics[0].count, '1/2');
  assert.equal(sections[1].metrics[0].count, '—');
  assert.deepEqual(toSections(undefined), []);
});
