'use client';

// The requests behind the Compliance Overview, each under the key other pages already use (so the answer is asked once): the scorecard (shared with the main Dashboard), the evidence
// summary (shared with Evidence Insights), the journeys (shared with the Frameworks pages) and the onboarding register (shared with the Onboarding tab). Nothing here swallows a
// failure into an empty answer: a failed request is an error the page says where its numbers would be, with Retry.
import { useQuery } from '@tanstack/react-query';
import apiClient, { certificationsApi, complianceApi } from '@/lib/api';
import { canRetry } from '@/components/ui/ds/reportOutcome';
import { SCORECARD_QUERY_KEYS } from '@/components/dashboard/scorecard-query-keys';
import { onboardingApi, ONBOARDING_KEYS } from '@/lib/frameworkOnboarding';
import type { OverviewSection } from '@/components/dashboard/score-kit';
import type { EvidenceSummaryLite, JourneyListItem, PerformanceLite, RegisterLite } from './overviewModel';

export interface Scorecard {
  as_of?: string;
  sections?: Record<string, OverviewSection>;
  attention_queue?: Record<string, number>;
  performance?: PerformanceLite & { score: number | null; grade: string | null };
}

/** A refusal or a not-found is final; anything else is tried twice more before it is said. */
export const retryRead = (failures: number, error: unknown): boolean => failures < 2 && canRetry(error);

export function useScorecard() {
  return useQuery({
    queryKey: [...SCORECARD_QUERY_KEYS.compliance],
    queryFn: async () => (await complianceApi.dashboard.getSectionsOverview()).data as Scorecard,
    retry: retryRead,
  });
}

export function useEvidenceSummary() {
  return useQuery({
    queryKey: ['ev-ws-summary'],
    queryFn: async () => (await apiClient.get('/evidence-mgmt/items/dashboard/summary')).data as EvidenceSummaryLite,
    retry: retryRead,
  });
}

export function useJourneys() {
  return useQuery({
    queryKey: ['certifications'],
    queryFn: async () => {
      const d = (await certificationsApi.getAll()).data as unknown;
      if (Array.isArray(d)) return d as JourneyListItem[];
      if (d && typeof d === 'object') {
        const o = d as Record<string, unknown>;
        for (const k of ['items', 'data', 'results', 'certifications'] as const) if (Array.isArray(o[k])) return o[k] as JourneyListItem[];
      }
      return [] as JourneyListItem[];
    },
    retry: retryRead,
  });
}

export function useOnboardingRegister() {
  return useQuery({
    queryKey: [...ONBOARDING_KEYS.register],
    queryFn: async () => (await onboardingApi.register()) as unknown as RegisterLite,
    retry: retryRead,
  });
}
