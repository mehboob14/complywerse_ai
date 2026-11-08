'use client';

// How the RCSA pages read and who they treat as the risk team. Every list the registers show is a COMPLETE load (the API pages by skip / limit and sends no total, so a
// page asked for "the first 100" would count 100 where there are 340): fetchAll asks page after page until one comes back short, and the pages count what it returned.
import { useQuery } from '@tanstack/react-query';
import apiClient, { rcsaApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import type { MyWork } from '@/lib/rcsa/worklist';
import { retryUnlessRefused } from '@/lib/rcsa/registerModel';

const PAGE = 200;
const MAX_PAGES = 50;      // 10,000 rows: far past any real register, and a stop for a server that ignores skip

export async function fetchAll<T>(path: string, params: Record<string, unknown> = {}): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data } = await apiClient.get<T[]>(path, { params: { ...params, skip: page * PAGE, limit: PAGE } });
    if (!Array.isArray(data)) throw new Error('The server sent something other than a list.');
    out.push(...data);
    if (data.length < PAGE) break;
  }
  return out;
}

/** The risk team, as the server's own Worklist counts it (an administrator, or a holder of the RCSA edit or create right). Narrower than the server (which lets any signed-in
 *  user create a campaign) and never wider: the buttons that design, launch and delete are offered to these people only. */
export function useRcsaRights(): { manage: boolean; loading: boolean } {
  const { isAdmin, hasPermission, isLoading } = usePermissions();
  return { manage: isAdmin || hasPermission('erm:rcsa:edit') || hasPermission('erm:rcsa:create'), loading: isLoading };
}

export const KEYS = {
  work: ['rcsa', 'my-work'] as const,
  summary: ['rcsa', 'summary'] as const,
  campaigns: ['rcsa', 'campaigns'] as const,
  campaign: (id: number) => ['rcsa', 'campaign', id] as const,
  unit: (id: number) => ['rcsa', 'unit', id] as const,
  findings: ['rcsa', 'findings'] as const,
  templates: ['rcsa', 'templates'] as const,
  template: (id: number) => ['rcsa', 'template', id] as const,
  registers: ['rcsa', 'registers'] as const,
  register: (id: number) => ['rcsa', 'register', id] as const,
  rows: (id: number) => ['rcsa', 'register-rows', id] as const,
};

export function useMyWork() {
  return useQuery({ queryKey: KEYS.work, queryFn: async () => (await rcsaApi.getMyWork(30)).data as MyWork, retry: retryUnlessRefused });
}

export interface Person { id: number; display_name: string; email?: string | null }

/** The people a finding or a unit can be given to (platform accounts only: the server filters out the accounts an access review imported). Needs the RCSA view right: a person
 *  without it gets an error state on the picker, not an empty list. */
export function usePeople(enabled = true) {
  return useQuery({
    queryKey: ['rcsa', 'people'],
    queryFn: async () => (await rcsaApi.customTemplates.listTenantUsers()).data as Person[],
    staleTime: 5 * 60_000,
    enabled,
  });
}

export const peopleOptions = (people: readonly Person[] | undefined) => (people ?? []).map((p) => ({ value: String(p.id), label: p.display_name, description: p.email ?? undefined }));
