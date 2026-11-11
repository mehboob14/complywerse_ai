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
// WHAT READS IT: the application shell (components/shell): the top bar's trail (crumbsModel: breadcrumbFor, ownHeadingSection), the command palette (searchRoutes,
// areaName), the Work and context panel (tabsFor, activeTab) and DocumentsTabs (its tabs and the "in the area" rule). A page that draws its own heading sets
// `ownHeading`, so the trail does not repeat its name; each group of pages declares its entries in its own file, lib/navPages/<group>.ts (collected by
// navPages/index.ts), so the groups never edit the same lines. (The Header's own title map, PAGE_TITLES, went with the trail: the registry names every page.)
//
// RIGHTS: `permissions` is who is offered the page (any one of them; null: any signed-in user). A sidebar leaf has navAccess's; a page navAccess lists
// (PAGE_PERMISSIONS: /complychat, /users, /reports/...) has those; a page that gates itself says so in its group file (`permissions`, or `adminOnly`);
// every other page has the rights of the page it hangs under (or forwards to), so a detail page is never offered to someone who cannot open its list.
// `adminOnly`: the Administration menu's destinations, which the shell shows to administrators only. How the app behaves is unchanged: most pages guard
// nothing themselves and some of their APIs are open (G3_permission_matrix; navRegistry.test.ts keeps that list on navPermissions itself). Nothing here
// adds, removes or enforces a right or a guard.
//
// THE WHOLE APP (R-REG, 2026-11-01): every page of src/app that is a destination of the signed-in shell has exactly one entry (navPages/coverage.test.ts
// walks the folders and proves it); the pages outside the shell (sign-in, the public token pages) are on that test's allow-list, with the reason.
// `duplicateOf`: the page exists twice (the GRC-native cyber pages and Ava's copies under /cyber-assurance); the entry that is NOT in the sidebar names
// the one that is, and search and the Work panel offer only that one. `aliasOf` entries are another URL of a destination (a forward or the same page).
//
// THE NAMES BEFORE THIS FILE (read from the code and from a browser pass over every route, 2026-10-31) and the label chosen. "bar" is the top bar's title,
// "tabs" the Documents tab bar that replaces it in the Documents area, "back" the page's own back link (no Governance page renders a breadcrumb).
//   destination                              sidebar            bar before                               page heading                  tab / back link                          LABEL (what changes where)
//   /governance                              Overview           Governance Overview + subtitle           Governance Overview           -                                        Overview; title "Governance Overview" (same)
//   /governance/documents                    Documents          tabs                                     Document library              tab Documents; back "Documents"          Documents
//   /governance/documents/:id                -                  tabs                                     the document's title          back "Documents"                         Document
//   /governance/documents/overview           -                  tabs                                     At a glance                   tab At a glance, after Documents         At a glance (the library by department, type and stage; was "Overview", which the sidebar's Governance Overview already is)
//   /governance/documents/studio             -                  tabs                                     Comply AI Studio              tab Comply AI Studio                     Comply AI Studio
//   /governance/documents/studio/:sessionId  -                  tabs                                     the draft's title (editable)  back "Studio"                            Studio draft
//   /governance/documents/attestation        -                  tabs                                     Attestation                   tab Attestation                          Attestation
//   /governance/documents/directory          -                  tabs                                     Directory                     tab Directory (before the Settings gear) Directory (the department tree: browse, edit in a popup, add, move, deactivate)
//   /governance/attestations                 -                  "Attestation" (a flash, then a redirect) Attestation (after it)        -                                        Attestation (an alias)
//   /governance/attestations/campaigns       -                  (none)                                   Attestation Campaigns         -                                        Attestation Campaigns
//   /governance/attestations/campaigns/:id   -                  (none)                                   the campaign's name           back "Campaigns"                         Attestation Campaign
//   /governance/attestations/my              -                  (none)                                   My Attestations               -                                        My Attestations
//   /governance/attestations/complete/:id    -                  (none)                                   Complete Attestation          back "Attestations"                      Complete Attestation
//   /governance/approvals                    My Approvals       "Governance" + generic subtitle          My Approvals                  -                                        My Approvals (bar: was "Governance")
//   /governance/exceptions                   -                  tabs                                     Exceptions (was Policy exceptions)  tab "Exceptions"                               Exceptions (D62: labels only; the route, the rights and the API keep their names)
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
//   /is-projects                             Projects           "IS Projects" + subtitle                 Projects (the page head)      -                                        Projects (bar: was "IS Projects"; now its section only)
//   /is-projects/dashboard, /my-projects, /:id  -               (none)                                   Projects Overview, My Projects, name  -                                Overview, My Projects, Project (bar: its section only)
//   /governance/regulatory-changes           Regulatory Changes (none)                                   Regulatory changes            -                                        Regulatory Changes
//   /governance/regulatory-changes/:id       -                  (none)                                   the change's title            back "regulatory changes"                Regulatory change
//   /governance/regulatory-feeds             Regulatory Feeds   (none)                                   Regulatory Feeds              -                                        Regulatory Feeds
//   /attest/:token                           -                  (none: outside the shell)                the campaign's name           -                                        Acknowledge
// Page headings that still say another name (page files, left alone here; each page group aligns its heading to routeFor(pathname).label when it moves to the kit):
// Document library (Documents), Key Risk Indicators (KRIs), Regulatory changes (case), Pending Approvals (two sections of Document Reviews), and the back links "Reviews", "Campaigns", "Attestations", "Studio".
import { flattenLeaves, isGroup, navigation, navPermissions, type NavEntry, type NavItem } from '../components/layout/navAccess.ts';
import { cleanPath, underPath } from '../components/layout/navActive.ts';
import { MODULE_LEAVES, MODULE_PAGES } from './navPages/index.ts';

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
  /** also listed to the owner (head) of a department who holds no governance right: the library and its overview are theirs to read (D59) */
  ownerDoor?: true;
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
  /** who is offered the page (any one of these rights; null: any signed-in user): the sidebar's for a leaf, the page's own gate, else the rights of the page it hangs under */
  permissions: string[] | null;
  /** only administrators are offered it (the Administration menu's destinations) */
  adminOnly?: true;
  /** the entry of the same page that the sidebar (or the top bar) uses: this one is an older copy that is still a page, and search and the Work panel skip it */
  duplicateOf?: string;
  keywords?: string[];
  /** the page draws its own heading in its body (PageHeader variant="page"): the top bar then names only its section, so the page's name is not on
   *  screen twice. Set it on a page when it moves to the kit's page head. */
  ownHeading?: boolean;
  /** the section the top bar names for a page with an `ownHeading`, where its area's name would be wrong (the Regulatory pages are under /governance
   *  but sit in the Compliance Management menu group). Default: the area's name (SECTION below). */
  section?: string;
}

