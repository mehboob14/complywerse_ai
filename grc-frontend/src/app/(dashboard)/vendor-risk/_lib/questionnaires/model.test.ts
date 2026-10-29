// node --test "src/app/(dashboard)/vendor-risk/_lib/questionnaires/*.test.ts"

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addFromLibrary, blankDraft, blankOption, brokenBranches, chipsFor, dependentsOf, draftFrom, draftProblems, evidenceOf, evidenceOnOf,
  insertAfter, isGap, libraryGroups, librarySets, moveQuestion, moveRun, optionsLine, orderProblem, questionFrom, removeQuestion, sectionFor,
  sectionKey, sectionName, sectionsOf, uniqueValue, visibleIds, withRules,
} from './model.ts';
import { STARTER_SETS } from './starterSets.ts';
import type { LibrarySet, Question, Template } from './types.ts';

const q = (id: string, extra: Partial<Question> = {}): Question => ({
  id, text: `Question ${id}?`, type: 'yes_no', required: true, evidence_required: false, weight: 1, options: [], ...extra,
});
const ids = (list: Question[] | null) => (list ?? []).map((x) => x.id);

// ── sections ────────────────────────────────────────────────────────────────

test('a section is the question\'s own, else its risk domain, else General, and the reviewers\' list reads it the same way', () => {
  assert.equal(sectionName(q('a', { section: 'Access control' })), 'Access control');
  assert.equal(sectionName(q('a', { domain: 'data_privacy' })), 'Data privacy');
  assert.equal(sectionName(q('a')), 'General');
  assert.equal(sectionKey(q('a', { section: ' Access  Control ' })), 'access control');
  assert.equal(sectionKey(q('a', { domain: 'fourth_party' })), 'fourth party');
  assert.equal(sectionKey(q('a', { section: 'Access' })), sectionKey(q('b', { section: 'access ' })));
  assert.equal(sectionKey(q('a', { section: 'Operational' })), sectionKey(q('b', { domain: 'operational' })));
});

test('sections are runs in the order asked: one split by another is two runs, and nothing is reordered', () => {
  const list = [q('a', { section: 'Access' }), q('b', { section: 'access ' }), q('c', { section: 'Data' }), q('d', { section: 'Access' })];
  const runs = sectionsOf(list);
  assert.deepEqual(runs.map((r) => [r.name, r.from, ids(r.questions)]), [['Access', 0, ['a', 'b']], ['Data', 2, ['c']], ['Access', 3, ['d']]]);
  assert.deepEqual(sectionsOf([]), []);
});

test('a new question lands in the section of the one it is added below, else the last one, else General', () => {
  const list = [q('a', { section: 'Access' }), q('b', { section: 'Data' })];
  assert.equal(sectionFor(list, 'a'), 'Access');
  assert.equal(sectionFor(list, null), 'Data');
  assert.equal(sectionFor(list, 'gone'), 'Data');
  assert.equal(sectionFor([], null), 'General');
});

// ── which questions show ────────────────────────────────────────────────────

const branching = [
  q('mfa'),
  q('how', { type: 'text', show_if: { question: 'mfa', in: ['yes', 'partial'] } }),
  q('how_detail', { type: 'text', show_if: { question: 'how', in: ['sso'] } }),
  q('free', { type: 'text' }),
];

test('a follow-up shows only when its question shows and was answered with one of its answers', () => {
  assert.deepEqual(Array.from(visibleIds(branching, {})), ['mfa', 'free']);
  assert.deepEqual(Array.from(visibleIds(branching, { mfa: 'yes' })), ['mfa', 'how', 'free']);
  assert.deepEqual(Array.from(visibleIds(branching, { mfa: 'Partial ' })), ['mfa', 'how', 'free']);      // the server compares in lower case, trimmed
  assert.deepEqual(Array.from(visibleIds(branching, { mfa: 'no' })), ['mfa', 'free']);
  assert.deepEqual(Array.from(visibleIds(branching, { mfa: 'yes', how: 'sso' })), ['mfa', 'how', 'how_detail', 'free']);
  // an answer left behind on a branch the person has turned away from must not keep its children alive
  assert.deepEqual(Array.from(visibleIds(branching, { mfa: 'no', how: 'sso' })), ['mfa', 'free']);
});

