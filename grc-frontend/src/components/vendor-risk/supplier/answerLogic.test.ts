// node --test "src/components/vendor-risk/supplier/*.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applicable, choicesOf, controlOf, evidenceBox, evidenceRule, gapsOf, isWholeDate, keepApplicable, leaveNote, nextOpen, noteNeeded, owesEvidence,
  pickAnswer, readiness, sectionLabel, sectionRows, sectionsOf, wordsKept, type PortalQuestion,
} from './answerLogic.ts';

const YES_NO = [
  { value: 'yes', label: 'Yes' }, { value: 'partial', label: 'Partial' }, { value: 'no', label: 'No' },
  { value: 'n-a', label: 'Not applicable', na: true },
];
const q = (id: string, extra: Partial<PortalQuestion> = {}): PortalQuestion =>
  ({ id, text: `Question ${id}`, type: 'yes_no', required: true, options: YES_NO, ...extra });

const QUESTIONS: PortalQuestion[] = [
  q('subs'),
  q('subs_list', { type: 'text', required: true, options: [], show_if: { question: 'subs', in: ['yes'] } }),
  q('mfa', { evidence: 'required', evidence_on: ['yes'], section: 'Access' }),
  q('region', { type: 'multiple_choice', required: false, options: [{ value: 'eu', label: 'EU' },
    { value: 'other', label: 'Somewhere else', comment_required: true }] }),
  q('policy', { type: 'file', required: true, options: [] }),
];

test('a follow-up question applies only while the answer that asks for it stands', () => {
  assert.deepEqual(applicable(QUESTIONS, {}).map((x) => x.id), ['subs', 'mfa', 'region', 'policy']);
  assert.deepEqual(applicable(QUESTIONS, { subs: 'Yes' }).map((x) => x.id), ['subs', 'subs_list', 'mfa', 'region', 'policy']);
  assert.deepEqual(applicable(QUESTIONS, { subs: 'no' }).map((x) => x.id), ['subs', 'mfa', 'region', 'policy']);
  // a follow-up of a follow-up needs the one before it to apply too
  const chain = [q('a'), q('b', { show_if: { question: 'a', in: ['yes'] } }), q('c', { show_if: { question: 'b', in: ['yes'] } })];
  assert.deepEqual(applicable(chain, { a: 'no', b: 'yes' }).map((x) => x.id), ['a']);
});

test('answers to questions that no longer apply are forgotten, as the server forgets them', () => {
  assert.deepEqual(keepApplicable(QUESTIONS, { subs: 'no', subs_list: 'Stripe', mfa: 'yes' }), { subs: 'no', mfa: 'yes' });
  assert.deepEqual(keepApplicable(QUESTIONS, { subs: 'yes', subs_list: 'Stripe' }), { subs: 'yes', subs_list: 'Stripe' });
});

test('not applicable needs a reason and a note-required option needs its note; nothing else does', () => {
  assert.equal(noteNeeded(QUESTIONS[2], 'n-a'), 'reason');
  assert.equal(noteNeeded(QUESTIONS[2], 'N-A'), 'reason');
  assert.equal(noteNeeded(QUESTIONS[2], 'yes'), null);
  assert.equal(noteNeeded(QUESTIONS[3], 'other'), 'note');
  assert.equal(noteNeeded(QUESTIONS[3], 'eu'), null);
  assert.equal(noteNeeded(QUESTIONS[3], ''), null);
});

test('a document is owed once an answer that needs one is given', () => {
  assert.equal(owesEvidence(QUESTIONS[2], 'yes'), true);
  assert.equal(owesEvidence(QUESTIONS[2], 'no'), false);                       // evidence_on names Yes only
  assert.equal(owesEvidence(QUESTIONS[2], 'n-a'), false);                      // N/A owes a reason instead
  assert.equal(owesEvidence(QUESTIONS[2], ''), false);                         // nothing answered yet
  assert.equal(owesEvidence(q('x', { evidence: 'required', evidence_on: [] }), 'no'), true);        // any answer
  assert.equal(owesEvidence(q('x', { evidence: 'optional' }), 'yes'), false);
  assert.equal(owesEvidence(q('x', { evidence: 'none' }), 'yes'), false);
  assert.equal(owesEvidence(q('x', { type: 'file', evidence: 'required' }), 'yes'), false);         // the file is the answer
  // from before the rules: the flag meant Yes or Partial
  const old = q('old', { evidence_required: true });
  assert.deepEqual(evidenceRule(old), { mode: 'required', on: ['yes', 'partial'] });
  assert.equal(owesEvidence(old, 'partial'), true);
  assert.equal(owesEvidence(old, 'no'), false);
  assert.deepEqual(evidenceRule(q('plain')), { mode: 'optional', on: [] });
});

