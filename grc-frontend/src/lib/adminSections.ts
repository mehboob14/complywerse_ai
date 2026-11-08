// The Administration sections: the ONE list that the Administration menu, the section list beside every Administration page, the navigation registry
// (lib/navPages/admin.ts) and the old `/admin?tab=` addresses all read, so they cannot drift apart again (G12 P-13: the menu had 16 entries, the tab bar 13, and
// the newest tab had no door). Pure data and pure functions (no React, no icons: the menu keeps its own icon per id): `node --test src/lib/adminSections.test.ts`.
//
// Each section is a page of its own at `/admin/<section>` (the workflow engine, a full-width builder, stays at `/workflow-engine`). The old tab host `/admin`
// only forwards: `legacyTarget()` turns `/admin?tab=<id>&…` into the section's address and keeps every other parameter (stage, connector, provider…).
//
// WHO SEES THEM: administrators only, as before (the menu shows Administration to `isAdmin` and nothing else). `rights` is what the SERVER asks of a
// person for the section's reads and writes (G12 §1, read from the routers); it is recorded for the day delegated administrators get a door (G12 G-1, a
// decision for the user) and changes nothing today: `visibleSections()` is every section for an administrator and none for anyone else.
//
// OTHER GROUPS PLUG IN HERE with one line each: flip `ownHeading` to true when your page draws the kit's page head (PageHeader variant="page" with the
// section's label as its title), change a `tabs` alias if your page takes another query, add a path to `paths` for a page that belongs to the section.

export type AdminGroupId = 'organisation' | 'people' | 'connections' | 'ai' | 'automation' | 'audit' | 'settings';

export interface AdminGroup { id: AdminGroupId; label: string }

/** The groups, in menu order. */
export const ADMIN_GROUPS: readonly AdminGroup[] = [
  { id: 'organisation', label: 'Organisation' },
  { id: 'people', label: 'People & access' },
  { id: 'connections', label: 'Connections' },
  { id: 'ai', label: 'AI' },
  { id: 'automation', label: 'Automation' },
  { id: 'audit', label: 'Audit' },
  { id: 'settings', label: 'Settings' },
];

/** An old `?tab=` value and what it adds to the section's address (a default the request's own parameters may override). */
export interface TabAlias { tab: string; query?: Readonly<Record<string, string>> }

export interface AdminSection {
  /** stable: the menu's icon, the tests and the old tab values refer to it */
  id: string;
  /** THE name: the menu, the section list, the page's heading and the navigation registry all say it */
  label: string;
  group: AdminGroupId;
  /** the canonical address, no query */
  url: string;
  /** other address prefixes that belong to the section (its detail pages, pages that were once its own): they light the section and sit in its layout */
  paths: readonly string[];
  /** what the server asks to read or change it (informational: see the header) */
  rights: readonly string[];
  /** the old `/admin?tab=` values that open this section */
  tabs: readonly TabAlias[];
  /** the section's page draws the kit's page head: the top bar then names only "Administration" */
  ownHeading: boolean;
  /** 'settings': drawn beside the section list; 'full': a full-width page of its own (the workflow builder) */
  layout: 'settings' | 'full';
  /** the names it used to go by: search finds the section by any of them */
  keywords: readonly string[];
}

const S = (section: Omit<AdminSection, 'paths' | 'tabs' | 'keywords' | 'layout'> & Partial<Pick<AdminSection, 'paths' | 'tabs' | 'keywords' | 'layout'>>): AdminSection => ({
  paths: [], tabs: [], keywords: [], layout: 'settings', ...section,
});

