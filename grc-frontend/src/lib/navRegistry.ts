// The navigation registry: for every destination of the sidebar and every Governance route, ONE name, the page it belongs under, and what the page needs.
// Pure data and pure functions (no React): `node --test src/lib/navRegistry.test.ts`.
//
// navAccess.ts stays the sidebar's source (names, hrefs, rights, activeMatch, exact; navActive.ts lights the entry): this file READS it, so every sidebar
// leaf has an entry whose label is the sidebar's name and whose rights are the sidebar's. What it adds is what the sidebar cannot say: the pages that
// have no menu entry (detail pages, tabs, forwards, legacy pages), the name and the top-bar words of each, the trail up to a menu entry, and the tabs.
//
// NAMING RULE: a destination's `label` is its sidebar name; with no sidebar entry it is the page's own heading. A short text some strip shows for it
// (`shortLabel`, tabs only) is a display variant: the label is its tooltip and accessible name. `title` is the label made self-sufficient where the
// label is read out of its menu group ("Overview" -> "Governance Overview"); `keywords` are the names it used to go by (a future command palette
// finds the page by any of them).
//
// WHAT READS IT: the Header (the top-bar title of Governance pages), DocumentsTabs (its tabs and the "in the area" rule). Other modules still read
// their own title map until they move over; `area` says whose top bar the registry owns ('governance' so far).
//
// RIGHTS: `permissions` is what navAccess says the page needs today (null: nothing, any signed-in user; that is how the app behaves, many Governance
// pages guard nothing and some of their APIs are open: G3_permission_matrix). Nothing here adds, removes or enforces a right or a guard.
//
// THE NAMES BEFORE THIS FILE (read from the code and from a browser pass over every route, 2026-10-31) and the label chosen. "bar" is the top bar's title,
// "tabs" the Documents tab bar that replaces it in the Documents area, "back" the page's own back link (no Governance page renders a breadcrumb).
//   destination                              sidebar            bar before                               page heading                  tab / back link                          LABEL (what changes where)
//   /governance                              Overview           Governance Overview + subtitle           Governance Overview           -                                        Overview; title "Governance Overview" (same)
//   /governance/documents                    Documents          tabs                                     Document library              tab Documents; back "Documents"          Documents
//   /governance/documents/:id                -                  tabs                                     the document's title          back "Documents"                         Document
//   /governance/documents/studio             -                  tabs                                     Comply AI Studio              tab Comply AI Studio                     Comply AI Studio
//   /governance/documents/studio/:sessionId  -                  tabs                                     the draft's title (editable)  back "Studio"                            Studio draft
//   /governance/documents/attestation        -                  tabs                                     Attestation                   tab Attestation                          Attestation
//   /governance/attestations                 -                  "Attestation" (a flash, then a redirect) Attestation (after it)        -                                        Attestation (an alias)
//   /governance/attestations/campaigns       -                  (none)                                   Attestation Campaigns         -                                        Attestation Campaigns
//   /governance/attestations/campaigns/:id   -                  (none)                                   the campaign's name           back "Campaigns"                         Attestation Campaign
//   /governance/attestations/my              -                  (none)                                   My Attestations               -                                        My Attestations
//   /governance/attestations/complete/:id    -                  (none)                                   Complete Attestation          back "Attestations"                      Complete Attestation
//   /governance/approvals                    My Approvals       "Governance" + generic subtitle          My Approvals                  -                                        My Approvals (bar: was "Governance")
//   /governance/exceptions                   -                  tabs                                     Policy exceptions             tab "Exceptions", tooltip "Policy exceptions"   Policy exceptions; shortLabel Exceptions
//   /governance/settings                     -                  tabs                                     Governance settings           tab "Settings" (gear), tooltip "Settings"       Governance settings; shortLabel Settings (tooltip was "Settings")
//   /governance/reviews                      -                  "Governance" + generic subtitle          Document Reviews              tab Reviews, tooltip "Document Reviews"  Document Reviews; shortLabel Reviews (bar: was "Governance"; now a tab of the Documents strip)
//   /governance/reviews/calendar             -                  (none)                                   Document Reviews              the same tab (its calendar view)         Document Reviews (an alias: it was "Review Calendar", now a view of the page)
//   /governance/mappings                     -                  "Governance" + generic subtitle          Policy-Control Mappings       -                                        Policy-Control Mappings (bar: was "Governance")
//   /governance/workflows                    -                  "Governance" + generic subtitle          Approval Workflows            -                                        Approval Workflows (bar: was "Governance")
//   /governance/committees                   Committees         (none)                                   Committees (was Board & Committee Management)  back "Committees"                        Committees
//   /governance/committees/:id               -                  (none)                                   the committee's name          back "Committees"                        Committee
//   /governance/committees/meetings/:id      -                  (none)                                   the meeting's title           back "{committee}"                       Meeting
//   /governance/committees/actions           -                  (none)                                   Oversight Actions             back "Committees"                        Oversight Actions
//   /governance/kpi-report                   KPI Report         (none)                                   KPI Report                    -                                        KPI Report
//   /erm/kris                                KRIs               (none)                                   Key Risk Indicators           -                                        KRIs
//   /is-projects                             Projects           "IS Projects" + subtitle                 Overview (the first tab)      -                                        Projects (bar: was "IS Projects")
//   /is-projects/dashboard, /my-projects, /:id  -               (none)                                   Overview, My Projects, name   -                                        Overview, My Projects, Project
//   /governance/regulatory-changes           Regulatory Changes (none)                                   Regulatory changes            -                                        Regulatory Changes
//   /governance/regulatory-changes/:id       -                  (none)                                   the change's title            back "regulatory changes"                Regulatory change
//   /governance/regulatory-feeds             Regulatory Feeds   (none)                                   Regulatory Feeds              -                                        Regulatory Feeds
//   /attest/:token                           -                  (none: outside the shell)                the campaign's name           -                                        Acknowledge
// Page headings that still say another name (page files, left alone here; each page group aligns its heading to routeFor(pathname).label when it moves to the kit):
// Document library (Documents), Key Risk Indicators (KRIs), Regulatory changes (case), Overview (Projects, its first
// tab), Pending Approvals (two sections of Document Reviews), and the back links "Reviews", "Campaigns", "Attestations", "Studio".
import { flattenLeaves, isGroup, navigation, navPermissions, type NavEntry, type NavItem } from '../components/layout/navAccess.ts';
import { cleanPath, underPath } from '../components/layout/navActive.ts';

