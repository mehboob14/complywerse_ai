// node --test "src/app/(dashboard)/dashboard/_overview/perfCharts.test.ts"
// What the graphical part of the Performance Overview decides: the bars of score against target, the ranked bars of what needs attention (the biggest first, the zeros kept, a failed or
// waiting area named, never a 0), the two histories, and the figures of the tiles. A failed request is a state of its own and a missing number is "no data", never 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AREA_BY_KEY, type Area } from '../../../../lib/perf/moduleFeeds.ts';
import {
  attentionView, gapText, governanceDelta, governanceTrend, kpiFigure, nameList, scoreEmptyText, scoreView, shareOf, statusOfGrade, statusOfTone, tasksTrend, weakBars,
} from './perfCharts.ts';
import { rowOf, weakestAreas, type AreaRow } from './perfModel.ts';

const area = (key: string): Area => AREA_BY_KEY[key];
const err = (status: number) => Object.assign(new Error('x'), { response: { status } });
const card = (score: number | null, sections: Array<[string, number | null]> = [], extra: Record<string, unknown> = {}, queue: Record<string, number> = {}) => ({
  performance: { score, grade: null, components: sections.map(([label, s], i) => ({ key: `s${i}`, label, score: s, target: 85 })) },
  attention_queue: queue,
  ...extra,
});
const ready = (key: string, payload: unknown): AreaRow => rowOf(area(key), { load: 'ready', data: payload });
const loading = (key: string): AreaRow => rowOf(area(key), { load: 'loading' });
const failed = (key: string, status = 500): AreaRow => rowOf(area(key), { load: 'error', error: err(status) });

test('colours are the palette\'s keys: a tone keeps its own, a grade is good / warning / bad, nothing is a categorical hue', () => {
  assert.deepEqual((['success', 'danger', 'warning', 'progress', 'pending', 'neutral'] as const).map(statusOfTone), ['good', 'bad', 'warn', 'progress', 'pending', 'neutral']);
  assert.deepEqual((['excellent', 'good', 'fair', 'poor', null] as const).map(statusOfGrade), ['good', 'good', 'warn', 'bad', 'neutral']);
});

test('the distance to the target in words: below, above, on target, and when no target is recorded', () => {
  assert.equal(gapText(31, 85), '54 below target');
  assert.equal(gapText(90, 85), '5 above target');
  assert.equal(gapText(85, 85), 'On target');
  assert.equal(gapText(60, null), 'No target recorded');
});

test('score against target: a bar per scored area that has a score, in the order given; an area with no score is named, never a 0 bar; a refused area is not here', () => {
  const view = scoreView([
    ready('compliance', card(23, [], { target: 85 })),
    ready('governance', card(90, [], { target: 85 })),
    ready('assets', card(null)),
    ready('risk', card(70, [], { target: 80 })),
    rowOf(area('issues'), { load: 'error', error: err(403) }),
    ready('tasks', { total: 3 }),
  ]);
  assert.equal(view.state, 'ready');
  assert.deepEqual(view.bars.map((b) => [b.key, b.score, b.target, b.grade, b.status, b.gap]), [
    ['compliance', 23, 85, 'poor', 'bad', '62 below target'],
    ['governance', 90, 85, 'excellent', 'good', '5 above target'],
    ['risk', 70, 80, 'good', 'good', '10 below target'],
  ]);
  assert.deepEqual(view.noScore.map((a) => a.key), ['assets']);
  assert.deepEqual(view.leftOut, []);
  assert.ok(!view.bars.some((b) => b.key === 'issues' || b.key === 'tasks'), 'a refused area and a count-only area have no bar');
});

test('score against target: the states are waiting, failed (named), nothing scored, and no scored area open to the person', () => {
  assert.equal(scoreView([loading('governance'), loading('compliance')]).state, 'loading');
  const some = scoreView([ready('governance', card(60, [], { target: 85 })), loading('compliance'), failed('risk')]);
  assert.equal(some.state, 'ready');
  assert.deepEqual(some.leftOut, ['Compliance', 'Risk Management'], 'the picture names what it leaves out');
  assert.equal(scoreView([failed('governance'), failed('compliance')]).state, 'error');
  assert.equal(scoreView([ready('governance', card(null))]).state, 'empty');
  assert.equal(scoreView([]).state, 'empty');
  assert.equal(scoreView([rowOf(area('governance'), { load: 'error', error: err(403) })]).state, 'empty', 'only refused: there is nothing to draw');
  assert.equal(scoreEmptyText(scoreView([]), false), 'None of the scored areas are open to your account.');
  assert.match(scoreEmptyText(scoreView([ready('governance', card(null))]), true), /^No area has a score yet/);
  // a target the answer does not carry gives a bar with no tick and says so
  assert.equal(scoreView([ready('assets', { performance: { score: 40, components: [] } })]).bars[0].gap, 'No target recorded');
});

