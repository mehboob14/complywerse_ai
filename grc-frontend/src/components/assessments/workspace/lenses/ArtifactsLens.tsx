'use client';

// Artifacts: the catalogue of documents an assessment's controls are proved with, and the person's own: the older tab behind the lens contract.
import ArtifactsTab from '@/components/compliance/ArtifactsTab';
import type { LensProps } from '../lens';
import { useAssessment, useTenantUsers } from './useFacts';

export default function ArtifactsLens({ assessmentId }: LensProps) {
  const a = useAssessment(assessmentId).data;
  const users = useTenantUsers();
  return a ? <ArtifactsTab assessmentId={assessmentId} assessmentType={a.assessment_type} tenantId={a.tenant_id} tenantUsers={users} /> : null;
}
