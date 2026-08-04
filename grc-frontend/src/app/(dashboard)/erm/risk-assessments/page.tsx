'use client';

// The Risk Assessments landing page now renders the dashboard so users
// see real activity counts (manual + framework assessments) the moment
// they click the nav entry. The old list — manual assessments only —
// has moved to /erm/risk-assessments/list and is still reachable via
// the "Manual assessments" button on the dashboard.
//
// Framework assessments (the more commonly used flow) remain at
// /erm/risk-assessments/framework.
//
// Keeping a thin wrapper (rather than duplicating the dashboard's
// 400+ lines) means there's a single source of truth at
// dashboard/page.tsx, and both URLs render the exact same component.

import DashboardPage from './dashboard/page';

export default function RiskAssessmentsRootPage() {
  return <DashboardPage />;
}
