'use client';

// What the corrective-action register reads: every action once (each with its issue's code and title; X-Total-Count says how many there are when the list was cut). The key starts with
// 'issues' so a save anywhere in Issue Management refreshes it.
import { useQuery } from '@tanstack/react-query';
import { issuesApi } from '@/lib/api';
import type { ActionRow } from '@/lib/issues/actionDef';

export const ACTIONS_KEY = ['issues', 'actions'] as const;
export const LIMIT = 5000;
export const retryLoad = (failures: number, error: unknown): boolean => failures < 2 && !(error as { response?: { status?: number } })?.response?.status;

export interface ActionPage { items: ActionRow[]; total: number }

export function useActionRows() {
  return useQuery({
    queryKey: ACTIONS_KEY,
    queryFn: async (): Promise<ActionPage> => {
      const res = await issuesApi.actions.listAll({ limit: LIMIT } as never);
      const items = res.data as ActionRow[];
      const said = Number((res.headers as Record<string, string> | undefined)?.['x-total-count']);
      return { items, total: Number.isFinite(said) && said >= items.length ? said : items.length };
    },
    retry: retryLoad,
  });
}
