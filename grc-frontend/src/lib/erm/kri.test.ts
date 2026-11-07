// node --test "src/lib/erm/kri.test.ts"
// "A KRI is breaching": the Overview's rule (dashboard.py kri_is_red / kri_band_health), direction-aware, one function. Parity with the server's own RAG
// (kris.py calculate_kri_status) is checked on every KRI that has both thresholds - the only case where the two are meant to agree.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { higherIsBetter, isBreach, isWatch, kriCounts, kriGap, kriState, ragWord, thresholdBar, thresholdWords, type KriLike } from './kri.ts';

const k = (over: Partial<KriLike>): KriLike => ({ current_value: 0, green_threshold: 5, amber_threshold: 10, threshold_direction: 'lower_is_better', ...over });

/** the server's calculate_kri_status, written out (kris.py:147-164) */
function server(x: KriLike): string {
  if (x.green_threshold == null || x.amber_threshold == null) return 'unknown';
  const v = x.current_value as number;
  if (x.threshold_direction === 'lower_is_better') return v <= x.green_threshold ? 'green' : v <= x.amber_threshold ? 'amber' : 'red';
  return v >= x.green_threshold ? 'green' : v >= x.amber_threshold ? 'amber' : 'red';
}

test('lower is better: at or under green is green, up to amber is amber, past amber is red (the edges belong to the better side)', () => {
  assert.equal(kriState(k({ current_value: 5 })), 'green');
  assert.equal(kriState(k({ current_value: 5.1 })), 'amber');
  assert.equal(kriState(k({ current_value: 10 })), 'amber');
  assert.equal(kriState(k({ current_value: 10.1 })), 'red');
});

test('higher is better reads the other way, and the form default 80 / 50 works', () => {
  const up = { threshold_direction: 'higher_is_better', green_threshold: 80, amber_threshold: 50 };
  assert.equal(kriState(k({ ...up, current_value: 80 })), 'green');
  assert.equal(kriState(k({ ...up, current_value: 79 })), 'amber');
  assert.equal(kriState(k({ ...up, current_value: 50 })), 'amber');
  assert.equal(kriState(k({ ...up, current_value: 49 })), 'red');
  assert.equal(higherIsBetter(k(up)), true);
  assert.equal(higherIsBetter(k({})), false);
});

test('a 0 value and a 0 threshold are values (a stored 0 is not "missing")', () => {
  assert.equal(kriState(k({ current_value: 0, green_threshold: 0, amber_threshold: 3 })), 'green');
  assert.equal(kriState(k({ current_value: 1, green_threshold: 0, amber_threshold: 3 })), 'amber');
  assert.equal(kriState(k({ current_value: 4, green_threshold: 0, amber_threshold: 3 })), 'red');
});

test('nothing measured is "no value" (never red), no amber threshold is "not rated", and only red is a breach', () => {
  assert.equal(kriState(k({ current_value: null })), 'no_value');
  assert.equal(kriState(k({ current_value: undefined })), 'no_value');
  assert.equal(kriState(k({ amber_threshold: null })), 'unrated');
  assert.equal(isBreach(k({ current_value: 11 })), true);
  assert.equal(isBreach(k({ current_value: 7 })), false);
  assert.equal(isWatch(k({ current_value: 7 })), true);
  assert.equal(isBreach(k({ current_value: null })), false);
  assert.equal(ragWord('no_value'), 'unknown');
  assert.equal(ragWord('red'), 'red');
});

test('with an amber threshold and no green one, a value inside amber is watch (the Overview scores it 50)', () => {
  assert.equal(kriState(k({ green_threshold: null, current_value: 2 })), 'amber');
  assert.equal(kriState(k({ green_threshold: null, current_value: 11 })), 'red');
});

test('wherever both thresholds are set, it says what the server says', () => {
  for (const direction of ['lower_is_better', 'higher_is_better']) {
    for (let v = -2; v <= 120; v += 1) {
      const x = k(direction === 'lower_is_better' ? { threshold_direction: direction, current_value: v } : { threshold_direction: direction, green_threshold: 80, amber_threshold: 50, current_value: v });
      const mine = kriState(x);
      assert.equal(mine, server(x), `${direction} ${v}`);
    }
  }
});

test('counts add up to the total', () => {
  const rows = [k({ current_value: 1 }), k({ current_value: 7 }), k({ current_value: 20 }), k({ current_value: null }), k({ amber_threshold: null })];
  assert.deepEqual(kriCounts(rows), { red: 1, amber: 1, green: 1, unrated: 1, no_value: 1, total: 5 });
});

test('the threshold bar puts green first when lower is better and red first when higher is better', () => {
  const low = thresholdBar(k({ current_value: 7 }))!;
  assert.deepEqual(low.zones.map((z) => z.state), ['green', 'amber', 'red']);
  const high = thresholdBar(k({ threshold_direction: 'higher_is_better', green_threshold: 80, amber_threshold: 50, current_value: 60 }))!;
  assert.deepEqual(high.zones.map((z) => z.state), ['red', 'amber', 'green']);
  assert.ok(high.marker! > 0 && high.marker! < 100);
  for (const bar of [low, high]) {
    assert.equal(bar.zones[0].from, 0);
    assert.equal(bar.zones[bar.zones.length - 1].to, 100);
    bar.zones.forEach((z, i) => { if (i) assert.equal(z.from, bar.zones[i - 1].to); });
  }
  assert.equal(thresholdBar(k({ green_threshold: null })), null);
  assert.equal(thresholdBar(k({ current_value: null }))!.marker, null);
});

test('the thresholds are said for the direction', () => {
  assert.match(thresholdWords(k({}), '%'), /On track at 5% or less; Watch up to 10%; above that Off target/);
  assert.match(thresholdWords(k({ threshold_direction: 'higher_is_better', green_threshold: 80, amber_threshold: 50 })), /80 or more; Watch down to 50; below that Off target/);
  assert.equal(thresholdWords(k({ amber_threshold: null })), 'Thresholds not set');
});

test('the gap to the next better state: a red KRI to amber, an amber one to green, in the direction of the KRI', () => {
  assert.deepEqual(kriGap(k({ current_value: 14 })), { amount: 4, to: 'amber' });
  assert.deepEqual(kriGap(k({ current_value: 7.5 })), { amount: 2.5, to: 'green' });
  assert.deepEqual(kriGap(k({ threshold_direction: 'higher_is_better', green_threshold: 80, amber_threshold: 50, current_value: 30 })), { amount: 20, to: 'amber' });
  assert.deepEqual(kriGap(k({ threshold_direction: 'higher_is_better', green_threshold: 80, amber_threshold: 50, current_value: 65 })), { amount: 15, to: 'green' });
  assert.equal(kriGap(k({ current_value: 1 })), null);
  assert.equal(kriGap(k({ current_value: null })), null);
  assert.equal(kriGap(k({ green_threshold: null, current_value: 7 })), null, 'amber with no green threshold has nowhere to go');
});
