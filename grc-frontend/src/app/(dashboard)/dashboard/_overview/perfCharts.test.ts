// node --test "src/app/(dashboard)/dashboard/_overview/perfCharts.test.ts"
// What the graphical part of the Performance Overview decides: the bars of score against target (each with the one count that needs attention), the one "Needs attention" tile (areas by their
// worst count), the tiles of the areas that have no score (a status colour with its words), the two histories, and the figures of the tiles. A failed request is a state of its own and a
// missing number is "no data", never 0.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AREA_BY_KEY, type Area } from '../../../../lib/perf/moduleFeeds.ts';
import {
  attentionNote, attentionView, barName, countText, gapText, governanceDelta, governanceTrend, kpiFigure, nameList, otherTiles, scoreEmptyText, scoreView, severityParts, shareOf, statusOfGrade, statusOfTone, tasksTrend,
} from './perfCharts.ts';
import { rowOf, type AreaRow } from './perfModel.ts';

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

test('score against target: a bar per scored area that answered, in the order given; an area with no score is a neutral "Not scored" bar, never a 0 score; a refused area is not here', () => {
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
    ['assets', null, null, null, 'neutral', 'Not scored yet'],
    ['risk', 70, 80, 'good', 'good', '10 below target'],
  ]);
  assert.deepEqual(view.leftOut, []);
  assert.ok(!view.bars.some((b) => b.key === 'issues' || b.key === 'tasks'), 'a refused area and a count-only area have no bar');
});

test('a bar carries its area\'s most serious count as the one line under the name, with its own words and the records it opens; no count lit, no line', () => {
  const view = scoreView([
    ready('governance', card(50, [], {}, { overdue_reviews: 12, overdue_attestations: 30 })),
    ready('compliance', card(50, [], {}, { controls_without_evidence: 0 })),
    ready('risk', card(50)),
  ]);
  const [gov, comp, risk] = view.bars;
  assert.deepEqual([gov.attention?.text, gov.attention?.status], ['30 overdue attestations', 'bad'], 'the same tone: the bigger count first');
  assert.match(gov.attention?.href ?? '', /^\/governance\/documents/);
  assert.equal(comp.attention, null, 'a count at 0 is not drawn');
  assert.equal(risk.attention, null, 'a count the answer did not carry is not drawn either');
});

test('a count in words: the number, then its label with the first word in lower case unless it is an acronym', () => {
  assert.equal(countText(99, 'Overdue tasks'), '99 overdue tasks');
  assert.equal(countText(12, 'SLA-breached issues'), '12 SLA-breached issues');
  assert.equal(countText(1234, 'Lapsed evidence'), '1,234 lapsed evidence');
  assert.equal(countText(1, 'Overdue tasks'), 'Overdue tasks: 1', 'one is never "1 overdue tasks"');
});

