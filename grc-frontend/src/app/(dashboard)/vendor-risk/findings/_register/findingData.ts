'use client';

// What the Findings register asks for: every finding of the module, once, whole (the server answers up to 1,000 a page; the pages are asked one after the other until the server's own total is
// reached), under ONE query key so a change anywhere (`refreshFindings`) refreshes it. A failure is an error the page says, never an empty register; the answer says when the ceiling was
// reached and not every finding is here (`truncated`), so the page can say how many it holds of how many exist.
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { canRetry } from '@/components/ui/ds/reportOutcome';
import { findingsApi, type RegisterRow } from '../../_lib/findingsApi';
import { findingsKey } from '../../_lib/portfolioApi';

export const REGISTER_KEY = [...findingsKey, 'register'] as const;

const PAGE = 1000;
/** Past this many the register says it holds part of them (the filters and the vendor's own tab reach the rest). */
export const CEILING = 5000;

export interface LoadedRegister { items: RegisterRow[]; total: number; truncated: boolean }

export async function loadRegister(): Promise<LoadedRegister> {
  const items: RegisterRow[] = [];
  let total = 0;
  for (let skip = 0; skip < CEILING; skip += PAGE) {
    const { data } = await findingsApi.register({ scope: 'all', sort: 'severity', order: 'desc', skip, limit: PAGE });
    total = data.total;
    data.items.forEach((row) => items.push(row));
    if (data.items.length === 0 || items.length >= total) break;
  }
  return { items, total, truncated: items.length < total };
}

const retry = (failures: number, e: unknown) => failures < 2 && canRetry(e);

export function useRegister() {
  return useQuery({ queryKey: [...REGISTER_KEY], queryFn: loadRegister, staleTime: 30_000, refetchOnWindowFocus: false, retry });
}

/** The signed-in person's id (null until known, or when it cannot be read): "Mine" is empty rather than everything until then. */
export function useMeId(): number | null {
  const q = useQuery({
    queryKey: ['current-user-id'],
    queryFn: async () => ((await apiClient.get('/auth/me')).data?.user?.id ?? null) as number | null,
    staleTime: 5 * 60 * 1000,
  });
  return q.data ?? null;
}
