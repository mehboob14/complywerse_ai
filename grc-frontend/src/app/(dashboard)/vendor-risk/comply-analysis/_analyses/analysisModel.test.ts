// node --test "src/app/(dashboard)/vendor-risk/comply-analysis/_analyses/analysisModel.test.ts"
// The Comply analyses register's rules: the chips and facets count the whole list, insurance is the server's word (`cover_state`), a missing figure sorts last, the head says the server's counts.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSchema, evaluateRegister, indexRegister, sortRows, stateOf, type RegisterDef } from '../../../../../components/records/registerModel.ts';
import { countOf } from '../../../../../components/records/facetEngine.ts';
import { readAddress } from '../../../../../lib/addressState.ts';
import type { FairAnalysis } from '../../_lib/fair/fairModel.ts';
import { ANALYSIS_SCHEMA, analysisDef, barWidth, coverOf, headLine, riskOf, tierOf } from './analysisModel.ts';

const row = (over: Partial<FairAnalysis> & { id: number }): FairAnalysis => ({
  vendor: { id: over.id, name: `Supplier ${over.id}`, tier: 'high' }, name: `Analysis ${over.id}`, effect: 'confidentiality', scenario: null, asset: null, threat: null, status: 'draft', currency: 'USD',
  annual: { chance: 0.3, mean: 1000, p50: 800, p90: 3000, p95: 5000, p99: 9000, max: 20000 }, liability_cap: 5000, updated_at: `2026-11-0${over.id}T10:00:00`, run_at: null, row_version: 1, cover_state: 'none', risk_level: null, ...over,
});
const ROWS = [
  row({ id: 1, status: 'final', cover_state: 'short', risk_level: 'high' }),
  row({ id: 2, effect: 'availability', cover_state: 'covers', annual: { chance: 0.9, mean: 90000, p50: 1, p90: 1, p95: 200000, p99: 1, max: 1 }, liability_cap: 200000 }),
  row({ id: 3, status: 'final', annual: null, liability_cap: null, vendor: { id: 3, name: 'Supplier 3', tier: null } }),
  row({ id: 4, effect: 'integrity', cover_state: undefined, risk_level: 'critical' }),
];
const state = (def: RegisterDef<FairAnalysis>, over: Record<string, unknown> = {}) => stateOf(def, { ...readAddress(buildSchema(def), ''), ...over });

test('insurance is the server\'s word: none recorded, enough, or short; an older server that sends none is "none"', () => {
  assert.deepEqual(ROWS.map(coverOf), ['short', 'covers', 'none', 'none']);
  assert.equal(tierOf(ROWS[2]), 'none');
  assert.equal(riskOf(ROWS[0]), 'high');
  assert.equal(riskOf(ROWS[1]), 'none');
});

test('the chips and the facets count the whole list', () => {
  const def = analysisDef();
  const { quickCounts, result } = evaluateRegister(def, indexRegister(def, ROWS), state(def), new Date());
  assert.deepEqual([quickCounts.all, quickCounts.final, quickCounts.draft, quickCounts.short, quickCounts.nocover], [4, 2, 2, 1, 2]);
  assert.equal(countOf(result.counts, 'effect', 'availability'), 1);
  assert.equal(countOf(result.counts, 'cover', 'covers'), 1);
  assert.equal(countOf(result.counts, 'risk', 'none'), 2);
  const search = evaluateRegister(def, indexRegister(def, ROWS), state(def, { q: 'supplier 3' }), new Date());
  assert.deepEqual(search.result.matches.map((r) => r.id), [3]);
  const byEffect = evaluateRegister(def, indexRegister(def, ROWS), state(def, { effect: ['availability'] }), new Date());
  assert.deepEqual(byEffect.result.matches.map((r) => r.id), [2]);
});

test('the newest analysis comes first, and an analysis with no result sorts last by any figure', () => {
  const def = analysisDef();
  assert.deepEqual(sortRows(def, ROWS, def.defaultSort).map((r) => r.id), [4, 3, 2, 1]);
  assert.deepEqual(sortRows(def, ROWS, { key: 'p95', dir: 'desc' }).map((r) => r.id), [2, 1, 4, 3]);
  assert.deepEqual(sortRows(def, ROWS, { key: 'p95', dir: 'asc' }).map((r) => r.id), [1, 4, 2, 3], 'no result is last either way');
  assert.deepEqual(sortRows(def, ROWS, { key: 'cap', dir: 'desc' }).map((r) => r.id), [2, 1, 4, 3]);
  assert.deepEqual(Object.keys(ANALYSIS_SCHEMA).sort(), ['cover', 'effect', 'id', 'page', 'q', 'quick', 'risk', 'sort', 'state', 'supplier', 'tier', 'view'], 'the facet is `supplier`: `?vendor=<id>` stays the link that opens New analysis for a supplier');
});

test('the head says the server\'s counts; a bar is a share of the largest, never past 100', () => {
  assert.equal(headLine({ count: 12, suppliers: 9, finals: 4 }), '12 analyses · 9 suppliers · 4 final');
  assert.equal(headLine({ count: 1, suppliers: 1, finals: 0 }), '1 analysis · 1 supplier · 0 final');
  assert.equal(barWidth(50, 200), 25);
  assert.equal(barWidth(400, 200), 100);
  assert.equal(barWidth(null, 200), 0);
  assert.equal(barWidth(5, 0), 0);
});
