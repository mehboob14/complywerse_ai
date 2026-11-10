// THE navigation model of Third-Party Vendor Risk, one place for every vendor group (vendor-shell, 2026-11-08). The eight entries in the order the work flows (a vendor is requested,
// assessed, watched and reported on), the pages each groups under a strip of tabs, who draws each page's head, and what the sidebar lists. `lib/navPages/vendor.ts` DERIVES its
// registry entries from this file, so there is no second list to keep equal; layout.tsx and VendorNav.tsx draw from it. Pure, so `node --test` runs railModel.test.ts against it.
//
// A group that moves, merges or renames a page edits THIS file (one line), nothing else in the navigation:
//   - a tab is a row of `tabs` (its text, its address, the page heading when that differs, the words a search finds it by);
//   - a page whose head the layout drew until now: change its row in HEAD from 'layout' to 'page' once the page draws `<PageHeader variant="page">` itself.
// The sidebar is the parent's (components/layout/navAccess.ts): SIDEBAR below is exactly what it lists.

import type { Counts } from './portfolioModel.ts';

export interface RailTab {
  /** what the strip says */
  name: string;
  href: string;
  /** the page's heading when it is not the tab's text ("Vendors" on the Register tab) */
  title?: string;
  keywords?: string[];
}

export interface RailEntry {
  key: string;
  /** the sidebar's text and the entry's name in the strip row */
  name: string;
  /** where the entry goes (its first tab, when it has tabs) */
  href: string;
  keywords?: string[];
  /** pages that belong to this entry without being one of its tabs (a drill-down reached from a card): they light it */
  also?: string[];
  tabs?: RailTab[];
  /** the number that waits there, from the module's counts */
  count?: keyof Counts;
  waiting?: string;
}

const V = '/vendor-risk';

export const RAIL: RailEntry[] = [
  { key: 'overview', name: 'Overview', href: V, also: [`${V}/attention`, `${V}/actions`] },
  // The Assessments board is the Board view of the Register now: `/assessments` forwards to it (and the legacy review pages beneath it, /assessments/:id, still belong to Vendors).
  { key: 'vendors', name: 'Vendors', href: `${V}/vendors`, also: [`${V}/assessments`], tabs: [
    { name: 'Register', href: `${V}/vendors`, title: 'Vendors', keywords: ['Vendor register', 'Suppliers', 'Vendor assessments', 'Assessments board'] },
    { name: 'Contracts', href: `${V}/contracts` },
    { name: 'Check-ins', href: `${V}/reviews`, title: 'Yearly check-ins', keywords: ['Vendor reviews', 'Annual reviews'] },
  ] },
  { key: 'intake', name: 'Intake', href: `${V}/intake`, count: 'intake_pending', waiting: 'pending', keywords: ['Vendor requests', 'Request vendor'] },
  { key: 'findings', name: 'Findings', href: `${V}/findings`, count: 'open_findings', waiting: 'open', keywords: ['Vendor findings', 'Remediation'] },
  // One page with three tabs in its own address (?tab=): Library, Sent, Shared. The Vendor Exchange is the Shared tab now: its old address forwards there, and still lights this entry.
  { key: 'questionnaires', name: 'Questionnaires', href: `${V}/questionnaires`, also: [`${V}/exchange`], keywords: ['Questionnaire templates', 'Due diligence', 'Sent questionnaires', 'Vendor Exchange', 'Exchange', 'Shared assessments', 'Reuse an assessment'] },
  { key: 'monitoring', name: 'Monitoring', href: `${V}/monitoring`, also: [`${V}/alerts`, `${V}/technology`, `${V}/concentration`], tabs: [
    { name: 'Alerts', href: `${V}/monitoring`, keywords: ['Signals', 'Monitoring signals', 'Breach alerts', 'Adverse media', 'Monitoring', 'Continuous monitoring'] },
    { name: 'Security ratings', href: `${V}/security`, keywords: ['Outside-in', 'Supplier ratings'] },
    { name: 'Dependencies', href: `${V}/dependencies`, keywords: ['Technology', 'Technology stack', 'Concentration', 'Concentration risk', 'Shared platforms', 'Subprocessors', 'Fourth parties'] },
  ] },
  { key: 'insights', name: 'Insights', href: `${V}/risk-360`, tabs: [
    { name: 'Risk 360°', href: `${V}/risk-360`, keywords: ['Risk 360', 'Insights'] },
    { name: 'Comply analyses', href: `${V}/comply-analysis`, keywords: ['Comply analysis', 'FAIR'] },
    { name: 'Reports', href: `${V}/reports`, keywords: ['Vendor reports'] },
  ] },
  { key: 'setup', name: 'Setup', href: `${V}/roster`, tabs: [
    { name: 'Roster', href: `${V}/roster`, keywords: ['Reviewers', 'Vendor roster'] },
    { name: 'Policy', href: `${V}/policy`, keywords: ['Vendor policy', 'Alert rules', 'Tiers'] },
    { name: 'Settings', href: `${V}/settings`, title: 'Third-party risk settings', keywords: ['Vendor settings'] },
  ] },
];

