// Navigation-registry entries of the Cybersecurity Assurance pages (/cyber-assurance/*): the cloned cyber product ("Ava") rendered on the app's shell (see navPages/index.ts for the contract).
// Written by R-REG, 2026-11-01. Entries only: no file of the module is touched, none draws the kit's page head, so no `ownHeading`.
// The sidebar lists seven of the 54 pages (the leaves below). Ava's other pages are of three kinds:
//   - pages the leaves open (an asset, a vulnerability, the criticality assessments, the CIS plugins of an asset...): they hang under their leaf;
//   - Ava's copies of pages the app has elsewhere (Administration, User Management, ComplyChat): `duplicateOf` names the entry the app uses; Ava's own sidebar listed them and that sidebar is not rendered here;
//   - pages nothing opens from the shell (scanner integrations, My runs): they hang under the nearest leaf.
// The module's pages that no leaf claims hang under Performance, which lights for them (navAccess activeMatch '/cyber-assurance'). The GRC-native older copies of the asset, vulnerability, risk
// posture, discovery and integration pages (/assets, /vulnerabilities, ...) are in cyberNative.ts and name these entries as their `duplicateOf`.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

const AREA = 'cybersecurity-assurance';
const HOME = '/cyber-assurance/dashboard';
const ADMIN = '/cyber-assurance/admin';
const ASSETS = '/cyber-assurance/assets';
const VULNS = '/cyber-assurance/vulnerabilities';
const PLUGINS = '/cyber-assurance/compliance-plugins';
const SCAN = '/cyber-assurance/scan-flows';
const INTEGRATIONS = '/cyber-assurance/integrations';
const NO_MENU = "Ava's own sidebar listed it and that sidebar is not rendered in this app, so no menu opens it";
const ADMIN_COPY = `Ava's copy of an Administration page; ${NO_MENU}`;
const NO_LINK = 'no link opens it: reached by a typed or saved address';

export const LEAVES: Record<string, RouteExtra> = {
  [HOME]: { title: 'Cybersecurity Assurance Performance', keywords: ['Cyber posture', 'Executive cyber posture', 'Cybersecurity Assurance'] },
  '/cyber-assurance/asset-discovery': { keywords: ['Asset discovery', 'Network sweep', 'EASM'] },
  [ASSETS]: { keywords: ['Assets', 'CMDB', 'IT assets'] },
  '/cyber-assurance/risk-posture': { keywords: ['Asset risk posture', 'Risk posture'] },
  [VULNS]: { keywords: ['Vulnerability register', 'Findings', 'CVE'] },
  [SCAN]: { keywords: ['Scanning', 'Scan flows', 'Nessus'] },
  '/cyber-assurance/pentest': { keywords: ['Pentest', 'Penetration test'] },
};

