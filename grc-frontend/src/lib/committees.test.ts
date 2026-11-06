// node --test "src/lib/committees.test.ts"
// What the committee pages may claim about the numbers the server sends (Not recorded, counts of a capped list), the overdue test, the address of Oversight
// Actions, the tabs of a committee, the questions asked before a removal, and how a meeting's time and an action's due date read in two time zones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import {
  ACTION_TYPES, COMMITTEE_TABS, DEFAULT_COMMITTEE_TAB, NOT_RECORDED, actionListParams, actionTypeLabel, actionsDoneReading, attendanceReading, attendanceWhy,
  committeeTypeLabel, cutNotice, deleteCommitteePlan, formChanged, gradeTone, isOverdueAction, listOf, matchesCommittee, measureHasData, measureReason, meetingsHeldReading,
  overdueFromSearch, overdueReading, performanceReading, removeMemberPlan, slaPill, upcomingMeetings,
  type OverviewKpis, type OverviewMetric, type SlaLike,
} from './committees.ts';
import { resolveTab } from './tabsModel.ts';

const metric = (key: string, label: string, score: number | null, numerator: number, denominator: number): OverviewMetric => ({
  key, label, weight: 0.2, score, numerator, denominator, formula: `${key} formula`, target: 85,
});

// What the scratch tenant sends today: five committees, ten open actions (two late), no meeting marked completed.
const SCRATCH: OverviewKpis = {
  total_committees: 5, active_committees: 5, meetings_upcoming: 5, meetings_completed: 0, meetings_this_quarter: 10,
  actions: { open: 10, in_progress: 0, overdue: 2, completed: 0, total: 10, pct_done: 0 },
  avg_attendance_pct: null, quorum_met: 0, quorum_meetings: 0, quorum_met_rate_pct: null, charters_active: 0,
  performance: {
    score: 62.9, grade: 'fair',
    metrics: [
      metric('action_health', 'Action health', 80, 2, 10),
      metric('action_completion', 'Actions completed', 0, 0, 10),
      metric('meeting_cadence', 'Meeting cadence', 100, 5, 5),
      metric('minutes_discipline', 'Minutes recorded', null, 0, 0),
      metric('quorum_rate', 'Quorum met', null, 0, 0),
    ],
  },
};
// A tenant that has committees and nothing else.
const BARE: OverviewKpis = {
  ...SCRATCH, meetings_upcoming: 0, meetings_this_quarter: 0,
  actions: { open: 0, in_progress: 0, overdue: 0, completed: 0, total: 0, pct_done: 0 },
  performance: {
    score: 60, grade: 'fair',
    metrics: [
      metric('action_health', 'Action health', 100, 0, 0),             // the server's default when nothing is open
      metric('action_completion', 'Actions completed', null, 0, 0),
      metric('meeting_cadence', 'Meeting cadence', 0, 0, 5),
      metric('minutes_discipline', 'Minutes recorded', null, 0, 0),
      metric('quorum_rate', 'Quorum met', null, 0, 0),
    ],
  },
};

// ── Not recorded ─────────────────────────────────────────────────────────────
test('the word is "Not recorded"', () => {
  assert.equal(NOT_RECORDED, 'Not recorded');
});

test('attendance is not recorded while no held meeting has quorum data, and the reason comes from the counts the API sent', () => {
  const r = attendanceReading(SCRATCH);
  assert.equal(r.value, null);
  assert.match(r.why, /^No meeting has been marked completed\./);
  assert.match(r.why, /cannot mark a meeting completed or record who attended yet/);
  // some meetings are completed but none has attendance: a different reason, with the count
  const some = { ...SCRATCH, meetings_completed: 3 };
  assert.match(attendanceWhy(some), /^3 meetings marked completed, none with quorum and attendance recorded\./);
  assert.match(attendanceWhy({ ...SCRATCH, meetings_completed: 1 }), /^1 meeting marked completed, none/);
});

