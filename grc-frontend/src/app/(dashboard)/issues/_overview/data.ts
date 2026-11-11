'use client';

// What the Overview reads. The three lists are the registers' OWN reads under the registers' own keys (so opening a register after the Overview asks for nothing, and a step taken in either
// refreshes both); the scorecard keeps the key the main Dashboard shares. A request that fails THROWS (the old board swallowed it and drew an empty module): every part says so with a Retry.
import { useQuery } from '@tanstack/react-query';
import apiClient, { ermApi, issuesApi } from '@/lib/api';
import { SCORECARD_QUERY_KEYS } from '@/components/dashboard/scorecard-query-keys';
import type { OverviewSection } from '@/components/dashboard/score-kit';
import type { IncidentRow } from '../../erm/_monitoring/incidentModel';
import { retryLoad as retryIssues, useIssueRows } from '../register/_register/issueData';
import { useActionRows } from '../actions/_register/actionData';
import type { Aggregate, Feed, ScorePayload } from './overviewModel';
import type { MatrixCellLike } from './chartModel';

export { useActionRows, useIssueRows };
export const retryLoad = retryIssues;

/** The signed-in person's id, under the key every "Mine" chip uses: unlike `useCurrentUserId` it says when it could not be read, so "all caught up" is never said over a failure. */
export function useMe() {
  return useQuery({
    queryKey: ['current-user-id'],
    queryFn: async () => ((await apiClient.get('/auth/me')).data?.user?.id ?? null) as number | null,
    staleTime: 5 * 60_000,
  });
}

/** The incident register's own read: every incident, newest first. Not asked for by a person who may not read incidents. */
export const INCIDENTS_KEY = ['erm-incidents', 'all'] as const;
export function useIncidentRows(enabled: boolean) {
  return useQuery({
    queryKey: INCIDENTS_KEY,
    queryFn: async () => (await ermApi.incidents.getAll({ limit: 5000 } as never)).data as unknown as IncidentRow[],
    enabled,
    retry: retryIssues,
  });
}

/** The scorecard as the page uses it: the model's reading of it, and the full sections (their metrics and formulas) for the dialog that explains them. */
export type Scorecard = Omit<ScorePayload, 'sections'> & { sections?: Record<string, OverviewSection> };

/** The module's scorecard (GET /issue-management/dashboard/sections-overview): the score, the three sections with their metrics, the target. The key is the main Dashboard's. */
export function useScorecard() {
  return useQuery({
    queryKey: [...SCORECARD_QUERY_KEYS.issues],
    queryFn: async () => (await apiClient.get('/issue-management/dashboard/sections-overview')).data as Scorecard,
    retry: retryIssues,
  });
}

/** "How well issues close": mean time to close, closed on time and reopen rate by severity (GET /dashboard/aggregate). Asked for only while its card is on screen. */
export function useClosing() {
  return useQuery({
    queryKey: ['issues-dashboard'],
    queryFn: async () => (await issuesApi.dashboard()).data as Aggregate,
    retry: retryIssues,
    staleTime: 60_000,
  });
}

/** The tenant's severity matrix (GET /matrices/severity), under the key the Issue settings page reads it with: the zones of the impact-by-urgency card. A card that cannot read it still draws its counts. */
export function useSeverityMatrix() {
  return useQuery({
    queryKey: ['issues-severity-matrix'],
    queryFn: async () => (await issuesApi.matrices.getSeverity()).data as { cells: MatrixCellLike[] },
    staleTime: 60_000,
    retry: retryIssues,
  });
}

/** A query's answer as a feed the model reads: the data when there is some (even if a refresh failed), a failure when there is none, loading otherwise. */
export function feedOf<T>(q: { data: readonly T[] | undefined; isError: boolean }): Feed<T> {
  if (q.data) return { state: 'ready', rows: q.data };
  return { state: q.isError ? 'error' : 'loading', rows: [] };
}
