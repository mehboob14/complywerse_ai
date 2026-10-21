import { test } from 'node:test';
import assert from 'node:assert/strict';

import { creation, shownFrameworkIds, versionGroups, versionStates } from './library.ts';

test('the Frameworks column shows what the Details dialog edits, else the frameworks the document was made with', () => {
  assert.deepEqual(shownFrameworkIds({ applicable_framework_ids: [7, 9], framework_ids: [3] }), [7, 9]);
  assert.deepEqual(shownFrameworkIds({ applicable_framework_ids: [], framework_ids: [3] }), [3]);
  assert.deepEqual(shownFrameworkIds({ framework_ids: [3] }), [3]);                       // an older server sends no applicable ids
  assert.deepEqual(shownFrameworkIds({ applicable_framework_ids: null, framework_ids: null }), []);
});

test('creating documents is offered only where the Comply AI Studio is on', () => {
  assert.equal(creation(true, true), 'buttons');
  assert.equal(creation(true, undefined), 'buttons');                       // not known yet (or an older server): as before
  assert.equal(creation(true, false), 'studio-off');
  assert.equal(creation(false, false), null);
  assert.equal(creation(false, true), null);
});

const v = (...numbers: string[]) => numbers.map((number, i) => ({ id: 100 - i, number }));
const states = (rows: { state: string }[]) => rows.map((r) => r.state);

test("a version's state: the document's own number carries its state, the published one is in force, the rest superseded", () => {
  // published at 1.1, 1.2 on its way (in review): 1.2 says the document's state, 1.1 is the one everyone reads
  assert.deepEqual(states(versionStates(v('1.2', '1.1', '1.0'), { current_version: '1.2', version_in_force: '1.1' })),
    ['current', 'in-force', 'superseded']);
  // published at its newest: that one carries "Published", nothing is "in force" beside it
  assert.deepEqual(states(versionStates(v('2.0', '1.0'), { current_version: '2.0', version_in_force: '2.0' })), ['current', 'superseded']);
  // never published (a draft): no version is in force
  assert.deepEqual(states(versionStates(v('1.1', '1.0'), { current_version: '1.1', version_in_force: null })), ['current', 'superseded']);
  // someone who reads only the version in force gets the list up to it
  assert.deepEqual(states(versionStates(v('1.1', '1.0'), { current_version: '1.2', version_in_force: '1.1' })), ['in-force', 'superseded']);
  // no current number: the newest one is the current one
  assert.deepEqual(states(versionStates(v('3.0', '2.0'), {})), ['current', 'superseded']);
  assert.deepEqual(versionStates([], { current_version: '1.0' }), []);
});

test('the versions as a hierarchy: each major with its minor versions under it, newest major first, nothing dropped', () => {
  const numbers = (groups: { head: { number: string }; minors: { number: string }[] }[]) => groups.map((g) => [g.head.number, g.minors.map((x) => x.number)]);
  // the user's case: 1.0, 1.1, 1.2, then a major 2.0 and a minor 2.1 - 1.2 is still there, under 1.0
  assert.deepEqual(numbers(versionGroups(v('2.1', '2.0', '1.2', '1.1', '1.0'))), [['2.0', ['2.1']], ['1.0', ['1.2', '1.1']]]);
  assert.deepEqual(numbers(versionGroups(v('1.10', '1.9', '1.0'))), [['1.0', ['1.10', '1.9']]]);        // 1.10 is a minor of 1, not of 10
  // a document that started at a file's 4.3: its group starts there; a major alone is a group of its own
  assert.deepEqual(numbers(versionGroups(v('5.0', '4.4', '4.3'))), [['5.0', []], ['4.3', ['4.4']]]);
  const rows = v('1.2', '1.2', '1.1', '1.0');                                        // a number written twice: both rows kept
  const [one] = versionGroups(versionStates(rows, { current_version: '1.2' }));
  assert.deepEqual([one.head.id, ...one.minors.map((x) => x.id)], [97, 100, 99, 98]);
  assert.deepEqual([one.head.state, one.minors[0].state], ['superseded', 'current']); // the states come along
  assert.deepEqual(versionGroups([]), []);
});

test('a number written twice (a gap fix keeps a copy of the text before it): only the earliest row with it is in force', () => {
  const rows = versionStates(v('1.3', '1.2', '1.2', '1.1'), { current_version: '1.3', version_in_force: '1.2' });
  assert.deepEqual(states(rows), ['current', 'superseded', 'in-force', 'superseded']);
  assert.deepEqual(rows.map((r) => r.id), [100, 99, 98, 97]);              // the rows themselves are kept, in their order
});