test('what an answer still lacks: an answer, its words, its document', () => {
  assert.deepEqual(gapsOf(QUESTIONS[0], '', '', 0), { need: null, answer: true, note: false, document: false });
  assert.deepEqual(gapsOf(QUESTIONS[2], 'n-a', '', 0), { need: 'reason', answer: false, note: true, document: false });
  assert.deepEqual(gapsOf(QUESTIONS[2], 'n-a', 'Not offered', 0), { need: 'reason', answer: false, note: false, document: false });
  assert.deepEqual(gapsOf(QUESTIONS[2], 'yes', '', 0), { need: null, answer: false, note: false, document: true });
  assert.deepEqual(gapsOf(QUESTIONS[2], 'yes', '', 1), { need: null, answer: false, note: false, document: false });
  assert.deepEqual(gapsOf(QUESTIONS[3], '', '', 0), { need: null, answer: false, note: false, document: false });   // optional
  assert.equal(gapsOf(QUESTIONS[4], '', '', 0).answer, true);                  // a required file question is answered by a file
  assert.equal(gapsOf(QUESTIONS[4], '', '', 1).answer, false);
});

test('ready means every required question answered, every word given and every document in', () => {
  let r = readiness(QUESTIONS, {}, {}, {});
  assert.deepEqual([r.shown.length, r.answered, r.left, r.missing, r.ready], [4, 0, ['subs', 'mfa', 'policy'], [], false]);

  r = readiness(QUESTIONS, { subs: 'no', mfa: 'yes' }, {}, {});
  assert.deepEqual([r.left, r.missing, r.open], [['policy'], ['mfa'], ['mfa', 'policy']]);        // open: in page order
  assert.equal(r.answered, 2);

  r = readiness(QUESTIONS, { subs: 'no', mfa: 'yes' }, {}, { mfa: [{}], policy: [{}] });
  assert.deepEqual([r.left, r.missing, r.ready, r.answered], [[], [], true, 3]);

  // a follow-up that opens is another thing to answer, and one that closes is not
  r = readiness(QUESTIONS, { subs: 'yes', mfa: 'no' }, {}, { policy: [{}] });
  assert.deepEqual([r.left, r.ready], [['subs_list'], false]);
  r = readiness(QUESTIONS, { subs: 'no', mfa: 'no', subs_list: 'stale' }, {}, { policy: [{}] });
  assert.equal(r.ready, true);

  // N/A waits for its reason; a note-required option for its note
  r = readiness(QUESTIONS, { subs: 'no', mfa: 'n-a', region: 'other' }, {}, { policy: [{}] });
  assert.deepEqual(r.left, ['mfa', 'region']);
  r = readiness(QUESTIONS, { subs: 'no', mfa: 'n-a', region: 'other' }, { mfa: 'Not offered', region: 'In Dubai' }, { policy: [{}] });
  assert.equal(r.ready, true);
});

test('a returned questionnaire asks only about the questions that were sent back', () => {
  const sentBack = (x: PortalQuestion) => x.id === 'mfa';
  const r = readiness(QUESTIONS, { subs: 'no', mfa: 'yes' }, {}, {}, sentBack);
  assert.deepEqual([r.left, r.missing, r.open], [[], ['mfa'], ['mfa']]);        // policy is not asked about now
  assert.equal(readiness(QUESTIONS, { subs: 'no', mfa: 'yes' }, {}, { mfa: [{}] }, sentBack).ready, true);
});

test('"next to do" walks down the page, skips what is done and starts again at the top', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];
  assert.equal(nextOpen([], order, null), null);
  assert.equal(nextOpen(['b', 'd'], order, null), 'b');
  assert.equal(nextOpen(['b', 'd'], order, 'b'), 'd');
  assert.equal(nextOpen(['b', 'd'], order, 'd'), 'b');                           // wraps
  assert.equal(nextOpen(['d'], order, 'b'), 'd');                                // b was done meanwhile: carry on from where it was
  assert.equal(nextOpen(['a', 'e'], order, 'c'), 'e');
  assert.equal(nextOpen(['a'], order, 'gone'), 'a');                             // jumped to a question that stopped applying
});

