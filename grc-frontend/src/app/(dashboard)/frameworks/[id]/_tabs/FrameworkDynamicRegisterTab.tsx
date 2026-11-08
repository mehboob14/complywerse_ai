'use client';

// A register a framework's own definition brings (the 54 shipped in seed_data/framework_templates): its rows keep their values in a `data` object. The
// screen is the shared one (_registers/RegisterView); this reads the rows and hands over the definition. The asset-backed inventories (cardholder data,
// ePHI) never reach here: the Registers tab gives them the inventory screen.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { frameworkTemplatesApi } from '@/lib/api';
import RegisterView from '../_registers/RegisterView';
import { defOfDefinition, rowOfData, type Definition } from '../_registers/registerModel';
import type { TenantUserOption } from './templateConfigs';

export interface DynColumn {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'date' | 'datetime' | 'auto' | string;
  options?: Array<{ value: string; label: string; tone?: string }>;
  picker?: 'users' | 'evidence' | 'framework_controls' | string;
}
export interface DynRegisterConfig {
  type: string;
  label: string;
  description?: string;
  columns: DynColumn[];
  formSections?: Array<{ title: string; keys: string[] }>;
  assetSource?: string;
}
interface DynEntry { id: number; seq: number; is_seed: boolean; data: Record<string, unknown>; risk_register_id?: number | null }

interface Props {
  config: DynRegisterConfig;
  journeyId: number;
  frameworkId: number | null;
  frameworkName: string;
  tenantUsers: TenantUserOption[];
  frameworkControls?: Array<{ code: string; title: string }>;
}

export default function FrameworkDynamicRegisterTab({ config, journeyId, frameworkId, frameworkName, tenantUsers, frameworkControls = [] }: Props) {
  const def = useMemo(() => defOfDefinition(config as Definition), [config]);
  const queryKey = ['ft-register', config.type, journeyId] as const;
  const list = useQuery({
    queryKey,
    queryFn: async () => (await frameworkTemplatesApi.registers.list(config.type, { journey_id: journeyId, framework_id: frameworkId })).data as { entries: DynEntry[] },
    enabled: !!journeyId,
  });
  const rows = useMemo(() => (list.data?.entries ?? []).map(rowOfData), [list.data]);
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