/** An entry that is a tab of a strip. */
export type TabEntry = RouteEntry & { tab: TabSpec };

// ---- the sidebar's leaves, read from navAccess ----
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** What navAccess lists for a page (a leaf's rights, or PAGE_PERMISSIONS'); undefined for a page it does not list, which then takes its parent's (accessOf below). */
const navAccessRights = (path: string): string[] | undefined => { const own = navPermissions(path); return own.length ? own : undefined; };

const sidebar: Array<{ item: NavItem; groups: Crumb[] }> = [];
function walk(entries: NavEntry[], groups: Crumb[]): void {
  entries.forEach((entry) => {
    if (isGroup(entry)) walk(entry.items, groups.concat({ label: entry.name, href: flattenLeaves(entry.items)[0].href }));
    else sidebar.push({ item: entry, groups });
  });
}
walk(navigation, []);

/** What a page group adds to the entry of a sidebar leaf, or says about a page of its own (lib/navPages/<group>.ts). */
export type RouteExtra = Partial<Pick<RouteEntry, 'shortLabel' | 'title' | 'subtitle' | 'parent' | 'tab' | 'hidden' | 'keywords' | 'ownHeading' | 'section' | 'permissions' | 'adminOnly' | 'duplicateOf'>>;
/** A page with no menu entry, declared by the group that owns it. `area` is the sidebar group's slug ('compliance-management'), or the leaf's for a top-level module ('task-management').
 *  `permissions` / `adminOnly` are for a page that gates itself; without them the page takes the rights of the page it hangs under. */
