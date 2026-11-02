// node --test "src/app/(dashboard)/vendor-risk/_lib/assessmentsLogic.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  creditTone, dueInDays, kindLabel, linkDays, movedLine, movement, reachable, reassessBlocked, resendTarget, sendBlocked,
  sendHint, statusPill, type CardFacts,
} from './assessmentsLogic.ts';

const card = (over: Partial<CardFacts> = {}): CardFacts => ({
  id: 1, name: 'Security', template_id: 5, status: 'pending', expired: false, active: true, answered: 0, questions: 10,
  contact: null, ...over,
});

test('a card wears the status in our words; a link that ran out reads Expired while answers are owed', () => {
  assert.deepEqual(statusPill('pending', false), { label: 'Not started', tone: 'pending' });
  assert.deepEqual(statusPill('in_progress', false), { label: 'In progress', tone: 'progress' });
  assert.deepEqual(statusPill('returned', false), { label: 'Returned', tone: 'warning' });
  assert.deepEqual(statusPill('submitted', false), { label: 'Submitted', tone: 'progress' });
  assert.deepEqual(statusPill('under_review', false), { label: 'In review', tone: 'progress' });
  assert.deepEqual(statusPill('accepted', false), { label: 'Accepted', tone: 'success' });
  assert.deepEqual(statusPill('pending', true), { label: 'Expired', tone: 'danger' });
  assert.deepEqual(statusPill('something_new', false), { label: 'Something new', tone: 'neutral' });
});

test('the kind reads "Initial · cycle 1" and "Reassessment · cycle 2"', () => {
  assert.equal(kindLabel('initial', 1), 'Initial · cycle 1');
  assert.equal(kindLabel('reassessment', 3), 'Reassessment · cycle 3');
  assert.equal(kindLabel('follow_up', 2), 'Follow-up · cycle 2');
  assert.equal(kindLabel('unlinked', null), 'Not in a review');
  assert.equal(kindLabel('initial', null), 'Initial');
});

test('Send is blocked until the engagement is tiered and a contact with an email exists, and while it is closed', () => {
  const scope = { tiered: true, approval_passed: false, closed: null };
  const sam = { email: 'sam@x.test', portal_access: true, archived_at: null };
  assert.equal(sendBlocked(scope, [sam]), null);
  assert.equal(sendBlocked({ ...scope, tiered: false }, [sam]), 'Tier the engagement first.');
  assert.equal(sendBlocked(scope, []), 'Add a vendor contact with an email first.');
  assert.equal(sendBlocked(scope, [{ email: null }]), 'Add a vendor contact with an email first.');
  assert.equal(sendBlocked(scope, [{ ...sam, archived_at: '2026-01-01' }, { ...sam, portal_access: false }]), 'Add a vendor contact with an email first.');
  assert.equal(sendBlocked({ ...scope, closed: 'This engagement has ended.' }, [sam]), 'This engagement has ended.');
  assert.equal(sendBlocked(scope, undefined), null);                           // contacts still loading: not a reason to block
  assert.equal(sendBlocked(undefined, [sam]), 'Loading');
  assert.equal(reachable({ email: 'a@b.test' }), true);                        // the supplier record's contact has no portal flag
});

test('Reassess waits for the approval to pass', () => {
  assert.equal(reassessBlocked({ tiered: true, approval_passed: true, closed: null }), null);
  assert.equal(reassessBlocked({ tiered: true, approval_passed: false, closed: null }), 'Opens once this review has passed approval.');
  assert.equal(reassessBlocked({ tiered: true, approval_passed: true, closed: 'This vendor is offboarded.' }), 'This vendor is offboarded.');
});

