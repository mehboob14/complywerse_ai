// Navigation-registry entries of the cyber product's pages (/cyber-assurance/*), rendered on the app's shell (see navPages/index.ts for the contract).
// Written by R-REG, 2026-11-01; the sidebar's IT Asset / Cybersecurity / Help Desk groups (and Reports > Cyber Reports) since the cyber sync, 2026-11-02.
// Entries only: no file of the module is touched, none draws the kit's page head, so no `ownHeading`. The sidebar's leaves are read from navAccess; the
// other pages are of four kinds:
//   - pages the leaves open (an asset, a vulnerability, a ticket, a pentest run...): they hang under their leaf;
//   - the product's Performance dashboard (HOME): not in the sidebar, the platform has its own (Performance Overview), so it hangs under that, which
//     lights for it and for the module's pages no leaf claims (navAccess activeMatch '/cyber-assurance');
//   - the product's copies of pages the app has elsewhere (Administration, User Management, ComplyChat, Connectors): `duplicateOf` names the entry
//     the app uses; the product's own sidebar listed them and that sidebar is not rendered here;
//   - pages nothing opens from the shell (scanner integrations, My runs): they hang under the nearest leaf.
// The GRC-native older copies of the asset, vulnerability, risk posture, discovery and integration pages (/assets, /vulnerabilities, ...) are in
// cyberNative.ts and name these entries as their `duplicateOf`.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

const IT = 'it-asset';
const CYBER = 'cybersecurity';
const HD = 'help-desk';
const PERF = 'performance-overview';
const HOME = '/cyber-assurance/dashboard';
const ADMIN = '/cyber-assurance/admin';
const ASSETS = '/cyber-assurance/assets';
const VULNS = '/cyber-assurance/vulnerabilities';
const PLUGINS = '/cyber-assurance/compliance-plugins';
const SCAN = '/cyber-assurance/scan-flows';
const INTEGRATIONS = '/cyber-assurance/integrations';
const ADVISORIES = '/cyber-assurance/advisories';
const PENTEST = '/cyber-assurance/pentest';
const DESK = '/cyber-assurance/helpdesk';
const TICKETS = `${DESK}/tickets`;
const NO_MENU = "the cyber product's own sidebar listed it and that sidebar is not rendered in this app, so no menu opens it";
const ADMIN_COPY = `the cyber product's copy of an Administration page; ${NO_MENU}`;
const NO_LINK = 'no link opens it: reached by a typed or saved address';

export const LEAVES: Record<string, RouteExtra> = {
  '/cyber-assurance/asset-discovery': { keywords: ['Asset discovery', 'Network sweep', 'EASM'] },
  [ASSETS]: { keywords: ['Assets', 'CMDB', 'IT assets'] },
  '/cyber-assurance/licenses': { keywords: ['Software licenses', 'Entitlements'] },
  '/cyber-assurance/risk-posture': { keywords: ['Asset risk posture', 'Risk posture'] },
  [VULNS]: { keywords: ['Vulnerability register', 'Findings', 'CVE'] },
  [ADVISORIES]: { keywords: ['Security advisories', 'CERT bulletins'] },
  [PENTEST]: { keywords: ['Pentest', 'Penetration test'] },
  [TICKETS]: { keywords: ['Help Desk', 'Service desk'] },
};

