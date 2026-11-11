// The requests of the Overview, each with its own state (a failed one is said where its numbers would be, never read as zero). The keys are the ones the other pages of the module
// use for the same data, so a page the person opens next reads the cache instead of asking again: the dashboard (['tprm-dashboard', scope]: the Performance Overview reads it too), the
// Work queue (['tprm-attention', scope, view]), the planned actions (['tprm-actions-all', state, whose]), the policy (['tprm-policy']).
import { useQuery } from '@tanstack/react-query';
import { apiClient, tpraApi, vendorActionsApi, vendorContractsApi } from '@/lib/api';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import { policyApi, policyKey } from '../_lib/policyApi';
import { bandsFrom } from '../_lib/vendorRules';
import type { QueueAnswer } from '../_lib/attentionModel';
import type { Dashboard, Scope } from '../_lib/overviewModel';
import type { ActionLike } from './workModel';
import type { ContractsAnswer, OverviewCharts, PlatformLike, TrendAnswer } from './chartsModel';

export type { TrendAnswer };

export const useDashboard = (scope: Scope) => useQuery({
  queryKey: ['tprm-dashboard', scope],
  queryFn: async () => (await tpraApi.dashboard(scope)).data as Dashboard,
  ...TPRM_QUERY_OPTS,
  placeholderData: (previous: Dashboard | undefined) => previous,        // switching Portfolio / My vendors keeps the page in place; its numbers show as loading until the new scope answers
});

export const useTrend = () => useQuery({
  queryKey: ['tprm-trend'],
  queryFn: async () => (await tpraApi.riskTrend({ scope: 'portfolio', months: 12 })).data as TrendAnswer,
  ...TPRM_QUERY_OPTS,
});

/** The tenant's bands (Setup > Policy). The shipped 75 / 50 / 25 stand in while they load or when the request fails: they only colour a score, and the tenant that never changed them has these. */
export function useBands() {
  const q = useQuery({ queryKey: policyKey, queryFn: async () => (await policyApi.get()).data, ...TPRM_QUERY_OPTS });
  return bandsFrom(q.data);
}

/** The person's own open items of the Work queue. */
export const useMyQueue = () => useQuery({
  queryKey: ['tprm-attention', 'mine', 'open'],
  queryFn: async () => (await tpraApi.attention({ scope: 'mine', view: 'open' })).data as QueueAnswer,
  ...TPRM_QUERY_OPTS,
});

/** The person's own planned actions that are due now. */
export const useMyActions = () => useQuery({
  queryKey: ['tprm-actions-all', 'due', 'mine'],
  queryFn: async () => (await vendorActionsApi.all({ state: 'due', scope: 'mine' })).data as { items: ActionLike[]; counts: { due: number; failed: number } },
  ...TPRM_QUERY_OPTS,
});

// ── the chart cards' own requests: each card loads, fails and has nothing on its own ─────────────────────────────────────────────────────────

/** The aggregates the dashboard does not carry (GET vendor-risk/tpra/overview-charts): tier by residual band, the review calendar, the stages, findings by status and age, signals by month. Scope-aware, like the dashboard. */
export const useCharts = (scope: Scope) => useQuery({
  queryKey: ['tprm-overview-charts', scope],
  queryFn: async () => (await apiClient.get('/vendor-risk/tpra/overview-charts', { params: { scope } })).data as OverviewCharts,
  ...TPRM_QUERY_OPTS,
  placeholderData: (previous: OverviewCharts | undefined) => previous,
});

/** Every supplier contract: the key and the call of the Contracts page, so the page the person opens next reads the cache. */
export const useContracts = () => useQuery<ContractsAnswer>({
  queryKey: ['tprm-contracts'],
  queryFn: async () => (await vendorContractsApi.list()).data,
  ...TPRM_QUERY_OPTS,
});

/** The platforms two or more vendors rely on (the key and the call of the Dependencies page). */
export const useConcentration = () => useQuery({
  queryKey: ['tprm-concentration'],
  queryFn: async () => ((await tpraApi.concentration(2)).data?.platforms ?? []) as PlatformLike[],
  ...TPRM_QUERY_OPTS,
});

/** Who the person is, for "My vendors" on a feed that does not know whose a record is (the key of the findings register). */
export const useMe = () => useQuery({
  queryKey: ['current-user-id'],
  queryFn: async () => ((await apiClient.get('/auth/me')).data?.user?.id ?? null) as number | null,
  staleTime: 5 * 60 * 1000,
});
