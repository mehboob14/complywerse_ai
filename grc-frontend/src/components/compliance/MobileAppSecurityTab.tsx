'use client';

// Mobile App Security (OWASP MASVS) on a page that has no assessment id (or one made for an application): a bridge to the requirements lens (components/assessments/lenses).
import { Standalone } from '@/components/assessments/lenses/Standalone';
import { MobileLens } from '@/components/assessments/lenses/typeLenses';

export default function MobileAppSecurityTab({ assessmentId, allowUpload = true }: { assessmentId?: number; allowUpload?: boolean } = {}) {
  return (
    <Standalone format="mobile_app_security" title="Mobile App Security" assessmentType="cybersecurity" assessmentId={assessmentId} allowUpload={allowUpload} uploadedOnly>
      {(id, readOnly) => <MobileLens assessmentId={id} readOnly={readOnly} onChanged={() => undefined} />}
    </Standalone>
  );
}
