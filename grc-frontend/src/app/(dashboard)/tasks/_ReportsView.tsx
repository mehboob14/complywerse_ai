'use client';

// The Reports tab of Task Management (and what /tasks/reports forwards to): its content is the Insights view, _insights/Insights.tsx. The export keeps the name the page (page.tsx) imports.
import { Insights } from './_insights/Insights';

export function ReportsView() {
  return <Insights />;
}
