// node --test "src/app/(dashboard)/vendor-risk/_lib/questionnaires/sentModel.test.ts"
// The Sent tab's rules: which chip keeps which status, what "late" is, what a row offers a person with and without the rights, how an answer reads aloud, and that the register's definition is sound.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluateRegister, indexRegister, sortRows, stateOf } from '../../../../../components/records/registerModel.ts';
import {
  SENT_SCHEMA, answerLines, answerText, answeredShare, answeredText, assessmentText, headLine, isInReview, isLate, isWaitingOnSupplier, newLinkAsk, sentActions, sentDef, strayAnswers, supplierName, templateName,
  type SentRow,
} from './sentModel.ts';
import type { Question } from './types.ts';

const NOW = new Date('2026-11-10T12:00:00Z');
const row = (over: Partial<SentRow> = {}): SentRow => ({
  id: 1, vendor_id: 10, vendor_name: 'Alpha Pay', vendor_archived: false, assessment_id: null, assessment_type: null, assessment_status: null, template_id: 5, template_name: 'Security basics',
  template_version_no: 2, respondent_name: 'Ana', respondent_email: 'ana@alpha.test', contact_id: 3, status: 'pending', own_link: false, due_date: '2026-11-20T00:00:00', expires_at: null,
  last_sent_at: null, submitted_at: null, accepted_at: null, created_at: '2026-11-01T09:00:00', answered: 0, question_count: 10, ...over,
});

test('waiting on the supplier is the server\'s list; late is waiting and past the due day, nothing else', () => {
  for (const status of ['pending', 'in_progress', 'returned']) assert.equal(isWaitingOnSupplier(row({ status })), true, status);
  for (const status of ['submitted', 'under_review', 'accepted', 'expired']) assert.equal(isWaitingOnSupplier(row({ status })), false, status);
  assert.equal(isInReview(row({ status: 'under_review' })), true);
  assert.equal(isLate(row({ due_date: '2026-11-09T23:59:00' }), NOW), true);
  assert.equal(isLate(row({ due_date: '2026-11-10T12:00:01' }), NOW), false, 'not yet');
  assert.equal(isLate(row({ due_date: null }), NOW), false, 'no due day is never late');
  assert.equal(isLate(row({ status: 'submitted', due_date: '2026-01-01T00:00:00' }), NOW), false, 'answered: the supplier is not late any more');
});

test('names and counts are said in words: no number of a record, a count out of what it was sent on', () => {
  assert.equal(supplierName(row({ vendor_name: null })), 'A supplier that is no longer listed');
  assert.equal(templateName(row({ template_name: null, template_id: 9 })), 'A questionnaire that was deleted');
  assert.equal(templateName(row({ template_name: null, template_id: null })), 'No questionnaire');
  assert.equal(answeredText(row({ answered: 12, question_count: 48 })), '12 of 48');
  assert.equal(answeredText(row({ answered: 3, question_count: 0 })), '3');
  assert.equal(answeredShare(row({ answered: 60, question_count: 48 })), 1, 'never over a whole');
  assert.equal(assessmentText(row()), null);
  assert.equal(assessmentText(row({ assessment_id: 7, assessment_type: 'annual' })), 'Annual assessment');
  assert.equal(assessmentText(row({ assessment_id: 7, assessment_type: 'ad_hoc' })), 'Ad hoc assessment');
  assert.equal(assessmentText(row({ assessment_id: 7, assessment_type: null })), 'An assessment');
});

test('the definition: chips keep what they say, counts are over the rows, sorts are total and the board has every status once', () => {
  const def = sentDef();
  const rows = [
    row({ id: 1, status: 'pending', due_date: '2026-11-01T00:00:00' }),                  // waiting + late
    row({ id: 2, status: 'in_progress', due_date: '2026-12-01T00:00:00', answered: 4 }),   // waiting
    row({ id: 3, status: 'returned', due_date: '2026-11-02T00:00:00' }),                  // waiting + returned + late
    row({ id: 4, status: 'submitted', due_date: null }),                                  // in review
    row({ id: 5, status: 'under_review', due_date: null }),                               // in review
    row({ id: 6, status: 'accepted', vendor_id: 11, vendor_name: 'Bravo', template_id: null, template_name: null, due_date: null }),
  ];
  const state = stateOf(def, { q: '', quick: 'all', view: 'list', sort: def.defaultSort, page: 1, id: 0, status: [], template: [], supplier: [], assessment: [] });
  const { quickCounts } = evaluateRegister(def, indexRegister(def, rows), state, NOW);
  assert.deepEqual(quickCounts, { all: 6, waiting: 3, review: 2, returned: 1, late: 2 });
  const picked = evaluateRegister(def, indexRegister(def, rows), { ...state, quick: 'late' }, NOW).result.matches.map((r) => r.id).sort();
  assert.deepEqual(picked, [1, 3]);
  const found = evaluateRegister(def, indexRegister(def, rows), { ...state, q: 'bravo' }, NOW).result.matches.map((r) => r.id);
  assert.deepEqual(found, [6], 'a search reads the supplier');
  const byDue = sortRows(def, rows, { key: 'due', dir: 'asc' }).map((r) => r.id);
  assert.deepEqual(byDue.slice(0, 3), [1, 3, 2], 'soonest due first');
  assert.deepEqual(byDue.slice(3), [4, 5, 6], 'no due day last, by id');
  assert.deepEqual(sortRows(def, rows, { key: 'sent', dir: 'desc' }).map((r) => r.id), [1, 2, 3, 4, 5, 6], 'ties keep the order of the id');
  const columns = def.board!.columns.map((c) => c.id);
  assert.equal(new Set(columns).size, columns.length);
  for (const r of rows) assert.equal(def.board!.columns.filter((c) => c.test(r)).length, 1, `status ${r.status} is in one column`);
  assert.ok(SENT_SCHEMA.q && SENT_SCHEMA.status && SENT_SCHEMA.template && SENT_SCHEMA.supplier, 'the address knows every facet');
});

