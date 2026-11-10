// Navigation-registry entries of the Issue & Incident Management pages: Issues (/issues/*) and Incidents (/erm/incidents, a page of the ERM folder that the sidebar lists in this group)
// (see navPages/index.ts for the contract). Written by R-REG, 2026-11-01; the four leaves (Overview, Issues, Corrective actions, Incidents) 2026-11-10.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

export const LEAVES: Record<string, RouteExtra> = {
  // The Overview (a worklist-first cockpit): it draws the kit's page head itself. It was a page of eight tabs; its old addresses forward (issues/_overview/forwards.ts).
  '/issues': { title: 'Issue & Incident Overview', keywords: ['Issue Management', 'CAPA', 'Corrective actions', 'Issue register', 'Closure tracker', 'Issue dashboard'], ownHeading: true },
  // The Enterprise Log + Contract Compliance tabs of /issues became the issue register, the CAPA Actions tab the corrective-action register; both draw the kit's page head from their component.
  '/issues/register': { keywords: ['Issue register', 'Enterprise log', 'Contract compliance', 'Issue log'], ownHeading: true },
  '/issues/actions': { keywords: ['CAPA', 'Corrective and preventive actions', 'Action board'], ownHeading: true },
  '/erm/incidents': { keywords: ['Risk incidents', 'Incident register', 'Incident log'], ownHeading: true },
};

export const PAGES: PageSpec[] = [
  { path: '/issues/settings', label: 'Issue settings', area: 'issue-incident-management', parent: '/issues', hidden: 'opens from the Settings button of the Overview (people who can edit issues) and from the old Severity Matrix and Automation tabs, which forward to it', keywords: ['Severity matrix', 'Issue automation', 'SLA hours', 'Impact and urgency'], ownHeading: true },
  // The record workspace draws the kit's page head with the issue's own title; the top bar then names only the section. It lights the Issues entry (a record of the register).
  { path: '/issues/:id', label: 'Issue', area: 'issue-incident-management', parent: '/issues/register', hidden: 'opens from an Issues row, the corrective-action register and the records that link an issue (evidence, tasks, vendor findings, the audit register, reports)', ownHeading: true },
];
