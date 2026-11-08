// node --test "src/lib/rcsa/answers.test.ts"
// The questionnaire's rules. The first group is the contract bug of the old form: it sent likelihood / impact / effectiveness / yes_no_value / text_value, the
// server stores likelihood_rating / impact_rating / control_effectiveness / response_value and ignores the rest, so nothing was kept. These tests fail on the
// old payload, and the backend test (test_rcsa_flow.py::test_the_old_payload_stores_nothing) proves the server side of the same fact.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { answerFromServer, completion, differs, isAnswered, isPartial, needsLook, ratingScore, savePayload, sections, sortedQuestions, type Answer, type Question } from './answers.ts';

const q = (id: number, question_type: string, extra: Partial<Question> = {}): Question => ({ id, question_text: `Q${id}`, question_type, is_required: true, question_order: id, section: 'Controls', ...extra });

test('a risk rating is saved under the names the API stores', () => {
  assert.deepEqual(savePayload(q(1, 'risk_rating'), { likelihood: 4, impact: 3 }), {
    question_id: 1, response_value: null, likelihood_rating: 4, impact_rating: 3, control_effectiveness: null,
  });
});

test('a control rating, a yes/no, a text and a multiple choice are saved under the names the API stores', () => {
  assert.equal(savePayload(q(2, 'control_rating'), { effectiveness: 'ineffective' }).control_effectiveness, 'ineffective');
  assert.equal(savePayload(q(3, 'yes_no'), { yesNo: true }).response_value, 'yes');
  assert.equal(savePayload(q(3, 'yes_no'), { yesNo: false }).response_value, 'no');
  assert.equal(savePayload(q(3, 'yes_no'), {}).response_value, null);
  assert.equal(savePayload(q(4, 'text'), { text: 'Reviewed monthly' }).response_value, 'Reviewed monthly');
  assert.equal(savePayload(q(5, 'multiple_choice'), { text: 'Weekly' }).response_value, 'Weekly');
});

test('the payload never uses the old field names, whatever the question', () => {
  const full: Answer = { likelihood: 1, impact: 2, effectiveness: 'effective', yesNo: true, text: 'x' };
  for (const type of ['risk_rating', 'control_rating', 'yes_no', 'text', 'multiple_choice']) {
    const keys = Object.keys(savePayload(q(1, type), full)).sort();
    assert.deepEqual(keys, ['control_effectiveness', 'impact_rating', 'likelihood_rating', 'question_id', 'response_value'], type);
  }
});

test('a question stores only what its type asks for: a stale value of another type never goes along', () => {
  const p = savePayload(q(1, 'risk_rating'), { likelihood: 2, impact: 2, effectiveness: 'effective', text: 'old' });
  assert.equal(p.control_effectiveness, null);
  assert.equal(p.response_value, null);
});

test('what the detail endpoint returns is read back into the same answer the form saved', () => {
  const back = answerFromServer({ question_id: 3, yes_no_value: true, likelihood: 4, impact: 3, effectiveness: 'effective', text_value: null });
  assert.deepEqual(back, { likelihood: 4, impact: 3, effectiveness: 'effective', yesNo: true, text: null });
  assert.equal(differs(q(3, 'yes_no'), back, back), false);
  assert.equal(differs(q(3, 'yes_no'), { yesNo: false }, back), true);
});

test('a question counts as answered by its type', () => {
  assert.equal(isAnswered(q(1, 'risk_rating'), { likelihood: 3 }), false);
  assert.equal(isAnswered(q(1, 'risk_rating'), { likelihood: 3, impact: 2 }), true);
  assert.equal(isPartial(q(1, 'risk_rating'), { likelihood: 3 }), true);
  assert.equal(isAnswered(q(2, 'control_rating'), { effectiveness: 'not_applicable' }), true);
  assert.equal(isAnswered(q(3, 'yes_no'), { yesNo: false }), true, 'No is an answer');
  assert.equal(isAnswered(q(3, 'yes_no'), { yesNo: null }), false);
  assert.equal(isAnswered(q(4, 'text'), { text: '   ' }), false);
  assert.equal(isAnswered(q(4, 'text'), undefined), false);
});

test('completion counts the required questions, names what is missing in the form\'s order, and the percentage is whole', () => {
  const questions = [q(3, 'yes_no'), q(1, 'risk_rating'), q(2, 'control_rating'), q(4, 'text', { is_required: false })];
  const none = completion(questions, {});
  assert.deepEqual([none.required, none.answeredRequired, none.percent, none.missing], [3, 0, 0, [1, 2, 3]]);
  const some = completion(questions, { 1: { likelihood: 5, impact: 5 }, 4: { text: 'ok' } });
  assert.deepEqual([some.answeredRequired, some.answered, some.percent, some.missing], [1, 2, 33, [2, 3]]);
  assert.equal(completion([q(1, 'text', { is_required: false })], {}).percent, 0);
});

test('the form is in the template\'s order: sections by their first question (the server lists them by name), questions by their own order', () => {
  const questions = [q(5, 'text', { section: 'People', question_order: 0 }), q(2, 'text', { section: 'Controls', question_order: 2 }), q(1, 'text', { section: 'Controls', question_order: 1 })];
  assert.deepEqual(sortedQuestions(questions).map((x) => x.id), [5, 1, 2]);
  // the server hands them over by section NAME (Controls before People): the author's order is by the first question's number
  const byName = [q(2, 'text', { section: 'Controls', question_order: 8 }), q(1, 'text', { section: 'Controls', question_order: 7 }), q(5, 'text', { section: 'People', question_order: 1 })];
  assert.deepEqual(sortedQuestions(byName).map((x) => x.id), [5, 1, 2]);
  const parts = sections(questions, { 1: { text: 'a' } });
  assert.deepEqual(parts.map((s) => [s.name, s.questions.length, s.answered, s.required]), [['People', 1, 0, 1], ['Controls', 2, 1, 2]]);
});

test('the rating score is likelihood times impact, nothing while one is missing', () => {
  assert.equal(ratingScore({ likelihood: 4, impact: 5 }), 20);
  assert.equal(ratingScore({ likelihood: 4 }), null);
});

test('the reviewer looks first at what is empty, rated high or not fully effective', () => {
  assert.equal(needsLook(q(1, 'risk_rating'), undefined), 'Required, not answered');
  assert.equal(needsLook(q(1, 'text', { is_required: false }), undefined), null);
  assert.equal(needsLook(q(1, 'risk_rating'), { likelihood: 4, impact: 3 }), 'High risk rating');
  assert.equal(needsLook(q(1, 'risk_rating'), { likelihood: 2, impact: 3 }), null);
  assert.equal(needsLook(q(2, 'control_rating'), { effectiveness: 'ineffective' }), 'Control not effective');
  assert.equal(needsLook(q(2, 'control_rating'), { effectiveness: 'partially_effective' }), 'Control only partly effective');
  assert.equal(needsLook(q(2, 'control_rating'), { effectiveness: 'effective' }), null);
  assert.equal(needsLook(q(3, 'yes_no'), { yesNo: false }), null);
});
