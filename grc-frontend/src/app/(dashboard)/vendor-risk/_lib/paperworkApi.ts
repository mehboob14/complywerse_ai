// A supplier's paperwork (backend tpra/paperwork.py): documents and their coverage, SOC report
// reviews, contract clauses (tpra/contracts.py) and service levels (routers/monitoring.py).

import apiClient from '@/lib/api';

export type DocState = 'expired' | 'expiring' | 'no_date' | 'in_date';

export interface PaperDoc {
  link_id: number; evidence_id: number; name: string; file_name: string | null;
  requirement: string | null; kind: string | null; evidence_type: string | null; from_supplier: boolean;
  assessment_id: number | null; coverage_from: string | null; coverage_to: string | null;
  expiry_date: string | null; ends_on: string | null; days_left: number | null; state: DocState;
  reviewed_by: number | null; reviewed_by_name: string | null; reviewed_at: string | null;
}

export interface PaperDocs {
  items: PaperDoc[]; counts: Record<DocState, number>; expiring_days: number; today: string;
}

export type Opinion = 'unqualified' | 'qualified' | 'adverse' | 'disclaimer';
export type CuecStatus = 'open' | 'in_place' | 'not_applicable';

export interface Cuec { id?: string; text: string; owner_id: number | null; status: CuecStatus; note: string | null; owner_name?: string | null }
export interface Subservice { name: string; method: 'carve_out' | 'inclusive'; fourth_party_id: number | null }

export interface SocReview {
  id: number; vendor_id: number; evidence_id: number | null;
  evidence: { id: number; name: string; file_name: string | null } | null;
  report_kind: 'soc1' | 'soc2' | 'soc3'; report_type: 'type1' | 'type2';
  period_start: string | null; period_end: string | null; issued_on: string | null; auditor_firm: string | null;
  opinion: Opinion; tsc: string[]; exceptions_count: number; exceptions_summary: string | null;
  material_findings: boolean; bridge_letter: 'received' | 'needed' | 'not_needed' | null; bridge_letter_until: string | null;
  cuecs: Cuec[]; subservice_orgs: Subservice[];
  reviewer_id: number | null; reviewer_name: string | null; reviewed_at: string | null; notes: string | null;
  raised_finding_ids: number[];
  findings: Array<{ id: number; severity: string; status: string; title: string; assessment_id: number }>;
  days_since_period_end: number | null; stale: boolean; needs_bridge_letter: boolean;
  verdict: string; verdict_tone: 'red' | 'amber' | 'green';
}

export type Clauses = {
  right_to_audit?: boolean | null; subprocessor_terms?: boolean | null; exit_data_return?: boolean | null;
  security_addendum?: boolean | null; breach_notification_hours?: number | null;
};

export interface SlaRecord {
  id: number; sla_metric: string; target_value: number | null; actual_value: number | null;
  measurement_period: string | null; is_compliant: boolean; notes: string | null; recorded_at: string | null;
  contract_id: number | null; unit: string | null; direction: 'higher_is_better' | 'lower_is_better' | null;
}

const base = (vendorId: number) => `/vendor-risk/vendors/${vendorId}`;

export const paperworkApi = {
  documents: (vendorId: number) => apiClient.get<PaperDocs>(`${base(vendorId)}/paperwork`),
  reviewDocument: (vendorId: number, linkId: number, data: { coverage_from?: string | null; coverage_to?: string | null }) =>
    apiClient.put<PaperDocs>(`${base(vendorId)}/paperwork/${linkId}`, data),
  socReviews: (vendorId: number) => apiClient.get<{ items: SocReview[]; criteria: string[] }>(`${base(vendorId)}/soc-reviews`),
  createSocReview: (vendorId: number, data: Record<string, unknown>) =>
    apiClient.post<SocReview>(`${base(vendorId)}/soc-reviews`, data),
  updateSocReview: (vendorId: number, reviewId: number, data: Record<string, unknown>) =>
    apiClient.put<SocReview>(`${base(vendorId)}/soc-reviews/${reviewId}`, data),
  archiveSocReview: (vendorId: number, reviewId: number) => apiClient.post(`${base(vendorId)}/soc-reviews/${reviewId}/archive`),
  uploadSocReport: (vendorId: number, reviewId: number, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return apiClient.post<SocReview>(`${base(vendorId)}/soc-reviews/${reviewId}/report`, form,
      { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  addFourthParty: (vendorId: number, reviewId: number, name: string) =>
    apiClient.post<SocReview>(`${base(vendorId)}/soc-reviews/${reviewId}/fourth-parties`, { name }),
  setClauses: (contractId: number, data: Clauses) => apiClient.put(`/vendor-risk/contracts/${contractId}/clauses`, data),
  updateSla: (vendorId: number, recordId: number, data: Record<string, unknown>) =>
    apiClient.put<SlaRecord & { signal_id: number | null }>(`${base(vendorId)}/sla/${recordId}`, data),
};
