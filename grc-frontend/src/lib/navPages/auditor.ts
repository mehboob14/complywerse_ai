// Navigation-registry entries of the Auditor Portal pages (see navPages/index.ts for the contract). Written by R-REG, 2026-11-01.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

const AREA = 'auditor-portal';

export const LEAVES: Record<string, RouteExtra> = {
  '/auditor-portal': { title: 'Auditor Portal Overview', keywords: ['Certification journeys', 'Audit readiness', 'Review queue', 'Files to review'], ownHeading: true },
  '/auditor-portal/internal-audit': { keywords: ['Internal audits', 'Audit master'], ownHeading: true },
  '/auditor-portal/statutory-audit': { keywords: ['Regulator requirements', 'Audit observations'], ownHeading: true },
  '/auditor-portal/issue-register': { keywords: ['Audit register', 'Audit Services register'] },
};

export const PAGES: PageSpec[] = [
  { path: '/auditor-portal/:frameworkId', label: 'Journey review', area: AREA, parent: '/auditor-portal', hidden: 'opens from a journey or a waiting item of the Portal front door', ownHeading: true },
  { path: '/auditor-portal/statutory-audit/:id', label: 'Audit observation', area: AREA, parent: '/auditor-portal/statutory-audit', hidden: 'opens from a Statutory Audit row, an evidence item and the audit register', ownHeading: true },
  { path: '/auditor-portal/statutory-audit/settings', label: 'Statutory Audit settings', area: AREA, parent: '/auditor-portal/statutory-audit', hidden: 'opens from the Settings button of Statutory Audit', ownHeading: true },
];
