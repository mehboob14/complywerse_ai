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
import type { GovDoc } from './lib';

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

/** Per-document attestation coverage: the % and, where the server says them, how many of how many (the ring's "4/5"). */
export interface Coverage {
  pct: Record<number, number>;
  counts: Record<number, { done: number; total: number }>;
}

/**
 * Per-document attestation coverage. Prefers document-attestation campaigns
 * (acks / same-domain active users); falls back to legacy coverage-map.
 */
export async function fetchCoverage(): Promise<Coverage> {
  type Reply = { coverage?: Record<string, number>; counts?: Record<string, { done: number; total: number }>; items?: Array<{ document_id: number; compliance_rate: number }> };
  const parse = (d: Reply): Coverage => {
    const out: Coverage = { pct: {}, counts: {} };
    if (d.coverage) {
      for (const [k, v] of Object.entries(d.coverage)) out.pct[Number(k)] = Number(v);
    } else if (Array.isArray(d.items)) {
      for (const it of d.items) out.pct[it.document_id] = it.compliance_rate;
    }
    for (const [k, v] of Object.entries(d.counts ?? {})) {
      if (v && Number.isFinite(v.done) && Number.isFinite(v.total)) out.counts[Number(k)] = { done: v.done, total: v.total };   // an older server sends none
    }
    return out;
  };
  try {
    const res = await governanceApi.getDocAttestationCoverageMap();
    const out = parse(res.data as Reply);
    if (Object.keys(out.pct).length > 0) return out;
  } catch {
    /* fall through */
  }
  try {
    const res = await apiClient.get('/governance/attestations/coverage-map');
    return parse(res.data as Reply);
  } catch {
    return { pct: {}, counts: {} };
  }
}

/** The % only (what the library showed before the counts). */
export async function fetchCoverageMap(): Promise<Record<number, number>> {
  return (await fetchCoverage()).pct;
}

// ─── Mutations ───────────────────────────────────────────────────────────────
export const bulkArchive = (document_ids: number[]) =>
  apiClient.post('/governance/documents/bulk-archive', { document_ids });

/** An archived document back as a draft (its editors only): it is reviewed, approved and published again before it is in force. */
export const restoreDocument = (id: number) => apiClient.post(`/governance/documents/${id}/restore`);

/** A document into a department (null: none). The server decides who may, refuses an archived document and a department that is
 *  switched off, and records "Department changed from X to Y" in the Change log: the same request the Details dialog sends. */
export const moveDocument = (id: number, department_id: number | null) =>
  apiClient.put(`/governance/documents/${id}`, { department_id });

export const bulkAssignOwner = (document_ids: number[], owner_id: number) =>
  apiClient.post('/governance/documents/bulk-assign-owner', { document_ids, owner_id });

export const bulkSetReviewDate = (document_ids: number[], next_review_date: string, review_cycle_months?: number) =>
  apiClient.post('/governance/documents/bulk-set-review-date', { document_ids, next_review_date, review_cycle_months });

export const bulkPublish = (document_ids: number[]) =>
  apiClient.post('/governance/documents/bulk-publish', { document_ids });

export const publishDocument = (id: number) => governanceApi.publishDocument(id);

/** Sign off the current user's review/approval stage with a drawn electronic signature (records it, seals it and
 *  advances the sign-off pipeline) — the correct action for a "pending your approval" item. */
export const signOffDocument = (id: number, signature_image: string, comment?: string) =>
  governanceApi.signDocumentOff(id, { signature_image, comment: comment || undefined });
