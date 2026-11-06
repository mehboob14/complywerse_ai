// node --test "src/lib/committeeHome.test.ts"
// The Committees home (timeline first): the address (the filter, the sheet, the search), the old committee page's addresses, the chips, the pulse and the strip, the three
// groups of the Needs action lane (which request asks for which rows, so every group has its true total) and the grouping of meetings, decisions and readiness.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress, writeAddress } from './addressState.ts';
import { meetingDay, meetingRelative } from './committees.ts';
import {
  ACTIONS_SCHEMA, DECISIONS_SHOWN, GROUP_SHOWN, HOME_SCHEMA, OPEN_STATUSES, SEARCH_ROWS, chipName, committeeChips, committeeHomeAddress, dateBox, dayAfter, decisionScope, groupActions, groupMeetings,
  actionsListAddress, groupQuery, inactiveHidden, laterTotal, legacyCommitteeAddress, matchesSearch, meetingClock, meetingScope, naiveUtc, pulseOf, readiness, searchCut, stripCells, viewOf, viewQuery,
  type MeetingRow,
} from './committeeHome.ts';

// ── the address ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the home keeps its filter, its sheet, its search and Mine in the address, and an address nobody listed is the plain home', () => {
  assert.deepEqual(readAddress(HOME_SCHEMA, ''), { committee: 0, status: 'active', q: '', mine: false, manage: 'closed' });
  assert.deepEqual(readAddress(HOME_SCHEMA, '?committee=3&manage=members&mine=1&q=audit%20plan&status=all'), { committee: 3, status: 'all', q: 'audit plan', mine: true, manage: 'members' });
  // junk is the default: an address can never put the page in a state it cannot be in
  assert.deepEqual(readAddress(HOME_SCHEMA, '?committee=abc&manage=delete&status=everything&mine=maybe'), { committee: 0, status: 'active', q: '', mine: false, manage: 'closed' });
  assert.equal(readAddress(HOME_SCHEMA, '?committee=-4').committee, 0, 'a negative id is no committee');
  // the status filter of the old list page (?status=inactive|all) is the same name with the same words
  assert.equal(readAddress(HOME_SCHEMA, '?status=inactive').status, 'inactive');
  // writing back: the defaults have the plain address and the params of other pages stay
  assert.equal(writeAddress(HOME_SCHEMA, '', readAddress(HOME_SCHEMA, '')), '');
  assert.equal(writeAddress(HOME_SCHEMA, '?utm=1', { committee: 5, status: 'active', q: '', mine: false, manage: 'charter' }), 'utm=1&committee=5&manage=charter');
});

test('the old committee page still opens: each of its tabs lands on the filtered home, the sheet tabs on the sheet', () => {
  assert.equal(legacyCommitteeAddress(3, null), '/governance/committees?committee=3');
  assert.equal(legacyCommitteeAddress('3', 'meetings'), '/governance/committees?committee=3', 'its meetings are the lane of the filtered home');
  assert.equal(legacyCommitteeAddress(3, 'actions'), '/governance/committees?committee=3', 'its actions are the Needs action lane');
  assert.equal(legacyCommitteeAddress(3, 'members'), '/governance/committees?committee=3&manage=members');
  assert.equal(legacyCommitteeAddress(3, 'charters'), '/governance/committees?committee=3&manage=charter', 'the sheet calls its tab Charter');
  assert.equal(legacyCommitteeAddress(3, 'Settings'), '/governance/committees?committee=3&manage=settings');
  assert.equal(legacyCommitteeAddress(3, 'constructor'), '/governance/committees?committee=3', 'a tab nobody listed is the plain filter');
  assert.equal(legacyCommitteeAddress('abc', 'members'), '/governance/committees', 'an id that is no number is the plain home');
  assert.equal(legacyCommitteeAddress(0, null), '/governance/committees');
  assert.equal(committeeHomeAddress(7), '/governance/committees?committee=7');
  assert.equal(committeeHomeAddress(7, { manage: 'members' }), '/governance/committees?committee=7&manage=members');
  assert.equal(committeeHomeAddress(null), '/governance/committees');
});

// ── the chips ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('a chip is the committee\'s short name: " Committee" off the end, 24 characters at most', () => {
  assert.equal(chipName('Audit Committee'), 'Audit');
  assert.equal(chipName('Board Risk Management Committee (BRMC)'), 'Board Risk Management C…');
  assert.equal(chipName('Committee'), 'Committee', 'a name that is only the word keeps it');
  assert.equal(chipName('x'.repeat(150)).length, 24);
});

