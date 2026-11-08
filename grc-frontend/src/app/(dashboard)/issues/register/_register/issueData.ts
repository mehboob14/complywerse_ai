'use client';

// What the issue register reads: the whole list once (lean rows, newest first; with `linked` only the issues linked to that record), and, for the one issue whose drawer is open, its
// full record and its last events. Keys start with 'issues' so the older forms (which refresh ['issues'] after a save) refresh the register too.
import { useQuery } from '@tanstack/react-query';
import { issuesApi } from '@/lib/api';
import type { IssueRow } from '@/lib/issues/issueDef';
import { linkedValue, type LinkedRecord } from '@/lib/issues/words';

export const LIMIT = 5000;
/** a failed read is tried twice more only when nobody answered (a refusal or a server error is said at once) */
export const retryLoad = (failures: number, error: unknown): boolean => failures < 2 && !(error as { response?: { status?: number } })?.response?.status;

export interface IssuePage { items: IssueRow[]; total: number }

export const issuesKey = (linked: LinkedRecord | null) => ['issues', 'register', linked ? linkedValue(linked) : 'all'] as const;

export function useIssueRows(linked: LinkedRecord | null) {
  return useQuery({
    queryKey: issuesKey(linked),
    queryFn: async () => {
      const params = { lean: 1, limit: LIMIT, sort_by: 'created_at', sort_order: 'desc', ...(linked ? { linked_type: linked.type, linked_id: linked.id } : {}) };
      return (await issuesApi.list(params as never)).data as IssuePage;
    },
    retry: retryLoad,
  });
}

/** The issue itself: the long text a lean row leaves out. */
export interface IssueFull extends IssueRow {
  root_cause?: string | null;
  root_cause_analysis?: string | null;
  closure_notes?: string | null;
}
export function useIssueDetail(id: number | null) {
  return useQuery({
    queryKey: ['issues', 'detail', id],
    queryFn: async () => (await issuesApi.get(id as number)).data as IssueFull,
    enabled: id != null,
    retry: 1,
  });
}

export interface IssueEvent { id: number; type: string; user: { display_name?: string | null }; payload: Record<string, unknown> | null; created_at: string }
export function useIssueEvents(id: number | null) {
  return useQuery({
    queryKey: ['issues', 'events', id],
    queryFn: async () => (await issuesApi.activity.list(id as number, 3)).data as IssueEvent[],
    enabled: id != null,
    retry: 1,
  });
}
