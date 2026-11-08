'use client';

// The NCA workspace (the tenant's container: DCC controls and the audit plan): the older tab behind the lens contract. The container is made by POST /compliance/nca/container (NcaEntry), never by a GET.
import NcaTab from '@/components/compliance/NcaTab';
import type { LensProps } from '../lens';
import { useTenantUsers } from './useFacts';

export default function NcaLens({ assessmentId }: LensProps) {
  return <NcaTab assessmentId={assessmentId} tenantUsers={useTenantUsers()} />;
}
