// node --test "src/app/(dashboard)/issues/_overview/overviewModel.test.ts"
// The Issue & Incident Overview's decisions: a counter is the number of rows the register's own chip keeps (one definition of open / late / critical / awaiting closure), a failed or loading feed
// is never 0, "Needs attention" counts each record once, the work list holds only what is the person's and offers only the steps the server lets them take, the breakdowns and the score's words.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COUNTER_DEFS, URGENCY_LABEL, ageMatrix, actionSlices, assigneeSlices, buildWork, closingRows, countersOf, gradeOf, groupWork, needsAttention, postureOf, reopenLine, sectionRows,
  severitySlices, sourceSlices, trend12w, urgencyOf, type Feeds,
} from './overviewModel.ts';
import { issueDef, type IssueRow } from '../../../../lib/issues/issueDef.ts';
import { actionDef, type ActionRow } from '../../../../lib/issues/actionDef.ts';
import { incidentDef, type IncidentRow } from '../../erm/_monitoring/incidentModel.ts';
import { gradeOf as feedsGradeOf } from '../../../../lib/perf/moduleFeeds.ts';
import { gradeStatus } from '../../../../lib/statuses/dashboard.ts';

const NOW = new Date('2026-11-08T12:00:00Z');
const ME = 7;
const person = (id: number, name: string) => ({ id, display_name: name });
let n = 0;
const issue = (o: Partial<IssueRow> = {}): IssueRow => { n += 1; return { id: n, title: `Issue ${n}`, severity: 'medium', workflow_state: 'in_progress', created_at: '2026-11-01T08:00:00', ...o }; };
const action = (o: Partial<ActionRow> = {}): ActionRow => { n += 1; return { id: n, issue_id: 100 + n, issue_code: `ISS-${100 + n}`, issue_title: 'An issue', title: `Action ${n}`, status: 'planned', ...o }; };
const incident = (o: Partial<IncidentRow> = {}): IncidentRow => { n += 1; return { id: n, title: `Incident ${n}`, incident_date: '2026-10-01T00:00:00', severity: 'medium', status: 'open', ...o }; };
function ready<T>(rows: T[]) { return { state: 'ready' as const, rows }; }

const ISSUES = [
  issue({ severity: 'critical', target_closure_date: '2026-11-05T00:00:00', assignee: person(ME, 'Me') }),                   // late, critical, mine
  issue({ severity: 'high', workflow_state: 'closure_review', assignee: person(3, 'Bo') }),                                  // high, awaiting closure
  issue({ severity: 'low', workflow_state: 'new' }),                                                                          // unassigned
  issue({ severity: 'medium', workflow_state: 'closed', closed_at: '2026-11-03T00:00:00', target_closure_date: '2026-10-01T00:00:00' }),   // closed: nothing
  issue({ severity: 'high', workflow_state: 'cancelled', target_closure_date: '2026-10-01T00:00:00' }),                      // cancelled: nothing
  issue({ severity: 'medium', target_closure_date: '2026-12-30T00:00:00', assignee: person(3, 'Bo') }),                      // open, fine
];
const ACTIONS = [
  action({ status: 'in_progress', due_date: '2026-11-01T00:00:00', assignee_id: ME, assignee_name: 'Me' }),                  // late, mine
  action({ status: 'completed', due_date: '2026-11-01T00:00:00' }),                                                          // done: not late
  action({ status: 'planned', due_date: '2026-12-01T00:00:00', assignee_id: ME, linked_critical_task_id: 4 }),               // managed in tasks
];
const INCIDENTS = [
  incident({ severity: 'critical', status: 'investigating', assigned_to: ME }),
  incident({ severity: 'low', status: 'open' }),
  incident({ severity: 'critical', status: 'resolved' }),
];
const FEEDS: Feeds = { issues: ready(ISSUES), actions: ready(ACTIONS), incidents: ready(INCIDENTS) };
const value = (feeds: Feeds, key: string) => countersOf(feeds, NOW).find((c) => c.key === key)?.value;

test('every counter opens a chip that exists in its register, by the address that register reads', () => {
  const chips = { issues: issueDef(null).quick.map((q) => q.key), actions: actionDef(null).quick.map((q) => q.key), incidents: incidentDef(null).quick.map((q) => q.key) };
  const base = { issues: '/issues/register', actions: '/issues/actions', incidents: '/erm/incidents' };
  for (const d of COUNTER_DEFS) {
    assert.ok(chips[d.feed].includes(d.chip), `${d.key}: the ${d.feed} register has no chip "${d.chip}"`);
    assert.equal(d.href, `${base[d.feed]}?quick=${d.chip}`, d.key);
  }
  assert.equal(new Set(COUNTER_DEFS.map((d) => d.key)).size, COUNTER_DEFS.length);
});

