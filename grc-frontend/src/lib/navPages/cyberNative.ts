// Navigation-registry entries of the GRC-native cyber pages: the older copies of the Cybersecurity Assurance pages that sit at the top level of the app (/assets, /asset-discovery, /risk-posture, /vulnerabilities,
// /integrations, /compliance-plugins, /my-runs) and the CIS "Compliance & Scans" overview (see navPages/index.ts for the contract). Written by R-REG, 2026-11-01.
// The sidebar lists the cyber product's pages (/cyber-assurance/..., cyberAssurance.ts) and no longer links these ("stay in the codebase untouched, just no longer linked from here": navAccess.ts);
// they are still pages, and other pages of the app link them (the asset breadcrumb of the top bar, the Frameworks pages, the Risk Register, evidence items, the Reports builder), so they are registered.
// Each is a `duplicateOf` the entry the sidebar uses and hangs under it (so its trail ends at the same leaf, which the sidebar lights for it: navAccess activeMatch). No `ownHeading`: none draws the kit head.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

const IT = 'it-asset';
const CYBER = 'cybersecurity';
const PERF = 'performance-overview';
const NO_LINK = 'no link opens it: reached by a typed or saved address';
const OLDER = (what: string, from: string) => `the older copy of ${what} (the sidebar lists the one under /cyber-assurance); ${from}`;

export const LEAVES: Record<string, RouteExtra> = {};