test('what a bar\'s link says: where it goes, the score, the grade word and the distance to the target; an area with no score says so', () => {
  assert.equal(barName({ label: 'Governance', score: 72, grade: 'good', gap: '13 below target' }), 'Open Governance: 72 out of 100, good, 13 below target');
  assert.equal(barName({ label: 'IT Assets', score: null, grade: null, gap: 'Not scored yet' }), 'Open IT Assets: not scored yet');
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

test('needs attention counts AREAS, once each: a danger count is "act now", any other lit count is "watch", every count at 0 is clear; an area with no counters is not counted', () => {
  const view = attentionView([
    ready('governance', card(50, [], {}, { overdue_reviews: 12, overdue_attestations: 0 })),
    ready('compliance', card(50, [], {}, { controls_without_evidence: 12 })),
    ready('risk', card(50, [], {}, { critical_open_risks: 3, red_kris: 4 })),
    ready('issues', card(50, [], {}, { sla_breached_issues: 0, open_critical_incidents: 0 })),
    ready('assets', card(50)),
  ]);
  assert.equal(view.state, 'ready');
  assert.deepEqual([view.reporting, view.withItems, view.act, view.watch, view.clear], [4, 3, 2, 1, 1]);
  assert.deepEqual(severityParts(view).map((p) => [p.key, p.label, p.value, p.status]), [['act', 'Act now', 2, 'bad'], ['watch', 'Watch', 1, 'warn'], ['clear', 'Clear', 1, 'good']], 'the bar\'s parts add up to the areas that answered');
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
  assert.equal(mixed.act, 1);
});

test('the words under the Needs attention figure: the colours of its bar first, then what it leaves out; a failed area never hides them; all clear only when nothing is lit', () => {
  const one = [ready('governance', card(50, [], {}, { overdue_reviews: 3 })), ready('compliance', card(50, [], {}, { controls_without_evidence: 2 })), failed('risk'), loading('assets')];
  assert.equal(attentionNote(attentionView(one)), '1 act now · 1 watch · 1 still loading · Risk Management could not be read');
  assert.equal(attentionNote(attentionView([ready('governance', card(50, [], {}, { overdue_reviews: 0, overdue_attestations: 0 }))])), 'All clear');
  assert.equal(attentionNote(attentionView([ready('governance', card(50, [], {}, { overdue_reviews: 4 }))])), '1 act now');
});

test('needs attention: all zero is a state of its own (ready, every area clear), not an error and not an empty card', () => {
  const view = attentionView([ready('governance', card(50, [], {}, { overdue_reviews: 0, overdue_attestations: 0 }))]);
  assert.equal(view.state, 'ready');
  assert.deepEqual([view.withItems, view.clear], [0, 1]);
});

test('the other areas: a tile each for the areas with no score; the top lit count in its status colour with its words, "All clear", a neutral headline, a link, and the states waiting, failed and refused', () => {
  const tiles = otherTiles([
    ready('governance', card(50)),
    ready('tasks', { total: 101, overdue: 99 }),
    ready('frameworks', []),
    ready('auditor', []),
    rowOf(area('cyber'), undefined),
    loading('bcm'),
    failed('evidence'),
    failed('automation', 403),
  ]);
  assert.deepEqual(tiles.map((t) => t.key), ['tasks', 'frameworks', 'auditor', 'cyber', 'bcm', 'evidence', 'automation'], 'a scored area is a bar, not a tile');
  const [tasks, frameworks, auditor, cyber, bcm, evidence, automation] = tiles;
  assert.deepEqual([tasks.line, tasks.status, tasks.name], ['99 overdue tasks', 'bad', 'Open Task Management: 99 overdue tasks']);
  assert.match(tasks.href ?? '', /^\/tasks/, 'a lit count opens the records it counts');
  assert.deepEqual([frameworks.line, frameworks.status, frameworks.href], ['All clear', 'good', '/frameworks'], 'every count answered 0: the area opens');
  assert.deepEqual([auditor.line, auditor.status, auditor.state], ['No certification journeys yet', 'neutral', 'ready'], 'a headline is neutral: no colour for what is not a count');
  assert.deepEqual([cyber.line, cyber.state, cyber.href], ['Open', 'link', '/cyber-assurance/dashboard']);
  assert.deepEqual([bcm.state, bcm.href], ['loading', null]);
  assert.deepEqual([evidence.line, evidence.status, evidence.href, evidence.retry], ["Couldn't load", 'bad', null, true], 'a failure is said, never a 0, and can be asked again');
  assert.deepEqual([automation.line, automation.href, automation.retry], ['No access', null, false], 'a refusal cannot be retried');
});

test('the other areas: more than one lit count is said in the link name; the most serious (then the biggest) is the figure', () => {
  const [t] = otherTiles([ready('automation', { automation: { posture: { failed: 3 } }, collection: { counts: { failing: 5 } } })]);
  assert.deepEqual([t.line, t.status], ['5 sources failing', 'bad']);
  assert.equal(t.name, 'Open Controls Automation: 5 sources failing, and 1 more count');
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