export type PageSpec = RouteExtra & { path: string; label: string; area: string; aliasOf?: string };
type Extra = RouteExtra;
/** An entry before its rights are resolved: `permissions` / `adminOnly` undefined mean "not said here". */
type Draft = Omit<RouteEntry, 'permissions' | 'adminOnly'> & { permissions?: string[] | null; adminOnly?: true };

const DOCS = '/governance/documents';
const ATTEST = `${DOCS}/attestation`;
const COMMITTEES = '/governance/committees';
const REGULATORY = '/governance/regulatory-changes';
const PROJECTS = '/is-projects';

// what the sidebar's own leaves add (by href)
const OF_LEAF: Record<string, Extra> = {
  '/governance': { title: 'Governance Overview', subtitle: 'Real-time policy, framework, and review posture', ownHeading: true },
  '/governance/kpi-report': { ownHeading: true },
  // the strip's first tab says Library ("Documents" under "Documents" read twice); the leaf keeps its sidebar name and the tab's accessible name holds both (tabName)
  [DOCS]: { tab: { area: 'documents', id: 'documents', order: 1, ownerDoor: true }, shortLabel: 'Library', keywords: ['Document library'] },
  '/governance/approvals': { keywords: ['Pending Approvals'] },
  [COMMITTEES]: { keywords: ['Board & Committee Management'], ownHeading: true },
  '/erm/kris': { keywords: ['Key Risk Indicators'] },
  [PROJECTS]: { subtitle: 'Track and manage information security projects across the organization', keywords: ['IS Projects'], ownHeading: true },
};

const leaves: Draft[] = sidebar.map(({ item, groups }) => ({
  path: item.href,
  label: item.name,
  area: item.href.startsWith('/governance') ? 'governance' : slug(groups.length ? groups[0].label : item.name),
  groups,
  permissions: navAccessRights(item.href),
  ...OF_LEAF[item.href],
  ...MODULE_LEAVES[item.href],
}));

// ---- the Governance pages that have no menu entry ----
const gov = (path: string, label: string, rest: Extra & { aliasOf?: string }): Draft => ({ path, label, area: 'governance', groups: [], permissions: navAccessRights(path), ...rest });

