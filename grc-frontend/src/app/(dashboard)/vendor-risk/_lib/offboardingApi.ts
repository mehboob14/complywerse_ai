// Offboarding a supplier, or one of its engagements: the exit checklist (backend vendor_risk/routers/lifecycle.py for the whole
// relationship, vendor_risk/tpra/engagements.py for one engagement). One read tells the supplier's exit and every engagement's.

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import { TPRM_QUERY_OPTS } from './tprmQuery';

export interface ExitItem { item: string; done: boolean; at?: string | null; by?: number | null }

/** One exit as the server tells it. */
export interface ExitStory {
  reason: string | null;
  started_at: string | null;
  started_by: string | null;
  notes: string | null;
}

export interface EngagementExit extends ExitStory {
  id: number;
  name: string;
  /** finished: the engagement has ended and the exit is kept as history */
  ended: boolean;
  items: ExitItem[];
  done: number;
  total: number;
  completed_at: string | null;
}

export interface Offboarding extends ExitStory {
  /** the supplier's own checklist: the standard steps until the exit starts */
  items: ExitItem[];
  /** the whole relationship is being offboarded */
  started: boolean;
  archived_at: string | null;
  /** portal links closed when the exit started */
  links_revoked: number | null;
  /** the exits of single engagements, those under way first */
  engagements: EngagementExit[];
}

export interface ExitUpdate { items?: Array<{ item: string; done: boolean }>; notes?: string }

export const offboardingKey = (vendorId: number) => ['tpra-offboarding', vendorId] as const;

export const offboardingApi = {
  get: (vendorId: number) => apiClient.get<Offboarding>(`/vendor-risk/vendors/${vendorId}/offboarding`),
  /** The whole relationship: portal links stop, unanswered questionnaires expire, requests are cancelled. */
  start: (vendorId: number, reason: string) =>
    apiClient.post<{ links_revoked: number; questionnaires_expired: number[] }>(`/vendor-risk/vendors/${vendorId}/offboarding/start`, { reason: reason || undefined }),
  update: (vendorId: number, body: ExitUpdate) => apiClient.patch<Offboarding>(`/vendor-risk/vendors/${vendorId}/offboarding`, body),
  /** Every step done: the supplier is archived. */
  complete: (vendorId: number) => apiClient.post(`/vendor-risk/vendors/${vendorId}/offboarding/complete`),
  /** One engagement: its own checklist; the supplier stays active and keeps its portal links. */
  startEngagement: (engagementId: number, reason: string) => apiClient.post(`/vendor-risk/engagements/${engagementId}/offboarding/start`, { reason }),
  updateEngagement: (engagementId: number, body: ExitUpdate) => apiClient.patch(`/vendor-risk/engagements/${engagementId}/offboarding`, body),
  /** Every step done: the engagement ends. */
  completeEngagement: (engagementId: number) => apiClient.post(`/vendor-risk/engagements/${engagementId}/offboarding/complete`),
};

/** The exits of a supplier. Pair it with `openExits` (offboardingModel.ts): a page that shows the exit card above its tabs asks
 *  `openExits(data).length > 0`. */
export function useOffboarding(vendorId: number, enabled = true) {
  return useQuery<Offboarding>({
    queryKey: offboardingKey(vendorId),
    queryFn: async () => (await offboardingApi.get(vendorId)).data,
    enabled: enabled && vendorId > 0,
    ...TPRM_QUERY_OPTS,
  });
}
