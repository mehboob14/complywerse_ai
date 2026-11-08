'use client';

// The requests of the Overview, each under its own key (the overview keeps the key every other page invalidates). Every one loads, fails and has nothing on its own: the page says which one failed, and
// a number whose request failed is never drawn as 0. The control list is the Controls explorer's own request (same key), so opening the Controls page after the Overview needs no second download.
import { useQuery } from '@tanstack/react-query';
import { automationApi, scfApi } from '@/lib/api';
import { canRetry } from '@/components/ui/ds/reportOutcome';
import type { MyWork, Overview } from './overviewModel';

const retry = (failures: number, e: unknown) => failures < 3 && canRetry(e);

export function useOverview() {
  return useQuery({
    queryKey: ['common-overview', 'in_scope'],
    queryFn: async () => (await automationApi.getCommonOverview({ scope: 'in_scope' })).data as Overview,
    retry,
  });
}

/** What waits on the signed-in person (GET /scf/my-work). Waits for the person's id, so a stale answer of another account is never shown. */
export function useMyWork(me: number | null) {
  return useQuery({
    queryKey: ['scf-my-work', me],
    queryFn: async () => (await scfApi.myWork()).data as unknown as MyWork,
    enabled: me != null,
    retry,
  });
}

/** How many mappings still wait for a reviewer: the queue's own `remaining` (one row asked for; the count is the server's). */
export function useReviewQueueCount() {
  return useQuery({
    queryKey: ['mapping-review-queue', 'count'],
    queryFn: async () => ((await automationApi.getMappingReviewQueue({ limit: 1 })).data as { remaining: number }).remaining,
    retry,
  });
}
