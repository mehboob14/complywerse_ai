'use client';

// What the older lenses (the legacy tabs of components/compliance) need besides the three props of the contract, read from what the workspace already loaded.
import { useQuery } from '@tanstack/react-query';
import { assetsApi } from '@/lib/api';
import { KEYS, workspaceApi } from '../workspaceApi';

/** The assessment, from the workspace's own query (the same key: no second request). */
export function useAssessment(id: number) {
  return useQuery({ queryKey: KEYS.detail(id), queryFn: () => workspaceApi.detail(id), staleTime: 15_000 });
}

/** Made per application, function or system: its questions were copied from a template or the library, so a workbook cannot be uploaded over them. */
export function useScoped(id: number): boolean {
  return !!useAssessment(id).data?.scope_model;
}

/** The people of the organization as the NCA and Artifacts tabs want them. */
export function useTenantUsers(): Array<{ id: number; label: string; email: string | null }> {
  const q = useQuery({
    queryKey: ['nca-tenant-users'], staleTime: 60_000,
    queryFn: async () => ((await assetsApi.getTenantUsers()).data as any[]).map((u) => ({ id: u.id as number, label: (u.display_name || u.email || `User ${u.id}`) as string, email: (u.email || null) as string | null })),
  });
  return q.data ?? [];
}
