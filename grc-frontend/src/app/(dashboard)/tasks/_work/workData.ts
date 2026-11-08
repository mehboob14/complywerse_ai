'use client';

// The requests My work makes. The person's own tasks come from the lean list with the server's own filters (the register group's B-2): the tasks they are on, the ones they review and the
// ones they made, three small requests answered together, so the cockpit is their tasks, COMPLETE, however many tasks the organization has (the register's one request for every task a
// person may see would make an administrator load every document request just to read their own work). If any of the three fails the whole is an error: a partial set is never drawn as
// the person's work. The key starts with `critical-tasks`, so every invalidation the pages have always made reaches it; `me` is in the key so another person's answer is never shown.
import { keepPreviousData, useQuery, type QueryClient } from '@tanstack/react-query';
import { authedFetch } from '@/lib/auth-fetch';
import { criticalTasksApi } from '@/lib/api';
import { retryRead } from '../_queries';
import { LOAD_LIMIT, type LeanTasks } from '../_register/taskData';
import type { RegisterTask } from '../taskRecord';
import { joinWork } from './taskWork';

export const WORK_KEY = ['critical-tasks', 'work'] as const;

/** The signed-in person. The same query as the document request links use (`auth-me`, one entry in the cache), but it says WHY there is no id: still loading, or it could not be read. */
export function useMe() {
  const q = useQuery({
    queryKey: ['auth-me'],
    queryFn: async () => {
      const r = await authedFetch('/api/auth/me');
      const d = await r.json();
      return (d?.authenticated && d.user) ? d.user : null;
    },
    staleTime: 5 * 60_000,
  });
  const id = q.data?.id != null ? Number(q.data.id) : null;
  return { id, pending: q.isPending, failed: id == null && !q.isPending, refetch: () => { void q.refetch(); } };
}

export interface MyWorkData { rows: RegisterTask[]; /** one of the answers held fewer tasks than there are */ truncated: boolean }

export function useMyWork(me: number | null) {
  return useQuery<MyWorkData>({
    queryKey: [...WORK_KEY, me],
    enabled: me != null,
    queryFn: async () => {
      const ask = async (filter: Record<string, number>) => (await criticalTasksApi.list({ lean: 1, limit: LOAD_LIMIT, ...filter })).data as LeanTasks;
      const answers = await Promise.all([ask({ assignee_id: me as number }), ask({ reviewer_id: me as number }), ask({ created_by_id: me as number })]);
      return { rows: joinWork(answers.map((a) => a.items)), truncated: answers.some((a) => a.truncated) };
    },
    placeholderData: keepPreviousData,                // the rows on screen stay while a newer answer comes
    refetchOnWindowFocus: false,                      // asked again every time the tab is opened (the view is drawn only while it is open)
    retry: retryRead,
  });
}

/** What a step changes on the row, put into every loaded copy of the person's work at once (the list does not load again for one Start). */
export function patchWork(qc: QueryClient, id: number, patch: Partial<RegisterTask>): void {
  qc.setQueriesData<MyWorkData>({ queryKey: [...WORK_KEY] }, (old) => (old ? { ...old, rows: old.rows.map((t) => (t.id === id ? { ...t, ...patch } : t)) } : old));
}
