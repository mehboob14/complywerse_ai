// node --test "src/app/(dashboard)/governance/exceptions/_approval.test.ts"
// What the Policy exceptions page says about an exception's approval under a rule: which step it is at and who it waits for, how each step stands, who decided
// what, and what the person asked now may do. The shapes are what exception_approvals._run_view and history send.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  APPROVE_HINT, approveBlocked, approveBlockedFor, decisionOptions, decisionRows, dueText, earlierRounds, implementationDue, implementationOpen, implementationTone,
  implementationWord, implementedLine, implementerLine, isRuled, progressText, roundMeta, runTone, runWord, slotChips, statusDetail, statusLine, stepLine, stepWord, waitingLine,
} from './_approval.ts';
import type { ApprovalStep, ExceptionApproval, Implementation } from './_types.ts';

const step = (over: Partial<ApprovalStep> = {}): ApprovalStep => ({
  position: 1, name: 'Review', kind: 'review', order: 'together', rule: 'all', min_count: null, due_days: null, allow_reject: false, allow_changes: true, state: 'done',
  activated_at: null, due_at: null, completed_at: null, overdue: false, slots: [], progress: { required: 1, answered: 1 }, ...over,
});
const approval = (over: Partial<ExceptionApproval> = {}): ExceptionApproval => ({
  run_id: 1, round: 1, status: 'open', rule: { id: 1, name: 'Support exceptions' }, department_id: 11, current_step: 2, my_step: null, started_at: '2026-11-03T09:00:00',
  finished_at: null, stalled: false, decisions: [], asked: [{ id: 5, name: 'App1' }, { id: 6, name: 'App2' }],
  steps: [step(), step({ position: 2, name: 'Approval', kind: 'approval', state: 'active', progress: { required: 2, answered: 1 } }), step({ position: 3, name: 'Sign-off', kind: 'approval', state: 'waiting' })],
  ...over,
});

test('it waits under a rule only while a run is open: a closed one, or none, is the older flow', () => {
  assert.equal(isRuled({ approval: approval() }), true);
  for (const status of ['approved', 'rejected', 'changes_requested', 'withdrawn'] as const) assert.equal(isRuled({ approval: approval({ status }) }), false, status);
  assert.equal(isRuled({ approval: null }), false);
  assert.equal(isRuled({}), false);
});

test('where it is: "Step 2 of 3 · Approval" while a step is open, nothing otherwise', () => {
  assert.equal(stepLine(approval()), 'Step 2 of 3 · Approval');
  assert.equal(stepLine(approval({ current_step: 3 })), 'Step 3 of 3 · Sign-off');
  assert.equal(stepLine(approval({ status: 'approved', current_step: 3 })), '');
  assert.equal(stepLine(approval({ current_step: null })), '');
});

test('who it waits for: up to three names then "and N more"; nobody who can act is said; a run that is over waits for nobody', () => {
  assert.equal(waitingLine(approval()), 'Waiting for App1, App2');
  const many = ['A', 'B', 'C', 'D', 'E'].map((name, id) => ({ id, name }));
  assert.equal(waitingLine(approval({ asked: many })), 'Waiting for A, B, C and 2 more');
  assert.equal(waitingLine(approval({ asked: [], stalled: true })), 'Nobody can act');
  assert.equal(waitingLine(approval({ asked: [] })), 'Nobody can act');
  assert.equal(waitingLine(approval({ status: 'rejected', asked: [] })), '');
});

test('the status cell of the list: the step and who it waits for under a rule, a draft sent back says so, anything else nothing more', () => {
  assert.deepEqual(statusDetail({ status: 'pending_approval', approval: approval() }), { step: 'Step 2 of 3 · Approval', waiting: 'Waiting for App1, App2' });
  assert.deepEqual(statusDetail({ status: 'draft', approval: approval({ status: 'changes_requested', asked: [] }) }), { step: 'Changes asked for', waiting: '' });
  assert.equal(statusDetail({ status: 'draft', approval: approval({ status: 'withdrawn', asked: [] }) }), null);
  assert.equal(statusDetail({ status: 'approved', approval: approval({ status: 'approved', asked: [] }) }), null);
  assert.equal(statusDetail({ status: 'pending_approval', approval: null }), null);                                 // the older flow looks as it always did
  assert.equal(statusDetail({ status: 'pending_approval' }), null);
});