/** The sections, in menu order. */
export const ADMIN_SECTIONS: readonly AdminSection[] = [
  // ---- Organisation ----
  S({
    id: 'organization', label: 'Company & profile', group: 'organisation', url: '/admin/organization', ownHeading: true,
    rights: ['admin:organization:view', 'admin:organization:edit', 'compliance:org_profile:*'],
    tabs: [{ tab: 'company' }, { tab: 'profile', query: { stage: 'profile' } }],
    keywords: ['Organisation', 'Organization', 'Company', 'Company Profile', 'Organisation Profile', 'Organization Profile', 'Primary contact'],
  }),
  S({
    id: 'departments', label: 'Departments', group: 'organisation', url: '/admin/departments', ownHeading: true,
    rights: ['admin:organization:edit'],            // reads: any signed-in person
    tabs: [{ tab: 'departments' }, { tab: 'teams' }],
    keywords: ['Teams', 'Sub-departments', 'Units', 'Level names'],
  }),
  // ---- People & access ----
  S({
    id: 'users', label: 'Users', group: 'people', url: '/admin/users', ownHeading: false,
    rights: ['admin:users:view', 'admin:users:create', 'admin:users:edit', 'admin:users:delete'],
    tabs: [{ tab: 'users' }],
    keywords: ['User Management', 'Admin Users', 'People', 'Accounts'],
  }),
  S({
    id: 'roles', label: 'Roles & permissions', group: 'people', url: '/admin/roles', ownHeading: false,
    rights: ['admin:users:view', 'admin:roles:view', 'admin:permissions:view', 'admin:roles:create', 'admin:roles:edit', 'admin:roles:delete'],
    tabs: [{ tab: 'roles' }],
    keywords: ['Role Management', 'Roles', 'Permissions'],
  }),
  S({
    id: 'password-policy', label: 'Password & sessions', group: 'people', url: '/admin/password-policy', ownHeading: true,
    rights: ['admin:settings:edit'],                // reads: any signed-in person
    tabs: [{ tab: 'password-policy' }],
    keywords: ['Password Policy', 'Lockout', 'Session timeout', 'Idle timeout'],
  }),
  S({
    id: 'sso', label: 'Single sign-on', group: 'people', url: '/admin/sso', ownHeading: true,
    rights: ['admin:integrations_sso:manage'],      // or the Administrator role
    tabs: [{ tab: 'identity' }],
    keywords: ['SSO', 'Identity Providers', 'Microsoft Entra', 'Azure AD', 'Sign in'],
  }),
  // ---- Connections ----
  S({
    id: 'connections', label: 'Connected systems', group: 'connections', url: '/admin/connections', ownHeading: true,
    // (/admin/evidence-collectors is also the Controls Automation menu's "Connections" page: it is not drawn inside Administration's layout from there)
    paths: ['/admin/cloud-connectors', '/admin/connectors'],
    rights: ['admin:integrations:view', 'admin:integrations:edit', 'compliance:scan:execute', 'evidence:evidence_library:edit'],
    tabs: [
      { tab: 'integrations', query: { kind: 'scanners' } },
      { tab: 'cloud-connectors', query: { kind: 'cloud' } },
      { tab: 'connectors', query: { kind: 'tools' } },
      { tab: 'evidence-collectors', query: { kind: 'evidence' } },
    ],
    keywords: ['Integrations', 'Cloud Connectors', 'Connectors', 'Connections', 'Evidence Collectors', 'Scanner Connections'],
  }),
  // ---- AI ----
  S({
    id: 'ai-governance', label: 'AI governance', group: 'ai', url: '/admin/ai-governance', ownHeading: false,
    rights: ['admin:ai_governance:view', 'admin:ai_governance:payloads'],
    keywords: ['AI Governance', 'AI inventory'],
  }),
  S({
    id: 'ai-usage', label: 'AI usage', group: 'ai', url: '/admin/ai-usage', ownHeading: true,
    paths: ['/admin/usage'],
    rights: ['admin:users:view', 'admin:organization:view', 'admin:organization:edit'],
    keywords: ['Token usage', 'Usage Monitoring', 'AI cost', 'Budgets'],
  }),
  // ---- Automation ----
  S({
    id: 'workflow', label: 'Workflow Engine', group: 'automation', url: '/workflow-engine', ownHeading: false, layout: 'full',
    rights: ['workflow_engine:definitions:view', 'workflow_engine:definitions:edit', 'workflow_engine:integrations:view', 'workflow_engine:executions:view'],
    tabs: [{ tab: 'workflow' }],
    keywords: ['Workflow Engine', 'Workflows', 'Automation rules', 'Triggers'],
  }),
  S({
    id: 'scheduler', label: 'Scheduled jobs', group: 'automation', url: '/admin/scheduler', ownHeading: false,
    rights: ['admin:settings:view', 'admin:settings:edit'],
    keywords: ['Scheduler', 'Jobs', 'Run now'],
  }),
  // ---- Audit ----
  S({
    id: 'audit-logs', label: 'Audit log', group: 'audit', url: '/admin/audit-logs', ownHeading: true,
    rights: ['admin:audit_logs:view'],
    tabs: [{ tab: 'audit' }],
    keywords: ['Audit Logs', 'Activity', 'Who changed'],
  }),
  // ---- Settings ----
  S({
    id: 'module-settings', label: 'Module settings', group: 'settings', url: '/admin/settings', ownHeading: true,
    rights: [],                                     // each module's own Settings tab asks for that module's rights
    keywords: ['Settings', 'Custom fields', 'Statuses', 'SLA'],
  }),
];

