/**
 * Data layer for the Governance Documents workspace. All endpoint wiring lives here
 * so the view components stay presentational. Wraps the existing governanceApi where
 * a method exists and falls back to the shared axios `apiClient` for endpoints that
 * have no dedicated wrapper (bulk ops, attestation coverage-map).
 *
 * The bulk-assign-owner / bulk-set-review-date / bulk-publish / coverage-map endpoints
 * are additive on the backend; callers must handle a 404 gracefully until the backend
 * is restarted with them.
 */
import apiClient, { governanceApi } from '@/lib/api';
import type { GovDoc, GovDocNode } from './lib';

export interface DocListParams {
  doc_type?: string;
  status?: string;
  owner_id?: number;
  search?: string;
  sort_by?: string;
  sort_order?: 'asc' | 'desc';
  skip?: number;
  limit?: number;
}

export interface DocListResponse {
  items: GovDoc[];
  total: number;
  skip: number;
  limit: number;
}

export async function fetchDocuments(params?: DocListParams): Promise<DocListResponse> {
  const res = await governanceApi.getDocuments(params as Record<string, unknown>);
  const data = res.data as unknown;
  // Backend returns {items,total,skip,limit}; tolerate a bare array too.
  if (Array.isArray(data)) return { items: data as GovDoc[], total: (data as GovDoc[]).length, skip: 0, limit: (data as GovDoc[]).length };
  return data as DocListResponse;
}

export async function fetchHierarchy(): Promise<GovDocNode[]> {
  const res = await governanceApi.getDocumentHierarchy();
  const data = res.data as unknown;
  return (Array.isArray(data) ? data : ((data as { items?: GovDocNode[] })?.items ?? [])) as GovDocNode[];
}

export interface DashboardSummary {
  total_documents: number;
  by_type: Record<string, number>;
  by_status: Record<string, number>;
  by_classification: Record<string, number>;
}
export async function fetchSummary(): Promise<DashboardSummary> {
  const res = await governanceApi.getDashboardSummary();
  return res.data as DashboardSummary;
}

export interface OverdueReviewItem {
  id: number;
  document_code: string | null;
  title: string;
  doc_type: string;
  status: string;
  next_review_date: string | null;
  days_overdue: number;
  owner_id: number | null;
  owner_name: string | null;
  last_reviewed_at: string | null;
}
export async function fetchOverdueReviews(): Promise<{ count: number; documents: OverdueReviewItem[] }> {
  const res = await governanceApi.getDashboardOverdueReviews();
  const d = res.data as { count?: number; documents?: OverdueReviewItem[] };
  return { count: d.count ?? (d.documents?.length ?? 0), documents: d.documents ?? [] };
}

export interface MyPendingItem {
  document_id: number;
  title: string;
  doc_type: string;
  status: string;
  stage_role: 'reviewer' | 'approver' | string;
  stage_label: string;
  updated_at: string | null;
}
export async function fetchMyPending(): Promise<{ total: number; items: MyPendingItem[] }> {
  const res = await governanceApi.getMySignoffPending();
  const d = res.data as { total?: number; items?: MyPendingItem[] };
  return { total: d.total ?? (d.items?.length ?? 0), items: d.items ?? [] };
}

/**
 * Per-document attestation coverage %. Additive endpoint; returns {} on 404 so the
 * ATTEST column / attestation-gaps card degrade to "—" until the backend ships it.
 */
export async function fetchCoverageMap(): Promise<Record<number, number>> {
  try {
    const res = await apiClient.get('/governance/attestations/coverage-map');
    const d = res.data as { coverage?: Record<string, number>; items?: Array<{ document_id: number; compliance_rate: number }> };
    const out: Record<number, number> = {};
    if (d.coverage) {
      for (const [k, v] of Object.entries(d.coverage)) out[Number(k)] = Number(v);
    } else if (Array.isArray(d.items)) {
      for (const it of d.items) out[it.document_id] = it.compliance_rate;
    }
    return out;
  } catch {
    return {};
  }
}

// ─── Mutations ───────────────────────────────────────────────────────────────
export const bulkUpdateStatus = (document_ids: number[], status: string) =>
  apiClient.post('/governance/documents/bulk-update-status', { document_ids, status });

export const bulkArchive = (document_ids: number[]) =>
  apiClient.post('/governance/documents/bulk-archive', { document_ids });

export const bulkAssignOwner = (document_ids: number[], owner_id: number) =>
  apiClient.post('/governance/documents/bulk-assign-owner', { document_ids, owner_id });

export const bulkSetReviewDate = (document_ids: number[], next_review_date: string, review_cycle_months?: number) =>
  apiClient.post('/governance/documents/bulk-set-review-date', { document_ids, next_review_date, review_cycle_months });

export const bulkPublish = (document_ids: number[]) =>
  apiClient.post('/governance/documents/bulk-publish', { document_ids });

export const publishDocument = (id: number) => governanceApi.publishDocument(id);

/** Sign off the current user's review/approval stage (records a signature + advances
 *  the sign-off pipeline) — the correct action for a "pending your approval" item. */
export const signOffDocument = (id: number) => governanceApi.signDocumentOff(id, {});