const pages: Draft[] = [
  gov(`${DOCS}/:id`, 'Document', { parent: DOCS, hidden: 'opens from a library row or its drawer, a task, a notification or an e-mail link' }),
  // `permissions: null` is its own say, not "not said": the owner of a department who reads no library opens this page (`ownerDoor`), so it must not take the library's right
  gov(`${DOCS}/overview`, 'At a glance', { parent: DOCS, permissions: null, tab: { area: 'documents', id: 'overview', order: 2, ownerDoor: true }, keywords: ['Overview', 'Documents overview'] }),
  gov(`${DOCS}/studio`, 'Comply AI Studio', { parent: DOCS, tab: { area: 'documents', id: 'studio', order: 3, studio: true, claims: `${DOCS}/:id` } }),
  gov(`${DOCS}/studio/:sessionId`, 'Studio draft', { parent: `${DOCS}/studio`, hidden: 'opens from the Studio start page ("Your work") or from a document' }),
  gov(ATTEST, 'Attestation', { parent: DOCS, tab: { area: 'documents', id: 'attestation', order: 4 } }),
  gov('/governance/attestations', 'Attestation', { aliasOf: ATTEST, subtitle: 'Document acknowledgment campaigns' }),
  gov('/governance/attestations/campaigns', 'Attestation Campaigns', { parent: ATTEST, hidden: 'legacy page: no link opens it, kept for a typed or bookmarked URL' }),
  gov('/governance/attestations/campaigns/:id', 'Attestation Campaign', { parent: '/governance/attestations/campaigns', hidden: 'opens from the legacy campaign list' }),
  gov('/governance/attestations/my', 'My Attestations', { parent: ATTEST, hidden: 'legacy page: no link opens it, kept for a typed or bookmarked URL' }),
  gov('/governance/attestations/complete/:id', 'Complete Attestation', { parent: '/governance/attestations/my', hidden: 'opens from the legacy My Attestations list' }),
  gov('/governance/exceptions', 'Exceptions', { parent: DOCS, tab: { area: 'documents', id: 'exceptions', order: 6 } }),
  // the organisation's departments as a tree to browse (Windows-Explorer style); reading takes no right (like At a glance), so the head of a unit reaches it too: what a person may change there is decided per unit by the page and the server
  gov(`${DOCS}/directory`, 'Directory', { parent: DOCS, permissions: null, tab: { area: 'documents', id: 'directory', order: 7, ownerDoor: true }, keywords: ['Departments', 'Units', 'Organisation', 'Organization', 'Org chart', 'Sub-departments'] }),
  gov('/governance/settings', 'Governance settings', { shortLabel: 'Settings', parent: DOCS, tab: { area: 'documents', id: 'settings', order: 8, permission: 'governance:settings:*' } }),
  gov('/governance/reviews', 'Document Reviews', { shortLabel: 'Reviews', parent: DOCS, tab: { area: 'documents', id: 'reviews', order: 5 }, keywords: ['Reviews', 'Review Calendar'] }),
  gov('/governance/reviews/calendar', 'Document Reviews', { aliasOf: '/governance/reviews' }),
  gov('/governance/mappings', 'Policy-Control Mappings', { parent: DOCS, hidden: 'no link opens it; a document shows the same view as its Mappings tab', ownHeading: true }),
  gov('/governance/workflows', 'Approval Workflows', { parent: DOCS, hidden: 'opens only from a document\'s menu ("Older approval requests") where the document lifecycle is off', ownHeading: true }),
  gov(`${COMMITTEES}/:id`, 'Committee', { parent: COMMITTEES, hidden: 'opens from the Committees list', ownHeading: true }),
  gov(`${COMMITTEES}/meetings/:id`, 'Meeting', { parent: COMMITTEES, hidden: 'opens from a committee', ownHeading: true }),
  gov(`${COMMITTEES}/actions`, 'Oversight Actions', { parent: COMMITTEES, hidden: 'opens from the Committees page and the Overview\'s overdue-actions counter', ownHeading: true }),
  gov(`${REGULATORY}/:id`, 'Regulatory change', { parent: REGULATORY, hidden: 'opens from the Regulatory Changes list', ownHeading: true }),
  gov(`${PROJECTS}/dashboard`, 'Overview', { title: 'Projects Overview', parent: PROJECTS, hidden: 'no link opens it; the Projects page shows the same view as its Overview tab', ownHeading: true }),
  gov(`${PROJECTS}/my-projects`, 'My Projects', { parent: PROJECTS, hidden: 'no link opens it; the Projects page shows the same view as its My Projects tab', ownHeading: true }),
  gov(`${PROJECTS}/:id`, 'Project', { parent: PROJECTS, hidden: 'opens from the Projects list', ownHeading: true }),
  gov('/attest/:token', 'Acknowledge', { hidden: 'public page for people outside the organisation (an e-mailed link): no menu, no top bar' }),
];

// ---- the pages that have no menu entry in the other modules: each group of pages declares its own, in lib/navPages/<group>.ts ----
const modulePages: Draft[] = MODULE_PAGES.map((page) => ({ groups: [], permissions: navAccessRights(page.path), ...page }));

// ---- rights: a page's own say (navAccess's list, or `permissions` / `adminOnly` in its group file), else the page it hangs under or forwards to ----
const drafts: Draft[] = leaves.concat(pages, modulePages);
const draftAt: Record<string, Draft> = {};
drafts.forEach((draft) => { draftAt[draft.path] = draft; });

