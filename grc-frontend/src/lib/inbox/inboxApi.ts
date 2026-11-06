'use client';

// The requests behind Needs my action, and the one hook that turns their answers into the inbox (buildInbox). The top bar's badge and dropdown and the page all call useInbox: the same
// query keys, so the browser asks each endpoint ONCE per interval however many views are mounted. The keys are the legacy ones, so every invalidation that already exists
// (the document page, the sign-off, the life cycle tab: 'my-document-requests'; the assessments pages: 'pending-approvals') keeps reaching them.
//
// Cost (the contract, 2.5): a query is asked again after 60 s of staleness and polled at its own interval (documents and assessments every 60 s, sign-offs every 120 s because the server
// checks the step of every document in review; the sent list is not polled, it is asked while the page is open and when the window gets focus), retried once after one second, and
// given 20 seconds: the client's default is 15 minutes, which would keep the badge "loading" for ever. A failed refresh keeps the last good answer (the source is "stale") and says so.
import { useMemo, useRef } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { statusOf } from '@/components/ui/ds/reportOutcome';
import { BADGE_SOURCES, buildInbox, type Inbox, type SourceId, type SourceInput } from './buildInbox';
import { stateOf } from './sourceState';

export interface SourceRequest {
  /** the legacy query key (kept) */
  key: readonly string[];
  path: string;
  params?: Record<string, string>;
  /** ms between polls; false: not polled */
  pollMs: number | false;
  /** a 404 means this server has no such endpoint (older server): the source is off, not failed */
  missingMeansOff?: boolean;
}

export const SOURCE_REQUESTS: Record<SourceId, SourceRequest> = {
  'doc.lifecycle': { key: ['my-document-requests'], path: '/governance/documents/lifecycle/mine', pollMs: 60_000 },
  'doc.signoff': { key: ['my-signoff-pending'], path: '/governance/documents/signoff/my-pending', pollMs: 120_000 },
  'assessment.evidence': { key: ['header-pending-approvals'], path: '/compliance/assessments/pending-approvals', pollMs: 60_000 },
  'doc.sent': { key: ['my-document-requests-sent'], path: '/governance/documents/lifecycle/sent', pollMs: false, missingMeansOff: true },
};

export const STALE_MS = 60_000;
export const TIMEOUT_MS = 20_000;

export interface UseInboxOptions {
  /** ask at all (the top bar waits for the signed-in person) */
  enabled?: boolean;
  /** also ask for the requests the person sent (the page; the top bar does not) */
  includeSent?: boolean;
}

export interface UseInbox {
  inbox: Inbox;
  /** ask one source (or all) again now */
  refetch: (id?: SourceId) => void;
  /** a source is being asked (the first time or again) */
  fetching: boolean;
  fetchingSource: Partial<Record<SourceId, boolean>>;
}

export function useInbox({ enabled = true, includeSent = false }: UseInboxOptions = {}): UseInbox {
  const ids: SourceId[] = includeSent ? [...BADGE_SOURCES, 'doc.sent'] : BADGE_SOURCES;
  const results = useQueries({
    queries: ids.map((id) => {
      const request = SOURCE_REQUESTS[id];
      return {
        queryKey: request.key,
        queryFn: async ({ signal }: { signal: AbortSignal }) => (await apiClient.get(request.path, { params: request.params, signal, timeout: TIMEOUT_MS })).data as unknown,
        enabled,
        staleTime: STALE_MS,
        refetchInterval: request.pollMs,
        refetchOnWindowFocus: true,
        retry: (count: number, error: unknown) => count < 1 && !(request.missingMeansOff && statusOf(error) === 404),
        retryDelay: 1000,
      };
    }),
  });

  // the answers change identity on every render; what they say changes when the status or an update time does
  const lastError = useRef<Partial<Record<SourceId, string>>>({});
  const signature = results.map((r) => `${r.status}:${r.fetchStatus}:${r.dataUpdatedAt}:${r.errorUpdatedAt}`).join('|') + (includeSent ? '+sent' : '');
  const inbox = useMemo(() => {
    const inputs: SourceInput[] = ids.map((id, i) => {
      const state = stateOf(results[i], { missingMeansOff: SOURCE_REQUESTS[id].missingMeansOff, lastError: lastError.current[id] });
      if (state.state === 'unavailable') lastError.current[id] = state.error;
      else if (state.state === 'ready') delete lastError.current[id];
      return { id, state, raw: results[i].data };
    });
    return buildInbox(inputs, new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `signature` stands for the results
  }, [signature]);

  const client = useQueryClient();
  const refetch = (id?: SourceId) => {
    (id ? [id] : ids).forEach((one) => { void client.invalidateQueries({ queryKey: SOURCE_REQUESTS[one].key }); });
  };
  const fetchingSource: Partial<Record<SourceId, boolean>> = {};
  ids.forEach((id, i) => { fetchingSource[id] = results[i].isFetching; });
  return { inbox, refetch, fetching: results.some((r) => r.isFetching), fetchingSource };
}
