'use client';

// /reports/trends — how the key numbers of every module have moved (the page itself is _trends/TrendsPage): a board or a table of figures with a Sheet for each, filtered by status, kept in the address.

export const dynamic = 'force-dynamic';

import PermissionGuard from '@/components/ui/PermissionGuard';
import { navPermissions } from '@/components/layout/navAccess';
import { TrendsPage } from '../_trends/TrendsPage';

// opened by its URL without any of the three reports rights: the no-access page
export default function GuardedTrendsPage() {
  return <PermissionGuard required={navPermissions('/reports/trends')}><TrendsPage /></PermissionGuard>;
}
