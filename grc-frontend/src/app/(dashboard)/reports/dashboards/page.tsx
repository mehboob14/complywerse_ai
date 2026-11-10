'use client';

// /reports/dashboards — saved dashboards built from saved reports (the page itself is _library/dashboards/DashboardsPage). A dashboard is a grid of tiles; each tile is a saved report drawn as a
// number, a chart or its first rows. Clicking a chart category opens that report narrowed to the category, so every number on the page leads to the rows behind it. ?id=<dashboard> opens one.

export const dynamic = 'force-dynamic';

import PermissionGuard from '@/components/ui/PermissionGuard';
import { navPermissions } from '@/components/layout/navAccess';
import { DashboardsPage } from '../_library/dashboards/DashboardsPage';

// opened without Reports > Dashboards: the no-access page
export default function GuardedDashboardsPage() {
  return <PermissionGuard required={navPermissions('/reports/dashboards')}><DashboardsPage /></PermissionGuard>;
}
