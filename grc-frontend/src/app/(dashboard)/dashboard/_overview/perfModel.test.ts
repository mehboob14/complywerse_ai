// node --test "src/app/(dashboard)/dashboard/_overview/perfModel.test.ts"
// What the Performance Overview decides: the row of each area from the state of its request (a failure is never "no data" and never 0), the order of the cards, the counts of an area that
// have something in them, and Overall readiness with the words that define it (the same words for everyone, the member list, what it leaves out).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AREAS, AREA_BY_KEY, type Area } from '../../../../lib/perf/moduleFeeds.ts';
import {
  SCORED_AREAS, againstTarget, litCounters, orderRows, overallDefinition, overallLeaves, overallOf, retryable,
  rowOf, vsTargetText, type AreaRow,
} from './perfModel.ts';

const area = (key: string): Area => AREA_BY_KEY[key];
const err = (status: number) => Object.assign(new Error('x'), { response: { status } });

/** A scorecard answer with the given score, target and sections. */
const card = (score: number | null, sections: Array<[string, number | null]> = [], extra: Record<string, unknown> = {}, queue: Record<string, number> = {}) => ({
  performance: { score, grade: null, components: sections.map(([label, s], i) => ({ key: `s${i}`, label, score: s, target: 85 })) },
  attention_queue: queue,
  ...extra,
});
const ready = (key: string, payload: unknown): AreaRow => rowOf(area(key), { load: 'ready', data: payload });

test('a row: waiting, failed, refused, read, or a link; a refusal (401 or 403) is "denied" and a failure is "error", never "no data"', () => {
  assert.equal(rowOf(area('governance'), { load: 'loading' }).state, 'loading');
  assert.equal(rowOf(area('governance'), undefined).state, 'loading', 'a request that has not started is waiting');
  assert.equal(rowOf(area('governance'), { load: 'error', error: err(500) }).state, 'error');
  assert.equal(rowOf(area('governance'), { load: 'error', error: err(403) }).state, 'denied');
  assert.equal(rowOf(area('governance'), { load: 'error', error: err(401) }).state, 'denied');
  assert.equal(rowOf(area('cyber'), undefined).state, 'link');
  const ok = ready('governance', card(60, [['Documents', 70]]));
  assert.equal(ok.state, 'ready');
  assert.equal(ok.read?.score, 60);
  const bad = rowOf(area('bcm'), { load: 'ready', data: { totals: {} } });
  assert.equal(bad.state, 'error', 'an answer in a shape the rules do not know is a failure to read, not an empty area');
  assert.equal(bad.read, null);
});

test('retry is offered only where asking again can help', () => {
  assert.equal(retryable(rowOf(area('governance'), { load: 'error', error: err(500) })), true);
  assert.equal(retryable(rowOf(area('governance'), { load: 'error', error: err(403) })), false);
  assert.equal(retryable(rowOf(area('governance'), { load: 'error', error: err(404) })), false, 'not found is final');
});

test('the cards are ordered weakest first among the scored areas, then the areas with a headline, then the links', () => {
  const rows = [
    ready('governance', card(80)), ready('compliance', card(23)), rowOf(area('risk'), { load: 'loading' }), ready('assessments', card(null)),
    ready('frameworks', []), ready('tasks', { total: 3, overdue: 1 }), rowOf(area('cyber'), undefined), rowOf(area('assets'), { load: 'error', error: err(500) }),
  ];
  assert.deepEqual(orderRows(rows).map((r) => r.area.key), ['compliance', 'governance', 'risk', 'assessments', 'assets', 'frameworks', 'tasks', 'cyber']);
  assert.deepEqual(orderRows([]), []);
});

test('against the target, in words: how far below or above, or on target; nothing when the score or the target is missing', () => {
  assert.equal(againstTarget(72, 85), '13 below');
  assert.equal(againstTarget(90, 85), '5 above');
  assert.equal(againstTarget(85, 85), 'On target');
  assert.equal(againstTarget(84.6, 85), 'On target', 'rounded to whole points on both sides, as they are printed');
  assert.equal(againstTarget(null, 85), '');
  assert.equal(againstTarget(72, null), '');
  assert.equal(againstTarget(1234, 0), '1,234 above');
});

test('the sentence for the big number: below, above or on the target, and when no target is recorded', () => {
  assert.equal(vsTargetText(72, 85), '13 below the target of 85');
  assert.equal(vsTargetText(90, 85), '5 above the target of 85');
  assert.equal(vsTargetText(85, 85), 'On the target of 85');
  assert.equal(vsTargetText(72, null), 'No target recorded');
  assert.equal(vsTargetText(null, 85), '');
});

test('the counts of an area that have something in them: the most serious first, then the biggest; a count at 0 or one the answer does not carry is not lit', () => {
  const g = ready('governance', card(50, [], {}, { overdue_reviews: 0, overdue_attestations: 4 })).read;
  assert.deepEqual(litCounters(g).map((c) => [c.key, c.value]), [['overdue_attestations', 4]]);
  const risk = ready('risk', card(50, [], {}, { critical_open_risks: 2, red_kris: 9 })).read;
  assert.deepEqual(litCounters(risk).map((c) => c.key), ['red_kris', 'critical_open_risks'], 'same tone: the bigger first');
  assert.deepEqual(litCounters(ready('governance', card(50)).read), [], 'counters the answer does not carry are not lit');
  assert.deepEqual(litCounters(null), []);
  const mixed = ready('compliance', card(50, [], {}, { controls_without_evidence: 3 })).read;
  assert.equal(litCounters(mixed)[0]?.label, 'Controls without evidence');
});

