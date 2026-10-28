// A supplier's engagements: each use of it by one part of the business, tiered,
// assessed and approved on its own (backend vendor_risk/tpra/engagements.py).
// Shared by the Engagements tab, the Lifecycle tab's picker and the page header.

import { useQuery } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { TPRM_QUERY_OPTS } from './tprmQuery';

export interface Engagement {
  /** null: General, before the supplier has any other engagement */
  id: number | null;
  vendor_id: number;
  name: string;
  is_general: boolean;
  description: string | null;
  owner_id: number | null;
  owner_name: string | null;
  business_unit_id: number | null;
  business_unit: string | null;
  engagement_type: string | null;
  data_access_level: string | null;
  data_types_accessed: string[];
  services_provided: string[];
  criticality: string | null;
  start_date: string | null;
  end_date: string | null;
  tier: string | null;
  inherent_risk_score: number | null;
  residual_risk_score: number | null;
  risk_rating: string | null;
  rating_grade: string | null;
  active_assessment_id: number | null;
  lifecycle_stage: string | null;
  reassessment_cadence_days: number | null;
  next_reassessment_date: string | null;
  status: 'active' | 'ended';
  ended_reason: string | null;
  archived_at: string | null;
}

export interface EngagementList {
  items: Engagement[];
  /** The supplier's own columns: the worst of its open engagements once it has any. */
  supplier: {
    tier: string | null; risk_rating: string | null; inherent_risk_score: number | null;
    residual_risk_score: number | null; rating_grade: string | null; engagements: number;
  };
  units: Array<{ id: number; name: string }>;
  types: Array<{ value: string; label: string }>;
  access_levels: string[];
}

/** Only the fields sent are written; null clears one. */
export type EngagementInput = Partial<Pick<Engagement,
  'name' | 'description' | 'owner_id' | 'business_unit_id' | 'engagement_type' | 'data_access_level'
  | 'data_types_accessed' | 'services_provided' | 'criticality' | 'start_date' | 'end_date'
  | 'reassessment_cadence_days' | 'next_reassessment_date'>>;

export const engagementsApi = {
  list: (vendorId: number) => apiClient.get(`/vendor-risk/vendors/${vendorId}/engagements`),
  create: (vendorId: number, data: EngagementInput) => apiClient.post(`/vendor-risk/vendors/${vendorId}/engagements`, data),
  update: (id: number, data: EngagementInput) => apiClient.put(`/vendor-risk/engagements/${id}`, data),
  end: (id: number, reason: string) => apiClient.post(`/vendor-risk/engagements/${id}/end`, { reason }),
};

export const engagementsKey = (vendorId: number) => ['tpra-engagements', vendorId] as const;

export function useEngagements(vendorId: number) {
  return useQuery<EngagementList>({
    queryKey: engagementsKey(vendorId),
    queryFn: async () => (await engagementsApi.list(vendorId)).data,
    ...TPRM_QUERY_OPTS,
  });
}