export interface Crumb { label: string; href: string }

export interface TabSpec {
  /** the strip it is a tab of ('documents') */
  area: string;
  /** which tab, inside the strip (the strip keys its icon on it) */
  id: string;
  order: number;
  /** listed only where the Comply AI Studio is on */
  studio?: true;
  /** listed only to people who hold this right */
  permission?: string;
  /** a route pattern whose pages light this tab (where it is listed) instead of the tab their path is under */
  claims?: string;
}

export interface RouteEntry {
  /** the URL pattern ("/governance/documents/:id": a :param matches one segment) and the identity of the destination */
  path: string;
  /** THE name of the destination */
  label: string;
  /** a shorter text a tab bar shows; `label` stays its tooltip and accessible name */
  shortLabel?: string;
  /** the top bar's title, where the label alone would not do */
  title?: string;
  /** the top bar's second line */
  subtitle?: string;
  /** whose top bar this is: the registry owns the title of 'governance' pages; other areas are the sidebar group's slug */
  area: string;
  /** the sidebar groups it sits in, outermost first (only a menu entry has them; the others take the groups of the entry they hang under) */
  groups: Crumb[];
  /** the page it is reached from (a path of another entry, without :params): the trail goes through it */
  parent?: string;
  tab?: TabSpec;
  /** another URL of this destination's page: it forwards to it (the legacy attestations page) or opens that same page in a given state (the review
   *  calendar's URL opens Document Reviews on its calendar view); it has the same name */
  aliasOf?: string;
  /** why it has no menu entry or tab: where it is reached from */
  hidden?: string;
  /** what the page needs today, as navAccess says (any one of them); null: no right, any signed-in user */
  permissions: string[] | null;
  keywords?: string[];
  /** the page draws its own heading in its body (PageHeader variant="page"): the top bar then names only its section, so the page's name is not on
   *  screen twice. Set it on a page when it moves to the kit's page head. */
  ownHeading?: boolean;
}