test('attendance with data is a rounded percent, with the quorum line only when quorum was counted', () => {
  assert.deepEqual(attendanceReading({ ...SCRATCH, meetings_completed: 4, avg_attendance_pct: 71.4, quorum_met: 2, quorum_meetings: 3 }),
    { value: '71%', why: '', note: 'Quorum met in 2 of 3' });
  assert.deepEqual(attendanceReading({ ...SCRATCH, meetings_completed: 4, avg_attendance_pct: 100, quorum_met: 0, quorum_meetings: 0 }),
    { value: '100%', why: '', note: '' });
  // a measured 0% is a measurement, not "Not recorded"
  assert.equal(attendanceReading({ ...SCRATCH, meetings_completed: 2, avg_attendance_pct: 0, quorum_meetings: 2 }).value, '0%');
});

test('"Actions done" and "Overdue" are not recorded when there is no action at all, never 0% or 0', () => {
  for (const read of [actionsDoneReading, overdueReading]) {
    const r = read(BARE);
    assert.equal(r.value, null);
    assert.equal(r.why, 'No oversight action has been recorded yet.');
  }
});

test('"Actions done" and "Overdue" with actions are real numbers, and 0 completed of 10 is a measurement', () => {
  assert.deepEqual(actionsDoneReading(SCRATCH), { value: '0%', why: '', note: '0 of 10 done' });
  assert.deepEqual(overdueReading(SCRATCH), { value: '2', why: '', note: '10 actions still open' });
  assert.equal(overdueReading({ ...SCRATCH, actions: { ...SCRATCH.actions, open: 1, in_progress: 0, overdue: 0, total: 1 } }).note, '1 action still open');
  assert.equal(actionsDoneReading({ ...SCRATCH, actions: { open: 1, in_progress: 1, overdue: 0, completed: 2, total: 4, pct_done: 50 } }).value, '50%');
  assert.equal(actionsDoneReading({ ...SCRATCH, actions: { open: 0, in_progress: 0, overdue: 0, completed: 1234, total: 1234, pct_done: 100 } }).note, '1,234 of 1,234 done');
});

test('a measure has data when the server scored it from at least one record', () => {
  assert.equal(measureHasData(metric('a', 'A', 80, 2, 10)), true);
  assert.equal(measureHasData(metric('a', 'A', 0, 0, 10)), true);                  // 0 of 10 is a score
  assert.equal(measureHasData(metric('a', 'A', null, 0, 0)), false);
  assert.equal(measureHasData(metric('action_health', 'Action health', 100, 0, 0)), false);   // 100 by default, nothing behind it
});

test('the performance score is the server\'s, said as far as the data goes', () => {
  const p = performanceReading(SCRATCH.performance);
  assert.equal(p.score, 62.9);
  assert.equal(p.grade, 'fair');
  assert.equal(p.withData, 3);
  assert.equal(p.total, 5);
  assert.equal(p.note, '3 of 5 measures have data');
  assert.deepEqual(p.left.map((m) => m.key), ['minutes_discipline', 'quorum_rate']);
  assert.match(p.why, /Minutes recorded: No meeting has been marked completed in the last 180 days\./);
  assert.match(p.why, /Quorum met: No completed meeting has quorum and attendance recorded\./);
});

test('a score that rests on a default says so: no open action counts as 100%, it is not measured', () => {
  const p = performanceReading(BARE.performance);
  assert.equal(p.score, 60);                                                       // the server's number is kept
  assert.equal(p.withData, 1);                                                     // only the cadence has a record behind it
  assert.equal(p.note, '1 of 5 measures have data');
  assert.match(p.why, /Action health: No action is open, so it counts as 100% instead of being measured\./);
});

