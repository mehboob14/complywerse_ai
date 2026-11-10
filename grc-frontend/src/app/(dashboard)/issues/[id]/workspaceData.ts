'use client';

// What the issue record reads, one hook per part and one key per part. The record's key is the register's drawer key (`['issues','detail',id]`: the same endpoint and shape), the rest start
// with 'issues' too, so a save anywhere in Issue Management refreshes what is on this page. The lists of the other tabs are read only when their tab is opened, and a family of linked records
// is read only when the record's counts say it has some (an issue links to two or three kinds of record, not nine). A refusal or a missing issue is said at once; only "nobody answered"
// is tried again.
import { useQuery } from '@tanstack/react-query';
import { apiClient, auditRegisterApi, issuesApi } from '@/lib/api';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import type { IssueFull } from '../register/_register/issueData';
import type { ActivityRow } from '@/lib/issues/timeline';
import type { IssueActionRow } from './_actions/actionsModel';
import type { FamilyKey, LinkCounts } from './_linked/linkedModel';

const retry = (failures: number, error: unknown): boolean => failures < 2 && canRetry(error);

/** GET /issue-management/issues/{id}: the register's full record, plus what the workspace shows. */
export interface IssueRecord extends IssueFull {
  impact?: string | null;
  urgency?: string | null;
  severity_override?: string | null;
  severity_override_reason?: string | null;
  resolved_at?: string | null;
  approved_at?: string | null;
  approved_by?: { id: number; display_name?: string | null } | null;
  link_counts?: LinkCounts;
}

export interface CommentRow { id: number; body: string; created_at: string; user: { display_name?: string | null } | null }

/** Everything a save on this page can change on other screens: the registers, the record, the corrective actions, the cards on other records, the dashboards. */
export const REFRESH: ReadonlyArray<readonly string[]> = [
  ['issues'], ['issue-links'], ['issue-actions'], ['capa-actions'], ['issues-dashboard'], ['issues-by-source-panel'], ['issues-by-source'], ['issues-by-source-counts'],
];

export const issueKey = (id: number) => ['issues', 'detail', id] as const;

export function useIssue(id: number) {
  return useQuery({
    queryKey: issueKey(id),
    queryFn: async () => (await issuesApi.get(id)).data as IssueRecord,
    enabled: Number.isFinite(id) && id > 0,
    retry,
    staleTime: 15_000,
  });
}

/** The whole timeline, newest first. The server cuts it at `limit`: when it answers exactly that many, the page says there may be earlier ones. */
export const TIMELINE_LIMIT = 200;
export function useIssueActivity(id: number) {
  return useQuery({
    queryKey: ['issues', 'workspace', id, 'activity'],
    queryFn: async () => (await issuesApi.activity.list(id, TIMELINE_LIMIT)).data as ActivityRow[],
    enabled: Number.isFinite(id) && id > 0,
    retry,
  });
}

export function useIssueActions(id: number, enabled: boolean) {
  return useQuery({
    queryKey: ['issues', 'workspace', id, 'actions'],
    queryFn: async () => (await issuesApi.actions.listForIssue(id)).data as IssueActionRow[],
    enabled,
    retry,
  });
}

export function useIssueComments(id: number, enabled: boolean) {
  return useQuery({
    queryKey: ['issues', 'workspace', id, 'comments'],
    queryFn: async () => (await issuesApi.comments.list(id)).data as CommentRow[],
    enabled,
    retry,
  });
}

type Lister = { list: (id: number) => Promise<{ data: unknown }> };
/** One kind of linked record. The key starts with 'issue-links' because the audit register's suggestions refresh that key when they link a control or a risk. */
export function useLinkedRows(id: number, family: FamilyKey, enabled: boolean) {
  return useQuery({
    queryKey: ['issue-links', id, family],
    queryFn: async () => {
      const data = family === 'tasks'
        ? (await apiClient.get(`/issue-management/issues/${id}/links/tasks`)).data
        : (await (issuesApi.links[family] as unknown as Lister).list(id)).data;
      return (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;
    },
    enabled,
    retry,
  });
}

/** Whether the audit register has a profile for this finding (only a tenant that keeps the client's register is asked; the shared key is the panel's own). */
export function useRegisterProfile(id: number, tenantHasRegister: boolean) {
  return useQuery({
    queryKey: ['audit-register-profile', id],
    queryFn: async () => (await auditRegisterApi.profile(id)).data as Record<string, unknown>,
    enabled: tenantHasRegister,
    retry: false,
  });
}

/** What a failed read of the issue says: a refusal is no access, a missing issue is not there, anything else could not be loaded, in the server's words. */
export function failureWords(error: unknown): { title: string; message: string } {
  const code = statusOf(error);
  if (code === 403) return { title: "You don't have access to this issue", message: 'Ask an administrator to give you access to Issue Management.' };
  if (code === 404) return { title: 'This issue is not there', message: 'It may have been removed, or it is not in your organisation.' };
  return { title: "Couldn't load the issue", message: errorMessage(error) };
}