test('a counter is the number of rows the register\'s own chip keeps, at the same instant', () => {
  const kept = (q: string) => ISSUES.filter((i) => issueDef(null).quick.find((c) => c.key === q)!.test(i, NOW)).length;
  for (const [key, chip] of [['late', 'late'], ['serious', 'serious'], ['closing', 'closing'], ['unassigned', 'unassigned'], ['open', 'open']]) assert.equal(value(FEEDS, key), kept(chip), key);
  assert.deepEqual([value(FEEDS, 'open'), value(FEEDS, 'late'), value(FEEDS, 'serious'), value(FEEDS, 'closing'), value(FEEDS, 'unassigned')], [4, 1, 2, 1, 1]);
  assert.equal(value(FEEDS, 'actions_late'), 1, 'a completed action past its date is not late');
  assert.equal(value(FEEDS, 'incidents_open'), 2, 'resolved is not open');
  assert.equal(value(FEEDS, 'incidents_severe'), 1);
});

test('closure review is open (five states) and a closed or cancelled issue is nothing', () => {
  assert.equal(value({ ...FEEDS, issues: ready([issue({ workflow_state: 'closure_review' }), issue({ workflow_state: 'closed' }), issue({ workflow_state: 'cancelled' })]) }, 'open'), 1);
});

test('a loading or failed feed has no number (never 0); a person without incidents sees no incident counter', () => {
  const failed = countersOf({ ...FEEDS, issues: { state: 'error', rows: [] } }, NOW);
  assert.deepEqual(failed.filter((c) => c.feed === 'issues').map((c) => [c.state, c.value]), COUNTER_DEFS.filter((d) => d.feed === 'issues').map(() => ['error', undefined]));
  assert.ok(failed.filter((c) => c.feed !== 'issues').every((c) => c.state === 'ready' && typeof c.value === 'number'), 'the other feeds still count');
  assert.ok(countersOf({ ...FEEDS, actions: { state: 'loading', rows: [] } }, NOW).filter((c) => c.feed === 'actions').every((c) => c.state === 'loading' && c.value === undefined));
  const noIncidents = countersOf({ ...FEEDS, incidents: null }, NOW);
  assert.ok(noIncidents.every((c) => c.feed !== 'incidents'));
  assert.equal(needsAttention({ ...FEEDS, incidents: null }, NOW), 3 + 1, 'the incidents of a person who may not read them are not in the total');
});

test('"Needs attention" counts each record once, and is unknown while a feed is loading or failed', () => {
  // issues: #1 (late, critical), #2 (high, closing), #3 (unassigned) = 3 records though they match 5 chips; one late action; one critical open incident
  assert.equal(needsAttention(FEEDS, NOW), 3 + 1 + 1);
  const chipSum = countersOf(FEEDS, NOW).filter((c) => c.attention).reduce((a, c) => a + (c.value ?? 0), 0);
  assert.ok(chipSum > 3 + 1 + 1, `the chips add up to ${chipSum}: the same issue is in several`);
  assert.equal(needsAttention({ ...FEEDS, incidents: { state: 'error', rows: [] } }, NOW), null);
  assert.equal(needsAttention({ ...FEEDS, issues: { state: 'loading', rows: [] } }, NOW), null);
});

// ── the work list ──
const work = (over: Record<string, unknown> = {}) => buildWork({ me: ME, now: NOW, canEdit: true, issues: ISSUES, actions: ACTIONS, incidents: INCIDENTS, ...over } as never);

test('the work list is the person\'s own: their issues, their actions, their incidents, and (editors) the other issues waiting for a closure approval', () => {
  assert.deepEqual(work().map((w) => w.kind).sort(), ['action', 'action', 'approve', 'incident', 'issue']);
  assert.deepEqual(work({ canEdit: false }).map((w) => w.kind).sort(), ['action', 'action', 'incident', 'issue'], 'a person who may not edit is not asked to approve');
  assert.deepEqual(work({ me: null }), []);
  assert.deepEqual(work({ me: 999 }).map((w) => w.kind), ['approve'], 'nothing is theirs, but an editor still sees what waits for approval');
});

