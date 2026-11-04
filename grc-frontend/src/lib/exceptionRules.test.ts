// node --test "src/lib/exceptionRules.test.ts"
// The rules of Governance > Settings > Exception approvals, apart from the screen: what a rule says in words, what the editor starts with and sends, the
// refusals it makes before sending (in the server's own words, modules/governance/exception_rules.py) and how the tester's answer reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  KIND_ORDER, MAX_STEPS, PRIORITY_ORDER, RULES_KEY, RULE_NOTES, askOptions, blankStep, conditionChips, conditionsLong, emptyRuleForm, formFromRule, hasRuleErrors, payloadOf,
  payloadOfRule, personFromKey, personKey, personLabel, previewSteps, ruleErrors, ruleProblem, rulesSummary, sameRuleForm, scopeOf, slotLine, slotText, stepHow, stepText, stepsLine,
  stepsLong, turnLine,
  type ExceptionRule, type PreviewAnswer, type RuleForm, type RuleOptions, type RuleStep,
} from './exceptionRules.ts';

const step = (over: Partial<RuleStep> = {}): RuleStep => ({
  position: 1, name: 'Approval', kind: 'approval', order: 'together', rule: 'all', min_count: null, due_days: null, allow_changes: true, allow_reject: true,
  people: [{ type: 'user', id: 7, label: 'App1' }], ...over,
});
const rule = (over: Partial<ExceptionRule> = {}): ExceptionRule => ({
  id: 1, name: 'Support exceptions', department_id: 11, department_path: ['Operations', 'Support'], department_level: 2, priorities: ['high', 'critical'], doc_types: ['policy'],
  steps: [step({ position: 1, name: 'Review', kind: 'review', allow_reject: false, people: [{ type: 'user', id: 3, label: 'Rev1' }, { type: 'user', id: 4, label: 'Rev2' }] }),
          step({ position: 2, people: [{ type: 'unit_owner', label: 'Owner of the unit' }] })],
  is_active: true, created_at: '2026-11-01T09:00:00', updated_at: '2026-11-01T09:00:00', ...over,
});
const options: RuleOptions = {
  users: [{ id: 3, name: 'Rev1', email: 'rev1@acme.test' }, { id: 7, name: 'App1', email: null }],
  roles: [{ id: 3, name: 'Approvers', user_count: 3 }, { id: 5, name: 'Risk committee', user_count: 1 }],
  priorities: ['low', 'medium', 'high', 'critical'], doc_types: ['policy', 'standard'],
};
const filled = (over: Partial<RuleForm> = {}): RuleForm => {
  const f = emptyRuleForm();
  f.name = 'A rule';
  f.steps[0].people = ['user:7'];
  return { ...f, ...over };
};

// ── a rule in words ───────────────────────────────────────────────────────────────────────────────────────────────────────

test('where a rule applies: the whole organisation, or the department path with its level in the organisation\'s own words', () => {
  assert.deepEqual(scopeOf(rule({ department_id: null, department_path: [], department_level: null })), { text: 'Whole organisation', level: null });
  assert.deepEqual(scopeOf(rule()), { text: 'Operations › Support', level: 'Sub-department' });
  assert.deepEqual(scopeOf(rule({ department_path: ['Operations'], department_level: 1 }), ['Division', 'Branch', 'Team']), { text: 'Operations', level: 'Division' });
  assert.deepEqual(scopeOf(rule({ department_path: ['Operations', 'Support', 'Helpdesk'], department_level: 3 }), ['Division', 'Branch', 'Team']).level, 'Team');
  assert.deepEqual(scopeOf(rule({ department_path: [], department_level: null })), { text: 'Unknown department', level: null });       // a rule for a department the tree lost: never "everywhere"
});

test('the conditions are words, in the order given; none means any', () => {
  assert.deepEqual(conditionChips(rule()), ['High', 'Critical', 'Policy']);
  assert.deepEqual(conditionChips(rule({ priorities: [], doc_types: [] })), []);
});

test('the conditions in a sentence for a screen reader: the priorities, the kinds of policy, or "any"', () => {
  assert.equal(conditionsLong(rule()), 'Priority: High, Critical. Policy kind: Policy');
  assert.equal(conditionsLong(rule({ doc_types: [] })), 'Priority: High, Critical');
  assert.equal(conditionsLong(rule({ priorities: [], doc_types: ['policy', 'standard'] })), 'Policy kind: Policy, Standard');
  assert.equal(conditionsLong(rule({ priorities: [], doc_types: [] })), 'Any priority and kind of policy');
});

