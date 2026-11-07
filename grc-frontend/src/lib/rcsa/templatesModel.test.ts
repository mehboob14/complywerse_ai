// node --test "src/lib/rcsa/templatesModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addQuestion, addSection, allQuestions, blankQuestion, canMoveQuestion, canMoveSection, cloneName, deleteBlock, deleteCost, detailsPayload, detailsProblems, draftProblems, duplicateQuestion,
  fromServer, inUseText, isDirty, moveQuestion, moveSection, numberOf, previewQuestion, questionCount, questionProblems, removedQuestions, removeQuestion, removeSection, renameSection, requiredCount, saveWarning,
  sectionNameProblem, templateFileName, toPayload, updateQuestion, whoOf, type ServerQuestion,
} from './templatesModel.ts';

const sq = (id: number, section: string | null, order: number, extra: Partial<ServerQuestion> = {}): ServerQuestion => ({
  id, section, question_order: order, question_text: `Question ${id}`, question_type: 'text', is_required: true, options: [], ai_suggestion_enabled: true, ...extra,
});

// the server sends the questions sorted by section NAME, so the A section comes first even when the person put Governance first
const server = [sq(3, 'Access', 3), sq(4, 'Access', 4), sq(1, 'Governance', 1), sq(2, 'Governance', 2), sq(5, null, 5)];

test('the draft is rebuilt in question order with sections in the order they first appear, not in the server\'s alphabetical order', () => {
  const d = fromServer(server);
  assert.deepEqual(d.map((s) => [s.name, s.questions.map((q) => q.id)]), [['Governance', [1, 2]], ['Access', [3, 4]], ['', [5]]]);
  assert.equal(questionCount(d), 5);
  assert.equal(numberOf(d, 'q3'), 3);
});