test('sections are runs of questions with the same heading, named as the reviewers name them', () => {
  assert.equal(sectionLabel({}), 'General');
  assert.equal(sectionLabel({ domain: 'data_privacy' }), 'Data privacy');
  assert.equal(sectionLabel({ section: ' Access  control ', domain: 'cybersecurity' }), 'Access control');
  assert.equal(sectionLabel({ category: 'FOURTH_PARTY' }), 'Fourth party');
  const groups = sectionsOf([{ id: 1, domain: 'legal' }, { id: 2, domain: 'legal' }, { id: 3 }, { id: 4, domain: 'legal' }]);
  assert.deepEqual(groups.map((g) => [g.label, g.questions.map((x) => x.id)]),
    [['Legal', [1, 2]], ['General', [3]], ['Legal', [4]]]);                      // the order they were written in is kept
});

test('the upload box: green once a document is attached, amber when owed, grey when optional', () => {
  const mfa = QUESTIONS[2];
  const box = (question: PortalQuestion, value: string, count: number) => evidenceBox(question, value, count);
  assert.deepEqual(box(mfa, '', 0), { show: true, tone: 'later', badge: 'Needed for some answers', quiet: false });
  assert.deepEqual(box(mfa, 'yes', 0), { show: true, tone: 'owed', badge: 'Required', quiet: false });
  assert.deepEqual(box(mfa, 'no', 0), { show: true, tone: 'optional', badge: 'Optional', quiet: false });
  assert.deepEqual(box(mfa, 'yes', 1), { show: true, tone: 'attached', badge: '', quiet: false });
  assert.deepEqual(box(q('x', { evidence: 'required', evidence_on: [] }), '', 0), { show: true, tone: 'later', badge: 'Required', quiet: false });
  assert.deepEqual(box(QUESTIONS[4], '', 0), { show: true, tone: 'owed', badge: 'Required', quiet: false });
  assert.deepEqual(box(q('f', { type: 'file', required: false }), '', 0), { show: true, tone: 'optional', badge: 'Optional', quiet: false });
  assert.equal(box(QUESTIONS[4], '', 1).tone, 'attached');
  assert.equal(box(q('x', { evidence: 'none' }), 'yes', 0).show, false);
  assert.equal(box(q('x', { evidence: 'none' }), 'yes', 1).show, true);                  // a file that is there is shown
});

test('a document that is only allowed is offered behind a link; one that is attached or owed is not hidden', () => {
  const optional = q('x', { evidence: 'optional' });
  assert.deepEqual(evidenceBox(optional, '', 0), { show: true, tone: 'optional', badge: 'Optional', quiet: true });
  assert.equal(evidenceBox(optional, 'yes', 0).quiet, true);
  assert.equal(evidenceBox(optional, 'yes', 1).quiet, false);                            // attached: shown
  assert.equal(evidenceBox(q('old'), '', 0).quiet, true);                                // no rule at all: optional, as the server reads it
  assert.equal(evidenceBox(QUESTIONS[2], 'yes', 0).quiet, false);                        // owed: shown
  assert.equal(evidenceBox(QUESTIONS[4], '', 0).quiet, false);                           // a file question is the box itself
});

