// node --test "src/lib/exceptionRules.test.ts"
// The rules of Governance > Settings > Exception approvals, apart from the screen: what a rule says in words, what the editor starts with and sends, the
// refusals it makes before sending (in the server's own words, modules/governance/exception_rules.py) and how the tester's answer reads; the implementer
// a rule may name (D62) is the last section.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import {
  IMPLEMENTER_NAME, IMPLEMENT_WORD, KIND_ORDER, MAX_STEPS, PRIORITY_ORDER, RULES_KEY, RULE_NOTES, TYPE_NAME_MAX, TYPE_NOTES, askOptions, blankImplementer, blankStep, conditionChips, conditionsLong,
  emptyRuleForm, formFromRule, hasRuleErrors, payloadOf, payloadOfRule, personFromKey, personKey, personLabel, previewImplementer, previewSteps, ruleErrors, ruleProblem, rulesSummary,
  sameRuleForm, scopeOf, slotLine, slotText, stepHow, stepText, stepsLine, stepsLong, turnLine, sameTypes, typeChoiceLabel, typeChoices, typeDrafts, typeLabel, typeProblem, typesPayload,
  type ExceptionRule, type PreviewAnswer, type RuleForm, type RuleImplementer, type RuleOptions, type RuleStep,
} from './exceptionRules.ts';

