// node --test "src/app/(dashboard)/vendor-risk/_lib/railModel.test.ts"
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Building2 } from 'lucide-react';
import { activeNavHref } from '../../../../components/layout/navActive.ts';
import type { NavEntry } from '../../../../components/layout/navAccess.ts';
import { HEAD, RAIL, SIDEBAR, WITH_ACTIONS, entryOf, headOf, tabActive, tabsOf } from './railModel.ts';

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

test('the strip of a page is the tabs of its entry: none for the Overview, Intake, Findings and Questionnaires, the same three on every page of Vendors', () => {
  assert.deepEqual(tabsOf('/vendor-risk/vendors/12').map((t) => t.name), ['Register', 'Contracts', 'Check-ins'], 'the Assessments board is the Board view of the Register now');
  assert.deepEqual(tabsOf('/vendor-risk/alerts?x=1').map((t) => t.name), ['Alerts', 'Security ratings', 'Dependencies'], 'the old Breach alerts address is still Monitoring');
  assert.deepEqual(tabsOf('/vendor-risk/technology?q=aws').map((t) => t.name), ['Alerts', 'Security ratings', 'Dependencies']);
  assert.deepEqual(tabsOf('/vendor-risk/settings/emails').map((t) => t.name), ['Roster', 'Policy', 'Settings']);
  for (const path of ['/vendor-risk', '/vendor-risk/attention', '/vendor-risk/intake', '/vendor-risk/findings', '/vendor-risk/questionnaires', '/risks']) assert.deepEqual(tabsOf(path), [], path);
});

test('every address of the model is unique, and every tab and entry is a page of the module', () => {
  const hrefs = RAIL.flatMap((e) => (e.tabs ? e.tabs.map((t) => t.href) : [e.href]));
  assert.equal(new Set(hrefs).size, hrefs.length);
  for (const h of hrefs.concat(RAIL.flatMap((e) => e.also ?? []))) assert.ok(h.startsWith('/vendor-risk'), h);
});

// ---- who draws a page's head ----

const FILE = (route: string): string => {
  const rest = route.replace(/^\/vendor-risk/, '').replace(/^\//, '').replace(/:([a-z]+)/g, '[$1]');
  return fileURLToPath(new URL(`../${rest ? `${rest}/` : ''}page.tsx`, import.meta.url));
};
/** The page and, when it keeps its head in a component of its own folder (a register's `_register/`), that component: where the head is drawn. */
const SOURCE = (route: string): string => {
  const page = FILE(route);
  const dir = join(dirname(page), '_register');
  return [page].concat(existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.tsx')).map((f) => join(dir, f)) : []).map((f) => readFileSync(f, 'utf8')).join(' ');
};

test('HEAD: a page that draws its head draws the page head of the kit; a page the layout draws has no heading of its own; every row is a real page', () => {
  for (const [path, by] of Object.entries(HEAD)) {
    const source = SOURCE(path);
    if (by === 'page') assert.match(source, /<PageHeader[\s\S]{0,80}variant="page"/, `${path} draws PageHeader variant="page" (in the page or in its _register component)`);
    if (by === 'layout') assert.ok(!/<h1|<PageHeader|ModuleHeader/.test(source), `${path}: the layout draws its head, so the page draws none`);
  }
  assert.equal(headOf('/vendor-risk/vendors?tier=high'), 'page');
  assert.equal(headOf('/vendor-risk'), 'page');
  assert.equal(headOf('/vendor-risk/vendors/12'), 'page', 'the record draws its own head (vendor-record, RecordHead.tsx)');
  assert.equal(headOf('/vendor-risk/vendors/12/summary'), 'legacy');
  assert.equal(headOf('/vendor-risk/alerts'), 'legacy', 'a forward draws nothing');
  for (const path of ['/vendor-risk/monitoring', '/vendor-risk/security', '/vendor-risk/dependencies']) assert.equal(headOf(path), 'page', `${path}: the page draws its head and the strip`);
  assert.equal(headOf('/vendor-risk/intake'), 'page');
  assert.equal(headOf('/vendor-risk/intake/12'), 'page', 'a request is the row /intake/:id');
  assert.equal(headOf('/vendor-risk/intake/12?tab=x'), 'page');
  assert.equal(headOf('/vendor-risk/findings'), 'page');
  for (const path of WITH_ACTIONS) assert.equal(headOf(path), 'layout', `${path}: the buttons are drawn only by the layout head`);
});

// ---- what the sidebar lists ----

test('SIDEBAR is the eight entries: the Overview lights on its own page, every other tab and drill-down lights the entry it belongs to (deepest match, as the sidebar decides)', () => {
  assert.deepEqual(SIDEBAR.map((s) => s.name), RAIL.map((e) => e.name));
  assert.deepEqual(SIDEBAR.filter((s) => s.exact).map((s) => s.name), ['Overview']);
  const nav: NavEntry[] = [{ name: 'Third-Party Vendor Risk', icon: Building2, items: SIDEBAR.map((s) => ({ ...s, icon: Building2 })) }];
  for (const e of RAIL) {
    const pages = (e.tabs ? e.tabs.map((t) => t.href) : [e.href]).concat(e.also ?? []);
    for (const page of pages) {
      assert.equal(activeNavHref(page, nav), e.href, `${page} lights ${e.name}`);
      if (e.key !== 'overview') assert.equal(activeNavHref(`${page}/12`, nav), e.href, `${page}/12 lights ${e.name}`);
    }
  }
  assert.equal(activeNavHref('/vendor-risk/vendors/12/summary', nav), '/vendor-risk/vendors');
  assert.equal(activeNavHref('/vendor-risk/questionnaires/abc/builder', nav), '/vendor-risk/questionnaires');
  assert.equal(activeNavHref('/vendor-risk/settings/emails', nav), '/vendor-risk/roster');
});
