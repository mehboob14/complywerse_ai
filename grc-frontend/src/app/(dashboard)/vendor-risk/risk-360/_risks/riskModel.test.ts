// node --test "src/app/(dashboard)/vendor-risk/risk-360/_risks/riskModel.test.ts"
// The Risks register's rules: the bands are the tenant's (75 / 50 / 25 shipped), the "open" chip is the server's own definition, the ten domains come in the module's order with their coverage, and a risk
// is never worded with its id.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildSchema, evaluateRegister, indexRegister, sortRows, stateOf, type RegisterDef } from '../../../../../components/records/registerModel.ts';
import { countOf } from '../../../../../components/records/facetEngine.ts';
import { readAddress } from '../../../../../lib/addressState.ts';
import { DOMAIN_KEYS } from '../../_lib/tprmShared.ts';
import {
  DOMAIN_INFO, RISK_SCHEMA, bandOf, domainRows, findingsByDomain, hasDomains, headLine, isOpen, riskDef, scoreWords, titleOf, type RiskRow,
} from './riskModel.ts';

const risk = (over: Partial<RiskRow> & { id: number }): RiskRow => ({
  title: `Risk ${over.id}`, vendor_id: over.id, vendor_name: `Supplier ${over.id}`, tier: 'high', inherent_score: 60, residual_score: 40, status: 'open', register_type: 'Third-Party Risk', updated_at: '2026-11-01T10:00:00', ...over,
});
const ROWS = [
  risk({ id: 1, residual_score: 92 }), risk({ id: 2, residual_score: 75 }), risk({ id: 3, residual_score: 74 }), risk({ id: 4, residual_score: 50, status: 'closed' }),
  risk({ id: 5, residual_score: 49 }), risk({ id: 6, residual_score: 25 }), risk({ id: 7, residual_score: 24, tier: null }), risk({ id: 8, residual_score: null, vendor_id: null, vendor_name: null, status: null }),
];

const state = (def: RegisterDef<RiskRow> = riskDef(), over: Record<string, unknown> = {}) => stateOf(def, { ...readAddress(buildSchema(def), ''), ...over });

test('a residual score is worded on the tenant\'s bands: 75 / 50 / 25 shipped, its own when the policy changed them', () => {
  assert.deepEqual([92, 75, 74, 50, 49, 25, 24].map((s) => bandOf({ residual_score: s })), ['critical', 'critical', 'high', 'high', 'medium', 'medium', 'low']);
  assert.equal(bandOf({ residual_score: null }), 'none');
  assert.equal(bandOf({ residual_score: 70 }), 'high', '70 was "critical" under the old 70 / 48 / 26 colours');
  assert.equal(bandOf({ residual_score: 70 }, { critical: 70, high: 40, medium: 20 }), 'critical');
  assert.equal(scoreWords({ residual_score: 62 }), 'Residual 62 of 100, high');
  assert.equal(scoreWords({ residual_score: null }), 'Not scored yet');
});

test('the chips and the band facet count the same suppliers whatever the bands are', () => {
  const def = riskDef();
  const { quickCounts, result } = evaluateRegister(def, indexRegister(def, ROWS), state(def), new Date());
  assert.equal(quickCounts.all, 8);
  assert.equal(quickCounts.open, 7, 'the server counts every risk that is not closed (a missing status is open)');
  assert.equal(quickCounts.serious, 4, '92, 75, 74 and 50 are critical or high; 49 is medium');
  assert.equal(quickCounts.unscored, 1);
  assert.equal(countOf(result.counts, 'band', 'critical'), 2);
  const custom = riskDef({ critical: 90, high: 70, medium: 40 });
  const c = evaluateRegister(custom, indexRegister(custom, ROWS), state(custom), new Date());
  assert.equal(c.quickCounts.serious, 4 - 1, 'with the bands moved up, 50 is only medium');
  assert.ok(isOpen({ status: null }) && !isOpen({ status: 'Closed' }));
});

test('the default order is the highest residual first, a risk with no score last either way', () => {
  const def = riskDef();
  assert.deepEqual(sortRows(def, ROWS, def.defaultSort).map((r) => r.id), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(sortRows(def, ROWS, { key: 'residual', dir: 'asc' }).map((r) => r.id), [7, 6, 5, 4, 3, 2, 1, 8]);
});

test('the address keeps the facets and the chip, and every facet is offered with every value a risk can have', () => {
  assert.deepEqual(Object.keys(RISK_SCHEMA).sort(), ['band', 'domains', 'id', 'page', 'q', 'quick', 'sort', 'status', 'supplier', 'tier', 'view']);
  const def = riskDef();
  const bands = def.facets.find((f) => f.key === 'band')!.options([]).map((o) => o.label);
  assert.deepEqual(bands, ['Critical', 'High', 'Medium', 'Low', 'Not scored']);
  assert.ok(def.facets.find((f) => f.key === 'status')!.options([]).some((o) => o.value === 'open'));
  assert.equal(buildSchema(def).quick !== undefined, true);
});

test('the ten domains come in the module\'s order with their residual and how much was answered; a missing one is not assessed', () => {
  const rows = domainRows({ domain_scores: { cybersecurity: { residual: 80, total: 10, answered: 5 }, legal: { residual: 20, total: 0 } } });
  assert.deepEqual(rows.map((d) => d.key), DOMAIN_KEYS);
  assert.deepEqual([rows[0].residual, rows[0].covered, rows[0].band], [80, 50, 'critical']);
  assert.deepEqual([rows[1].residual, rows[1].covered, rows[1].band], [null, null, 'none']);
  assert.deepEqual([rows[9].residual, rows[9].covered, rows[9].band], [20, null, 'low'], 'no total: coverage is unknown, not 0%');
  assert.equal(hasDomains({ domain_scores: {} }), false);
  assert.equal(hasDomains({ domain_scores: { esg: {} } }), true);
});

test('the Domains drawer says what each domain is for and counts the open findings in each, 0 when the dashboard counted none', () => {
  assert.deepEqual(Object.keys(DOMAIN_INFO), DOMAIN_KEYS);
  DOMAIN_KEYS.forEach((k) => assert.ok(DOMAIN_INFO[k].purpose.length > 20 && DOMAIN_INFO[k].evidence.length >= 3, k));
  const f = findingsByDomain({ cybersecurity: 7, legal: 1 });
  assert.deepEqual([f[0].count, f[1].count, f[9].count], [7, 0, 1]);
  assert.equal(findingsByDomain(undefined).every((d) => d.count === 0), true);
});

test('a risk is named by its title, else by its supplier, never by its number', () => {
  assert.equal(titleOf({ title: 'Payments outage', vendor_name: 'Acme' }), 'Payments outage');
  assert.equal(titleOf({ title: '  ', vendor_name: 'Acme' }), 'Third-party risk: Acme');
  assert.equal(titleOf({ title: null, vendor_name: null }), 'Third-party risk');
});

test('the head says the server\'s numbers in words', () => {
  assert.equal(headLine({ total: 87, open: 61, avg_residual: 42.5 }), '87 risks · 61 open · average residual 42.5');
  assert.equal(headLine({ total: 1, open: 0, avg_residual: null }), '1 risk · 0 open');
});
