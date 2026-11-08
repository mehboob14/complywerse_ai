// node --test "src/app/(dashboard)/dashboard/_overview/overviewModel.test.ts"
// The request-state rules the Performance Overview shares with its Cyber Security KPI strip (overviewModel.ts). The page's own rules (areas, band, weakest areas, Overall readiness)
// are pinned in perfModel.test.ts and lib/perf/moduleFeeds.test.ts; the nine card definitions this file used to freeze are gone with the cards (G12 Q1/Q3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as model from './overviewModel.ts';
import { SLOW_MS, isRefusal, loadOf, retryDashboard } from './overviewModel.ts';

test('loadOf: an earlier answer stands when a refresh fails; a stored null is no answer, never "no data"', () => {
  assert.equal(loadOf({ status: 'pending' }), 'loading');
  assert.equal(loadOf({ status: 'success', data: { a: 1 } }), 'ready');
  assert.equal(loadOf({ status: 'success', data: 0 }), 'ready');
  assert.equal(loadOf({ status: 'error', data: { a: 1 } }), 'ready', 'a refresh failed but the answer before it stands');
  assert.equal(loadOf({ status: 'error' }), 'error');
  assert.equal(loadOf({ status: 'success', data: null }), 'error', 'another page stores null under the shared key when its own request failed');
});

test('retryDashboard: a refusal is final and said at once; anything else is tried once more', () => {
  const http = (status: number) => ({ isAxiosError: true, response: { status } });
  assert.equal(retryDashboard(0, http(500)), true);
  assert.equal(retryDashboard(1, http(500)), false);
  for (const status of [400, 401, 403, 404, 409, 422]) assert.equal(retryDashboard(0, http(status)), false, String(status));
  assert.equal(retryDashboard(0, http(429)), true);
  assert.equal(retryDashboard(0, new Error('network down')), true);
  assert.equal(isRefusal(http(403)), true);
  assert.equal(isRefusal(http(401)), true);
  assert.equal(isRefusal(http(500)), false);
  assert.equal(isRefusal(undefined), false);
  assert.ok(SLOW_MS >= 5000 && SLOW_MS <= 15000);
});

test('the file keeps exactly what the KPI strip imports from it and nothing of the nine cards', () => {
  assert.deepEqual(Object.keys(model).sort(), ['SLOW_MS', 'isRefusal', 'loadOf', 'retryDashboard']);
  const kpi = readFileSync(new URL('./CyberKpis.tsx', import.meta.url), 'utf8') + readFileSync(new URL('./kpiModel.ts', import.meta.url), 'utf8');
  for (const name of Array.from(kpi.matchAll(/import (?:type )?\{([^}]*)\} from '\.\/overviewModel(?:\.ts)?'/g)).flatMap((m) => m[1].split(',').map((s) => s.trim().replace(/^type /, '')).filter(Boolean))) {
    assert.ok(name === 'Load' || name in model, `${name}: the KPI strip imports it from overviewModel.ts`);
  }
});