/** An entry that is a tab of a strip. */
export type TabEntry = RouteEntry & { tab: TabSpec };

// ---- the sidebar's leaves, read from navAccess ----
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const rights = (path: string): string[] | null => { const own = navPermissions(path); return own.length ? own : null; };

const sidebar: Array<{ item: NavItem; groups: Crumb[] }> = [];
function walk(entries: NavEntry[], groups: Crumb[]): void {
  entries.forEach((entry) => {
    if (isGroup(entry)) walk(entry.items, groups.concat({ label: entry.name, href: flattenLeaves(entry.items)[0].href }));
    else sidebar.push({ item: entry, groups });
  });
}
walk(navigation, []);

type Extra = Partial<Pick<RouteEntry, 'shortLabel' | 'title' | 'subtitle' | 'parent' | 'tab' | 'hidden' | 'keywords' | 'ownHeading'>>;

const DOCS = '/governance/documents';
const ATTEST = `${DOCS}/attestation`;
const COMMITTEES = '/governance/committees';
const REGULATORY = '/governance/regulatory-changes';
const PROJECTS = '/is-projects';

// what the sidebar's own leaves add (by href)
const OF_LEAF: Record<string, Extra> = {
  '/governance': { title: 'Governance Overview', subtitle: 'Real-time policy, framework, and review posture', ownHeading: true },
  '/governance/kpi-report': { ownHeading: true },
  [DOCS]: { tab: { area: 'documents', id: 'documents', order: 1 }, keywords: ['Document library'] },
  '/governance/approvals': { keywords: ['Pending Approvals'] },
  [COMMITTEES]: { keywords: ['Board & Committee Management'], ownHeading: true },
  '/erm/kris': { keywords: ['Key Risk Indicators'] },
  [PROJECTS]: { subtitle: 'Track and manage information security projects across the organization', keywords: ['IS Projects'] },
};

const leaves: RouteEntry[] = sidebar.map(({ item, groups }) => ({
  path: item.href,
  label: item.name,
  area: item.href.startsWith('/governance') ? 'governance' : slug(groups.length ? groups[0].label : item.name),
  groups,
  permissions: rights(item.href),
  ...OF_LEAF[item.href],
}));

// ---- the Governance pages that have no menu entry ----
const gov = (path: string, label: string, rest: Extra & { aliasOf?: string }): RouteEntry => ({ path, label, area: 'governance', groups: [], permissions: rights(path), ...rest });

