'use client';

// What the Vendors register reads: the whole list once (the lean rows, worst risk first; the archived ones when that view is on). The key starts with 'vendors' so everything the module
// refreshes after a change ((['vendors']) after an add, an edit, an archive) refreshes the register too. A failed read is tried once more only when nobody answered: a refusal or a
// server error is said at once.
import { useQuery } from '@tanstack/react-query';
import type { VendorRow } from '../../_lib/vendorRegisterDef';
import { portfolioApi, registerKey } from '../../_lib/portfolioApi';

export const LIMIT = 5000;
export const retryLoad = (failures: number, error: unknown): boolean => failures < 1 && !(error as { response?: { status?: number } })?.response?.status;

export interface VendorPage { items: VendorRow[]; total: number; skip: number; limit: number }

export const vendorsKey = (archived: boolean) => [...registerKey, 'lean', archived ? 'archived' : 'in-use'] as const;

export function useVendorRows(archived: boolean) {
  return useQuery({
    queryKey: vendorsKey(archived),
    queryFn: async () => (await portfolioApi.vendors({ lean: 1, limit: LIMIT, sort: 'risk', ...(archived ? { archived_only: true } : {}) })).data as unknown as VendorPage,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    retry: retryLoad,
  });
}
