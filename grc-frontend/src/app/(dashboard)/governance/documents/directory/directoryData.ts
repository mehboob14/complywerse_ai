'use client';

// The Directory's data: one query for every unit, read from the Directory API (`GET /admin/departments/directory`: per-unit can_manage and counts) when the backend
// answers it, else from the flat list every backend has (`GET /admin/departments?include_inactive=true`, where can_manage is the person's global
// `admin:organization:edit`). Which of the two answers is found out ONCE per page load (the first read tries the Directory API; a backend without it says 404, 405 or 422 and
// the list is read instead, and the page does not ask again), so the missing endpoint costs one refused request and no console error. Anything else the Directory API
// answers (a 401, a 403, a 500, no network) is the page's error, not a reason to use the list. The rules that build the nodes are directoryModel.ts (tested).
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isAxiosError } from 'axios';
import apiClient, { departmentsApi, type Department } from '@/lib/api';
import { usePermissions } from '@/hooks/usePermissions';
import { refreshDepartments } from '@/lib/departments';
import { ACCESS_KEY } from '@/lib/directoryAccessApi';
import { OVERVIEW_KEY, readOverview } from '@/lib/approvalDefaultsApi';
import { useDepartmentLevels } from '@/components/admin/DepartmentForm';
import { buildTree, fromDirectory, fromList, type Directory, type DirectoryTree } from './directoryModel';
import { withDefaults } from './approvalsModel';

/** The right to add, move and switch off whole departments (the server asks for the same one of every department write today). */
export const GLOBAL_RIGHT = 'admin:organization:edit';
/** The right to write the organisation's default reviewers, approvers and exception implementer (the Organisation popup); the global right above also does. */
export const ORG_DEFAULTS_RIGHT = 'governance:settings:edit';
export const DIRECTORY_KEY = ['directory'] as const;
const DIRECTORY_ENDPOINT = '/admin/departments/directory';

type Answer = { kind: 'directory'; payload: unknown } | { kind: 'list'; rows: Department[] };

let endpoint: 'unknown' | 'present' | 'absent' = 'unknown';     // found out once per page load

/** A backend without the Directory API: the path is no route (404), not allowed (405), or read as a department's id (422, the existing `/{department_id}`). */
const missing = (e: unknown) => isAxiosError(e) && [404, 405, 422].includes(e.response?.status ?? 0);

async function read(): Promise<Answer> {
  if (endpoint !== 'absent') {
    try {
      const { data } = await apiClient.get(DIRECTORY_ENDPOINT);
      if (fromDirectory(data)) { endpoint = 'present'; return { kind: 'directory', payload: data }; }
      endpoint = 'absent';                                      // it answered, but not with a directory
    } catch (e) {
      if (!missing(e)) throw e;
      endpoint = 'absent';
    }
  }
  return { kind: 'list', rows: (await departmentsApi.list(true)).data };
}

export interface DirectoryData {
  loading: boolean;
  error: unknown;
  refetch: () => void;
  fetching: boolean;
  directory: Directory | null;
  tree: DirectoryTree | null;
  /** the person may add and move whole departments (a top-level unit needs it) */
  canTop: boolean;
  /** the person may write the organisation's defaults (the Organisation popup's Approvals and Exceptions) */
  canOrgDefaults: boolean;
  levels: readonly string[];
}

export function useDirectory(): DirectoryData {
  const perms = usePermissions();
  const globalRight = !perms.isLoading && perms.hasPermission(GLOBAL_RIGHT);
  const levelNames = useDepartmentLevels().data?.labels;
  const query = useQuery<Answer>({ queryKey: DIRECTORY_KEY, queryFn: read, staleTime: 30_000, retry: false });
  const answer = query.data;
  // which units define their own default reviewers, approvers, route or implementer: the badges of the Details table. A failed read is no badge (unknown is not "none"), never the page's error.
  const overview = useQuery({ queryKey: OVERVIEW_KEY, queryFn: readOverview, staleTime: 30_000, retry: false });
  const directory = useMemo<Directory | null>(() => {
    if (!answer) return null;
    const base = answer.kind === 'directory' ? fromDirectory(answer.payload) : fromList(answer.rows, globalRight, levelNames);
    return base ? { ...base, nodes: withDefaults(base.nodes, overview.data) } : null;
  }, [answer, globalRight, levelNames, overview.data]);
  // may the person add a department at the top: the Directory API says (can_create_top); the flat list cannot, so it is their global right
  const canTop = directory?.canCreateTop ?? globalRight;
  const tree = useMemo(() => (directory ? buildTree(directory.nodes) : null), [directory]);
  return {
    loading: query.isPending || perms.isLoading,
    error: query.error,
    refetch: () => { void query.refetch(); },
    fetching: query.isFetching,
    directory, tree, canTop,
    canOrgDefaults: !perms.isLoading && (globalRight || perms.hasPermission(ORG_DEFAULTS_RIGHT)),
    levels: directory?.levels ?? levelNames ?? [],
  };
}

/** After any change to a unit: the Directory, the open unit's details, and every list of departments other pages read, are out of date. */
export function useRefreshDirectory(): () => void {
  const qc = useQueryClient();
  return useCallback(() => {
    void qc.invalidateQueries({ queryKey: DIRECTORY_KEY });
    void qc.invalidateQueries({ queryKey: ['admin-department'] });
    void qc.invalidateQueries({ queryKey: ACCESS_KEY });             // the Access tab: who has access and what is given
    refreshDepartments(qc);
  }, [qc]);
}
