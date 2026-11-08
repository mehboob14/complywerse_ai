// node --test "src/app/(dashboard)/vendor-risk/_lib/vendorRules.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SHIPPED_BANDS, bandsFrom, isBeforeToday, residualBand, utcDay } from './vendorRules.ts';
import { SEV_HEX, scoreColor } from './tprmShared.ts';

test('the shipped bands are the ones the server ships: critical from 75, high from 50, medium from 25', () => {
  assert.deepEqual(SHIPPED_BANDS, { critical: 75, high: 50, medium: 25 });
  assert.deepEqual(bandsFrom(undefined), SHIPPED_BANDS);
  assert.deepEqual(bandsFrom({ thresholds: { critical: 80, high: 55, medium: 30 } }), { critical: 80, high: 55, medium: 30 });
});

test('a policy whose bands do not fall, or are not numbers, is the shipped bands: a colour is never decided by a broken setting', () => {
  for (const bad of [{ critical: 50, high: 50, medium: 25 }, { critical: 40, high: 50, medium: 25 }, { critical: 75, high: 50, medium: 0 }, { critical: 101, high: 50, medium: 25 },
    { critical: '75', high: 50, medium: 25 }, { critical: 75, high: 50 }, { critical: NaN, high: 50, medium: 25 }]) {
    assert.deepEqual(bandsFrom({ thresholds: bad as never }), SHIPPED_BANDS, JSON.stringify(bad));
  }
});

test('a residual score is in the band of the tenant: the edges belong to the higher band, and nothing recorded is "none"', () => {
  const at = (n: number | null | undefined) => residualBand(n);
  assert.deepEqual([100, 75, 74.9, 50, 49.9, 25, 24.9, 0].map(at), ['critical', 'critical', 'high', 'high', 'medium', 'medium', 'low', 'low']);
  assert.deepEqual([null, undefined, NaN].map(at), ['none', 'none', 'none']);
  assert.equal(residualBand(72, { critical: 80, high: 55, medium: 30 }), 'high');
  assert.equal(residualBand(72, SHIPPED_BANDS), 'high');
});

test('the colour of a score follows the same bands (70-74 was red, 48-49 orange and 25 green on the older 70 / 48 / 26)', () => {
  assert.equal(scoreColor(74), SEV_HEX.high);
  assert.equal(scoreColor(75), SEV_HEX.critical);
  assert.equal(scoreColor(49), SEV_HEX.medium);
  assert.equal(scoreColor(25), SEV_HEX.medium);
  assert.equal(scoreColor(24), SEV_HEX.low);
  assert.equal(scoreColor(null), '#94a3b8');
});

test('a date is overdue when its calendar day, in UTC, is before today; a moment counts by its day; nothing recorded is not overdue', () => {
  const now = new Date('2026-11-08T00:30:00Z');
  assert.equal(utcDay(now), '2026-11-08');
  assert.equal(isBeforeToday('2026-11-07', now), true);
  assert.equal(isBeforeToday('2026-11-08', now), false);
  assert.equal(isBeforeToday('2026-11-09', now), false);
  assert.equal(isBeforeToday('2026-11-07T23:59:59', now), true);
  assert.equal(isBeforeToday('2026-11-08T00:00:00', now), false);
  for (const none of [null, undefined, '', 'soon', '07/11/2026']) assert.equal(isBeforeToday(none as never, now), false, String(none));
});
