// node --test "src/app/(dashboard)/erm/risk-assessments/framework/[id]/_framework/frameworkModel.test.ts"
// The rules of a framework assessment's workspace: the counts of the band, the filters and a person's own questions, the next one to answer, what a regenerate deletes said in numbers,
// the phases, the notice about how the questions were written and the words of a bulk change that partly failed.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readAddress, writeAddress } from '../../../../../../../lib/addressState.ts';
import {
  FRAMEWORK_SCHEMA, NO_QFILTERS, assigneeRows, batchWords, countsOf, filterCount, filterQuestions, filtersOf, hasWork, madeNotice, madeOf, nextToAnswer, phaseRows, questionIdOf, rating,
  regenerateFacts, regenerateWords, type FrameworkAddress, type Question,
} from './frameworkModel.ts';

const q = (o: Partial<Question> & { id: number }): Question => ({ question_text: `Question ${o.id}`, status: 'not_started', ...o });
const QS: Question[] = [
  q({ id: 1, status: 'completed', assigned_user_id: 7, assigned_user_name: 'Sana', phase_code: 'identify', residual_likelihood: 4, residual_impact: 5, evidence: [{ id: 1, file_name: 'a.pdf' }, { id: 2, file_name: 'b.pdf' }] }),
  q({ id: 2, status: 'in_progress', assigned_user_id: 7, assigned_user_name: 'Sana', phase_code: 'identify', clause_reference: '6.2.1' }),
  q({ id: 3, status: 'blocked', assigned_user_id: 8, assigned_user_name: 'Ali', phase_code: 'analyse', is_risk_accepted: true, linked_risk_id: 55 }),
  q({ id: 4, status: 'not_started', phase_code: 'analyse', methodology_fields: { threat: 'Phishing' } }),
  q({ id: 5, status: 'not_started', assigned_user_id: 8, assigned_user_name: 'Ali' }),
];

test('the counts of the band are true counts', () => {
  const c = countsOf(QS, 7);
  assert.deepEqual(c.byStatus, { not_started: 2, in_progress: 1, completed: 1, blocked: 1 });
  assert.deepEqual([c.total, c.mine, c.unassigned, c.evidence, c.accepted, c.moved, c.pct], [5, 1, 1, 2, 1, 1, 20]);       // mine: assigned to me and not completed
  assert.equal(countsOf([], 7).pct, null);
  assert.equal(countsOf(QS, null).mine, 0);
});

test('the score band of a question is the area\'s one (4 x 5 = 20 is critical)', () => {
  assert.equal(rating(QS[0]), 'critical');
  assert.equal(rating(QS[1]), 'none');
});

test('filters: my questions, the blocked ones, a phase, an assignee, a search over the text, the clause and the answers', () => {
  const ids = (f: Partial<typeof NO_QFILTERS>) => filterQuestions(QS, { ...NO_QFILTERS, ...f }, 7).map((x) => x.id);
  assert.deepEqual(ids({}), [1, 2, 3, 4, 5]);
  assert.deepEqual(ids({ quick: 'mine' }), [1, 2]);
  assert.deepEqual(ids({ quick: 'blocked' }), [3]);
  assert.deepEqual(ids({ quick: 'todo' }), [2, 3, 4, 5]);
  assert.deepEqual(ids({ quick: 'unassigned' }), [4]);
  assert.deepEqual(ids({ phase: ['analyse'] }), [3, 4]);
  assert.deepEqual(ids({ phase: ['none'] }), [5]);
  assert.deepEqual(ids({ assignee: ['8', 'none'] }), [3, 4, 5]);
  assert.deepEqual(ids({ status: ['blocked', 'completed'] }), [1, 3]);
  assert.deepEqual(ids({ search: '6.2.1' }), [2]);
  assert.deepEqual(ids({ search: 'phishing' }), [4]);
  assert.equal(filterCount({ ...NO_QFILTERS, quick: 'mine', search: 'x', phase: ['a', 'b'] }), 4);
});

test('the next question to answer follows the list as shown, skips the done, wraps round, and is null when none is left', () => {
  assert.equal(nextToAnswer(QS, 2)?.id, 3);
  assert.equal(nextToAnswer(QS, 5)?.id, 2);                      // wraps; 1 is completed
  assert.equal(nextToAnswer([QS[0]], 1), null);
  assert.equal(nextToAnswer([], null), null);
  assert.equal(nextToAnswer(QS, null)?.id, 2);                   // no current: the first one still to answer
});

test('a regenerate says in numbers what it deletes, before it happens', () => {
  const f = regenerateFacts(QS);
  assert.deepEqual(f, { total: 5, withWork: 4, withEvidence: 1, evidenceFiles: 2, moved: 1 });       // 5 is untouched: not started, no score, no answers, no file
  assert.ok(hasWork(QS[3]) && !hasWork(QS[4]));
  const words = regenerateWords(f);
  assert.match(words, /All 5 questions will be deleted/);
  assert.match(words, /4 questions have work in it/);
  assert.match(words, /2 uploaded files will be deleted/);
  assert.match(words, /1 risk already moved to the Risk Register stay there/);
  assert.match(words, /cannot be undone/);
  assert.match(regenerateWords(regenerateFacts([])), /nothing is lost/);
});

test('the phases keep the method\'s order, count what is done and blocked, and name what has no phase', () => {
  const rows = phaseRows(QS, [{ code: 'analyse', name: 'Analyse', order: 2 }, { code: 'identify', name: 'Identify', order: 1 }, { code: 'treat', name: 'Treat', order: 3 }]);
  assert.deepEqual(rows.map((r) => [r.name, r.total, r.done, r.blocked]), [['Identify', 2, 1, 0], ['Analyse', 2, 0, 1], ['No phase', 1, 0, 0]]);
});

test('the people: most open work first, the unassigned last', () => {
  const rows = assigneeRows(QS);
  assert.deepEqual(rows.map((r) => [r.name, r.total, r.open]), [['Ali', 2, 2], ['Sana', 2, 1], ['No one assigned', 1, 1]]);
});

test('the address: the old ?mine=1 link is the quick view Mine; the question open is in it', () => {
  const state = readAddress(FRAMEWORK_SCHEMA, '?mine=1&question=412&status=blocked&phase=identify');
  assert.deepEqual(filtersOf(state as FrameworkAddress), { search: '', quick: 'mine', status: ['blocked'], phase: ['identify'], assignee: [] });
  assert.equal(questionIdOf(state as FrameworkAddress), 412);
  assert.equal(questionIdOf({ question: 'zz' }), null);
  assert.equal(writeAddress(FRAMEWORK_SCHEMA, '', { ...state, mine: false, quick: 'mine' }), 'quick=mine&status=blocked&phase=identify&question=412');
});

test('the notice says how the questions were written; a template is a warning', () => {
  assert.equal(madeOf('ai'), 'ai');
  assert.equal(madeOf('zzz'), null);
  assert.equal(madeNotice('methodology', 'ISO 27005').title, 'Questions follow ISO 27005');
  assert.equal(madeNotice('ai').tone, 'info');
  assert.equal(madeNotice('template').tone, 'warning');
  assert.match(madeNotice('template').text, /AI was not available/);
});

test('a bulk change that partly failed says how many went and how many did not', () => {
  assert.equal(batchWords(10, 0, 'Assign').ok, true);
  assert.match(batchWords(7, 3, 'Assign').message, /7 questions were updated and 3 were not/);
  assert.match(batchWords(0, 4, 'Assign').message, /None of the 4 questions/);
});
