'use client';

// The requests behind the Frameworks hub, each under ONE query key (the keys other pages already use, so an answer is asked once): the journeys (shared with the Compliance overview and the
// auditor portal: an array of journeys, as before), the library (the hub's own), the onboarding register (shared with the Onboarding tab and the start gates), and the trend and the recent
// activity (read only when the disclosure that shows them is open). A failed request is an error the page says where its numbers would be, with Retry: never an empty list.
// The journeys and the library are read whole, 100 at a time (the old pages read the first 100 and ignored the library's `total`).
import { useQuery } from '@tanstack/react-query';
import apiClient, { complianceApi } from '@/lib/api';
import { canRetry } from '@/components/ui/ds/reportOutcome';
import { ONBOARDING_KEYS, onboardingApi } from '@/lib/frameworkOnboarding';
import type { JourneyItem, LibraryItem, OnboardingRow } from './hubModel';

export const JOURNEYS_KEY = ['certifications'] as const;
export const LIBRARY_KEY = ['uploaded-frameworks'] as const;
export const REGISTER_KEY = ONBOARDING_KEYS.register;
export const AGGREGATE_KEY = ['compliance-frameworks-aggregate'] as const;

const PAGE = 100;
/** ponytail: a tenant has one active journey per framework, so 1,000 of either is far past any real one; the library says when it is cut (`truncated`). */
const MAX_PAGES = 10;

/** A refusal or a not-found is final; anything else is tried twice more before it is said. */
export const retryRead = (failures: number, error: unknown): boolean => failures < 2 && canRetry(error);

export async function fetchAllJourneys(): Promise<JourneyItem[]> {
  const out: JourneyItem[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = (await apiClient.get('/certifications', { params: { skip: page * PAGE, limit: PAGE } })).data as unknown;
    const got = Array.isArray(data) ? (data as JourneyItem[]) : [];
    out.push(...got);
    if (got.length < PAGE) break;
  }
  return out;
}

export function useJourneys() {
  return useQuery({ queryKey: [...JOURNEYS_KEY], queryFn: fetchAllJourneys, retry: retryRead });
}

export interface LibraryList { items: LibraryItem[]; total: number; truncated: boolean }

export async function fetchLibrary(): Promise<LibraryList> {
  const items: LibraryItem[] = [];
  let total = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = (await apiClient.get('/framework-upload/upload', { params: { skip: page * PAGE, limit: PAGE } })).data as { items?: LibraryItem[]; total?: number };
    const got = Array.isArray(data?.items) ? (data.items as LibraryItem[]) : [];
    items.push(...got);
    total = typeof data?.total === 'number' ? data.total : items.length;
    if (got.length === 0 || items.length >= total) break;
  }
  return { items, total, truncated: items.length < total };
}

export function useLibrary() {
  return useQuery({ queryKey: [...LIBRARY_KEY], queryFn: fetchLibrary, retry: retryRead });
}

export function useRegister() {
  return useQuery({
    queryKey: [...REGISTER_KEY],
    queryFn: onboardingApi.register,                                   // the whole answer: the Onboarding tab and the start gates read this same key and need `meta` too
    select: (r) => r.frameworks as OnboardingRow[],                    // the hub wants the rows; a transformed value must never be what the shared key holds
    retry: retryRead,
    staleTime: 30_000,
  });
}

export interface TrendPoint { label: string; completion: number; readiness: number }

export function useTrend(days: number, enabled: boolean) {
  return useQuery({
    queryKey: ['compliance-trend', days],
    queryFn: async () => ((await complianceApi.dashboard.getComplianceTrend(days)).data as { trend?: TrendPoint[] }).trend ?? [],
    enabled,
    staleTime: 60_000,
    retry: retryRead,
  });
}

export interface ActivityItem { type: string; journey_id: number; framework_name: string; control_code: string | null; control_name: string | null; status: string; when: string }

/** The recent events of every journey. The aggregate's per-journey figures are NOT read (F-readiness): only the events. */
export function useActivity(enabled: boolean) {
  return useQuery({
    queryKey: [...AGGREGATE_KEY],
    queryFn: async () => (await complianceApi.dashboard.getFrameworksAggregate()).data as unknown,
    select: (data) => ((data as { recent_activity?: ActivityItem[] } | null)?.recent_activity ?? []),
    enabled,
    staleTime: 60_000,
    retry: retryRead,
  });
}