test('the card says how many rules there are and how many are off', () => {
  assert.equal(rulesSummary([]), '0 rules');
  assert.equal(rulesSummary([{ is_active: true }]), '1 rule');
  assert.equal(rulesSummary([{ is_active: true }, { is_active: false }, { is_active: false }]), '3 rules · 2 off');
});

test('who a step asks: a person by name, a role with its word, the owners in the organisation\'s words', () => {
  assert.equal(personLabel({ type: 'user', label: 'Rev1' }), 'Rev1');
  assert.equal(personLabel({ type: 'role', label: 'Approvers' }), 'Role: Approvers');
  assert.equal(personLabel({ type: 'unit_owner', label: 'Owner of the unit' }), 'Owner of the unit');
  assert.equal(personLabel({ type: 'parent_owner', label: 'Owner of its parent' }), 'Owner of its parent department');
});

test('the chain a cell shows: each step\'s name and first two people, then +N; the tooltip has everyone and how they answer', () => {
  const r = rule();
  assert.equal(stepsLine(r.steps), 'Review: Rev1, Rev2 → Approval: Owner of the unit');
  const many = step({ name: 'Review', kind: 'review', rule: 'any', due_days: 3, people: ['A', 'B', 'C', 'D'].map((label, i) => ({ type: 'user' as const, id: i + 1, label })) });
  assert.equal(stepText(many), 'Review: A, B +2');
  assert.equal(stepsLong([many, step()]), 'Review: A, B, C, D (Any one · 3 days)\nApproval: App1');
});

test('how a step\'s people answer: nothing is said for one person, "At least N" carries its number, days are singular or plural', () => {
  const two = [{}, {}];
  assert.equal(stepHow({ order: 'together', rule: 'all', min_count: null, due_days: null, people: [{}] }), '');
  assert.equal(stepHow({ order: 'together', rule: 'all', min_count: null, due_days: 1, people: [{}] }), '1 day');
  assert.equal(stepHow({ order: 'together', rule: 'all', min_count: null, due_days: null, people: two }), 'Everyone');
  assert.equal(stepHow({ order: 'together', rule: 'any', min_count: null, due_days: 5, people: two }), 'Any one · 5 days');
  assert.equal(stepHow({ order: 'together', rule: 'at_least', min_count: 2, due_days: null, people: [{}, {}, {}] }), 'At least 2');
  assert.equal(stepHow({ order: 'in_turn', rule: 'all', min_count: null, due_days: null, people: two }), 'One after another');
});

test('a slot of the tester: a person is their name, a role or an owner says who would answer, nobody who can act is said', () => {
  assert.equal(slotText('Rev1', ['Rev1']), 'Rev1');
  assert.equal(slotText('Role: Approvers', ['App1', 'App2', 'App3', 'App4']), 'Role: Approvers · App1, App2, App3 +1');
  assert.equal(slotText('Owner of Support', ['Sup']), 'Owner of Support · Sup');
  assert.equal(slotText('Owner of Helpdesk (none set)', []), 'Owner of Helpdesk (none set)');
  assert.equal(slotText('Role: Nobody', []), 'Role: Nobody · nobody');
  const name = (id: number) => ({ 1: 'App1', 2: 'App2' } as Record<number, string>)[id] ?? `User #${id}`;
  assert.equal(slotLine({ key: 'user:1', type: 'user', ref: 1, label: 'App1', members: [1] }, name), 'App1');
  assert.equal(slotLine({ key: 'user:9', type: 'user', ref: 9, label: 'Gone', members: [] }, name), 'Gone · nobody');       // an inactive person cannot act
  assert.equal(slotLine({ key: 'role:3', type: 'role', ref: 3, label: 'Role: Approvers', members: [1, 2] }, name), 'Role: Approvers · App1, App2');
});

