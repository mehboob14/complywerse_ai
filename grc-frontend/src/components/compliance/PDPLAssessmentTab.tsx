'use client';

// The Saudi PDPL toolkit on a page that has no assessment id: a bridge to the PDPL lens (components/assessments/lenses): the controls and the action plan of the gaps. The toolkit
// that ships with the app is offered as a way to start.
import { Standalone } from '@/components/assessments/lenses/Standalone';
import PdplLens from '@/components/assessments/lenses/PdplLens';
import PdplPlanLens from '@/components/assessments/lenses/PdplPlanLens';
import { SegmentedControl } from '@/components/ui/ds';
import { useState } from 'react';

const TOOLKIT = { label: 'Start from the built-in toolkit', url: '/reference/PDPL-Assessment-Toolkit.xlsx', fileName: 'PDPL Assessment.xlsx' };

export default function PDPLAssessmentTab() {
  const [view, setView] = useState<'controls' | 'plan'>('controls');
  return (
    <Standalone format="pdpl_assessment_toolkit" title="Saudi PDPL" assessmentType="gap_assessment" starter={TOOLKIT}>
      {(id, readOnly) => (
        <div className="flex flex-col gap-[16px]">
          <SegmentedControl className="self-start" label="View" name="pdpl-view" value={view} onChange={setView} options={[{ value: 'controls', label: 'Controls' }, { value: 'plan', label: 'Action plan' }]} />
          {view === 'controls' ? <PdplLens assessmentId={id} readOnly={readOnly} onChanged={() => undefined} /> : <PdplPlanLens assessmentId={id} readOnly={readOnly} onChanged={() => undefined} />}
        </div>
      )}
    </Standalone>
  );
}
