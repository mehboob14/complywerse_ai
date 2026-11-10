// What the Users and Roles pages read: one query each, shared by the two pages (a role's people count moves when a person's roles change, so a write to either
// refreshes both). Rights: the lists need admin:users:view, a role's detail admin:roles:view, the permission list admin:permissions:view (the server asks; a refusal is
// said where it bites).
import { useQuery } from '@tanstack/react-query';
import apiClient, { adminApi } from '@/lib/api';
import { navAccessFromMe } from '@/components/layout/navAccess';
import { errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import type { UserRecord } from '@/lib/people/usersModel';
import type { CatalogueModule, RoleRecord } from '@/lib/people/rolesModel';

export const USERS_KEY = ['admin-users'];
export const ROLES_KEY = ['admin-roles'];
export const MATRIX_KEY = ['admin-permission-matrix'];
export const POLICY_KEY = ['admin-password-policy'];
export const ME_KEY = ['auth-me'];

export const useUsers = () => useQuery({ queryKey: USERS_KEY, queryFn: async () => (await adminApi.getUsers()).data as unknown as UserRecord[] });
export const useRoles = () => useQuery({ queryKey: ROLES_KEY, queryFn: async () => (await adminApi.getRoles()).data as unknown as RoleRecord[] });
export const useMatrix = (enabled = true) => useQuery({ queryKey: MATRIX_KEY, enabled, staleTime: 10 * 60_000, queryFn: async () => (await adminApi.getPermissionMatrix()).data as unknown as CatalogueModule[] });
export const usePolicy = (enabled = true) => useQuery({ queryKey: POLICY_KEY, enabled, staleTime: 5 * 60_000, queryFn: async () => (await adminApi.getPasswordPolicy()).data });

/** Who is signed in (their own account is never offered Deactivate or Remove) and what this organisation's menu includes (the role preview needs its features). */
export const useMe = () => useQuery({
  queryKey: ME_KEY,
  staleTime: 60_000,
  queryFn: async () => {
    const me = (await apiClient.get('/auth/me')).data;
    return { id: (me?.user?.id ?? null) as number | null, features: navAccessFromMe(me).features };
  },
});

/** What a refusal says on these pages: the server answers 403 with the permission it wanted ("Permission denied: admin:users:edit"), which is not for a screen. Everything else keeps the server's own cleaned words. */
export const NO_RIGHT = "You don't have the right to do this. Ask an administrator.";
export const plainError = (error: unknown, fallback?: string): string => (statusOf(error) === 403 ? NO_RIGHT : errorMessage(error, fallback));