const step = (over: Partial<RuleStep> = {}): RuleStep => ({
  position: 1, name: 'Approval', kind: 'approval', order: 'together', rule: 'all', min_count: null, due_days: null, allow_changes: true, allow_reject: true,
  people: [{ type: 'user', id: 7, label: 'App1' }], ...over,
});
const rule = (over: Partial<ExceptionRule> = {}): ExceptionRule => ({
  id: 1, name: 'Support exceptions', department_id: 11, department_path: ['Operations', 'Support'], department_level: 2, priorities: ['high', 'critical'], doc_types: ['policy'], exception_types: [],
  steps: [step({ position: 1, name: 'Review', kind: 'review', allow_reject: false, people: [{ type: 'user', id: 3, label: 'Rev1' }, { type: 'user', id: 4, label: 'Rev2' }] }),
          step({ position: 2, people: [{ type: 'unit_owner', label: 'Owner of the unit' }] })],
  implementer: null, is_active: true, created_at: '2026-11-01T09:00:00', updated_at: '2026-11-01T09:00:00', ...over,
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

test('the conditions in a sentence for a screen reader: the priorities, the document types, or "any"', () => {
  assert.equal(conditionsLong(rule()), 'Priority: High, Critical. Document type: Policy');
  assert.equal(conditionsLong(rule({ doc_types: [] })), 'Priority: High, Critical');
  assert.equal(conditionsLong(rule({ priorities: [], doc_types: ['policy', 'standard'] })), 'Document type: Policy, Standard');
  assert.equal(conditionsLong(rule({ priorities: [], doc_types: [] })), 'Any priority, document type and exception type');
  const types = [{ value: 'technical', label: 'Technical', archived: false }, { value: 'third_party', label: 'Third party', archived: true }];
  assert.equal(conditionsLong(rule({ priorities: [], doc_types: [], exception_types: ['technical', 'third_party'] }), types), 'Type: Technical, Third party');
  assert.equal(conditionsLong(rule({ exception_types: ['technical'] }), types), 'Priority: High, Critical. Document type: Policy. Type: Technical');
  assert.deepEqual(conditionChips(rule({ exception_types: ['technical', 'gone'] }), types), ['High', 'Critical', 'Policy', 'Technical', 'gone']);      // a type the list no longer holds is shown as it was kept
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
  const f = filled({ name: '  Support  ', department_id: '11', priorities: ['critical', 'low'], doc_types: ['standard', 'policy'], exception_types: ['technical'] });
  f.steps[0].people = ['user:7', 'role:3', 'unit_owner'];
  assert.deepEqual(payloadOf(f), {
    name: 'Support', department_id: 11, priorities: ['low', 'critical'], doc_types: ['policy', 'standard'], exception_types: ['technical'], is_active: true,
    steps: [{ name: '', kind: 'approval', order: 'together', rule: 'all', min_count: null, due_days: null, allow_reject: true, allow_changes: true,
      people: [{ type: 'user', id: 7 }, { type: 'role', id: 3 }, { type: 'unit_owner' }] }],
    implementer: null,                                                                       // a rule with no implementer ends at its approval
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

// ── the exception types (D59) ──

test('a rule names exception types as one more condition; the form, the switch and the comparison carry them', () => {
  const r = rule({ exception_types: ['technical'] });
  assert.deepEqual(formFromRule(r).exception_types, ['technical']);
  assert.deepEqual(formFromRule(rule()).exception_types, []);
  assert.deepEqual(formFromRule({ ...rule(), exception_types: undefined as unknown as string[] }).exception_types, [], 'an answer from before types existed');
  assert.deepEqual(payloadOfRule(r, false).exception_types, ['technical']);
  assert.ok(!sameRuleForm(formFromRule(r), { ...formFromRule(r), exception_types: [] }));
  assert.ok(sameRuleForm({ ...formFromRule(r), exception_types: ['a', 'b'] }, { ...formFromRule(r), exception_types: ['b', 'a'] }), 'chosen in any order');
  assert.deepEqual(emptyRuleForm().exception_types, []);
});

test('the types a person may choose are those in use, and the one they hold even if it was removed; a removed one says so', () => {
  const types = [{ value: 'technical', label: 'Technical', archived: false }, { value: 'third_party', label: 'Third party', archived: true }, { value: 'other', label: 'Other', archived: false }];
  assert.deepEqual(typeChoices(types).map((t) => t.value), ['technical', 'other']);
  assert.deepEqual(typeChoices(types, ['third_party']).map((t) => t.value), ['technical', 'third_party', 'other']);
  assert.deepEqual(typeChoices(types, ['gone']).map((t) => [t.value, t.archived]), [['technical', false], ['other', false], ['gone', true]], 'a type the list does not hold at all is kept, named as it was');
  assert.deepEqual(typeChoices(types, ['']).map((t) => t.value), ['technical', 'other']);
  assert.equal(typeChoiceLabel(types[0]), 'Technical');
  assert.equal(typeChoiceLabel(types[1]), 'Third party (removed)');
  assert.equal(typeLabel('technical', types), 'Technical');
  assert.equal(typeLabel('gone', types), 'gone');
  assert.equal(typeLabel('x'), 'x');
});

test('the Types drawer starts with the list, checks the obvious, and sends every type in order (a new one without a value)', () => {
  const saved = [{ value: 'technical', label: 'Technical', archived: false }, { value: 'third_party', label: 'Third party', archived: true }];
  const drafts = typeDrafts(saved);
  assert.deepEqual(drafts, saved);
  assert.ok(sameTypes(drafts, typeDrafts(saved)));
  assert.equal(typeProblem(drafts), '');
  assert.equal(typeProblem([...drafts, { value: '', label: '  ', archived: false }]), 'Give every type a name.');
  assert.equal(typeProblem([...drafts, { value: '', label: ' technical ', archived: false }]), "'technical' is listed twice.");
  assert.equal(typeProblem([{ ...drafts[0], archived: true }, drafts[1]]), 'Keep at least one type.');
  assert.equal(typeProblem([{ ...drafts[0], label: 'x'.repeat(TYPE_NAME_MAX + 1) }]), `A type's name is at most ${TYPE_NAME_MAX} characters.`);
  assert.equal(typeProblem([drafts[0], { value: '', label: 'Third party', archived: false }, { value: 'third_party', label: 'Third party', archived: true }]), '', 'a removed type is not compared');
  // what is sent: renamed ones keep their value, a new one has none, a removed one that was saved stays (archived), one added and removed again is not sent
  const edited = [{ ...drafts[0], label: '  Technology ' }, drafts[1], { value: '', label: 'Cloud', archived: false }, { value: '', label: 'Oops', archived: true }];
  assert.deepEqual(typesPayload(edited), [
    { value: 'technical', label: 'Technology', archived: false }, { value: 'third_party', label: 'Third party', archived: true }, { label: 'Cloud', archived: false },
  ]);
  assert.ok(TYPE_NOTES.card.length > 20 && TYPE_NOTES.removed.length > 20);
});

// ── the implementer (D62) ──

const implementer = (over: Partial<RuleImplementer> = {}): RuleImplementer => ({
  name: 'Implementation', due_days: 5, people: [{ type: 'user', id: 8, label: 'Chen' }, { type: 'user', id: 9, label: 'Bina' }], ...over,
});

test('the chain ends with the implementer ("Implement: Chen, Bina"), the tooltip adds how they answer and their days; a rule without one reads as before', () => {
  const r = rule({ implementer: implementer() });
  assert.equal(stepsLine(r.steps, r.implementer), 'Review: Rev1, Rev2 → Approval: Owner of the unit → Implement: Chen, Bina');
  assert.equal(stepsLong(r.steps, r.implementer), 'Review: Rev1, Rev2 (Everyone)\nApproval: Owner of the unit\nImplement: Chen, Bina (Any one · 5 days)');
  for (const none of [undefined, null]) {
    assert.equal(stepsLine(rule().steps, none), 'Review: Rev1, Rev2 → Approval: Owner of the unit');
    assert.equal(stepsLong(rule().steps, none), 'Review: Rev1, Rev2 (Everyone)\nApproval: Owner of the unit');
  }
  assert.equal(stepsLine(rule().steps), stepsLine(rule().steps, rule().implementer));
  // one person is only their days; with no days nothing; many are cut to two and +N in the cell, all in the tooltip
  const one = [{ type: 'user' as const, id: 8, label: 'Chen' }];
  assert.equal(stepsLong([], implementer({ people: one })), 'Implement: Chen (5 days)');
  assert.equal(stepsLong([], implementer({ people: one, due_days: 1 })), 'Implement: Chen (1 day)');
  assert.equal(stepsLong([], implementer({ people: one, due_days: null })), 'Implement: Chen');
  const many = ['A', 'B', 'C'].map((label, i) => ({ type: 'user' as const, id: i + 1, label }));
  assert.equal(stepsLine([], implementer({ people: many })), 'Implement: A, B +1');
  assert.equal(stepsLong([], implementer({ people: many, due_days: null })), 'Implement: A, B, C (Any one)');
  assert.equal(stepsLine([], implementer({ people: [{ type: 'unit_owner', label: 'Owner of the unit' }] })), 'Implement: Owner of the unit');
  assert.equal(IMPLEMENT_WORD, 'Implement');
});

test('the tester says who the implementer would ask now in the words of a step, and says nothing when the rule ends at its approval', () => {
  const answer: PreviewAnswer = {
    rule: { id: 1, name: 'Standard route', department_id: null }, steps: [], problems: [],
    implementer: { name: 'Implementation', due_days: 5, people: [{ type: 'user', id: 8 }, { type: 'unit_owner' }], slots: [
      { key: 'user:8', type: 'user', ref: 8, label: 'Chen', members: [8] },
      { key: 'unit_owner:7', type: 'unit_owner', ref: null, label: 'Owner of Security', members: [3] },
    ] },
  };
  assert.deepEqual(previewImplementer(answer, (id) => `P${id}`), { how: 'Any one · 5 days', who: ['Chen', 'Owner of Security · P3'] });
  // nobody who can act: the slot says so (the server's problems say it too, in `problems`)
  const nobody: PreviewAnswer = { ...answer, implementer: { name: 'Implementation', due_days: null, people: [{ type: 'unit_owner' }], slots: [
    { key: 'unit_owner:4', type: 'unit_owner', ref: null, label: 'Owner of Finance (none set)', members: [] },
  ] } };
  assert.deepEqual(previewImplementer(nobody, (id) => `P${id}`), { how: '', who: ['Owner of Finance (none set)'] });
  assert.equal(previewImplementer({ ...answer, implementer: null }, (id) => `P${id}`), null);
  assert.equal(previewImplementer({ rule: null, steps: [], problems: [] }, (id) => `P${id}`), null);              // no rule applies: the server sends no implementer at all
});

test('editing starts with the implementer as saved: its people as keys, its days as typed text, a name of its own carried; a rule without one has none', () => {
  assert.deepEqual(formFromRule(rule({ implementer: implementer() })).implementer, { name: '', people: ['user:8', 'user:9'], due_days: '5' });       // the server\'s own name is left blank
  assert.equal(formFromRule(rule()).implementer, null);
  assert.equal(formFromRule({ ...rule(), implementer: undefined as unknown as null }).implementer, null, 'an answer from before implementers existed');
  assert.equal(formFromRule(rule({ implementer: implementer({ due_days: null }) })).implementer?.due_days, '');
  assert.equal(formFromRule(rule({ implementer: implementer({ name: 'Coordination' }) })).implementer?.name, 'Coordination');
  assert.equal(emptyRuleForm().implementer, null);
  assert.deepEqual(blankImplementer(), { name: '', people: [], due_days: '' });
  assert.notEqual(blankImplementer(), blankImplementer());
});

test('adding or taking off the implementer, changing its people or its days, is a change; the order its people were chosen in is not', () => {
  const r = rule({ implementer: implementer() });
  const a = formFromRule(r);
  assert.ok(sameRuleForm(a, formFromRule(r)));
  assert.ok(!sameRuleForm(a, { ...a, implementer: null }));
  assert.ok(!sameRuleForm(formFromRule(rule()), { ...formFromRule(rule()), implementer: blankImplementer() }));
  assert.ok(!sameRuleForm(a, { ...a, implementer: { ...a.implementer!, due_days: '6' } }));
  assert.ok(!sameRuleForm(a, { ...a, implementer: { ...a.implementer!, people: ['user:8'] } }));
  assert.ok(sameRuleForm(a, { ...a, implementer: { ...a.implementer!, people: ['user:9', 'user:8'] } }), 'any one of them can act');
});

test('the implementer is sent with the rule: its people as the server takes them, no name of its own making, empty days as none; no block is null', () => {
  const sent = payloadOf(filled({ implementer: { name: '', people: ['user:8', 'unit_owner', 'role:3'], due_days: ' 5 ' } })).implementer;
  assert.deepEqual(sent, { due_days: 5, people: [{ type: 'user', id: 8 }, { type: 'unit_owner' }, { type: 'role', id: 3 }] });
  assert.ok(sent && !('name' in sent), 'the server calls it "Implementation"');
  assert.equal(payloadOf(filled({ implementer: { name: '', people: ['user:8'], due_days: '' } })).implementer?.due_days, null);
  assert.equal(payloadOf(filled()).implementer, null);
  assert.equal(payloadOf(filled({ implementer: { name: 'Coordination', people: ['user:8'], due_days: '' } })).implementer?.name, 'Coordination', 'a name the rule already had is kept');
  assert.equal(payloadOf(filled({ implementer: { name: IMPLEMENTER_NAME, people: ['user:8'], due_days: '' } })).implementer?.name, undefined);
});

test('switching a saved rule off or on sends its implementer too, without labels: the server replaces the whole rule, so leaving it out would take it away', () => {
  const r = rule({ implementer: implementer({ people: [{ type: 'user', id: 8, label: 'Chen' }, { type: 'role', id: 3, label: 'Approvers' }, { type: 'unit_owner', label: 'Owner of the unit' }] }) });
  const body = payloadOfRule(r, false);
  assert.equal(body.is_active, false);
  assert.deepEqual(body.implementer, { due_days: 5, people: [{ type: 'user', id: 8 }, { type: 'role', id: 3 }, { type: 'unit_owner' }] });
  assert.equal(JSON.stringify(body).includes('label'), false);
  assert.equal(payloadOfRule(rule(), true).implementer, null);
  assert.equal(payloadOfRule(rule({ implementer: implementer({ name: 'Coordination' }) }), true).implementer?.name, 'Coordination');
  // read from the server and sent back by the editor is what a switch sends
  assert.deepEqual(payloadOf(formFromRule(r)).implementer, body.implementer);
  const named = rule({ implementer: implementer({ name: 'Coordination', due_days: null }) });
  assert.deepEqual(payloadOf(formFromRule(named)).implementer, payloadOfRule(named, true).implementer);
  assert.equal(payloadOf(formFromRule(rule())).implementer, payloadOfRule(rule(), true).implementer);
});

test('an implementer block names someone, and its days are none or a whole number from 1 to 365: refused in the server\'s words, under the block', () => {
  assert.deepEqual(ruleErrors(filled({ implementer: blankImplementer() })).implementer, { people: 'Choose who carries it out.' });
  assert.equal(hasRuleErrors(ruleErrors(filled({ implementer: blankImplementer() }))), true);
  assert.equal(ruleErrors(filled()).implementer, undefined);                                   // no block, nothing to refuse
  const withDays = (due_days: string) => filled({ implementer: { name: '', people: ['user:8'], due_days } });
  assert.equal(hasRuleErrors(ruleErrors(withDays(''))), false);
  for (const fine of ['', ' ', '1', '365']) assert.equal(ruleErrors(withDays(fine)).implementer?.due_days, undefined, fine);
  for (const bad of ['0', '366', '-2', '2.5']) assert.equal(ruleErrors(withDays(bad)).implementer?.due_days, 'The days to implement must be from 1 to 365.', bad);
  assert.equal(ruleErrors(withDays('soon')).implementer?.due_days, 'The days to implement must be a number.');
  assert.equal(hasRuleErrors(ruleErrors(withDays('0'))), true);
  assert.deepEqual(ruleErrors(filled({ implementer: { name: '', people: [], due_days: '400' } })).implementer, { people: 'Choose who carries it out.', due_days: 'The days to implement must be from 1 to 365.' });
  // a step's days keep their own words
  const f = filled();
  f.steps[0].due_days = '400';
  assert.equal(ruleErrors(f).byStep[f.steps[0].key]?.due_days, 'The days to act must be from 1 to 365.');
});

test('the first thing wrong in the implementer reads as the server says it, after the steps\' own', () => {
  const f = filled({ implementer: blankImplementer() });
  assert.equal(ruleProblem(f), 'Implementer (Implementation): choose who carries it out.');
  f.implementer = { name: '', people: ['user:8'], due_days: '400' };
  assert.equal(ruleProblem(f), 'Implementer (Implementation): the days to implement must be from 1 to 365.');
  f.implementer = { name: 'Coordination', people: [], due_days: '' };
  assert.equal(ruleProblem(f), 'Implementer (Coordination): choose who carries it out.');
  f.steps[0].people = [];                                                                       // a step is wrong too: its sentence comes first, as the steps do on the screen
  assert.equal(ruleProblem(f), 'Step 1 (Approval): choose who is asked.');
  assert.equal(ruleProblem(filled({ implementer: { name: '', people: ['user:8'], due_days: '3' } })), '');
});

test('the implementer\'s sentences and name are the server\'s (modules/governance/exception_rules.py, when the backend is beside the frontend)', () => {
  assert.equal(IMPLEMENTER_NAME, 'Implementation');
  const py = new URL('../../../backend/grc/modules/governance/exception_rules.py', import.meta.url);
  if (!existsSync(py)) return;
  const text = readFileSync(py, 'utf8');
  for (const said of ['IMPLEMENTER_NAME = "Implementation"', 'where = f"Implementer ({name})"', ': choose who carries it out.', ': the days to implement must be a number.', ': the days to implement must be from 1 to 365.']) {
    assert.ok(text.includes(said), said);
  }
});

test('the words: a kind of document is a "Document type", a policy exception is an "exception", and the implementer\'s note is the one the user asked for', () => {
  assert.equal(RULE_NOTES.implementer, 'Asked once the last approval is given. They record the compensating controls and mark it implemented. Any one of them can act.');
  assert.match(RULE_NOTES.card, /^Who reviews and approves an exception, and who carries it out afterwards, for the whole organisation/);
  assert.match(RULE_NOTES.tester, /who would implement it/);
  for (const text of [RULE_NOTES.card, RULE_NOTES.none, RULE_NOTES.submitted, RULE_NOTES.decides, RULE_NOTES.tester, RULE_NOTES.noRule, TYPE_NOTES.card, TYPE_NOTES.removed]) {
    assert.doesNotMatch(text, /polic(y|ies) exception|policy kind|kinds? of policy/i, text);
  }
  const source = readFileSync(new URL('./exceptionRules.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /polic(y|ies) exception|policy kind|kinds? of policy/i);
});
