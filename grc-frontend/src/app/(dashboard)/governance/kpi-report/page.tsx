'use client';

// Governance → KPI Report.
// Key Performance Indicators only (kind='kpi') — how the programme is performing
// against its targets, period over period. Manual or live-fed from the metric layer.
// KRIs remain under Governance → KRIs (/erm/kris); this page reuses the ERM KRI
// engine (/erm/kris/*) via the shared kind-parameterised MetricReport component.

import MetricReport from '../_metrics/MetricReport';

export default function KpiReportPage() {
  return <MetricReport kind="kpi" />;
}
