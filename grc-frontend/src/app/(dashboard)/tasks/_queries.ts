'use client';

// The requests of the Task Management pages, each under a key that starts with the one the page has always used (`critical-tasks`, `critical-task`, `my-tasks`, `task-reports`: an
// invalidation by those names still reaches them). The register's complete load is _register/taskData.ts. The endpoints and the answers are the server's, unchanged. What changed: the record pickers load when a form opens (not for
// every viewer on every visit), and a request that fails is an error the page can say, not an empty list.
import { useQuery } from '@tanstack/react-query';
import { certificationsApi, committeeApi, criticalTasksApi, ermApi, regulatoryApi, risksApi, vulnManagementApi } from '@/lib/api';
import { canRetry } from '@/components/ui/ds/reportOutcome';
import {
  frameworkOptions, pickerOptions, requirementOptions, rowsOf,
  type PickerKind, type PickerOption, type TaskUser,
} from './tasksModel';

/** The default of three tries, except for a request the server has refused (no right, a bad request): trying again cannot change that, so the page says so at once. */
export const retryRead = (failures: number, error: unknown): boolean => failures < 3 && canRetry(error);

/** GET critical-tasks/tenant-users: the people a task can be given to and the Owner filter's choices. */
export function useTenantUsers(enabled = true) {
  return useQuery<TaskUser[]>({
    queryKey: ['critical-task-users'],
    queryFn: async () => ((await criticalTasksApi.getTenantUsers()).data as TaskUser[]) || [],
    staleTime: 5 * 60_000,
    enabled,
    retry: retryRead,
  });
}

const LOADERS: Record<PickerKind, () => Promise<{ data: unknown }>> = {
  risk: () => risksApi.getAll(),
  control: () => ermApi.internalControls.getAll(),
  vulnerability: () => vulnManagementApi.vulnerabilities.getAll(),
  regulatory: () => regulatoryApi.getChanges(),
  committee: () => committeeApi.getCommittees(),
};

/** The records a task can be linked to (risks, internal controls, vulnerabilities, regulatory changes, committees), read when the form that picks one is open. */
export function useRecordOptions(kind: PickerKind, enabled: boolean) {
  return useQuery<PickerOption[]>({
    queryKey: ['task-picker', kind],
    queryFn: async () => pickerOptions(kind, rowsOf((await LOADERS[kind]()).data)),
    enabled,
    staleTime: 5 * 60_000,
    retry: retryRead,
  });
}

export function useFrameworkOptions(enabled: boolean) {
  return useQuery<PickerOption[]>({
    queryKey: ['task-picker', 'framework'],
    queryFn: async () => frameworkOptions(rowsOf((await certificationsApi.getAll()).data)),
    enabled,
    staleTime: 5 * 60_000,
    retry: retryRead,
  });
}

/** The requirements of the chosen framework (read once one is chosen). */
export function useRequirementOptions(frameworkId: string) {
  const id = frameworkId ? Number(frameworkId) : null;
  return useQuery<PickerOption[]>({
    queryKey: ['task-picker', 'requirement', id],
    queryFn: async () => requirementOptions(rowsOf((await certificationsApi.getControls(id as number)).data)),
    enabled: !!id,
    staleTime: 5 * 60_000,
    retry: retryRead,
  });
}