test('a question can only depend on one asked before it', () => {
  assert.deepEqual(brokenBranches(branching), []);
  const flipped = [branching[1], branching[0], branching[2], branching[3]];
  assert.deepEqual(ids(brokenBranches(flipped)), ['how']);
  assert.equal(orderProblem(branching), null);
  assert.equal(orderProblem(flipped), 'Q1 only shows after Q2, so it has to stay below it.');
  assert.equal(orderProblem([q('x', { show_if: { question: 'nowhere', in: ['yes'] } })]), 'Q1 depends on a question that is gone.');
});

// ── changing the list ───────────────────────────────────────────────────────

test('a question moves one place within its section, and a section moves as a whole', () => {
  const list = [q('a', { section: 'X' }), q('b', { section: 'X' }), q('c', { section: 'Y' }), q('d', { section: 'Y' })];
  assert.deepEqual(ids(moveQuestion(list, 'a', 1)), ['b', 'a', 'c', 'd']);
  assert.equal(moveQuestion(list, 'b', 1), null);                         // the next one is in another section
  assert.equal(moveQuestion(list, 'a', -1), null);
  assert.equal(moveQuestion(list, 'nope', 1), null);
  assert.deepEqual(ids(moveRun(list, 0, 1)), ['c', 'd', 'a', 'b']);
  assert.equal(moveRun(list, 1, 1), null);
  assert.equal(moveRun(list, 0, -1), null);
  assert.deepEqual(ids(list), ['a', 'b', 'c', 'd']);                      // the list itself is never changed
});

test('a question put in lands after the one named, or at the end', () => {
  const list = [q('a'), q('b')];
  assert.deepEqual(ids(insertAfter(list, 'a', q('n'))), ['a', 'n', 'b']);
  assert.deepEqual(ids(insertAfter(list, null, q('n'))), ['a', 'b', 'n']);
  assert.deepEqual(ids(insertAfter(list, 'gone', q('n'))), ['a', 'b', 'n']);
});

test('taking a question out frees the ones that depended on it', () => {
  assert.deepEqual(ids(dependentsOf(branching, 'mfa')), ['how']);
  const next = removeQuestion(branching, 'mfa');
  assert.deepEqual(ids(next), ['how', 'how_detail', 'free']);
  assert.equal(next[0].show_if, undefined);
  assert.deepEqual(next[1].show_if, { question: 'how', in: ['sso'] });
  assert.deepEqual(visibleIds(next, {}), new Set(['how', 'free']));
  assert.deepEqual(ids(branching), ['mfa', 'how', 'how_detail', 'free']);   // not changed in place
});

// ── a question as the editor holds it ───────────────────────────────────────

const choice = q('freq', {
  type: 'multiple_choice', section: 'Operations', weight: 4, evidence: 'required', evidence_on: ['Never'], evidence_required: true,
  options: [{ value: 'Weekly', label: 'Weekly', score: 1 }, { value: 'Never', label: 'Never', score: 0 }, { value: 'n/a', label: 'n/a', score: null, na: true, comment_required: true }],
});

test('an edit that changes nothing leaves the question as it was, and a built-in\'s own fields are kept', () => {
  const builtin = { ...q('sl_isms', { domain: 'cybersecurity', weight: 1.5, critical_control: true, evidence: 'optional', evidence_on: [], evidence_required: false }),
    key: 'sl_isms', qtype: 'yes_no', order: 1 } as Question;
  const same = questionFrom(draftFrom(builtin), builtin) as unknown as Record<string, unknown>;
  assert.deepEqual(same, { ...builtin } as unknown as Record<string, unknown>);
  assert.equal(same.key, 'sl_isms');
  assert.equal(same.domain, 'cybersecurity');
  assert.equal(sectionName(same as unknown as Question), 'Cybersecurity');   // still no section of its own: its domain still sorts it
  assert.deepEqual(questionFrom(draftFrom(choice), choice), { ...choice, section: 'Operations' });
});

test('an answer keeps its stored value when the label is reworded, and a new one takes its label', () => {
  const d = draftFrom(choice);
  assert.deepEqual(d.options.map((o) => [o.value, o.label, o.score, o.na, o.note]), [['Weekly', 'Weekly', 100, false, false], ['Never', 'Never', 0, false, false], ['n/a', 'n/a', null, true, true]]);
  d.options[0].label = 'Every week';
  d.options.push({ ...blankOption('Weekly'), score: 50 }, { ...blankOption('Weekly'), score: 25 });
  const saved = questionFrom(d, choice);
  assert.deepEqual((saved.options as Array<{ value: string; label: string; score: number | null }>).map((o) => [o.value, o.label, o.score]),
    [['Weekly', 'Every week', 1], ['Never', 'Never', 0], ['n/a', 'n/a', null], ['Weekly (2)', 'Weekly', 0.5], ['Weekly (3)', 'Weekly', 0.25]]);
  assert.equal(uniqueValue('Yes', ['Yes', 'Yes (2)']), 'Yes (3)');
});

