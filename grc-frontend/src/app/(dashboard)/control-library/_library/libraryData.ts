'use client';

// The Control Library's requests, each under the query key the page has always used (['control-groups', ...], ['normalization-sessions'], ['auto-group-active'], ['cl-build-coverage', run], the lists of
// categories and domains), so a write elsewhere that invalidates one still reaches this page. Every read can fail and every failure is said by the page (never an empty list). The coverage index behind
// "Build your view" is read only when a view is asked for: one /rich request per group, then every figure is computed in the browser (libraryModel.buildCoverage).
import { useQuery } from '@tanstack/react-query';
import apiClient, { frameworksApi } from '@/lib/api';
import { canRetry } from '@/components/ui/ds/reportOutcome';
import { buildCoverage, distinctSorted, type Coverage, type ControlGroup, type GroupsResponse } from './libraryModel';

const retry = (failures: number, e: unknown) => failures < 2 && canRetry(e);
export const GL = '/control-library/groups';
export const GROUP_PAGE = 200;                                          // the library loads whole: a domain must not be split across pages

export interface GroupFilters { search: string; category: string; domain: string; page: number; runId: number | null }

export function useGroups(f: GroupFilters) {
  return useQuery({
    queryKey: ['control-groups', f.search, f.category, f.domain, f.page - 1, GROUP_PAGE, f.runId],
    queryFn: async () => {
      const params: Record<string, string | number> = { skip: (f.page - 1) * GROUP_PAGE, limit: GROUP_PAGE };
      if (f.search) params.search = f.search;
      if (f.category) params.category = f.category;
      if (f.domain) params.domain = f.domain;
      if (f.runId) params.run_id = f.runId;
      return (await apiClient.get(GL, { params })).data as GroupsResponse;
    },
    retry,
  });
}

export interface Session { id: number; label: string; scope: string; is_baseline: boolean; unified_controls: number; framework_ids: number[] | null }
export function useSessions() {
  return useQuery({ queryKey: ['normalization-sessions'], queryFn: async () => (await apiClient.get(`${GL}/sessions`)).data.sessions as Session[], retry });
}

export function useChoices() {
  const categories = useQuery({ queryKey: ['control-group-categories'], queryFn: async () => (await apiClient.get(`${GL}/categories`)).data.categories as string[], retry });
  const domains = useQuery({ queryKey: ['control-group-domains'], queryFn: async () => (await apiClient.get(`${GL}/domains`)).data.domains as string[], retry });
  return { categories: categories.data ?? [], domains: domains.data ?? [] };
}

export function useAvailableFrameworks() {
  return useQuery({
    queryKey: ['available-frameworks-count'],
    queryFn: async () => ((await frameworksApi.getAvailable()).data || []) as Array<{ id: number; name: string }>,
    retry,
  });
}

export interface ActiveJob { active?: boolean; job_id?: string; status?: string; phase?: string; message?: string; progress_percent?: number }
/** A running "build a unified view" job survives closing the sheet and reloading: this finds it again and polls while it runs. */
export function useActiveJob() {
  return useQuery({
    queryKey: ['auto-group-active'],
    queryFn: async () => (await apiClient.get(`${GL}/auto-group/active`)).data as ActiveJob,
    refetchInterval: (q) => (q.state.data?.active ? 2500 : false),
  });
}

/** The framework coverage of every group on the page, built once and kept five minutes; only while a view is being built or is on. */
export function useCoverage(enabled: boolean, groups: readonly ControlGroup[], runId: number | null) {
  return useQuery({
    queryKey: ['cl-build-coverage', runId],
    enabled: enabled && groups.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<Coverage> => {
      const results = await Promise.all(groups.map((g) => apiClient.get(`${GL}/${g.id}/rich`).then((r) => ({ id: g.id, d: r.data })).catch(() => null)));
      return buildCoverage(results);
    },
  });
}

/** The category and domain choices come from the real groups: the server's own lists still hold the values of old runs. */
export const optionsOf = (groups: readonly ControlGroup[], key: 'category' | 'domain'): string[] => distinctSorted(groups.map((g) => g[key]));
