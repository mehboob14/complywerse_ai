// node --test "src/components/governance/documentsTabs.test.ts"
// The Documents area's tab bar (Documents · At a glance · Comply AI Studio · Attestation · Reviews · Exceptions · Directory · Settings) in the top bar: which tabs there are, in which order,
// which pages belong to the area (the Header swaps its title for the tabs there) and which tab is lit on which page. It was written inline in
// DocumentsTabs.tsx and is now read from the navigation registry (lib/navRegistry.ts); this test is the pin of the behaviour it had BEFORE:
// ORACLE is the old logic transcribed, TABLE is the same behaviour as a hand-written table, and the registry must give both.
// The deliberate differences from the bar as it was: the Settings tab's tooltip and accessible name is the destination's full name, "Governance settings" (it was
// "Settings"); and the Reviews tab (UX Gate 4C), between Attestation and Exceptions, is in the oracle: Governance > Reviews had no door but the Overview's overdue
// counter, so /governance/reviews and its calendar URL are now pages of the area (their tooltip is "Document Reviews", the tab says "Reviews"), for everyone who sees the bar.
// The At a glance tab (the library by department, type and stage; it was called Overview) is the second tab, for everyone who sees the bar, with or without the Studio: it is in the oracle too, and its page
// is lit on its own tab, not on Documents (a page under /governance/documents lit Documents before the Studio, Attestation and the Overview had pages of their own).
// A path that is no route is not part of the contract (the old rules matched on characters, the registry on whole path segments).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { activeTab, isInArea, tabName, tabText, tabsFor } from '../../lib/navRegistry.ts';

type Tab = { name: string; label: string; href: string; iconOnly?: boolean };
type Ctx = { studio: boolean; settings: boolean };

// ---- the old logic, as it was in DocumentsTabs.tsx ----
const DOCUMENTS: Tab = { name: 'Documents', label: 'Documents', href: '/governance/documents' };
const ATTESTATION: Tab = { name: 'Attestation', label: 'Attestation', href: '/governance/documents/attestation' };
const EXCEPTIONS: Tab = { name: 'Exceptions', label: 'Exceptions', href: '/governance/exceptions' };
const REVIEWS: Tab = { name: 'Document Reviews', label: 'Reviews', href: '/governance/reviews' };
const OVERVIEW: Tab = { name: 'At a glance', label: 'At a glance', href: '/governance/documents/overview' };
const STUDIO: Tab = { name: 'Comply AI Studio', label: 'Comply AI Studio', href: '/governance/documents/studio' };
const SETTINGS: Tab = { name: 'Settings', label: 'Settings', href: '/governance/settings', iconOnly: true };
const DIRECTORY: Tab = { name: 'Directory', label: 'Directory', href: '/governance/documents/directory' };

const oracleInArea = (pathname: string | null) =>
  !!pathname && (pathname.startsWith('/governance/documents') || pathname.startsWith('/governance/exceptions') || pathname.startsWith(REVIEWS.href) || pathname.startsWith(SETTINGS.href));

function oracleTabs({ studio, settings }: Ctx): Tab[] {
  const tabs = studio ? [DOCUMENTS, OVERVIEW, STUDIO, ATTESTATION, REVIEWS, EXCEPTIONS, DIRECTORY] : [DOCUMENTS, OVERVIEW, ATTESTATION, REVIEWS, EXCEPTIONS, DIRECTORY];
  if (settings) tabs.push(SETTINGS);
  return tabs;
}

function oracleLit(pathname: string, ctx: Ctx): string | null {
  const docInStudio = ctx.studio && /^\/governance\/documents\/\d+$/.test(pathname);
  const lit = oracleTabs(ctx).find((t) => (t === DOCUMENTS
    ? pathname === t.href || (!docInStudio && pathname.startsWith(`${t.href}/`) && !pathname.startsWith(ATTESTATION.href) && !pathname.startsWith(STUDIO.href) && !pathname.startsWith(OVERVIEW.href) && !pathname.startsWith(DIRECTORY.href))
    : t === STUDIO ? docInStudio || pathname.startsWith(t.href) : pathname.startsWith(t.href)));
  return lit ? lit.name : null;
}

// ---- the same behaviour as a table: path, in the area, the lit tab with the Studio on, the lit tab with the Studio off (Settings right held) ----
// Real routes only (a document's id is a number); a path that is no route is not part of the contract.
const TABLE: Array<[string, boolean, string | null, string | null]> = [
  ['/governance', false, null, null],
  ['/governance/documents', true, 'Documents', 'Documents'],
  ['/governance/documents/44', true, 'Comply AI Studio', 'Documents'],
  ['/governance/documents/overview', true, 'At a glance', 'At a glance'],
  ['/governance/documents/studio', true, 'Comply AI Studio', null],
  ['/governance/documents/studio/12', true, 'Comply AI Studio', null],
  ['/governance/documents/attestation', true, 'Attestation', 'Attestation'],
  ['/governance/documents/directory', true, 'Directory', 'Directory'],
  ['/governance/reviews', true, 'Document Reviews', 'Document Reviews'],
  ['/governance/reviews/calendar', true, 'Document Reviews', 'Document Reviews'],            // the same tab: its calendar view
  ['/governance/exceptions', true, 'Exceptions', 'Exceptions'],
  ['/governance/settings', true, 'Settings', 'Settings'],
  // pages of the Documents family that keep the page's own title, not the tabs
  ['/governance/attestations', false, null, null],
  ['/governance/attestations/campaigns', false, null, null],
  ['/governance/attestations/campaigns/4', false, null, null],
  ['/governance/attestations/complete/4', false, null, null],
  ['/governance/attestations/my', false, null, null],
  ['/governance/approvals', false, null, null],
  ['/governance/mappings', false, null, null],
  ['/governance/workflows', false, null, null],
  ['/governance/committees', false, null, null],
  ['/governance/committees/3', false, null, null],
  ['/governance/committees/meetings/9', false, null, null],
  ['/governance/committees/actions', false, null, null],
  ['/governance/kpi-report', false, null, null],
  ['/governance/regulatory-changes', false, null, null],
  ['/governance/regulatory-changes/5', false, null, null],
  ['/governance/regulatory-feeds', false, null, null],
  ['/erm/kris', false, null, null],
  ['/is-projects', false, null, null],
  ['/dashboard', false, null, null],
];

