'use client';

// OWASP Testing: the older tab behind the lens contract.
import OwaspTestingTab from '@/components/compliance/OwaspTestingTab';
import type { LensProps } from '../lens';
import { useScoped } from './useFacts';

export default function OwaspLens({ assessmentId, readOnly }: LensProps) {
  const scoped = useScoped(assessmentId);
  return <OwaspTestingTab assessmentId={assessmentId} allowUpload={!readOnly && !scoped} />;
}