const pages: RouteEntry[] = [
  gov(`${DOCS}/:id`, 'Document', { parent: DOCS, hidden: 'opens from a library row or its drawer, a task, a notification or an e-mail link' }),
  gov(`${DOCS}/studio`, 'Comply AI Studio', { parent: DOCS, tab: { area: 'documents', id: 'studio', order: 2, studio: true, claims: `${DOCS}/:id` } }),
  gov(`${DOCS}/studio/:sessionId`, 'Studio draft', { parent: `${DOCS}/studio`, hidden: 'opens from the Studio start page ("Your work") or from a document' }),
  gov(ATTEST, 'Attestation', { parent: DOCS, tab: { area: 'documents', id: 'attestation', order: 3 } }),
  gov('/governance/attestations', 'Attestation', { aliasOf: ATTEST, subtitle: 'Document acknowledgment campaigns' }),
  gov('/governance/attestations/campaigns', 'Attestation Campaigns', { parent: ATTEST, hidden: 'legacy page: no link opens it, kept for a typed or bookmarked URL' }),
  gov('/governance/attestations/campaigns/:id', 'Attestation Campaign', { parent: '/governance/attestations/campaigns', hidden: 'opens from the legacy campaign list' }),
  gov('/governance/attestations/my', 'My Attestations', { parent: ATTEST, hidden: 'legacy page: no link opens it, kept for a typed or bookmarked URL' }),
  gov('/governance/attestations/complete/:id', 'Complete Attestation', { parent: '/governance/attestations/my', hidden: 'opens from the legacy My Attestations list' }),
  gov('/governance/exceptions', 'Policy exceptions', { shortLabel: 'Exceptions', parent: DOCS, tab: { area: 'documents', id: 'exceptions', order: 5 } }),
  gov('/governance/settings', 'Governance settings', { shortLabel: 'Settings', parent: DOCS, tab: { area: 'documents', id: 'settings', order: 6, permission: 'governance:settings:*' } }),
  gov('/governance/reviews', 'Document Reviews', { shortLabel: 'Reviews', parent: DOCS, tab: { area: 'documents', id: 'reviews', order: 4 }, keywords: ['Reviews', 'Review Calendar'] }),
  gov('/governance/reviews/calendar', 'Document Reviews', { aliasOf: '/governance/reviews' }),
  gov('/governance/mappings', 'Policy-Control Mappings', { parent: DOCS, hidden: 'no link opens it; a document shows the same view as its Mappings tab' }),
  gov('/governance/workflows', 'Approval Workflows', { parent: DOCS, hidden: 'opens only from a document\'s menu ("Older approval requests") where the document lifecycle is off' }),
  gov(`${COMMITTEES}/:id`, 'Committee', { parent: COMMITTEES, hidden: 'opens from the Committees list', ownHeading: true }),
  gov(`${COMMITTEES}/meetings/:id`, 'Meeting', { parent: COMMITTEES, hidden: 'opens from a committee', ownHeading: true }),
  gov(`${COMMITTEES}/actions`, 'Oversight Actions', { parent: COMMITTEES, hidden: 'opens from the Committees page and the Overview\'s overdue-actions counter', ownHeading: true }),
  gov(`${REGULATORY}/:id`, 'Regulatory change', { parent: REGULATORY, hidden: 'opens from the Regulatory Changes list' }),
  gov(`${PROJECTS}/dashboard`, 'Overview', { title: 'Projects Overview', parent: PROJECTS, hidden: 'no link opens it; the Projects page shows the same view as its Overview tab' }),
  gov(`${PROJECTS}/my-projects`, 'My Projects', { parent: PROJECTS, hidden: 'no link opens it; the Projects page shows the same view as its My Projects tab' }),
  gov(`${PROJECTS}/:id`, 'Project', { parent: PROJECTS, hidden: 'opens from the Projects list' }),
  gov('/attest/:token', 'Acknowledge', { hidden: 'public page for people outside the organisation (an e-mailed link): no menu, no top bar' }),
];

/** Every destination: the sidebar's leaves in menu order, then the pages that have no menu entry. */
export const routes: readonly RouteEntry[] = leaves.concat(pages);

const byPath: Record<string, RouteEntry> = {};
routes.forEach((entry) => { byPath[entry.path] = entry; });
const patterns = routes.map((entry) => ({ entry, segments: entry.path.split('/').filter(Boolean) }));

/** The entry for a page: whole path, a :param matches one segment, the pattern with more fixed segments wins; undefined for a path that is no route. */
export function routeFor(pathname: string | null | undefined): RouteEntry | undefined {
  if (!pathname) return undefined;
  const segments = cleanPath(pathname).split('/').filter(Boolean);
  let best: RouteEntry | undefined;
  let bestFixed = -1;
  for (const { entry, segments: pattern } of patterns) {
    if (pattern.length !== segments.length) continue;
    let fixed = 0;
    let match = true;
    for (let i = 0; i < pattern.length && match; i++) {
      if (pattern[i].startsWith(':')) continue;
      match = pattern[i] === segments[i];
      fixed++;
    }
    if (match && fixed > bestFixed) { best = entry; bestFixed = fixed; }
  }
  return best;
}