test('with every measure scored there is no note, and with none the score is not recorded', () => {
  const full = { score: 88, grade: 'excellent', metrics: ['a', 'b', 'c', 'd', 'e'].map((k) => metric(k, k.toUpperCase(), 88, 8, 9)) };
  assert.equal(performanceReading(full).note, '');
  assert.equal(performanceReading(full).why, '');
  const none = performanceReading({ score: 100, grade: 'excellent', metrics: [metric('action_health', 'Action health', 100, 0, 0), metric('x', 'X', null, 0, 0)] });
  assert.equal(none.score, null);
  assert.equal(none.why, 'None of the five measures has data yet.');
  assert.equal(performanceReading(undefined).score, null);
  assert.equal(performanceReading({ score: null, grade: null, metrics: [] }).score, null);
});

test('the grade of the score has a tone, and a grade nobody knows is neutral', () => {
  assert.deepEqual(['excellent', 'good', 'fair', 'poor', 'Fair', 'weird', '', null, undefined].map(gradeTone),
    ['success', 'success', 'warning', 'danger', 'warning', 'neutral', 'neutral', 'neutral', 'neutral']);
});

test('every measure has a reason in words, and an unknown one still has one', () => {
  for (const key of ['action_health', 'action_completion', 'meeting_cadence', 'minutes_discipline', 'quorum_rate']) {
    assert.ok(measureReason(metric(key, key, null, 0, 0)).length > 20, key);
  }
  assert.equal(measureReason(metric('something_new', 'New', null, 0, 0)), 'No records in this area yet.');
});

test('the "Meetings held" line of the chart is left out while no meeting is completed, with the reason', () => {
  assert.equal(meetingsHeldReading(SCRATCH).recorded, false);
  assert.match(meetingsHeldReading(SCRATCH).why, /^No meeting has been marked completed\./);
  assert.deepEqual(meetingsHeldReading({ ...SCRATCH, meetings_completed: 2 }), { recorded: true, why: '' });
});

// ── counts from a capped list ───────────────────────────────────────────────
test('a cut list says how many of how many, from the API\'s total, and says nothing when all is there', () => {
  assert.equal(cutNotice({ shown: 100, total: 300, noun: 'actions' }), 'Showing the first 100 of 300 actions.');
  assert.equal(cutNotice({ shown: 100, total: 1234, noun: 'actions' }), 'Showing the first 100 of 1,234 actions.');
  assert.equal(cutNotice({ shown: 100, total: 100, noun: 'actions' }), '');
  assert.equal(cutNotice({ shown: 12, total: 12, noun: 'meetings' }), '');
  assert.equal(cutNotice({ shown: 100, total: null, noun: 'actions' }), '');          // an unknown total is not invented
  assert.equal(cutNotice({ shown: 100, total: undefined, noun: 'actions' }), '');
});

test('a list payload is { items, total } or a bare array, and the total is never smaller than what came back', () => {
  assert.deepEqual(listOf<number>({ items: [1, 2], total: 300 }), { items: [1, 2], total: 300 });
  assert.deepEqual(listOf<number>([1, 2, 3]), { items: [1, 2, 3], total: 3 });
  assert.deepEqual(listOf<number>({ items: [1, 2], total: 1 }), { items: [1, 2], total: 2 });
  assert.deepEqual(listOf<number>({ items: [1] }), { items: [1], total: 1 });
  assert.deepEqual(listOf<number>(null), { items: [], total: 0 });
  assert.deepEqual(listOf<number>({ items: 'x', total: 'y' }), { items: [], total: 0 });
});

// ── oversight actions ───────────────────────────────────────────────────────
test('an action is overdue as the API means it: is_overdue, or a stored "overdue"; a status of "open" alone is not', () => {
  assert.equal(isOverdueAction({ status: 'open', is_overdue: true }), true);
  assert.equal(isOverdueAction({ status: 'in_progress', is_overdue: true }), true);
  assert.equal(isOverdueAction({ status: 'overdue' }), true);
  assert.equal(isOverdueAction({ status: 'open', is_overdue: false }), false);
  assert.equal(isOverdueAction({ status: 'open' }), false);
  assert.equal(isOverdueAction({ status: 'completed', is_overdue: false }), false);
});

