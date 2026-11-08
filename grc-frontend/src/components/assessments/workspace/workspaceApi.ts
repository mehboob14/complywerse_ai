/**
 * The calls of the assessment workspace (`backend/grc/routers/compliance_assessments_router.py`, contract: `ux-revamp-reports/G11_assess-backend_plan.md` section 4) and the
 * query keys they are cached under. A lens that wants what the workspace already loaded asks for the same key and costs no request.
 */
import type { QueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { refreshAssessmentLists, scopingApi, type ScopeView } from '@/components/compliance/scoping/scopingApi';
import type { ItemPatch } from './itemModel';
import type { AssessmentDetail, OverviewResult } from './types';

const BASE = '/compliance/assessments';

export const KEYS = {
  detail: (id: number) => ['assessment-workspace', id] as const,
  scope: (id: number) => ['assessment-workspace-scope', id] as const,
  score: (id: number) => ['assessment-workspace-score', id] as const,
  policy: ['assessment-workspace-sla-policy'] as const,
  evidence: (id: number, itemId: number) => ['assessment-workspace-evidence', id, itemId] as const,
  nca: ['assessment-workspace-nca-container'] as const,
};

export interface EvidenceRow {
  /** the link between this control and the file (what is submitted for review); a number for an uploaded file, "ecm-<n>" for evidence the Evidence module matched */
  id: number | string;
  evidence_id: number | null;
  evidence_name: string | null;
  evidence_file_name: string | null;
  evidence_file_type: string | null;
  approval_status: string;
  submitted_at: string | null;
  created_at: string;
  source: 'assessment_upload' | 'framework_link';
  framework_name?: string | null;
  control_code?: string | null;
  quality?: import('@/components/compliance/EvidenceQualityNote').EvidenceQuality | null;
}

export interface NewControl {
  item_number?: string;
  area_domain?: string;
  control_description: string;
  compliance_status?: string;
  priority?: string;
  gaps_identified?: string;
  proposed_solution?: string;
  responsible_party?: string;
}

export interface DetailsPatch { name?: string; assessor?: string; notes?: string; due_date?: string | null; status?: string }

/** What a refresh from a workbook would do (`POST /{id}/reupload?dry_run=1`): nothing is written. */
export interface ReuploadPreview {
  dry_run: true;
  updated_count: number;
  changed_count: number;
  unchanged_count: number;
  added_count: number;
  changed_controls: Array<{ item_number: string; fields: string[] }>;
  added_controls: string[];
  message?: string;
}
export interface ReuploadResult { updated_count?: number; added_count?: number; changed_count?: number; message?: string }

export interface SlaPolicyDays { critical_days: number; high_days: number; medium_days: number; low_days: number; due_soon_days: number }

export const workspaceApi = {
  detail: async (id: number): Promise<AssessmentDetail> => (await apiClient.get(`${BASE}/${id}`, { params: { grouped: 0 } })).data,
  scope: (id: number): Promise<ScopeView> => scopingApi.scope(id),
  score: async (id: number): Promise<OverviewResult> => (await apiClient.get(`${BASE}/overview`, { params: { assessment_id: id } })).data,
  slaPolicy: async (): Promise<SlaPolicyDays> => (await apiClient.get(`${BASE}/sla-policy`)).data,

  updateItem: async (itemId: number, patch: ItemPatch): Promise<unknown> => (await apiClient.put(`${BASE}/items/${itemId}`, patch)).data,
  addItem: async (id: number, body: NewControl): Promise<{ id: number }> => (await apiClient.post(`${BASE}/${id}/items`, body)).data,
  deleteItem: async (itemId: number): Promise<void> => { await apiClient.delete(`${BASE}/items/${itemId}`); },

  updateDetails: async (id: number, body: DetailsPatch): Promise<unknown> => (await apiClient.put(`${BASE}/${id}`, body)).data,
  deleteAssessment: async (id: number): Promise<void> => { await apiClient.delete(`${BASE}/${id}`); },

  evidence: async (id: number, itemId: number): Promise<EvidenceRow[]> => (await apiClient.get(`${BASE}/${id}/items/${itemId}/evidence`)).data?.evidence ?? [],
  uploadEvidence: async (id: number, itemId: number, file: File): Promise<unknown> => {
    const form = new FormData();
    form.append('file', file);
    form.append('name', file.name.replace(/\.[^.]+$/, ''));
    return (await apiClient.post(`${BASE}/${id}/items/${itemId}/evidence/upload`, form, { headers: { 'Content-Type': 'multipart/form-data' } })).data;
  },
  /** hand a draft file to its reviewers: the only way into the approvals queue */
  submitEvidence: async (linkId: number | string, comments = ''): Promise<unknown> => (await apiClient.post(`${BASE}/evidence/${linkId}/approval`, { action: 'submit', comments })).data,

  exportWorkbook: async (id: number): Promise<Blob> => (await apiClient.get(`${BASE}/${id}/export`, { responseType: 'blob' })).data,
  reupload: async <T extends ReuploadPreview | ReuploadResult>(id: number, file: File, dryRun: boolean): Promise<T> => {
    const form = new FormData();
    form.append('file', file);
    return (await apiClient.post(`${BASE}/${id}/reupload`, form, { headers: { 'Content-Type': 'multipart/form-data' }, params: dryRun ? { dry_run: 1 } : undefined })).data;
  },

  /** GET answers `{ exists: false, id: null }` for a tenant that has none and creates nothing (a GET never writes); the POST creates it, and asking twice gives the same row */
  ncaContainer: async (): Promise<{ id: number | null; exists: boolean }> => (await apiClient.get('/compliance/nca/container')).data,
  createNcaContainer: async (): Promise<{ id: number; exists: boolean }> => (await apiClient.post('/compliance/nca/container')).data,
};

/** Something this assessment shows changed (an answer, a file, a new control, its dates): its reads and every list and board that counts it read again. */
export function refreshWorkspaceCaches(qc: QueryClient, id: number): void {
  void qc.invalidateQueries({ queryKey: KEYS.detail(id) });
  void qc.invalidateQueries({ queryKey: KEYS.score(id) });
  void qc.invalidateQueries({ queryKey: ['assessment-workspace-scope', id] });
  for (const key of ['assessments-board-overview', 'redesign-sla-points', 'assessments-my-work']) void qc.invalidateQueries({ queryKey: [key] });
  refreshAssessmentLists(qc);
}
