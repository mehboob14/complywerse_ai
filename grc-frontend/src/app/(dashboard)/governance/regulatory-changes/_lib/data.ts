'use client';

// The requests Regulatory Changes and the Feed share, each under ONE query key, so the same answer is fetched once (the strip's badge, the Overview and the Feed read the feed counts; the Overview
// and the register read the changes). A failure is an error the page says, never an empty list. The list is the complete load (the old page read the newest 100 and put the dashboard's total over it).
import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import apiClient, { regulatoryApi } from '@/lib/api';
import { canRetry } from '@/components/ui/ds/reportOutcome';
import { feedApi, regulatoryExtra } from './api';
import type { ChangeRow, FeedCounts, FeedItem, FeedSource, MyWorkPayload, Obligation, OverviewPayload, People, RegLink, Task, Assessment } from './types';

export const CHANGES_KEY = ['regulatory-changes', 'all'] as const;
export const OVERVIEW_KEY = ['regulatory-overview'] as const;
export const MY_WORK_KEY = ['regulatory-my-work'] as const;
export const PEOPLE_KEY = ['regulatory-people'] as const;
export const FEED_COUNTS_KEY = ['regulatory-feed-counts'] as const;
export const FEED_SOURCES_KEY = ['regulatory-feed-sources'] as const;
export const FEED_ITEMS_KEY = ['regulatory-feed-items'] as const;
export const LIST_LIMIT = 1000;

/** Keys a change to a change refreshes: the register, the Overview's counters and My work, and the record being looked at. */
export const CHANGE_REFRESH: ReadonlyArray<readonly unknown[]> = [['regulatory-changes'], OVERVIEW_KEY, MY_WORK_KEY, ['regulatory-change']];
/** Keys a change to a feed item refreshes: the counts (the strip's badge too), the items, the Overview's counters and My work. */
export const FEED_REFRESH: ReadonlyArray<readonly unknown[]> = [FEED_COUNTS_KEY, FEED_ITEMS_KEY, FEED_SOURCES_KEY, OVERVIEW_KEY, MY_WORK_KEY];

export const retry = (failures: number, e: unknown) => failures < 3 && canRetry(e);

export interface ChangeList { items: ChangeRow[]; total: number }

export function useChanges() {
  const q = useQuery({
    queryKey: [...CHANGES_KEY],
    queryFn: async (): Promise<ChangeList> => {
      const r = await regulatoryExtra.listChanges(LIST_LIMIT);
      const items = (Array.isArray(r.data) ? r.data : []) as ChangeRow[];
      const said = Number(r.headers?.['x-total-count']);
      return { items, total: Number.isFinite(said) && said >= items.length ? said : items.length };
    },
    retry,
  });
  const rows = useMemo(() => q.data?.items ?? [], [q.data]);
  return { ...q, rows, total: q.data?.total ?? rows.length, cut: !!q.data && q.data.total > q.data.items.length };
}

export const useOverview = () => useQuery({ queryKey: [...OVERVIEW_KEY], queryFn: async () => (await regulatoryExtra.overview()).data as OverviewPayload, retry });
export const useMyWork = () => useQuery({ queryKey: [...MY_WORK_KEY], queryFn: async () => (await regulatoryExtra.myWork()).data as MyWorkPayload, retry });
export const useFeedCounts = () => useQuery({ queryKey: [...FEED_COUNTS_KEY], queryFn: async () => (await feedApi.counts()).data as FeedCounts, retry, staleTime: 30_000 });
export const useFeedSources = () => useQuery({ queryKey: [...FEED_SOURCES_KEY], queryFn: async () => ((await feedApi.sources()).data || []) as FeedSource[], retry });
export const useFeedItems = (status: string, limit = 200, search = '') => useQuery({
  queryKey: [...FEED_ITEMS_KEY, status, limit, search],
  queryFn: async () => ((await feedApi.items({ status: status || undefined, limit, search: search.trim() || undefined })).data || []) as FeedItem[],
  retry,
  placeholderData: keepPreviousData,
});

/** The people and roles the pickers offer. A failure is the query's error: the picker says it, it never offers an empty list as if nobody existed. */
export function usePeople() {
  const q = useQuery({ queryKey: [...PEOPLE_KEY], queryFn: async () => (await regulatoryExtra.people()).data as People, staleTime: 5 * 60 * 1000, retry });
  return useMemo(() => ({
    ...q,
    users: q.data?.users ?? [],
    roles: q.data?.roles ?? [],
    departments: Array.from(new Set((q.data?.users ?? []).map((u) => (u.department || '').trim()).filter(Boolean))).sort(),
  }), [q]);
}

/** The signed-in person's id (null until known, or when it cannot be read). */
export function useMeId(): number | null {
  const q = useQuery({ queryKey: ['current-user-id'], queryFn: async () => ((await apiClient.get('/auth/me')).data?.user?.id ?? null) as number | null, staleTime: 5 * 60 * 1000 });
  return q.data ?? null;
}

// ── one change ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export const useObligations = (changeId: number) => useQuery({
  queryKey: ['regulatory-obligations', changeId],
  queryFn: async () => ((await regulatoryApi.getObligations(changeId)).data?.items || []) as Obligation[],
  retry,
});
export const useLinks = (changeId: number) => useQuery({
  queryKey: ['regulatory-links', changeId],
  queryFn: async () => ((await regulatoryApi.getLinks(changeId)).data?.items || []) as RegLink[],
  retry,
});
export const useTasks = (changeId: number) => useQuery({
  queryKey: ['regulatory-tasks', changeId],
  queryFn: async () => ((await regulatoryApi.getTasks(changeId)).data || []) as Task[],
  retry,
});
export const useAssessments = (changeId: number) => useQuery({
  queryKey: ['regulatory-assessments', changeId],
  queryFn: async () => ((await regulatoryApi.getAssessments(changeId)).data || []) as Assessment[],
  retry,
});
