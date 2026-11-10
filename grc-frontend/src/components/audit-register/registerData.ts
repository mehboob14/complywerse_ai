'use client';

// What the register's parts share: the rows (read once, whole), the person's rights, the keys a change refreshes and the save-a-file helper. The query keys are the ones the register always used
// (`audit-register-*`), so every part that invalidates by prefix still reaches what it should.
import { useQuery } from '@tanstack/react-query';
import { auditRegisterApi } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { rightsOf, type RegisterRights } from '@/lib/auditRegister/rights';
import type { RegisterRow } from '@/lib/auditRegister/registerDef';
import type { FindingProfile, RegisterOptions } from './FieldInput';

export const ROWS_KEY = ['audit-register-rows', ''] as const;
export const DELETED_KEY = ['audit-register-rows', 'deleted'] as const;

/** Every key a change to a finding can make stale: the register, its pack, its reports and queues, and the issue the finding is. */
export const REFRESH_ALL: ReadonlyArray<readonly unknown[]> = [
  ['audit-register-rows'], ['audit-register-pack'], ['audit-register-reports'], ['audit-register-all-extensions'], ['audit-register-status'], ['issues'],
];
/** What saving or deciding one finding refreshes besides the lists above. */
export const REFRESH_FINDING = (issueId: number): ReadonlyArray<readonly unknown[]> => [
  ...REFRESH_ALL,
  ['audit-register-profile', issueId], ['audit-register-validation', issueId], ['audit-register-extensions', issueId], ['issue-detail', issueId], ['audit-register-options'],
];

export interface RegisterRows { rows: RegisterRow[]; total: number }

/** The whole register once. `total` is what the server says it holds (X-Total-Count): more than `rows.length` when the list was cut at the server's cap. */
export function useRegisterRows(enabled = true) {
  return useQuery<RegisterRows>({
    queryKey: ROWS_KEY,
    enabled,
    queryFn: async () => {
      const res = await auditRegisterApi.rows();
      const rows = (Array.isArray(res.data) ? res.data : []) as RegisterRow[];
      const said = Number((res.headers as Record<string, string> | undefined)?.['x-total-count']);
      return { rows, total: Number.isFinite(said) && said >= rows.length ? said : rows.length };
    },
  });
}

/** What was deleted, read only when the "Deleted findings" sheet asks for it. */
export function useDeletedRows(enabled: boolean) {
  return useQuery<RegisterRow[]>({
    queryKey: DELETED_KEY,
    enabled,
    queryFn: async () => (await auditRegisterApi.rows(undefined, true)).data as RegisterRow[],
  });
}

/** The four rights, and whether they are known yet (until then no control that needs one is drawn). */
export function useRegisterRights(): { rights: RegisterRights; ready: boolean } {
  const { hasPermission, isLoading } = usePermissions();
  return { rights: rightsOf(hasPermission), ready: !isLoading };
}

/** Hands a blob the server sent to the browser as a file. */
export function saveBlob(data: Blob, name: string): void {
  const url = URL.createObjectURL(data);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The file name a download says it is, else `fallback`. */
export function fileNameOf(headers: unknown, fallback: string): string {
  const disposition = String((headers as Record<string, unknown> | undefined)?.['content-disposition'] ?? '');
  return /filename="([^"]+)"/.exec(disposition)?.[1] || fallback;
}

/** One finding in its own sheet's columns (the profile): shared by the drawer's head and every tab, so it is asked once. A finding that is not in the register is an error, not an empty finding. */
export function useFinding(issueId: number | null) {
  return useQuery<FindingProfile>({
    queryKey: ['audit-register-profile', issueId],
    enabled: issueId != null,
    retry: false,
    queryFn: async () => (await auditRegisterApi.profile(issueId as number)).data as FindingProfile,
  });
}

/** The code lists, the lists Settings keeps and the people a column can name. */
export function useRegisterOptions(enabled = true) {
  return useQuery<RegisterOptions>({
    queryKey: ['audit-register-options'],
    enabled,
    staleTime: 60_000,
    queryFn: async () => (await auditRegisterApi.options()).data as RegisterOptions,
  });
}