test('a not-applicable answer is never scored, and "needs a note" is kept', () => {
  const d = draftFrom(choice);
  d.options[1].na = true;
  d.options[1].score = 80;
  d.options[0].note = true;
  const [weekly, never] = questionFrom(d, choice).options as unknown as Array<Record<string, unknown>>;
  assert.equal(never.score, null);
  assert.equal(never.na, true);
  assert.equal(weekly.comment_required, true);
  assert.equal('na' in weekly, false);
});

test('the answers that owe evidence follow their answers, by stored value', () => {
  const d = draftFrom(choice);
  assert.deepEqual(d.evidenceOn, [d.options[1].uid]);
  d.options.push({ ...blankOption('Monthly'), score: 50 });
  d.evidenceOn.push(d.options[3].uid);
  const saved = questionFrom(d, choice);
  assert.deepEqual(saved.evidence_on, ['Never', 'Monthly']);
  assert.equal(saved.evidence_required, true);
  d.evidence = 'optional';
  assert.deepEqual(questionFrom(d, choice).evidence_on, []);
  d.type = 'file';
  const file = questionFrom(d, choice);
  assert.equal(file.evidence, 'none');
  assert.deepEqual(file.options, []);
  assert.equal(evidenceOf(file), 'none');
});

test('a Yes / No question lists only the answers it changes, and a certificate can answer only it', () => {
  const base = q('mfa', { certificate_covers: true, options: [{ value: 'partial', comment_required: true }] });
  const d = draftFrom(base);
  assert.deepEqual(d.noteOn, ['partial']);
  d.noteOn.push('no');
  d.evidence = 'required';
  d.evidenceOn = ['yes', 'partial'];
  const saved = questionFrom(d, base);
  assert.deepEqual(saved.options, [{ value: 'partial', comment_required: true }, { value: 'no', comment_required: true }]);
  assert.deepEqual(evidenceOnOf(saved), ['yes', 'partial']);
  assert.equal(saved.certificate_covers, true);
  d.type = 'text';
  const text = questionFrom(d, base);
  assert.equal('certificate_covers' in text, false);
  assert.deepEqual(text.options, []);
  assert.deepEqual(text.evidence_on, []);
});

test('a rule that is cleared is removed, not left behind', () => {
  const base = q('how', { type: 'text', help: 'Name the tool', domain: 'cybersecurity', critical_control: true,
    show_if: { question: 'mfa', in: ['yes'] }, follow_up: { when: ['yes'], template_id: 4 } });
  const d = draftFrom(base);
  assert.deepEqual([d.showIfQuestion, d.showIfAnswers, d.followWhen, d.followTemplate], ['mfa', ['yes'], ['yes'], 4]);
  d.showIfQuestion = '';
  d.help = ' ';
  d.domain = '';
  const saved = questionFrom(d, base) as unknown as Record<string, unknown>;
  for (const gone of ['show_if', 'help', 'domain', 'follow_up', 'critical_control']) assert.equal(gone in saved, false, gone);   // text: not scored, no follow-up
  d.type = 'yes_no';
  d.critical = true;
  d.followWhen = ['no'];
  d.followTemplate = 9;
  const again = questionFrom(d, base);
  assert.equal(again.critical_control, true);
  assert.deepEqual(again.follow_up, { when: ['no'], template_id: 9 });
});

test('the type is kept in step where a built-in template carries it twice, and the weight stays in range', () => {
  const base = { ...q('x'), qtype: 'yes_no' } as Question;
  const d = draftFrom(base);
  d.type = 'text';
  d.weight = 99;
  const saved = questionFrom(d, base) as unknown as Record<string, unknown>;
  assert.equal(saved.qtype, 'text');
  assert.equal(saved.weight, 5);
  assert.equal(questionFrom({ ...d, weight: NaN }, base).weight, 1);
});