const ROWS = [
  { id: 1, name: 'Audit Committee', is_active: true, overdue_actions: 3, meetings_in_progress: 1 },
  { id: 2, name: 'Risk Committee', is_active: true, overdue_actions: 0, meetings_in_progress: 0 },
  { id: 3, name: 'IT Steering Committee', is_active: true, overdue_actions: 2, meetings_in_progress: 0 },
  { id: 4, name: 'Old Committee', is_active: false, overdue_actions: 1, meetings_in_progress: 0 },
  { id: 5, name: 'No flag', is_active: null as unknown as boolean, overdue_actions: 0 },
];

test('the chips: All committees with the count, one per committee the filter shows, an overdue badge, a live dot, and the inactive ones only on request', () => {
  const active = committeeChips(ROWS, { selectedId: null, status: 'active' });
  assert.deepEqual(active.map((c) => c.key), ['all', '1', '2', '3', '5'], 'a NULL flag reads as active');
  assert.deepEqual(active[0], { key: 'all', label: 'All committees', count: 4, active: true });
  assert.equal(active.find((c) => c.key === '1')?.flag?.text, 3);
  assert.equal(active.find((c) => c.key === '1')?.flag?.label, '3 overdue actions, meeting in progress', 'both are said in words for a screen reader');
  assert.equal(active.find((c) => c.key === '1')?.live, true);
  assert.deepEqual(active.find((c) => c.key === '2')?.flag, undefined, 'nothing to flag, no flag');
  assert.equal(active.find((c) => c.key === '3')?.flag?.label, '2 overdue actions');
  const all = committeeChips(ROWS, { selectedId: 4, status: 'all' });
  assert.deepEqual(all.map((c) => c.key), ['all', '1', '2', '3', '4', '5']);
  assert.deepEqual([all.find((c) => c.key === '4')?.label, all.find((c) => c.key === '4')?.title, all.find((c) => c.key === '4')?.active], ['Old (inactive)', 'Old Committee (inactive)', true]);
  assert.equal(all[0].active, false, 'All committees is off while one is chosen');
  assert.deepEqual(committeeChips(ROWS, { selectedId: null, status: 'inactive' }).map((c) => c.key), ['all', '4']);
  // a live committee with nothing overdue gets the dot, said in words
  const live = committeeChips([{ ...ROWS[0], overdue_actions: 0 }], { selectedId: null, status: 'active' })[1];
  assert.deepEqual(live.flag, { tone: 'info', label: 'Meeting in progress' });
});

test('"Show inactive N" counts the committees the filter hides, and only while it hides them', () => {
  assert.equal(inactiveHidden(ROWS, 'active'), 1);
  assert.equal(inactiveHidden(ROWS, 'all'), 0);
  assert.equal(inactiveHidden(ROWS, 'inactive'), 0);
  assert.equal(inactiveHidden([], 'active'), 0);
});

// ── the pulse and the strip ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the pulse is the overview\'s own numbers: overdue, upcoming, in progress, attendance (or Not recorded) and the performance score', () => {
  const kpis = {
    total_committees: 5, active_committees: 4, meetings_upcoming: 6, meetings_completed: 0, meetings_this_quarter: 3,
    actions: { open: 5, in_progress: 2, overdue: 4, completed: 1, total: 8, pct_done: 12.5 }, avg_attendance_pct: null, charters_active: 2,
    performance: { score: null, grade: null, metrics: [] },
  };
  const p = pulseOf({ kpis, committees: ROWS as never });
  assert.deepEqual([p.overdue, p.upcoming, p.live], [4, 6, 1]);
  assert.equal(p.attendance.value, null);
  assert.equal(p.performance.score, null);
  assert.equal(pulseOf({ kpis: { ...kpis, avg_attendance_pct: 71.4, meetings_completed: 2 }, committees: [] }).attendance.value, '71%');
});

