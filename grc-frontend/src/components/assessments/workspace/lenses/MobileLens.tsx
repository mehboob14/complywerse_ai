'use client';

// Mobile App Security: the older tab behind the lens contract.
import MobileAppSecurityTab from '@/components/compliance/MobileAppSecurityTab';
import type { LensProps } from '../lens';
import { useScoped } from './useFacts';

export default function MobileLens({ assessmentId, readOnly }: LensProps) {
  const scoped = useScoped(assessmentId);
  return <MobileAppSecurityTab assessmentId={assessmentId} allowUpload={!readOnly && !scoped} />;
}
