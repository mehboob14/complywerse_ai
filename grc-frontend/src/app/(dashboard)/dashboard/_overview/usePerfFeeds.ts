'use client';

// The requests of the Performance Overview: one per feed an area that is shown reads (lib/perf/moduleFeeds.ts), each under the key its module page uses, so the answer is asked once
// however many pages hold it. A failure is thrown and stays a failure (the old page caught every one into null, which read as "No data yet" and was never retried); a refusal is
// final and says so, anything else is tried once more. Nothing here knows what an answer means: that is moduleFeeds.ts.
import { useEffect, useRef } from 'react';
import { useQueries } from '@tanstack/react-query';
import apiClient, { governanceApi } from '@/lib/api';
import { FEEDS, journeyList, type FeedKey } from '@/lib/perf/moduleFeeds';
import { loadOf, retryDashboard, type Load } from './overviewModel';

export interface FeedState {
  load: Load;
  data?: unknown;
  error?: unknown;
  /** when the answer arrived (ms); 0 before it has */
  updatedAt: number;
  refetch: () => void;
}

export type Feeds = Partial<Record<FeedKey, FeedState>>;

export function usePerfFeeds(keys: readonly FeedKey[], enabled: boolean): Feeds {
  const results = useQueries({
    queries: keys.map((key) => {
      const feed = FEEDS[key];
      return {
        queryKey: feed.queryKey,
        queryFn: async () => {
          const data = (await apiClient.get(feed.path, feed.params ? { params: feed.params } : undefined)).data;
          // the journeys list is shared with the Compliance Overview, which stores it as an array: store the same shape
          return key === 'journeys' ? journeyList(data) : data;
        },
        staleTime: 60_000,
        enabled,
        retry: retryDashboard,
      };
    }),
  });
  // the Governance scorecard GET no longer writes: its trend keeps today's score by one POST per visit, after the first successful read (a failure is silent and costs one trend point)
  const governanceAt = keys.indexOf('governance');
  const governanceOk = governanceAt >= 0 && results[governanceAt].isSuccess;
  const snapshotSent = useRef(false);
  useEffect(() => {
    if (!governanceOk || snapshotSent.current) return;
    snapshotSent.current = true;
    governanceApi.snapshotDocumentsOverview().then(undefined, () => undefined);
  }, [governanceOk]);
  const out: Feeds = {};
  keys.forEach((key, i) => {
    const q = results[i];
    out[key] = { load: loadOf(q), data: q.data ?? undefined, error: q.error, updatedAt: q.dataUpdatedAt, refetch: () => { void q.refetch(); } };
  });
  return out;
}
