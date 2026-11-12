// Navigation-registry entries of the Issue Management pages: Issues (/issues/*) (see navPages/index.ts for the contract). Written by R-REG, 2026-11-01.
// The group was "Issue & Incident Management" until Incidents moved to Risk Management > Monitor as Loss Events (ERM redesign, 2026-11-11; navPages/risk.ts).
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

export const LEAVES: Record<string, RouteExtra> = {
  '/issues': { keywords: ['Issue Management', 'CAPA', 'Corrective actions', 'Issue register'] },
};

export const PAGES: PageSpec[] = [
  { path: '/issues/:id', label: 'Issue', area: 'issue-management', parent: '/issues', hidden: 'opens from an Issues row, the CAPA board and the records that link an issue (evidence, tasks, vendor findings, the audit register, reports)' },
];
