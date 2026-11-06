// node --test src/components/shell/panelModel.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { navAccessFromMe, navigation, visibleNav } from '../layout/navAccess.ts';
import { activeNavHref } from '../layout/navActive.ts';
import { activeTab, tabsFor } from '../../lib/navRegistry.ts';
import { hintShows, hintUsed, moduleSection, panelOpen, queueStartsShut, type PanelContext, type PanelRow } from './panelModel.ts';

const me = (permissions: string[], extra: Record<string, unknown> = {}) => ({
  authenticated: true,
  user: { permissions, allowed_modules: Array.from(new Set(permissions.map((p) => p.split(':')[0]))), is_admin: false, ...extra },
  tenant: { features: ['audit_register'] },
});
const admin = me([], { permissions: ['*:*:*'], allowed_modules: [], is_admin: true });

function contextFor(who: unknown, pathname: string, over: Partial<PanelContext> = {}): PanelContext {
  const access = navAccessFromMe(who);
  const nav = visibleNav(navigation, access);
  const tabs = tabsFor('documents', { studio: true, can: () => access.isAdmin || access.permissions.some((p) => p.startsWith('governance:settings')), ownerOnly: access.headsDepartment && !access.isAdmin && !access.permissions.some((p) => p.startsWith('governance:policies')) });
  return { nav, litHref: activeNavHref(pathname, nav), pathname, docTabs: tabs, docTabPath: activeTab('documents', pathname, { studio: true })?.path, ...over };
}
const rows = (c: PanelContext) => moduleSection(c).items.filter((i): i is PanelRow => i.kind === 'row');
const lit = (c: PanelContext) => rows(c).filter((r) => r.current).map((r) => r.label);

test('the panel is docked-open unless the person shut it; an overlay or a sheet is open only while asked', () => {
  assert.equal(panelOpen('dock', false, false), true, 'docked: open by itself');
  assert.equal(panelOpen('dock', true, false), false, 'docked: the person shut it');
  assert.equal(panelOpen('dock', true, true), false, 'the ask belongs to the overlay');
  assert.equal(panelOpen('overlay', false, false), false);
  assert.equal(panelOpen('overlay', false, true), true);
  assert.equal(panelOpen('sheet', false, false), false);
  assert.equal(panelOpen('sheet', true, true), true);
});

test('the queue section starts shut on the two pages that draw the queue themselves (the Overview, Needs my action) and open everywhere else', () => {
  for (const path of ['/governance', '/needs-my-action', '/governance/', '/needs-my-action?section=ack', '/governance#top']) assert.equal(queueStartsShut(path), true, path);
  for (const path of ['/governance/documents', '/governance/committees', '/governance/committees/3', '/governance/documents/47', '/dashboard', '/tasks', '/erm/risks', '/vendor-risk', '/needs-my-action/extra', '/']) assert.equal(queueStartsShut(path), false, path);
});

test('the first-run label shows below 1440 until the palette or the panel has been used once, and never beside a docked panel', () => {
  assert.equal(hintShows(false, 'overlay'), true);
  assert.equal(hintShows(false, 'sheet'), true);
  assert.equal(hintShows(false, 'dock'), false, 'the panel is open beside the page: nothing to point at');
  assert.equal(hintShows(true, 'overlay'), false, 'dismissed: once per browser');
  assert.equal(hintUsed({ paletteOpen: true, panelShown: false, placement: 'overlay' }), true, 'the palette was opened');
  assert.equal(hintUsed({ paletteOpen: false, panelShown: true, placement: 'overlay' }), true, 'the person opened the panel');
  assert.equal(hintUsed({ paletteOpen: false, panelShown: true, placement: 'sheet' }), true);
  assert.equal(hintUsed({ paletteOpen: false, panelShown: true, placement: 'dock' }), false, 'a docked panel is open by itself: no use');
  assert.equal(hintUsed({ paletteOpen: false, panelShown: false, placement: 'overlay' }), false);
});

test('Governance: the menu\'s pages, Documents expanded to its tabs, and exactly one lit row per level', () => {
  const c = contextFor(admin, '/governance/documents/studio');
  const section = moduleSection(c);
  assert.equal(section.title, 'In Governance');
  assert.deepEqual(rows(c).filter((r) => r.depth === 0).map((r) => r.label), ['Overview', 'Documents', 'Committees', 'KRIs', 'KPI Report', 'Projects']);
  assert.deepEqual(rows(c).filter((r) => r.depth === 1).map((r) => r.label), ['Library', 'At a glance', 'Comply AI Studio', 'Attestation', 'Reviews', 'Exceptions', 'Settings']);
  assert.deepEqual(lit(c), ['Comply AI Studio'], 'the tab is lit, not the Documents row above it');
  assert.equal(rows(c).find((r) => r.label === 'Library')?.name, 'Library (Documents)', 'the first tab\'s accessible name holds both words');
  assert.equal(rows(c).find((r) => r.label === 'Reviews')?.name, 'Document Reviews');
});

