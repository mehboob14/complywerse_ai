'use client';

// The people a committee screen can pick (a chair, a secretary, a member, the owner of an action): the tenant's users, one request for every form. The same
// request and key the Committees page has always used (assetsApi.getTenantUsers, 'tenant-users-committee'), so a drawer opened later finds them already loaded.
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { assetsApi } from '@/lib/api';

export interface TenantUserOption { id: number; display_name?: string; email?: string }
export interface PersonItem { value: string; label: string; subLabel?: string }

export function useTenantUsers() {
  const query = useQuery({
    queryKey: ['tenant-users-committee'],
    queryFn: async () => ((await assetsApi.getTenantUsers()).data || []) as TenantUserOption[],
  });
  const users = useMemo(() => query.data ?? [], [query.data]);
  const items = useMemo<PersonItem[]>(
    () => users.map((u) => ({ value: String(u.id), label: u.display_name || u.email || `User ${u.id}`, subLabel: u.email })),
    [users],
  );
  const nameOf = (id: number): string => items.find((p) => p.value === String(id))?.label ?? `User ${id}`;
  return { users, items, nameOf, isLoading: query.isLoading, isError: query.isError };
}
