// node --test "src/app/(dashboard)/bcm/_tabs/tabsModel.test.ts"
// The strip of tabs of the Business Continuity list pages: which tab a path lights, and which tabs a person is offered (the rights the three sidebar leaves used, plus the Findings
// tab on its own right; the tab being looked at is never taken away).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BCM_TABS, tabOf, tabsFor } from './tabsModel.ts';

test('four tabs, in the order of the audit, each with the address it has always had', () => {
  assert.deepEqual(BCM_TABS.map((t) => [t.label, t.href]), [['Overview', '/bcm'], ['Plans', '/bcm/plans'], ['Drills', '/bcm/drills'], ['Findings', '/bcm/findings']]);
});

test('a list page lights its own tab; a plan, a drill or another path lights none', () => {
  assert.equal(tabOf('/bcm'), 'overview');
  assert.equal(tabOf('/bcm/'), 'overview');
  assert.equal(tabOf('/bcm/plans'), 'plans');
  assert.equal(tabOf('/bcm/drills'), 'drills');
  assert.equal(tabOf('/bcm/findings'), 'findings');
  assert.equal(tabOf('/bcm/plans/7'), null);
  assert.equal(tabOf('/bcm/drills/7'), null);
  assert.equal(tabOf('/governance'), null);
});

test('a person is offered the tabs whose right they hold, and keeps the one they are on', () => {
  const holds = (...rights: string[]) => (right: string) => rights.includes(right);
  assert.deepEqual(tabsFor(holds('bcm:plans:*', 'bcm:drills:*'), null).map((t) => t.key), ['plans', 'drills']);
  assert.deepEqual(tabsFor(holds(), null).map((t) => t.key), []);
  assert.deepEqual(tabsFor(holds('bcm:drills:*'), 'overview').map((t) => t.key), ['overview', 'drills'], 'a link to a page keeps its tab on the strip');
  assert.deepEqual(tabsFor(() => true, 'plans').map((t) => t.key), ['overview', 'plans', 'drills', 'findings']);
});