test('the address ?overdue=1 opens Oversight Actions on the overdue ones; anything else does not', () => {
  assert.equal(overdueFromSearch('?overdue=1'), true);
  assert.equal(overdueFromSearch('overdue=1'), true);
  assert.equal(overdueFromSearch('?foo=bar&overdue=1'), true);
  assert.equal(overdueFromSearch(''), false);
  assert.equal(overdueFromSearch('?overdue=0'), false);
  assert.equal(overdueFromSearch('?overdue='), false);
  assert.equal(overdueFromSearch('?committee=3'), false);
});

test('the request of the first page is exactly what the page has always sent; filters travel as before', () => {
  assert.deepEqual(actionListParams({ status: '', committee: '', overdueOnly: false }),
    { status: undefined, committee_id: undefined, overdue_only: undefined });
  // the deep link from the Governance Overview: overdue_only, which is what the API calls overdue
  assert.deepEqual(actionListParams({ status: '', committee: '', overdueOnly: true }),
    { status: undefined, committee_id: undefined, overdue_only: true });
  assert.deepEqual(actionListParams({ status: 'open', committee: '3', overdueOnly: false }),
    { status: 'open', committee_id: 3, overdue_only: undefined });
});

test('paging adds skip and limit only when they differ from the server\'s defaults', () => {
  const none = { status: '', committee: '', overdueOnly: false };
  assert.equal('skip' in actionListParams(none, 1, 100), false);
  assert.equal('limit' in actionListParams(none, 1, 100), false);
  assert.equal(actionListParams(none, 2, 100).skip, 100);
  assert.equal(actionListParams(none, 3, 25).skip, 50);
  assert.equal(actionListParams(none, 3, 25).limit, 25);
  assert.equal(actionListParams(none, 1, 50).limit, 50);
  assert.equal('skip' in actionListParams(none, 1, 50), false);
  assert.equal('skip' in actionListParams(none, 0, 100), false);                      // a page below 1 is page 1
  assert.equal('skip' in actionListParams(none, Number.NaN as number, 100), false);
});

test('all 18 action types have a label, and a type nobody listed reads as its own words, not as "Follow up"', () => {
  assert.equal(ACTION_TYPES.length, 18);
  assert.equal(new Set(ACTION_TYPES.map((t) => t.value)).size, 18);
  assert.equal(actionTypeLabel('corrective_action'), 'Corrective action');
  assert.equal(actionTypeLabel('follow_up'), 'Follow up');
  assert.equal(actionTypeLabel('board_decision'), 'Board decision');
  assert.equal(actionTypeLabel(undefined), '—');
});

test('the SLA pill says what the SLA badge always said, and nothing when there is no SLA or the action is closed', () => {
  const sla = (over: Partial<SlaLike>): SlaLike => ({ state: 'on_track', days_overdue: null, due_in_days: 14, target_days: 30, implied_due_date: false, escalated: false, ...over });
  assert.deepEqual(slaPill(sla({ state: 'breached', days_overdue: 6 })), { tone: 'danger', label: 'Overdue 6d', title: 'SLA 30 days' });
  assert.equal(slaPill(sla({ state: 'breached', days_overdue: 2, escalated: true }))?.label, 'Overdue 2d · escalated');
  assert.deepEqual(slaPill(sla({ state: 'due_soon', due_in_days: 7 }))?.label, 'Due in 7d');
  assert.equal(slaPill(sla({ state: 'due_soon', due_in_days: 0 }))?.label, 'Due today');
  assert.deepEqual(slaPill(sla({ state: 'on_track', due_in_days: 14, implied_due_date: true })), { tone: 'success', label: 'On track · 14d', title: 'SLA 30 days, counted from when it was raised' });
  assert.equal(slaPill(sla({ state: 'paused' }))?.label, 'Paused');
  assert.equal(slaPill(sla({ state: 'no_due_date', target_days: null }))?.label, 'No SLA');
  assert.equal(slaPill(sla({ state: 'no_due_date', target_days: null }))?.title, undefined);
  assert.equal(slaPill(sla({ state: 'closed' })), null);
  assert.equal(slaPill(null), null);
  assert.equal(slaPill(undefined), null);
});

