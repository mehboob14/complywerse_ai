// Navigation-registry entries of the Issue & Incident Management pages: Issues (/issues/*) and Incidents (/erm/incidents, a page of the ERM folder that the sidebar lists in this group)
// (see navPages/index.ts for the contract). Written by R-REG, 2026-11-01.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

export const LEAVES: Record<string, RouteExtra> = {
  '/issues': { keywords: ['Issue Management', 'CAPA', 'Corrective actions', 'Issue register'] },
  '/erm/incidents': { keywords: ['Risk incidents', 'Incident register', 'Incident log'] },
};

export const PAGES: PageSpec[] = [
  { path: '/issues/:id', label: 'Issue', area: 'issue-incident-management', parent: '/issues', hidden: 'opens from an Issues row, the CAPA board and the records that link an issue (evidence, tasks, vendor findings, the audit register, reports)' },
];
