// The calls of the Policy page: the vendor policy (backend vendor_risk/tpra/policy.py: one GET, one PUT that also carries the reopen thresholds), and the two reads that stay on the program
// config (tpra/api.py, /tpra/config): the reopen thresholds as they stand, and the roles an approver can hold.

import { apiClient } from '@/lib/api';
import type { Directory } from '../settings/_ui';
import type { PolicyPayload, PolicyView, Tier } from './policyModel';

/** The keys Settings and the alert rules already use for the same two reads, so the three pages share one fetch. */
export const configKey = ['tprm-config'] as const;
export const directoryKey = ['tprm-config-directory'] as const;
export const policyKey = ['tprm-policy'] as const;

/** The part of GET /vendor-risk/tpra/config this page reads. */
export interface ProgramConfig {
  tier_policy?: Partial<Record<string, { reassess_on?: string | null }>>;
  meta?: { severities?: string[] };
}

export const policyApi = {
  get: () => apiClient.get<PolicyPayload>('/vendor-risk/policy'),
  /** Partial: only the settings sent change; a tier named in one replaces that tier's value. `reassess_on` carries the reopen thresholds, saved with the rest in ONE request. Answers with the whole policy. */
  save: (body: Partial<PolicyView> & { reassess_on?: Partial<Record<Tier, Tier>> }) => apiClient.put<PolicyPayload>('/vendor-risk/policy', body),
  config: () => apiClient.get<ProgramConfig>('/vendor-risk/tpra/config'),
  directory: () => apiClient.get<Directory>('/vendor-risk/tpra/config/directory'),
};
