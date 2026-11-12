// node --test "src/app/(dashboard)/issues/_overview/chartModel.test.ts"
// What the Issue & Incident Overview's charts draw: history derived from the dates the list carries (raised, closed, open at the end of each month), the rolling 30-day flows, "Closed on time",
// the parts of each card (severity, stage, age, impact by urgency, owners, sources, actions, incidents) and a card's state. A figure here is the figure the register's own chip keeps.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ageHeat, actionProgress, cardState, closedOnTime, flowOf, hueOfSeverity, incidentHistory, incidentSeverityParts, issueHistory, matrixHeat, monthSlots, openAt, oldSerious, ownerLoad, ownerPeople,
  seriousSplit, severityParts, sourceRank, stageParts, wholeParts, OWNER_SERIES, SEVERITY_HUE, STATE_HUE, ACTION_HUE,
} from './chartModel.ts';
import { ageMatrix } from './overviewModel.ts';
import { issueDef, type IssueRow } from '../../../../lib/issues/issueDef.ts';
import { actionDef, type ActionRow } from '../../../../lib/issues/actionDef.ts';
import { ACTION_STATUSES, ISSUE_SEVERITIES, ISSUE_STATES } from '../../../../lib/issues/words.ts';
import type { IncidentRow } from '../../erm/_monitoring/incidentModel.ts';

const NOW = new Date('2026-11-11T12:00:00Z');
const person = (id: number, name: string) => ({ id, display_name: name });
let n = 0;
const issue = (o: Partial<IssueRow> & { impact?: string | null; urgency?: string | null } = {}): IssueRow => { n += 1; return { id: n, title: `Issue ${n}`, severity: 'medium', workflow_state: 'in_progress', created_at: '2026-11-01T08:00:00', ...o } as IssueRow; };
const action = (o: Partial<ActionRow> = {}): ActionRow => { n += 1; return { id: n, issue_id: 100 + n, title: `Action ${n}`, status: 'planned', ...o }; };
const incident = (o: Partial<IncidentRow> = {}): IncidentRow => { n += 1; return { id: n, title: `Incident ${n}`, incident_date: '2026-10-01T00:00:00', severity: 'medium', status: 'open', ...o }; };

