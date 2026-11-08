'use client';

// OWASP ASVS on a page that has no assessment id (or one made for an application): a bridge to the requirements lens (components/assessments/lenses). The assessment workspace
// (`/assessments/a/<id>`) draws the same lens. `assessmentId`: the assessment to show; without it the newest uploaded workbook of the format. `allowUpload`: false when the workbook is
// the questionnaire's, not a scoped assessment's.
import { Standalone } from '@/components/assessments/lenses/Standalone';
import { AsvsLens } from '@/components/assessments/lenses/typeLenses';

export default function ASVSAssessmentTab({ assessmentId, allowUpload = true }: { assessmentId?: number; allowUpload?: boolean } = {}) {
  return (
    <Standalone format="asvs_checklist" title="OWASP ASVS" assessmentType="gap_assessment" assessmentId={assessmentId} allowUpload={allowUpload} uploadedOnly>
      {(id, readOnly) => <AsvsLens assessmentId={id} readOnly={readOnly} onChanged={() => undefined} />}
    </Standalone>
  );
}