// ── tabs ────────────────────────────────────────────────────────────────────
test('every tab a committee has had still opens from the address, and anything else opens Meetings', () => {
  assert.deepEqual([...COMMITTEE_TABS], ['members', 'charters', 'meetings', 'actions', 'settings']);
  assert.equal(DEFAULT_COMMITTEE_TAB, 'meetings');
  for (const tab of COMMITTEE_TABS) assert.equal(resolveTab(`?tab=${tab}`, 'tab', COMMITTEE_TABS, {}, DEFAULT_COMMITTEE_TAB), tab);
  assert.equal(resolveTab('', 'tab', COMMITTEE_TABS, {}, DEFAULT_COMMITTEE_TAB), 'meetings');
  assert.equal(resolveTab('?tab=Members', 'tab', COMMITTEE_TABS, {}, DEFAULT_COMMITTEE_TAB), 'members');
  assert.equal(resolveTab('?tab=nonsense', 'tab', COMMITTEE_TABS, {}, DEFAULT_COMMITTEE_TAB), 'meetings');
  assert.equal(resolveTab('?tab=constructor', 'tab', COMMITTEE_TABS, {}, DEFAULT_COMMITTEE_TAB), 'meetings');
});

// ── words and lists ─────────────────────────────────────────────────────────
test('committee types read short in a list and long on their own page', () => {
  assert.equal(committeeTypeLabel('risk_committee'), 'Risk');
  assert.equal(committeeTypeLabel('risk_committee', 'long'), 'Risk committee');
  assert.equal(committeeTypeLabel('custom'), 'Committee');
  assert.equal(committeeTypeLabel('custom', 'long'), 'Custom');
  assert.equal(committeeTypeLabel('steering_group'), 'Steering group');
  assert.equal(committeeTypeLabel('constructor'), 'Constructor');
  assert.equal(committeeTypeLabel(null), '—');
});

test('the committee list finds a committee by part of its name or its type, in any case', () => {
  const c = { name: 'Board Risk Management Committee (BRMC)', committee_type: 'risk_committee' };
  assert.equal(matchesCommittee(c, ''), true);
  assert.equal(matchesCommittee(c, '  '), true);
  assert.equal(matchesCommittee(c, 'brmc'), true);
  assert.equal(matchesCommittee(c, 'RISK'), true);
  assert.equal(matchesCommittee(c, 'audit'), false);
  assert.equal(matchesCommittee({ name: 'IT Steering Committee', committee_type: 'it_steering' }, 'steering'), true);
});