// ── who draws a page's head ──────────────────────────────────────────────────────────────────────────────────────────────

/** `page`: the page draws `<PageHeader variant="page">` itself (and `<VendorTabs />` under it when its entry has tabs). `layout`: the layout draws the head (the page's name, the
 *  module's facts, the two ways to bring a vendor in on Vendors and Intake) and the strip, until the page's group rebuilds it. `legacy`: the page still draws its own older heading
 *  and the layout draws only the strip above it. A page not listed is `legacy`. The registry's `ownHeading` is true for `page` and `layout` (the page's name is on screen once and
 *  the top bar names only the section), false for `legacy`. */
export type HeadBy = 'page' | 'layout' | 'legacy';

export const HEAD: Readonly<Record<string, HeadBy>> = {
  [V]: 'page',
  [`${V}/attention`]: 'page',
  [`${V}/actions`]: 'page',
  [`${V}/vendors`]: 'page',
  [`${V}/contracts`]: 'page',
  [`${V}/reviews`]: 'page',
  [`${V}/intake`]: 'page',
  [`${V}/intake/:id`]: 'page',
  [`${V}/findings`]: 'page',
  [`${V}/questionnaires`]: 'page',
  [`${V}/monitoring`]: 'page',
  [`${V}/security`]: 'page',
  [`${V}/dependencies`]: 'page',
  [`${V}/roster`]: 'layout',
  [`${V}/policy`]: 'layout',
};

/** The pages whose head carries the module's two ways to bring a vendor in (Request vendor, Add vendor) when the layout draws it. */
export const WITH_ACTIONS: readonly string[] = [];       // the Register and Intake draw their own buttons (VendorRegister, <VendorActions /> in the Intake head); no page leaves them to the layout now

const clean = (pathname: string): string => (pathname || '').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
const under = (path: string, href: string): boolean => path === href || path.startsWith(`${href}/`);

/** A record's page is the row with `:id` for its number (`/vendor-risk/intake/12` is the row `/vendor-risk/intake/:id`). */
const asRow = (path: string): string => path.replace(/\/\d+(?=\/|$)/g, '/:id');
/** A vendor's record (`/vendor-risk/vendors/<id>`, not its summary) is a page of this model that no row of HEAD can name (the id is the address's): it draws its own head (vendor-record). */
const RECORD = /^\/vendor-risk\/vendors\/\d+$/;
/** The questionnaire builder (`/vendor-risk/questionnaires/<id>/builder`): its own head too (the page names the questionnaire, with a back link); the registry row is `:token`, the folder's name. */
const BUILDER = /^\/vendor-risk\/questionnaires\/[^/]+\/builder$/;

export const headOf = (pathname: string): HeadBy => HEAD[clean(pathname)] ?? HEAD[asRow(clean(pathname))] ?? (RECORD.test(clean(pathname)) || BUILDER.test(clean(pathname)) ? 'page' : 'legacy');

// ── which entry is on ────────────────────────────────────────────────────────────────────────────────────────────────────

/** Whether a tab (or an entry's own page) is the one on: its page and the pages beneath it. */
export const tabActive = (pathname: string, href: string): boolean => under(clean(pathname), href);

/** The rail entry a page belongs to: its own page, a tab's page or a page beneath one. The Overview is `/vendor-risk` itself and its drill-downs only. */
export function entryOf(pathname: string): RailEntry | undefined {
  const path = clean(pathname);
  return RAIL.find((e) => {
    if (e.key === 'overview') return path === V || (e.also ?? []).some((h) => under(path, h));
    return (e.tabs ?? [{ name: e.name, href: e.href }]).some((t) => under(path, t.href)) || (e.also ?? []).some((h) => under(path, h));
  });
}

/** The tabs of the strip a page is under: none for an entry without tabs. */
export const tabsOf = (pathname: string): RailTab[] => entryOf(pathname)?.tabs ?? [];

// ── what the sidebar lists ───────────────────────────────────────────────────────────────────────────────────────────────

export interface SidebarItem {
  name: string;
  href: string;
  /** lights on its own page only (the Overview: every other page of the module is another entry's) */
  exact?: true;
  /** pages that light it besides its href and what is beneath it: the entry's other tabs and drill-downs */
  activeMatch?: string[];
}

/** The eight leaves of the sidebar group "Third-Party Vendor Risk" (navAccess.ts adds the icon and the rights: the module's own gate, `erm:risks:*` in module `erm`, for each). */
export const SIDEBAR: readonly SidebarItem[] = RAIL.map((e) => {
  const match = (e.also ?? []).concat((e.tabs ?? []).slice(1).map((t) => t.href));
  return { name: e.name, href: e.href, ...(e.key === 'overview' ? { exact: true as const } : {}), ...(match.length ? { activeMatch: match } : {}) };
});
