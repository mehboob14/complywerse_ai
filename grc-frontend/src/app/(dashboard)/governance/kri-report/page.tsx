'use client';

// Governance → KRI Report.
// Key Risk Indicators only (kind='kri') — early-warning signals of risk exposure,
// RAG-rated against thresholds/appetite. Manual or live-fed from the metric layer.
// KPIs live on the SEPARATE /governance/kpi-report surface; both reuse the ERM KRI
// engine (/erm/kris/*) via the shared kind-parameterised MetricReport component.

import MetricReport from '../_metrics/MetricReport';

export default function KriReportPage() {
  return <MetricReport kind="kri" />;
}
