// Navigation-registry entries of the Administration pages (/admin/*) and User Management (/users) (see navPages/index.ts for the contract). Written by R-REG, 2026-11-01.
// Administration is the menu pinned at the foot of the rail (components/shell/ModuleIconRail.tsx AdminButton, shown to administrators only), not a leaf of `navigation`, so /admin is a root
// outside the menu. Most of its sections are TABS of the /admin page (?tab=company|users|roles|departments|password-policy|integrations|cloud-connectors|connectors|evidence-collectors|identity|
// workflow|audit): they are not pages, so their names are keywords of /admin; nine of them also exist as pages of their own, which the /admin page mounts as its tab bodies.
// `adminOnly` (inherited from /admin) is the menu's rule; the four pages of the scanner onboarding gate themselves with the agents right instead.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

const AREA = 'administration';
const ADMIN = '/admin';
const TAB = (name: string) => `no link opens it; the Administration page shows the same view as its ${name} tab`;

export const LEAVES: Record<string, RouteExtra> = {};

export const PAGES: PageSpec[] = [
  { path: ADMIN, label: 'Administration', area: AREA, adminOnly: true, hidden: 'opens from the Administration menu pinned at the foot of the sidebar (administrators only)',
    keywords: ['Company', 'Company Profile', 'User Management', 'Role Management', 'Roles', 'Departments', 'Teams', 'Password Policy', 'Integrations', 'Cloud Connectors', 'Connectors', 'Connections', 'Identity Providers', 'SSO', 'Workflow Engine', 'Audit Logs', 'Settings'] },
  // the tabs that are also pages
  { path: `${ADMIN}/organization`, label: 'Company Profile', area: AREA, parent: ADMIN, hidden: TAB('Company') },
  { path: `${ADMIN}/users`, label: 'User Management', area: AREA, parent: ADMIN, hidden: 'opens from the user menu in the top bar (Admin Users); the Administration page shows the same view as its User Management tab', keywords: ['Admin Users'] },
  { path: `${ADMIN}/users/:id/usage`, label: 'User usage', area: AREA, parent: `${ADMIN}/users`, hidden: 'opens from a user row of User Management (Usage)' },
  { path: `${ADMIN}/roles`, label: 'Role Management', area: AREA, parent: ADMIN, hidden: TAB('Role Management') },
  { path: `${ADMIN}/departments`, label: 'Departments', area: AREA, parent: ADMIN, hidden: TAB('Departments') },
  { path: `${ADMIN}/password-policy`, label: 'Password Policy', area: AREA, parent: ADMIN, hidden: TAB('Password Policy') },
  { path: `${ADMIN}/cloud-connectors`, label: 'Cloud Connectors', area: AREA, parent: ADMIN, hidden: TAB('Cloud Connectors') },
  { path: `${ADMIN}/connectors`, label: 'Connectors', area: AREA, parent: ADMIN, hidden: 'opens from the vendor pages that ask for a connector key (Breach alerts, Security ratings, Settings, a vendor record) and from a vulnerability; the Administration page shows the same view as its Connectors tab' },
  { path: `${ADMIN}/evidence-collectors`, label: 'All Connections', area: AREA, parent: ADMIN, hidden: 'opens from the Controls Automation Overview; the Administration page shows the same view as its Connections tab', keywords: ['Evidence collectors', 'Connections'] },
  { path: `${ADMIN}/audit-logs`, label: 'Audit Logs', area: AREA, parent: ADMIN, hidden: TAB('Audit Logs') },
  // the menu's items that are pages of their own
  { path: `${ADMIN}/ai-usage`, label: 'Token usage', area: AREA, parent: ADMIN, hidden: 'opens from the Administration menu (Token usage)', keywords: ['AI usage'] },
  { path: `${ADMIN}/ai-governance`, label: 'AI Governance', area: AREA, parent: ADMIN, hidden: 'opens from the Administration menu (AI Governance)' },
  { path: `${ADMIN}/usage`, label: 'Usage Monitoring', area: AREA, parent: ADMIN, hidden: 'opens from the Administration menu (Usage Monitoring)' },
  { path: `${ADMIN}/scheduler`, label: 'Scheduler', area: AREA, parent: ADMIN, hidden: 'opens from the Administration menu (Scheduler)', keywords: ['Scheduled jobs'] },
  // the style guide: an administrator's page that guards itself with navPermissions (an unlisted page is administrators' only)
  { path: `${ADMIN}/ui-kit`, label: 'UI kit', area: AREA, parent: ADMIN, adminOnly: true, hidden: 'no link opens it: reached by a typed address (the design-system style guide)', keywords: ['Style guide', 'Design system'], ownHeading: true },
  // scanner onboarding: reached from Compliance & Scans, the asset pages and each other; the connect wizard and the AD discovery say "locked" without the agents right
  { path: `${ADMIN}/agents`, label: 'Compliance Agents', area: AREA, parent: ADMIN, permissions: ['compliance:agents:manage'], hidden: 'opens from Compliance & Scans (Connect a scanner) and from Bulk Host Discovery', keywords: ['Agents', 'Scanners'] },
  { path: `${ADMIN}/discover`, label: 'Bulk Host Discovery', area: AREA, parent: `${ADMIN}/agents`, permissions: ['compliance:discover:execute', 'compliance:agents:manage'], hidden: 'opens from Compliance Agents (Use Agentless instead) and from its setup wizard' },
  { path: `${ADMIN}/integrations/connect`, label: 'Connect Wizard', area: AREA, parent: `${ADMIN}/agents`, permissions: ['compliance:agents:manage'], hidden: 'opens from Compliance Agents, the asset pages and CIS Benchmark Plugins', keywords: ['Connect a server'] },
  { path: `${ADMIN}/integrations/connect/ad-discover`, label: 'Active Directory discovery', area: AREA, parent: `${ADMIN}/integrations/connect`, permissions: ['compliance:agents:manage'], hidden: 'opens from the Connect Wizard', keywords: ['AD discovery'] },
  // the old Teams page forwards to the Departments tab
  { path: `${ADMIN}/teams`, label: 'Administration', area: AREA, aliasOf: ADMIN },
  // User Management at its own address: the top bar's user menu (Users), for the people who hold the users right (navAccess PAGE_PERMISSIONS)
  { path: '/users', label: 'User Management', area: AREA, hidden: 'opens from the user menu in the top bar (Users)', keywords: ['Users'] },
];
