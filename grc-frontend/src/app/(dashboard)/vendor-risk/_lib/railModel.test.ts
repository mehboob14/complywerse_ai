// node --test "src/app/(dashboard)/vendor-risk/_lib/railModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RAIL, entryOf, tabActive } from './railModel.ts';

test('the rail is short: eight entries in the order the work flows, no Shadow SaaS and no Procurement', () => {
  assert.deepEqual(RAIL.map((e) => e.name), ['Overview', 'Vendors', 'Intake', 'Findings', 'Questionnaires', 'Monitoring', 'Insights', 'Setup']);
  const everything = JSON.stringify(RAIL).toLowerCase();
  assert.equal(everything.includes('shadow'), false);
  assert.equal(everything.includes('procurement'), false);
});

test('every page that used to have a rail entry still belongs to one, and the three overview pages are one entry', () => {
  const expect: Record<string, string> = {
    '/vendor-risk': 'overview', '/vendor-risk/attention': 'overview', '/vendor-risk/actions': 'overview',
    '/vendor-risk/vendors': 'vendors', '/vendor-risk/vendors/12': 'vendors', '/vendor-risk/vendors/12/summary': 'vendors', '/vendor-risk/vendors/new': 'vendors',
    '/vendor-risk/assessments': 'vendors', '/vendor-risk/assessments/9': 'vendors', '/vendor-risk/contracts': 'vendors', '/vendor-risk/reviews': 'vendors',
    '/vendor-risk/intake': 'intake', '/vendor-risk/intake/4': 'intake', '/vendor-risk/findings': 'findings',
    '/vendor-risk/questionnaires': 'questionnaires', '/vendor-risk/questionnaires/abc/builder': 'questionnaires',
    '/vendor-risk/monitoring': 'monitoring', '/vendor-risk/alerts': 'monitoring', '/vendor-risk/alerts/3': 'monitoring', '/vendor-risk/security': 'monitoring',
    '/vendor-risk/technology': 'monitoring', '/vendor-risk/concentration': 'monitoring',
    '/vendor-risk/risk-360': 'insights', '/vendor-risk/comply-analysis': 'insights', '/vendor-risk/comply-analysis/5': 'insights',
    '/vendor-risk/reports': 'insights', '/vendor-risk/reports/7': 'insights', '/vendor-risk/exchange': 'insights',
    '/vendor-risk/roster': 'setup', '/vendor-risk/policy': 'setup', '/vendor-risk/settings': 'setup', '/vendor-risk/settings/emails': 'setup',
    '/vendor-risk/policy/': 'setup', '/vendor-risk/vendors?tier=high': 'vendors',
  };
  for (const [path, key] of Object.entries(expect)) assert.equal(entryOf(path)?.key, key, path);
});

test('a retired page and a page of another module belong to no entry', () => {
  for (const path of ['/vendor-risk/shadow-saas', '/vendor-risk/procurement', '/risks', '', '/vendor-riskx', '/vendor-risk/vendors-old']) {
    assert.equal(entryOf(path), undefined, path);
  }
});

test('an entry with tabs links to its first tab, and a tab is on for its page and the pages beneath it only', () => {
  for (const e of RAIL) if (e.tabs) assert.equal(e.href, e.tabs[0].href, e.key);
  assert.equal(tabActive('/vendor-risk/assessments/9', '/vendor-risk/assessments'), true);
  assert.equal(tabActive('/vendor-risk/vendors/12', '/vendor-risk/vendors'), true);
  assert.equal(tabActive('/vendor-risk/vendors-old', '/vendor-risk/vendors'), false);
  assert.equal(tabActive('/vendor-risk/settings/emails', '/vendor-risk/settings'), true);
  assert.equal(tabActive('/vendor-risk/roster', '/vendor-risk/policy'), false);
});

test('only Intake and Findings carry a count, as in the reference product', () => {
  assert.deepEqual(RAIL.filter((e) => e.count).map((e) => [e.key, e.count]), [['intake', 'intake_pending'], ['findings', 'open_findings']]);
});
