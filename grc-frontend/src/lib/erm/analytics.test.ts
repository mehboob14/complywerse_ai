// node --test "src/lib/erm/analytics.test.ts"
// The analytics numbers: the aggregation reproduces the server's totals, averages, reduction and group order from the lean risk list (bands differ on purpose: one system),
// the heat map's tiles and grid agree (G8 P-28), and a scenario preset moves only the categories it names (P-16) and never formats a null percent (P-42).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { aggregate, type AggRisk } from './aggregation.ts';
import { cellBand, cellWords, heatTiles, occupied, type HeatCell } from './heat.ts';
import { applyCustom, applyPreset, changeWords, percentWords, bandWord, baseOf, isEligible, type Preset, type ScenarioRisk } from './scenario.ts';
import { scoreBand } from './band.ts';

const cats = ['strategic', 'operational', 'financial', 'compliance', 'technology', 'third_party', 'project_change', null];
function register(n: number): AggRisk[] {
  const out: AggRisk[] = [];
  for (let i = 1; i <= n; i++) {
    out.push({
      id: i, risk_category: cats[i % cats.length], status: i % 4 === 0 ? 'mitigated' : i % 9 === 0 ? null : 'open',
      closure_status: i % 23 === 0 ? 'closed' : null, inherent_score: i % 7 === 0 ? null : (i * 3) % 26, residual_score: i % 6 === 0 ? null : (i * 5) % 26,
      business_unit_id: i % 3 === 0 ? null : (i % 3) + 10, business_unit: i % 3 === 0 ? null : `Unit ${(i % 3) + 10}`,
    });
  }
  return out;
}

test('aggregation: totals, averages, reduction and group order are the server\'s (advanced_analytics.py get_risk_aggregation, ported line by line)', () => {
  const risks = register(240);
  const mine = aggregate(risks);
  // the server, in the order it computes them
  const live = risks.filter((r) => r.closure_status == null);
  const ti = live.reduce((n, r) => n + (r.inherent_score || 0), 0);
  const tr = live.reduce((n, r) => n + (r.residual_score || 0), 0);
  const r1 = (x: number) => Math.round(x * 10) / 10;
  assert.equal(mine.summary.totalRisks, live.length);
  assert.equal(mine.summary.totalInherent, r1(ti));
  assert.equal(mine.summary.totalResidual, r1(tr));
  assert.equal(mine.summary.avgInherent, r1(ti / live.length));
  assert.equal(mine.summary.avgResidual, r1(tr / live.length));
  assert.equal(mine.summary.reductionPct, r1(((ti - tr) / ti) * 100));
  const catMap = new Map<string, { count: number; ti: number; tr: number }>();
  live.forEach((r) => { const k = r.risk_category || 'uncategorized'; const c = catMap.get(k) ?? { count: 0, ti: 0, tr: 0 }; c.count++; c.ti += r.inherent_score || 0; c.tr += r.residual_score || 0; catMap.set(k, c); });
  assert.deepEqual(mine.byCategory.map((g) => [g.key, g.count, g.totalInherent, g.totalResidual]), Array.from(catMap.entries()).sort((a, b) => b[1].tr - a[1].tr || a[0].localeCompare(b[0])).map(([k, c]) => [k, c.count, c.ti, c.tr]));
  mine.byCategory.forEach((g) => {
    const c = catMap.get(g.key)!;
    assert.equal(g.avgResidual, r1(c.tr / c.count));
    assert.equal(g.reductionPct, c.ti > 0 ? r1(((c.ti - c.tr) / c.ti) * 100) : 0);
  });
  assert.equal(mine.byBusinessUnit.reduce((n, g) => n + g.count, 0), live.length);
  assert.ok(mine.byBusinessUnit.some((g) => g.label === 'Unassigned'));
  assert.equal(mine.byStatus.reduce((n, s) => n + s.count, 0), live.length);
  assert.ok(mine.byStatus.some((s) => s.status === 'open'), 'a missing status is open');
});

test('aggregation: the bands add up with the unscored, on the platform cut, for the summary and for every group', () => {
  const mine = aggregate(register(240));
  const s = mine.summary;
  assert.equal(s.critical + s.high + s.medium + s.low + s.unscored, s.totalRisks);
  const live = register(240).filter((r) => r.closure_status == null);
  assert.equal(s.critical, live.filter((r) => scoreBand(r.residual_score) === 'critical').length);
  assert.equal(s.unscored, live.filter((r) => !r.residual_score).length, 'a residual score of 0 or none is not a Low risk');
  mine.byCategory.forEach((g) => assert.equal(g.critical + g.high + g.medium + g.low + g.unscored, g.count, g.key));
  assert.deepEqual(aggregate([]).summary, { totalRisks: 0, totalInherent: 0, totalResidual: 0, avgInherent: 0, avgResidual: 0, reductionPct: 0, critical: 0, high: 0, medium: 0, low: 0, unscored: 0 });
});

// ── heat map ──
function grid(placed: Array<[number, number, number]>): HeatCell[] {
  const cells: HeatCell[] = [];
  for (let l = 1; l <= 5; l++) for (let i = 1; i <= 5; i++) {
    const n = placed.find(([pl, pi]) => pl === l && pi === i)?.[2] ?? 0;
    cells.push({ likelihood: l, impact: i, score: l * i, count: n, risks: [] });
  }
  return cells;
}

