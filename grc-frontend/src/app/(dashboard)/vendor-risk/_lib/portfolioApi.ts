// The calls of the portfolio pages (module header and rail, Overview, Register, Findings register): the header's counts, the
// register and its filter options, the findings register, and the people a filter or a roster names.

import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient, vendorOnboardingApi } from '@/lib/api';
import type { Counts } from './portfolioModel';
import type { Person } from './rosterModel';

export const countsKey = ['tprm-portfolio-counts'] as const;
export const unitsKey = ['tprm-portfolio-units'] as const;
/** under 'vendors', so what the old register's pages invalidate after a change (['vendors']) refreshes this one too */
export const registerKey = ['vendors', 'register'] as const;
export const findingsKey = ['tprm-findings'] as const;
export const peopleKey = ['tprm-intake-people'] as const;

/** A row of GET /vendor-risk/vendors as the register shows it (routers/vendors.py: serialize_vendor + register_notes). */
export interface RegisterVendor {
  id: number;
  name: string;
  tier: string | null;
  status: string | null;
  vendor_type: string | null;
  industry: string | null;
  website: string | null;
  inherent_risk_score: number | null;
  residual_risk_score: number | null;
  risk_rating: string | null;
  data_access_level: string | null;
  contract_end_date: string | null;
  contract_value: number | null;
  next_reassessment_date: string | null;
  lifecycle_stage: string | null;
  holds_personal_data: boolean | null;
  data_classification: string | null;
  owner: { id: number; full_name: string; email: string } | null;
  business_unit: { id: number; name: string } | null;
  archived_at: string | null;
  /** engagements still in use, General left out */
  open_engagements?: number;
  /** the one thing to do next, worked out on the server; null when nothing waits */
  next_action?: { code: string; label: string; link: string } | null;
  grade?: string | null;
  grade_score?: number | null;
}

export interface RegisterListing { items: RegisterVendor[]; total: number; skip: number; limit: number }

/** A row of the findings register. The last five are what Verity's register adds (contract C6): an older server sends none. */
export interface FindingRow {
  id: number;
  vendor_id: number;
  vendor_name: string | null;
  assessment_id?: number | null;
  domain: string;
  severity: string;
  title: string | null;
  status: string;
  is_critical_control_fail: boolean;
  due_date: string | null;
  overdue: boolean;
  created_at: string | null;
  owner?: { id: number; name: string | null } | null;
  is_blocking?: boolean;
  source?: string | null;
  accepted_until?: string | null;
  task_id?: number | null;
}

export interface FindingsListing { items: FindingRow[]; total: number; skip: number; limit: number; blocking_total?: number }

type Params = Record<string, unknown>;

export const portfolioApi = {
  counts: () => apiClient.get<Counts>('/vendor-risk/portfolio/counts'),
  units: () => apiClient.get<{ items: Array<{ id: number; name: string }> }>('/vendor-risk/portfolio/units'),
  /** The filters that take several values are sent repeated (tier=a&tier=b): axios would bracket them, and the server would not read that. */
  vendors: (params: Params) => apiClient.get<RegisterListing>('/vendor-risk/vendors', { params, paramsSerializer: { indexes: null } }),
  findings: (params: Params) => apiClient.get<FindingsListing>('/vendor-risk/tpra/findings-register', { params }),
};

/** The header's and the rail's numbers: undefined until they are in, or when they cannot be read. */
export function usePortfolioCounts(): Counts | undefined {
  return useQuery({
    queryKey: countsKey,
    queryFn: async () => (await portfolioApi.counts()).data,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: 1,
  }).data;
}

/** Any change made anywhere in the module may move a count (a request approved, a finding closed): ask again after each one. Mount once. */
export function useRefreshCountsAfterChanges(): void {
  const qc = useQueryClient();
  useEffect(() => qc.getMutationCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'success') qc.invalidateQueries({ queryKey: countsKey });
  }), [qc]);
}

/** Everyone who signs in here (for an owner filter, a roster seat). Shared with the intake form and the action plans. */
export function usePeople(): Person[] {
  return useQuery<Person[]>({
    queryKey: peopleKey,
    queryFn: async () => (await vendorOnboardingApi.people()).data,
    staleTime: 5 * 60_000,
  }).data ?? [];
}
