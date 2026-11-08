// node --test "src/app/(dashboard)/evidence/_tabs/tabsModel.test.ts"
// Which tab of the Evidence Management strip a page lights, and that the strip links to addresses the pages really read.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EVIDENCE_TABS, tabOf } from './tabsModel.ts';
import { LIBRARY_SCHEMA, pageOf, type LibraryAddress } from '../_library/libraryAddress.ts';
import { readAddress } from '../../../../lib/addressState.ts';

test('the five tabs, in order, each with an address', () => {
  assert.deepEqual(EVIDENCE_TABS.map((t) => t.label), ['Library', 'Insights', 'Requirements', 'Audit packages', 'Settings']);
  assert.deepEqual(EVIDENCE_TABS.map((t) => t.href), ['/evidence', '/evidence?view=insights', '/evidence-requirements', '/evidence/audit-packages', '/evidence?section=settings']);
});

test('the tab a page lights follows the path, and on /evidence the view and the section; any other path lights none', () => {
  assert.equal(tabOf('/evidence'), 'library');
  assert.equal(tabOf('/evidence/'), 'library');
  assert.equal(tabOf('/evidence', 'board'), 'library');
  assert.equal(tabOf('/evidence', 'insights'), 'insights');
  assert.equal(tabOf('/evidence', 'insights', 'settings'), 'settings', 'settings wins over the view');
  assert.equal(tabOf('/evidence-requirements'), 'requirements');
  assert.equal(tabOf('/evidence/audit-packages'), 'packages');
  assert.equal(tabOf('/evidence/42'), null, 'the record page has its own head');
  assert.equal(tabOf('/risks'), null);
});

test('every tab address reads back as the page it names', () => {
  for (const tab of EVIDENCE_TABS.filter((t) => t.href.startsWith('/evidence?'))) {
    const page = pageOf(readAddress(LIBRARY_SCHEMA, tab.href.slice('/evidence'.length)) as unknown as LibraryAddress);
    assert.equal(tabOf('/evidence', page.view, page.section), tab.key, tab.label);
  }
});
