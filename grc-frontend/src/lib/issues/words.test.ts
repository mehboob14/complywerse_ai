// node --test "src/lib/issues/words.test.ts"
// The rules the issue screens share: one definition of open (the one the server's by-source lookup and the BCM findings already use), the guided steps equal the server's allowed
// transitions (and never offer an unguarded "closed"), what is late (issues by their target date, actions by their due date), and the address form of "linked to this record".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ACTION_STATUSES, ACTION_STATUS_OPTIONS, actionStepsFrom, ISSUE_STATES, ISSUE_TYPE_OPTIONS, LEVEL_OPTIONS, OPEN_ACTION_STATUSES, OPEN_STATES, SEVERITY_OPTIONS, awaitsVerification, daysLate, isActionLate,
  eventLine, isAwaitingClosure, isIssueLate, isOpenAction, isOpenIssue, isSerious, lateWord, linkedValue, parseLinked, severityRank, sourceWord, stateOf, stepTargets, stepsFrom,
} from './words.ts';
import { issueState } from '../statuses/issues.ts';

const BACKEND = fileURLToPath(new URL('../../../../backend/grc/modules/issue_management/routers/', import.meta.url));
const read = (f: string) => readFileSync(`${BACKEND}${f}`, 'utf8');
const NOW = new Date('2026-11-08T12:00:00Z');

test('open is one rule: the five states by-source counts (closure review included), and a state nobody listed is not open', () => {
  const server = /open_states = \{([^}]*)\}/.exec(read('by_source.py'))![1];
  assert.deepEqual(Array.from(server.matchAll(/"([a-z_]+)"/g)).map((m) => m[1]).sort(), OPEN_STATES.slice().sort());
  assert.deepEqual(ISSUE_STATES.filter(isOpenIssue), OPEN_STATES.slice());
  assert.equal(stateOf(undefined), 'new');
  assert.equal(isOpenIssue(null), true, 'an issue with no state is a new one');
  assert.equal(isOpenIssue('on_hold'), false);
  assert.equal(isAwaitingClosure('closure_review'), true);
  assert.equal(isAwaitingClosure('closed'), false);
  assert.deepEqual(ISSUE_STATES.slice(), issueState.words.slice(), 'the life cycle and the registry list the same states in the same order');
});

test('the guided steps are the server\'s allowed transitions, closing is never a plain move, and each state expects at most one next step', () => {
  const block = /ALLOWED_TRANSITIONS = \{([\s\S]*?)\n\}/.exec(read('issues.py'))![1];
  const server: Record<string, string[]> = {};
  Array.from(block.matchAll(/"([a-z_]+)":\s*\{([^}]*)\}/g)).forEach((m) => { server[m[1]] = Array.from(m[2].matchAll(/"([a-z_]+)"/g)).map((x) => x[1]).sort(); });
  const ours = stepTargets();
  assert.deepEqual(Object.keys(ours).sort(), Object.keys(server).sort());
  for (const state of Object.keys(server)) assert.deepEqual(ours[state].slice().sort(), server[state], state);
  for (const state of ISSUE_STATES) {
    const steps = stepsFrom(state);
    steps.filter((s) => s.to === 'closed').forEach((s) => assert.equal(s.kind, 'close', `${state}: closing asks for the notes`));
    steps.filter((s) => s.kind === 'reopen').forEach((s) => assert.equal(state, 'closed'));
    assert.ok(steps.filter((s) => s.primary).length <= 1, state);
    assert.equal(new Set(steps.map((s) => s.key)).size, steps.length, `${state}: one key per step`);
    steps.forEach((s) => assert.match(s.label, /^[A-Z][a-z]/, `${state}.${s.key}`));
  }
  assert.deepEqual(stepsFrom('closure_review').map((s) => [s.label, s.kind]), [['Approve closure', 'close'], ['Send back to work', 'move']]);
  assert.deepEqual(stepsFrom('closed').map((s) => s.kind), ['reopen']);
  assert.deepEqual(stepsFrom('nobody-knows'), []);
  assert.deepEqual(stepsFrom(undefined).map((s) => s.to), ['triage', 'in_progress', 'cancelled'], 'no state is a new issue');
});

test('an issue is late when its target date has passed and it is not closed or cancelled; the days are whole and never zero', () => {
  assert.equal(daysLate('2026-11-05T12:00:00', NOW), 3, 'naive server time is UTC');
  assert.equal(daysLate('2026-11-08T09:00:00', NOW), 1, 'three hours late is one day late, not none');
  assert.equal(daysLate('2026-11-09T09:00:00', NOW), null);
  assert.equal(daysLate(null, NOW), null);
  assert.equal(daysLate('not a date', NOW), null);
  assert.equal(isIssueLate('in_progress', '2026-11-05T00:00:00', NOW), true);
  assert.equal(isIssueLate('closure_review', '2026-11-05T00:00:00', NOW), true, 'still open until somebody approves it');
  assert.equal(isIssueLate('closed', '2026-11-05T00:00:00', NOW), false);
  assert.equal(isIssueLate('cancelled', '2026-11-05T00:00:00', NOW), false);
  assert.equal(isIssueLate('new', null, NOW), false, 'no target date, no lateness');
  assert.equal(isIssueLate(undefined, '2026-11-05T00:00:00', NOW), true);
  assert.equal(lateWord(1), '1 day late');
  assert.equal(lateWord(3), '3 days late');
});