test('the strip: next meeting (or In progress, or None), attendance (or Not recorded), overdue of open, the charter, the members', () => {
  const today = new Date(2026, 10, 6, 12, 0);
  const next = { id: 9, date: '2026-11-10T12:00:00', title: 'Q4', has_agenda: true, papers_count: 2, invitees_count: 7 };
  const cells = stripCells({ next_meeting: next, attendance_pct: 82.6, open_actions: 4, in_progress_actions: 2, overdue_actions: 1, charter_in_force: { id: 1, version: '2.0', expires_on: '2027-03-31' }, members_count: 7 }, { today });
  assert.deepEqual(cells.map((c) => c.label), ['Next meeting', 'Attendance', 'Overdue', 'Charter', 'Members']);
  assert.deepEqual([cells[0].value, cells[0].sub], [meetingDay(next.date), meetingRelative(next.date, today)]);
  assert.deepEqual([cells[1].value, cells[1].tone], ['83%', 'default']);
  assert.deepEqual([cells[2].value, cells[2].sub, cells[2].tone], ['1', 'of 6 open actions', 'danger']);
  assert.deepEqual([cells[3].value, cells[3].tone], ['In force', 'success']);
  assert.match(cells[3].sub, /^v2\.0, until /);
  assert.deepEqual([cells[4].value, cells[4].sub], ['7', '']);

  const bare = stripCells({}, { today });
  assert.deepEqual([bare[0].value, bare[0].sub, bare[0].tone], ['None', 'not scheduled', 'warning']);
  assert.deepEqual([bare[1].value, bare[1].tone], ['Not recorded', 'muted'], 'no roll is not 0%');
  assert.match(bare[1].why ?? '', /roll call/);
  assert.deepEqual([bare[2].value, bare[2].tone], ['0', 'default']);
  assert.deepEqual([bare[3].value, bare[3].sub], ['None', 'no charter yet']);
  assert.deepEqual([stripCells({}, { charters: 2 })[3].value, stripCells({}, { charters: 2 })[3].tone], ['Draft only', 'warning'], 'charters exist, none in force');
  assert.equal(stripCells({ meetings_in_progress: 1, next_meeting: next })[0].value, 'In progress', 'a meeting running now is the next one');
  assert.equal(stripCells({ attendance_pct: 0 })[1].value, '0%', 'a measured 0% is a measurement, not Not recorded');
  assert.equal(stripCells({ open_actions: 1, overdue_actions: 1 })[2].sub, 'of 1 open action');
});

// ── the Needs action lane ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the week window starts at "now" on the server\'s clock and ends on the viewer\'s day a week ahead, across a month end and midnight', () => {
  assert.equal(naiveUtc(new Date('2026-11-06T15:04:09.987Z')), '2026-11-06T15:04:09');
  assert.equal(dayAfter(new Date(2026, 10, 6, 23, 59), 7), '2026-11-13', 'late in the evening it is still the same viewer\'s day');
  assert.equal(dayAfter(new Date(2026, 10, 6, 0, 0), 7), '2026-11-13');
  assert.equal(dayAfter(new Date(2026, 10, 26, 10, 0), 7), '2026-12-03', 'across a month end');
  assert.equal(dayAfter(new Date(2026, 11, 28, 10, 0), 7), '2027-01-04', 'across a year end');
  assert.equal(dayAfter(new Date(2028, 1, 25, 10, 0), 7), '2028-03-03', 'across a leap day');
});

test('each group has its own request: overdue is the server\'s test, this week is a range, later is the rest by skipping the first two groups (so no due date is in it)', () => {
  const now = new Date('2026-11-06T15:00:00Z');
  const scope = { committeeId: null, mine: false };
  const overdue = groupQuery('overdue', scope, now, { limit: 5 });
  assert.deepEqual(overdue, { status: OPEN_STATUSES, overdue_only: true, limit: 5 });
  const week = groupQuery('week', scope, now, { limit: 5 });
  assert.equal(week.due_after, '2026-11-06T15:00:00', 'an action due from now is not overdue: the two groups never overlap');
  assert.equal(week.due_before, dayAfter(now, 7));
  assert.equal(week.overdue_only, undefined);
  assert.deepEqual(groupQuery('later', scope, now, { limit: 3, skip: 7 }), { status: OPEN_STATUSES, skip: 7, limit: 3 });
  assert.deepEqual(groupQuery('later', scope, now, { limit: 3 }), { status: OPEN_STATUSES, limit: 3 }, 'with nothing before it, later skips nothing');
  // a committee and Mine ride on every group
  const mine = { committeeId: 4, mine: true };
  for (const group of ['overdue', 'week', 'later'] as const) {
    const q = groupQuery(group, mine, now, { limit: 5, skip: 2 });
    assert.equal(q.committee_id, 4, group);
    assert.equal(q.assigned_to, 'me', group);
    assert.equal(q.status, OPEN_STATUSES, group);
  }
  assert.deepEqual(GROUP_SHOWN, { overdue: 5, week: 5, later: 3 });
});

test('"later" is every open action less the two groups before it, never below zero', () => {
  assert.equal(laterTotal(12, 4, 3), 5);
  assert.equal(laterTotal(7, 4, 3), 0);
  assert.equal(laterTotal(5, 4, 3), 0, 'a count that moved between two requests does not go negative');
});