test('the row\'s one button is the expected next step, only for people who may take it; otherwise it opens the record', () => {
  const mine = work().find((w) => w.key === `issue-${ISSUES[0].id}`)!;
  assert.deepEqual([mine.act.type, mine.act.type === 'issue-step' ? mine.act.step.label : ''], ['issue-step', 'Move to resolution']);
  const approve = work().find((w) => w.kind === 'approve')!;
  assert.deepEqual([approve.act.type, approve.act.type === 'issue-step' ? approve.act.step.kind : ''], ['issue-step', 'close'], 'approving a closure asks for its notes');
  const viewer = work({ canEdit: false }).find((w) => w.key === `issue-${ISSUES[0].id}`)!;
  assert.deepEqual(viewer.act, { type: 'link', label: 'Open', href: `/issues/${ISSUES[0].id}` });
  const managed = work().find((w) => w.key === `action-${ACTIONS[2].id}`)!;
  assert.equal(managed.act.type, 'link', 'an action that became a task is run from Task Management');
  assert.match(managed.context, /Managed in Tasks/);
  const step = work().find((w) => w.key === `action-${ACTIONS[0].id}`)!;
  assert.deepEqual([step.act.type, step.act.type === 'action-step' ? step.act.step.label : ''], ['action-step', 'Mark completed']);
  const inc = work().find((w) => w.kind === 'incident')!;
  assert.deepEqual(inc.act, { type: 'link', label: 'Open', href: `/erm/incidents?id=${INCIDENTS[0].id}` });
});

test('most urgent first: overdue (oldest date first), this week, then the rest by severity; the groups say which', () => {
  const rows = [
    issue({ title: 'todo high', severity: 'high', assignee: person(ME, 'Me'), target_closure_date: '2027-03-01T00:00:00' }),
    issue({ title: 'late recent', severity: 'low', assignee: person(ME, 'Me'), target_closure_date: '2026-11-07T00:00:00' }),
    issue({ title: 'late old', severity: 'low', assignee: person(ME, 'Me'), target_closure_date: '2026-10-01T00:00:00' }),
    issue({ title: 'this week', severity: 'low', assignee: person(ME, 'Me'), target_closure_date: '2026-11-12T00:00:00' }),
    issue({ title: 'todo critical, no date', severity: 'critical', assignee: person(ME, 'Me') }),
  ];
  const sorted = buildWork({ me: ME, now: NOW, canEdit: true, issues: rows, actions: [], incidents: [] });
  assert.deepEqual(sorted.map((w) => w.title), ['late old', 'late recent', 'this week', 'todo critical, no date', 'todo high']);
  assert.deepEqual(groupWork(sorted, NOW, 10).map((g) => [g.group, g.items.length]), [['overdue', 2], ['week', 1], ['todo', 2]]);
  assert.deepEqual(groupWork(sorted, NOW, 3).map((g) => g.items.length), [2, 1], 'the limit cuts the list, not a group header');
  assert.equal(urgencyOf({ due: null, overdue: false }, NOW), 'todo');
  assert.deepEqual(Object.values(URGENCY_LABEL), ['Overdue', 'This week', 'To do']);
});

// ── the breakdowns ──
test('open issues by severity, source and assignee open the register filtered by the same value', () => {
  const sev = severitySlices(ISSUES);
  assert.deepEqual(sev.map((s) => [s.key, s.total]), [['critical', 1], ['high', 1], ['medium', 1], ['low', 1]], 'closed and cancelled are not counted');
  assert.equal(sev[0].href, '/issues/register?quick=open&severity=critical');
  const src = sourceSlices([issue({ source_type: 'risk' }), issue({ source_type: 'risk' }), issue({}), issue({ workflow_state: 'closed', source_type: 'asset' })]);
  assert.deepEqual(src.map((s) => [s.key, s.total, s.label]), [['risk', 2, 'Risk'], ['manual', 1, 'Raised by hand']]);
  assert.equal(src[0].href, '/issues/register?quick=open&source=risk');
  const who = assigneeSlices(ISSUES);
  assert.deepEqual(who.map((s) => [s.key, s.label, s.total]), [['3', 'Bo', 2], ['7', 'Me', 1], ['none', 'Unassigned', 1]]);
  assert.equal(who[2].href, '/issues/register?quick=open&assignee=none');
  assert.equal(who[2].tone, 'warning');
});

test('corrective actions by status keep the order of their life and open the actions register on that status', () => {
  const s = actionSlices([action({ status: 'completed' }), action({ status: 'planned' }), action({ status: 'planned' }), action({})]);
  assert.deepEqual(s.map((x) => [x.key, x.total]), [['planned', 3], ['completed', 1]]);
  assert.equal(s[0].href, '/issues/actions?status=planned');
});

test('open by severity and age: five columns of days, the rows with none left out, an issue with no raised date is not placed', () => {
  const m = ageMatrix([
    issue({ severity: 'critical', created_at: '2026-11-07T00:00:00' }), issue({ severity: 'critical', created_at: '2026-10-20T00:00:00' }), issue({ severity: 'critical', created_at: '2026-01-01T00:00:00' }),
    issue({ severity: 'low', created_at: '2026-10-01T00:00:00' }), issue({ severity: 'low', created_at: null }), issue({ severity: 'high', workflow_state: 'closed' }),
  ], NOW);
  assert.deepEqual(m.rows.map((r) => [r.severity, r.cells, r.total]), [['critical', [1, 1, 0, 1], 3], ['low', [0, 0, 1, 0], 1]]);
  assert.deepEqual(m.totals, [1, 1, 1, 1]);
  assert.equal(m.total, 4);
});