test('an action is late when it is still open and its due date has passed (the scorecard\'s overdue action)', () => {
  assert.deepEqual(OPEN_ACTION_STATUSES.slice(), ['planned', 'in_progress', 'blocked']);
  assert.deepEqual(ACTION_STATUSES.filter(isOpenAction), ['planned', 'in_progress', 'blocked']);
  assert.equal(isOpenAction(null), true, 'an action with no status is a planned one');
  assert.equal(isActionLate('in_progress', '2026-11-05T00:00:00', NOW), true);
  assert.equal(isActionLate('completed', '2026-11-05T00:00:00', NOW), false);
  assert.equal(isActionLate('cancelled', '2026-11-05T00:00:00', NOW), false);
  assert.equal(isActionLate('planned', null, NOW), false);
  assert.equal(awaitsVerification('completed'), true);
  assert.equal(awaitsVerification('verified'), false);
});

test('severity: worst first, critical or high is serious, an unknown word goes last', () => {
  assert.deepEqual(['informational', 'low', 'critical', 'medium', 'high', 'odd'].sort((a, b) => severityRank(a) - severityRank(b)), ['critical', 'high', 'medium', 'low', 'informational', 'odd']);
  assert.deepEqual(['critical', 'high', 'medium', 'low', 'informational', null].map(isSerious), [true, true, false, false, false, false]);
});

test('"linked to this record" in an address: a known kind and a positive number, nothing else', () => {
  assert.deepEqual(parseLinked('risk:7'), { type: 'risk', id: 7 });
  assert.deepEqual(parseLinked(' control_internal:12 '), { type: 'control_internal', id: 12 });
  for (const bad of ['', 'risk', 'risk:', 'risk:0', 'risk:-1', 'risk:1.5', 'banana:3', 'constructor:3', 'risk:1234567890', null, undefined]) assert.equal(parseLinked(bad as never), null, String(bad));
  assert.equal(linkedValue({ type: 'asset', id: 4 }), 'asset:4');
});

test('the options of the selects carry the registry\'s labels, and a source with no word is a hand-raised issue', () => {
  assert.deepEqual(SEVERITY_OPTIONS.map((o) => o.label), ['Critical', 'High', 'Medium', 'Low', 'Informational']);
  assert.deepEqual(LEVEL_OPTIONS.map((o) => o.label), ['High', 'Medium', 'Low']);
  assert.deepEqual(ISSUE_TYPE_OPTIONS.map((o) => o.value), ['incident', 'audit_finding', 'non_conformance', 'vendor_breach', 'process_gap', 'capa', 'other']);
  assert.deepEqual(ACTION_STATUS_OPTIONS.map((o) => o.label), ['Planned', 'In progress', 'Blocked', 'Completed', 'Verified', 'Cancelled']);
  assert.equal(sourceWord(null), 'Raised by hand');
  assert.equal(sourceWord('vulnerability'), 'Vulnerability');
  assert.equal(sourceWord('some_new_source'), 'Some new source');
});

test('an activity row reads as one line: a move names the state it went to, an unlisted type reads as words', () => {
  assert.equal(eventLine('status_change', { from: 'triage', to: 'closure_review' }), 'Moved to Closure review');
  assert.equal(eventLine('status_change', null), 'Moved the issue');
  assert.equal(eventLine('approved'), 'Approved the closure');
  assert.equal(eventLine('some_new_event'), 'Some new event');
  assert.equal(eventLine('action_promoted_to_task'), 'Sent an action to Task Management');
});

test('the steps of an action only lead to statuses the server accepts, verifying is the one that goes through /verify, and each status expects at most one next step', () => {
  const allowed = /allowed = \{([^}]*)\}/.exec(readFileSync(`${BACKEND}actions.py`, 'utf8'))![1];
  const server = Array.from(allowed.matchAll(/"([a-z_]+)"/g)).map((m) => m[1]).sort();
  assert.deepEqual(server, ACTION_STATUSES.slice().sort(), "the statuses of the registry are the server's");
  for (const status of ACTION_STATUSES) {
    const steps = actionStepsFrom(status);
    assert.ok(steps.length > 0, status);
    assert.ok(steps.every((s) => (ACTION_STATUSES as readonly string[]).includes(s.to) && s.to !== status), status);
    assert.ok(steps.filter((s) => s.primary).length <= 1, status);
    assert.deepEqual(steps.filter((s) => s.kind === 'verify').map((s) => s.to), status === 'completed' ? ['verified'] : [], `${status}: only a completed action can be verified`);
  }
  assert.equal(actionStepsFrom(null)[0].to, 'in_progress', 'an action with no status is a planned one');
  assert.deepEqual(actionStepsFrom('what').map((s) => s.key), []);
});
