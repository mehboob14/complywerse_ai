'use client';

// The requests the Business Continuity registers and the Overview share, each under ONE query key so the same answer is asked once: the lean, complete lists (every plan, drill and
// finding, with the server's true total), the dashboard, the person's own id (for "Mine"), the finding threshold and the evidence a drill's result can point to. The keys are prefixes
// of the keys the pages' writes already refreshed (['bcm-plans'], ['bcm-drills'], ['bcm-dashboard']), so a change anywhere refreshes every list that shows it. A failed request is an
// error the page says, with Retry, never an empty list. (lib/api.ts is not edited: the endpoints this adds are asked here.)
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { asLean, retryRead, type Dashboard, type DrillRow, type FindingRow, type LeanPage, type OptionRow, type PlanRow } from './bcmModel';

/** The most rows one lean request returns (the server clamps to the same number and says `truncated` when more match). */
export const LEAN_LIMIT = 5000;
export const PLANS_KEY = ['bcm-plans', 'lean'] as const;
export const DRILLS_KEY = ['bcm-drills', 'lean'] as const;
export const FINDINGS_KEY = ['bcm-findings'] as const;
export const DASHBOARD_KEY = ['bcm-dashboard'] as const;
export const SETTINGS_KEY = ['bcm-settings'] as const;
/** What a change to a plan, a drill or a finding refreshes: every list and the Overview. */
export const REFRESH_ALL: ReadonlyArray<readonly unknown[]> = [['bcm-plans'], ['bcm-drills'], FINDINGS_KEY, DASHBOARD_KEY];

const RETRY_AFTER = 800;

async function fetchLean<T>(path: string, params: Record<string, unknown>): Promise<LeanPage<T>> {
  const answer = asLean<T>((await apiClient.get(path, { params })).data);
  if (!answer) throw new Error('The server answered in a form this page cannot read.');
  return answer;
}

/** A register's rows as the explorer takes them. */
function asRegister<T>(q: { data?: LeanPage<T>; isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }) {
  return { rows: q.data?.items, total: q.data?.total, truncated: q.data?.truncated, isPending: q.isPending, isError: q.isError, error: q.error, refetch: q.refetch };
}

export function usePlansRegister() {
  return asRegister(useQuery({ queryKey: [...PLANS_KEY], queryFn: () => fetchLean<PlanRow>('/bcm/plans', { lean: 1, limit: LEAN_LIMIT }), retry: retryRead, retryDelay: RETRY_AFTER }));
}
export function useDrillsRegister() {
  return asRegister(useQuery({ queryKey: [...DRILLS_KEY], queryFn: () => fetchLean<DrillRow>('/bcm/drills', { lean: 1, limit: LEAN_LIMIT }), retry: retryRead, retryDelay: RETRY_AFTER }));
}
export function useFindingsRegister() {
  return asRegister(useQuery({ queryKey: [...FINDINGS_KEY], queryFn: () => fetchLean<FindingRow>('/bcm/findings', { limit: LEAN_LIMIT }), retry: retryRead, retryDelay: RETRY_AFTER }));
}

export function useDashboard() {
  return useQuery<Dashboard>({
    queryKey: [...DASHBOARD_KEY],
    queryFn: async () => (await apiClient.get('/bcm/dashboard')).data as Dashboard,
    refetchInterval: 60_000,
    retry: retryRead,
  });
}

/** The signed-in person's id (null until known, or when it cannot be read: "Mine" is then empty and says so). Same key as Evidence's, so it is asked once. */
export function useMeId(): number | null {
  const q = useQuery({
    queryKey: ['current-user-id'],
    queryFn: async () => ((await apiClient.get('/auth/me')).data?.user?.id ?? null) as number | null,
    staleTime: 5 * 60 * 1000,
  });
  return q.data ?? null;
}

/** The severity from which a finding opens an issue by itself (a tenant setting; read for the words under the Add finding form). */
export function useIssueThreshold(enabled = true) {
  return useQuery({
    queryKey: [...SETTINGS_KEY],
    queryFn: async () => ((await apiClient.get('/bcm/settings')).data?.finding_issue_threshold ?? 'high') as string,
    enabled,
    staleTime: 60_000,
    retry: retryRead,
  });
}

/** The evidence a drill's result can point to (the picker route, so a BCM user needs no Evidence right). */
export function useEvidenceOptions(search: string, enabled: boolean) {
  return useQuery({
    queryKey: ['bcm-options', 'evidence', search],
    queryFn: async () => ((await apiClient.get('/bcm/evidence-options', { params: { search: search || undefined } })).data.items ?? []) as OptionRow[],
    enabled,
    staleTime: 30_000,
    retry: retryRead,
  });
}
