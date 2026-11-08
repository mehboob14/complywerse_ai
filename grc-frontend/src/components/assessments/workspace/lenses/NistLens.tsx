'use client';

// NIST SP 800-53A and CSF 2.0: the determinations workbench (objectives, evidence under each artifact) behind the lens contract.
import NistWorkbench from '@/components/compliance/scoping/nist/NistWorkbench';
import type { LensProps } from '../lens';
import { useAssessment } from './useFacts';

export default function NistLens({ assessmentId }: LensProps) {
  const a = useAssessment(assessmentId).data;
  return a ? <NistWorkbench assessmentId={assessmentId} format={a.assessment_format} /> : null;
}
