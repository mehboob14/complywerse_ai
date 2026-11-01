// node --test "src/app/(dashboard)/dashboard/_overview/kpiModel.test.ts"
// The Cyber Security KPIs panel's rules: its states (a failed request is said; no workbook means no panel), the old counts, the old grid rule, the old
// y-axis auto-zoom (a frozen copy of kpiShared's `makeY` is compared on 3,000 random histories), and the trend in words.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  cardLabel, directionText, kpiCounts, lastCardSpan, ofText, panelState, readings, recentPeriods, scaleY, spark, targetRule, targetState, trendSummary,
  type KpiData,
} from './kpiModel.ts';

// ── the old y scale, frozen (kpiShared.tsx @ 4722ba67) ────────────────────────────────────────────────────────────────────────────────────────────────────────────
/* eslint-disable */
type P = { date: string; value: number | null };
const oldClamp = (v: number | null) => Math.max(0, Math.min(100, v ?? 0));
function oldMakeY(pts: P[], target: number | null, H: number, padT: number, padB: number) {
  const vals = pts.map((p) => p.value as number);
  const refs = target != null ? [...vals, target] : vals;
  let lo = Math.min(...refs), hi = Math.max(...refs);
  const span = hi - lo;
  const pad = Math.max(4, span * 0.18);
  lo = Math.max(0, lo - pad);
  hi = Math.min(100, hi + pad);
  if (hi - lo < 1) hi = lo + 1;
  return (v: number) => H - padB - ((oldClamp(v) - lo) / (hi - lo)) * (H - padT - padB);
}
/* eslint-enable */

function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

test('the y scale is the old one: 3,000 random histories, with and without a target, at three heights', () => {
  const r = rng(11);
  for (let n = 0; n < 3000; n++) {
    const len = 2 + Math.floor(r() * 12);
    const flat = r() < 0.2;
    const base = r() * 100;
    const pts = Array.from({ length: len }, (_, i) => ({ date: `2026-10-${String(1 + i).padStart(2, '0')}`, value: flat ? base : Math.round(r() * 1000) / 10 }));
    const target = r() < 0.3 ? null : Math.round(r() * 100);
    const [H, pt, pb] = [[40, 4, 4], [66, 26, 22], [150, 26, 22]][n % 3];
    const old = oldMakeY(pts, target, H, pt, pb);
    const now = scaleY(pts, target, H, pt, pb);
    for (const v of [0, 25, 50, 75, 100, pts[0].value, pts[len - 1].value]) assert.equal(now(v), old(v), `#${n} v=${v}`);
  }
});

test('the panel is loading, failed, absent (no workbook or no rows: no panel, as before) or ready; a failed live feed does not hide the rows', () => {
  const data = (items: unknown[], liveFailed = false): KpiData => ({ items, metrics: {}, liveFailed });
  assert.deepEqual(panelState('loading', undefined), { state: 'loading' });
  assert.deepEqual(panelState('error', undefined), { state: 'error' });
  assert.deepEqual(panelState('ready', null), { state: 'absent' }, 'the query returns null when the tenant has no KPI assessment');
  assert.deepEqual(panelState('ready', undefined), { state: 'absent' });
  assert.deepEqual(panelState('ready', data([])), { state: 'absent' });
  assert.deepEqual(panelState('ready', data([{}])), { state: 'ready', liveFailed: false });
  assert.deepEqual(panelState('ready', data([{}], true)), { state: 'ready', liveFailed: true });
});

test('counts: live KPIs, on target, below target (nothing measured is neither) and domains', () => {
  const k = (domain: string, onTarget: boolean | null) => ({ domain, onTarget }) as any;
  assert.deepEqual(kpiCounts([k('A', true), k('A', false), k('B', null), k('C', true)]), { live: 4, onTarget: 2, below: 1, domains: 3 });
  assert.deepEqual(kpiCounts([]), { live: 0, onTarget: 0, below: 0, domains: 0 });
});