/** The destination an entry stands for: an alias URL is its target. */
const canonical = (entry: RouteEntry): RouteEntry => (entry.aliasOf && byPath[entry.aliasOf]) || entry;

/** The top-bar title of a page (its entry's title, else its label); undefined for a path that is no route. */
export function titleFor(pathname: string | null | undefined): string | undefined {
  const hit = routeFor(pathname);
  if (!hit) return undefined;
  const entry = canonical(hit);
  return entry.title ?? entry.label;
}

export function subtitleFor(pathname: string | null | undefined): string | undefined {
  const hit = routeFor(pathname);
  return hit ? hit.subtitle ?? canonical(hit).subtitle : undefined;
}

/** The area names the top bar shows for a page that draws its own heading (only Governance is registry-owned so far). */
const SECTION: Record<string, string> = { governance: 'Governance' };

/** What the top bar shows instead of the page's title when the page draws its own heading (`ownHeading`): its section's name; undefined when the
 *  page has no own heading (the top bar then shows its title) or is no route. */
export function ownHeadingSection(pathname: string | null | undefined): string | undefined {
  const hit = routeFor(pathname);
  return hit && canonical(hit).ownHeading ? SECTION[hit.area] : undefined;
}

/** The trail to a page: its sidebar groups, then the pages it hangs under, then the page itself (the last one is current). [] for a path that is no route. */
export function breadcrumbFor(pathname: string | null | undefined): Crumb[] {
  const hit = routeFor(pathname);
  if (!hit) return [];
  const chain: RouteEntry[] = [];
  for (let entry: RouteEntry | undefined = canonical(hit); entry && chain.length < 8; entry = entry.parent ? byPath[entry.parent] : undefined) chain.unshift(entry);
  const here = cleanPath(pathname as string);
  return chain[0].groups.concat(chain.map((entry, i) => ({ label: entry.label, href: i === chain.length - 1 && entry === hit ? here : entry.path })));
}

// ---- tab strips ----
export interface TabContext {
  /** the Comply AI Studio is on for this tenant */
  studio?: boolean;
  /** whether the person holds a right; without it the tabs that ask for one are left out */
  can?: (permission: string) => boolean;
}

/** The tabs of a strip in order: all of them, or with a context only those it lists (the Studio where it is on, Settings to the right's holders). */
export function tabsFor(area: string, context?: TabContext): TabEntry[] {
  return routes
    .filter((entry): entry is TabEntry => !!entry.tab && entry.tab.area === area
      && (!context || ((!entry.tab.studio || !!context.studio) && (!entry.tab.permission || !!(context.can && context.can(entry.tab.permission))))))
    .sort((a, b) => a.tab.order - b.tab.order);
}

/** Whether a page belongs to a strip's area (the Header shows the strip there): it is on or under a tab's page. */
export function isInArea(area: string, pathname: string | null | undefined): boolean {
  return !!pathname && tabsFor(area).some((tab) => underPath(cleanPath(pathname), tab.path));
}

/** The tab a page lights: the deepest tab whose page it is on or under; a page a tab `claims` lights that tab instead (where the Studio is on). A tab
 *  the strip does not list (the Studio off) is never lit. */
export function activeTab(area: string, pathname: string | null | undefined, context: Pick<TabContext, 'studio'> = {}): TabEntry | undefined {
  if (!pathname) return undefined;
  const path = cleanPath(pathname);
  const tabs = tabsFor(area);
  const listed = (tab: TabEntry) => !tab.tab.studio || !!context.studio;
  const page = routeFor(path);
  const claimed = tabs.find((tab) => !!page && tab.tab.claims === page.path && listed(tab));
  if (claimed) return claimed;
  let best: TabEntry | undefined;
  for (const tab of tabs) if (underPath(path, tab.path) && (!best || tab.path.length > best.path.length)) best = tab;
  return best && listed(best) ? best : undefined;
}