export const PAGES: PageSpec[] = [
  // ---- the product's Performance dashboard: the platform's Performance Overview stands in the sidebar ----
  { path: HOME, label: 'Cybersecurity Performance', area: PERF, parent: '/dashboard', hidden: "not in the sidebar (the platform's Performance Overview is); opens from the cyber pages' links and their breadcrumbs", keywords: ['Cyber posture', 'Executive cyber posture'] },

  // ---- Assets: the pages the IT Asset Inventory leaf opens ----
  { path: `${ASSETS}/:id`, label: 'Asset', area: IT, parent: ASSETS, hidden: 'opens from an IT Asset Inventory row and from the pages that link an asset (vulnerabilities, risk posture, criticality assessments, CIS scans)' },
  { path: `${ASSETS}/criticality-assessments`, label: 'Criticality Assessments', area: IT, parent: ASSETS, hidden: 'opens from an asset record and from IT Asset Inventory' },
  { path: `${ASSETS}/criticality-assessments/analytics`, label: 'Criticality Analytics', area: IT, parent: `${ASSETS}/criticality-assessments`, hidden: 'opens from Criticality Assessments' },
  { path: `${ASSETS}/criticality-assessments/:kind/:id/print`, label: 'Criticality assessment (print)', area: IT, parent: `${ASSETS}/criticality-assessments`, hidden: 'opens from a row of Criticality Assessments (Print)' },
  { path: '/cyber-assurance/risk-posture/asset/:id', label: 'Asset risk posture', area: IT, parent: '/cyber-assurance/risk-posture', hidden: 'opens from an asset record and from a row of Assets Risk Posture' },
  // CIS benchmark plugins: scanned from an asset record ("CIS scans")
  { path: PLUGINS, label: 'CIS Benchmark Plugins', area: IT, parent: ASSETS, hidden: 'opens from the Asset CIS scans page (its back link)', keywords: ['CIS benchmarks', 'Compliance plugins'] },
  { path: `${PLUGINS}/:id`, label: 'CIS benchmark plugin', area: IT, parent: PLUGINS, hidden: NO_LINK },
  { path: `${PLUGINS}/asset/:id`, label: 'Asset CIS scans', area: IT, parent: PLUGINS, hidden: 'opens from an asset record (CIS scans) and from the assets panel of CIS Benchmark Plugins' },
  { path: `${PLUGINS}/classify`, label: 'AI Rule Pre-Classification', area: IT, parent: PLUGINS, hidden: NO_LINK },
  { path: `${PLUGINS}/ingest`, label: 'Import CIS Benchmark PDF', area: IT, parent: PLUGINS, hidden: 'opens from an asset record (its compliance panel, Rules library > Ingest)' },
  { path: `${PLUGINS}/library`, label: 'Compliance Rules', area: IT, parent: PLUGINS, hidden: NO_LINK, keywords: ['CIS rules', 'Rules library'] },
  { path: `${PLUGINS}/os-registry`, label: 'OS Knowledge Registry', area: IT, parent: PLUGINS, hidden: 'opens from an asset record (its compliance panel)' },

  // ---- Vulnerabilities: the pages the Vulnerabilities leaf opens (its workspace rail and buttons) ----
  { path: `${VULNS}/:id`, label: 'Vulnerability', area: CYBER, parent: VULNS, hidden: 'opens from a Vulnerabilities row and from the pages that link a finding (assets, risk posture, the dashboard)' },
  { path: `${VULNS}/dashboard`, label: 'Vulnerability Dashboard', area: CYBER, parent: VULNS, hidden: 'opens from the Vulnerabilities workspace (Dashboard)', keywords: ['Security overview'] },
  { path: `${VULNS}/choke-points`, label: 'Choke points', area: CYBER, parent: VULNS, hidden: 'opens from the Vulnerabilities workspace (Choke points)' },
  { path: `${VULNS}/ctem-scopes`, label: 'CTEM Scopes & Cycles', area: CYBER, parent: VULNS, hidden: 'opens from the Vulnerabilities page and from the CTEM card of Cybersecurity Performance', keywords: ['CTEM', 'Exposure management'] },
  { path: `${VULNS}/departments`, label: 'Vulnerability Departments', area: CYBER, parent: VULNS, hidden: 'opens from the Vulnerabilities workspace (Departments)', keywords: ['Department Management'] },
  { path: `${VULNS}/exceptions`, label: 'Exception Queue', area: CYBER, parent: VULNS, hidden: NO_LINK, keywords: ['Exceptions queue', 'Vulnerability exceptions'] },
  { path: `${VULNS}/reports`, label: 'Vulnerability Reports', area: CYBER, parent: VULNS, hidden: NO_LINK },
  { path: `${VULNS}/sla`, label: 'Remediation days', area: CYBER, parent: VULNS, hidden: 'opens from the Vulnerabilities workspace (Settings)', keywords: ['SLA Configuration', 'Remediation SLA'] },
  { path: `${VULNS}/nca/:id`, label: 'NCA vulnerability entry', area: CYBER, parent: VULNS, hidden: NO_LINK },

  // ---- Vulnerability Scanning: inside Vulnerabilities (the scan flows and the scanner integrations; Flow 2 mounts the connections page) ----
  { path: SCAN, label: 'Vulnerability Scanning', area: CYBER, parent: VULNS, hidden: 'scanning lives inside Vulnerabilities: opens from its workspace and from the scan card of Cybersecurity Performance', keywords: ['Scanning', 'Scan flows', 'Nessus'] },
  { path: `${SCAN}/hosted`, label: 'Hosted scanning', area: CYBER, parent: SCAN, hidden: 'opens from Vulnerability Scanning (the hosted flow)', keywords: ['Flow 1', 'Hosted scan'] },
  { path: `${SCAN}/connect`, label: "Client's own Nessus", area: CYBER, parent: SCAN, hidden: 'opens from Hosted scanning (Connect your own scanner)', keywords: ['Flow 2', 'Nessus connection'] },
  { path: INTEGRATIONS, label: 'Scanner Integration Dashboard', area: CYBER, parent: SCAN, hidden: NO_LINK, keywords: ['Integrations'] },
  { path: `${INTEGRATIONS}/connections`, label: 'Scanner Connections', area: CYBER, parent: INTEGRATIONS, hidden: 'opens from the Scanner Integration Dashboard and from the connect wizard', keywords: ['Integration connections'] },
  { path: `${INTEGRATIONS}/exceptions`, label: 'Exception Requests', area: CYBER, parent: INTEGRATIONS, hidden: NO_LINK, keywords: ['Integration Exceptions'] },

  // ---- Advisories and AI Pentest: the pages their leaves open ----
  { path: `${ADVISORIES}/:id`, label: 'Advisory', area: CYBER, parent: ADVISORIES, hidden: 'opens from an Advisories row' },
  { path: `${ADVISORIES}/history`, label: 'Advisory match history', area: CYBER, parent: ADVISORIES, hidden: 'opens from Advisories (Match history)' },
  { path: `${ADVISORIES}/new`, label: 'New Advisory', area: CYBER, parent: ADVISORIES, hidden: NO_LINK },
  { path: `${PENTEST}/runs/:id`, label: 'Pentest run', area: CYBER, parent: PENTEST, hidden: 'opens from a run of AI Pentest' },
  // older addresses that forward at run time (to a run with its drill or lens, or to a new run): pages of their own here
  { path: `${PENTEST}/runs`, label: 'New pentest run', area: CYBER, parent: PENTEST, hidden: 'an older address: forwards to AI Pentest with a new run open' },
  { path: `${PENTEST}/run/:runId`, label: 'Pentest run (older address)', area: CYBER, parent: PENTEST, hidden: 'an older address of a pentest run: forwards to the run' },
  { path: `${PENTEST}/run/:runId/asset/:assetId`, label: 'Pentest run asset (older address)', area: CYBER, parent: PENTEST, hidden: "an older address: forwards to the run, drilled to the asset" },
  { path: `${PENTEST}/run/:runId/type/:type`, label: 'Pentest run by type (older address)', area: CYBER, parent: PENTEST, hidden: 'an older address: forwards to the run, on its type lens' },

  // ---- Help Desk: the pages its leaves open (Tickets lights for the desk's pages no other leaf claims) ----
  { path: DESK, label: 'Ticket list', area: HD, parent: TICKETS, hidden: 'the table and board view of the tickets: opens from the Help Desk dashboard, a ticket and the help desk card of Cybersecurity Performance' },
  { path: `${DESK}/:id`, label: 'Ticket detail', area: HD, parent: TICKETS, hidden: 'opens from a row of the ticket list' },
  { path: `${DESK}/home`, label: 'Dashboard', area: HD, aliasOf: `${DESK}/dashboard` },
  { path: `${TICKETS}/:name`, label: 'Ticket', area: HD, parent: TICKETS, hidden: 'opens from a row of Tickets, Incidents, Changes and the CMDB, and from the Help Desk dashboard' },
  { path: `${DESK}/teams`, label: 'Teams', area: HD, parent: `${DESK}/agents`, hidden: 'opens from the Help Desk dashboard (Teams)' },
  { path: `${DESK}/kb/:name`, label: 'Knowledge Base article', area: HD, parent: `${DESK}/kb`, hidden: 'opens from an article of the Knowledge Base' },
  { path: `${DESK}/settings/email`, label: 'Help Desk email', area: HD, parent: `${DESK}/settings`, hidden: NO_LINK, keywords: ['Email accounts', 'Inbound email'] },
  { path: `${DESK}/portal/kb/:name`, label: 'Help article', area: HD, parent: `${DESK}/portal/kb`, hidden: 'opens from an article of Help / Knowledge Base' },
  { path: `${DESK}/portal/my-requests/:id`, label: 'My request', area: HD, parent: `${DESK}/portal/my-requests`, hidden: 'opens from a row of My Requests' },

  // ---- pages nothing opens from the shell: they hang under the product's Performance dashboard ----
  { path: '/cyber-assurance/my-runs', label: 'My runs & team activity', area: PERF, parent: HOME, hidden: NO_LINK, keywords: ['My runs', 'Team activity'] },

  // ---- the product's copies of pages the app has elsewhere: they hang under Performance Overview, which lights for them ----
  { path: '/cyber-assurance/connectors', label: 'Connectors', area: PERF, parent: '/dashboard', duplicateOf: '/admin/connectors', hidden: `the cyber product's copy of Administration > Connectors (which now carries its providers); ${NO_LINK}` },
  { path: ADMIN, label: 'Administration', area: PERF, parent: '/dashboard', duplicateOf: '/admin', adminOnly: true, hidden: ADMIN_COPY },
  { path: `${ADMIN}/teams`, label: 'Administration', area: PERF, aliasOf: ADMIN },
  { path: `${ADMIN}/organization`, label: 'Company Profile', area: PERF, parent: ADMIN, duplicateOf: '/admin/organization', hidden: ADMIN_COPY },
  { path: `${ADMIN}/users`, label: 'User Management', area: PERF, parent: ADMIN, duplicateOf: '/admin/users', hidden: ADMIN_COPY },
  { path: `${ADMIN}/users/:id/usage`, label: 'User usage', area: PERF, parent: `${ADMIN}/users`, duplicateOf: '/admin/users/:id/usage', hidden: 'opens from a user row of its User Management (Usage)' },
  { path: `${ADMIN}/roles`, label: 'Role Management', area: PERF, parent: ADMIN, duplicateOf: '/admin/roles', hidden: ADMIN_COPY },
  { path: `${ADMIN}/departments`, label: 'Departments', area: PERF, parent: ADMIN, duplicateOf: '/admin/departments', hidden: ADMIN_COPY },
  { path: `${ADMIN}/password-policy`, label: 'Password Policy', area: PERF, parent: ADMIN, duplicateOf: '/admin/password-policy', hidden: ADMIN_COPY },
  { path: `${ADMIN}/cloud-connectors`, label: 'Cloud Connectors', area: PERF, parent: ADMIN, duplicateOf: '/admin/cloud-connectors', hidden: ADMIN_COPY },
  { path: `${ADMIN}/connectors`, label: 'Connectors', area: PERF, parent: ADMIN, duplicateOf: '/admin/connectors', hidden: "opens from the ITSM panel of a vulnerability; the cyber product's copy of an Administration page" },
  { path: `${ADMIN}/audit-logs`, label: 'Audit Logs', area: PERF, parent: ADMIN, duplicateOf: '/admin/audit-logs', hidden: ADMIN_COPY },
  { path: `${ADMIN}/ai-usage`, label: 'Token usage', area: PERF, parent: ADMIN, duplicateOf: '/admin/ai-usage', hidden: ADMIN_COPY },
  { path: `${ADMIN}/usage`, label: 'Usage Monitoring', area: PERF, parent: ADMIN, duplicateOf: '/admin/usage', hidden: ADMIN_COPY },
  { path: `${ADMIN}/agents`, label: 'Compliance Agents', area: PERF, parent: ADMIN, duplicateOf: '/admin/agents', permissions: ['compliance:agents:manage'], hidden: "opens from the cyber product's Bulk Host Discovery and from its CIS compliance overview; a copy of an Administration page" },
  { path: `${ADMIN}/discover`, label: 'Bulk Host Discovery', area: PERF, parent: `${ADMIN}/agents`, duplicateOf: '/admin/discover', permissions: ['compliance:discover:execute', 'compliance:agents:manage'], hidden: "opens from the cyber product's Compliance Agents; a copy of an Administration page" },
  { path: `${ADMIN}/integrations/connect`, label: 'Connect Wizard', area: PERF, parent: `${ADMIN}/agents`, duplicateOf: '/admin/integrations/connect', permissions: ['compliance:agents:manage'], hidden: "opens from the cyber product's Compliance Agents and asset pages; a copy of an Administration page" },
  { path: `${ADMIN}/integrations/connect/ad-discover`, label: 'Active Directory discovery', area: PERF, parent: `${ADMIN}/integrations/connect`, duplicateOf: '/admin/integrations/connect/ad-discover', permissions: ['compliance:agents:manage'], hidden: "opens from the cyber product's Connect Wizard; a copy of an Administration page" },
  { path: '/cyber-assurance/users', label: 'User Management', area: PERF, parent: '/dashboard', duplicateOf: '/users', hidden: `the cyber product's copy of User Management; ${NO_MENU}` },
  { path: '/cyber-assurance/complychat', label: 'ComplyChat', area: PERF, parent: '/dashboard', duplicateOf: '/complychat', hidden: `the cyber product's copy of ComplyChat; ${NO_MENU}` },
];