export const PAGES: PageSpec[] = [
  // ---- IT Asset Discovery, IT Asset Inventory, Assets Risk Posture ----
  { path: '/asset-discovery', label: 'IT Asset Discovery', area: IT, parent: '/cyber-assurance/asset-discovery', duplicateOf: '/cyber-assurance/asset-discovery', hidden: OLDER('IT Asset Discovery', 'still opened from the Connect Wizard of the cloned admin pages and from the Reports builder') },
  { path: '/assets', label: 'IT Asset Inventory', area: IT, parent: '/cyber-assurance/assets', duplicateOf: '/cyber-assurance/assets', hidden: OLDER('IT Asset Inventory', 'still opened from the asset breadcrumb of the top bar, the Frameworks pages, the Performance Overview and the connect wizard') },
  { path: '/assets/:id', label: 'Asset', area: IT, parent: '/assets', duplicateOf: '/cyber-assurance/assets/:id', hidden: OLDER('the asset record', 'still opened from the Risk Register, evidence items, the Frameworks pages and the older cyber pages') },
  { path: '/assets/criticality-assessments', label: 'Criticality Assessments', area: IT, parent: '/assets', duplicateOf: '/cyber-assurance/assets/criticality-assessments', hidden: OLDER('Criticality Assessments', 'opens from an older asset record and from the Reports builder') },
  { path: '/assets/criticality-assessments/analytics', label: 'Criticality Analytics', area: IT, parent: '/assets/criticality-assessments', duplicateOf: '/cyber-assurance/assets/criticality-assessments/analytics', hidden: OLDER('Criticality Analytics', 'opens from the older Criticality Assessments') },
  { path: '/assets/criticality-assessments/:kind/:id/print', label: 'Criticality assessment (print)', area: IT, parent: '/assets/criticality-assessments', duplicateOf: '/cyber-assurance/assets/criticality-assessments/:kind/:id/print', hidden: OLDER('the printable criticality assessment', 'opens from a row of the older Criticality Assessments (Print)') },
  { path: '/risk-posture', label: 'Assets Risk Posture', area: IT, parent: '/cyber-assurance/risk-posture', duplicateOf: '/cyber-assurance/risk-posture', hidden: OLDER('Assets Risk Posture', 'still opened from the Active Directory discovery page and from its own pages') },
  { path: '/risk-posture/asset/:id', label: 'Asset risk posture', area: IT, parent: '/risk-posture', duplicateOf: '/cyber-assurance/risk-posture/asset/:id', hidden: OLDER('the asset risk posture', 'opens from an older asset record') },

  // ---- Vulnerabilities ----
  { path: '/vulnerabilities', label: 'Vulnerabilities', area: CYBER, parent: '/cyber-assurance/vulnerabilities', duplicateOf: '/cyber-assurance/vulnerabilities', hidden: OLDER('Vulnerabilities', 'still opened from an older asset record, the older risk posture page and the CTEM scopes page'), keywords: ['Vulnerability Register'] },
  { path: '/vulnerabilities/:id', label: 'Vulnerability', area: CYBER, parent: '/vulnerabilities', duplicateOf: '/cyber-assurance/vulnerabilities/:id', hidden: OLDER('the finding record', 'opens from the older Vulnerabilities page, asset record and risk posture pages') },
  { path: '/vulnerabilities/dashboard', label: 'Vulnerability Dashboard', area: CYBER, parent: '/vulnerabilities', duplicateOf: '/cyber-assurance/vulnerabilities/dashboard', hidden: OLDER('the Vulnerability Dashboard', 'opens from the older Vulnerabilities workspace (Dashboard)') },
  { path: '/vulnerabilities/choke-points', label: 'Choke points', area: CYBER, parent: '/vulnerabilities', duplicateOf: '/cyber-assurance/vulnerabilities/choke-points', hidden: OLDER('Choke points', 'opens from the older Vulnerabilities workspace') },
  { path: '/vulnerabilities/ctem-scopes', label: 'CTEM Scopes & Cycles', area: CYBER, parent: '/vulnerabilities', duplicateOf: '/cyber-assurance/vulnerabilities/ctem-scopes', hidden: OLDER('CTEM Scopes & Cycles', 'opens from the older Vulnerabilities page') },
  { path: '/vulnerabilities/departments', label: 'Vulnerability Departments', area: CYBER, parent: '/vulnerabilities', duplicateOf: '/cyber-assurance/vulnerabilities/departments', hidden: OLDER('Vulnerability Departments', 'opens from the older Vulnerabilities workspace') },
  { path: '/vulnerabilities/exceptions', label: 'Exception Queue', area: CYBER, parent: '/vulnerabilities', duplicateOf: '/cyber-assurance/vulnerabilities/exceptions', hidden: OLDER('the Exception Queue', NO_LINK) },
  { path: '/vulnerabilities/reports', label: 'Vulnerability Reports', area: CYBER, parent: '/vulnerabilities', duplicateOf: '/cyber-assurance/vulnerabilities/reports', hidden: OLDER('Vulnerability Reports', NO_LINK) },
  { path: '/vulnerabilities/sla', label: 'Remediation days', area: CYBER, parent: '/vulnerabilities', duplicateOf: '/cyber-assurance/vulnerabilities/sla', hidden: OLDER('Remediation days', 'opens from the older Vulnerabilities workspace (Settings)') },
  { path: '/vulnerabilities/nca/:id', label: 'NCA vulnerability entry', area: CYBER, parent: '/vulnerabilities', duplicateOf: '/cyber-assurance/vulnerabilities/nca/:id', hidden: OLDER('the NCA vulnerability entry', NO_LINK) },

  // ---- Scanner integrations (the Administration page mounts /integrations/connections as its Integrations tab) ----
  { path: '/integrations', label: 'Scanner Integration Dashboard', area: CYBER, parent: '/cyber-assurance/integrations', duplicateOf: '/cyber-assurance/integrations', hidden: OLDER('the Scanner Integration Dashboard', NO_LINK) },
  { path: '/integrations/connections', label: 'Scanner Connections', area: CYBER, parent: '/integrations', duplicateOf: '/cyber-assurance/integrations/connections', hidden: OLDER('Scanner Connections', 'opens from the older Scanner Integration Dashboard and the older connect wizard; the Administration page shows the same view as its Integrations tab') },
  { path: '/integrations/exceptions', label: 'Exception Requests', area: CYBER, parent: '/integrations', duplicateOf: '/cyber-assurance/integrations/exceptions', hidden: OLDER('Exception Requests', NO_LINK) },

  // ---- CIS benchmark plugins, rules and runs ----
  { path: '/compliance-plugins', label: 'CIS Benchmark Plugins', area: IT, parent: '/cyber-assurance/compliance-plugins', duplicateOf: '/cyber-assurance/compliance-plugins', hidden: OLDER('CIS Benchmark Plugins', 'opens from the older Asset CIS scans page (its back link)') },
  { path: '/compliance-plugins/:id', label: 'CIS benchmark plugin', area: IT, parent: '/compliance-plugins', duplicateOf: '/cyber-assurance/compliance-plugins/:id', hidden: OLDER('the CIS benchmark plugin', NO_LINK) },
  { path: '/compliance-plugins/asset/:id', label: 'Asset CIS scans', area: IT, parent: '/compliance-plugins', duplicateOf: '/cyber-assurance/compliance-plugins/asset/:id', hidden: OLDER('Asset CIS scans', 'opens from an older asset record (CIS scans) and from the assets panel of CIS Benchmark Plugins') },
  { path: '/compliance-plugins/classify', label: 'AI Rule Pre-Classification', area: IT, parent: '/compliance-plugins', duplicateOf: '/cyber-assurance/compliance-plugins/classify', hidden: OLDER('AI Rule Pre-Classification', NO_LINK) },
  { path: '/compliance-plugins/ingest', label: 'Import CIS Benchmark PDF', area: IT, parent: '/compliance-plugins', duplicateOf: '/cyber-assurance/compliance-plugins/ingest', hidden: OLDER('Import CIS Benchmark PDF', 'opens from an older asset record (its compliance panel, Rules library > Ingest)') },
  { path: '/compliance-plugins/library', label: 'Compliance Rules', area: IT, parent: '/compliance-plugins', duplicateOf: '/cyber-assurance/compliance-plugins/library', hidden: OLDER('Compliance Rules', 'no link opens it; Compliance & Scans shows the same view as its Compliance Rules tab') },
  { path: '/compliance-plugins/os-registry', label: 'OS Knowledge Registry', area: IT, parent: '/compliance-plugins', duplicateOf: '/cyber-assurance/compliance-plugins/os-registry', hidden: OLDER('the OS Knowledge Registry', 'opens from an older asset record (its compliance panel)') },
  { path: '/my-runs', label: 'My runs & team activity', area: PERF, parent: '/cyber-assurance/my-runs', duplicateOf: '/cyber-assurance/my-runs', hidden: OLDER('My runs & team activity', 'opens from the older Compliance Rules page'), keywords: ['My runs', 'Team activity'] },

  // ---- Compliance & Scans: the CIS overview that hosts Compliance Rules, Risk Posture and Scanners as tabs (it has no twin) ----
  { path: '/compliance-overview', label: 'Compliance & Scans', area: PERF, parent: '/cyber-assurance/dashboard', hidden: 'no link opens it: reached by a typed or saved address (the CIS compliance overview of the older asset pages)', keywords: ['CIS compliance overview', 'Compliance Overview (CIS)', 'CIS scans'] },
];