test('how a question is answered', () => {
  assert.equal(controlOf({ type: 'yes_no' }), 'choice');
  assert.equal(controlOf({ type: 'rating' }), 'choice');
  assert.equal(controlOf({ type: 'multiple_choice' }), 'choice');
  assert.equal(controlOf({}), 'choice');
  for (const t of ['text', 'number', 'date', 'file']) assert.equal(controlOf({ type: t }), t);
  assert.deepEqual(choicesOf({ type: 'rating' }).map((c) => c.value), ['1', '2', '3', '4', '5']);
  assert.deepEqual(choicesOf({ type: 'yes_no' }), [{ value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]);
  assert.deepEqual(choicesOf({ options: ['Red', { value: 'g', label: 'Green' }] }), [{ value: 'Red', label: 'Red' }, { value: 'g', label: 'Green' }]);
});

test('a plain pick saves at once and keeps the comment; leaving "not applicable" takes its reason with it', () => {
  const mfa = QUESTIONS[2];
  assert.deepEqual(pickAnswer(mfa, 'yes', { value: '', comment: '' }), { act: 'save', words: '' });
  assert.deepEqual(pickAnswer(mfa, 'no', { value: 'yes', comment: 'We use Okta' }), { act: 'save', words: 'We use Okta' });
  assert.deepEqual(pickAnswer(mfa, 'no', { value: 'n-a', comment: 'Not offered to staff' }), { act: 'save', words: '' });
  assert.equal(wordsKept(mfa, { value: 'n-a', comment: 'Not offered' }), '');
  assert.equal(wordsKept(mfa, { value: 'yes', comment: 'We use Okta' }), 'We use Okta');
});

test('"not applicable" waits for a reason of its own, whatever comment is there; a note-required option takes the note it has', () => {
  const mfa = QUESTIONS[2];
  const region = QUESTIONS[3];
  assert.deepEqual(pickAnswer(mfa, 'n-a', { value: '', comment: '' }), { act: 'wait' });
  assert.deepEqual(pickAnswer(mfa, 'n-a', { value: 'yes', comment: 'We use Okta' }), { act: 'wait' });     // an old comment is not a reason
  assert.deepEqual(pickAnswer(region, 'other', { value: 'eu', comment: '' }), { act: 'wait' });
  assert.deepEqual(pickAnswer(region, 'other', { value: 'other', comment: 'Dubai' }), { act: 'save', words: 'Dubai' });
  const two = q('two', { type: 'multiple_choice', options: [{ value: 'a', comment_required: true }, { value: 'b', comment_required: true }] });
  assert.deepEqual(pickAnswer(two, 'b', { value: 'a', comment: 'Because' }), { act: 'save', words: 'Because' });   // another that asks for a note
  assert.deepEqual(pickAnswer(two, 'b', { value: 'a', comment: '' }), { act: 'wait' });
});

test('leaving the words box saves them with the waiting pick, keeps an empty box waiting, and never empties what an answer asks for', () => {
  const mfa = QUESTIONS[2];
  const saved = (value: string, comment: string) => ({ value, comment });
  // a pick waiting for its reason
  assert.deepEqual(leaveNote(mfa, { pending: 'n-a', saved: saved('yes', ''), draft: '  Not offered  ' }), { act: 'save', value: 'n-a', words: 'Not offered' });
  assert.deepEqual(leaveNote(mfa, { pending: 'n-a', saved: saved('yes', ''), draft: '  ' }), { act: 'keep' });
  // the words of a saved answer, edited
  assert.deepEqual(leaveNote(mfa, { pending: null, saved: saved('n-a', 'Not offered'), draft: 'Not offered to staff' }), { act: 'save', value: 'n-a', words: 'Not offered to staff' });
  assert.deepEqual(leaveNote(mfa, { pending: null, saved: saved('n-a', 'Not offered'), draft: ' Not offered ' }), { act: 'keep' });         // nothing changed
  assert.deepEqual(leaveNote(mfa, { pending: null, saved: saved('n-a', 'Not offered'), draft: '' }), { act: 'restore' });                    // the reason cannot go
  // an optional comment may be emptied, or written on an unanswered question
  assert.deepEqual(leaveNote(mfa, { pending: null, saved: saved('yes', 'We use Okta'), draft: '' }), { act: 'save', value: 'yes', words: '' });
  assert.deepEqual(leaveNote(mfa, { pending: null, saved: saved('', ''), draft: 'Still deciding' }), { act: 'save', value: '', words: 'Still deciding' });
});

test('a date is an answer once it is whole, not while its year is still being typed', () => {
  assert.equal(isWholeDate('2026-11-15'), true);
  for (const typing of ['', '0002-11-15', '0202-11-15', '2026-1-5', '2026-11', 'soon']) assert.equal(isWholeDate(typing), false, typing);
});

test('each section says how many of its questions are answered (a file question by its file), for the headings and the jump list', () => {
  const sections = sectionsOf(QUESTIONS);
  const rows = sectionRows(sections, { subs: 'no', mfa: 'yes' }, { policy: [{ id: 1 }] });
  assert.deepEqual(rows.map((r) => r.label), sections.map((s) => s.label));
  assert.equal(rows.reduce((n, r) => n + r.total, 0), QUESTIONS.length);
  assert.equal(rows.reduce((n, r) => n + r.answered, 0), 3, 'subs, mfa and the policy file');
  assert.deepEqual(sectionRows(sections, {}, {}).map((r) => r.answered), sections.map(() => 0));
});