test('twelve calendar months, the last one being the month so far; the year shows where it changes', () => {
  const s = monthSlots(NOW);
  assert.equal(s.length, 12);
  assert.deepEqual([s[0].key, s[11].key], ['2025-12', '2026-11']);
  assert.deepEqual(s.map((x) => x.label), ['Dec 25', 'Jan 26', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov']);
  assert.equal(s[11].partial, true);
  assert.equal(s[11].end, NOW.getTime() + 1, 'the month so far ends at now');
  assert.equal(s[10].end, s[11].start, 'months are back to back');
  assert.equal(s.filter((x) => x.partial).length, 1);
});

test('raised and closed per month are exact counts of the two dates; open at the end of a month is raised by then and not yet closed', () => {
  const rows = [
    issue({ created_at: '2026-09-10T00:00:00', closed_at: '2026-10-05T00:00:00', workflow_state: 'closed' }),     // open at end of Sep, closed in Oct
    issue({ created_at: '2026-10-02T00:00:00', closed_at: '2026-10-20T00:00:00', workflow_state: 'closed' }),     // raised and closed in Oct
    issue({ created_at: '2026-10-15T00:00:00' }),                                                                   // still open
    issue({ created_at: '2026-11-03T00:00:00' }),                                                                   // raised this month
    issue({ created_at: '2026-11-04T00:00:00', closed_at: '2026-11-09T00:00:00', workflow_state: 'closed' }),     // raised and closed this month
  ];
  const h = issueHistory(rows, NOW);
  const at = (key: string) => h.slots.findIndex((s) => s.key === key);
  assert.deepEqual([h.raised[at('2026-09')], h.raised[at('2026-10')], h.raised[at('2026-11')]], [1, 2, 2]);
  assert.deepEqual([h.closed[at('2026-09')], h.closed[at('2026-10')], h.closed[at('2026-11')]], [0, 2, 1]);
  assert.deepEqual([h.open[at('2026-08')], h.open[at('2026-09')], h.open[at('2026-10')], h.open[at('2026-11')]], [0, 1, 1, 2], 'the month so far is read at now');
  assert.equal(h.open[11], rows.filter((r) => issueDef(null).quick[0].test(r, NOW)).length, 'the last point is the register\'s open count');
  assert.equal(h.unplaced, 0);
});

test('an issue with no date to place it is left out of the open history and counted: cancelled, closed with no closing date, or with no raised date', () => {
  const rows = [
    issue({ created_at: '2026-06-01T00:00:00', workflow_state: 'cancelled' }),
    issue({ created_at: '2026-06-01T00:00:00', workflow_state: 'closed', closed_at: null }),
    issue({ created_at: null }),
    issue({ created_at: '2026-06-01T00:00:00' }),
  ];
  const h = issueHistory(rows, NOW);
  assert.equal(h.unplaced, 3);
  assert.equal(h.open[11], 1);
  assert.equal(h.open[0], 0, 'nothing was raised yet in the first month shown');
  assert.equal(h.raised.reduce((a, b) => a + b, 0), 3, 'but the three that have a raised date are still raised');
});

test('a reopened issue (no closing date again) counts as open since it was raised', () => {
  assert.equal(openAt([issue({ created_at: '2026-03-01T00:00:00', workflow_state: 'in_progress', closed_at: null })], Date.UTC(2026, 4, 1)), 1);
});

test('the rolling flows compare the last 30 days with the 30 before them, by the two dates', () => {
  const rows = [
    issue({ created_at: '2026-11-10T00:00:00' }), issue({ created_at: '2026-10-20T00:00:00' }),                     // last 30 days
    issue({ created_at: '2026-10-01T00:00:00', closed_at: '2026-10-05T00:00:00', workflow_state: 'closed' }),       // 30 before: raised and closed
    issue({ created_at: '2026-01-01T00:00:00', closed_at: '2026-11-05T00:00:00', workflow_state: 'closed' }),       // closed in the last 30 days
  ];
  assert.deepEqual(flowOf(rows, NOW), { raised: { last: 2, before: 1 }, closed: { last: 1, before: 1 } });
});

test('"Closed on time" is the scorecard\'s: closed on or before the target, over the closed issues that had a target and a closing date', () => {
  const rows = [
    issue({ workflow_state: 'closed', closed_at: '2026-10-01T00:00:00', target_closure_date: '2026-10-05T00:00:00' }),          // on time
    issue({ workflow_state: 'closed', closed_at: '2026-10-10T00:00:00', target_closure_date: '2026-10-05T00:00:00' }),          // late
    issue({ workflow_state: 'closed', closed_at: '2026-10-10T00:00:00', target_closure_date: null }),                            // no target: not counted
    issue({ workflow_state: 'closed', closed_at: null, target_closure_date: '2026-10-05T00:00:00' }),                            // no closing date: not counted
    issue({ workflow_state: 'cancelled', closed_at: '2026-10-01T00:00:00', target_closure_date: '2026-10-05T00:00:00' }),     // cancelled: not closed
    issue({ workflow_state: 'in_progress', target_closure_date: '2026-10-05T00:00:00' }),
  ];
  assert.deepEqual(closedOnTime(rows), { onTime: 1, of: 2 });
  assert.deepEqual(closedOnTime([]), { onTime: 0, of: 0 });
});

test('the serious open issues split into critical and high', () => {
  assert.deepEqual(seriousSplit([issue({ severity: 'critical' }), issue({ severity: 'high' }), issue({ severity: 'high' }), issue({ severity: 'high', workflow_state: 'closed' }), issue({ severity: 'low' })]), { critical: 1, high: 2 });
});

test('severity parts: open issues only, worst first, a severity none has is left out, each opens the open issues of that severity', () => {
  const p = severityParts([issue({ severity: 'low' }), issue({ severity: 'critical' }), issue({ severity: 'low' }), issue({ severity: 'high', workflow_state: 'closed' }), issue({ severity: null })]);
  assert.deepEqual(p.map((x) => [x.key, x.value, x.hue]), [['critical', 1, 'bad'], ['low', 2, 'neutral'], ['none', 1, 'other']]);
  assert.equal(p[0].href, '/issues/register?quick=open&severity=critical');
  assert.equal(p[2].href, undefined, 'no severity has no filter to open');
  assert.equal(p[2].label, 'No severity');
});

test('every severity, state and action status has a hue (a word nobody listed is "other")', () => {
  ISSUE_SEVERITIES.forEach((s) => assert.ok(SEVERITY_HUE[s], s));
  ISSUE_STATES.forEach((s) => assert.ok(STATE_HUE[s], s));
  ACTION_STATUSES.forEach((s) => assert.ok(ACTION_HUE[s], s));
  assert.equal(hueOfSeverity('whatever'), 'other');
  assert.equal(hueOfSeverity(null), 'other');
});

test('the stages are the five open states in the life cycle\'s order with every one present, and the whole is open, closed and cancelled', () => {
  const rows = [issue({ workflow_state: 'triage' }), issue({ workflow_state: 'triage' }), issue({ workflow_state: 'closure_review' }), issue({ workflow_state: 'closed' }), issue({ workflow_state: 'cancelled' }), issue({ workflow_state: null })];
  const s = stageParts(rows);
  assert.deepEqual(s.map((x) => [x.key, x.value]), [['new', 1], ['triage', 2], ['in_progress', 0], ['resolution', 0], ['closure_review', 1]], 'a state with none is still a stage; no state is a new issue');
  assert.equal(s[1].href, '/issues/register?state=triage');
  assert.deepEqual(wholeParts(rows).map((x) => [x.key, x.value]), [['open', 4], ['closed', 1], ['cancelled', 1]]);
  assert.equal(wholeParts(rows).reduce((a, x) => a + x.value, 0), rows.length, 'every issue is in exactly one part');
});

test('the age heat is the age matrix as a grid, and only an old critical or high issue is a trouble cell', () => {
  const m = ageMatrix([issue({ severity: 'critical', created_at: '2026-01-01T00:00:00' }), issue({ severity: 'low', created_at: '2026-11-10T00:00:00' })], NOW);
  const h = ageHeat(m);
  assert.deepEqual(h.rows, ['Critical', 'Low']);
  assert.deepEqual(h.cells, [[0, 0, 0, 1], [1, 0, 0, 0]]);
  assert.equal(h.total, 2);
  assert.equal(oldSerious('critical', 3), true);
  assert.equal(oldSerious('high', 2), true);
  assert.equal(oldSerious('high', 1), false);
  assert.equal(oldSerious('medium', 3), false);
});

test('impact by urgency: open issues in the nine cells (high first), the unrated counted apart, the matrix\'s own severity per cell', () => {
  const rows = [
    issue({ impact: 'high', urgency: 'high' }), issue({ impact: 'HIGH', urgency: 'high' }), issue({ impact: 'low', urgency: 'medium' }),
    issue({ impact: null, urgency: 'high' }), issue({ impact: 'high', urgency: 'high', workflow_state: 'closed' }), issue({}),
  ];
  const m = matrixHeat(rows, [{ impact: 'high', urgency: 'high', severity: 'critical' }, { impact: 'low', urgency: 'medium', severity: 'low' }]);
  assert.deepEqual(m.cells, [[2, 0, 0], [0, 0, 0], [0, 1, 0]]);
  assert.deepEqual([m.placed, m.unrated], [3, 2]);
  assert.deepEqual([m.severity[0][0], m.severity[2][1], m.severity[1][1]], ['critical', 'low', null], 'a cell the matrix did not send has no severity');
  assert.deepEqual(m.rows, ['High impact', 'Medium impact', 'Low impact']);
  assert.deepEqual(m.cols, ['High', 'Medium', 'Low']);
  assert.equal(matrixHeat(rows, undefined).severity.flat().every((x) => x === null), true);
});

test('who holds them: the busiest people split by severity, then Unassigned (always its own row); never more than max + 1 rows', () => {
  const rows: IssueRow[] = [];
  const give = (id: number, name: string, count: number, severity = 'medium') => { for (let k = 0; k < count; k += 1) rows.push(issue({ assignee: person(id, name), severity })); };
  give(1, 'Ana', 5); give(2, 'Bo', 4, 'critical'); give(3, 'Cy', 3); give(4, 'Di', 2); give(5, 'Ed', 1);
  rows.push(issue({ assignee: null, severity: 'high' }), issue({ assignee: null }), issue({ assignee: person(1, 'Ana'), workflow_state: 'closed' }));
  const out = ownerLoad(rows, 3);
  assert.deepEqual(out.map((r) => [r.label, r.total]), [['Ana', 5], ['Bo', 4], ['Cy', 3], ['Unassigned', 2]]);
  assert.deepEqual(out[1].cells, { critical: 4 });
  assert.equal(out[0].href, '/issues/register?quick=open&assignee=1');
  assert.equal(out[3].href, '/issues/register?quick=open&assignee=none');
  assert.equal(ownerLoad(rows).length, 5, 'four people and Unassigned by default');
  assert.equal(ownerPeople(rows), 5, 'five people hold open issues (a closed one does not count a person twice)');
  assert.deepEqual(ownerLoad([]), []);
  assert.equal(ownerPeople([]), 0);
  OWNER_SERIES.forEach((s) => assert.ok(typeof s === 'string'));
});

test('a person nobody named is "User N"', () => {
  assert.equal(ownerLoad([issue({ assignee: { id: 9 } })])[0].label, 'User 9');
  assert.deepEqual(ownerLoad([issue({ assignee: null })]).map((r) => r.label), ['Unassigned']);
});

test('raised from: the biggest places with their serious ones, the tail as one "Other places" row, the folded total is the whole', () => {
  const rows: IssueRow[] = [];
  ['risk', 'risk', 'risk', 'asset', 'asset', 'audit', 'vulnerability', 'vendor_review', 'bcm_finding', 'kri_breach'].forEach((s, i) => rows.push(issue({ source_type: s, severity: i === 0 ? 'critical' : i === 1 ? 'high' : 'low' })));
  rows.push(issue({ source_type: 'risk', workflow_state: 'closed' }));
  const out = sourceRank(rows, 3);
  assert.deepEqual(out.map((r) => [r.key, r.value]), [['risk', 3], ['asset', 2], ['audit', 1], ['__other', 4]]);
  assert.equal(out[0].note, '1 critical, 1 high');
  assert.equal(out[1].note, undefined, 'a place with no serious issue says nothing');
  assert.equal(sourceRank([issue({ source_type: 'risk', severity: 'high' })])[0].note, '1 high', 'a zero is not said');
  assert.equal(out[0].href, '/issues/register?quick=open&source=risk');
  assert.equal(out[3].href, undefined);
  assert.equal(out.reduce((a, r) => a + r.value, 0), 10, 'the closed one is not counted');
  assert.equal(sourceRank(rows.slice(0, 4), 3).length, 2, 'two places stay two');
  assert.equal(sourceRank(rows, 8).some((r) => r.key === '__other'), false, 'a list that fits is not folded');
  assert.equal(sourceRank([issue({})])[0].label, 'Raised by hand', 'no source is a hand-raised issue');
});

test('actions completed is the scorecard\'s: completed or verified over every action but the cancelled, and late is the register\'s chip', () => {
  const rows = [
    action({ status: 'completed' }), action({ status: 'verified' }), action({ status: 'in_progress', due_date: '2026-11-01T00:00:00' }), action({ status: 'planned', due_date: '2026-12-01T00:00:00' }),
    action({ status: 'blocked', due_date: '2026-10-01T00:00:00' }), action({ status: 'cancelled', due_date: '2026-10-01T00:00:00' }), action({ status: 'completed', due_date: '2026-10-01T00:00:00' }),
  ];
  const p = actionProgress(rows, NOW);
  assert.deepEqual(p, { done: 3, live: 6, pct: 50, late: 2 });
  assert.equal(p.late, rows.filter((a) => actionDef(null).quick.find((q) => q.key === 'late')!.test(a, NOW)).length);
  assert.deepEqual(actionProgress([], NOW), { done: 0, live: 0, pct: null, late: 0 });
});

test('incidents reported by the incident date and resolved by the resolution date, per month; open ones by severity open the open incidents of that severity', () => {
  const rows = [
    incident({ incident_date: '2026-10-03T00:00:00', resolved_at: '2026-10-09T00:00:00', status: 'resolved' }),
    incident({ incident_date: '2026-10-20T00:00:00', resolved_at: '2026-11-02T00:00:00', status: 'closed' }),
    incident({ incident_date: '2026-11-05T00:00:00', severity: 'critical', status: 'investigating' }),
    incident({ incident_date: '2026-11-06T00:00:00', severity: 'low', status: 'mitigating' }),
  ];
  const h = incidentHistory(rows, NOW);
  assert.deepEqual([h.reported[10], h.reported[11], h.resolved[10], h.resolved[11]], [2, 2, 1, 1]);
  const p = incidentSeverityParts(rows);
  assert.deepEqual(p.map((x) => [x.key, x.value]), [['critical', 1], ['low', 1]]);
  assert.equal(p[0].href, '/erm/incidents?quick=open&severity=critical');
});

test('a card is loading, failed or empty before it is a chart, and a failed list is never an empty chart', () => {
  assert.equal(cardState({ state: 'loading' }, false), 'loading');
  assert.equal(cardState({ state: 'error' }, false), 'error');
  assert.equal(cardState({ state: 'error' }, true), 'error');
  assert.equal(cardState({ state: 'ready' }, false), 'empty');
  assert.equal(cardState({ state: 'ready' }, true), 'ready');
});
