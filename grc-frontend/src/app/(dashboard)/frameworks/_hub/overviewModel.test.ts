// node --test "src/app/(dashboard)/frameworks/_hub/overviewModel.test.ts"
// What the details of a library framework say: free-form fields become plain lines (never raw JSON), a missing field is no section (no invented default list or lifecycle), and the version
// is "v2024", never "vv2024".
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { levelNames, lineOf, linesOf, overviewOf, versionLabel } from './overviewModel.ts';

test('a free-form item is a plain line: a string, an object by its name and description, else its values; nothing is printed as JSON', () => {
  assert.equal(lineOf('  Define the scope '), 'Define the scope');
  assert.equal(lineOf({ name: 'Gap analysis', description: 'Compare practice with the standard' }), 'Gap analysis: Compare practice with the standard');
  assert.equal(lineOf({ title: 'Readiness review' }), 'Readiness review');
  assert.equal(lineOf({ a: 'one', b: 2, c: null }), 'one · 2');
  assert.equal(lineOf(null), '');
  assert.doesNotMatch(lineOf({ phase: 'Prepare', detail: 'Policies' }), /[{}"]/);
});

test('a list is an array, an object of key and value, or one string: its lines, in order, with the empty ones gone', () => {
  assert.deepEqual(linesOf(['a', ' ', 'b']), ['a', 'b']);
  assert.deepEqual(linesOf({ policies: 'Written and approved', evidence_records: 'Kept for a year' }), ['Policies: Written and approved', 'Evidence records: Kept for a year']);
  assert.deepEqual(linesOf('one approach'), ['one approach']);
  assert.deepEqual(linesOf(null), []);
  assert.deepEqual(linesOf(undefined), []);
  assert.deepEqual(linesOf([]), []);
});

test('certification levels are named; a nameless one is "Level N" as the old page said', () => {
  assert.deepEqual(levelNames(['Basic', { name: 'Advanced' }, {}, null, { name: '' }]), ['Basic', 'Advanced', 'Level 3', 'Level 5']);
  assert.deepEqual(levelNames(undefined), []);
  assert.deepEqual(levelNames('Basic'), []);
});

test('a framework with nothing recorded has no sections: no default artifact list, no fixed lifecycle', () => {
  const none = overviewOf({ id: 1, name: 'X' });
  assert.deepEqual([none.objectives, none.approach, none.artifacts, none.levels], [[], [], [], []]);
  assert.deepEqual([none.purpose, none.scope, none.audience, none.penalty, none.reasoning, none.validity], ['', '', '', '', '', '']);
  const some = overviewOf({ id: 2, name: 'Y', framework_purpose: ' Protect card data ', framework_objectives: ['Keep data safe'], required_artifacts: { policies: 'Written' }, certification_levels: ['1'], penalty_for_non_compliance: 'Fines', classification_reasoning: 'Reads as a standard' });
  assert.equal(some.purpose, 'Protect card data');
  assert.deepEqual(some.artifacts, ['Policies: Written']);
  assert.equal(some.penalty, 'Fines');
});

test('the version is said once with its "v"', () => {
  assert.equal(versionLabel('v2024'), 'v2024');
  assert.equal(versionLabel('V1.0'), 'V1.0');
  assert.equal(versionLabel('2022'), 'v2022');
  assert.equal(versionLabel('2017 (with 2022 updates)'), 'v2017 (with 2022 updates)');
  assert.equal(versionLabel('Regulation (EU) 2022/2554'), 'Regulation (EU) 2022/2554', 'a name is not a number');
  assert.equal(versionLabel(' '), null);
  assert.equal(versionLabel(null), null);
});
