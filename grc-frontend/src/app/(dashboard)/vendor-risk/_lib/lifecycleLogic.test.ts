// node --test "src/app/(dashboard)/vendor-risk/_lib/lifecycleLogic.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STAGES, approvalNote, changed, changesFrom, chartFacts, conditionState, decisionAvailable, decisionWord, draftKey, firstDecision, fixAction,
  historyLine, openChecks, orderChecks, overrideReady, owed, railNote, segments, settled, shownHistory, skippedBy, tierRequest,
  visibleQuestions, type Check, type StageFact,
} from './lifecycleLogic.ts';

const stage = (key: string, status: string, over: Partial<StageFact> = {}): StageFact => ({ stage_key: key, status, ...over });
/** An assessment at `current`: what is before it complete, what is after not started. */
const work = (current: string, over: Record<string, Partial<StageFact>> = {}): StageFact[] => {
  const at = STAGES.findIndex((s) => s.key === current);
  return STAGES.map((s, i) => stage(s.key, i < at ? 'complete' : i === at ? 'in_progress' : 'not_started', over[s.key]));
};
const check = (key: string, met: boolean | null, over: Partial<Check> = {}): Check => ({ key, text: key, met, fix: null, ...over });

test('there are eleven stages in three groups and two gates, in the order the server runs them', () => {
  assert.equal(STAGES.length, 11);
  assert.deepEqual(STAGES.filter((s) => s.gate).map((s) => s.key), ['tiering', 'approval']);
  assert.deepEqual([0, 1, 2].map((g) => STAGES.filter((s) => s.group === g).length), [4, 4, 3]);
});

test('checks are ordered blocking, then not answerable yet, then met, each in the server order', () => {
  const ordered = orderChecks([check('a', true), check('b', null), check('c', false), check('d', true), check('e', false)]);
  assert.deepEqual(ordered.map((c) => c.key), ['c', 'e', 'b', 'a', 'd']);
  assert.equal(openChecks([check('a', true), check('b', false), check('c', null)]), 1);
  assert.equal(openChecks(null), 0);
});

test('a fix button goes to the tab, the page, the stage or the dialog its code names', () => {
  const at = { vendorId: 7, engagementId: null as number | null, firstOpen: 'dd_planning' };
  assert.deepEqual(fixAction('tier', at), { kind: 'tier' });
  assert.deepEqual(fixAction('edit_vendor', at), { kind: 'stage', stage: 'intake' });
  assert.deepEqual(fixAction('decision', at), { kind: 'stage', stage: 'approval' });
  assert.deepEqual(fixAction('lifecycle', at), { kind: 'stage', stage: 'dd_planning' });
  assert.deepEqual(fixAction('questionnaire', at), { kind: 'href', href: '/vendor-risk/vendors/7?tab=assessments' });
  assert.deepEqual(fixAction('findings', { ...at, engagementId: 3 }), { kind: 'href', href: '/vendor-risk/vendors/7?tab=findings&engagement=3' });
  assert.deepEqual(fixAction('paperwork', at), { kind: 'href', href: '/vendor-risk/vendors/7?tab=paperwork' });
  assert.deepEqual(fixAction('roster', at), { kind: 'href', href: '/vendor-risk/roster' });
});

test('the chart has a segment per stage: done, the current one (amber while checks are open), skipped, upcoming', () => {
  const rows = work('questionnaire', { dd_planning: { status: 'skipped' } });
  const states = (blocked: boolean) => segments(rows, 'questionnaire', blocked).map((s) => s.state);
  assert.deepEqual(states(false), ['done', 'done', 'skipped', 'current', ...Array(7).fill('upcoming')]);
  assert.equal(states(true)[3], 'blocked');
  assert.equal(settled(rows), 3);
});

test('the chart says where the work is, how many are settled, and what is left to clear', () => {
  const rows = work('contracting', { dd_planning: { status: 'skipped' } });
  assert.deepEqual(chartFacts(rows, 'contracting', [check('a', false), check('b', true)]),
    { label: 'Contracting & Controls', settled: 6, toClear: 1, done: 5, skipped: 1, toGo: 5 });
  assert.equal(chartFacts(STAGES.map((s) => stage(s.key, 'complete')), 'reassessment').label, 'All stages settled');
  assert.equal(chartFacts([], null).label, 'Not started');
});

