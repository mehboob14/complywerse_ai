// A supplier's findings and the decisions on them (backend vendor_risk/tpra/findings.py and api.py): the supplier-wide list, raising
// one, starting its fix, closing, reopening. The older calls (accept, remediations, remove, the assessment's own list) are tpraApi's.

import { useQuery, type QueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';

export type FindingSource = 'assessment' | 'manual' | 'sla_breach' | 'signal' | 'document_review' | 'offboarding';

export interface FindingRow {
  id: number;
  assessment_id: number;
  vendor_id: number;
  domain: string;
  severity: string;
  title: string | null;
  description: string | null;
  /** open | in_remediation | accepted | closed */
  status: string;
  is_critical_control_fail: boolean;
  source_response_id: number | null;
  row_version: number;
  linked_risk_id: number | null;
  linked_issue_id: number | null;
  owner_id: number | null;
  /** holds the approval gate whatever its severity */
  is_blocking: boolean;
  source: FindingSource | string;
  task_id: number | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  // what a list adds (the single-finding payloads of create / update leave these out)
  owner?: { id: number; name: string | null } | null;
  /** the engagement it is about; null: General, the supplier itself */
  engagement?: { id: number; name: string | null } | null;
  /** the earliest date of the fixes under way; and the end of the policy's window for the severity */
  due_date?: string | null;
  sla_due?: string | null;
  /** the day an acceptance runs to, and the acceptance itself */
  accepted_until?: string | null;
  acceptance?: { id: number; rationale: string | null; expiry: string | null; by: string | null; at: string | null } | null;
  task?: { id: number; status: string | null } | null;
  remediation_count?: number;
  /** a completed remediation is on record */
  fix_done?: boolean;
  /** remediate | mitigate | transfer | accept */
  treatment?: string;
}

export interface VendorFindings { items: FindingRow[]; total: number; blocking_total: number }

export interface RaiseInput {
  title: string;
  description?: string;
  severity: string;
  domain: string;
  owner_id?: number | null;
  is_blocking?: boolean;
  /** the engagement it is about; omitted: General */
  engagement_id?: number | null;
}

/** One row of the cross-vendor register (GET /vendor-risk/tpra/findings-register): the finding with its supplier's name and the
 *  fields the register shows. `due_date` is the earliest due date of its remediations, `overdue` that a fix still under way is past it, `sla_due`
 *  the end of the policy's window for the severity. */
export interface RegisterRow {
  id: number; vendor_id: number; vendor_name: string | null; assessment_id: number; domain: string; severity: string;
  title: string | null; status: string; is_critical_control_fail: boolean; due_date: string | null; overdue: boolean;
  created_at: string | null;
  owner: { id: number; name: string | null } | null; is_blocking: boolean; source: FindingSource | string;
  accepted_until: string | null; task_id: number | null; sla_due: string | null;
  engagement: { id: number; name: string | null } | null;
}
export interface Register { items: RegisterRow[]; total: number; blocking_total: number; skip: number; limit: number }
export interface RegisterParams {
  /** open (open + in remediation) | accepted | closed | all */
  scope?: 'open' | 'accepted' | 'closed' | 'all';
  status?: string; severity?: string; domain?: string; vendor_id?: number; overdue_only?: boolean;
  /** created_at (the default) | severity (desc: the worst first) | status | domain | vendor | owner | due (none last) */
  sort?: string; order?: 'asc' | 'desc'; skip?: number; limit?: number;
}

const T = '/vendor-risk/tpra';

export const findingsApi = {
  /** Every finding of the supplier (all engagements and General), the open ones and the worst first. */
  forVendor: (vendorId: number, params?: { scope?: 'open' | 'accepted' | 'closed' | 'all'; engagement_id?: number; include_deleted?: boolean }) =>
    apiClient.get<VendorFindings>(`${T}/vendors/${vendorId}/findings`, { params }),
  register: (params?: RegisterParams) => apiClient.get<Register>(`${T}/findings-register`, { params }),
  raise: (vendorId: number, data: RaiseInput) => apiClient.post<FindingRow>(`${T}/vendors/${vendorId}/findings`, data),
  /** Hand it to someone; null: to no one. The fix under way, and its task, go with it. */
  setOwner: (id: number, ownerId: number | null) => apiClient.put<FindingRow>(`${T}/findings/${id}`, { owner_id: ownerId }),
  /** A remediation due when the policy says for the severity, and its task in Task Management. */
  startRemediation: (id: number, data?: { owner_id?: number | null; due_date?: string }) =>
    apiClient.post<FindingRow>(`${T}/findings/${id}/start-remediation`, data ?? {}),
  close: (id: number, note: string) => apiClient.post<FindingRow>(`${T}/findings/${id}/close`, { note: note || null }),
  reopen: (id: number, reason: string) => apiClient.post<FindingRow>(`${T}/findings/${id}/reopen`, { reason }),
  /** Signals: acknowledging is PUT /signals/{id}; dismissing keeps the signal on the list, marked. */
  dismissSignal: (id: number) => apiClient.post(`${T}/signals/${id}/dismiss`, {}),
};

export const vendorFindingsKey = (vendorId: number, removed = false) => ['tprm-vendor-findings', vendorId, removed] as const;

export function useVendorFindings(vendorId: number, removed = false) {
  return useQuery({
    queryKey: vendorFindingsKey(vendorId, removed),
    queryFn: async () => (await findingsApi.forVendor(vendorId, removed ? { include_deleted: true } : undefined)).data,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });
}

/** After any change to a finding: every list that shows one (the vendor's tab, the lifecycle's stage, the register), the lifecycle's gate, the findings shared with the supplier, and the figures
 *  that count findings (the Overview, the work queue, the vendor list's next steps). The register and the Overview used to keep showing a closed finding for up to 30 seconds. */
export function refreshFindings(qc: QueryClient) {
  ['tprm-vendor-findings', 'tpra-findings', 'tpra-finding', 'tpra-lifecycle', 'tprm-supplier-requests', 'tprm-findings', 'tprm-dashboard', 'tprm-attention', 'vendors'].forEach((k) =>
    qc.invalidateQueries({ queryKey: [k] }));
}
