'use client';

// The lists the monitoring pages pick from, each read once and shared by every page through React Query: the tenant's people, and every risk (the lean list: one small row each,
// GET /erm/monitoring/risks - the older GET /erm/risks stops at the newest 100). A picker is told when its list could not be read (never an empty list passed off as "none").
import { useQuery } from '@tanstack/react-query';
import { apiClient, assetsApi } from '@/lib/api';
import type { RiskRow } from '@/lib/erm/breach';

export interface LeanRisk extends RiskRow {
  risk_category?: string | null;
  closure_status?: string | null;
  inherent_likelihood?: number | null;
  inherent_impact?: number | null;
  residual_likelihood?: number | null;
  residual_impact?: number | null;
  business_unit_id?: number | null;
  business_unit?: string | null;
  updated_at?: string | null;
}

export const RISKS_KEY = ['erm-monitoring-risks'] as const;
export const USERS_KEY = ['erm-monitoring-users'] as const;

export function useLeanRisks(enabled = true) {
  return useQuery({
    queryKey: RISKS_KEY,
    queryFn: async () => (await apiClient.get<{ items: LeanRisk[]; total: number }>('/erm/monitoring/risks')).data,
    enabled,
    staleTime: 60_000,
  });
}

export interface Person { id: number; display_name: string; email?: string }

export function useTenantUsers(enabled = true) {
  return useQuery({
    queryKey: USERS_KEY,
    queryFn: async () => (await assetsApi.getTenantUsers()).data as Person[],
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** The options of a person picker: name first, the email as the second line. */
export const personOptions = (people: readonly Person[] | undefined) =>
  (people ?? []).map((u) => ({ value: String(u.id), label: u.display_name || u.email || `User ${u.id}`, description: u.email }));

/** The options of a risk picker: the title, with the category as the second line. */
export const riskOptions = (risks: readonly LeanRisk[] | undefined) =>
  (risks ?? []).map((r) => ({ value: String(r.id), label: r.title, description: r.risk_category || r.category || undefined }));

/** The signed-in person's id (the "Mine" chips), the same query the Documents library asks; null until it answers or when it cannot. */
export function useCurrentUserId(): number | null {
  const { data } = useQuery({
    queryKey: ['current-user-id'],
    queryFn: async () => ((await apiClient.get('/auth/me')).data?.user?.id ?? null) as number | null,
    staleTime: 5 * 60_000,
  });
  return data ?? null;
}