test('the last card fills the row of three: one left takes three columns, two left take two', () => {
  for (const [count, spans] of [[1, [3]], [2, [1, 2]], [3, [1, 1, 1]], [4, [1, 1, 1, 3]], [5, [1, 1, 1, 1, 2]], [7, [1, 1, 1, 1, 1, 1, 3]], [9, [1, 1, 1, 1, 1, 1, 1, 1, 1]]] as Array<[number, number[]]>) {
    assert.deepEqual(Array.from({ length: count }, (_, i) => lastCardSpan(i, count)), spans, String(count));
  }
});

test('a KPI is on target, below it, or not measured (the old card said "Below target" for the last)', () => {
  assert.deepEqual([true, false, null].map((onTarget) => targetState({ onTarget })), ['on_target', 'below_target', 'not_measured']);
});

test('readings keep the values only; the trend is drawn from two readings and says so in words', () => {
  const history = [{ date: '2026-10-05', value: 62 }, { date: '2026-10-12', value: null }, { date: '2026-11-01', value: 71.4 }];
  assert.deepEqual(readings(history).map((p) => p.value), [62, 71.4]);
  assert.deepEqual(readings(null), []);
  assert.equal(spark(history.slice(0, 1), 90), null, 'one reading is a point, not a line');
  assert.equal(spark([], 90), null);
  const line = spark(history, 90, 200, 48, 4);
  assert.ok(line);
  assert.equal(line.points.split(' ').length, 2);
  assert.ok(line.targetY != null && line.targetY >= 0 && line.targetY <= 48);
  assert.ok(line.last.left > 95 && line.last.left <= 100, 'the last reading is at the right edge');
  assert.equal(spark(history, null)?.targetY, null);
  assert.equal(trendSummary(history, 90), '2 readings, from 62% on 5 Oct 2026 to 71% on 1 Nov 2026. Target 90%.');
  assert.equal(trendSummary(history.slice(0, 1), null), 'One reading: 62% on 5 Oct 2026.');
  assert.equal(trendSummary([], 90), 'No readings recorded yet.');
});

test('a reading is a day: it never moves with the viewer\'s time zone', () => {
  assert.equal(trendSummary([{ date: '2026-03-01', value: 50 }, { date: '2026-03-31', value: 60 }], null), '2 readings, from 50% on 1 Mar 2026 to 60% on 31 Mar 2026.');
});

test('the recent readings and how far each is from the target, in percentage points', () => {
  const history = Array.from({ length: 8 }, (_, i) => ({ date: `2026-10-${String(1 + i * 3).padStart(2, '0')}`, value: 60 + i * 2.4 }));
  const rows = recentPeriods(history, 90);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[4], { date: '2026-10-22', day: '22 Oct 2026', value: 77, target: 90, variance: -13 });
  assert.deepEqual(recentPeriods(history, null)[0].variance, null);
  assert.deepEqual(recentPeriods([], 90), []);
});

test('words: the rule for being on target, the direction, the card\'s name and its counts', () => {
  assert.equal(targetRule({ lowerBetter: true }), 'Actual at or below the target');
  assert.equal(targetRule({ lowerBetter: false }), 'Actual at or above the target');
  assert.equal(directionText({ lowerBetter: true }), 'Lower is better');
  assert.equal(directionText({ lowerBetter: false }), 'Higher is better');
  assert.equal(cardLabel({ topic: 'Policy reviews on time', domain: 'Governance', actual: 82, target: 95, onTarget: false }, 'Below target'), 'Policy reviews on time, Governance: 82% against a target of 95%. Below target. Opens the details.');
  assert.equal(cardLabel({ topic: 'T', domain: 'D', actual: null, target: null, onTarget: null }, 'Not measured'), 'T, D: —. Not measured. Opens the details.');
  assert.equal(ofText({ numerator: 54, denominator: 66 }), '54 of 66');
  assert.equal(ofText({ numerator: undefined, denominator: 66 }), '');
});
