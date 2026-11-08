'use client';

// The requests the Controls explorer and the Overview share, each under ONE query key, so the same answer is fetched once. The list is the complete load (GET /automation/common/controls
// gives every control of the scope in one answer, 1,534 at most); a failure is an error the page says, never an empty list. The key `['automation-common', scope, 'all']` keeps the prefix
// every other page invalidates (ScopeDialog, the control page).
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import apiClient, { automationApi, certificationsApi, scfApi } from '@/lib/api';
import { canRetry } from '@/components/ui/ds/reportOutcome';
import type { ControlRow } from './controlsModel';

export interface FrameworkRef { key: string; label: string; authored?: boolean }

export interface ControlsResponse {
  controls: ControlRow[];
  categories: string[];
  frameworks: FrameworkRef[];
  frameworks_total?: number;
  framework: string;
  scope_status?: string;
  scope?: { frameworks?: FrameworkRef[]; applicable_count?: number; total_count?: number };
}

export const CONTROLS_KEY = ['automation-common'] as const;
const retry = (failures: number, e: unknown) => failures < 3 && canRetry(e);

export function useControls(scope: 'in_scope' | 'all') {
  return useQuery({
    queryKey: [...CONTROLS_KEY, scope, 'all'],
    queryFn: async () => (await automationApi.listCommonControls({ scope })).data as ControlsResponse,
    placeholderData: keepPreviousData,
    retry,
  });
}

export function useDefaultScope() {
  return useQuery({ queryKey: ['scf-default-scope'], queryFn: async () => (await scfApi.getDefaultScope()).data, staleTime: 60_000, retry });
}

export interface TenantUser { id: number; display_name?: string; email?: string; username?: string }

export function useTenantUsers() {
  return useQuery({
    queryKey: ['tenant-users-ownership'],
    queryFn: async () => (await certificationsApi.getTenantUsers()).data as TenantUser[],
    staleTime: 5 * 60_000,
    retry,
  });
}

/** The signed-in person's id (null until known, or when it cannot be read). */
export function useMeId(): number | null {
  const q = useQuery({
    queryKey: ['current-user-id'],
    queryFn: async () => ((await apiClient.get('/auth/me')).data?.user?.id ?? null) as number | null,
    staleTime: 5 * 60_000,
  });
  return q.data ?? null;
}

export const userName = (u: TenantUser): string => u.display_name || u.username || u.email || 'A person';
