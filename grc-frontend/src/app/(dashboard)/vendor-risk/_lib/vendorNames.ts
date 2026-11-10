'use client';

// The suppliers a picker offers (a supplier report, a new Comply analysis): every supplier in use, by name, in ONE read of the register's lean list (GET /vendor-risk/vendors?lean=1: names without the
// long fields), searched in the picker itself. The old pickers asked for the first 500 and stopped without saying so; this one reads up to 5,000 and says when the server holds more.
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';

export const VENDOR_NAMES_KEY = ['tprm-vendor-names'] as const;
export const VENDOR_NAMES_LIMIT = 5000;

export interface SupplierOption { id: number; name: string }
export interface SupplierList { items: SupplierOption[]; total: number }

export function useSupplierNames(enabled = true) {
  return useQuery<SupplierList>({
    queryKey: VENDOR_NAMES_KEY,
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const d = (await apiClient.get('/vendor-risk/vendors', { params: { lean: 1, limit: VENDOR_NAMES_LIMIT } })).data as { items?: Array<{ id: number; name: string }>; total?: number } | Array<{ id: number; name: string }>;
      const list = (Array.isArray(d) ? d : d?.items ?? []).map((v) => ({ id: v.id, name: v.name })).sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);
      return { items: list, total: Array.isArray(d) ? list.length : Number(d?.total ?? list.length) };
    },
  });
}
