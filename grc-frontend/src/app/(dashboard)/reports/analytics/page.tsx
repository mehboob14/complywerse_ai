'use client';

// /reports/analytics: a plain launcher for the advanced analytics tool (the page itself is _analytics/AnalyticsPage). The setup text that used to sit here (how to deploy it, the reporting views, mail subscriptions)
// belongs to Administration.

export const dynamic = 'force-dynamic';

import PermissionGuard from '@/components/ui/PermissionGuard';
import { navPermissions } from '@/components/layout/navAccess';
import { AnalyticsPage } from '../_analytics/AnalyticsPage';

// opened by its URL without the sidebar entry's right: the no-access page
export default function GuardedReportsAnalyticsPage() {
  return <PermissionGuard required={navPermissions('/reports/analytics')}><AnalyticsPage /></PermissionGuard>;
}
