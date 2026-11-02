// node --test "src/lib/navPages/vendor.test.ts"
// The Third-Party Vendor Risk module draws its own 8-entry rail inside its pages (vendor-risk/_lib/railModel.ts RAIL, D50) and the shell will lift that rail into itself. Until it does, the
// registry and the rail describe the same module twice, so this test holds them equal: every rail entry and every tab of it is a registry entry at the same address, in the same order, with the
// tab text the rail shows (the entry's label or its shortLabel), and the pages the rail does not list are the Overview's drill-downs, a vendor's records and the forwards.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RAIL } from '../../app/(dashboard)/vendor-risk/_lib/railModel.ts';
import { activeTab, breadcrumbFor, isInArea, pagesForArea, routeFor, routes, tabsFor } from '../navRegistry.ts';

const V = '/vendor-risk';
const STRIPS: Record<string, string> = { vendors: 'vendor-vendors', monitoring: 'vendor-monitoring', insights: 'vendor-insights', setup: 'vendor-setup' };
const shown = (path: string) => { const e = routes.find((r) => r.path === path); assert.ok(e, path); return e.shortLabel ?? e.label; };

test('the rail\'s four strips are the registry\'s four tab strips: same pages, same order, same text on the tab', () => {
  for (const [key, area] of Object.entries(STRIPS)) {
    const rail = RAIL.find((r) => r.key === key);
    assert.ok(rail?.tabs, `${key} is a rail entry with tabs`);
    const tabs = tabsFor(area);
    assert.deepEqual(tabs.map((t) => t.path), rail.tabs.map((t) => t.href), `${area}: the tabs`);
    assert.deepEqual(tabs.map((t) => t.shortLabel ?? t.label), rail.tabs.map((t) => t.name), `${area}: what each tab says`);
    assert.deepEqual(tabs.map((t) => t.tab.order), rail.tabs.map((_, i) => i + 1));
    assert.equal(rail.href, rail.tabs[0].href, 'the rail links its first tab');
  }
  assert.equal(RAIL.length, 8);
});

test('the other rail entries are pages of the registry at the rail\'s address, and the Overview is the sidebar\'s own leaf', () => {
  for (const rail of RAIL.filter((r) => !r.tabs)) {
    const e = routes.find((r) => r.path === rail.href);
    assert.ok(e, `${rail.href} is an entry`);
    if (rail.key === 'overview') assert.equal(e.groups.length, 0, 'the sidebar leaf');
    else assert.equal(e.parent, V, `${rail.name} hangs under the Overview leaf`);
  }
  for (const rail of RAIL.filter((r) => r.tabs)) assert.equal(routes.find((r) => r.path === rail.href)?.parent, V);
  for (const drill of RAIL[0].also ?? []) assert.equal(routes.find((r) => r.path === drill)?.parent, V, `${drill}: a drill-down of the Overview`);
  assert.equal(shown(`${V}/vendors`), 'Register');
  assert.equal(shown(`${V}/assessments`), 'Assessments');
  assert.equal(shown(`${V}/reviews`), 'Check-ins');
  assert.equal(shown(`${V}/settings`), 'Settings');
});

test('every page the rail covers lights its strip\'s tab, and the module\'s detail pages hang under the right tab', () => {
  assert.equal(activeTab('vendor-vendors', `${V}/vendors/12`)?.path, `${V}/vendors`, 'a vendor record is under Register');
  assert.equal(activeTab('vendor-vendors', `${V}/assessments/5`)?.path, `${V}/assessments`);
  assert.equal(activeTab('vendor-insights', `${V}/reports/3`)?.path, `${V}/reports`);
  assert.equal(activeTab('vendor-insights', `${V}/comply-analysis/9`)?.path, `${V}/comply-analysis`);
  assert.equal(activeTab('vendor-setup', `${V}/settings/emails`)?.path, `${V}/settings`);
  assert.equal(activeTab('vendor-monitoring', `${V}/policy`), undefined, 'Policy is Setup\'s');
  assert.equal(isInArea('vendor-setup', `${V}/policy`), true);
  assert.equal(isInArea('vendor-setup', `${V}/vendors`), false);
  assert.deepEqual(breadcrumbFor(`${V}/settings/emails`).map((c) => c.label), ['Third-Party Vendor Risk', 'Roster', 'Third-party risk settings', 'Emails']);
});

test('the module has one leaf in the sidebar, 33 pages in the shell, and the Work panel lists the pages a person can open (no forward, no record)', () => {
  const mine = routes.filter((e) => e.area === 'third-party-vendor-risk');
  assert.equal(mine.length, 33, 'the 33 pages of vendor-risk in the shell');
  const open = pagesForArea('third-party-vendor-risk').map((e) => e.path);
  for (const forward of [`${V}/procurement`, `${V}/shadow-saas`, `${V}/settings/alert-rules`]) assert.ok(!open.includes(forward), `${forward} is a forward`);
  assert.equal(routeFor(`${V}/procurement`)?.aliasOf, V);
  assert.equal(open.length, 33 - 3 - 7, 'the 33 minus the three forwards and the seven record pages');
});
