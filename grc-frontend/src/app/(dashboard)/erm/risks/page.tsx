'use client';

// The Risk Register landing page now renders the dashboard so users
// land on a meaningful overview (per-register breakdowns, source mix,
// status distribution) instead of an immediate flat list.
//
// The original list — including all template-specific tabs (UBL, NCA,
// PCI, etc.), upload flows, and create / edit / close modals — has
// moved verbatim to /erm/risks/list and is still reachable via the
// "View all risks" button on the dashboard or via /erm/risks/list directly.
//
// Single source of truth at dashboard/page.tsx; both URLs render it.

import DashboardPage from './dashboard/page';

export default function RisksRootPage() {
  return <DashboardPage />;
}