test('sending the questionnaire already out resends it; another goes out as well; otherwise the tier default is said', () => {
  const out = card({ id: 7, status: 'in_progress', answered: 3 });
  const fresh = card({ id: 8, status: 'pending' });
  assert.equal(resendTarget([out], 5)?.id, 7);
  assert.equal(resendTarget([out], 6), null);
  assert.equal(resendTarget([card({ status: 'accepted' })], 5), null);         // answered: sending again is a new one
  assert.equal(resendTarget([card({ active: false })], 5), null);              // an old cycle's is not this review's

  const base = { tierLabel: 'High', isTierDefault: true };
  assert.deepEqual(sendHint({ ...base, templateId: 5, cards: [fresh] }), { tone: 'note', text: 'Already sent. Resending keeps these questions.' });
  assert.deepEqual(sendHint({ ...base, templateId: 5, cards: [out] }), { tone: 'warn', text: 'The vendor has started answering. Resending keeps their answers.' });
  assert.deepEqual(sendHint({ ...base, templateId: 6, cards: [fresh] }), { tone: 'note', text: 'Goes out as well as Security, which is still with the vendor.' });
  assert.deepEqual(sendHint({ ...base, templateId: 6, cards: [] }), { tone: 'note', text: 'The default for High tier vendors.' });
  assert.deepEqual(sendHint({ templateId: 6, cards: [], tierLabel: 'Low', isTierDefault: false }), { tone: 'note', text: 'Not the default for Low tier vendors.' });
  assert.equal(sendHint({ templateId: 6, cards: [], tierLabel: 'Low', isTierDefault: null }), null);
  assert.equal(sendHint({ templateId: 6, cards: [], tierLabel: null, isTierDefault: true }), null);
});

test('a due date is days from today, at least one and at most a year; the link outlives it by a week', () => {
  const today = new Date(2026, 2, 5, 15, 0);                                   // 5 Mar 2026, local
  assert.equal(dueInDays('2026-03-19', today), 14);
  assert.equal(dueInDays('2026-03-05', today), 1);                             // today: the server wants a day at least
  assert.equal(dueInDays('2026-03-01', today), 1);
  assert.equal(dueInDays('2030-01-01', today), 365);
  assert.equal(linkDays(14), 30);
  assert.equal(linkDays(60), 67);
  assert.equal(linkDays(365), 365);
});

test('an answer is green for full credit, amber for part, red for a gap, grey otherwise', () => {
  assert.deepEqual(['full', 'partial', 'gap', 'na', null].map(creditTone), ['success', 'warning', 'danger', 'neutral', 'neutral']);
});

test('the movement against the last cycle reads fell / rose / did not move, down being good, and names a grade change', () => {
  const ch = (change: number | null, now: number | null = 28.3, before: number | null = 40, grade = { now: 'B', before: 'C' }) =>
    ({ residual: { now, before, change }, grade, moved: 0, of: 0, weaker: 0, stronger: 0 });
  assert.deepEqual(movement(ch(-11.7)), { text: '', verb: 'fell', amount: 11.7, tone: 'success', to: 28.3, grade: 'C to B' });
  assert.deepEqual(movement(ch(4, 44, 40, { now: 'C', before: 'C' })), { text: '', verb: 'rose', amount: 4, tone: 'danger', to: 44, grade: null });
  assert.deepEqual(movement(ch(0, 40, 40)).verb, 'did not move');
  assert.equal(movement(ch(null, 28.3, null)).text, 'The previous cycle was not scored.');
  assert.equal(movement(ch(null, null, 40)).text, 'Score this cycle to compare.');
});

test('the line about answers that moved counts both directions, or says none did', () => {
  assert.equal(movedLine({ moved: 0, of: 40, weaker: 0, stronger: 0 }), 'No answers changed.');
  assert.equal(movedLine({ moved: 6, of: 40, weaker: 2, stronger: 3 }), '6 of 40 answers moved: 2 weaker, 3 stronger.');
  assert.equal(movedLine({ moved: 1, of: 40, weaker: 1, stronger: 0 }), '1 of 40 answers moved: 1 weaker.');
  assert.equal(movedLine({ moved: 2, of: 9, weaker: 0, stronger: 0 }), '2 of 9 answers moved.');      // a change of words that ranks the same
});