const A = (id: number, title: string, due: string | null, over = false, who = ''): { id: number; title: string; due_date: string | null; is_overdue: boolean; assigned_to_name: string; status: string } =>
  ({ id, title, due_date: due, is_overdue: over, assigned_to_name: who, status: 'open' });

test('a search groups what the page holds: overdue by the server\'s flag, the week by the due day, the rest later (an action with no due date included)', () => {
  const now = new Date(2026, 10, 6, 12, 0);
  const rows = [A(1, 'Late one', '2026-11-01T00:00:00', true), A(2, 'This week', '2026-11-12T00:00:00'), A(3, 'On the last day', '2026-11-13T00:00:00'), A(4, 'After', '2026-11-14T00:00:00'), A(5, 'No date', null)];
  const g = groupActions(rows, now);
  assert.deepEqual([g.overdue.map((a) => a.id), g.week.map((a) => a.id), g.later.map((a) => a.id)], [[1], [2, 3], [4, 5]]);
});

test('the search finds every word in the title, the description or the assignee, in any case', () => {
  const a = { ...A(1, 'Review the third-party register', null, false, 'Olivia Owner'), description: 'Include the cloud vendors' };
  assert.equal(matchesSearch(a, ''), true);
  assert.equal(matchesSearch(a, 'THIRD-party'), true);
  assert.equal(matchesSearch(a, 'olivia register'), true, 'a word of the assignee and a word of the title');
  assert.equal(matchesSearch(a, 'cloud'), true, 'the description');
  assert.equal(matchesSearch(a, 'olivia payroll'), false, 'every word must be there');
  assert.equal(SEARCH_ROWS, 200);
  assert.equal(searchCut(200, 340), 'The search reads the first 200 of 340 open actions.');
  assert.equal(searchCut(12, 12), '');
});

// ── meetings, decisions ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const M = (id: number, status: string, date: string, extra: Partial<MeetingRow> = {}): MeetingRow => ({ id, committee_id: 1, title: `M${id}`, scheduled_date: date, status, ...extra });

test('the meetings lane: in progress pinned, the ones to come soonest first, the rest newest first, and a past "scheduled" meeting is among the rest', () => {
  const now = new Date('2026-11-06T12:00:00Z').getTime();
  const rows = [
    M(1, 'completed', '2026-09-01T10:00:00'), M(2, 'scheduled', '2026-12-01T10:00:00'), M(3, 'in_progress', '2026-11-06T09:00:00'), M(4, 'scheduled', '2026-11-20T10:00:00'),
    M(5, 'scheduled', '2026-10-01T10:00:00'), M(6, 'cancelled', '2026-10-15T10:00:00'), M(7, 'completed', '2026-10-20T10:00:00'),
  ];
  const g = groupMeetings(rows, now);
  assert.deepEqual(g.live.map((m) => m.id), [3]);
  assert.deepEqual(g.upcoming.map((m) => m.id), [4, 2]);
  assert.deepEqual(g.earlier.map((m) => m.id), [7, 6, 5, 1]);
  assert.deepEqual(groupMeetings([], now), { live: [], upcoming: [], earlier: [] });
});

test('readiness says the agenda (or its absence as a warning) and the papers', () => {
  assert.deepEqual(readiness({ agenda_item_count: 4, papers_count: 2 }), [{ label: 'Agenda 4', tone: 'success' }, { label: 'Papers 2', tone: 'success' }]);
  assert.deepEqual(readiness({ agenda_item_count: 0, papers_count: 0 }), [{ label: 'No agenda', tone: 'warning' }]);
  assert.deepEqual(readiness({}), [{ label: 'No agenda', tone: 'warning' }]);
});

test('the meetings the page asks for: the active committees, the chosen one whatever it is, at most twenty with the cut said', () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: i + 1, is_active: i !== 3 }));
  const all = meetingScope(rows, { selectedId: null, status: 'active' });
  assert.equal(all.ids.length, 20);
  assert.equal(all.cut, 4, '24 active committees, 20 asked for');
  assert.ok(!all.ids.includes(4), 'an inactive one is not asked for');
  assert.deepEqual(meetingScope(rows, { selectedId: 4, status: 'active' }), { ids: [4], cut: 0 }, 'an inactive committee that is chosen is still read');
  assert.deepEqual(meetingScope(rows.slice(0, 2), { selectedId: null, status: 'all' }), { ids: [1, 2], cut: 0 });
  assert.deepEqual(meetingScope([], { selectedId: null, status: 'active' }), { ids: [], cut: 0 });
});