test('each round of the approval has a word and a tone, and a word nobody registered is said readably, never hidden', () => {
  assert.deepEqual(['open', 'approved', 'rejected', 'changes_requested', 'withdrawn'].map(runWord), ['In approval', 'Approved', 'Rejected', 'Changes asked for', 'Withdrawn']);
  assert.deepEqual(['open', 'approved', 'rejected', 'changes_requested', 'withdrawn'].map(runTone), ['pending', 'success', 'danger', 'warning', 'neutral']);
  assert.equal(runWord('on_hold'), 'On hold');
  assert.equal(runWord(''), '—');
  assert.equal(runTone('on_hold'), 'neutral');
});

test('how a step stands: done, the one asked now (overdue when its days are up), later; once the run is over, where it ended', () => {
  assert.deepEqual(stepWord({ state: 'done', overdue: false }, 'open'), { label: 'Done', tone: 'success' });
  assert.deepEqual(stepWord({ state: 'active', overdue: false }, 'open'), { label: 'Now', tone: 'pending' });
  assert.deepEqual(stepWord({ state: 'active', overdue: true }, 'open'), { label: 'Overdue', tone: 'danger' });
  assert.deepEqual(stepWord({ state: 'waiting', overdue: false }, 'open'), { label: 'Later', tone: 'neutral' });
  assert.deepEqual(stepWord({ state: 'active', overdue: false }, 'rejected'), { label: 'Rejected', tone: 'danger' });
  assert.deepEqual(stepWord({ state: 'active', overdue: false }, 'changes_requested'), { label: 'Changes asked', tone: 'warning' });
  assert.deepEqual(stepWord({ state: 'active', overdue: false }, 'withdrawn'), { label: 'Withdrawn', tone: 'neutral' });
  assert.deepEqual(stepWord({ state: 'waiting', overdue: false }, 'rejected'), { label: 'Not reached', tone: 'neutral' });
  assert.deepEqual(stepWord({ state: 'done', overdue: false }, 'approved'), { label: 'Done', tone: 'success' });
});

test('a step\'s progress is "1 of 2" (nothing when it is not known), and its due day is said only for the step asked now', () => {
  assert.equal(progressText({ required: 2, answered: 1 }), '1 of 2');
  assert.equal(progressText({ required: 1, answered: 0 }), '0 of 1');
  assert.equal(progressText({ required: 0, answered: 0 }), '');
  assert.equal(dueText({ state: 'active', due_at: '2026-11-14T09:00:00' }), 'Due 14 Nov 2026');
  assert.equal(dueText({ state: 'active', due_at: null }), '');
  assert.equal(dueText({ state: 'waiting', due_at: '2026-11-14T09:00:00' }), '');
  assert.equal(dueText({ state: 'done', due_at: '2026-11-14T09:00:00' }), '');
});

test('who a step asks, one chip each: a person is their name, a role or an owner says who would answer, an answered one says who did', () => {
  const chips = slotChips(step({ slots: [
    { label: 'Rev1', answered: true, by: ['Rev1'], people: ['Rev1'] },
    { label: 'Role: Approvers', answered: true, by: ['App2'], people: ['App1', 'App2', 'App3'] },
    { label: 'Role: Risk committee', answered: false, by: [], people: ['R1', 'R2', 'R3', 'R4'] },
    { label: 'Owner of Helpdesk (none set)', answered: false, by: [], people: [] },
  ] }));
  assert.deepEqual(chips, [
    { text: 'Rev1', answered: true }, { text: 'Role: Approvers · App2', answered: true }, { text: 'Role: Risk committee · R1, R2, R3 +1', answered: false },
    { text: 'Owner of Helpdesk (none set)', answered: false },
  ]);
});

