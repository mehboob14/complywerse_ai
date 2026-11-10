'use client';

// The reads of the Sent tab, the Send sheet and the Shared tab, each under ONE query key: the lean list of everything sent (read whole), one questionnaire opened in the drawer (its answers), the suppliers a
// picker offers and what the exchange holds. A failed read is an error the page says, never an empty list.
import { useQuery } from '@tanstack/react-query';
import { tpraApi } from '@/lib/api';
import { canRetry } from '@/components/ui/ds/reportOutcome';
import { SENT_KEY, SENT_ONE_KEY, SHARED_KEY, VENDOR_OPTIONS_KEY, questionnairesApi } from '../../_lib/questionnairesApi';
import type { SharedRow } from '../../_lib/questionnaires/sharedModel';

const retry = (failures: number, error: unknown): boolean => failures < 2 && canRetry(error);

/** What a send, a new link or a review refreshes: the list, the open questionnaire, and the vendor record's own panels that show the same rows. */
export const SENT_REFRESH: ReadonlyArray<readonly unknown[]> = [[SENT_KEY], [SENT_ONE_KEY], ['questionnaire-responses'], ['tpra-questionnaire-responses'], ['tprm-contacts'], ['tprm-dashboard']];

export function useSent(enabled = true) {
  return useQuery({
    queryKey: [SENT_KEY],
    queryFn: async () => (await questionnairesApi.sent()).data,
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry,
  });
}

/** One questionnaire with its answers, read when its drawer opens (the list carries none). */
export function useSentOne(id: number | null) {
  return useQuery({
    queryKey: [SENT_ONE_KEY, id],
    queryFn: async () => (await questionnairesApi.sentOne(id as number)).data,
    enabled: id != null,
    retry,
  });
}

/** Every supplier in use (or, for the exchange, every one with an active assessment), light: a picker holds all of them, not the first hundred. */
export function useVendorOptions(enabled: boolean, withAssessment = false) {
  return useQuery({
    queryKey: [VENDOR_OPTIONS_KEY, withAssessment],
    queryFn: async () => (await questionnairesApi.vendorOptions({ with_assessment: withAssessment })).data,
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry,
  });
}

export function useShared(enabled = true) {
  return useQuery({
    queryKey: [SHARED_KEY],
    queryFn: async () => ((await tpraApi.listShared()).data as { items: SharedRow[]; total: number }),
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry,
  });
}
