// node --test "src/app/(dashboard)/governance/documents/_workspace/folders/exceptionsModel.test.ts"
// Which exception approval rules apply to a unit, and in what order the server tries them (modules/governance/exception_rules.py `pick`): the deepest unit first, then more
// conditions, then the oldest; the organisation's rules for everything; switched-off rules apply to nothing; the rule an exception with no special conditions follows.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import type { ExceptionRule } from '../../../../../../lib/exceptionRules.ts';
import { conditionCount, otherwise, rulesFor } from './exceptionsModel.ts';

const rule = (id: number, over: Partial<ExceptionRule> = {}): ExceptionRule => ({
  id, name: `Rule ${id}`, department_id: null, department_path: [], department_level: null, priorities: [], doc_types: [], exception_types: [], steps: [], is_active: true, created_at: null, updated_at: null, ...over,
});
const at = (id: number, dept: number, path: string[], over: Partial<ExceptionRule> = {}) => rule(id, { department_id: dept, department_path: path, department_level: path.length, ...over });

// the tree: Operations (1) > Support (2) > Helpdesk (3); Finance (9) is elsewhere
const PATH_HELPDESK = [1, 2, 3];

test('the rules of a unit: its own, the ones above it and the organisation\'s, never another branch\'s; the order is the server\'s', () => {
  const rules = [
    rule(1),                                                                                   // the whole organisation
    at(2, 1, ['Operations']),
    at(3, 2, ['Operations', 'Support']),
    at(4, 3, ['Operations', 'Support', 'Helpdesk']),
    at(5, 9, ['Finance']),
  ];
  const r = rulesFor(rules, PATH_HELPDESK);
  assert.deepEqual(r.applying.map((a) => a.rule.id), [4, 3, 2, 1], 'the deepest first; Finance is not on the way');
  assert.deepEqual(r.applying.map((a) => a.from), ['here', 'above', 'above', 'organisation']);
  assert.deepEqual(r.applying.map((a) => a.fromWords), ['This unit', 'Support', 'Operations', 'Whole organisation']);
  assert.deepEqual(rulesFor(rules, [1, 2]).applying.map((a) => a.rule.id), [3, 2, 1], 'Support: nothing of Helpdesk\'s');
  assert.deepEqual(rulesFor(rules, [1, 2]).applying.map((a) => a.from), ['here', 'above', 'organisation']);
});

test('at the same depth more conditions come first, then the oldest; a rule with conditions is not the fallback', () => {
  const rules = [
    at(7, 1, ['Operations']),
    at(5, 1, ['Operations'], { priorities: ['high'] }),
    at(6, 1, ['Operations'], { priorities: ['high'], doc_types: ['policy'] }),
    at(4, 1, ['Operations']),
  ];
  const r = rulesFor(rules, [1]);
  assert.deepEqual(r.applying.map((a) => a.rule.id), [6, 5, 4, 7]);
  assert.equal(otherwise(r.applying)?.rule.id, 4, 'an exception none of the conditions narrow follows the oldest rule that names none');
  assert.equal(otherwise(rulesFor([at(5, 1, ['Operations'], { priorities: ['high'] })], [1]).applying), null, 'every rule has a condition: some exceptions follow none');
  assert.equal(otherwise([]), null);
  assert.equal(conditionCount(rule(1, { priorities: ['high'], exception_types: ['x', 'y'] })), 2, 'a kind counts once however many choices it holds');
  assert.equal(conditionCount(rule(1)), 0);
});

test('a switched-off rule applies to nothing, and is counted', () => {
  const rules = [at(1, 1, ['Operations'], { is_active: false }), rule(2), rule(3, { is_active: false }), at(4, 9, ['Finance'], { is_active: false })];
  const r = rulesFor(rules, [1]);
  assert.deepEqual(r.applying.map((a) => a.rule.id), [2]);
  assert.equal(r.off, 2, 'only those that could have applied here');
});

test('the organisation: its own rules only, and how many belong to units', () => {
  const rules = [rule(1), rule(2, { is_active: false }), at(3, 1, ['Operations']), at(4, 2, ['Operations', 'Support'])];
  const r = rulesFor(rules, []);
  assert.deepEqual(r.applying.map((a) => [a.rule.id, a.from]), [[1, 'organisation']]);
  assert.equal(r.off, 1);
  assert.equal(r.elsewhere, 2);
  assert.equal(rulesFor(rules, [1]).elsewhere, 0, 'a unit does not count the organisation\'s view');
  assert.deepEqual(rulesFor([], [1]).applying, []);
});

test('a rule above whose name the tree no longer holds is still listed, named in general words', () => {
  const r = rulesFor([rule(1, { department_id: 1, department_path: [] })], [1, 2]);
  assert.equal(r.applying.length, 1);
  assert.equal(r.applying[0].fromWords, 'A unit above');
});