test('the rail names the open checks on the current stage, Now, Skipped, and the tier on the tiering row', () => {
  assert.deepEqual(railNote(stage('findings', 'in_progress'), true, 2), { text: '2 open', tone: 'warning' });
  assert.deepEqual(railNote(stage('findings', 'in_progress'), true, 0), { text: 'Now', tone: 'progress' });
  assert.deepEqual(railNote(stage('scoring', 'skipped'), false, 0), { text: 'Skipped', tone: 'neutral' });
  assert.deepEqual(railNote(stage('tiering', 'complete'), false, 0, 'high'), { text: 'High', tone: 'neutral' });
  assert.equal(railNote(stage('intake', 'complete'), false, 0), null);
  assert.equal(railNote(undefined, false, 0), null);
});

test('a skipped stage says whether the policy or a person skipped it, and why', () => {
  assert.deepEqual(skippedBy(stage('scoring', 'skipped', { skipped_reason: 'Auto-skipped — right-sized by inherent tier' })),
    { byPolicy: true, reason: 'right-sized by inherent tier' });
  assert.deepEqual(skippedBy(stage('scoring', 'skipped', { skipped_by: 4, skipped_reason: 'Not needed for this supplier' })),
    { byPolicy: false, reason: 'Not needed for this supplier' });
  assert.deepEqual(skippedBy(stage('scoring', 'skipped')), { byPolicy: true, reason: 'right-sized by its tier' });
});

test('the history reads as sentences, newest first, six at a time', () => {
  const row = (action: string, from: string | null, to: string | null) => ({ id: 1, action, from, to, reason: null, actor: null, at: null, review: 1 });
  assert.equal(historyLine(row('transition', 'intake', 'tiering')), 'Advanced Intake & Scoping to Inherent Risk Tiering');
  assert.equal(historyLine(row('send_back', 'contracting', 'dd_planning')), 'Sent back Contracting & Controls to Due Diligence Planning');
  assert.equal(historyLine(row('skip', 'scoring', null)), 'Skipped Risk Analysis & Scoring');
  assert.equal(historyLine(row('reopen', null, 'dd_planning')), 'Reopened Due Diligence Planning');
  const ten = Array.from({ length: 10 }, (_, i) => i);
  assert.deepEqual(shownHistory(ten, false), [0, 1, 2, 3, 4, 5]);
  assert.equal(shownHistory(ten, true).length, 10);
});

const section = { key: 'data', title: 'Data', questions: [
  { key: 'personal_data', type: 'yes_no', required: true, justify: true },
  { key: 'personal_records', type: 'number', show_if: 'personal_data' },
  { key: 'notes', type: 'text' },
  { key: 'engagement_type', type: 'choice', required: true },
] };

test('a question a yes elsewhere hides is not asked and owes nothing', () => {
  assert.deepEqual(visibleQuestions(section, {}).map((q) => q.key), ['personal_data', 'notes', 'engagement_type']);
  assert.deepEqual(visibleQuestions(section, { personal_data: 'yes' }).map((q) => q.key), ['personal_data', 'personal_records', 'notes', 'engagement_type']);
});

test('what is owed: a required question left blank, a yes without its reason; nothing in a section someone else answers', () => {
  assert.deepEqual(owed(section, {}, {}, 10), ['personal_data', 'engagement_type']);
  assert.deepEqual(owed(section, { personal_data: 'yes', engagement_type: 'saas' }, {}, 10), ['personal_data']);
  assert.deepEqual(owed(section, { personal_data: 'yes', engagement_type: 'saas' }, { personal_data: 'Holds staff files.' }, 10), []);
  assert.deepEqual(owed(section, { personal_data: 'no', engagement_type: 'saas' }, {}, 10), []);
  assert.deepEqual(owed({ ...section, can_answer: false }, {}, {}, 10), []);
});