test('weakest sections as bars: the score as a figure, the module, its grade word and its target as the note, the colour of the grade, where it opens', () => {
  const w = weakestAreas([ready('governance', card(56, [['Attestations', 24], ['Documents', 71]], { target: 85 })), ready('compliance', { performance: { score: 23, components: [{ key: 'evidence', label: 'Evidence', score: 3, target: 85 }] } })], 3);
  const bars = weakBars(w.rows);
  assert.deepEqual(bars.map((b) => [b.label, b.value, b.valueText, b.note, b.status]), [
    ['Evidence', 3, '3%', 'Compliance · Poor · target 85', 'bad'],
    ['Attestations', 24, '24%', 'Governance · Poor · target 85', 'bad'],
    ['Documents', 71, '71%', 'Governance · Good · target 85', 'good'],
  ]);
  assert.equal(bars[0].href, '/evidence', 'a Compliance section opens its page');
  assert.equal(bars[1].href, '/governance');
  assert.deepEqual(weakBars([]), []);
});

test('needs attention: one bar per counter with something in it, the biggest first (then the most serious, then the order the areas are defined in); a zero is kept, a missing number is counted, never drawn', () => {
  const view = attentionView([
    ready('governance', card(50, [], {}, { overdue_reviews: 12, overdue_attestations: 0 })),
    ready('compliance', card(50, [], {}, { controls_without_evidence: 12 })),
    ready('risk', card(50, [], {}, { critical_open_risks: 3 })),
    ready('assets', card(50)),
  ]);
  assert.equal(view.state, 'ready');
  assert.deepEqual(view.bars.map((b) => [b.key, b.value, b.area, b.status]), [
    ['overdue_reviews', 12, 'Governance', 'bad'],
    ['controls_without_evidence', 12, 'Compliance', 'warn'],
    ['critical_open_risks', 3, 'Risk Management', 'bad'],
  ]);
  assert.deepEqual(view.quiet.map((c) => [c.key, c.area]), [['overdue_attestations', 'Governance']], 'a recorded zero stays one press away');
  assert.equal(view.unreported, 1, 'Red KRIs: the answer carried no number');
  assert.equal(view.reporting, 3, 'the areas that answered and have counters (IT Assets has none)');
  assert.equal(view.withItems, 3);
});

test('needs attention: the areas with something are counted once each, however many counters they have', () => {
  const view = attentionView([
    ready('risk', card(50, [], {}, { critical_open_risks: 3, red_kris: 4 })),
    ready('governance', card(50, [], {}, { overdue_reviews: 0, overdue_attestations: 0 })),
  ]);
  assert.equal(view.bars.length, 2);
  assert.equal(view.withItems, 1);
  assert.equal(view.reporting, 2);
});

test('needs attention: waiting, failed (named), refused (silent), nothing to count; one failed area does not hide the others', () => {
  assert.equal(attentionView([loading('governance'), loading('risk')]).state, 'loading');
  assert.equal(attentionView([failed('governance'), failed('risk')]).state, 'error');
  assert.equal(attentionView([loading('governance'), failed('risk')]).state, 'loading', 'still waiting for one: not yet a failure');
  assert.equal(attentionView([]).state, 'empty');
  assert.equal(attentionView([ready('assets', card(40))]).state, 'empty', 'an area with no counters is not a count of 0');
  const mixed = attentionView([ready('governance', card(50, [], {}, { overdue_reviews: 2 })), failed('risk'), loading('compliance'), rowOf(area('issues'), { load: 'error', error: err(403) })]);
  assert.equal(mixed.state, 'ready');
  assert.deepEqual(mixed.failed.map((r) => r.area.key), ['risk']);
  assert.equal(mixed.waiting, 1);
  assert.equal(mixed.bars.length, 1);
});

test('needs attention: all zero is a state of its own (ready, with no bars and the zeros listed), not an error and not an empty card', () => {
  const view = attentionView([ready('governance', card(50, [], {}, { overdue_reviews: 0, overdue_attestations: 0 }))]);
  assert.equal(view.state, 'ready');
  assert.equal(view.bars.length, 0);
  assert.equal(view.quiet.length, 2);
  assert.equal(view.withItems, 0);
});

test('the Governance history: the scorecard\'s monthly points, oldest first, labelled with the year; anything that is not a number is not a point', () => {
  const pts = governanceTrend({ performance: { health_trend: [{ label: 'Dec', year: '2025', value: 61.5 }, { label: 'Jan', year: '2026', value: 70 }, { label: 'Feb', year: '2026', value: null }, { label: 'Mar', value: 'x' }, { label: 'Apr' }] } });
  assert.deepEqual(pts, [{ label: 'Dec 25', value: 61.5 }, { label: 'Jan 26', value: 70 }]);
  assert.deepEqual(governanceTrend(null), []);
  assert.deepEqual(governanceTrend({ performance: {} }), []);
  assert.deepEqual(governanceTrend({ performance: { health_trend: 'x' } }), []);
  assert.deepEqual(governanceTrend({ performance: { health_trend: [{ label: 'Nov', value: 100 }] } }), [{ label: 'Nov', value: 100 }], 'no year: the month alone');
});

