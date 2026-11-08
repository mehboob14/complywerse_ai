'use client';

// The cyber maturity tools (CSIR, CTI, Incident Management, IT Security Operations, Digital Operations) on a page that has no assessment id (or one made for a function): a bridge to
// the requirements lens (components/assessments/lenses). One component serves every format through `format`.
import { Standalone } from '@/components/assessments/lenses/Standalone';
import { MaturityLens } from '@/components/assessments/lenses/typeLenses';

const TITLE: Record<string, string> = {
  csir_maturity: 'CSIR Maturity', cti_maturity: 'CTI Maturity', itsecops_maturity: 'IT Security Operations Maturity', incident_maturity: 'Incident Management Maturity', digital_ops_maturity: 'Digital Operations Maturity',
};

export default function MaturityAssessmentTab({ format, assessmentId, allowUpload = true }: { format: string; assessmentId?: number; allowUpload?: boolean }) {
  return (
    <Standalone format={format} title={TITLE[format] ?? 'Cyber maturity'} assessmentType="cybersecurity" assessmentId={assessmentId} allowUpload={allowUpload} uploadedOnly>
      {(id, readOnly) => <MaturityLens assessmentId={id} readOnly={readOnly} onChanged={() => undefined} />}
    </Standalone>
  );
}
