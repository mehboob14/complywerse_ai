// The calls the vendor record page, its tabs and its Add / Edit dialog make that no other file already makes: what a name may
// duplicate, the business units, the policy's review cadence, a vendor's subprocessors (backend routers/vendors.py, tpra/graph.py,
// tpra/policy.py). Everything else the record reads has its own file (engagementsApi, portalApi, offboardingApi, paperworkApi).

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import type { Duplicate } from './intakeApi';
import { TPRM_QUERY_OPTS } from './tprmQuery';

export interface Unit { id: number; name: string }

export type FourthPartySource = 'manual' | 'declared' | 'questionnaire';

/** A subprocessor: a supplier one of ours relies on (graph.py). `also_used_by` counts our other vendors on the same platform. */
export interface FourthParty {
  id: number; vendor_id: number; name: string; platform: string | null; service: string | null; data_shared: string[];
  location: string | null; critical: boolean; source: FourthPartySource; also_vendor_id: number | null; notes: string | null;
  also_used_by: number; created_at: string | null;
}

export interface FourthPartyInput {
  name: string; service?: string; location?: string; data_shared?: string[]; critical?: boolean; source?: FourthPartySource; notes?: string;
}

export const vendorRecordApi = {
  /** Read-only: the check POST /vendors makes before it refuses with 409. `exclude_id` leaves out the supplier asking about itself. */
  duplicates: (params: { name: string; website?: string; exclude_id?: number }) =>
    apiClient.get<{ items: Duplicate[] }>('/vendor-risk/vendors/duplicates', { params }),
  units: () => apiClient.get<{ items: Unit[] }>('/vendor-risk/vendors/units'),
  policy: () => apiClient.get<{ cadence_days: Record<string, number> }>('/vendor-risk/policy'),
  fourthParties: (vendorId: number) => apiClient.get<{ items: FourthParty[] }>(`/vendor-risk/tpra/vendors/${vendorId}/fourth-parties`),
  addFourthParty: (vendorId: number, body: FourthPartyInput) =>
    apiClient.post<FourthParty>(`/vendor-risk/tpra/vendors/${vendorId}/fourth-parties`, body),
  removeFourthParty: (id: number) => apiClient.delete(`/vendor-risk/tpra/fourth-parties/${id}`),
};

export const fourthPartiesKey = (vendorId: number) => ['tpra-fourth-parties', vendorId] as const;

/** A value that follows `value` after it has held still for `ms` (the duplicate check waits for the typing to pause). */
export function useDebounced<T>(value: T, ms = 350): T {
  const [held, setHeld] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setHeld(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return held;
}

export const DUPLICATE_MIN = 3;

/** What a name (and website) may already be on record, once the name is long enough to mean something; `exclude` leaves a supplier out. */
export function useDuplicates(name: string, website: string, exclude?: number) {
  const asked = name.trim();
  return useQuery<Duplicate[]>({
    queryKey: ['tprm-vendor-duplicates', asked, website.trim(), exclude ?? null],
    queryFn: async () => (await vendorRecordApi.duplicates({ name: asked, website: website.trim() || undefined, exclude_id: exclude })).data.items,
    enabled: asked.length >= DUPLICATE_MIN,
    staleTime: 30_000,
    retry: false,
  });
}

export function useUnits() {
  return useQuery<Unit[]>({
    queryKey: ['tprm-vendor-units'],
    queryFn: async () => (await vendorRecordApi.units()).data.items,
    staleTime: 5 * 60_000,
  });
}

/** Days between reviews, by tier, as the vendor policy sets them. */
export function usePolicyCadence() {
  return useQuery<Record<string, number>>({
    queryKey: ['tprm-record-policy'],
    queryFn: async () => (await vendorRecordApi.policy()).data.cadence_days,
    ...TPRM_QUERY_OPTS,
  });
}

export function useFourthParties(vendorId: number) {
  return useQuery<FourthParty[]>({
    queryKey: fourthPartiesKey(vendorId),
    queryFn: async () => (await vendorRecordApi.fourthParties(vendorId)).data.items,
    ...TPRM_QUERY_OPTS,
  });
}
