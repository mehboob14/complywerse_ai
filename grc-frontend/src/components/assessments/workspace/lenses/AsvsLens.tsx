'use client';

// OWASP ASVS: the older ASVS tab (levels, requirements, evidence) behind the lens contract. The kit version replaces this file's body (assess-lenses).
import ASVSAssessmentTab from '@/components/compliance/ASVSAssessmentTab';
import type { LensProps } from '../lens';
import { useScoped } from './useFacts';

export default function AsvsLens({ assessmentId, readOnly }: LensProps) {
  const scoped = useScoped(assessmentId);
  return <ASVSAssessmentTab assessmentId={assessmentId} allowUpload={!readOnly && !scoped} />;
}
