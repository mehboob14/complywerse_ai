'use client';

// NCA DCC-1:2022 (the Data Cybersecurity Controls Assessment and Compliance Tool workbook) on a page that has no assessment id: a bridge to the requirements lens.
import { Standalone } from '@/components/assessments/lenses/Standalone';
import { DccLens } from '@/components/assessments/lenses/typeLenses';

export default function DccToolTab() {
  return (
    <Standalone format="nca_dcc_tool" title="NCA DCC-1:2022 assessment" assessmentType="gap_assessment">
      {(id, readOnly) => <DccLens assessmentId={id} readOnly={readOnly} onChanged={() => undefined} />}
    </Standalone>
  );
}
