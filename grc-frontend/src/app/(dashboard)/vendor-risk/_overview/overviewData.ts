// The five requests of the Overview, each with its own state (a failed one is said where its numbers would be, never read as zero). The keys are the ones the other pages of the module
// use for the same data, so a page the person opens next reads the cache instead of asking again: the dashboard (['tprm-dashboard', scope]: the Performance Overview reads it too), the
// Work queue (['tprm-attention', scope, view]), the planned actions (['tprm-actions-all', state, whose]), the policy (['tprm-policy']).
import { useQuery } from '@tanstack/react-query';
import { tpraApi, vendorActionsApi } from '@/lib/api';
import { TPRM_QUERY_OPTS } from '../_lib/tprmQuery';
import { policyApi, policyKey } from '../_lib/policyApi';
import { bandsFrom } from '../_lib/vendorRules';
import type { QueueAnswer } from '../_lib/attentionModel';
import type { Dashboard, Scope } from '../_lib/overviewModel';
import type { ActionLike } from './workModel';

export interface TrendAnswer {
  appetite: number | null;
  series: Array<{ month: string; inherent: number | null; residual: number | null }>;
}

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