test('the head line says how many wait and how many are late', () => {
  assert.equal(headLine([], NOW), '0 questionnaires');
  assert.equal(headLine([row({ due_date: '2026-11-01T00:00:00' }), row({ id: 2, status: 'accepted' })], NOW), '2 questionnaires · 1 waiting on a supplier · 1 late');
  assert.equal(headLine([row()], NOW), '1 questionnaire · 1 waiting on a supplier');
});

test('what a row offers follows the rights the server checks, and a closed one offers no new link', () => {
  const none = { resend: false, vendors: false };
  assert.deepEqual(sentActions(row(), none), ['answers']);
  assert.deepEqual(sentActions(row(), { resend: true, vendors: true }), ['answers', 'copy_contact_link', 'send_new_link']);
  assert.deepEqual(sentActions(row({ own_link: true }), { resend: true, vendors: true }), ['answers', 'copy_link', 'open_link', 'send_new_link'], 'a link of its own: copy it, open it');
  assert.deepEqual(sentActions(row({ status: 'accepted', contact_id: 3 }), { resend: true, vendors: true }), ['answers'], 'accepted: the link is closed');
  assert.deepEqual(sentActions(row({ status: 'submitted', assessment_id: 4 }), { resend: true, vendors: true }), ['answers', 'open_assessment']);
  assert.deepEqual(sentActions(row({ contact_id: null }), { resend: false, vendors: true }), ['answers'], 'no contact: nobody to copy a link for');
  assert.match(newLinkAsk(row({ own_link: true })).message, /current link stops working/);
  assert.match(newLinkAsk(row()).title, /Email the contact/);
});

const YN: Question = { id: 'q1', text: 'MFA?', type: 'yes_no', required: true, evidence_required: false, weight: 1 };
const MC: Question = { id: 'q2', text: 'How?', type: 'multiple_choice', required: true, evidence_required: false, weight: 1, options: [{ value: 'a', label: 'Always' }, 'rarely'] };

test('an answer reads aloud: option labels, not-applicable, a rating of five, never raw JSON', () => {
  assert.equal(answerText(YN, 'yes'), 'Yes');
  assert.equal(answerText(YN, 'PARTIAL'), 'Partial');
  assert.equal(answerText(YN, 'n-a'), 'Not applicable');
  assert.equal(answerText(MC, 'a'), 'Always');
  assert.equal(answerText(MC, 'rarely'), 'rarely');
  assert.equal(answerText({ type: 'rating' }, 4), '4 of 5');
  assert.equal(answerText({ type: 'text' }, { answer: 'We rotate keys yearly' }), 'We rotate keys yearly');
  assert.equal(answerText({ type: 'text' }, ''), 'No answer');
  assert.equal(answerText({ type: 'file' }, { files: [1, 2] }), 'Answered', 'an object we cannot read is not printed');
});

test('the drawer lines follow the questions the questionnaire was sent on, carry the supplier\'s note, and count answers to removed questions', () => {
  const detail = { questions: [YN, MC], responses: { q1: 'no', gone: 'yes' }, comments: { q1: ' Planned for Q1 ', q2: '' } };
  const lines = answerLines(detail);
  assert.deepEqual(lines.map((l) => [l.number, l.answer, l.answered, l.comment]), [[1, 'No', true, 'Planned for Q1'], [2, 'No answer', false, null]]);
  assert.equal(strayAnswers(detail), 1);
  assert.deepEqual(answerLines({ questions: [], responses: {}, comments: {} }), []);
});