test('the date box is the meeting\'s own day in the viewer\'s calendar; nothing for a date that is no date', () => {
  assert.deepEqual(dateBox(new Date(2026, 10, 6, 10, 0)), { day: '6', month: 'NOV' });
  assert.equal(dateBox(null), null);
  assert.equal(dateBox('not a date'), null);
});

test('the decisions lane lists the active committees\' decisions, a chosen committee\'s whatever it is, and the inactive ones when the filter shows them', () => {
  assert.equal(decisionScope(null, 'active'), 'true');
  assert.equal(decisionScope(null, 'all'), 'all');
  assert.equal(decisionScope(null, 'inactive'), 'false');
  assert.equal(decisionScope(5, 'active'), 'all');
  assert.equal(DECISIONS_SHOWN, 8);
});

// ── the full list ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('Oversight Actions keeps its filters in the address, and the old ?overdue=1 of the Governance Overview opens the Overdue view', () => {
  const read = (search: string) => readAddress(ACTIONS_SCHEMA, search);
  assert.deepEqual(read(''), { committee: 0, mine: false, view: 'all', overdue: false, status: '', q: '', page: 1, size: 100 });
  assert.deepEqual(read('?committee=4&mine=1&view=week&status=open&q=register&page=3&size=50'), { committee: 4, mine: true, view: 'week', overdue: false, status: 'open', q: 'register', page: 3, size: 50 });
  assert.deepEqual(read('?view=nonsense&status=closed&page=0&size=900'), { committee: 0, mine: false, view: 'all', overdue: false, status: '', q: '', page: 1, size: 100 }, 'junk is the default');
  assert.equal(viewOf(read('?overdue=1')), 'overdue');
  assert.equal(viewOf(read('?overdue=1&view=later')), 'later', 'an explicit view wins over the old parameter');
  assert.equal(viewOf(read('?overdue=0')), 'all');
  // the lane's links land on the same page, with the same scope
  assert.equal(actionsListAddress({ committeeId: null, mine: false }), '/governance/committees/actions');
  assert.equal(actionsListAddress({ committeeId: 3, mine: true }, 'overdue'), '/governance/committees/actions?committee=3&mine=1&view=overdue');
  assert.deepEqual(read(actionsListAddress({ committeeId: 3, mine: true }, 'later').split('?')[1]), { committee: 3, mine: true, view: 'later', overdue: false, status: '', q: '', page: 1, size: 100 });
});

test("a page of the full list asks for exactly what the lane asks for: All is the old request plus Mine, the other views are the lane's three groups, later skips the first two", () => {
  const now = new Date('2026-11-06T15:00:00Z');
  const none = { committeeId: null, mine: false, status: '' };
  // the first page of All is what the page has always sent: no skip, the limit the server also defaults to
  assert.deepEqual(viewQuery('all', none, now, { page: 1, size: 100, before: 0 }), { status: undefined, limit: 100 });
  assert.deepEqual(viewQuery('all', { committeeId: 4, mine: true, status: 'completed' }, now, { page: 3, size: 25, before: 0 }), { status: 'completed', committee_id: 4, assigned_to: 'me', skip: 50, limit: 25 });
  assert.deepEqual(viewQuery('overdue', none, now, { page: 2, size: 25, before: 0 }), { status: OPEN_STATUSES, overdue_only: true, skip: 25, limit: 25 });
  const week = viewQuery('week', { committeeId: 9, mine: false, status: 'open' }, now, { page: 1, size: 50, before: 0 });
  assert.deepEqual([week.due_after, week.due_before, week.committee_id, week.skip, week.limit], ['2026-11-06T15:00:00', dayAfter(now, 7), 9, undefined, 50]);
  // later: skip the rows of the two groups before it (7 here), then page
  assert.deepEqual(viewQuery('later', none, now, { page: 1, size: 25, before: 7 }), { status: OPEN_STATUSES, skip: 7, limit: 25 });
  assert.deepEqual(viewQuery('later', none, now, { page: 3, size: 25, before: 7 }), { status: OPEN_STATUSES, skip: 57, limit: 25 });
  assert.deepEqual(viewQuery('later', none, now, { page: 1, size: 25, before: 0 }), { status: OPEN_STATUSES, limit: 25 }, 'with nothing before it, later skips nothing');
  // the status filter does not apply inside a view: the views are the open actions
  assert.equal(viewQuery('overdue', { ...none, status: 'completed' }, now, { page: 1, size: 25, before: 0 }).status, OPEN_STATUSES);
});