test('who decided what, in the order it was decided, with the comment and the step, and the time on the viewer\'s clock', () => {
  const rows = decisionRows([
    { step_position: 1, step_name: 'Review', user_name: 'Rev1', decision: 'approve', comment: ' Looks fine ', decided_at: '2026-11-04T10:30:00' },
    { step_position: 2, step_name: 'Approval', user_name: null, decision: 'changes', comment: 'Add the compensating control', decided_at: null },
    { step_position: 2, step_name: 'Approval', user_name: 'App1', decision: 'reject', comment: null, decided_at: '2026-11-05T08:00:00' },
  ]);
  assert.deepEqual(rows.map((r) => [r.who, r.word, r.tone, r.step, r.comment]), [
    ['Rev1', 'Approved', 'success', 'Step 1 · Review', 'Looks fine'],
    ['—', 'Asked for changes', 'warning', 'Step 2 · Approval', 'Add the compensating control'],
    ['App1', 'Rejected', 'danger', 'Step 2 · Approval', ''],
  ]);
  assert.equal(rows[1].when, '—');
  assert.match(rows[0].when, /^\d{1,2} Nov 2026, \d{2}:\d{2}$/);
  assert.equal(new Set(rows.map((r) => r.key)).size, 3);
});

test('the earlier rounds are every round but the one on show, newest first; each says what it ran under and when it started', () => {
  const round = (n: number, status: ExceptionApproval['status']) => ({ round: n, status, rule_name: 'Rule', started_at: '2026-11-0' + n + 'T09:00:00', started_by: 'Rita', finished_at: null, decisions: [] });
  const history = { rounds: [round(1, 'changes_requested'), round(2, 'withdrawn'), round(3, 'open')], current: null };
  assert.deepEqual(earlierRounds(history, 3).map((r) => r.round), [2, 1]);
  assert.deepEqual(earlierRounds(undefined, 3), []);
  assert.equal(roundMeta(round(1, 'withdrawn')), 'Rule · started 1 Nov 2026 by Rita');
  assert.equal(roundMeta({ rule_name: 'Rule', started_at: null, started_by: null }), 'Rule');
});

test('the person asked may approve, and ask for changes or reject only where the open step allows it; anyone else has nothing', () => {
  assert.deepEqual(decisionOptions({ can_reject: true, can_ask_changes: true }), ['approve', 'changes', 'reject']);
  assert.deepEqual(decisionOptions({ can_reject: false, can_ask_changes: true }), ['approve', 'changes']);
  assert.deepEqual(decisionOptions({ can_reject: true, can_ask_changes: false }), ['approve', 'reject']);
  assert.deepEqual(decisionOptions({ can_reject: false, can_ask_changes: false }), ['approve']);
  assert.deepEqual(decisionOptions(null), []);
  assert.deepEqual(decisionOptions(undefined), []);
});

// ── the assessment an approval needs, and the implementation after the last approval (D62) ──────────────────────────────────

const myStep = (recorded: boolean) => ({ position: 2, name: 'Approval', kind: 'approval' as const, can_reject: true, can_ask_changes: true, assessment: { recorded, none_identified: false, count: recorded ? 1 : 0 } });
const implementation = (over: Partial<Implementation> = {}): Implementation => ({
  state: 'waiting', name: 'Implementation', asked: [{ id: 7, name: 'Chen' }, { id: 8, name: 'Bina' }], due_at: '2026-11-14T09:00:00', overdue: false, opened_at: '2026-11-09T09:00:00',
  completed_at: null, completed_by_name: null, note: null, stalled: false, my_turn: false, can_complete: false, controls_count: 0, risks_count: 2, uncovered_count: 2, ...over,
});