test('the tester\'s answer, step by step: its name, how its people answer and who it would ask', () => {
  const answer: PreviewAnswer = {
    rule: { id: 1, name: 'Support', department_id: 11 }, problems: [],
    steps: [{ ...step({ name: 'Review', kind: 'review', rule: 'any', due_days: 2, people: [] }), people: [{ type: 'unit_owner' }, { type: 'role', id: 3 }], slots: [
      { key: 'unit_owner:11', type: 'unit_owner', ref: null, label: 'Owner of Support', members: [5] },
      { key: 'role:3', type: 'role', ref: 3, label: 'Role: Approvers', members: [1, 2] },
    ] }],
  };
  assert.deepEqual(previewSteps(answer, (id) => `P${id}`), [{ position: 1, name: 'Review', how: 'Any one · 2 days', who: ['Owner of Support · P5', 'Role: Approvers · P1, P2'] }]);
});

// ── the editor starts ─────────────────────────────────────────────────────────────────────────────────────────────────────

test('people are held as keys and come back as the server takes them: a person or a role with its id, an owner with none', () => {
  assert.equal(personKey({ type: 'user', id: 12 }), 'user:12');
  assert.equal(personKey({ type: 'role', id: 3 }), 'role:3');
  assert.equal(personKey({ type: 'unit_owner' }), 'unit_owner');
  assert.deepEqual(personFromKey('user:12'), { type: 'user', id: 12 });
  assert.deepEqual(personFromKey('role:3'), { type: 'role', id: 3 });
  assert.deepEqual(personFromKey('parent_owner'), { type: 'parent_owner' });
});

test('a new rule starts with one approval step and nobody chosen: every rule needs an approval last, and the person says who', () => {
  const f = emptyRuleForm();
  assert.equal(f.steps.length, 1);
  assert.deepEqual([f.steps[0].kind, f.steps[0].people.length, f.steps[0].allow_reject, f.steps[0].allow_changes], ['approval', 0, true, true]);
  assert.deepEqual([f.name, f.department_id, f.is_active], ['', '', true]);
  assert.equal(blankStep('review').allow_reject, false);                                    // a review does not reject unless told to (the server's default)
  assert.notEqual(blankStep().key, blankStep().key);
});

test('editing starts with the rule as saved: default step names are left blank (the kind names them), the department is its id', () => {
  const f = formFromRule(rule());
  assert.equal(f.department_id, '11');
  assert.deepEqual(f.steps.map((s) => [s.name, s.kind, s.people]), [['', 'review', ['user:3', 'user:4']], ['', 'approval', ['unit_owner']]]);
  const custom = formFromRule(rule({ steps: [step({ name: 'CISO sign-off', min_count: 2, rule: 'at_least', due_days: 3 })], department_id: null }));
  assert.deepEqual([custom.department_id, custom.steps[0].name, custom.steps[0].min_count, custom.steps[0].due_days], ['', 'CISO sign-off', '2', '3']);
});

test('the form is the same as what it started with until something is changed (the steps\' keys do not count), and the order of conditions does not matter', () => {
  const a = formFromRule(rule());
  const b = formFromRule(rule({ priorities: ['critical', 'high'] }));
  assert.equal(sameRuleForm(a, b), true);
  b.steps[1].people = ['user:7'];
  assert.equal(sameRuleForm(a, b), false);
  assert.equal(sameRuleForm(emptyRuleForm(), emptyRuleForm()), true);
});

test('the pickers list the two owners, the roles with how many people hold them and the people; one a saved rule asks that is gone still shows', () => {
  const list = askOptions(options);
  assert.deepEqual(list.map((o) => o.value), ['unit_owner', 'parent_owner', 'role:3', 'role:5', 'user:3', 'user:7']);
  assert.deepEqual(list.find((o) => o.value === 'role:3'), { value: 'role:3', label: 'Role: Approvers', description: '3 people' });
  assert.equal(list.find((o) => o.value === 'role:5')?.description, '1 person');
  assert.equal(list.find((o) => o.value === 'user:3')?.description, 'rev1@acme.test');
  const kept = askOptions(options, [{ type: 'user', id: 99, label: 'Left Company' }, { type: 'role', id: 8, label: 'Old role' }, { type: 'user', id: 3, label: 'Rev1' }]);
  assert.deepEqual(kept.slice(-2).map((o) => [o.value, o.label]), [['user:99', 'Left Company'], ['role:8', 'Role: Old role']]);
  assert.equal(kept.filter((o) => o.value === 'user:3').length, 1);
  assert.deepEqual(askOptions(null).map((o) => o.value), ['unit_owner', 'parent_owner']);       // a person who cannot edit has no lists: the owners are still words
  assert.equal(turnLine(['user:3', 'unit_owner', 'role:3'], list), 'Rev1, then Owner of the unit, then Role: Approvers');
});

