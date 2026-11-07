'use client';

// The requests the Risk Register, the Overview, Reviews and Reports share, each under ONE query key, so the same answer is fetched once (they used to ask `GET /erm/risks` under three keys
// and read the newest 100 of it). The risks are the complete lean load (`?lean=1`, the server's true total); a failure is an error the page says, never an empty list.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import apiClient, { assetsApi, ermApi } from '@/lib/api';
import { canRetry } from '@/components/ui/ds/reportOutcome';
import { appetiteLimits, reviewIndex, type AppetiteConfig, type LeanRisks, type RiskRow } from './riskModel';

export const RISKS_KEY = ['erm-risks-lean'] as const;
export const PENDING_REVIEWS_KEY = ['erm-reviews-pending'] as const;
export const APPETITE_KEY = ['erm-appetite-configs'] as const;
export const ME_KEY = ['current-user-id'] as const;

/** Keys a change to a risk refreshes: the list, the detail, the Overview's figures and the old dashboards' keys. */
export const RISK_REFRESH: ReadonlyArray<readonly unknown[]> = [
  RISKS_KEY, ['erm-risk-detail'], ['erm-sections-overview'], ['erm-risks-dashboard'], ['erm-risks-heatmap'], ['risk-detail'], PENDING_REVIEWS_KEY,
];

const retry = (failures: number, e: unknown) => failures < 3 && canRetry(e);

export function useRisks() {
  return useQuery({
    queryKey: [...RISKS_KEY],
    queryFn: async () => (await ermApi.risks.getLean()).data as unknown as LeanRisks,
    retry,
  });
}

/** The rows of the load, a stable empty list while it has not answered. */
const NONE: RiskRow[] = [];
export function useRiskRows() {
  const q = useRisks();
  const rows = useMemo(() => q.data?.items ?? NONE, [q.data]);
  return { ...q, rows };
}

export interface PendingReview { id: number; risk_id: number; due_date: string; status: string; reviewer_id?: number | null; review_cycle?: string; risk_title?: string | null }

/** The open reviews (pending and in review) of every risk: the review state of a risk and the "reviews due" of a person. */
export function usePendingReviews() {
  const q = useQuery({ queryKey: [...PENDING_REVIEWS_KEY], queryFn: async () => (await ermApi.reviews.getPending()).data as unknown as PendingReview[], retry });
  const index = useMemo(() => reviewIndex(q.data), [q.data]);
  return { ...q, index };
}

export function useAppetite() {
  const q = useQuery({ queryKey: [...APPETITE_KEY], queryFn: async () => (await ermApi.appetite.getAll()).data as unknown as AppetiteConfig[], retry });
  const limits = useMemo(() => appetiteLimits(q.data), [q.data]);
  return { ...q, limits };
}

/** The signed-in person's id (null until known, or when it cannot be read). */
export function useMeId(): number | null {
  const q = useQuery({
    queryKey: [...ME_KEY],
    queryFn: async () => ((await apiClient.get('/auth/me')).data?.user?.id ?? null) as number | null,
    staleTime: 5 * 60 * 1000,
  });
  return q.data ?? null;
}

export function useTenantUsers() {
  return useQuery({
    queryKey: ['tenant-users-erm'],
    queryFn: async () => (await assetsApi.getTenantUsers()).data as Array<{ id: number; display_name: string; email?: string }>,
    staleTime: 5 * 60 * 1000,
  });
}