test('the payload: an existing question keeps its id, a new one has none, the order is the list order and a section is the name each question carries', () => {
  let d = fromServer(server);
  d = addQuestion(d, 'Access', { ...blankQuestion('yes_no'), text: '  Are leavers removed?  ' });
  const body = toPayload(d);
  assert.deepEqual(body.map((q) => q.question_order), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(body.map((q) => q.id), [1, 2, 3, 4, undefined, 5]);
  assert.ok(!('id' in body[4]), 'a new question must not carry an id the server could match to another question');
  assert.deepEqual(body.map((q) => q.section), ['Governance', 'Governance', 'Access', 'Access', 'Access', null]);
  assert.equal(body[4].question_text, 'Are leavers removed?');
  assert.equal(body[4].question_type, 'yes_no');
  assert.equal(body[0].guidance_text, null);
});

test('options go only with a multiple-choice question, trimmed and without blanks', () => {
  const mc = { ...blankQuestion('multiple_choice'), text: 'Which?', options: [' A ', '', 'B'] };
  const text = { ...blankQuestion('text'), text: 'Why?', options: ['left over from a change of type'] };
  const body = toPayload([{ key: 's', name: 'S', questions: [mc, text] }]);
  assert.deepEqual(body[0].options, ['A', 'B']);
  assert.deepEqual(body[1].options, []);
});

test('moving a question or a section changes the order the payload carries; the edges do nothing and say so', () => {
  let d = fromServer(server);
  d = moveQuestion(d, 'q1', 1);
  assert.deepEqual(toPayload(d).map((q) => q.id), [2, 1, 3, 4, 5]);
  assert.equal(canMoveQuestion(d, 'q1', 1), false);
  assert.equal(canMoveQuestion(d, 'q2', -1), false);
  assert.deepEqual(toPayload(moveQuestion(d, 'q2', -1)).map((q) => q.id), [2, 1, 3, 4, 5]);
  const access = d[1].key;
  const moved = moveSection(d, access, -1);
  assert.deepEqual(toPayload(moved).map((q) => q.id), [3, 4, 2, 1, 5]);
  assert.equal(canMoveSection(d, d[0].key, -1), false);
  assert.equal(canMoveSection(d, d[2].key, 1), false);
});

test('duplicate makes a new question straight after the original, with its own choices and no id', () => {
  const d = duplicateQuestion(fromServer([sq(1, 'A', 1, { question_type: 'multiple_choice', options: ['x', 'y'] }), sq(2, 'A', 2)]), 'q1');
  const qs = allQuestions(d);
  assert.equal(qs.length, 3);
  assert.equal(qs[1].id, null);
  assert.notEqual(qs[1].key, qs[0].key);
  qs[1].options.push('z');
  assert.deepEqual(qs[0].options, ['x', 'y']);
  assert.deepEqual(toPayload(d).map((q) => q.id), [1, undefined, 2]);
});

test('removing a question leaves its section; only an empty section can be removed', () => {
  let d = fromServer([sq(1, 'A', 1), sq(2, 'B', 2)]);
  d = removeQuestion(d, 'q2');
  assert.deepEqual(d.map((s) => s.questions.length), [1, 0]);
  assert.equal(removeSection(d, d[0].key).length, 2, 'a section with a question stays');
  assert.equal(removeSection(d, d[1].key).length, 1);
  assert.deepEqual(toPayload(d).map((q) => q.id), [1], 'an empty section vanishes from the payload: it is only a name the questions carry');
});

test('editing a question into another section moves it to the end of that section, or makes the section', () => {
  let d = fromServer([sq(1, 'A', 1), sq(2, 'A', 2), sq(3, 'B', 3)]);
  d = updateQuestion(d, 'q1', { ...allQuestions(d)[0], text: 'Edited' }, 'B');
  assert.deepEqual(d.map((s) => [s.name, s.questions.map((q) => q.id)]), [['A', [2]], ['B', [3, 1]]]);
  assert.equal(allQuestions(d).find((q) => q.id === 1)?.text, 'Edited');
  d = updateQuestion(d, 'q2', allQuestions(d)[0], 'Brand new');
  assert.deepEqual(d.map((s) => s.name), ['A', 'B', 'Brand new']);
  const same = updateQuestion(d, 'q3', { ...(allQuestions(d).find((q) => q.id === 3) as ReturnType<typeof blankQuestion>), text: 'Same place' }, 'b');
  assert.deepEqual(same.find((s) => s.name === 'B')?.questions.map((q) => q.id), [3, 1], 'a section name that differs only in case is the same section');
});

test('section names: required, unique ignoring case, and renaming keeps the questions', () => {
  let d = fromServer([sq(1, 'Access', 1), sq(2, 'Governance', 2)]);
  assert.match(sectionNameProblem(d, '  '), /name/);
  assert.match(sectionNameProblem(d, 'access'), /already exists/);
  assert.equal(sectionNameProblem(d, 'access', d[0].key), '', 'renaming a section to its own name in another case is fine');
  assert.equal(addSection(d, 'Access').length, 2);
  assert.equal(addSection(d, 'People').length, 3);
  d = renameSection(d, d[0].key, 'Identity and access');
  assert.deepEqual(toPayload(d).map((q) => q.section), ['Identity and access', 'Governance']);
  assert.equal(renameSection(d, d[0].key, 'governance')[0].name, 'Identity and access', 'a name that is taken changes nothing');
});

test('a question needs its text; a multiple-choice question needs at least two different choices, none blank', () => {
  assert.deepEqual(questionProblems({ text: '', kind: 'text', options: [] }), { text: 'Write the question the assessor will answer.' });
  assert.deepEqual(questionProblems({ text: 'Q', kind: 'text', options: [] }), {});
  assert.match(questionProblems({ text: 'Q', kind: 'multiple_choice', options: ['A'] }).options ?? '', /at least two/);
  assert.match(questionProblems({ text: 'Q', kind: 'multiple_choice', options: ['A', ''] }).options ?? '', /empty/);
  assert.match(questionProblems({ text: 'Q', kind: 'multiple_choice', options: ['A', ' a '] }).options ?? '', /same/);
  assert.deepEqual(questionProblems({ text: 'Q', kind: 'multiple_choice', options: ['A', 'B'] }), {});
  assert.deepEqual(questionProblems({ text: 'Q', kind: 'yes_no', options: ['', ''] }), {}, 'choices left over from another type do not count');
  const d = fromServer([sq(1, 'A', 1, { question_text: '' }), sq(2, 'A', 2)]);
  assert.deepEqual(draftProblems(d).map((p) => p.number), [1]);
});

test('dirty means the payload differs from the saved one, so a change and its undo are clean again', () => {
  const saved = fromServer(server);
  assert.equal(isDirty(saved, saved), false);
  const changed = moveQuestion(saved, 'q1', 1);
  assert.equal(isDirty(changed, saved), true);
  assert.equal(isDirty(moveQuestion(changed, 'q1', -1), saved), false);
  assert.equal(isDirty(addSection(saved, 'Empty for now'), saved), false, 'an empty section is nothing to save');
  assert.equal(isDirty(updateQuestion(saved, 'q1', { ...allQuestions(saved)[0], required: false }), saved), true);
  assert.equal(requiredCount(saved), 5);
});

test('what deleting costs is said in words: nothing for a new question, the answers when a campaign uses the questionnaire', () => {
  assert.match(deleteCost({ id: null }, 3), /not been saved/);
  assert.match(deleteCost({ id: 4 }, 0), /No campaign uses/);
  assert.match(deleteCost({ id: 4 }, 1), /1 campaign\. When you save, the answers already given .* that campaign are deleted/);
  assert.match(deleteCost({ id: 4 }, 3), /3 campaigns.* those campaigns are deleted/);
});

test('the library: in use, who, why a questionnaire cannot be deleted, file and clone names', () => {
  assert.deepEqual([inUseText(0), inUseText(undefined), inUseText(1), inUseText(3)], ['Not used', 'Not used', '1 campaign', '3 campaigns']);
  assert.deepEqual([whoOf({ is_system_template: true }), whoOf({ is_system_template: false })], ['Provided', 'Yours']);
  assert.match(deleteBlock({ is_system_template: true, campaign_count: 0 }) ?? '', /Provided/);
  assert.equal(deleteBlock({ is_system_template: false, campaign_count: 2 }), 'Used by 2 campaigns.');
  assert.equal(deleteBlock({ is_system_template: false, campaign_count: 0 }), null);
  assert.equal(templateFileName('Branch: Q2/Q3 RCSA'), 'Branch_Q2Q3_RCSA.xlsx');
  assert.equal(templateFileName('  '), 'questionnaire.xlsx');
  assert.equal(cloneName('IT  RCSA'), 'IT RCSA (copy)');
});

test('the preview gives the real answer controls a question: a negative number for one not saved yet, the text a stand-in while empty, no blank choices', () => {
  const saved = previewQuestion({ ...blankQuestion('multiple_choice'), id: 7, text: 'Which?', options: ['A', ' ', 'B'] }, 1);
  assert.deepEqual([saved.id, saved.question_text, saved.options], [7, 'Which?', ['A', 'B']]);
  const fresh = previewQuestion(blankQuestion('text'), 4);
  assert.deepEqual([fresh.id, fresh.question_text], [-4, 'Your question will appear here']);
});

test('the details form: all three are needed and the body trims them', () => {
  assert.deepEqual(Object.keys(detailsProblems({ name: ' ', description: '', category: '', version: '' })), ['name', 'category', 'version']);
  assert.deepEqual(detailsProblems({ name: 'A', description: '', category: 'Operational', version: '1.0' }), {});
  assert.deepEqual(detailsPayload({ name: ' A ', description: ' ', category: ' Operational ', version: ' 2 ' }), { name: 'A', description: null, category: 'Operational', version: '2' });
});

test('saving warns only when a saved question is gone from a questionnaire that campaigns use', () => {
  const saved = fromServer(server);
  const draft = removeQuestion(addQuestion(saved, 'Access', blankQuestion('text')), 'q2');
  assert.deepEqual(removedQuestions(draft, saved).map((q) => q.id), [2]);
  assert.deepEqual(removedQuestions(saved, saved), []);
  assert.deepEqual(removedQuestions(removeQuestion(addQuestion(saved, 'Access', blankQuestion('text')), 'n999'), saved), [], 'a new question that is taken back loses nothing');
  assert.equal(saveWarning(0, 3), '');
  assert.equal(saveWarning(2, 0), '');
  assert.match(saveWarning(1, 1), /^1 question will be deleted, with the answers already given to it in 1 campaign/);
  assert.match(saveWarning(1, null), /with any answers already given to it in campaigns/);
  assert.equal(saveWarning(0, null), '');
  assert.match(deleteCost({ id: 4 }, null), /any answers already given/);
  assert.match(saveWarning(2, 3), /^2 questions will be deleted, with the answers already given to them in 3 campaigns/);
});
