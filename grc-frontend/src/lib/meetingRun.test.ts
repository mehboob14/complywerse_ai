// node --test "src/lib/meetingRun.test.ts"
// Running a meeting: the order of the workspace's sections, what the roll and the quorum say, the questions before a meeting starts or ends (including "No roll recorded"),
// the roll call's payloads and the rules for an agenda item's outcome. The server owns the rules; these pin what the screen offers and how it says what the server answered.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DECISION_MAX, DEFAULT_OUTCOME, OUTCOMES, alreadyMarked, barKind, canRecordOutcome, currentItem, dueToStart, endPlan, markEveryone, markOne, meetingQuorum, notClosed, outcomeBody, outcomeWord,
  outlineLabel, outlineOrder, quorumReading, rollCount, rollFilter, rollLine, rollQuorum, sectionInView, startPlan, undecidedItems, type RollMember,
} from './meetingRun.ts';

// ── the outline ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the sections follow the work: prepare before the meeting, run while it is on, read once it is over', () => {
  assert.deepEqual(outlineOrder('scheduled'), ['agenda', 'papers', 'attendance', 'actions', 'minutes']);
  assert.deepEqual(outlineOrder('in_progress'), ['attendance', 'agenda', 'minutes', 'actions', 'papers']);
  assert.deepEqual(outlineOrder('completed'), ['agenda', 'minutes', 'actions', 'attendance', 'papers']);
  assert.deepEqual(outlineOrder('cancelled'), outlineOrder('completed'));
  assert.deepEqual(outlineOrder('something else'), outlineOrder('completed'));
  assert.deepEqual(outlineOrder(undefined), outlineOrder('completed'));
  for (const s of ['scheduled', 'in_progress', 'completed']) assert.deepEqual([...outlineOrder(s)].sort(), ['actions', 'agenda', 'attendance', 'minutes', 'papers']);
});

test('the first section is the invitees before the meeting and the roll after, and the agenda is Decisions once the meeting is over', () => {
  assert.equal(outlineLabel('attendance', 'scheduled'), 'Invitees');
  assert.equal(outlineLabel('attendance', 'in_progress'), 'Attendance');
  assert.equal(outlineLabel('agenda', 'in_progress'), 'Agenda and votes');
  assert.equal(outlineLabel('agenda', 'completed'), 'Decisions');
  assert.equal(outlineLabel('agenda', 'cancelled'), 'Agenda and votes');
  assert.equal(outlineLabel('papers', 'completed'), 'Papers');
});

test('the section being read is the last whose top has passed the line, the first when none has', () => {
  const tops = [{ key: 'attendance' as const, top: -300 }, { key: 'agenda' as const, top: -20 }, { key: 'minutes' as const, top: 400 }];
  assert.equal(sectionInView(tops, 0), 'agenda');
  assert.equal(sectionInView(tops, 500), 'minutes');
  assert.equal(sectionInView([{ key: 'agenda', top: 200 }], 0), 'agenda');
  assert.equal(sectionInView([], 0), null);
});

// ── the roll and the quorum ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('the quorum says nothing was recorded rather than 0 when no roll was taken', () => {
  assert.deepEqual(quorumReading({ required: 4, present: null, met: null, recorded: false }), { text: 'No roll recorded', label: 'Not recorded', tone: 'neutral', fraction: null });
  assert.equal(quorumReading({ required: 4, present: 0, met: null, recorded: false }).label, 'Not recorded', 'a zero count with no roll is not a measurement');
});

test('the quorum says met or not met against the threshold, with how far it is', () => {
  assert.deepEqual(quorumReading({ required: 4, present: 5, met: true, recorded: true }), { text: '5 present, 4 required', label: 'Quorum met', tone: 'success', fraction: 1 });
  assert.deepEqual(quorumReading({ required: 4, present: 3, met: false, recorded: true }), { text: '3 of 4 required present', label: 'Quorum not met', tone: 'warning', fraction: 0.75 });
  assert.equal(quorumReading({ required: 4, present: 0, met: false, recorded: true }).fraction, 0, 'a recorded zero is 0 of 4');
  // a reply without the verdict is judged against the threshold the same way
  assert.equal(quorumReading({ required: 4, present: 3, met: null, recorded: true }).label, 'Quorum not met');
  assert.equal(quorumReading({ required: 4, present: 4, met: undefined, recorded: true }).label, 'Quorum met');
});