// ── the questions asked before a change that cannot be taken back ───────────
test('removing a chair or secretary says what the server does: the role is cleared and nobody takes it over', () => {
  const committee = { name: 'Audit Committee', chair_id: 7, secretary_id: 9 };
  const chair = removeMemberPlan({ user_id: 7, user_name: 'Olivia Owner', role: 'chair' }, committee);
  assert.equal(chair.vacates, 'Chair');
  assert.equal(chair.title, 'Remove Olivia Owner from Audit Committee?');
  assert.match(chair.message, /Olivia Owner is the committee's Chair\. Removing them also clears the Chair, and nobody takes the role over/);
  assert.equal(chair.confirmLabel, 'Remove member');
  const secretary = removeMemberPlan({ user_id: 9, user_name: 'Sara Reviewer', role: 'secretary' }, committee);
  assert.equal(secretary.vacates, 'Secretary');
  assert.match(secretary.message, /clears the Secretary/);
});

test('removing an ordinary member, or a chair the committee no longer points at, does not claim a role is cleared', () => {
  const committee = { name: 'Audit Committee', chair_id: 7, secretary_id: null };
  const member = removeMemberPlan({ user_id: 2, user_name: 'Paula Publisher', role: 'member' }, committee);
  assert.equal(member.vacates, null);
  assert.equal(member.message, 'Paula Publisher stops being a member. Their votes and the actions assigned to them are kept.');
  // the member row says chair but the committee points at someone else: the server clears nothing, so the question does not say it does
  assert.equal(removeMemberPlan({ user_id: 8, user_name: 'Bina Branch', role: 'chair' }, committee).vacates, null);
  assert.equal(removeMemberPlan({ user_id: 3, user_name: '', role: 'member' }, committee).title, 'Remove User 3 from Audit Committee?');
});

test('the delete question names what the server removes, and its confirm button says what it does', () => {
  const plan = deleteCommitteePlan('Audit Committee');
  assert.equal(plan.title, 'Delete Audit Committee?');
  assert.equal(plan.confirmLabel, 'Delete committee');
  for (const word of ['members', 'charters', 'meetings', 'agendas', 'minutes', 'attached documents', 'actions', 'Task Management', 'cannot be undone', 'a vote was cast on any agenda item']) {
    assert.ok(plan.message.includes(word), word);
  }
});

test('a form is changed when its typed input differs from what it opened with', () => {
  const initial = { name: '', chair_id: '', agenda: [] as string[] };
  assert.equal(formChanged(initial, { name: '', chair_id: '', agenda: [] }), false);
  assert.equal(formChanged(initial, { name: 'x', chair_id: '', agenda: [] }), true);
  assert.equal(formChanged(initial, { name: '', chair_id: '', agenda: ['one'] }), true);
  assert.equal(formChanged(initial, { name: 'x', chair_id: '', agenda: [] }) && !formChanged({ name: 'x' }, { name: 'x' }), true);
});

// ── dates, in two zones ─────────────────────────────────────────────────────
// The server stamps naive UTC ("2026-11-12T18:30:00"). A meeting at 23:30 in Karachi (UTC+5) is stored 18:30 the same day; at 23:30 in Los Angeles in
// winter (UTC-8) it is stored 07:30 the NEXT day. `new Date(naive)` reads the string as the viewer's own clock, which is how the pages used to show
// the wrong day: 13 Nov for the Los Angeles meeting.
const MODULE = pathToFileURL(`${process.cwd()}/src/lib/committees.ts`).href;
const CHILD = [
  'const m = await import(process.argv[1]);',
  "let text = ''; for await (const chunk of process.stdin) text += chunk;",
  'const calls = JSON.parse(text);',
  'process.stdout.write(JSON.stringify(calls.map(([fn, ...args]) => m[fn](...args))));',
].join(' ');

function inZone(zone: string, calls: Array<[string, ...unknown[]]>): unknown[] {
  const run = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', CHILD, MODULE], {
    env: { ...process.env, TZ: zone }, input: JSON.stringify(calls), encoding: 'utf8',
  });
  assert.equal(run.status, 0, `${zone}: ${run.stderr}`);
  return JSON.parse(run.stdout);
}

const KARACHI = 'Asia/Karachi';        // UTC+5, no clock changes
const LOS_ANGELES = 'Etc/GMT+8';       // UTC-8 all year (the POSIX sign is inverted)

test('a meeting at 23:30 local is that evening in Karachi and in UTC-8, not the next day', () => {
  assert.deepEqual(inZone(KARACHI, [['meetingDay', '2026-11-12T18:30:00'], ['meetingWhen', '2026-11-12T18:30:00']]), ['12 Nov 2026', '12 Nov 2026, 23:30']);
  assert.deepEqual(inZone(LOS_ANGELES, [['meetingDay', '2026-11-13T07:30:00'], ['meetingWhen', '2026-11-13T07:30:00']]), ['12 Nov 2026', '12 Nov 2026, 23:30']);
});

test('a meeting at 00:30 local is the new day in Karachi and in UTC-8', () => {
  assert.deepEqual(inZone(KARACHI, [['meetingDay', '2026-11-12T19:30:00'], ['meetingWhen', '2026-11-12T19:30:00']]), ['13 Nov 2026', '13 Nov 2026, 00:30']);
  assert.deepEqual(inZone(LOS_ANGELES, [['meetingDay', '2026-11-13T08:30:00'], ['meetingWhen', '2026-11-13T08:30:00']]), ['13 Nov 2026', '13 Nov 2026, 00:30']);
});