/** The address `/admin` forwards to when no tab is asked for. */
export const ADMIN_HOME: string = ADMIN_SECTIONS[0].url;

const byId: Record<string, AdminSection> = {};
ADMIN_SECTIONS.forEach((section) => { byId[section.id] = section; });

export const sectionById = (id: string): AdminSection | undefined => byId[id];

/** The path of an address: no query, no fragment, no trailing slash. */
function pathOf(address: string): string {
  const bare = address.split('#')[0].split('?')[0];
  return bare.length > 1 ? bare.replace(/\/+$/, '') : bare;
}

const under = (path: string, prefix: string): boolean => path === prefix || path.startsWith(`${prefix}/`);

/** Whose page an address is: the section whose address (or listed path) it is or lies under; the longest match wins. `/admin` itself belongs to none. */
export function sectionOfPath(address: string | null | undefined): AdminSection | undefined {
  if (!address) return undefined;
  const path = pathOf(address);
  let best: AdminSection | undefined;
  let bestLength = -1;
  for (const section of ADMIN_SECTIONS) {
    for (const prefix of [section.url].concat(section.paths)) {
      if (under(path, prefix) && prefix.length > bestLength) { best = section; bestLength = prefix.length; }
    }
  }
  return best;
}

/** The section's address when the address belongs to one: what the menu lights. */
export const adminActiveHref = (address: string | null | undefined): string | undefined => sectionOfPath(address)?.url;

/** The section an old `?tab=` value opens. */
export function sectionOfTab(tab: string | null | undefined): { section: AdminSection; alias: TabAlias } | undefined {
  if (!tab) return undefined;
  for (const section of ADMIN_SECTIONS) {
    const alias = section.tabs.find((a) => a.tab === tab);
    if (alias) return { section, alias };
  }
  return undefined;
}

type Query = URLSearchParams | Record<string, string | readonly string[] | undefined>;

function queryPairs(query: Query | undefined): Array<[string, string]> {
  if (!query) return [];
  if (query instanceof URLSearchParams) return Array.from(query.entries());
  const pairs: Array<[string, string]> = [];
  Object.keys(query).forEach((key) => {
    const value = query[key];
    if (typeof value === 'string') pairs.push([key, value]);
    else if (value) value.forEach((v) => pairs.push([key, v]));
  });
  return pairs;
}

export interface Forward { pathname: string; search: string; href: string }

/**
 * Where an address of the old tab host goes: `/admin?tab=users` -> `/admin/users`, `/admin?tab=profile&stage=data_systems` -> `/admin/organization?stage=data_systems`,
 * `/admin?tab=evidence-collectors&connector=github` -> `/admin/connections?kind=evidence&connector=github`. No tab (or one nobody knows) opens the first section. The
 * request's other parameters are kept as they are; what an alias adds is only a default (the request's own value wins).
 */
export function legacyTarget(query?: Query): Forward {
  const pairs = queryPairs(query);
  const tab = pairs.find(([key]) => key === 'tab')?.[1];
  const hit = sectionOfTab(tab);
  const rest = pairs.filter(([key]) => key !== 'tab');
  const out = new URLSearchParams();
  const asked = new Set(rest.map(([key]) => key));
  if (hit?.alias.query) Object.keys(hit.alias.query).forEach((key) => { if (!asked.has(key)) out.append(key, hit.alias.query![key]); });
  rest.forEach(([key, value]) => out.append(key, value));
  const pathname = hit ? hit.section.url : ADMIN_HOME;
  const search = out.toString();
  return { pathname, search: search ? `?${search}` : '', href: search ? `${pathname}?${search}` : pathname };
}

/** The sections grouped for the menu and the section list, in order; a group with no section is left out. */
export function groupedSections(sections: readonly AdminSection[] = ADMIN_SECTIONS): Array<{ group: AdminGroup; sections: AdminSection[] }> {
  return ADMIN_GROUPS
    .map((group) => ({ group, sections: sections.filter((s) => s.group === group.id) }))
    .filter((entry) => entry.sections.length > 0);
}

/** Who is offered Administration today: administrators, all of it; anyone else, none. (A delegated door by `rights` is a decision for the user, G12 G-1.) */
export function visibleSections(me: { isAdmin: boolean }): readonly AdminSection[] {
  return me.isAdmin ? ADMIN_SECTIONS : [];
}
