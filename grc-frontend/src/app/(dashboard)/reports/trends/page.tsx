'use client';

// /reports/trends — cross-module KPI trends.
//
// TrendsView and its backend (/reporting/trends/*) both survived the
// canvas-first revamp of /reports; only the mode switcher that mounted it was
// removed, which left a whole working feature unreachable. This is that route.

export const dynamic = 'force-dynamic';

import TrendsView from '../_reports/TrendsView';

export default function ReportsTrendsPage() {
  return (
    <div className="flex min-h-[calc(100dvh-3.5rem)] min-w-0 flex-col overflow-hidden bg-white">
      <TrendsView />
    </div>
  );
}
