'use client';

// The requests the Evidence pages share, each under ONE query key so the same answer is asked once: the Library's complete load (every file, `?lean=1`, the server's true total), the
// summary the Insights tiles read, the person's own id (for "Mine" and "Waiting for me"), the draft audit packages a file can be added to. A failed request is an error the page says,
// with Retry, never an empty list.
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { canRetry } from '@/components/ui/ds/reportOutcome';
import { listIsBusy, type EvidenceItem, type EvidenceSummary } from '../_workspace/evidenceModel';

export const LIBRARY_KEY = ['ev-ws-items'] as const;
export const SUMMARY_KEY = ['ev-ws-summary'] as const;
export const COVERAGE_KEY = ['ev-ws-coverage'] as const;
export const ME_KEY = ['current-user-id'] as const;
export const DRAFT_PACKAGES_KEY = ['audit-packages', 'draft-picker'] as const;
/** Everything the Library, the Insights and a package's evidence picker show comes from these keys: a change to a file refreshes them all. */
export const LIBRARY_REFRESH: ReadonlyArray<readonly unknown[]> = [LIBRARY_KEY, SUMMARY_KEY, COVERAGE_KEY, ['evidence-items'], ['evidence-summary'], ['audit-packages']];

/** The most files one request returns (the server clamps to the same number and says `truncated` when more match). */
export const LEAN_LIMIT = 5000;

export interface LeanResponse { items: EvidenceItem[]; total: number; skip?: number; limit?: number; truncated?: boolean }

/** A refusal (403, 404) is final, anything else is tried once more after a short wait: a failure is said within a couple of seconds, not after seven of spinner. */
export const retryRead = (failures: number, error: unknown): boolean => canRetry(error) && failures < 1;
export const RETRY_AFTER = 800;

export async function fetchLean(): Promise<LeanResponse> {
  return (await apiClient.get('/evidence-mgmt/items', { params: { lean: 1, limit: LEAN_LIMIT } })).data as LeanResponse;
}

/** Every file. While any is being read or rated the list is asked again every 3 seconds so its status and maturity settle on their own; it stops once nothing is, and a reading that
 *  began more than ten minutes ago is not waited for (the server calls it stalled), so one lost run cannot keep the page asking for ever. */
export function useLibrary() {
  return useQuery({
    queryKey: [...LIBRARY_KEY],
    queryFn: fetchLean,
    retry: retryRead,
    retryDelay: RETRY_AFTER,
    refetchInterval: (query) => (listIsBusy((query.state.data as LeanResponse | undefined)?.items ?? []) ? 3000 : false),
  });
}

export function useSummary() {
  return useQuery({
    queryKey: [...SUMMARY_KEY],
    queryFn: async () => (await apiClient.get('/evidence-mgmt/items/dashboard/summary')).data as EvidenceSummary,
    retry: retryRead,
    retryDelay: RETRY_AFTER,
  });
}

/** The signed-in person's id (null until known, or when it cannot be read: "Mine" is then empty and says so). */
export function useMeId(): number | null {
  const q = useQuery({
    queryKey: [...ME_KEY],
    queryFn: async () => ((await apiClient.get('/auth/me')).data?.user?.id ?? null) as number | null,
    staleTime: 5 * 60 * 1000,
  });
  return q.data ?? null;
}

export interface PackageBrief { id: number; name: string; framework_name: string | null; status: string; evidence_count: number }

/** The draft audit packages, for "Add to audit package" (only a draft takes more evidence). Loaded when the picker opens. */
export function useDraftPackages(enabled: boolean) {
  return useQuery({
    queryKey: [...DRAFT_PACKAGES_KEY],
    queryFn: async () => ((await apiClient.get('/evidence-mgmt/audit-packages', { params: { status: 'draft', limit: 100 } })).data as { items: PackageBrief[] }).items,
    enabled,
    retry: retryRead,
    retryDelay: RETRY_AFTER,
  });
}

export const addToPackage = (packageId: number, evidenceIds: number[]) => apiClient.post(`/evidence-mgmt/audit-packages/${packageId}/evidence`, { evidence_ids: evidenceIds });

/** Renew: the collection date becomes today (a naive UTC time, as the server writes them) and the file is valid for the period it had (the server's own default when none is sent). */
export const renewEvidence = (id: number) =>
  apiClient.post(`/evidence-mgmt/lifecycle/${id}/renew`, { new_collection_date: new Date().toISOString().slice(0, 19) });
