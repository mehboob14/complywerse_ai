// Server-mode reporting — talks to the backend query engine (POST /reporting/query).
// Used by ReportGrid when a dataset declares `server: true` so filter/sort/paginate
// run in SQL and the browser only holds one page.

import apiClient from '@/lib/api';
import type { ReportView, ServerPage, ServerQuery } from './types';
import { isActiveCondition } from './grid-utils';

/** Flatten a ReportView into the server query contract. Server mode drives
 *  filtering through global search + the advanced AND/OR builder (per-column
 *  quick filters and grouping are client-only conveniences, hidden in server
 *  mode); sorts and pagination map straight through. */
export function buildServerQuery(dataset: string, view: ReportView, search: string, page: number, size: number): ServerQuery {
  const conditions = view.rules.conditions.filter(isActiveCondition);
  return {
    dataset,
    skip: page * size,
    limit: size,
    search: search.trim() || undefined,
    sorts: view.sorts.map((s) => ({ key: s.key, dir: s.dir })),
    filters: conditions.map((c) => ({ col: c.col, op: c.op, value: c.value })),
    logic: view.rules.logic,
  };
}

export async function queryServer(body: ServerQuery): Promise<ServerPage> {
  const { data } = await apiClient.post('/reporting/query', body);
  return data as ServerPage;
}
