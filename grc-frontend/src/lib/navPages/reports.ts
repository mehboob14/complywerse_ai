// Navigation-registry entries of the Reports pages (see navPages/index.ts for the contract). Written by R-REG, 2026-11-01; the library and the dashboards (rpt-library) 2026-11-08.
// The Reports area is four pages across one strip (reports/layout.tsx): Reports (the library), Dashboards, Trends and Analytics. The four draw the kit's page head and say so (`ownHeading`): the library, the dashboards, Trends (rpt-trends-analytics, 2026-11-10) and the Analytics launcher.
// The pages navAccess lists with a right of their own (/reports/dashboards, /reports/trends, /reports/print) take it from PAGE_PERMISSIONS; they guard themselves with it. The builder takes the right of /reports.
//
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

const AREA = 'reports';

export const LEAVES: Record<string, RouteExtra> = {
  '/reports/analytics': { ownHeading: true, keywords: ['Cross-module dashboards', 'Metabase', 'Advanced analytics'] },       // the launcher draws the kit head (_analytics/AnalyticsPage)
  '/reports': { ownHeading: true, keywords: ['Report library', 'Report builder', 'Export', 'CSV export'] },
  '/reports/dashboards': { ownHeading: true, keywords: ['Saved dashboards'] },
  '/reports/trends': { ownHeading: true, keywords: ['KPI history', 'Trend board', 'Targets'] },
};

export const PAGES: PageSpec[] = [
  { path: '/reports/builder', label: 'Report builder', area: AREA, parent: '/reports', hidden: 'opens from a row of the Reports library, from New report and from a dashboard tile', keywords: ['Build a report', 'Report editor'] },
  { path: '/reports/saved', label: 'Saved reports', area: AREA, parent: '/reports', hidden: 'an older address of the Reports library: the server forwards it to /reports', keywords: ['Saved exports', 'Quick export'] },
  { path: '/reports/print', label: 'Print report', area: AREA, parent: '/reports', hidden: 'opens in a new window from the report builder and the library (PDF)', keywords: ['Report PDF'] },
];
