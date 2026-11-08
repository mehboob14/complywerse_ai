'use client';

// OWASP Testing on a page that has no assessment id (or one made for an application): a bridge to the requirements lens (components/assessments/lenses).
import { Standalone } from '@/components/assessments/lenses/Standalone';
import { OwaspLens } from '@/components/assessments/lenses/typeLenses';

export default function OwaspTestingTab({ assessmentId, allowUpload = true }: { assessmentId?: number; allowUpload?: boolean } = {}) {
  return (
    <Standalone format="owasp_v4_testing_checklist" title="OWASP Testing" assessmentType="cybersecurity" assessmentId={assessmentId} allowUpload={allowUpload} uploadedOnly>
      {(id, readOnly) => <OwaspLens assessmentId={id} readOnly={readOnly} onChanged={() => undefined} />}
    </Standalone>
  );
}
