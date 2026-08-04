/**
 * Data layer for the Evidence workspace. Wraps the shared axios `apiClient`.
 * The by-owner endpoint is additive; callers tolerate a 404 until the backend ships it.
 */
import apiClient from '@/lib/api';
import type { EvidenceItem, EvidenceSummary } from './lib';

export interface ItemsParams {
  status?: string;
  evidence_type?: string;
  is_stale?: boolean;
  search?: string;
  skip?: number;
  limit?: number;
}
export interface ItemsResponse { items: EvidenceItem[]; total: number; skip?: number; limit?: number; }

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

// ── per-selected-row detail loaders (used by Workbench preview + Register expand) ──
export async function fetchDetail(id: number): Promise<Record<string, unknown>> {
  return (await apiClient.get(`/evidence-mgmt/items/${id}`)).data as Record<string, unknown>;
}
export async function fetchAssessment(id: number): Promise<Record<string, unknown> | null> {
  try { return (await apiClient.get(`/evidence-mgmt/ai/${id}/latest-assessment`)).data as Record<string, unknown>; }
  catch { return null; }
}
export async function fetchClauseMappings(id: number): Promise<Array<Record<string, unknown>>> {
  try { return (await apiClient.get(`/evidence-mgmt/ai/${id}/clause-mappings`)).data as Array<Record<string, unknown>>; }
  catch { return []; }
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
export const runAssessment = (id: number) => apiClient.post(`/evidence-mgmt/ai/${id}/assess`, null, { params: { force_refresh: true } });
export const submitForReview = (id: number) => apiClient.post(`/evidence-mgmt/lifecycle/${id}/submit`);
export const reviewEvidence = (id: number, action: 'approve' | 'reject', comments?: string) =>
  apiClient.post(`/evidence-mgmt/lifecycle/${id}/review`, { action, comments });

// ── additive analytics (L5) — tolerate 404 until backend ships it ──
export interface OwnerPerf { owner_id: number | null; owner_name: string | null; total: number; pending: number; approved: number; expired: number; }
export async function fetchByOwner(): Promise<OwnerPerf[]> {
  try {
    const data = (await apiClient.get('/evidence-mgmt/items/dashboard/by-owner')).data as { owners?: OwnerPerf[] } | OwnerPerf[];
    return Array.isArray(data) ? data : (data.owners ?? []);
  } catch { return []; }
}
