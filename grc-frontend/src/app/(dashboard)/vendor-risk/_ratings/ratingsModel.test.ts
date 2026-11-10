// node --test "src/app/(dashboard)/vendor-risk/_ratings/ratingsModel.test.ts"
// The Security ratings register: the server's numbers are never recomputed, only filtered and ordered; the scale is named; every supplier is reachable through a facet.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { countOf } from '../../../../components/records/facetEngine.ts';
import { evaluateRegister, indexRegister, sortRows, stateOf, buildSchema } from '../../../../components/records/registerModel.ts';
import { readAddress } from '../../../../lib/addressState.ts';
import { RATINGS_SCHEMA, headLine, hasNoDomain, isUnscanned, isWeak, moved, providersOf, ratingsDef, riskCounts, scaleWords, scanState, type RatingRow } from './ratingsModel.ts';

const row = (id: number, o: Partial<RatingRow> = {}): RatingRow => ({
  vendor: { id, name: `Supplier ${id}`, tier: 'high' }, domains: [`s${id}.test`], score: 80, grade: 'B', change: 0, scanned_at: '2026-11-01T00:00:00', serious: 0, waived: 0, ratings: {}, ...o,
});
const ROWS: RatingRow[] = [
  row(1), row(2, { score: 41, grade: 'F', change: -12, serious: 3 }), row(3, { score: 58, grade: 'D', waived: 2 }),
  row(4, { score: null, grade: null, scanned_at: null }), row(5, { domains: [], score: null, grade: null, vendor: { id: 5, name: 'No domain Ltd', tier: null } }),
  row(6, { score: 95, grade: 'A', change: 4, ratings: { UpGuard: { at: '2026-11-01', score: 88, risks: { critical: 1, high: 2 } }, BitSight: { at: '2026-11-01', score: 700 } } }),
];
const state = (over: Record<string, unknown> = {}) => stateOf(ratingsDef(), { ...readAddress(buildSchema(ratingsDef()), ''), ...over });

test('the counts the page says are the server\'s definitions: "Graded D or F", "not scanned yet" (a domain, no score) and "no domain" are three different suppliers', () => {
  assert.deepEqual(ROWS.filter(isWeak).map((r) => r.vendor.id), [2, 3]);
  assert.deepEqual(ROWS.filter(isUnscanned).map((r) => r.vendor.id), [4]);
  assert.deepEqual(ROWS.filter(hasNoDomain).map((r) => r.vendor.id), [5]);
  assert.deepEqual(ROWS.map(scanState), ['scanned', 'scanned', 'scanned', 'unscanned', 'no_domain', 'scanned']);
  assert.deepEqual([moved(ROWS[1]), moved(ROWS[5]), moved(ROWS[0])], ['dropped', 'rose', 'same']);
  const def = ratingsDef();
  const { quickCounts, result } = evaluateRegister(def, indexRegister(def, ROWS), state(), new Date());
  assert.deepEqual([quickCounts.all, quickCounts.weak, quickCounts.fell, quickCounts.unscanned, quickCounts.waived], [6, 2, 1, 1, 1]);
  assert.equal(countOf(result.counts, 'grade', 'none'), 2, 'not rated: the two with no score');
  assert.equal(countOf(result.counts, 'grade', 'F'), 1);
});

test('the default order is weakest first with the unscored last, and any order keeps a supplier with no value last', () => {
  const def = ratingsDef();
  assert.deepEqual(sortRows(def, ROWS, def.defaultSort).map((r) => r.vendor.id), [2, 3, 1, 6, 4, 5]);
  assert.deepEqual(sortRows(def, ROWS, { key: 'score', dir: 'desc' }).map((r) => r.vendor.id), [6, 1, 3, 2, 4, 5]);
  assert.deepEqual(sortRows(def, ROWS, { key: 'grade', dir: 'asc' }).map((r) => r.vendor.id).slice(0, 4), [6, 1, 3, 2], 'best grade first, then the rest');
});

test('every supplier is reachable through each facet, and the grade says which scale it is', () => {
  const def = ratingsDef();
  for (const f of def.facets) for (const r of ROWS) for (const v of f.values(r)) assert.ok(f.options(ROWS).some((o) => o.value === v), `${f.key}: ${v}`);
  assert.deepEqual(def.facets[0].options(ROWS).map((o) => o.label), ['Outside-in A', 'Outside-in B', 'Outside-in C', 'Outside-in D', 'Outside-in F', 'Not rated']);
  assert.deepEqual(Object.keys(RATINGS_SCHEMA).sort(), ['grade', 'id', 'move', 'page', 'q', 'quick', 'scan', 'serious', 'sort', 'tier', 'view', 'waiver'].sort());
  const search = evaluateRegister(def, indexRegister(def, ROWS), state({ q: 's2.test' }), new Date());
  assert.deepEqual(search.result.matches.map((r) => r.vendor.id), [2], 'a domain is searchable');
});

test('provider ratings: the columns are the providers that sent any, and a count of risks reads worst first', () => {
  assert.deepEqual(providersOf(ROWS), ['BitSight', 'UpGuard']);
  assert.equal(riskCounts(ROWS[5].ratings.UpGuard.risks), '1 critical · 2 high');
  assert.equal(riskCounts({}), 'no open risks');
  assert.equal(riskCounts(undefined), null);
});

test('the head says the server\'s numbers in words, and the scale in one sentence that names it', () => {
  const answer = { average: 72, grades: { A: 1, B: 1, C: 0, D: 1, F: 1 }, unscanned: 1, no_domain: 1, expiring_waivers: [{ id: 1, finding_key: 'x', host: null, expires_on: '2026-12-01', days_left: 20, vendor: { id: 3, name: 'S3' } }] };
  assert.equal(headLine(answer, 6), '6 suppliers · average score 72 · 2 graded D or F · 1 not scanned yet · 1 with no domain · 1 waiver ends within 30 days');
  assert.equal(headLine({ ...answer, average: null, grades: {}, unscanned: 0, no_domain: 0, expiring_waivers: [] }, 1), '1 supplier');
  const says = scaleWords({ every_days: { critical: 7, high: 30, medium: 90, low: 365 }, grade_bands: { A: 90, B: 80, C: 70, D: 55 } });
  assert.match(says, /critical weekly, high monthly, medium quarterly, low yearly/);
  assert.match(says, /higher score is better: A from 90, B from 80, C from 70, D from 55, F below/);
  assert.match(says, /not the grade of an assessment/);
});