// ── what the editor sends ─────────────────────────────────────────────────────────────────────────────────────────────────

test('what is sent: the name trimmed, the whole organisation as null, the conditions in a fixed order, people as the server takes them', () => {
  const f = filled({ name: '  Support  ', department_id: '11', priorities: ['critical', 'low'], doc_types: ['standard', 'policy'] });
  f.steps[0].people = ['user:7', 'role:3', 'unit_owner'];
  assert.deepEqual(payloadOf(f), {
    name: 'Support', department_id: 11, priorities: ['low', 'critical'], doc_types: ['policy', 'standard'], is_active: true,
    steps: [{ name: '', kind: 'approval', order: 'together', rule: 'all', min_count: null, due_days: null, allow_reject: true, allow_changes: true,
      people: [{ type: 'user', id: 7 }, { type: 'role', id: 3 }, { type: 'unit_owner' }] }],
  });
  assert.equal(payloadOf(filled()).department_id, null);
  assert.deepEqual(PRIORITY_ORDER, ['low', 'medium', 'high', 'critical']);
  assert.equal(KIND_ORDER[0], 'policy');
});

test('one after another is always everyone and sends no number; "at least" sends its number; empty days are none, a number is a number', () => {
  const f = filled();
  f.steps[0].people = ['user:7', 'user:8', 'user:9'];
  Object.assign(f.steps[0], { rule: 'at_least', min_count: '2', due_days: ' 4 ' });
  let s = payloadOf(f).steps[0];
  assert.deepEqual([s.order, s.rule, s.min_count, s.due_days], ['together', 'at_least', 2, 4]);
  f.steps[0].order = 'in_turn';
  s = payloadOf(f).steps[0];
  assert.deepEqual([s.order, s.rule, s.min_count], ['in_turn', 'all', null]);
  Object.assign(f.steps[0], { order: 'together', rule: 'any', due_days: '' });
  s = payloadOf(f).steps[0];
  assert.deepEqual([s.rule, s.min_count, s.due_days], ['any', null, null]);
});

test('switching a saved rule off or on sends the whole rule as it is, without the labels the server added', () => {
  const body = payloadOfRule(rule(), false);
  assert.equal(body.is_active, false);
  assert.deepEqual(body.steps[1].people, [{ type: 'unit_owner' }]);
  assert.deepEqual(body.steps[0].people, [{ type: 'user', id: 3 }, { type: 'user', id: 4 }]);
  assert.deepEqual([body.name, body.department_id, body.priorities, body.doc_types], ['Support exceptions', 11, ['high', 'critical'], ['policy']]);
  assert.equal(JSON.stringify(body).includes('label'), false);
});

test('a rule read from the server and sent back is what it was (nothing is lost on the way)', () => {
  const r = rule();
  const again = payloadOf(formFromRule(r));
  const direct = payloadOfRule(r, true);
  assert.deepEqual(again.steps.map((s) => ({ ...s, name: '' })), direct.steps.map((s) => ({ ...s, name: '' })));
  assert.deepEqual([again.name, again.department_id, again.priorities, again.doc_types], [direct.name, direct.department_id, direct.priorities, direct.doc_types]);
});

// ── what the editor checks ────────────────────────────────────────────────────────────────────────────────────────────────

test('a rule that is fine has no errors', () => {
  assert.equal(hasRuleErrors(ruleErrors(filled())), false);
  assert.equal(hasRuleErrors(ruleErrors(formFromRule(rule()))), false);
});

test('a name is needed and is at most 120 characters', () => {
  assert.equal(ruleErrors(filled({ name: '   ' })).name, 'A rule needs a name.');
  assert.equal(ruleErrors(filled({ name: 'x'.repeat(121) })).name, "A rule's name is at most 120 characters.");
  assert.equal(ruleErrors(filled({ name: 'x'.repeat(120) })).name, undefined);
});

