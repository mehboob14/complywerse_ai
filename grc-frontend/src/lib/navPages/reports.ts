// Navigation-registry entries of the Reports pages (see navPages/index.ts for the contract). Written by R-REG, 2026-11-01; the library and the dashboards (rpt-library) 2026-11-08.
// The Reports area is four pages across one strip (reports/layout.tsx): Reports (the library), Dashboards, Trends and Analytics. The four draw the kit's page head and say so (`ownHeading`): the library, the dashboards, Trends (rpt-trends-analytics, 2026-11-10) and the Analytics launcher.
// The pages navAccess lists with a right of their own (/reports/dashboards, /reports/trends, /reports/print) take it from PAGE_PERMISSIONS; they guard themselves with it. The builder takes the right of /reports.
//
// FOR THE PARENT (the sidebar is the parent's, navAccess.ts): when the menu gets its four leaves (Reports = /reports, Dashboards = /reports/dashboards, Trends = /reports/trends,
// Analytics = /reports/analytics) and loses "Saved exports" (/reports/saved), this file changes in step, or the registry tests fail on a duplicate or a missing leaf:
//   LEAVES: remove '/reports/saved'; add '/reports/dashboards': { ownHeading: true, keywords: ['Saved dashboards'] } and '/reports/trends': { ownHeading: true, keywords: ['KPI history', 'Trend board', 'Targets'] }
//   PAGES:  remove the Dashboards and Trends entries; add { path: '/reports/saved', label: 'Saved reports', area: AREA, parent: '/reports', hidden: <the sentence now on the leaf> }
// Until then the entries below describe the menu as it is today.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

const AREA = 'reports';

export const LEAVES: Record<string, RouteExtra> = {
  '/reports/analytics': { ownHeading: true, keywords: ['Cross-module dashboards', 'Metabase', 'Advanced analytics'] },       // the launcher draws the kit head (_analytics/AnalyticsPage)
  '/reports': { ownHeading: true, keywords: ['Report library', 'Report builder', 'Export', 'CSV export'] },
  // still a sidebar leaf ("Saved exports") until the menu loses it; the page is a forward to /reports
  '/reports/saved': { keywords: ['Saved reports'] },
};

export const PAGES: PageSpec[] = [
  { path: '/reports/builder', label: 'Report builder', area: AREA, parent: '/reports', hidden: 'opens from a row of the Reports library, from New report and from a dashboard tile', keywords: ['Build a report', 'Report editor'] },
  { path: '/reports/dashboards', label: 'Dashboards', area: AREA, parent: '/reports', hidden: 'opens from the Dashboards tab across the top of Reports', ownHeading: true, keywords: ['Saved dashboards'] },
  { path: '/reports/trends', label: 'Trends', area: AREA, parent: '/reports', hidden: 'opens from the Trends tab across the top of Reports', ownHeading: true, keywords: ['KPI history', 'Trend board', 'Targets'] },
  { path: '/reports/print', label: 'Print report', area: AREA, parent: '/reports', hidden: 'opens in a new window from the report builder and the library (PDF)', keywords: ['Report PDF'] },
];