test('twelve weeks of raised and closed, Monday to Sunday', () => {
  const rows = [
    issue({ created_at: '2026-11-08T09:00:00' }),                      // Sunday of the week starting Mon 2 Nov
    issue({ created_at: '2026-11-02T00:00:00', closed_at: '2026-11-04T10:00:00', workflow_state: 'closed' }),
    issue({ created_at: '2026-10-26T23:59:59' }),                      // the Monday before ends at 00:00 of 2 Nov
    issue({ created_at: '2025-01-01T00:00:00' }),                      // long ago: in no week
  ];
  const t = trend12w(rows, NOW);
  assert.equal(t.length, 12);
  assert.equal(t[11].start, '2026-11-02');
  assert.deepEqual([t[11].opened, t[11].closed], [2, 1]);
  assert.deepEqual([t[10].start, t[10].opened, t[10].closed], ['2026-10-26', 1, 0]);
  assert.equal(t[0].start, '2026-08-17');
  assert.equal(t[11].label, '2 Nov');
});

test('how well issues close: the severities that have closed issues, with their n, and the reopen line', () => {
  const agg = {
    mttr_by_severity: [{ severity: 'critical', count: 3, mean_days: 4.5 }, { severity: 'high', count: 0, mean_days: null }, { severity: 'medium', count: 5, mean_days: 12 }],
    sla_compliance_by_severity: [{ severity: 'critical', count: 4, compliant_pct: 75 }, { severity: 'high', count: 0, compliant_pct: null }, { severity: 'low', count: 2, compliant_pct: 100 }],
    reopen_stats: { reopen_count: 2, closed_total: 40, reopen_rate_pct: 5 },
  };
  assert.deepEqual(closingRows(agg).map((r) => [r.severity, r.closed, r.meanDays, r.onTimePct, r.onTimeOf]), [['critical', 3, 4.5, 75, 4], ['medium', 5, 12, null, 0], ['low', 0, null, 100, 2]]);
  assert.deepEqual(closingRows(undefined), []);
  assert.equal(reopenLine(agg.reopen_stats), '2 reopenings on 40 closed issues (5%)');
  assert.equal(reopenLine({ reopen_count: 1, closed_total: 1, reopen_rate_pct: 100 }), '1 reopening on 1 closed issue (100%)');
  assert.equal(reopenLine({ closed_total: 0 }), null);
});

// ── the score ──
test('the grade is the server\'s one cut (85 / 70 / 50), the same as the Performance Overview prints, in the same words', () => {
  for (let s = 0; s <= 100; s += 1) assert.equal(gradeOf(s), feedsGradeOf(s), `score ${s}`);
  assert.equal(gradeOf(null), null);
  for (const g of ['excellent', 'good', 'fair', 'poor']) assert.ok(gradeStatus.has(g), g);
});

test('the module score is the server\'s: its grade when it sent one, its target (never a made-up 85), customised when it says so', () => {
  assert.deepEqual(postureOf(undefined), { score: null, grade: null, target: null, customized: false });
  assert.deepEqual(postureOf({ performance: { score: 78.4, grade: 'good' }, target: 90, customized: true }), { score: 78, grade: 'good', target: 90, customized: true });
  assert.equal(postureOf({ performance: { score: 91.2 } }).grade, 'excellent', 'a payload with no grade gets the same cut');
  assert.equal(postureOf({ performance: { score: 40, grade: 'poor', components: [{ target: 70 }] } }).target, 70, 'the tuned target every component carries, when the payload has no top-level one');
  assert.equal(postureOf({ performance: { score: 40 } }).target, null);
  assert.equal(postureOf({ performance: { score: null, grade: 'good' } }).grade, null, 'no score, no grade');
});

test('the three sections come in the module\'s order with their own grade, and a section the answer lacks is left out', () => {
  const p = { sections: {
    corrective_actions: { key: 'corrective_actions', label: 'Corrective Actions', weight: 0.25, score: 79 },
    issues: { key: 'issues', label: 'Issues', weight: 0.4, score: 48.2 },
    incidents: { key: 'incidents', label: 'Incidents', weight: 0.35, score: null },
  } };
  assert.deepEqual(sectionRows(p).map((s) => [s.key, s.grade]), [['issues', 'poor'], ['incidents', null], ['corrective_actions', 'good']]);
  assert.deepEqual(sectionRows({ sections: { issues: p.sections.issues } }).map((s) => s.key), ['issues']);
  assert.deepEqual(sectionRows(undefined), []);
});
