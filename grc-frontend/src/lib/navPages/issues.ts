// Navigation-registry entries of the Issue & Incident Management pages: Issues (/issues/*) and Incidents (/erm/incidents, a page of the ERM folder that the sidebar lists in this group)
// (see navPages/index.ts for the contract). Written by R-REG, 2026-11-01.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

export const LEAVES: Record<string, RouteExtra> = {
  // The Overview (a worklist-first cockpit): it draws the kit's page head itself. It was a page of eight tabs; its old addresses forward (issues/_overview/forwards.ts).
  '/issues': { title: 'Issue & Incident Overview', keywords: ['Issue Management', 'CAPA', 'Corrective actions', 'Issue register', 'Overview', 'Closure tracker', 'Issue dashboard'], ownHeading: true },
  '/erm/incidents': { keywords: ['Risk incidents', 'Incident register', 'Incident log'], ownHeading: true },
};

export const PAGES: PageSpec[] = [
  // The Enterprise Log + Contract Compliance tabs of /issues became the issue register, the CAPA Actions tab the corrective-action register; both draw the kit's page head from their component.
  // Until the sidebar lists them as leaves (Overview / Issues / Corrective actions / Incidents) they open from the tabs of /issues, which forward to them.
  { path: '/issues/register', label: 'Issues', area: 'issue-incident-management', parent: '/issues', hidden: 'opens from the Enterprise Log and Contract Compliance tabs of Issues (which forward to it), from the Issues panel of a record and from the Overview', keywords: ['Issue register', 'Enterprise log', 'Contract compliance', 'Issue log'], ownHeading: true },
  { path: '/issues/actions', label: 'Corrective actions', area: 'issue-incident-management', parent: '/issues', hidden: 'opens from the CAPA Actions tab of Issues (which forwards to it) and from the Overview', keywords: ['CAPA', 'Corrective and preventive actions', 'Action board'], ownHeading: true },
  { path: '/issues/settings', label: 'Issue settings', area: 'issue-incident-management', parent: '/issues', hidden: 'opens from the Settings button of the Overview (people who can edit issues) and from the old Severity Matrix and Automation tabs, which forward to it', keywords: ['Severity matrix', 'Issue automation', 'SLA hours', 'Impact and urgency'], ownHeading: true },
  { path: '/issues/:id', label: 'Issue', area: 'issue-incident-management', parent: '/issues', hidden: 'opens from an Issues row, the CAPA board and the records that link an issue (evidence, tasks, vendor findings, the audit register, reports)' },
];