test('the Governance tile: the change since last month in words, an arrow direction and a tone (up is good), the points of the sparkline, and the words for a screen reader', () => {
  const up = governanceDelta([{ label: 'Oct', value: 60 }, { label: 'Nov', value: 72 }]);
  assert.deepEqual(up.delta, { text: 'Up 12 points', direction: 'up', tone: 'good' });
  assert.deepEqual(up.values, [60, 72]);
  assert.equal(up.summary, 'Governance score: from 60 in Oct to 72 in Nov, up 12.');
  assert.deepEqual(governanceDelta([{ label: 'Oct', value: 72 }, { label: 'Nov', value: 71 }]).delta, { text: 'Down 1 point', direction: 'down', tone: 'bad' });
  assert.deepEqual(governanceDelta([{ label: 'Oct', value: 72 }, { label: 'Nov', value: 72 }]).delta, { text: 'No change', direction: 'flat', tone: 'neutral' });
  assert.equal(governanceDelta([{ label: 'Nov', value: 72 }]).delta, null, 'one point has no change');
  assert.equal(governanceDelta([]).delta, null);
});

test('the task history: twelve calendar months of created and completed, labelled with the year; a month with no number is a gap; busy only when something happened; the scope is said', () => {
  const t = tasksTrend({ scope: 'mine', trend_data: [{ month: 'Dec 2025', created: 4, completed: 1 }, { month: 'Jan 2026', created: 0, completed: 0 }, { month: 'Feb 2026', created: null, completed: 'x' }] });
  assert.deepEqual(t.rows, [{ label: 'Dec 25', created: 4, completed: 1 }, { label: 'Jan 26', created: 0, completed: 0 }, { label: 'Feb 26', created: null, completed: null }]);
  assert.equal(t.busy, true);
  assert.equal(t.scope, 'mine');
  const quiet = tasksTrend({ scope: 'all', trend_data: [{ month: 'Dec 2025', created: 0, completed: 0 }] });
  assert.equal(quiet.busy, false, 'twelve months of zeros are "nothing happened", said as such');
  assert.equal(quiet.scope, 'all');
  assert.deepEqual(tasksTrend(null), { rows: [], busy: false, scope: null });
  assert.deepEqual(tasksTrend({ trend_data: 'x' }).rows, []);
});

test('the Cyber KPI tile: loading, failed, nothing recorded (no report, no KPIs, none live), the live values not loaded (said), else the count of on-target of live', () => {
  const counts = { live: 7, onTarget: 2, below: 4, notMeasured: 1 };
  const wb = { id: 1, total: 1 };
  assert.deepEqual(kpiFigure({ state: 'loading' }, null), { state: 'loading' });
  assert.deepEqual(kpiFigure({ state: 'error' }, null), { state: 'error' });
  assert.deepEqual(kpiFigure({ state: 'absent' }, null), { state: 'none' });
  assert.deepEqual(kpiFigure({ state: 'empty', workbook: wb }, null), { state: 'none' });
  assert.deepEqual(kpiFigure({ state: 'ready', liveFailed: true, workbook: wb }, null), { state: 'none', failedLive: true }, 'a failed live feed is said, never "0 on target"');
  assert.deepEqual(kpiFigure({ state: 'ready', liveFailed: false, workbook: wb }, { live: 0, onTarget: 0, below: 0, notMeasured: 0 }), { state: 'none' });
  assert.deepEqual(kpiFigure({ state: 'ready', liveFailed: false, workbook: wb }, counts), { state: 'value', on: 2, live: 7 });
});

test('a share for a tile\'s bar: whole percent, 0 of nothing is 0', () => {
  assert.equal(shareOf(3, 7), 43);
  assert.equal(shareOf(0, 7), 0);
  assert.equal(shareOf(7, 7), 100);
  assert.equal(shareOf(0, 0), 0);
});

test('names in a sentence: up to three in full, then two and a count, so a page where everything failed does not print a paragraph', () => {
  assert.equal(nameList([]), '');
  assert.equal(nameList(['Governance']), 'Governance');
  assert.equal(nameList(['Governance', 'Compliance']), 'Governance and Compliance');
  assert.equal(nameList(['A', 'B', 'C']), 'A, B, C');
  assert.equal(nameList(['A', 'B', 'C', 'D', 'E']), 'A, B and 3 more');
});