test('the old reading of the same strings was wrong where the offset moves the day (the reason for the rule)', () => {
  const old = (zone: string, naive: string) => {
    const run = spawnSync(process.execPath, ['-e', `process.stdout.write(new Date(${JSON.stringify(naive)}).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))`], { env: { ...process.env, TZ: zone }, encoding: 'utf8' });
    return run.stdout;
  };
  assert.equal(old(LOS_ANGELES, '2026-11-13T07:30:00'), '13 Nov 2026');                // 23:30 on the 12th, shown as the 13th
  assert.equal(old(KARACHI, '2026-11-12T19:30:00'), '12 Nov 2026');                    // 00:30 on the 13th, shown as the 12th
});

test('a due date is a day, whether a date was picked or a time came with it, in every zone', () => {
  for (const zone of [KARACHI, LOS_ANGELES]) {
    assert.deepEqual(inZone(zone, [['dueDay', '2026-11-12T00:00:00'], ['dueDay', '2026-11-12'], ['dueDay', '2026-11-12T23:30:00'], ['dueDay', null]]),
      ['12 Nov 2026', '12 Nov 2026', '12 Nov 2026', '—'], zone);
  }
});

test('"in 3 days" and "2 days ago" count calendar days of a due date, from the viewer\'s today', () => {
  const today = '2026-11-12T15:00:00';
  // the child builds a local-clock Date from the string: 15:00 on 12 Nov on the viewer's own clock
  const code = `const m = await import(process.argv[1]); const t = new Date(2026, 10, 12, 15, 0);
    process.stdout.write(JSON.stringify([m.dueRelative('2026-11-15T00:00:00', t), m.dueRelative('2026-11-10', t), m.dueRelative('2026-11-12T00:00:00', t), m.meetingRelative('2026-11-14T10:00:00', t)]));`;
  for (const zone of [KARACHI, LOS_ANGELES]) {
    const run = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', code, MODULE], { env: { ...process.env, TZ: zone }, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const [in3, ago2, same, meeting] = JSON.parse(run.stdout);
    assert.deepEqual([in3, ago2, same], ['in 3 days', '2 days ago', 'today'], zone);
    assert.match(meeting, /^in [12] days?$|^today$/, `${zone} ${meeting} (${today})`);   // a moment: the viewer's own day, one or two days on
  }
});

test('upcoming meetings are told from the UTC reading of the stored time: soonest first, no cancelled, no past', () => {
  const now = Date.UTC(2026, 10, 12, 9, 0, 0);                                       // 09:00 UTC
  const rows = [
    { id: 1, scheduled_date: '2026-11-12T10:00:00', status: 'scheduled' },           // an hour from now
    { id: 2, scheduled_date: '2026-11-12T08:00:00', status: 'scheduled' },           // an hour ago
    { id: 3, scheduled_date: '2026-11-20T08:00:00', status: 'cancelled' },
    { id: 4, scheduled_date: null, status: 'scheduled' },
    { id: 5, scheduled_date: '2026-11-13T08:00:00', status: 'scheduled' },
    { id: 6, scheduled_date: '2026-11-12T09:30:00', status: 'scheduled' },
  ];
  const ids = (zone: string) => {
    const code = `const m = await import(process.argv[1]); let text = ''; for await (const c of process.stdin) text += c;
      process.stdout.write(JSON.stringify(m.upcomingMeetings(JSON.parse(text), ${now}).map((r) => r.id)));`;
    const run = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', code, MODULE], { env: { ...process.env, TZ: zone }, input: JSON.stringify(rows), encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    return JSON.parse(run.stdout);
  };
  assert.deepEqual(ids(KARACHI), [6, 1, 5]);                                         // read as local, 10:00 would have been 05:00 UTC: already past
  assert.deepEqual(ids(LOS_ANGELES), [6, 1, 5]);
  assert.deepEqual(upcomingMeetings([], now), []);
});
