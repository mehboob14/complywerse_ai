// The requests of the shared "Issues on a record" card, the "Create issue" drawer and the "N open" badge. They go through apiClient here (not lib/api.ts, a file every builder edits) and
// are typed with what routers/by_source.py and routers/auto_create.py answer. No decisions are made here: embedModel.ts decides, these only ask.
import { apiClient } from '@/lib/api';
import { makeCountBatcher } from './countBatch';
import type { BySourcePayload, Counts, MatrixCell } from './embedModel';

const BASE = '/issue-management';

/** The issues of one record; `includeClosed` also asks for the closed rows (the totals are always the server's counts). */
export async function fetchBySource(sourceType: string, sourceId: number, includeClosed = false): Promise<BySourcePayload> {
  return (await apiClient.get<BySourcePayload>(`${BASE}/by-source/${sourceType}/${sourceId}`, { params: { include_closed: includeClosed } })).data;
}

/** The counts of many records of one type in one call. */
export async function fetchSourceCounts(sourceType: string, ids: number[]): Promise<Record<string, Counts>> {
  return (await apiClient.get<{ counts: Record<string, Counts> }>(`${BASE}/by-source/counts`, { params: { type: sourceType, ids: ids.join(',') } })).data.counts;
}

/** One ask for one record's badge; the asks of one render leave as one call. */
export const askCounts = makeCountBatcher(fetchSourceCounts);

/** The tenant's severity matrix (the severity and the hours to resolve for each impact and urgency). */
export async function fetchSeverityMatrix(): Promise<MatrixCell[]> {
  return (await apiClient.get<{ cells: MatrixCell[] }>(`${BASE}/matrices/severity`)).data.cells;
}

export interface Created { id: number; code: string | null; title: string }

/** Raise an issue from a record (`source` given: it is linked, and what was linked in the form is written with it) or on its own. */
export async function createIssue(body: Record<string, unknown>, source?: { source_type: string; source_id: number }): Promise<Created> {
  const res = source
    ? await apiClient.post<Created>(`${BASE}/issues/from-source`, { ...source, ...body })
    : await apiClient.post<Created>(`${BASE}/issues`, body);
  return res.data;
}
