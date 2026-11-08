// Navigation-registry entries of the Administration pages (/admin/*) and User Management (/users) (see navPages/index.ts for the contract). Rewritten by adm-shell, 2026-11-08.
// The sections are not listed by hand any more: they are generated from lib/adminSections.ts, the one registry the Administration menu and the section list beside every
// page read too, so the menu, the pages and the top bar cannot disagree (G12 P-13). Administration is the menu pinned at the foot of the sidebar, not a leaf of `navigation`,
// so /admin is a root outside the menu: it only forwards the old ?tab= addresses to the section pages. `adminOnly` (inherited from /admin) is the menu's rule; the four pages of
// the scanner onboarding gate themselves with the agents right instead. The workflow engine's entry stays in navPages/workflow.ts (its page belongs to another group).
import type { PageSpec, RouteExtra } from '../navRegistry.ts';
import { ADMIN_SECTIONS } from '../adminSections.ts';

const AREA = 'administration';
const ADMIN = '/admin';

export const LEAVES: Record<string, RouteExtra> = {};

/** Every name an Administration section has or had, once each: /admin's keywords, so a search for "SSO" or "Teams" still finds the Administration. */
const everyName = (): string[] => {
  const names: string[] = [];
  ADMIN_SECTIONS.forEach((s) => [s.label].concat(s.keywords).forEach((name) => { if (name !== 'Administration' && names.indexOf(name) < 0) names.push(name); }));
  return names;
};

/** The pages of the sections that live under /admin (the workflow builder, at its own address, has its entry in workflow.ts). */
const sectionPages = (): PageSpec[] => ADMIN_SECTIONS.filter((s) => s.url.indexOf(`${ADMIN}/`) === 0).map((s) => ({
  path: s.url,
  label: s.label,
  area: AREA,
  parent: ADMIN,
  hidden: `opens from the Administration menu (${s.label}) and from the section list beside every Administration page`,
  keywords: s.keywords.slice(),
  ...(s.ownHeading ? { ownHeading: true as const } : {}),
}));

export const PAGES: PageSpec[] = [
  { path: ADMIN, label: 'Administration', area: AREA, adminOnly: true, hidden: 'the old tab host: it only forwards each ?tab= address to the section page; the menu pinned at the foot of the sidebar (administrators only) links to the sections',
    keywords: everyName() },
  ...sectionPages(),
  // pages that were once a section of their own and belong to one now (adminSections `paths`)
  { path: `${ADMIN}/cloud-connectors`, label: 'Cloud Connectors', area: AREA, parent: `${ADMIN}/connections`, hidden: 'opens from Connected systems (Cloud security) and from the scanner cards that name a cloud provider' },
  { path: `${ADMIN}/connectors`, label: 'Connectors', area: AREA, parent: `${ADMIN}/connections`, hidden: 'opens from Connected systems (Business tools), from the vendor pages that ask for a connector key (Breach alerts, Security ratings, Settings, a vendor record) and from a vulnerability' },
  { path: `${ADMIN}/usage`, label: 'Usage Monitoring', area: AREA, parent: `${ADMIN}/ai-usage`, hidden: 'no menu entry opens it any more (AI usage is the entry); a typed address still works until the two AI usage pages are one' },
  // a person's AI usage opens from a row of Users
  { path: `${ADMIN}/users/:id/usage`, label: 'User usage', area: AREA, parent: `${ADMIN}/users`, hidden: 'opens from a user row of Users (AI usage)', ownHeading: true },
  // the style guide: an administrator's page that guards itself with navPermissions (an unlisted page is administrators' only)
  { path: `${ADMIN}/ui-kit`, label: 'UI kit', area: AREA, parent: ADMIN, adminOnly: true, hidden: 'no link opens it: reached by a typed address (the design-system style guide)', keywords: ['Style guide', 'Design system'], ownHeading: true },
  // scanner onboarding: reached from Compliance & Scans, the asset pages and each other; the connect wizard and the AD discovery say "locked" without the agents right
  { path: `${ADMIN}/agents`, label: 'Compliance Agents', area: AREA, parent: ADMIN, permissions: ['compliance:agents:manage'], hidden: 'opens from Compliance & Scans (Connect a scanner) and from Bulk Host Discovery', keywords: ['Agents', 'Scanners'] },
  { path: `${ADMIN}/discover`, label: 'Bulk Host Discovery', area: AREA, parent: `${ADMIN}/agents`, permissions: ['compliance:discover:execute', 'compliance:agents:manage'], hidden: 'opens from Compliance Agents (Use Agentless instead) and from its setup wizard' },
  { path: `${ADMIN}/integrations/connect`, label: 'Connect Wizard', area: AREA, parent: `${ADMIN}/agents`, permissions: ['compliance:agents:manage'], hidden: 'opens from Compliance Agents, the asset pages and CIS Benchmark Plugins', keywords: ['Connect a server'] },
  { path: `${ADMIN}/integrations/connect/ad-discover`, label: 'Active Directory discovery', area: AREA, parent: `${ADMIN}/integrations/connect`, permissions: ['compliance:agents:manage'], hidden: 'opens from the Connect Wizard', keywords: ['AD discovery'] },
  // the old Teams page forwards to Departments
  { path: `${ADMIN}/teams`, label: 'Departments', area: AREA, aliasOf: `${ADMIN}/departments` },
  // Users at its own address: the top bar's user menu (Users), for the people who hold the users right and are not administrators (navAccess PAGE_PERMISSIONS)
  { path: '/users', label: 'Users', area: AREA, hidden: 'opens from the user menu in the top bar (Users), for people who hold the users right and are not administrators', keywords: ['User Management', 'People'], ownHeading: true },
];
