// node --test "src/app/(dashboard)/dashboard/_overview/perfModel.test.ts"
// What the Performance Overview decides: the row of each area from the state of its request (a failure is never "no data" and never 0), the order of the table, the chips of the band,
// the weakest areas, and Overall readiness with the words that define it (the same words for everyone, the member list, what it leaves out).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AREAS, AREA_BY_KEY, type Area } from '../../../../lib/perf/moduleFeeds.ts';
import {
  SCORED_AREAS, againstTarget, attentionOf, belowTarget, failedRows, litCounters, orderRows, overallDefinition, overallLeaves, overallOf, retryable,
  rowOf, scoreLine, targetNote, vsTargetText, waitingOf, waitingText, weakestAreas, weakestThree, type AreaRow,
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
  assert.deepEqual(failedRows([rowOf(area('governance'), { load: 'error', error: err(500) }), rowOf(area('assets'), { load: 'error', error: err(403) }), ready('assets', card(1))]).map((r) => r.area.key), ['governance', 'assets']);
});

test('the table is ordered weakest first among the scored areas, then the areas with a headline, then the links', () => {
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

test('the target note says whose target it is: the organisation\'s, the default, or just the number; and when there is none', () => {
  const base = { score: 1, grade: null, sections: [], counters: [], headline: null };
  assert.equal(targetNote({ ...base, target: 70, customized: true }), 'Target 70, set by your organisation.');
  assert.equal(targetNote({ ...base, target: 85, customized: false }), 'Target 85, the default.');
  assert.equal(targetNote({ ...base, target: 85, customized: null }), 'Target 85.');
  assert.equal(targetNote({ ...base, target: null, customized: null }), 'No target is recorded for this area.');
});

test('what needs attention in a row: the most serious counter first, how many more, and "clear" only when every counter answered 0', () => {
  const g = ready('governance', card(50, [], {}, { overdue_reviews: 0, overdue_attestations: 4 })).read;
  assert.deepEqual(litCounters(g).map((c) => [c.key, c.value]), [['overdue_attestations', 4]]);
  const risk = ready('risk', card(50, [], {}, { critical_open_risks: 2, red_kris: 9 })).read;
  const a = attentionOf(risk);
  assert.equal(a.top?.key, 'red_kris', 'same tone: the bigger first');
  assert.equal(a.more, 1);
  assert.equal(a.clear, false);
  const none = attentionOf(ready('governance', card(50, [], {}, { overdue_reviews: 0, overdue_attestations: 0 })).read);
  assert.deepEqual([none.top, none.more, none.clear], [null, 0, true]);
  const dash = attentionOf(ready('governance', card(50)).read);
  assert.equal(dash.clear, false, 'counters the answer does not carry are not "nothing overdue"');
  assert.equal(attentionOf(null).top, null);
  const mixed = ready('compliance', card(50, [], {}, { controls_without_evidence: 3 })).read;
  assert.equal(attentionOf(mixed).top?.label, 'Controls without evidence');
});

test('below target: by the server\'s target, else below the line the server calls good (70)', () => {
  assert.equal(belowTarget(84, 85), true);
  assert.equal(belowTarget(85, 85), false);
  assert.equal(belowTarget(69, null), true);
  assert.equal(belowTarget(70, null), false);
});

test('the weakest areas: sections below their module\'s target, lowest first, ten at most, the true total; a module with no score of its own is left out; Compliance sections open their page', () => {
  const sections: Array<[string, number | null]> = Array.from({ length: 12 }, (_, i): [string, number | null] => [`Area ${i}`, i * 5]);
  const rows = [
    ready('governance', card(56, [['Attestations', 24], ['Documents', 71], ['Empty', null], ['Strong', 95]])),
    ready('assessments', card(null, [['Hidden', 1]])),
    ready('assets', card(40, sections)),
    ready('compliance', { performance: { score: 23, components: [{ key: 'evidence', label: 'Evidence', score: 3, target: 85 }] } }),
    rowOf(area('risk'), { load: 'error', error: err(500) }),
  ];
  const w = weakestAreas(rows);
  assert.equal(w.rows.length, 10);
  assert.deepEqual(w.rows.slice(0, 4).map((r) => [r.module, r.label, r.score]), [['IT Assets', 'Area 0', 0], ['IT Assets', 'Area 1', 5], ['Compliance', 'Evidence', 3], ['IT Assets', 'Area 2', 10]].sort((a, b) => (a[2] as number) - (b[2] as number)));
  assert.equal(w.total, 12 + 2 + 1, 'twelve of the assets, Attestations and Documents of governance, Evidence of compliance: Strong and the empty one are not below target');
  assert.ok(!w.rows.some((r) => r.label === 'Hidden' || r.label === 'Strong' || r.label === 'Empty'));
  assert.equal(w.rows.find((r) => r.label === 'Evidence')?.href, '/evidence', 'a Compliance area opens its own page');
  assert.equal(weakestAreas([ready('governance', card(56, [['Attestations', 24]]))]).rows[0].href, '/governance', 'the others open the area\'s Overview (sections have no address)');
  assert.equal(weakestAreas(rows, 3).rows.length, 3);
  assert.deepEqual(weakestAreas([]), { rows: [], total: 0 });
  assert.equal(weakestAreas([ready('governance', card(99, [['A', 90]]))]).total, 0);
  assert.equal(w.rows[0].grade, 'poor');
});

test('the three weakest sections of an area, with a score, lowest first', () => {
  const r = ready('governance', card(50, [['A', 90], ['B', null], ['C', 10], ['D', 40], ['E', 20]])).read;
  assert.deepEqual(weakestThree(r).map((s) => s.label), ['C', 'E', 'D']);
  assert.deepEqual(weakestThree(null), []);
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

test('the head says how many are waiting for the person in words, from the shared inbox\'s badge', () => {
  assert.equal(waitingText({ kind: 'count', n: 7 }), '7 waiting for you');
  assert.equal(waitingText({ kind: 'count', n: 1200 }), '1,200 waiting for you');
  assert.equal(waitingText({ kind: 'none' }), 'Nothing waiting for you');
  assert.equal(waitingText({ kind: 'loading' }), 'Needs my action');
  assert.equal(waitingText({ kind: 'unknown' }), 'Needs my action', 'a count that could not be made is not "nothing waiting"');
});

test('"waiting for you" is the decisions addressed to the person plus the documents to acknowledge, as the Needs my action page lists them; a source that has not answered adds a plus, never a false "nothing"', () => {
  const inbox = (kind: 'loading' | 'none' | 'unknown' | 'count', decision: number, acknowledgement: number) => ({ badge: { kind }, counts: { decision, acknowledgement } });
  assert.deepEqual(waitingOf(inbox('count', 3, 4)), { kind: 'count', n: 7, incomplete: false });
  assert.deepEqual(waitingOf(inbox('none', 0, 9)), { kind: 'count', n: 9, incomplete: false }, 'nine acknowledgements wait although nothing is to decide');
  assert.deepEqual(waitingOf(inbox('none', 0, 0)), { kind: 'none' });
  assert.deepEqual(waitingOf(inbox('loading', 0, 0)), { kind: 'loading' });
  assert.deepEqual(waitingOf(inbox('unknown', 0, 0)), { kind: 'unknown' });
  assert.deepEqual(waitingOf(inbox('loading', 2, 0)), { kind: 'count', n: 2, incomplete: true });
  assert.equal(waitingText(waitingOf(inbox('loading', 2, 0))), '2+ waiting for you');
  assert.equal(waitingText(waitingOf(inbox('none', 0, 9))), '9 waiting for you');
});

test('the members of Overall readiness are in the order the areas are defined in, whatever order the rows are in', () => {
  const o = overallOf(orderRows(scoredRows({ governance: 90, compliance: 10, risk: 50 })));
  assert.deepEqual(o.members.map((m) => m.key), ['governance', 'compliance', 'risk']);
});

test('a phone card says the score in one line: the number, its grade word and its distance to the target; the other states in words', () => {
  assert.equal(scoreLine(ready('governance', card(31, [], { target: 85 }))), '31 · Poor · 54 below target');
  assert.equal(scoreLine(ready('governance', card(90, [], { target: 85 }))), '90 · Excellent · 5 above target');
  assert.equal(scoreLine(ready('governance', card(85, [], { target: 85 }))), '85 · Excellent · On target');
  assert.equal(scoreLine(ready('governance', card(60))), '60 · Fair', 'no target recorded: no distance');
  assert.equal(scoreLine(ready('governance', card(null))), 'No score yet');
  assert.equal(scoreLine(ready('tasks', { total: 1 })), 'Not scored');
  assert.equal(scoreLine(rowOf(area('cyber'), undefined)), 'Not scored');
  assert.equal(scoreLine(rowOf(area('governance'), { load: 'loading' })), 'Loading');
  assert.equal(scoreLine(rowOf(area('governance'), { load: 'error', error: err(500) })), 'Could not be read');
  assert.equal(scoreLine(rowOf(area('governance'), { load: 'error', error: err(403) })), 'No access');
});
