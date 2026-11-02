/**
 * Data layer for the Evidence workspace. Wraps the shared axios `apiClient`.
 * A 404 is an answer ("this file has no assessment yet", "this server has no by-owner route") and reads as nothing; any other failure is thrown, so a page can say
 * it failed and offer Retry: a failed request is never drawn as an empty answer.
 */
import apiClient from '@/lib/api';
import type { EvidenceItem, EvidenceSummary, OwnerPerf } from './evidenceModel';
export type { OwnerPerf };

export interface ItemsParams {
  status?: string;
  evidence_type?: string;
  is_stale?: boolean;
  search?: string;
  skip?: number;
  limit?: number;
}
export interface ItemsResponse { items: EvidenceItem[]; total: number; skip?: number; limit?: number; }

const notFound = (error: unknown): boolean => (error as { response?: { status?: number } } | null)?.response?.status === 404;

export async function fetchSummary(): Promise<EvidenceSummary> {
  return (await apiClient.get('/evidence-mgmt/items/dashboard/summary')).data as EvidenceSummary;
}
export async function fetchItems(params?: ItemsParams): Promise<ItemsResponse> {
  const data = (await apiClient.get('/evidence-mgmt/items', { params })).data as unknown;
  if (Array.isArray(data)) return { items: data as EvidenceItem[], total: (data as EvidenceItem[]).length };
  return data as ItemsResponse;
}
export async function fetchTypes(): Promise<Array<{ value: string; label: string }>> {
  const data = (await apiClient.get('/evidence-mgmt/items/types')).data as { types?: Array<{ value: string; label: string }> };
  return data.types ?? [];
}
export async function fetchExpiringSoon(days = 30): Promise<EvidenceItem[]> {
  const data = (await apiClient.get('/evidence-mgmt/lifecycle/expiring-soon', { params: { days } })).data as unknown;
  if (Array.isArray(data)) return data as EvidenceItem[];
  return ((data as { items?: EvidenceItem[] })?.items) ?? [];
}

// ── per-selected-row detail loaders (used by the Workbench preview and the Register's panel) ──
export async function fetchDetail(id: number): Promise<Record<string, unknown>> {
  return (await apiClient.get(`/evidence-mgmt/items/${id}`)).data as Record<string, unknown>;
}
export async function fetchAssessment(id: number): Promise<Record<string, unknown> | null> {
  try { return (await apiClient.get(`/evidence-mgmt/ai/${id}/latest-assessment`)).data as Record<string, unknown>; }
  catch (e) { if (notFound(e)) return null; throw e; }                    // 404 "No assessments found" is the answer for a file nobody has rated yet
}
export async function fetchClauseMappings(id: number): Promise<Array<Record<string, unknown>>> {
  try { return (await apiClient.get(`/evidence-mgmt/ai/${id}/clause-mappings`)).data as Array<Record<string, unknown>>; }
  catch (e) { if (notFound(e)) return []; throw e; }
}
export async function fetchAllLinks(id: number): Promise<Record<string, unknown>> {
  return (await apiClient.get(`/evidence-mgmt/cross-links/${id}/all-links`)).data as Record<string, unknown>;
}
export async function fetchControls(id: number): Promise<Record<string, unknown>> {
  return (await apiClient.get(`/evidence-mgmt/links/${id}/controls`)).data as Record<string, unknown>;
}
export async function fetchOcr(id: number): Promise<{ ocr_content: string | null; ocr_status: string; ocr_processed_at: string | null }> {
  return (await apiClient.get(`/evidence-mgmt/ocr/${id}/ocr-content`)).data as { ocr_content: string | null; ocr_status: string; ocr_processed_at: string | null };
}

// ── mutations ──
export const processOCR = (id: number) => apiClient.post(`/evidence-mgmt/ocr/${id}/process-ocr`);
// Delete an evidence item. Backend returns { warning, message, control_mappings_count }
// (HTTP 200, not deleted) when the item is linked to controls unless force=true.
export const deleteEvidence = (id: number, force = false) =>
  apiClient.delete(`/evidence-mgmt/items/${id}`, { params: { force } });
// Starts the review in the background (read, rate, match clauses) and answers at once with where it stands.
export const runAssessment = (id: number) => apiClient.post(`/evidence-mgmt/ai/${id}/review`, null, { params: { force: true } });
export const submitForReview = (id: number) => apiClient.post(`/evidence-mgmt/lifecycle/${id}/submit`);
export const reviewEvidence = (id: number, action: 'approve' | 'reject', comments?: string) =>
  apiClient.post(`/evidence-mgmt/lifecycle/${id}/review`, { action, comments });

// ── owner analytics (the Performance view): the route exists on this server; an older one answers 404, which reads as no owners ──
export async function fetchByOwner(): Promise<OwnerPerf[]> {
  try {
    const data = (await apiClient.get('/evidence-mgmt/items/dashboard/by-owner')).data as { owners?: OwnerPerf[] } | OwnerPerf[];
    return Array.isArray(data) ? data : (data.owners ?? []);
  } catch (e) { if (notFound(e)) return []; throw e; }
}