function accessOf(draft: Draft): { permissions: string[] | null; adminOnly: boolean } {
  let at: Draft | undefined = draft;
  for (let hops = 0; at && hops < 8; hops++) {
    if (at.permissions !== undefined || at.adminOnly !== undefined) return { permissions: at.permissions ?? null, adminOnly: !!at.adminOnly };
    const next: string | undefined = at.aliasOf ?? at.parent;
    at = next ? draftAt[next] : undefined;
  }
  return { permissions: null, adminOnly: false };            // a page that hangs under nothing with rights (the public /attest page)
}

/** Every destination: the sidebar's leaves in menu order, then the pages that have no menu entry. */
export const routes: readonly RouteEntry[] = drafts.map((draft) => {
  const { permissions, adminOnly } = accessOf(draft);
  const { permissions: ignoredRights, adminOnly: ignoredAdmin, ...rest } = draft;
  return adminOnly ? { ...rest, permissions, adminOnly: true as const } : { ...rest, permissions };
});

const byPath: Record<string, RouteEntry> = {};
const leafPaths = new Set<string>(sidebar.map(({ item }) => item.href));
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

/** The area names the top bar shows for a page that draws its own heading: a sidebar group's name, or the module's own for a top-level destination. */
const SECTION: Record<string, string> = {
  governance: 'Governance',
  'risk-management': 'Risk Management',
  'third-party-vendor-risk': 'Third-Party Vendor Risk',
  'compliance-management': 'Compliance Management',
  'controls-automation': 'Controls Automation',
  'issue-incident-management': 'Issue & Incident Management',
  'auditor-portal': 'Auditor Portal',
  reports: 'Reports',
  'performance-overview': 'Performance Overview',
  'task-management': 'Task Management',
  'cybersecurity-assurance': 'Cybersecurity Assurance',
  administration: 'Administration',
  complychat: 'Comply Agent',
};

/** The display name of an area (the sidebar group, or the module's own name): what a search result or the Work panel puts beside a page. An area of a top-level
 *  sidebar leaf that SECTION does not name (a destination added later) is named by that leaf; '' for an unknown area. */
export function areaName(area: string): string {
  return SECTION[area] ?? routes.find((e) => e.area === area && e.groups.length === 0 && !e.parent && !e.hidden)?.label ?? '';
}

/** What the top bar shows instead of the page's title when the page draws its own heading (`ownHeading`): its section's name, or '' (nothing) when
 *  the section is the page's own name (a module's top page: Task Management says "Task Management" in its body, not twice); undefined when the page has
 *  no own heading (the top bar then shows its title) or is no route. */
export function ownHeadingSection(pathname: string | null | undefined): string | undefined {
  const hit = routeFor(pathname);
  if (!hit) return undefined;
  const entry = canonical(hit);
  return entry.ownHeading ? sectionOfEntry(entry) : undefined;
}

/** The section the top bar names for an entry that draws its own heading ('' when that is the entry's own name, or its area has no name). */
export function sectionOfEntry(entry: Pick<RouteEntry, 'area' | 'label' | 'title' | 'section'>): string {
  const section = entry.section ?? SECTION[entry.area] ?? '';
  return section === entry.label || section === (entry.title ?? entry.label) ? '' : section;
}

/** Whether the registry names the page in the top bar: every Governance page, and any other page that has moved to the kit's own heading
 *  (`ownHeading`). The shell's trail names every page, so the shell itself no longer asks; the pages' own tests still pin it. */
export function registryNamesPage(pathname: string | null | undefined): boolean {
  const hit = routeFor(pathname);
  return !!hit && (hit.area === 'governance' || !!canonical(hit).ownHeading);
}

/** The trail to a page: its sidebar groups, then the pages it hangs under, then the page itself (the last one is current). [] for a path that is no route.
 *  An older copy that hangs under the page it copies is not repeated on the way ("IT Asset Inventory > IT Asset Inventory > Asset"), and a copy that is the page itself
 *  replaces the name of the page it copies (the current page is named once, with its real URL). */
