'use client';

// The request the All tasks register makes: ONE complete, compact load of every task the person may see (`GET /critical-tasks?lean=1&limit=10000`), under one query key. The old board asked for
// a page of full tasks with the filters in the query and counted the page it had; every count, facet number, board column and export here is over the whole set (the response says when it
// held fewer than there are). A failed load is an error the page says, never an empty list. The key starts with `critical-tasks`, so every invalidation the pages have always made reaches it.
import { useMemo } from 'react';
import { keepPreviousData, useQuery, type QueryClient } from '@tanstack/react-query';
import { criticalTasksApi } from '@/lib/api';
import { retryRead } from '../_queries';
import type { RegisterTask } from '../taskRecord';

export const TASKS_KEY = ['critical-tasks', 'lean'] as const;
/** The most tasks one load holds (the server's ceiling): past it the page says so and the filters narrow what is loaded. */
export const LOAD_LIMIT = 10_000;

export interface LeanTasks {
  items: RegisterTask[];
  /** the true number of tasks the person may see */
  total: number;
  truncated: boolean;
  /** 'mine': the tasks the person takes part in; 'all': an administrator or view_all */
  scope?: 'all' | 'mine';
}

export function useLeanTasks() {
  return useQuery<LeanTasks>({
    queryKey: [...TASKS_KEY],
    queryFn: async () => (await criticalTasksApi.list({ lean: 1, limit: LOAD_LIMIT })).data as LeanTasks,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: retryRead,
  });
}

const NONE: RegisterTask[] = [];
/** The rows of the load, a stable empty list while it has not answered. */
export function useTaskRows() {
  const q = useLeanTasks();
  const rows = useMemo(() => q.data?.items ?? NONE, [q.data]);
  return { ...q, rows };
}

/** Everything a change to a task refreshes: the register, the open task, My Tasks and the reports (a task's own page keys). */
export const TASK_REFRESH: ReadonlyArray<readonly unknown[]> = [['critical-tasks'], ['critical-task'], ['my-tasks'], ['task-reports']];

/** What a single step changes on the row the server answers with: put into the loaded list at once (the register does not fetch ten thousand tasks again for one Start). */
export function patchTask(qc: QueryClient, id: number, patch: Partial<RegisterTask>): void {
  qc.setQueryData<LeanTasks>([...TASKS_KEY], (old) => (old ? { ...old, items: old.items.map((t) => (t.id === id ? { ...t, ...patch } : t)) } : old));
}

/** The fields of a task that a status step or an approval can change (the transition's answer is the whole task: these are the ones the list holds). */
export function stepPatch(answer: Record<string, unknown> | null | undefined): Partial<RegisterTask> {
  if (!answer) return {};
  const keys: Array<keyof RegisterTask> = ['status', 'completed_at', 'approval_status', 'sla_status', 'escalation_level', 'updated_at'];
  const out: Record<string, unknown> = {};
  keys.forEach((k) => { if (k in answer) out[k] = answer[k]; });
  return out as Partial<RegisterTask>;
}
