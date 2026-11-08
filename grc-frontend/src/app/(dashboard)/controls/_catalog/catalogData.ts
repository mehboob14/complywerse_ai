'use client';

// The Control Catalog's requests, each under the query key the page has always used (['wb-scope'], ['wb-overview'], ['wb-my-work'], ['wb-list', ...], ['wb-groups', domain], ['wb-detail', source, id]),
// so a record opened elsewhere that invalidates one of them still reaches this page. A list is asked a page at a time and answers with the server's TRUE total: the old fixed limits (500 by domain
// group, 600 by framework and for the internal controls) cut a long list without saying so. A failure is an error the page says (with Retry where a retry can help), never an empty list.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { canRetry } from '@/components/ui/ds/reportOutcome';
import type { CatalogList, CatalogOverview, CatalogRow, DomainGroup } from './catalogModel';

export const WB = '/control-library/workbench';
const retry = (failures: number, e: unknown) => failures < 2 && canRetry(e);

export interface CatalogScope {
  framework_ids: number[];
  available: { id: number; name: string; controls: number }[];
  can_edit: boolean;
  history?: { by: string; at: string; added: string[]; removed: string[]; total: number }[];
}

export interface TenantPerson { id: number; display_name: string; email?: string }

/** Every key the page's writes refresh: the hub, the lists, the work view and the groups. */
export type RefreshKeys = ReadonlyArray<readonly unknown[]>;
export const REFRESH_KEYS: RefreshKeys = [['wb-overview'], ['wb-list'], ['wb-my-work'], ['wb-groups']];

export function useScope() {
  return useQuery({ queryKey: ['wb-scope'], queryFn: async () => (await apiClient.get(`${WB}/scope`)).data as CatalogScope, retry });
}

export function useOverview() {
  return useQuery({ queryKey: ['wb-overview'], queryFn: async () => (await apiClient.get(`${WB}/overview`)).data as CatalogOverview, retry });
}

export function useMyWork() {
  return useQuery({ queryKey: ['wb-my-work'], queryFn: async () => (await apiClient.get(`${WB}/my-work`)).data as { total: number; items: CatalogRow[] }, retry });
}

/** One page of controls. `scopeKey` names what the list is (so two lists do not share an answer), `query` is the query string (catalogModel.listQuery / groupQuery / frameworkQuery / internalQuery). */
export function useCatalogList(scopeKey: readonly unknown[], query: string, enabled = true) {
  return useQuery({
    queryKey: ['wb-list', ...scopeKey, query],
    queryFn: async () => (await apiClient.get(`${WB}/controls?${query}`)).data as CatalogList,
    placeholderData: keepPreviousData,
    enabled,
    retry,
  });
}

export function useDomainGroups(domain: string) {
  return useQuery({
    queryKey: ['wb-groups', domain],
    queryFn: async () => (await apiClient.get(`${WB}/overview/${encodeURIComponent(domain)}/groups`)).data as { domain: string; groups: DomainGroup[]; total_controls: number },
    retry,
  });
}

export function useDomainNames() {
  return useQuery({ queryKey: ['wb-domains'], queryFn: async () => (await apiClient.get(`${WB}/domains`)).data as { domains: string[] }, staleTime: 5 * 60_000, retry });
}

export function useTenantPeople() {
  return useQuery({ queryKey: ['wb-users'], queryFn: async () => (await apiClient.get(`${WB}/tenant-users`)).data as TenantPerson[], staleTime: 5 * 60_000, retry });
}
