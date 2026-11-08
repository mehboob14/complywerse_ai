'use client';

// ISO 27001's three registers of its own (Gap Analysis, Internal Audit, Risk Treatment): the rows read from fixed columns of the entry. The screen is
// the shared one (_registers/RegisterView); this reads the rows and says which register it is.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { frameworkTemplatesApi } from '@/lib/api';
import RegisterView from '../_registers/RegisterView';
import { defOfIso, rowOfEntry } from '../_registers/registerModel';
import { REGISTER_CONFIGS, type RegisterResponse, type TenantUserOption } from './templateConfigs';

interface Props {
  registerType: 'gap_analysis' | 'internal_audit' | 'risk_treatment';
  journeyId: number;
  frameworkId: number | null;
  frameworkName: string;
  tenantUsers: TenantUserOption[];
  frameworkControls?: Array<{ code: string; title: string }>;
}

export default function FrameworkRegisterTab({ registerType, journeyId, frameworkId, frameworkName, tenantUsers, frameworkControls = [] }: Props) {
  const def = useMemo(() => defOfIso(REGISTER_CONFIGS[registerType]), [registerType]);
  const queryKey = ['ft-register', registerType, journeyId] as const;
  const list = useQuery({
    queryKey,
    queryFn: async () => (await frameworkTemplatesApi.registers.list(registerType, { journey_id: journeyId, framework_id: frameworkId })).data as RegisterResponse,
    enabled: !!journeyId,
  });
  const rows = useMemo(() => (list.data?.entries ?? []).map(rowOfEntry), [list.data]);
  return (
    <RegisterView
      def={def}
      rows={rows}
      loading={list.isLoading}
      error={list.error}
      onRetry={() => { void list.refetch(); }}
      journeyId={journeyId}
      frameworkId={frameworkId}
      frameworkName={frameworkName}
      people={tenantUsers}
      controls={frameworkControls}
      queryKey={queryKey}
    />
  );
}
