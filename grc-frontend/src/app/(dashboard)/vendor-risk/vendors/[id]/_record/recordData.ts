// The reads the vendor record's shell makes, and WHEN. First paint is four requests (the vendor, its engagements, its offboarding, its contacts); everything else waits for the
// first paint to be on the screen (`useAfterPaint`) or for the person to open a tab, a disclosure or a dialog. Each read keeps the query key its tab already used, so a tab opens
// from the cache the shell filled and an invalidation made anywhere in the record reaches the shell too.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { vendorRiskApi } from '@/lib/api';
import { lifecycleApi } from '../../../_lib/lifecycleApi';
import { portalApi, type SupplierContact } from '../../../_lib/portalApi';
import { findingsApi, vendorFindingsKey } from '../../../_lib/findingsApi';
import { assessmentsApi, cardsKey } from '../../../_lib/assessmentsApi';
import { TPRM_QUERY_OPTS } from '../../../_lib/tprmQuery';
import { openFindingCount, type NextStageLike } from '../../../_lib/recordShellModel';

export type VendorRecord = Record<string, any>;

export const statusOf = (e: unknown): number | undefined => (e as { response?: { status?: number } } | null)?.response?.status;

/** The vendor. A 404 is "not here" and is not retried; any other failure is retried once and then said as a failure (never read as "not found"). */
export function useVendorRecord(vendorId: number) {
  return useQuery({
    queryKey: ['vendor', vendorId],
    queryFn: async () => (await vendorRiskApi.getVendor(vendorId)).data as VendorRecord,
    enabled: !!vendorId,
    retry: (n, e) => statusOf(e) !== 404 && n < 1,
  });
}

/** The supplier's contacts (portal links included): the "At a glance" card lists them, the Assessments tab shares the answer. */
export function useRecordContacts(vendorId: number) {
  return useQuery<SupplierContact[]>({
    queryKey: ['tprm-contacts', vendorId, false],
    queryFn: async () => (await portalApi.contacts(vendorId, false)).data.items,
    ...TPRM_QUERY_OPTS,
  });
}

/** True once the first paint is out (`ready` must be true: the page has what it draws first), so the reads that only decorate the page (a logo, a count, the next step) never compete with it. */
export function useAfterPaint(ready: boolean): boolean {
  const [after, setAfter] = useState(false);
  useEffect(() => {
    if (!ready || after) return undefined;
    const w = window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setAfter(true), { timeout: 800 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(() => setAfter(true), 150);
    return () => window.clearTimeout(id);
  }, [ready, after]);
  return after;
}

/** Who the lifecycle's next step goes to, for the strip. Under the lifecycle's own key, so whatever refreshes the lifecycle refreshes it. */
export function useNextUp(vendorId: number, engagementId: number | null, enabled: boolean) {
  return useQuery<NextStageLike>({
    queryKey: ['tpra-lifecycle', vendorId, 'next-up', engagementId],
    queryFn: async () => (await lifecycleApi.nextStage(vendorId, engagementId)).data,
    enabled,
    ...TPRM_QUERY_OPTS,
  });
}

/** The two numbers of the tab strip, from the lists the Findings and Assessments tabs read themselves (same keys, so opening a tab costs no second request). Nothing is asked until `enabled`;
 *  the cards are not polled from here (the tab does that while a questionnaire is with the vendor). */
export function useTabCounts(vendorId: number, engagementId: number | null, enabled: boolean): { findings: number | null; assessments: number | null } {
  const findings = useQuery({
    queryKey: vendorFindingsKey(vendorId, false),
    queryFn: async () => (await findingsApi.forVendor(vendorId, undefined)).data,
    enabled, staleTime: 15_000, refetchOnWindowFocus: false,
  });
  const cards = useQuery({
    queryKey: cardsKey(vendorId, engagementId),
    queryFn: async () => (await assessmentsApi.cards(vendorId, engagementId)).data,
    enabled, retry: 1, refetchOnWindowFocus: false,
  });
  return { findings: openFindingCount(findings.data?.items), assessments: cards.data ? cards.data.items.length : null };
}