test('the footer says the first thing in the way', () => {
  const d = blankDraft('General');
  assert.deepEqual(draftProblems(d), ['Write the question.']);
  d.text = 'Is data encrypted?';
  assert.deepEqual(draftProblems(d), []);
  d.type = 'multiple_choice';
  assert.deepEqual(draftProblems(d), ['Add at least two answers.']);
  d.options = [blankOption('Yes'), blankOption('')];
  assert.deepEqual(draftProblems(d), ['Every answer needs a label.']);
  d.options[1].label = 'No';
  d.showIfQuestion = 'mfa';
  d.weight = 0;
  assert.deepEqual(draftProblems(d), ['Weight is 0.5 to 5.', 'Pick which answers show this question.']);
  d.weight = 3;
  d.showIfAnswers = ['yes'];
  d.followTemplate = 4;
  assert.deepEqual(draftProblems(d), ['Pick which answers send the follow-up.']);
  d.followWhen = ['No'];
  d.followTemplate = null;
  assert.deepEqual(draftProblems(d), ['Choose the follow-up questionnaire.']);
  d.type = 'text';
  d.weight = 0;
  assert.deepEqual(draftProblems(d), []);                                  // a text answer has no weight, no branches to name
});

// ── what a row says ─────────────────────────────────────────────────────────

test('the chips say only what departs from the ordinary', () => {
  const texts = (question: Question, ctx: Parameters<typeof chipsFor>[1] = { number: 1 }) => chipsFor(question, ctx).map((c) => c.text);
  assert.deepEqual(texts(q('a')), ['Yes / No']);                                           // required, evidence optional, weight 1: nothing to add
  assert.deepEqual(texts(q('a', { type: 'text', required: false, evidence: 'none', weight: 3 })), ['Text answer', 'Optional', 'No evidence']);
  assert.deepEqual(texts(q('a', { evidence: 'required', critical_control: true, certificate_covers: true, weight: 1.5, follow_up: { when: ['no'], template_id: 4 } }), { number: 2, followName: 'Privacy' }),
    ['Yes / No', 'Evidence required', 'Critical', 'Certificate can answer', 'Follow-up: Privacy', 'Weight 1.5']);
  assert.deepEqual(texts(q('a', { type: 'file', evidence: 'none', weight: 4 })), ['File upload']);   // a document is its own evidence, and it has no score
  const parent = { number: 3, question: q('p') };
  assert.deepEqual(texts(q('a', { show_if: { question: 'p', in: ['yes', 'partial'] } }), { number: 4, parent }), ['Yes / No', 'If Q3 is Yes or Partial']);
  const mc = { number: 1, question: choice };
  assert.deepEqual(texts(q('a', { show_if: { question: 'freq', in: ['Never'] } }), { number: 5, parent: mc }), ['Yes / No', 'If Q1 is Never']);
  assert.equal(chipsFor(q('a', { critical_control: true }), { number: 1 }).find((c) => c.key === 'critical')?.tone, 'danger');
});

test('an answer is a gap when it counts and counts for half or less', () => {
  assert.equal(isGap({ value: 'a', score: 0 }), true);
  assert.equal(isGap({ value: 'a', score: 0.5 }), true);
  assert.equal(isGap({ value: 'a', score: 0.51 }), false);
  assert.equal(isGap({ value: 'a', score: null }), false);
  assert.equal(isGap({ value: 'a', score: 0, na: true }), false);
  assert.equal(isGap('Plain'), false);
  assert.equal(optionsLine(choice), 'Weekly   ·   Never (gap)   ·   n/a');
  assert.equal(optionsLine(q('a')), '');
});

test('a question written before the evidence rules still means what it did', () => {
  const old = q('a', { evidence_required: true });
  assert.equal(evidenceOf(old), 'required');
  assert.deepEqual(evidenceOnOf(old), ['yes', 'partial']);
  assert.deepEqual(withRules(old).evidence_on, ['yes', 'partial']);
  assert.equal(withRules({ ...old, type: 'file' }).evidence, 'none');
  assert.deepEqual(withRules({ ...q('a', { type: 'multiple_choice', options: ['A', 'B'] }), evidence: 'required', evidence_on: ['A', 'C'] }).evidence_on, ['A']);   // C is not an answer of the question
});

// ── the library ─────────────────────────────────────────────────────────────

const library: LibrarySet = {
  key: 'k', name: 'Privacy', description: null, source: 'questionnaire',
  questions: [q('p1', { section: 'Data', text: 'Do you sign a DPA?' }), q('p2', { section: 'Data', text: 'Where is data stored?', type: 'text' }), q('p3', { section: 'Breach', text: 'How fast do you tell us?' })],
};

