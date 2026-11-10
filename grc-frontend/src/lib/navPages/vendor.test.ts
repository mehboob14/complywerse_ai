// node --test "src/lib/navPages/vendor.test.ts"
// The Third-Party Vendor Risk registry is DERIVED from the module's one navigation model (vendor-risk/_lib/railModel.ts), so this test does not hold two lists equal: it pins what the derivation
// must give (every entry and tab at its address with its text, the four strips in order, the trails) and what the model promises the layout (HEAD and ownHeading agree). It runs in whichever
// state the sidebar is in: ONE leaf today, or the eight entries once navAccess lists them (the entries it lists are then leaves, the rest pages, and nothing here changes).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { flattenLeaves, navigation } from '../../components/layout/navAccess.ts';
import { HEAD, RAIL, SIDEBAR, headOf } from '../../app/(dashboard)/vendor-risk/_lib/railModel.ts';
import { activeTab, breadcrumbFor, isInArea, pagesForArea, routeFor, routes, tabsFor } from '../navRegistry.ts';

const V = '/vendor-risk';
const AREA = 'third-party-vendor-risk';
const entry = (path: string) => { const e = routes.find((r) => r.path === path); assert.ok(e, path); return e; };
const text = (path: string) => { const e = entry(path); return e.shortLabel ?? e.label; };
const sidebarLists = (href: string) => flattenLeaves(navigation).some((leaf) => leaf.href === href);

test('the four strips of the model are the four tab strips of the registry: same pages, same order, the text of the tab, and the heading of the page where it differs', () => {
  for (const e of RAIL.filter((r) => r.tabs)) {
    const tabs = tabsFor(`vendor-${e.key}`);
    assert.deepEqual(tabs.map((t) => t.path), (e.tabs ?? []).map((t) => t.href), `${e.key}: the tabs`);
    assert.deepEqual(tabs.map((t) => t.shortLabel ?? t.label), (e.tabs ?? []).map((t) => t.name), `${e.key}: what each tab says`);
    assert.deepEqual(tabs.map((t) => t.tab.order), (e.tabs ?? []).map((_, i) => i + 1));
    (e.tabs ?? []).forEach((t) => assert.equal(entry(t.href).title ?? entry(t.href).label, t.title ?? t.name, `${t.href}: its heading`));
  }
  assert.equal(text(`${V}/vendors`), 'Register');
  assert.equal(entry(`${V}/vendors`).title ?? entry(`${V}/vendors`).label, 'Vendors');
  assert.equal(text(`${V}/assessments`), 'Assessments');
  assert.equal(text(`${V}/reviews`), 'Check-ins');
  assert.equal(text(`${V}/settings`), 'Settings');
});

test('the single entries are pages of the registry at the address of the model, and every entry hangs under the Overview, the one leaf the sidebar always had', () => {
  const overview = routes.find((r) => r.path === V);
  assert.equal(overview?.groups.length, sidebarLists(`${V}/vendors`) ? 1 : 0, 'the Overview is a leaf, in the group once the sidebar lists the entries');
  for (const e of RAIL.filter((r) => !r.tabs && r.key !== 'overview')) {
    const page = entry(e.href);
    assert.equal(page.label, e.name);
    if (!sidebarLists(e.href)) assert.equal(page.parent, V, `${e.name} hangs under the Overview`);
  }
  for (const drill of RAIL[0].also ?? []) assert.equal(entry(drill).parent, V, `${drill}: a drill-down of the Overview`);
  for (const e of RAIL.filter((r) => r.tabs)) {
    const [first, ...rest] = e.tabs ?? [];
    if (!sidebarLists(first.href)) assert.equal(entry(first.href).parent, V);
    rest.forEach((t) => assert.equal(entry(t.href).parent, first.href, `${t.href} hangs under the first page of its strip`));
  }
});

test('every page the model covers lights its tab of the strip, and the detail pages of the module hang under the right tab', () => {
  assert.equal(activeTab('vendor-vendors', `${V}/vendors/12`)?.path, `${V}/vendors`, 'a vendor record is under Register');
  assert.equal(activeTab('vendor-vendors', `${V}/assessments/5`)?.path, `${V}/assessments`);
  assert.equal(activeTab('vendor-insights', `${V}/reports/3`)?.path, `${V}/reports`);
  assert.equal(activeTab('vendor-insights', `${V}/comply-analysis/9`)?.path, `${V}/comply-analysis`);
  assert.equal(activeTab('vendor-setup', `${V}/settings/emails`)?.path, `${V}/settings`);
  assert.equal(activeTab('vendor-monitoring', `${V}/policy`), undefined, 'Policy belongs to Setup');
  assert.equal(isInArea('vendor-setup', `${V}/policy`), true);
  assert.equal(isInArea('vendor-setup', `${V}/vendors`), false);
  const trail = breadcrumbFor(`${V}/settings/emails`).map((c) => c.label);
  assert.equal(trail[0], 'Third-Party Vendor Risk');
  assert.equal(trail.slice(-2).join(' > '), 'Third-party risk settings > Emails');
});

test('ownHeading follows HEAD: true where the layout or the page draws the head of the kit, absent where the page still draws its own old heading', () => {
  for (const e of routes.filter((r) => r.area === AREA && !r.aliasOf)) {
    const by = headOf(e.path.replace(/:[a-z]+/g, '7'));
    assert.equal(!!e.ownHeading, by !== 'legacy', `${e.path}: HEAD says ${by}`);
  }
  for (const path of Object.keys(HEAD)) assert.ok(routes.some((r) => r.path === path), `${path}: a row of HEAD is a page of the registry`);
});

test('the sidebar the model describes has the eight entries, and every one is a page of the registry', () => {
  assert.equal(SIDEBAR.length, 8);
  for (const s of SIDEBAR) assert.ok(routes.some((r) => r.path === s.href), s.href);
  assert.equal(routeFor(`${V}/vendors/12/summary`)?.label, 'Vendor summary report');
});

test('the Work panel offers the pages a person can open: no forward, no record', () => {
  const open = pagesForArea(AREA).map((e) => e.path);
  for (const forward of [`${V}/procurement`, `${V}/shadow-saas`, `${V}/settings/alert-rules`, `${V}/alerts`, `${V}/technology`, `${V}/concentration`]) assert.ok(!open.includes(forward), `${forward} is a forward`);
  assert.equal(routeFor(`${V}/alerts`)?.aliasOf, `${V}/monitoring`);
  assert.equal(routeFor(`${V}/technology`)?.aliasOf, `${V}/dependencies`);
  assert.equal(routeFor(`${V}/procurement`)?.aliasOf, V);
  assert.equal(routeFor(`${V}/settings/alert-rules`)?.aliasOf, `${V}/policy`);
  for (const record of [`${V}/vendors/:id`, `${V}/vendors/:id/summary`, `${V}/assessments/:id`, `${V}/intake/:id`, `${V}/comply-analysis/:id`, `${V}/reports/:id`, `${V}/questionnaires/:token/builder`]) {
    assert.ok(!open.includes(record), `${record} is a record page`);
  }
  assert.equal(open[0], V);
});
