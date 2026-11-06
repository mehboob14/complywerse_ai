'use client';

/**
 * The two lists the pickers read: the people of the platform and the vendors of the organisation. Both are cached for a few minutes and shared by every
 * field on the page (and with the scoping screens, which read the same people under the same key).
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import type { ListOption } from '@/components/ui/ds';
import { scopingApi } from '../../scoping/scopingApi';

const FIVE_MINUTES = 5 * 60_000;

export function usePeopleOptions() {
  const people = useQuery({ queryKey: ['scoping-people'], queryFn: scopingApi.people, staleTime: FIVE_MINUTES });
  const options = useMemo<ListOption[]>(() => (people.data ?? []).map((p) => ({ value: String(p.id), label: p.display_name, description: p.email })), [people.data]);
  return { people, options };
}

interface VendorRow { id: number; name: string }

// ponytail: the first 500 vendors by name, searched in the list; a register larger than that needs a server-side search here as in the asset picker
async function fetchVendors(): Promise<VendorRow[]> {
  const data = (await apiClient.get('/vendor-risk/vendors', { params: { limit: 500, sort: 'name' } })).data;
  const rows: unknown[] = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  return rows.flatMap((r) => {
    const v = r as { id?: unknown; name?: unknown; vendor_name?: unknown };
    const name = typeof v.name === 'string' ? v.name : typeof v.vendor_name === 'string' ? v.vendor_name : '';
    return typeof v.id === 'number' && name ? [{ id: v.id, name }] : [];
  });
}

export function useVendorOptions() {
  const vendors = useQuery({ queryKey: ['onboarding-vendors'], queryFn: fetchVendors, staleTime: FIVE_MINUTES });
  const options = useMemo<ListOption[]>(() => (vendors.data ?? []).map((v) => ({ value: String(v.id), label: v.name })), [vendors.data]);
  return { vendors, options };
}
