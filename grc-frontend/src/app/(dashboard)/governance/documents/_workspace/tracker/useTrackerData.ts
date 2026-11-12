'use client';

// Every request the Tracker makes, in one place (the views draw what these answer). Nothing here is polled and nothing loads for a closed group or a closed row:
//   useTrackerSets()          ONE answer of ids for the whole library (stuck, held, late, sent back, a proposed change waiting): how the groups are made. Shared by every layout of the page.
//   useTrackerLines(ids)      the compact lines of ONE page of a group (25 documents): who each waits for and since when. One request for a page, cached, asked only when the page is drawn.
//   useDocDetail(doc, open)   one document's workflow, only while its row is open: the sign-off route, the lifecycle, the proposed changes, and, where they apply, the attestation campaigns and
//                             the exceptions. The sign-off and lifecycle answers share their query keys with the document's own page, so opening the page afterwards costs nothing.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { canRetry } from '@/components/ui/ds/reportOutcome';
import {
  campaignsKey, exceptionsKey, fetchCampaigns, fetchExceptions, fetchLifecycle, fetchSignoff, fetchTrackerLines, fetchTrackerSets, lifecycleKey, signoffKey,
  type TrackerLines, type TrackerSets,
} from '@/lib/documentTrackerApi';
import { proposalsApi, proposalsKey } from '@/lib/proposals';
import { attestationOf, type TrackerDoc } from '../libraryTracker';
import type { DetailInput, Part } from './detailModel';

const STALE = 30_000;
const retry = (failures: number, error: unknown) => failures < 2 && canRetry(error);
const refused = (error: unknown): boolean => {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  return status === 403 || status === 404;
};

/** A query as a Part of the detail: loading, could not be read (Retry), not for this person or not on this server (said once, no Retry), or here. */
export function partOf<T>(q: { isError: boolean; data: T | undefined; error: unknown }, wanted = true): Part<T> {
  if (!wanted) return { state: 'off' };
  if (q.data !== undefined) return { state: 'ok', data: q.data };
  if (q.isError) return refused(q.error) ? { state: 'off' } : { state: 'failed' };
  return { state: 'loading' };
}

export function useTrackerSets() {
  return useQuery<TrackerSets>({ queryKey: ['gov-tracker-sets'], queryFn: fetchTrackerSets, staleTime: STALE, retry });
}

export function useTrackerLines(ids: readonly number[]) {
  const key = useMemo(() => ids.join(','), [ids]);
  return useQuery<TrackerLines>({
    queryKey: ['gov-tracker-lines', key],
    queryFn: () => fetchTrackerLines(ids),
    enabled: ids.length > 0,
    staleTime: STALE,
    retry,
  });
}

export type DetailRetry = Record<'signoff' | 'lifecycle' | 'proposals' | 'campaigns' | 'exceptions', () => void>;

/** The parts of a document's detail; asked only while `open`. `campaigns` only for a document with an attestation, `exceptions` only for one under an exception. */
export function useDocDetail(doc: TrackerDoc, open: boolean, lookups: { coverage: Record<number, number> }): { parts: Omit<DetailInput, 'doc' | 'line'>; retry: DetailRetry } {
  const id = doc.id;
  const attests = attestationOf(doc, lookups).state !== 'none';
  const signoff = useQuery({ queryKey: signoffKey(id), queryFn: () => fetchSignoff(id), enabled: open, staleTime: STALE, retry });
  const lifecycle = useQuery({ queryKey: lifecycleKey(id), queryFn: () => fetchLifecycle(id), enabled: open, staleTime: STALE, retry });
  const proposals = useQuery({ queryKey: proposalsKey(id), queryFn: () => proposalsApi.list(id), enabled: open, staleTime: STALE, retry });
  const campaigns = useQuery({ queryKey: campaignsKey(id), queryFn: () => fetchCampaigns(id), enabled: open && attests, staleTime: STALE, retry });
  const exceptions = useQuery({ queryKey: exceptionsKey(id), queryFn: () => fetchExceptions(id), enabled: open && doc.status === 'exception_applied', staleTime: STALE, retry });
  return {
    parts: {
      signoff: partOf(signoff),
      lifecycle: partOf(lifecycle),
      proposals: partOf(proposals),
      campaigns: partOf(campaigns, attests),
      exceptions: partOf(exceptions, doc.status === 'exception_applied'),
    },
    retry: {
      signoff: () => { void signoff.refetch(); }, lifecycle: () => { void lifecycle.refetch(); }, proposals: () => { void proposals.refetch(); },
      campaigns: () => { void campaigns.refetch(); }, exceptions: () => { void exceptions.refetch(); },
    },
  };
}