test('P-28: the tiles and the grid use one band system - a cell and the tile it is counted in always agree, including the edges the old tiles got wrong (score 9 and 4)', () => {
  const cells = grid([[3, 3, 2], [1, 4, 5], [5, 4, 1], [3, 4, 4], [4, 5, 3], [1, 1, 7]]);      // scores 9, 4, 20, 12, 20, 1
  const tiles = heatTiles({ cells, total_risks: 30 });
  // 9 is Medium (the old tile said High) and 4 is Low (the old tile said Medium), as the grid colours them
  assert.deepEqual(tiles.bands, { critical: 4, high: 4, medium: 2, low: 12 });
});

test('tile counts equal the grid\'s per band, scored + not scored = the server\'s total', () => {
  const cells = grid([[3, 3, 2], [1, 4, 5], [5, 4, 1], [3, 4, 4], [4, 5, 3], [1, 1, 7]]);
  const tiles = heatTiles({ cells, total_risks: 30 });
  const byGrid = { critical: 0, high: 0, medium: 0, low: 0 };
  cells.forEach((c) => { byGrid[cellBand(c)] += c.count; });
  assert.deepEqual(tiles.bands, byGrid);
  assert.equal(tiles.scored, 22);
  assert.equal(tiles.unscored, 8);
  assert.equal(tiles.total, 30);
  assert.equal(heatTiles(undefined).total, 0);
});

test('the cells that hold a risk are listed worst first and each is named in words', () => {
  const cells = grid([[3, 3, 2], [5, 4, 1], [1, 1, 7]]);
  assert.deepEqual(occupied(cells).map((c) => c.score), [20, 9, 1]);
  assert.equal(cellWords(cells.find((c) => c.score === 20 && c.count > 0)!, ['Rare', 'Unlikely', 'Possible', 'Likely', 'Almost certain'], ['Insignificant', 'Minor', 'Moderate', 'Major', 'Catastrophic']),
    'Likelihood 5 (Almost certain), impact 4 (Major): score 20, critical, 1 risk');
});

// ── scenarios ──
const risk = (id: number, category: string | null, l: number | null, i: number | null): ScenarioRisk => ({ id, title: `R${id}`, risk_category: category, residual_likelihood: l, residual_impact: i, inherent_likelihood: l, inherent_impact: i });
const downturn: Preset = { id: 'economic_downturn', name: 'Economic Downturn', description: '', categories_affected: ['financial', 'operational'], likelihood_adjustment: 1, impact_adjustment: 1 };
const worst: Preset = { id: 'worst_case', name: 'Worst Case', description: '', likelihood_adjustment: 1, impact_adjustment: 1 };

test('P-16: a preset with categories moves only those; one without moves every risk; values stay within 1-5', () => {
  const risks = [risk(1, 'financial', 2, 3), risk(2, 'technology', 2, 3), risk(3, 'operational', 5, 5)];
  assert.deepEqual(applyPreset(downturn, risks, 'residual').map((a) => [a.risk_id, a.adjusted_likelihood, a.adjusted_impact]), [[1, 3, 4], [2, 2, 3], [3, 5, 5]]);
  assert.deepEqual(applyPreset(worst, risks, 'residual').map((a) => [a.risk_id, a.adjusted_likelihood, a.adjusted_impact]), [[1, 3, 4], [2, 3, 4], [3, 5, 5]]);
  assert.deepEqual(applyPreset({ ...worst, likelihood_adjustment: -3, impact_adjustment: -3 }, risks, 'residual').map((a) => a.adjusted_likelihood), [1, 1, 2]);
});

test('an unscored risk cannot be picked and is never sent (the page built its adjusted score from an assumed 3)', () => {
  const risks = [risk(1, 'financial', null, 3), risk(2, 'financial', 2, null), risk(3, 'financial', 0, 0), risk(4, 'financial', 2, 2)];
  assert.deepEqual(risks.map((r) => isEligible(r, 'residual')), [false, false, false, true]);
  assert.equal(baseOf(risks[0], 'residual'), null);
  assert.deepEqual(applyPreset(worst, risks, 'residual').map((a) => a.risk_id), [4]);
  assert.deepEqual(applyCustom(risks, 'residual', { 4: { likelihood: 9 } }).map((a) => [a.risk_id, a.adjusted_likelihood, a.adjusted_impact]), [[4, 5, 2]]);
  const inherentOnly = { ...risk(5, 'financial', null, null), inherent_likelihood: 4, inherent_impact: 4 };
  assert.deepEqual(applyPreset(worst, [inherentOnly], 'inherent').map((a) => a.adjusted_likelihood), [5]);
  assert.deepEqual(applyPreset(worst, [inherentOnly], 'residual'), []);
});

test('P-42: the server\'s null percent (original score 0) reads "New", never throws; changes carry a direction word', () => {
  assert.equal(percentWords(null), 'New');
  assert.equal(percentWords(undefined), 'New');
  assert.equal(percentWords(25), '+25%');
  assert.equal(percentWords(-12.34), '-12.3%');
  assert.equal(percentWords(0), '0%');
  assert.equal(changeWords(6), '+6 (worse)');
  assert.equal(changeWords(-4), '-4 (better)');
  assert.equal(changeWords(0), 'no change');
  assert.equal(bandWord(20), 'Critical');
  assert.equal(bandWord(0), 'Not scored');
});