export function breadcrumbFor(pathname: string | null | undefined): Crumb[] {
  const hit = routeFor(pathname);
  if (!hit) return [];
  const chain: RouteEntry[] = [];
  for (let entry: RouteEntry | undefined = canonical(hit); entry && chain.length < 8; entry = entry.parent ? byPath[entry.parent] : undefined) chain.unshift(entry);
  const here = cleanPath(pathname as string);
  const shown = chain.filter((entry, i) => i === chain.length - 1 || !entry.duplicateOf || entry.duplicateOf !== entry.parent);
  const crumbs = chain[0].groups.concat(shown.map((entry) => ({ label: entry.label, href: entry === hit ? here : entry.path })));
  const last = crumbs.length - 1;
  if (last >= 1 && hit.duplicateOf && hit.duplicateOf === hit.parent && crumbs[last].label === crumbs[last - 1].label) crumbs.splice(last - 1, 1);
  return crumbs;
}

// ---- tab strips ----
export interface TabContext {
  /** the Comply AI Studio is on for this tenant */
  studio?: boolean;
  /** whether the person holds a right; without it the tabs that ask for one are left out */
  can?: (permission: string) => boolean;
  /** the person holds no governance right but heads a department: only the tabs made for them (`ownerDoor`) */
  ownerOnly?: boolean;
}

/** The tabs of a strip in order: all of them, or with a context only those it lists (the Studio where it is on, Settings to the right's holders, an owner of
 *  a department with no governance right only the two made for them). */