test('a meeting with no quorum threshold (none, or under 1) says how many are present and does not judge', () => {
  for (const required of [null, undefined, 0, -1]) {
    assert.deepEqual(quorumReading({ required, present: 6, met: null, recorded: true }), { text: '6 present', label: 'No quorum set', tone: 'neutral', fraction: null }, String(required));
  }
});

test('a roll and a meeting row read the same way', () => {
  assert.equal(rollQuorum({ quorum_required: 3, quorum_present: 3, quorum_met: true, recorded: true }).label, 'Quorum met');
  assert.equal(meetingQuorum({ quorum_required: 3, quorum_present: 2, quorum_met: false }).label, 'Quorum not met');
  assert.equal(meetingQuorum({ quorum_required: 3, quorum_present: null, quorum_met: null }).label, 'Not recorded', 'a lane row with no roll');
  assert.equal(meetingQuorum({}).label, 'Not recorded');
});

const member = (id: number, status: string | null, role = 'member', active = true): RollMember => ({
  user_id: id, user_name: `Person ${id}`, user_email: `p${id}@x.test`, role, counts_toward_quorum: role !== 'observer', status, is_active_member: active,
});

test('the roll counts who stands where, with the members nobody marked and the observers on their own line', () => {
  const members = [member(1, 'present', 'chair'), member(2, 'late'), member(3, 'absent'), member(4, null), member(5, 'present', 'observer')];
  assert.deepEqual(rollCount(members), { present: 2, late: 1, absent: 1, notMarked: 1, observers: 1 });
  assert.equal(rollLine(rollCount(members)), '2 present, 1 late, 1 absent, 1 not marked');
  assert.equal(rollLine(rollCount([member(1, 'present')])), '1 present');
  assert.deepEqual(rollCount([]), { present: 0, late: 0, absent: 0, notMarked: 0, observers: 0 });
});

test('the roll\'s search finds a member by name, e-mail or role, in any case', () => {
  const members = [member(1, null, 'chair'), member(2, null), member(3, null, 'observer')];
  assert.deepEqual(rollFilter(members, 'person 2').map((m) => m.user_id), [2]);
  assert.deepEqual(rollFilter(members, 'P3@X').map((m) => m.user_id), [3]);
  assert.deepEqual(rollFilter(members, 'observer').map((m) => m.user_id), [3]);
  assert.deepEqual(rollFilter(members, '  ').map((m) => m.user_id), [1, 2, 3]);
  assert.deepEqual(rollFilter(members, 'nobody'), []);
});

test('marking one member is one entry; "Everyone present" sends only the members who are not present already, at most 200', () => {
  assert.deepEqual(markOne(7, 'late'), [{ user_id: 7, status: 'late' }]);
  const members = [member(1, 'present'), member(2, 'absent'), member(3, null), member(4, 'late'), member(5, 'absent', 'member', false)];
  assert.deepEqual(markEveryone(members), [{ user_id: 2, status: 'present' }, { user_id: 3, status: 'present' }, { user_id: 4, status: 'present' }], 'a member who left the committee is not sent');
  assert.deepEqual(markEveryone([member(1, 'present')]), [], 'nothing to change, nothing sent');
  assert.equal(markEveryone(Array.from({ length: 260 }, (_, i) => member(i + 1, null))).length, 200);
  assert.equal(alreadyMarked(member(1, 'late'), 'late'), true);
  assert.equal(alreadyMarked(member(1, null), 'absent'), false);
});

