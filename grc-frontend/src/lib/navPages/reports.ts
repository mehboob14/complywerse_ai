// Navigation-registry entries of the Reports pages (see navPages/index.ts for the contract). Written by R-REG, 2026-11-01.
// The three pages navAccess lists with a right of their own (/reports/dashboards, /reports/trends, /reports/print) take it from PAGE_PERMISSIONS; they guard themselves with it.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

const AREA = 'reports';

export const LEAVES: Record<string, RouteExtra> = {
  '/reports/analytics': { keywords: ['Cross-module dashboards', 'Metabase'] },
  '/reports': { keywords: ['Report builder', 'Export', 'CSV export'] },
  '/reports/saved': { keywords: ['Saved reports'] },
};

export const PAGES: PageSpec[] = [
  { path: '/reports/dashboards', label: 'Dashboards', area: AREA, parent: '/reports', hidden: 'opens from Quick export (the Dashboards link)', keywords: ['Saved dashboards'] },
  { path: '/reports/trends', label: 'Trends', area: AREA, parent: '/reports', hidden: 'opens from Quick export (the Trends link)', keywords: ['KPI history'] },
  { path: '/reports/print', label: 'Print report', area: AREA, parent: '/reports', hidden: 'opens in a new window from the report builder (PDF)', keywords: ['Report PDF'] },
];