test('every item of a section has its own key (React lists them by it): the Documents row and its first tab share a page, not a key', () => {
  for (const path of ['/governance/documents', '/governance/documents/studio', '/governance/committees', '/vendor-risk/vendors/12', '/erm/risks', '/tasks']) {
    const keys = moduleSection(contextFor(admin, path)).items.map((i) => i.key);
    assert.equal(new Set(keys).size, keys.length, `${path}: duplicate keys ${keys.filter((k, i) => keys.indexOf(k) !== i).join(', ')}`);
  }
});

test('a Governance page outside the Documents area lights its own row, and Documents is not lit', () => {
  const c = contextFor(admin, '/governance/committees/4');
  assert.deepEqual(lit(c), ['Committees']);
  const kpi = contextFor(admin, '/governance/kpi-report');
  assert.deepEqual(lit(kpi), ['KPI Report']);
});

test('the owner of a department sees Documents with the two tabs made for them, nothing else of Governance', () => {
  const c = contextFor(me([], { heads_department: true }), '/governance/documents/overview');
  assert.equal(moduleSection(c).title, 'In Governance');
  assert.deepEqual(rows(c).map((r) => r.label), ['Documents', 'Library', 'At a glance']);
  assert.deepEqual(lit(c), ['At a glance']);
});

test('Sub-groups keep their name as a heading and their pages under it (Risk Management > Operational Risk)', () => {
  const c = contextFor(admin, '/erm/risks');
  const items = moduleSection(c).items;
  assert.equal(moduleSection(c).title, 'In Risk Management');
  assert.ok(items.some((i) => i.kind === 'heading' && i.label === 'Operational Risk'));
  assert.deepEqual(lit(c), ['Risk Register']);
  assert.ok(items.findIndex((i) => i.kind === 'heading') < items.findIndex((i) => i.kind === 'row' && i.label === 'Risk Register'));
});

test('Third-Party Vendor Risk: the module\'s eight entries with what waits at two of them; the entry that holds the page opens its tabs', () => {
  const counts = { intake_pending: { text: '4', label: '4 pending' }, open_findings: { text: '12', label: '12 open' } };
  const at = (path: string) => contextFor(admin, path, { vendorCounts: counts });
  const intake = at('/vendor-risk/intake');
  assert.equal(moduleSection(intake).title, 'In Third-Party Vendor Risk');
  assert.deepEqual(rows(intake).filter((r) => r.depth === 0).map((r) => r.label), ['Overview', 'Vendors', 'Intake', 'Findings', 'Questionnaires', 'Monitoring', 'Insights', 'Setup']);
  assert.deepEqual(lit(intake), ['Intake']);
  assert.equal(rows(intake).find((r) => r.label === 'Intake')?.count, '4');
  assert.equal(rows(intake).find((r) => r.label === 'Findings')?.countLabel, '12 open');
  assert.equal(rows(intake).find((r) => r.label === 'Vendors')?.count, undefined);
  assert.ok(rows(intake).every((r) => r.depth === 0), 'no tabs open on a page that has none');
  const vendor = at('/vendor-risk/vendors/12');
  assert.deepEqual(rows(vendor).filter((r) => r.depth === 1).map((r) => r.label), ['Register', 'Assessments', 'Contracts', 'Check-ins']);
  assert.deepEqual(lit(vendor), ['Register'], 'the tab, and not the Vendors row above it');
  assert.deepEqual(lit(at('/vendor-risk')), ['Overview']);
  assert.deepEqual(lit(at('/vendor-risk/attention')), ['Overview'], 'a drill-down lights the Overview');
  assert.deepEqual(lit(at('/vendor-risk/alerts')), ['Breach alerts']);
});

test('a page that stands alone, or has no menu entry, gets the way to every module the person has', () => {
  const tasks = contextFor(admin, '/tasks');
  const section = moduleSection(tasks);
  assert.equal(section.title, 'Modules');
  assert.deepEqual(lit(tasks), ['Task Management']);
  assert.ok(rows(tasks).length >= 12);
  const unknown = contextFor(admin, '/nowhere');
  assert.equal(moduleSection(unknown).title, 'Modules');
  assert.deepEqual(lit(unknown), []);
  const none = contextFor(me([]), '/needs-my-action');
  assert.deepEqual(rows(none).map((r) => r.label), ['Needs my action']);
});