test('only what differs from what is saved is sent', () => {
  assert.deepEqual(changed({ a: 'yes', b: 'no', c: [1, 2] }, { a: 'yes', b: 'yes', c: [1, 2] }), { b: 'no' });
  assert.deepEqual(changed({ a: null }, {}), {});                       // null and absent are the same
  assert.deepEqual(changed({ a: 'yes' }, {}), { a: 'yes' });
  assert.deepEqual(changed({ a: '', b: [] }, {}), {});                  // so are an empty text and an empty list
  assert.deepEqual(changed({ a: '' }, { a: 'yes' }), { a: '' });        // an answer taken back is sent empty
});

test('the dialog says what the tier changes from, only when it differs', () => {
  assert.equal(changesFrom('high', 'critical'), 'High');
  assert.equal(changesFrom('high', 'high'), null);
  assert.equal(changesFrom(null, 'high'), null);
  assert.equal(changesFrom('high', undefined), null);
});

test('a draft is kept per supplier and engagement; an override needs its reason only when it overrides', () => {
  assert.equal(draftKey(7, null), '7:general');
  assert.equal(draftKey(7, 3), '7:3');
  assert.equal(overrideReady('', ''), true);
  assert.equal(overrideReady('high', 'too short'), false);
  assert.equal(overrideReady('high', 'The answers miss the data flows'), true);
});

test('?tier=1 asks for the engagement on the page, ?tier=<id> for that one, nothing for no parameter', () => {
  assert.deepEqual(tierRequest(null, 5), { open: false, engagement: 5 });
  assert.deepEqual(tierRequest('1', 5), { open: true, engagement: 5 });
  assert.deepEqual(tierRequest('1', null), { open: true, engagement: null });
  assert.deepEqual(tierRequest('5', 5), { open: true, engagement: 5 });
  assert.deepEqual(tierRequest('9', 5), { open: false, engagement: 9 });      // switch to it first
  assert.deepEqual(tierRequest('nonsense', 5), { open: true, engagement: 5 });
});

test('an approving decision waits on the other checks and on the person being allowed; defer and reject never do', () => {
  assert.equal(decisionAvailable('approve', false, 0), true);
  assert.equal(decisionAvailable('approve_with_conditions', false, 1), false);
  assert.equal(decisionAvailable('approve', true, 0), false);
  assert.equal(decisionAvailable('defer', true, 3), true);
  assert.equal(decisionAvailable('reject', true, 3), true);
  assert.equal(firstDecision(false, 0), 'approve');
  assert.equal(firstDecision(false, 2), 'defer');
  assert.equal(firstDecision(true, 0), 'defer');
  assert.equal(decisionWord('approve_with_conditions'), 'Approved with conditions');
  assert.equal(decisionWord('defer'), 'Deferred');
});

test('the line under the decision heading says whether it is open, passed, or waiting', () => {
  assert.equal(approvalNote('complete', 0, true), 'Passed.');
  assert.equal(approvalNote('not_started', 0, true), 'Opens when the earlier stages are done.');
  assert.equal(approvalNote('in_progress', 2, true), 'Approving waits on the checks above. Deferring or rejecting does not.');
  assert.equal(approvalNote('in_progress', 0, true), 'Ready for a decision.');
  assert.equal(approvalNote('in_progress', 0, false), 'Needs the right to approve vendors.');
});

test('a condition is open, overdue, met or waived', () => {
  assert.equal(conditionState({ status: 'open', due_date: '2026-12-01' }, '2026-10-29'), 'open');
  assert.equal(conditionState({ status: 'open', due_date: '2026-10-01T00:00:00' }, '2026-10-29'), 'overdue');
  assert.equal(conditionState({ status: 'open' }, '2026-10-29'), 'open');
  assert.equal(conditionState({ status: 'closed', due_date: '2026-10-01' }, '2026-10-29'), 'met');
  assert.equal(conditionState({ status: 'closed', waived: true }, '2026-10-29'), 'waived');
});