const scoredRows = (scores: Record<string, number | null | 'loading' | 'error' | 'denied'>) => AREAS.filter((a) => a.kind === 'score').flatMap((a): AreaRow[] => {
  const v = scores[a.key];
  if (v === undefined || v === 'denied') return [];
  if (v === 'loading') return [rowOf(a, { load: 'loading' })];
  if (v === 'error') return [rowOf(a, { load: 'error', error: err(500) })];
  return [rowOf(a, { load: 'ready', data: card(v, [], { target: 85 }) })];
});

test('Overall readiness: the equal-weight mean of the scored areas the person may open and that answered, with its grade by the server\'s cut and the mean of their targets', () => {
  assert.equal(SCORED_AREAS, 7);
  const o = overallOf(scoredRows({ governance: 56, compliance: 23, risk: 80, assessments: 62, assets: 90, issues: 70, assurance: 41 }));
  assert.equal(o.state, 'ready');
  assert.equal(o.score, Math.round((56 + 23 + 80 + 62 + 90 + 70 + 41) / 7));
  assert.equal(o.grade, 'fair');
  assert.equal(o.target, 85);
  assert.equal(o.shown, 7);
  assert.equal(o.of, 7);
  assert.equal(o.atTarget, 1, 'only the 90 reaches its target of 85');
  assert.deepEqual(o.leftOut, []);
  assert.equal(o.members.length, 7);
});

test('Overall readiness for a person who sees fewer areas says so: the same words, never a silently different number', () => {
  const few = overallOf(scoredRows({ governance: 60, compliance: 40, risk: 'denied', assessments: 'denied', assets: 'denied', issues: 'denied', assurance: 'denied' }));
  assert.equal(few.score, 50);
  assert.equal(few.shown, 2);
  assert.equal(few.of, 7);
  assert.equal(overallDefinition(few), 'The average of Governance and Compliance: 2 of 7 scored areas, each counting the same.');
  assert.equal(overallLeaves(few), 'you can open 2 of the 7 scored areas');
});

test('Overall readiness names what it leaves out: an area still loading or failed is not in the mean and is said', () => {
  const o = overallOf(scoredRows({ governance: 60, compliance: 'error', risk: 'loading', assessments: 40, assets: 'denied', issues: 'denied', assurance: 'denied' }));
  assert.equal(o.score, 50);
  assert.deepEqual(o.leftOut, ['Compliance', 'Risk Management']);
  assert.equal(overallLeaves(o), 'Compliance, Risk Management have not answered; you can open 4 of the 7 scored areas');
  assert.equal(overallLeaves(overallOf(scoredRows({ governance: 60, compliance: 'error', risk: 'denied', assessments: 'denied', assets: 'denied', issues: 'denied', assurance: 'denied' }))), 'Compliance has not answered; you can open 2 of the 7 scored areas');
});

test('Overall readiness: nothing yet is "loading" while a scored area is waiting and "none" when nothing can be averaged; no member, no number', () => {
  assert.equal(overallOf(scoredRows({ governance: 'loading' })).state, 'loading');
  assert.equal(overallOf(scoredRows({ governance: 'error' })).state, 'none');
  assert.equal(overallOf([]).state, 'none');
  assert.equal(overallOf([]).score, null);
  assert.equal(overallDefinition(overallOf([])), 'No scored area has answered yet.');
  const nullScore = overallOf(scoredRows({ governance: null, compliance: 30 }));
  assert.equal(nullScore.score, 30, 'an area with no score is not a zero in the mean');
  assert.equal(nullScore.members.length, 1);
});

test('Overall readiness has a target only when every member has one; no target means no "vs target", not 85', () => {
  const rows = [
    rowOf(area('governance'), { load: 'ready', data: card(60, [], { target: 85 }) }),
    rowOf(area('assets'), { load: 'ready', data: { performance: { score: 50, components: [] } } }),
  ];
  const o = overallOf(rows);
  assert.equal(o.target, null);
  assert.equal(o.atTarget, 0, 'the member without a target is not "at target"');
});

test('the definition lists the members\' names: all of them up to three, then two and a count', () => {
  const o = overallOf(scoredRows({ governance: 60, compliance: 40, risk: 50, assessments: 50, assets: 50, issues: 50, assurance: 50 }));
  assert.equal(overallDefinition(o), 'The average of Governance, Compliance and 5 more: 7 of 7 scored areas, each counting the same.');
  assert.equal(overallDefinition(overallOf(scoredRows({ governance: 60, compliance: 40, risk: 50 }))), 'The average of Governance, Compliance, Risk Management: 3 of 7 scored areas, each counting the same.');
});

test('the members of Overall readiness are in the order the areas are defined in, whatever order the rows are in', () => {
  const o = overallOf(orderRows(scoredRows({ governance: 90, compliance: 10, risk: 50 })));
  assert.deepEqual(o.members.map((m) => m.key), ['governance', 'compliance', 'risk']);
});