// ── start and end ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('a meeting is due to start from its own day, and "not closed" once its time has passed with nobody starting it', () => {
  const noon = new Date(2026, 10, 6, 12, 0);
  const at = (d: Date) => d.toISOString();
  assert.equal(dueToStart({ status: 'scheduled', scheduled_date: at(new Date(2026, 10, 6, 9, 0)) }, noon), true, 'this morning');
  assert.equal(dueToStart({ status: 'scheduled', scheduled_date: at(new Date(2026, 10, 6, 17, 0)) }, noon), true, 'this evening is today');
  assert.equal(dueToStart({ status: 'scheduled', scheduled_date: at(new Date(2026, 10, 7, 9, 0)) }, noon), false, 'tomorrow');
  assert.equal(dueToStart({ status: 'in_progress', scheduled_date: at(new Date(2026, 10, 6, 9, 0)) }, noon), false);
  assert.equal(notClosed({ status: 'scheduled', scheduled_date: at(new Date(2026, 10, 6, 9, 0)) }, noon), true);
  assert.equal(notClosed({ status: 'scheduled', scheduled_date: at(new Date(2026, 10, 6, 17, 0)) }, noon), false, 'later today is still to come');
  assert.equal(notClosed({ status: 'completed', scheduled_date: at(new Date(2026, 9, 6, 9, 0)) }, noon), false);
  assert.equal(dueToStart({ status: 'scheduled', scheduled_date: null }, noon), false);
});

test('the bar under the head is the live bar while the meeting runs, the "due to start" bar for someone who may start it, and nothing otherwise', () => {
  const noon = new Date(2026, 10, 6, 12, 0);
  const today = new Date(2026, 10, 6, 9, 0).toISOString();
  const later = new Date(2026, 10, 9, 9, 0).toISOString();
  assert.equal(barKind({ status: 'in_progress', scheduled_date: today }, false, noon), 'live', 'everyone sees that it is on');
  assert.equal(barKind({ status: 'scheduled', scheduled_date: today }, true, noon), 'due');
  assert.equal(barKind({ status: 'scheduled', scheduled_date: today }, false, noon), null, 'nothing to offer someone who may not start it');
  assert.equal(barKind({ status: 'scheduled', scheduled_date: later }, true, noon), null, 'not its day yet');
  assert.equal(barKind({ status: 'completed', scheduled_date: today }, true, noon), null);
  assert.equal(barKind({ status: 'cancelled', scheduled_date: today }, true, noon), null);
});

test('the start question names the meeting and what follows', () => {
  const p = startPlan({ status: 'scheduled', scheduled_date: null, title: 'Q4 meeting' });
  assert.deepEqual([p.title, p.confirmLabel, p.tone], ['Start this meeting?', 'Start meeting', 'default']);
  assert.match(p.lines[0].text, /“Q4 meeting” becomes In progress\./);
});

test('the end question says what is complete and what is not: quorum met, quorum not met, no roll recorded, undecided items, minutes', () => {
  const meeting = { status: 'in_progress', scheduled_date: null, title: 'Board' };
  const met = { quorum_required: 4, quorum_present: 5, quorum_met: true, recorded: true };
  const full = endPlan({ meeting, roll: met, openItems: 0, hasMinutes: true });
  assert.deepEqual([full.title, full.confirmLabel, full.tone], ['End this meeting?', 'End meeting', 'default']);
  assert.deepEqual(full.lines.map((l) => l.text), ['“Board” becomes Completed.', 'Quorum met: 5 present, 4 required.', 'Minutes are drafted.']);

  const noRoll = endPlan({ meeting, roll: { quorum_required: 4, quorum_present: null, quorum_met: null, recorded: false }, openItems: 2, hasMinutes: false });
  assert.deepEqual([noRoll.confirmLabel, noRoll.tone], ['End anyway', 'danger'], 'ending with no roll is asked as a caution: focus starts on Cancel');
  assert.match(noRoll.lines.map((l) => l.text).join(' '), /No roll was recorded\. Attendance and quorum stay empty, which counts against the Governance quorum measure/);
  assert.match(noRoll.lines.map((l) => l.text).join(' '), /2 agenda items have no outcome yet/);
  assert.match(noRoll.lines.map((l) => l.text).join(' '), /No minutes yet: draft them after the meeting ends\./);

  const notMet = endPlan({ meeting, roll: { quorum_required: 4, quorum_present: 3, quorum_met: false, recorded: true }, openItems: 1, hasMinutes: true });
  assert.equal(notMet.confirmLabel, 'End anyway');
  assert.ok(notMet.lines.some((l) => l.tone === 'warn' && l.text === 'Quorum not met: 3 of 4 required present.'));
  assert.ok(notMet.lines.some((l) => l.text === '1 agenda item has no outcome yet. You can still record them after the meeting ends.'));

  const unset = endPlan({ meeting, roll: { quorum_required: null, quorum_present: 6, quorum_met: null, recorded: true }, openItems: 0, hasMinutes: false });
  assert.equal(unset.confirmLabel, 'End meeting', 'no threshold is not a failure');
  assert.ok(unset.lines.some((l) => l.text === '6 present. No quorum was set for this meeting.'));

  // the roll could not be read: no claim about it
  const unknown = endPlan({ meeting, roll: null, openItems: 0, hasMinutes: false });
  assert.deepEqual(unknown.lines.map((l) => l.text), ['“Board” becomes Completed.', 'No minutes yet: draft them after the meeting ends.']);
  // a past meeting nobody started is closed, not completed from running
  const never = endPlan({ meeting: { status: 'scheduled', scheduled_date: null, title: 'Old' }, roll: null, openItems: 0, hasMinutes: false });
  assert.match(never.lines[0].text, /was never started: ending it records it as held\./);
});

