'use client';

// DPIA / PIA on a page that has no assessment id: a bridge to the DPIA lens (components/assessments/lenses).
import { Standalone } from '@/components/assessments/lenses/Standalone';
import DpiaLens from '@/components/assessments/lenses/DpiaLens';

export default function DpiaAssessmentTab() {
  return (
    <Standalone format="dpia_pia" title="DPIA / PIA" assessmentType="privacy">
      {(id, readOnly) => <DpiaLens assessmentId={id} readOnly={readOnly} onChanged={() => undefined} />}
    </Standalone>
  );
}