test('Approve waits for the person\'s own assessment at the open step: nothing recorded blocks it, a risk or "none identified" frees it; nobody asked blocks nothing', () => {
  assert.equal(approveBlocked(myStep(false)), true);
  assert.equal(approveBlocked(myStep(true)), false);
  assert.equal(approveBlocked(null), false);
  assert.equal(approveBlocked(undefined), false);
  assert.equal(approveBlocked({ assessment: null }), false);                    // a server that sends no assessment (the older flow) never blocks
  assert.equal(approveBlockedFor({ approval: approval({ my_step: myStep(false) }) }), true);
  assert.equal(approveBlockedFor({ approval: approval({ my_step: myStep(true) }) }), false);
  assert.equal(approveBlockedFor({ approval: approval({ status: 'approved', my_step: myStep(false) }) }), false);   // only a run that is open asks anyone
  assert.equal(approveBlockedFor({ approval: null }), false);
  assert.equal(approveBlockedFor({}), false);
  assert.equal(APPROVE_HINT, 'Record a potential risk, or none identified, to approve.');
});

test('the implementation has a word and a tone for each state, and a state nobody registered is said readably', () => {
  assert.deepEqual(['waiting', 'in_progress', 'done', 'cancelled'].map(implementationWord), ['Waiting for compensating controls', 'In progress', 'Implemented', 'Cancelled']);
  assert.deepEqual(['waiting', 'in_progress', 'done', 'cancelled'].map(implementationTone), ['pending', 'progress', 'success', 'neutral']);
  assert.equal(implementationWord('on_hold'), 'On hold');
  assert.equal(implementationWord(''), '—');
  assert.equal(implementationTone('on_hold'), 'neutral');
  assert.equal(implementationOpen({ state: 'waiting' }), true);
  assert.equal(implementationOpen({ state: 'in_progress' }), true);
  assert.equal(implementationOpen({ state: 'done' }), false);
  assert.equal(implementationOpen(null), false);
});

test('the header line says the status and, once approved under a rule with an implementer, where the implementation stands', () => {
  assert.equal(statusLine('approved', { state: 'waiting' }), 'Approved · Waiting for compensating controls');
  assert.equal(statusLine('approved', { state: 'in_progress' }), 'Approved · In progress');
  assert.equal(statusLine('approved', { state: 'done' }), 'Approved · Implemented');
  assert.equal(statusLine('approved', null), 'Approved');
  assert.equal(statusLine('pending_approval', undefined), 'Pending approval');
});

test('who the implementation waits for, when it is due and who finished it: names, never numbers', () => {
  assert.equal(implementerLine(implementation()), 'Waiting for Chen, Bina');
  assert.equal(implementerLine(implementation({ state: 'in_progress', asked: ['A', 'B', 'C', 'D', 'E'].map((name, id) => ({ id, name })) })), 'Waiting for A, B, C and 2 more');
  assert.equal(implementerLine(implementation({ stalled: true })), 'Nobody can act');
  assert.equal(implementerLine(implementation({ asked: [] })), 'Nobody can act');
  assert.equal(implementerLine(implementation({ state: 'done' })), '');
  assert.equal(implementerLine(implementation({ state: 'cancelled' })), '');
  assert.equal(implementationDue(implementation()), 'Due 14 Nov 2026');
  assert.equal(implementationDue(implementation({ overdue: true })), 'Overdue since 14 Nov 2026');
  assert.equal(implementationDue(implementation({ due_at: null })), '');
  assert.equal(implementationDue(implementation({ state: 'done', overdue: true })), '');
  assert.equal(implementedLine(implementation({ state: 'done', completed_by_name: 'Bina', completed_at: '2026-11-12T09:00:00' })), 'Implemented by Bina · 12 Nov 2026');
  assert.equal(implementedLine(implementation({ state: 'done' })), 'Implemented');
  assert.equal(implementedLine(implementation()), '');
});
