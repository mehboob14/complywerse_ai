// Navigation-registry entries of the Third-Party Vendor Risk pages (see navPages/index.ts for the contract). Rewritten by vendor-shell, 2026-11-08: the module's navigation is ONE model,
// vendor-risk/_lib/railModel.ts (the eight entries, their tabs, who draws each page's head), and this file DERIVES the registry from it, so a group that moves a tab edits one line there and
// nothing here. The pages that are neither an entry nor a tab (details, drill-downs, forwards) are listed below.
// Two states of the sidebar are valid and both are tested: today it has ONE leaf (/vendor-risk, the Overview) and the other seven entries are pages that hang under it; once the parent lists the
// eight entries as sub-items (SIDEBAR of railModel.ts), the entries it lists become sidebar leaves (extras here in LEAVES, no longer pages) with no edit of this file. What the sidebar lists is
// read from navAccess, the one place that decides it.
// Public pages of the module (the supplier's questionnaire and the examiner link, vendor-risk/questionnaires/[token] and examiner/[token]) are outside the shell and not entries.
import { flattenLeaves, navigation } from '../../components/layout/navAccess.ts';
import type { PageSpec, RouteExtra } from '../navRegistry.ts';
import { RAIL, headOf, type RailEntry, type RailTab } from '../../app/(dashboard)/vendor-risk/_lib/railModel.ts';

const AREA = 'third-party-vendor-risk';
const V = '/vendor-risk';
const MENU = 'a page of the Third-party risk menu';

const leaves = flattenLeaves(navigation);
const listed = new Set(leaves.map((leaf) => leaf.href));
/** The name of the Overview's leaf: "Third-Party Vendor Risk" while it is the module's only leaf, "Overview" in the group. */
const OVERVIEW = (leaves.find((leaf) => leaf.href === V) as { name: string }).name;
const heading = (path: string): Pick<RouteExtra, 'ownHeading'> => (headOf(path) === 'legacy' ? {} : { ownHeading: true });
const last = (href: string): string => href.split('/').pop() as string;

/** One page of the model as a registry entry (the entry's own page, or one tab of its strip). */
function entryPage(e: RailEntry, tab: RailTab | undefined, index: number): PageSpec {
  const first = index === 0;
  const name = tab ? tab.name : e.name;
  const title = tab?.title;
  return {
    path: tab ? tab.href : e.href,
    label: title ?? name,
    ...(title ? { shortLabel: name } : {}),
    area: AREA,
    parent: first ? V : (e.tabs as RailTab[])[0].href,
    ...(tab ? { tab: { area: `vendor-${e.key}`, id: last(tab.href), order: index + 1 } } : { hidden: `${MENU} (${e.name}); ` + (e.key === 'intake' ? 'the Request vendor button opens it with the request dialog' : 'it opens from the menu') }),
    keywords: (tab ?? e).keywords,
    ...heading(tab ? tab.href : e.href),
  };
}

// every entry of the model except the Overview (the sidebar's own leaf, below), as pages: tabs when it has them
const ENTRIES: PageSpec[] = RAIL.filter((e) => e.key !== 'overview').reduce<PageSpec[]>((all, e) => all.concat(e.tabs ? e.tabs.map((t, i) => entryPage(e, t, i)) : [entryPage(e, undefined, 0)]), []);

/** What the sidebar adds to the leaf of an entry once it lists it: the page's own heading and tab text where they differ from the menu's name, and the words a search finds it by. */
function leafExtra(page: PageSpec, e: RailEntry): RouteExtra {
  const name = (e.tabs ? e.tabs[0].title ?? e.tabs[0].name : e.name);
  return {
    ...(name !== e.name ? { title: name } : {}),
    ...(e.tabs && e.tabs[0].name !== e.name ? { shortLabel: e.tabs[0].name } : {}),
    ...(page.tab ? { tab: page.tab } : {}),
    ...(page.keywords ? { keywords: page.keywords.filter((k) => k.toLowerCase() !== e.name.toLowerCase()) } : {}),
    ...(page.ownHeading ? { ownHeading: true } : {}),
  };
}

const entryOfPath = (path: string): RailEntry => RAIL.find((e) => (e.tabs ? e.tabs[0].href : e.href) === path) as RailEntry;

export const LEAVES: Record<string, RouteExtra> = {
  [V]: { title: 'Third-Party Vendor Risk Overview', keywords: ['TPRM', 'Vendor risk', 'Suppliers', 'Third-party risk'], ...heading(V) },
  ...Object.fromEntries(ENTRIES.filter((p) => listed.has(p.path)).map((p) => [p.path, leafExtra(p, entryOfPath(p.path))])),
};

export const PAGES: PageSpec[] = [
  // ---- the Overview's drill-downs (cards of the Overview page) ----
  { path: `${V}/attention`, label: 'Needs attention', area: AREA, parent: V, hidden: 'opens from the Work queue link of the Overview and from the Needs attention counter', keywords: ['Attention queue', 'Work queue'], ...heading(`${V}/attention`) },
  { path: `${V}/actions`, label: 'Planned actions', area: AREA, parent: V, hidden: 'opens from the My work card of the Overview', ...heading(`${V}/actions`) },
  // The two pages removed from the rail (D50) still forward to the Overview.
  { path: `${V}/procurement`, label: OVERVIEW, area: AREA, aliasOf: V },
  { path: `${V}/shadow-saas`, label: OVERVIEW, area: AREA, aliasOf: V },

  // ---- the entries and tabs the sidebar does not list (yet) ----
  ...ENTRIES.filter((p) => !listed.has(p.path)),

  // ---- pages that open from an entry or a tab ----
  { path: `${V}/intake/:id`, label: 'Vendor request', area: AREA, parent: `${V}/intake`, hidden: 'opens from an Intake row and from the request dialog once a request is filed' },
  { path: `${V}/questionnaires/:token/builder`, label: 'Questionnaire builder', area: AREA, parent: `${V}/questionnaires`, hidden: 'opens from a questionnaire (Edit or New) in Questionnaires' },
  { path: `${V}/vendors/:id`, label: 'Vendor', area: AREA, parent: `${V}/vendors`, hidden: 'opens from a Register row and from the vendor name on most pages of the module and of the Auditor Portal' },
  { path: `${V}/vendors/:id/summary`, label: 'Vendor summary report', area: AREA, parent: `${V}/vendors`, hidden: 'opens from the vendor record\'s menu ("Summary report")' },
  { path: `${V}/assessments/:id`, label: 'Vendor assessment', area: AREA, parent: `${V}/assessments`, hidden: 'opens from a questionnaire sent to a vendor and from a vendor\'s assessment dialog' },
  { path: `${V}/comply-analysis/:id`, label: 'Comply analysis', area: AREA, parent: `${V}/comply-analysis`, hidden: 'opens from a row of Comply analyses' },
  { path: `${V}/reports/:id`, label: 'Vendor report', area: AREA, parent: `${V}/reports`, hidden: 'opens from a kept report in Reports, and straight after one is generated' },
  { path: `${V}/settings/emails`, label: 'Emails', area: AREA, parent: `${V}/settings`, hidden: 'opens from Third-party risk settings (the emails link)', keywords: ['Vendor emails'] },
  // The alert rules moved into the Policy page (its #alert-rules section); the old address forwards there.
  { path: `${V}/settings/alert-rules`, label: 'Policy', area: AREA, aliasOf: `${V}/policy` },
];
