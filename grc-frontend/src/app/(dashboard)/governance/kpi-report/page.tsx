'use client';

// Governance → KPI Report.
// Key Performance Indicators only (kind='kpi') — how the programme is performing
// against its targets, period over period. Manual or live-fed from the metric layer.
// KRIs live on the SEPARATE /governance/kri-report surface; both reuse the ERM KRI
// engine (/erm/kris/*) via the shared kind-parameterised MetricReport component.

import MetricReport from '../_metrics/MetricReport';

export default function KpiReportPage() {
  return <MetricReport kind="kpi" />;
}
