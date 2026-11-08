'use client';

// The requests of the Auditor Portal (the front door and the journey page). One hook per request, so a page can say loading, failed (with Retry) and empty for each on
// its own. Reads only: deciding is a mutation of the page that decides (journey page). A failed request is never turned into zeros: the hooks hand back the query.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import apiClient, { certificationsApi } from '@/lib/api';
import { canRetry } from '@/components/ui/ds/reportOutcome';
import type { ObservationMeta, QueuePayload, WorkPayload } from '@/lib/auditorPortal/portalModel';
import type { CertificationJourney } from '@/types';

/** Try a failed read twice more, and only when trying again can come out differently (not for a refusal). */
export const retryRule = (failures: number, error: unknown): boolean => failures < 2 && canRetry(error);

export const portalKeys = {
  work: ['auditor-work'] as const,
  observations: ['auditor-observation-meta'] as const,
  queue: (journeyId: number) => ['auditor-queue', journeyId] as const,
};

/** Every list a decision on a journey can change, for useReportedMutation's `invalidate`: the queue, the front door, and what the Frameworks page reads. */
export const afterDecision = (journeyId: number): ReadonlyArray<readonly unknown[]> => [
  portalKeys.queue(journeyId), portalKeys.work, ['certification', journeyId], ['certification-controls', journeyId], ['certification-progress', journeyId],
  ['applicability'], ['certifications'],
];

export function useWork() {
  return useQuery<WorkPayload, Error>({
    queryKey: portalKeys.work,
    queryFn: async () => (await apiClient.get('/auditor-portal/work', { params: { limit: 20 } })).data as WorkPayload,
    retry: retryRule,
  });
}

/** Statutory Audit's own counts: the front door shows how many observations are open. It is a counter, so its failure is said on that counter only. */
export function useObservationMeta() {
  return useQuery<ObservationMeta, Error>({
    queryKey: portalKeys.observations,
    queryFn: async () => (await apiClient.get('/auditor-portal/statutory-audit/observations/meta')).data as ObservationMeta,
    retry: retryRule,
  });
}

export interface QueueQuery { kind: 'files' | 'scope' | 'untouched' | 'decided'; status?: string; q?: string; skip: number; limit: number }

/** A page of the review queue. The previous page stays on screen while the next one loads (a filter or a page change does not blank the list). */
export function useQueue(journeyId: number, query: QueueQuery, enabled = true) {
  return useQuery<QueuePayload, Error>({
    queryKey: [...portalKeys.queue(journeyId), query],
    queryFn: async () => (await apiClient.get(`/auditor-portal/${journeyId}/review-queue`, {
      params: { kind: query.kind, status: query.status || undefined, q: query.q || undefined, skip: query.skip, limit: query.limit },
    })).data as QueuePayload,
    enabled: enabled && Number.isFinite(journeyId),
    placeholderData: keepPreviousData,
    retry: retryRule,
  });
}

/** The journey itself (name, status, the numbers the Frameworks page reads): the same key and request as that page, so the two share one answer. */
export function useJourney(journeyId: number, enabled = true) {
  return useQuery<CertificationJourney, Error>({
    queryKey: ['certification', journeyId],
    queryFn: async () => (await certificationsApi.getById(journeyId)).data as CertificationJourney,
    enabled: enabled && Number.isFinite(journeyId),
    // a journey that does not exist (404) or that the person may not open (403) is answered once
    retry: retryRule,
  });
}
