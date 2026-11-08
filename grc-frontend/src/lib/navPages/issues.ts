// Navigation-registry entries of the Issue & Incident Management pages: Issues (/issues/*) and Incidents (/erm/incidents, a page of the ERM folder that the sidebar lists in this group)
// (see navPages/index.ts for the contract). Written by R-REG, 2026-11-01.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

export const LEAVES: Record<string, RouteExtra> = {
  '/issues': { keywords: ['Issue Management', 'CAPA', 'Corrective actions', 'Issue register'] },
  '/erm/incidents': { keywords: ['Risk incidents', 'Incident register', 'Incident log'], ownHeading: true },
};

export const PAGES: PageSpec[] = [
  // The Enterprise Log + Contract Compliance tabs of /issues became the issue register, the CAPA Actions tab the corrective-action register; both draw the kit's page head from their component.
  // Until the sidebar lists them as leaves (Overview / Issues / Corrective actions / Incidents) they open from the tabs of /issues, which forward to them.
  { path: '/issues/register', label: 'Issues', area: 'issue-incident-management', parent: '/issues', hidden: 'opens from the Enterprise Log and Contract Compliance tabs of Issues (which forward to it), from the Issues panel of a record and from the Overview', keywords: ['Issue register', 'Enterprise log', 'Contract compliance', 'Issue log'], ownHeading: true },
  { path: '/issues/actions', label: 'Corrective actions', area: 'issue-incident-management', parent: '/issues', hidden: 'opens from the CAPA Actions tab of Issues (which forwards to it) and from the Overview', keywords: ['CAPA', 'Corrective and preventive actions', 'Action board'], ownHeading: true },
  // The record workspace draws the kit's page head with the issue's own title; the top bar then names only the section.
  { path: '/issues/:id', label: 'Issue', area: 'issue-incident-management', parent: '/issues', hidden: 'opens from an Issues row, the corrective-action register and the records that link an issue (evidence, tasks, vendor findings, the audit register, reports)', ownHeading: true },
];
