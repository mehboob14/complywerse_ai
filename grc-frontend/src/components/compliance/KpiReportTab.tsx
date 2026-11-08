'use client';

// The Cyber Security KPI report on a page that has no assessment id: a bridge to the KPI lens (components/assessments/lenses). The lens reads the live values and then asks the server
// to keep today's value (`POST /compliance/assessments/kpi-live/snapshot`): the GET writes nothing.
import { Standalone } from '@/components/assessments/lenses/Standalone';
import KpiLens from '@/components/assessments/lenses/KpiLens';

export default function KpiReportTab() {
  return (
    <Standalone format="kpi_report" title="Cyber Security KPI report" assessmentType="cybersecurity">
      {(id, readOnly) => <KpiLens assessmentId={id} readOnly={readOnly} onChanged={() => undefined} />}
    </Standalone>
  );
}