export function tabsFor(area: string, context?: TabContext): TabEntry[] {
  return routes
    .filter((entry): entry is TabEntry => !!entry.tab && entry.tab.area === area
      && (!context || ((!entry.tab.studio || !!context.studio) && (!entry.tab.permission || !!(context.can && context.can(entry.tab.permission)))
        && (!context.ownerOnly || !!entry.tab.ownerDoor))))
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

// ---- finding pages: what the command palette and the Work panel call ----

// Unicode property escapes in a RegExp built from a string: the source is compiled for ES5, which would reject them in a literal.
const MARKS = new RegExp('[\\p{M}\\u0640]', 'gu');
const SEPARATORS = new RegExp('[^\\p{L}\\p{N}]+', 'gu');

/** Text as a search compares it: lower case, no accents, no Arabic vowel signs, no tatweel ("Café" = "cafe", "الْمَخَاطِر" = "المخاطر"). The kit's own fold
 *  (listboxModel.ts) strips Latin accents only, so Arabic text with vowel signs would not match there; on Latin text the two agree. */
export function fold(text: string): string {
  return text.normalize('NFKD').replace(MARKS, '').toLowerCase();
}

/** Folded, with every run of other characters as one space: "/erm/Risk-Library" -> " erm risk library " (a leading and a trailing space make a word test one `includes`). */
const spaced = (text: string): string => ` ${fold(text).replace(SEPARATORS, ' ').trim()} `;

/** The sidebar leaf a page belongs to: the entry itself when it is a leaf, else the first leaf on the way up through `aliasOf` / `parent` (a detail page, a tab, a forward).
 *  undefined for a page that hangs under no leaf (the Administration pages, /users, /complychat, the public page). The shell offers a page only where its leaf is on the person's menu. */
export function sidebarLeafOf(entry: RouteEntry): RouteEntry | undefined {
  let at: RouteEntry | undefined = entry;
  for (let hops = 0; at && hops < 8; hops++) {
    if (leafPaths.has(at.path)) return at;
    const next: string | undefined = at.aliasOf ?? at.parent;
    at = next ? byPath[next] : undefined;
  }
  return undefined;
}

/** What a tab shows: its short label, else its label. */
export const tabText = (entry: Pick<RouteEntry, 'label' | 'shortLabel'>): string => entry.shortLabel ?? entry.label;

/** What a tab is called for a screen reader and as its tooltip: the label when the visible text is part of it ("Reviews" in "Document Reviews"), else both ("Library (Documents)"),
 *  so what a person reads or says is always inside the accessible name. */
export function tabName(entry: Pick<RouteEntry, 'label' | 'shortLabel'>): string {
  const text = tabText(entry);
  return text === entry.label || fold(entry.label).indexOf(fold(text)) >= 0 ? entry.label : `${text} (${entry.label})`;
}

/** A destination a person can go to: a path with no :param (a record needs its id), not another URL of a destination, not an older copy of a page the sidebar has. */
const openable = (entry: RouteEntry): boolean => entry.path.indexOf(':') < 0 && !entry.aliasOf && !entry.duplicateOf;

/** The pages of one area that a person can open, the menu's leaves first (in menu order), then the others in registry order. Not for a record page, a forward or an older copy. */
export function pagesForArea(area: string): RouteEntry[] {
  return routes.filter((entry) => entry.area === area && openable(entry));
}

/** How well `text` (already `spaced`) matches the query `q` (folded, single-spaced): 0 equal, 1 starts with it, 2 a word starts with it, 3 inside a word; -1 no match. */
function tier(text: string, q: string): number {
  if (text === ` ${q} `) return 0;
  if (text.indexOf(` ${q}`) === 0) return 1;
  if (text.indexOf(` ${q}`) > 0) return 2;
  return text.indexOf(q) >= 0 ? 3 : -1;
}

/** Lower is better, Infinity: not a match. How well the query matches comes first (equal, starts with it, a word starts with it, inside a word: 0-3), then where:
 *  a name (label, title, short label) before a keyword of the same quality, so a keyword that a word starts with still beats the middle of a name. That makes 0-7;
 *  a query of several words that are all somewhere in the page's names, menu groups, area and path ranks 8, a part of the path 9. */
function score(entry: RouteEntry, q: string): number {
  let best = Infinity;
  const names = [entry.label, entry.title, entry.shortLabel].filter((name): name is string => !!name);
  names.forEach((name) => { const t = tier(spaced(name), q); if (t >= 0) best = Math.min(best, 2 * t); });
  (entry.keywords ?? []).forEach((word) => { const t = tier(spaced(word), q); if (t >= 0) best = Math.min(best, 2 * t + 1); });
  if (best < Infinity) return best;
  const words = q.split(' ');
  if (words.length > 1) {
    const where = spaced(names.concat(entry.keywords ?? [], entry.groups.map((g) => g.label), areaName(entry.area), entry.path).join(' '));
    if (words.every((word) => where.indexOf(word) >= 0)) return 8;
  }
  return spaced(entry.path).indexOf(q) >= 0 ? 9 : Infinity;
}

/** The pages that match what a person typed, best first: the name that is the query, then a name that starts with it, then a word of a name, then inside a
 *  name, each step ahead of the same step for the names it used to go by (`keywords`); then the path. Equal matches keep registry order (menu first), so the list is stable. Case, accents and Arabic vowel signs do
 *  not matter. Only openable pages are searched (openable above). `allow` drops what the person may not open (rights and module gates are the caller's) BEFORE
 *  the limit is applied. An empty query finds nothing. */
export function searchRoutes(query: string, options: { limit?: number; allow?: (entry: RouteEntry) => boolean } = {}): RouteEntry[] {
  const q = fold(query).replace(SEPARATORS, ' ').trim();
  if (!q) return [];
  const { limit = 20, allow } = options;
  const hits: Array<{ entry: RouteEntry; rank: number; at: number }> = [];
  routes.forEach((entry, at) => {
    if (!openable(entry) || (allow && !allow(entry))) return;
    const rank = score(entry, q);
    if (rank < Infinity) hits.push({ entry, rank, at });
  });
  hits.sort((a, b) => a.rank - b.rank || a.at - b.at);
  return hits.slice(0, limit).map((hit) => hit.entry);
}