test('the steps: at least one, at most eight, the last an approval; each names someone', () => {
  assert.equal(ruleErrors(filled({ steps: [] })).steps, 'A rule needs at least one step.');
  assert.equal(ruleErrors(filled({ steps: Array.from({ length: MAX_STEPS + 1 }, () => ({ ...blankStep(), people: ['user:1'] })) })).steps, 'A rule has at most 8 steps.');
  const f = filled();
  f.steps[0].kind = 'review';
  assert.equal(ruleErrors(f).steps, 'The last step has to be an approval: somebody decides.');
  const g = filled();
  g.steps[0].people = [];
  const e = ruleErrors(g);
  assert.deepEqual(e.byStep[g.steps[0].key], { people: 'Choose who is asked.' });
  assert.equal(hasRuleErrors(e), true);
});

test('"at least N" needs a whole number from 1 to the number of people asked; the one after another and the other rules need none', () => {
  const f = filled();
  f.steps[0].people = ['user:1', 'user:2'];
  f.steps[0].rule = 'at_least';
  const err = (n: string) => { f.steps[0].min_count = n; return ruleErrors(f).byStep[f.steps[0].key]?.min_count; };
  assert.equal(err('2'), undefined);
  assert.equal(err('1'), undefined);
  assert.equal(err('3'), 'At least how many have to decide? A number from 1 to 2.');
  assert.equal(err('0'), 'At least how many have to decide? A number from 1 to 2.');
  assert.equal(err(''), 'At least how many have to decide? A number from 1 to 2.');
  assert.equal(err('1.5'), 'At least how many have to decide? A number from 1 to 2.');
  f.steps[0].order = 'in_turn';
  assert.equal(err('9'), undefined);                                                       // one after another is everyone: the number is not used
  f.steps[0].order = 'together';
  f.steps[0].rule = 'any';
  assert.equal(err('9'), undefined);
});

test('the days to act are empty (none) or a number from 1 to 365', () => {
  const f = filled();
  const err = (n: string) => { f.steps[0].due_days = n; return ruleErrors(f).byStep[f.steps[0].key]?.due_days; };
  for (const ok of ['', ' ', '1', '365']) assert.equal(err(ok), undefined, ok);
  for (const bad of ['0', '366', '-2', '2.5']) assert.equal(err(bad), 'The days to act must be from 1 to 365.', bad);
  assert.equal(err('soon'), 'The days to act must be a number.');
});

test('the first thing wrong is one sentence in the server\'s own format, for the line above Save; nothing when nothing is', () => {
  assert.equal(ruleProblem(filled()), '');
  assert.equal(ruleProblem(filled({ name: ' ' })), 'A rule needs a name.');
  assert.equal(ruleProblem(filled({ steps: [] })), 'A rule needs at least one step.');
  const f = filled();
  f.steps[0].people = [];
  assert.equal(ruleProblem(f), 'Step 1 (Approval): choose who is asked.');
  f.steps[0].name = 'CISO sign-off';
  assert.equal(ruleProblem(f), 'Step 1 (CISO sign-off): choose who is asked.');
  const g = filled();
  g.steps[0].people = ['user:1', 'user:2'];
  Object.assign(g.steps[0], { rule: 'at_least', min_count: '5' });
  assert.equal(ruleProblem(g), 'Step 1 (Approval): at least how many have to decide? A number from 1 to 2.');
  Object.assign(g.steps[0], { rule: 'any', due_days: '400' });
  assert.equal(ruleProblem(g), 'Step 1 (Approval): the days to act must be from 1 to 365.');
  const h = filled();
  h.steps.unshift({ ...blankStep('review'), people: ['user:1'] });
  h.steps[1].kind = 'review';
  assert.equal(ruleProblem(h), 'The last step has to be an approval: somebody decides.');
  assert.deepEqual(RULES_KEY, ['exception-approval-rules']);                          // the card, its editor and its tester refresh together
});

test('the notes say what the card used to say: which rule wins, when a rule applies, who decides', () => {
  assert.match(RULE_NOTES.card, /deepest department.*more conditions.*oldest/);
  assert.match(RULE_NOTES.card, /covers its sub-departments and units until one has its own/);
  assert.match(RULE_NOTES.card, /With no rule, anyone allowed to approve exceptions decides, as before/);
  assert.match(RULE_NOTES.none, /anyone allowed to approve exceptions decides, as before/);
  assert.match(RULE_NOTES.submitted, /applies when an exception is submitted.*already waiting keeps the steps it started with/);
  assert.match(RULE_NOTES.decides, /never decides it.*Only the people asked decide, administrators included/);
});
