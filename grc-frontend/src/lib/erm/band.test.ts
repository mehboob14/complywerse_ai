// node --test "src/lib/erm/band.test.ts"
// The one score-band system (20 / 12 / 6) and the one category list. The bands are held to the server's own `risk_priority_for_score` (models/_11), read from its source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { BANDS, BAND_FROM, BAND_LABEL, bandCounts, scoreBand } from './band.ts';
import { RISK_CATEGORIES, categoryLabel, categoryOptions } from './categories.ts';

test('the cut is 20 / 12 / 6, at the edges', () => {
  const at: Array<[number, string | null]> = [[25, 'critical'], [20, 'critical'], [19.9, 'high'], [12, 'high'], [11.9, 'medium'], [6, 'medium'], [5.9, 'low'], [1, 'low'], [0, null]];
  at.forEach(([score, band]) => assert.equal(scoreBand(score), band, String(score)));
  assert.equal(scoreBand(null), null);
  assert.equal(scoreBand(undefined), null);
  assert.equal(scoreBand(NaN), null);
});

test('every score of the 5 x 5 scale has a band, none is skipped, and the order is worst first', () => {
  for (let l = 1; l <= 5; l++) for (let i = 1; i <= 5; i++) assert.ok(BANDS.includes(scoreBand(l * i) as never), `${l}x${i}`);
  assert.deepEqual(Array.from(BANDS), ['critical', 'high', 'medium', 'low']);
  assert.deepEqual(BANDS.map((b) => BAND_LABEL[b]), ['Critical', 'High', 'Medium', 'Low']);
});

test('the bands are the server\'s: risk_priority_for_score in models/_11 says the same numbers', () => {
  const source = readFileSync(fileURLToPath(new URL('../../../../backend/grc/models/_11_enterprise_risk_management.py', import.meta.url)), 'utf8');
  const fn = /def risk_priority_for_score[\s\S]*?return ("critical" if score >= (\d+) else "high" if score >= (\d+) else "medium" if score >= (\d+) else "low")/.exec(source);
  assert.ok(fn, 'the server function is still there');
  assert.deepEqual([Number(fn![2]), Number(fn![3]), Number(fn![4])], [BAND_FROM.critical, BAND_FROM.high, BAND_FROM.medium]);
});

test('counts by band keep the unscored apart', () => {
  assert.deepEqual(bandCounts([25, 12, 6, 1, 0, null, undefined]), { critical: 1, high: 1, medium: 1, low: 1, unscored: 3 });
});

test('one category list: the seven the server writes, each said in words, any other kept', () => {
  const server = readFileSync(fileURLToPath(new URL('../../../../backend/grc/modules/erm/routers/appetite.py', import.meta.url)), 'utf8');
  const listed = /RISK_CATEGORIES = \[([\s\S]*?)\]/.exec(server)![1].match(/"([a-z_]+)"/g)!.map((s) => s.replace(/"/g, ''));
  assert.deepEqual(listed.slice().sort(), Array.from(RISK_CATEGORIES).sort(), 'appetite.py and categories.ts name the same categories');
  RISK_CATEGORIES.forEach((c) => assert.notEqual(categoryLabel(c), c, c));
  assert.equal(categoryLabel('third_party'), 'Third party');
  assert.equal(categoryLabel('project_change'), 'Project and change');
  assert.equal(categoryLabel('reputational'), 'Reputational');
  assert.equal(categoryLabel(null), 'Uncategorised');
  const opts = categoryOptions(['reputational', 'financial', null, 'reputational']);
  assert.equal(opts.length, 8);
  assert.equal(opts[opts.length - 1].value, 'reputational');
});