test('the picker groups by section, searches, and marks what the questionnaire already has', () => {
  const have = [q('x', { text: '  do you SIGN a dpa? ' })];
  const groups = libraryGroups(library, have, '');
  assert.deepEqual(groups.map((g) => [g.section, g.rows.map((r) => [r.q.id, r.added])]), [['Data', [['p1', true], ['p2', false]]], ['Breach', [['p3', false]]]]);
  assert.deepEqual(libraryGroups(library, have, 'stored').map((g) => g.rows.map((r) => r.q.id)), [['p2']]);
  assert.deepEqual(libraryGroups(library, have, 'breach').map((g) => g.rows.map((r) => r.q.id)), [['p3']]);      // a section name matches too
  assert.deepEqual(libraryGroups(library, have, 'zzz'), []);
});

test('a library question is copied under a new id, and a rule keeps pointing only at a question that came with it', () => {
  const set: Question[] = [
    q('a', { text: 'Gate?' }),
    q('b', { text: 'Why?', type: 'text', show_if: { question: 'a', in: ['yes'] } }),
    q('c', { text: 'Orphan', type: 'text', show_if: { question: 'not-picked', in: ['yes'] } }),
    q('d', { text: 'Old rule', evidence_required: true }),
  ];
  let n = 0;
  const next = addFromLibrary([q('mine')], set, () => `new${(n += 1)}`);
  assert.deepEqual(ids(next), ['mine', 'new1', 'new2', 'new3', 'new4']);
  assert.deepEqual(next[2].show_if, { question: 'new1', in: ['yes'] });
  assert.equal(next[3].show_if, undefined);
  assert.equal(next[4].evidence, 'required');                              // the rule is written out
  assert.equal(set[1].show_if?.question, 'a');                             // the set itself is not touched
  assert.deepEqual(brokenBranches(next), []);
});

test('a follow-up of a choice names its answers the way the evidence rule does, and survives a reworded answer', () => {
  const base = q('freq', {
    type: 'multiple_choice', options: [{ value: 'Weekly', label: 'Weekly', score: 1 }, { value: 'Never', label: 'Never', score: 0 }],
    follow_up: { when: ['Never'], template_id: 7 },
  });
  const d = draftFrom(base);
  assert.deepEqual(d.followWhen, [d.options[1].uid]);
  d.options[1].label = 'Not at all';
  d.options.push({ ...blankOption('Rarely'), score: 20 });
  d.followWhen.push(d.options[2].uid);
  assert.deepEqual(questionFrom(d, base).follow_up, { when: ['Never', 'Rarely'], template_id: 7 });
  d.followWhen = [];
  assert.deepEqual(questionFrom(d, base).follow_up, { when: [], template_id: 7 });
  assert.deepEqual(draftProblems(d), ['Pick which answers send the follow-up.']);
});

test('the library offers the starter sets, then the other live questionnaires that have questions', () => {
  const t = (id: number, extra: Partial<Template> = {}): Template => ({
    id, name: `T${id}`, description: null, category: 'security', questions: [q('a')], question_count: 1, section_count: 1, latest_version: null,
    used: false, archived_at: null, default_tiers: [], updated_by_name: null, created_at: '', updated_at: '', ...extra,
  });
  const sets = librarySets([t(1), t(2, { archived_at: '2026-01-01T00:00:00' }), t(3, { questions: [] }), t(4)], 4);
  assert.deepEqual(sets.map((s) => s.key), [...STARTER_SETS.map((s) => s.key), 'questionnaire-1']);
  assert.equal(sets[sets.length - 1].source, 'questionnaire');
});

test('the starter sets are the old defaults, each question in a section named for its set', () => {
  assert.deepEqual(STARTER_SETS.map((s) => [s.name, s.questions.length]),
    [['Security basics', 10], ['Privacy basics', 8], ['Compliance basics', 6], ['Operational basics', 6], ['Financial basics', 5]]);
  assert.ok(STARTER_SETS.every((s) => s.questions.every((x) => sectionName(x) === s.key.replace('starter-', '').replace(/^./, (c) => c.toUpperCase()))));
  assert.equal(new Set(STARTER_SETS.flatMap((s) => s.questions.map((x) => x.id))).size, 35);
});