test('a long title is cut in the question, not the page', () => {
  const p = startPlan({ status: 'scheduled', scheduled_date: null, title: 'x'.repeat(500) });
  assert.ok(p.lines[0].text.length < 130);
  assert.match(p.lines[0].text, /…” becomes/);
});

// ── the agenda ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const item = (id: number, n: number, status: string, outcome: string | null = null) => ({ id, item_number: n, status, outcome });

test('the meeting is on the first item nobody has decided, only while it runs', () => {
  const items = [item(1, 1, 'discussed', 'Approved'), item(3, 3, 'pending'), item(2, 2, 'pending')];
  assert.equal(currentItem(items, 'in_progress')?.id, 2, 'by item number, not by position');
  assert.equal(currentItem(items, 'scheduled'), null);
  assert.equal(currentItem(items, 'completed'), null);
  assert.equal(currentItem([item(1, 1, 'discussed', 'Noted')], 'in_progress'), null, 'nothing left to decide');
  assert.equal(currentItem([item(1, 1, 'pending', 'Noted')], 'in_progress'), null, 'an item with an outcome is decided whatever its status says');
  assert.equal(undecidedItems([...items, item(4, 4, 'deferred', 'Deferred')]), 2);
  assert.equal(undecidedItems([]), 0);
});

test('the four outcomes, in the server\'s spelling; any case is read, anything else is none', () => {
  assert.deepEqual([...OUTCOMES], ['Approved', 'Rejected', 'Deferred', 'Noted']);
  assert.equal(DEFAULT_OUTCOME, 'Approved');
  assert.equal(outcomeWord('approved'), 'Approved');
  assert.equal(outcomeWord(' NOTED '), 'Noted');
  assert.equal(outcomeWord('Escalated'), null);
  assert.equal(outcomeWord(null), null);
  assert.equal(DECISION_MAX, 10_000);
});

test('the outcome\'s body carries the word and the decision trimmed; an empty decision clears it', () => {
  assert.deepEqual(outcomeBody('Deferred', '  Next month  '), { outcome: 'Deferred', decision_made: 'Next month' });
  assert.deepEqual(outcomeBody('Noted', '   '), { outcome: 'Noted', decision_made: null });
});

test('an outcome is recorded while the meeting runs and corrected after it ends, never before it starts, and not once the minutes are approved', () => {
  assert.equal(canRecordOutcome('in_progress', null), true);
  assert.equal(canRecordOutcome('in_progress', 'draft'), true);
  assert.equal(canRecordOutcome('completed', 'draft'), true, 'a correction, audited by the server');
  assert.equal(canRecordOutcome('completed', 'approved'), false);
  assert.equal(canRecordOutcome('scheduled', null), false);
  assert.equal(canRecordOutcome('cancelled', null), false);
  assert.equal(canRecordOutcome(undefined, undefined), false);
});
