// node --test "src/app/(dashboard)/assessments/_tabs/tabsModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ASSESSMENT_TABS, AREA, tabOf, tabsFor } from './tabsModel.ts';

test('the strip lights the tab of the page the person is on, and none on an assessment', () => {
  assert.equal(tabOf('/assessments'), 'overview');
  assert.equal(tabOf('/assessments/'), 'overview');
  assert.equal(tabOf('/assessments/register'), 'register');
  assert.equal(tabOf('/assessments/types'), 'types');
  assert.equal(tabOf('/assessments/a/12'), null);
  assert.equal(tabOf('/assessments/dpia'), null);
  assert.equal(tabOf('/cyber-security'), null);
});

test('a tab is drawn for a person who holds its right, and the one they are on is always drawn', () => {
  const none = () => false;
  assert.deepEqual(tabsFor(none, null).map((t) => t.key), []);
  assert.deepEqual(tabsFor(none, 'register').map((t) => t.key), ['register']);
  assert.deepEqual(tabsFor((r) => r === 'compliance:assessments:*', null).map((t) => t.key), ['overview', 'register', 'types']);
  assert.equal(AREA, 'Assessments');
  assert.equal(new Set(ASSESSMENT_TABS.map((t) => t.href)).size, ASSESSMENT_TABS.length);
});
