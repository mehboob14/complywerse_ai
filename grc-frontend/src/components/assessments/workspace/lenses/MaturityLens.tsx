'use client';

// The maturity assessments (CSIR, CTI, Incident Management, IT Security Operations, Digital Operations Maturity): the older tab (a 0 to 5 scale per capability) behind the lens contract.
import MaturityAssessmentTab from '@/components/compliance/MaturityAssessmentTab';
import type { LensProps } from '../lens';
import { useAssessment } from './useFacts';

export default function MaturityLens({ assessmentId, readOnly }: LensProps) {
  const a = useAssessment(assessmentId).data;
  if (!a) return null;
  return <MaturityAssessmentTab format={a.assessment_format} assessmentId={assessmentId} allowUpload={!readOnly && !a.scope_model} />;
}
