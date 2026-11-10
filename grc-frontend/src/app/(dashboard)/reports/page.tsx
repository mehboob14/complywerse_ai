'use client';

// /reports — the Reports library: the saved reports (yours and the ones shared with you) as a facet explorer, each one a click from the builder or a download. The builder is /reports/builder;
// the old addresses of this page (?edit=<id>, ?mode=new, a dashboard's drill-through) forward there (_library/libraryAddress.ts legacyTarget). /reports/saved forwards here.
import PermissionGuard from '@/components/ui/PermissionGuard';
import { navPermissions } from '@/components/layout/navAccess';
import { ReportsLibrary } from './_library/ReportsLibrary';

// opened by its URL without the sidebar entry's right: the no-access page
export default function GuardedReportsPage() {
  return <PermissionGuard required={navPermissions('/reports')}><ReportsLibrary /></PermissionGuard>;
}
