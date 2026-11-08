/**
 * Data layer for the Evidence details panel (the per-file loaders) and the actions on a file. Wraps the shared axios `apiClient`. The lists (the Library's complete load, the summary,
 * the coverage) are _library/libraryData.ts. A 404 is an answer ("this file has no assessment yet") and reads as nothing; any other failure is thrown, so a page can say
 * it failed and offer Retry: a failed request is never drawn as an empty answer.
 */
import apiClient from '@/lib/api';

const notFound = (error: unknown): boolean => (error as { response?: { status?: number } } | null)?.response?.status === 404;

// ── per-selected-row detail loaders (the Library's details panel) ──
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