export const PAGES: PageSpec[] = [
  // ---- Assets: the pages the IT Asset Inventory leaf opens ----
  { path: `${ASSETS}/:id`, label: 'Asset', area: AREA, parent: ASSETS, hidden: 'opens from an IT Asset Inventory row and from the pages that link an asset (vulnerabilities, risk posture, criticality assessments, CIS scans)' },
  { path: `${ASSETS}/criticality-assessments`, label: 'Criticality Assessments', area: AREA, parent: ASSETS, hidden: 'opens from an asset record and from IT Asset Inventory' },
  { path: `${ASSETS}/criticality-assessments/analytics`, label: 'Criticality Analytics', area: AREA, parent: `${ASSETS}/criticality-assessments`, hidden: 'opens from Criticality Assessments' },
  { path: `${ASSETS}/criticality-assessments/:kind/:id/print`, label: 'Criticality assessment (print)', area: AREA, parent: `${ASSETS}/criticality-assessments`, hidden: 'opens from a row of Criticality Assessments (Print)' },
  { path: '/cyber-assurance/risk-posture/asset/:id', label: 'Asset risk posture', area: AREA, parent: '/cyber-assurance/risk-posture', hidden: 'opens from an asset record and from a row of Assets Risk Posture' },
  // CIS benchmark plugins: scanned from an asset record ("CIS scans")
  { path: PLUGINS, label: 'CIS Benchmark Plugins', area: AREA, parent: ASSETS, hidden: 'opens from the Asset CIS scans page (its back link)', keywords: ['CIS benchmarks', 'Compliance plugins'] },
  { path: `${PLUGINS}/:id`, label: 'CIS benchmark plugin', area: AREA, parent: PLUGINS, hidden: NO_LINK },
  { path: `${PLUGINS}/asset/:id`, label: 'Asset CIS scans', area: AREA, parent: PLUGINS, hidden: 'opens from an asset record (CIS scans) and from the assets panel of CIS Benchmark Plugins' },
  { path: `${PLUGINS}/classify`, label: 'AI Rule Pre-Classification', area: AREA, parent: PLUGINS, hidden: NO_LINK },
  { path: `${PLUGINS}/ingest`, label: 'Import CIS Benchmark PDF', area: AREA, parent: PLUGINS, hidden: 'opens from an asset record (its compliance panel, Rules library > Ingest)' },
  { path: `${PLUGINS}/library`, label: 'Compliance Rules', area: AREA, parent: PLUGINS, hidden: NO_LINK, keywords: ['CIS rules', 'Rules library'] },
  { path: `${PLUGINS}/os-registry`, label: 'OS Knowledge Registry', area: AREA, parent: PLUGINS, hidden: 'opens from an asset record (its compliance panel)' },

  // ---- Vulnerabilities: the pages the Vulnerabilities leaf opens (its workspace rail and buttons) ----
  { path: `${VULNS}/:id`, label: 'Vulnerability', area: AREA, parent: VULNS, hidden: 'opens from a Vulnerabilities row and from the pages that link a finding (assets, risk posture, the dashboard)' },
  { path: `${VULNS}/dashboard`, label: 'Vulnerability Dashboard', area: AREA, parent: VULNS, hidden: 'opens from the Vulnerabilities workspace (Dashboard)', keywords: ['Security overview'] },
  { path: `${VULNS}/choke-points`, label: 'Choke points', area: AREA, parent: VULNS, hidden: 'opens from the Vulnerabilities workspace (Choke points)' },
  { path: `${VULNS}/ctem-scopes`, label: 'CTEM Scopes & Cycles', area: AREA, parent: VULNS, hidden: 'opens from the Vulnerabilities page and from the CTEM card of Performance', keywords: ['CTEM', 'Exposure management'] },
  { path: `${VULNS}/departments`, label: 'Vulnerability Departments', area: AREA, parent: VULNS, hidden: 'opens from the Vulnerabilities workspace (Departments)', keywords: ['Department Management'] },
  { path: `${VULNS}/exceptions`, label: 'Exception Queue', area: AREA, parent: VULNS, hidden: NO_LINK, keywords: ['Exceptions queue', 'Vulnerability exceptions'] },
  { path: `${VULNS}/reports`, label: 'Vulnerability Reports', area: AREA, parent: VULNS, hidden: NO_LINK },
  { path: `${VULNS}/sla`, label: 'Remediation days', area: AREA, parent: VULNS, hidden: 'opens from the Vulnerabilities workspace (Settings)', keywords: ['SLA Configuration', 'Remediation SLA'] },
  { path: `${VULNS}/nca/:id`, label: 'NCA vulnerability entry', area: AREA, parent: VULNS, hidden: NO_LINK },

  // ---- Vulnerability Scanning: the scan flows and the scanner integrations (Flow 2 mounts the connections page) ----
  { path: `${SCAN}/hosted`, label: 'Hosted scanning', area: AREA, parent: SCAN, hidden: 'opens from Vulnerability Scanning (the hosted flow)', keywords: ['Flow 1', 'Hosted scan'] },
  { path: `${SCAN}/connect`, label: "Client's own Nessus", area: AREA, parent: SCAN, hidden: 'opens from Hosted scanning (Connect your own scanner)', keywords: ['Flow 2', 'Nessus connection'] },
  { path: INTEGRATIONS, label: 'Scanner Integration Dashboard', area: AREA, parent: SCAN, hidden: NO_LINK, keywords: ['Integrations'] },
  { path: `${INTEGRATIONS}/connections`, label: 'Scanner Connections', area: AREA, parent: INTEGRATIONS, hidden: 'opens from the Scanner Integration Dashboard and from the connect wizard', keywords: ['Integration connections'] },
  { path: `${INTEGRATIONS}/exceptions`, label: 'Exception Requests', area: AREA, parent: INTEGRATIONS, hidden: NO_LINK, keywords: ['Integration Exceptions'] },

  // ---- pages nothing opens from the shell: they hang under Performance ----
  { path: '/cyber-assurance/my-runs', label: 'My runs & team activity', area: AREA, parent: HOME, hidden: NO_LINK, keywords: ['My runs', 'Team activity'] },

  // ---- Ava's copies of pages the app has elsewhere ----
  { path: ADMIN, label: 'Administration', area: AREA, parent: HOME, duplicateOf: '/admin', adminOnly: true, hidden: ADMIN_COPY },
  { path: `${ADMIN}/teams`, label: 'Administration', area: AREA, aliasOf: ADMIN },
  { path: `${ADMIN}/organization`, label: 'Company Profile', area: AREA, parent: ADMIN, duplicateOf: '/admin/organization', hidden: ADMIN_COPY },
  { path: `${ADMIN}/users`, label: 'User Management', area: AREA, parent: ADMIN, duplicateOf: '/admin/users', hidden: ADMIN_COPY },
  { path: `${ADMIN}/users/:id/usage`, label: 'User usage', area: AREA, parent: `${ADMIN}/users`, duplicateOf: '/admin/users/:id/usage', hidden: 'opens from a user row of its User Management (Usage)' },
  { path: `${ADMIN}/roles`, label: 'Role Management', area: AREA, parent: ADMIN, duplicateOf: '/admin/roles', hidden: ADMIN_COPY },
  { path: `${ADMIN}/departments`, label: 'Departments', area: AREA, parent: ADMIN, duplicateOf: '/admin/departments', hidden: ADMIN_COPY },
  { path: `${ADMIN}/password-policy`, label: 'Password Policy', area: AREA, parent: ADMIN, duplicateOf: '/admin/password-policy', hidden: ADMIN_COPY },
  { path: `${ADMIN}/cloud-connectors`, label: 'Cloud Connectors', area: AREA, parent: ADMIN, duplicateOf: '/admin/cloud-connectors', hidden: ADMIN_COPY },
  { path: `${ADMIN}/connectors`, label: 'Connectors', area: AREA, parent: ADMIN, duplicateOf: '/admin/connectors', hidden: 'opens from the ITSM panel of a vulnerability; Ava\'s copy of an Administration page' },
  { path: `${ADMIN}/evidence-collectors`, label: 'All Connections', area: AREA, parent: ADMIN, duplicateOf: '/admin/evidence-collectors', hidden: ADMIN_COPY },
  { path: `${ADMIN}/audit-logs`, label: 'Audit Logs', area: AREA, parent: ADMIN, duplicateOf: '/admin/audit-logs', hidden: ADMIN_COPY },
  { path: `${ADMIN}/ai-usage`, label: 'Token usage', area: AREA, parent: ADMIN, duplicateOf: '/admin/ai-usage', hidden: ADMIN_COPY },
  { path: `${ADMIN}/usage`, label: 'Usage Monitoring', area: AREA, parent: ADMIN, duplicateOf: '/admin/usage', hidden: ADMIN_COPY },
  { path: `${ADMIN}/agents`, label: 'Compliance Agents', area: AREA, parent: ADMIN, duplicateOf: '/admin/agents', permissions: ['compliance:agents:manage'], hidden: 'opens from Ava\'s Bulk Host Discovery and from the CIS compliance overview of Ava\'s app; a copy of an Administration page' },
  { path: `${ADMIN}/discover`, label: 'Bulk Host Discovery', area: AREA, parent: `${ADMIN}/agents`, duplicateOf: '/admin/discover', permissions: ['compliance:discover:execute', 'compliance:agents:manage'], hidden: 'opens from Ava\'s Compliance Agents; a copy of an Administration page' },
  { path: `${ADMIN}/integrations/connect`, label: 'Connect Wizard', area: AREA, parent: `${ADMIN}/agents`, duplicateOf: '/admin/integrations/connect', permissions: ['compliance:agents:manage'], hidden: 'opens from Ava\'s Compliance Agents and asset pages; a copy of an Administration page' },
  { path: `${ADMIN}/integrations/connect/ad-discover`, label: 'Active Directory discovery', area: AREA, parent: `${ADMIN}/integrations/connect`, duplicateOf: '/admin/integrations/connect/ad-discover', permissions: ['compliance:agents:manage'], hidden: 'opens from Ava\'s Connect Wizard; a copy of an Administration page' },
  { path: '/cyber-assurance/users', label: 'User Management', area: AREA, parent: HOME, duplicateOf: '/users', hidden: `Ava's copy of User Management; ${NO_MENU}` },
  { path: '/cyber-assurance/complychat', label: 'ComplyChat', area: AREA, parent: HOME, duplicateOf: '/complychat', hidden: `Ava's copy of ComplyChat; ${NO_MENU}` },
];
