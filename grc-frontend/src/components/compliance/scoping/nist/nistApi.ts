/**
 * The calls the NIST workbench makes: the assessment with its items (each carries what NIST's method adds, `assessment_data`), a decision on an item, the
 * evidence of an item and an upload that names the artifact it answers, and the two text fields of a finding. The rules are the server's
 * (`modules/assessments/scope_router.py`, `nist.py`).
 */
import apiClient from '@/lib/api';
import type { Determination, EvidenceRow, Implementation, ItemData, NistItem } from './nistModel';

export interface NistDetail {
  id: number;
  name: string;
  assessment_format: string;
  phase: string | null;
  scope_model: string | null;
  total_items: number;
  overall_score: number | null;
  items: NistItem[];
}

/** One decision. 800-53A: an objective and its determination (null clears it) and/or note, or `all`. CSF: the current and/or target level. */
export interface Decision {
  objective?: string;
  determination?: Determination | null;
  all?: Determination;
  note?: string;
  current?: Implementation | null;
  target?: Implementation | null;
}

export interface DecisionResult {
  id: number;
  compliance_status: string;
  assessment_data: ItemData;
  counts: { complied: number; partially_complied: number; not_complied: number; in_progress: number; na: number };
  overall_score: number | null;
}

export type ItemEvidence = EvidenceRow & { quality?: unknown; evidence_uploaded_at?: string | null };

const BASE = '/compliance/assessments';

export const nistApi = {
  detail: async (id: number): Promise<NistDetail> => (await apiClient.get(`${BASE}/${id}`)).data,
  decide: async (itemId: number, body: Decision): Promise<DecisionResult> => (await apiClient.put(`${BASE}/items/${itemId}/determination`, body)).data,
  evidence: async (assessmentId: number, itemId: number): Promise<ItemEvidence[]> => (await apiClient.get(`${BASE}/${assessmentId}/items/${itemId}/evidence`)).data?.evidence ?? [],
  upload: async (assessmentId: number, itemId: number, file: File, artifact?: string): Promise<ItemEvidence> => {
    const form = new FormData();
    form.append('file', file);
    form.append('name', file.name.replace(/\.[^.]+$/, '') || file.name);
    if (artifact) form.append('artifact', artifact);
    return (await apiClient.post(`${BASE}/${assessmentId}/items/${itemId}/evidence/upload`, form, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
  },
  /** The finding of an item: what is wrong and what would put it right (the server's item update reads query parameters only). */
  setFinding: async (itemId: number, params: { gaps_identified?: string; proposed_solution?: string }): Promise<void> => { await apiClient.put(`${BASE}/items/${itemId}`, null, { params }); },
};