const ALL: Ctx[] = [{ studio: true, settings: true }, { studio: false, settings: true }, { studio: true, settings: false }, { studio: false, settings: false }];

test('the old logic and the table say the same thing (so the oracle is the behaviour, not a guess)', () => {
  for (const [path, inArea, studioOn, studioOff] of TABLE) {
    assert.equal(oracleInArea(path), inArea, path);
    assert.equal(oracleLit(path, { studio: true, settings: true }), studioOn, `${path} (Studio on)`);
    assert.equal(oracleLit(path, { studio: false, settings: true }), studioOff, `${path} (Studio off)`);
  }
  assert.equal(oracleInArea(null), false);
  assert.equal(oracleInArea(''), false);
  // without the Settings right the gear is not there, so no tab is lit on its page
  assert.equal(oracleLit('/governance/settings', { studio: true, settings: false }), null);
});

test('the tabs, in order, by who sees them: the Studio where it is on, Settings with the right', () => {
  const names = ALL.map((ctx) => oracleTabs(ctx).map((t) => t.name));
  assert.deepEqual(names, [
    ['Documents', 'At a glance', 'Comply AI Studio', 'Attestation', 'Document Reviews', 'Exceptions', 'Directory', 'Settings'],
    ['Documents', 'At a glance', 'Attestation', 'Document Reviews', 'Exceptions', 'Directory', 'Settings'],
    ['Documents', 'At a glance', 'Comply AI Studio', 'Attestation', 'Document Reviews', 'Exceptions', 'Directory'],
    ['Documents', 'At a glance', 'Attestation', 'Document Reviews', 'Exceptions', 'Directory'],
  ]);
});

// ---- the registry gives the tab bar what the old rules gave it ----

const OLD_NAME = (label: string) => (label === 'Governance settings' ? 'Settings' : label);       // a deliberate change
const NOW_NAME = (name: string) => (name === 'Documents' ? 'Library (Documents)' : name === 'Settings' ? 'Governance settings' : name);
const NOW_SHOWN = (text: string) => (text === 'Documents' ? 'Library' : text);                        // the other (D52): the first tab says Library; its accessible name still holds Documents

test('the registry lists the same tabs in the same order, each showing the same text and leading to the same page', () => {
  for (const ctx of ALL) {
    const tabs = tabsFor('documents', { studio: ctx.studio, can: () => ctx.settings });
    const old = oracleTabs(ctx);
    assert.deepEqual(tabs.map((t) => t.path), old.map((t) => t.href), JSON.stringify(ctx));
    assert.deepEqual(tabs.map((t) => tabText(t)), old.map((t) => NOW_SHOWN(t.label)), `${JSON.stringify(ctx)}: what each tab shows`);
    assert.deepEqual(tabs.map((t) => tabName(t)), old.map((t) => NOW_NAME(t.name)), `${JSON.stringify(ctx)}: the accessible name holds what is shown`);
    assert.deepEqual(tabs.map((t) => OLD_NAME(t.label)), old.map((t) => t.name), `${JSON.stringify(ctx)}: tooltip and accessible name`);
  }
  assert.equal(tabsFor('documents').find((t) => t.tab.id === 'settings')?.label, 'Governance settings');
});

test('the registry puts the same pages in the area and lights the same tab on each', () => {
  for (const [path, inArea] of TABLE) assert.equal(isInArea('documents', path), inArea, path);
  assert.equal(isInArea('documents', null), false);
  assert.equal(isInArea('documents', ''), false);
  for (const ctx of ALL) {
    const tabs = tabsFor('documents', { studio: ctx.studio, can: () => ctx.settings });
    for (const [path] of TABLE) {
      const lit = activeTab('documents', path, { studio: ctx.studio });
      const shown = lit && tabs.some((t) => t.path === lit.path) ? OLD_NAME(lit.label) : null;           // a tab the bar does not list is not lit
      assert.equal(shown, oracleLit(path, ctx), `${path} ${JSON.stringify(ctx)}`);
    }
  }
});

test('the table is the registry answer too, in both Studio states', () => {
  const lit = (path: string, studio: boolean) => { const tab = activeTab('documents', path, { studio }); return tab ? OLD_NAME(tab.label) : null; };
  for (const [path, , studioOn, studioOff] of TABLE) {
    assert.equal(lit(path, true), studioOn, `${path} (Studio on)`);
    assert.equal(lit(path, false), studioOff, `${path} (Studio off)`);
  }
});
