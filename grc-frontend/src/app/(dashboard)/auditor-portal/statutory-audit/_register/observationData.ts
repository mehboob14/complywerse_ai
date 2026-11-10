'use client';

// The requests Statutory Audit's register, drawer and record share, each under ONE query key so the same answer is asked once and every write refreshes every reader:
//   ['statutory-audit-obs', 'all']   the whole list (pages of 500 until the server's total)        ['statutory-audit-obs', id]   one record with its evidence, links and history
//   ['statutory-audit-meta']         the organisation's status levels, SLA, extra fields and the filter values (the Portal's front door reads the same key)
// A failed request is an error the page says, with Retry: never an empty list or a 0.
import { useQuery } from '@tanstack/react-query';
import apiClient, { statutoryAuditApi } from '@/lib/api';
import { canRetry } from '@/components/ui/ds/reportOutcome';
import { loadAll, type HistoryRow, type ObservationMeta, type ObservationRow } from './observationModel';

export const OBS_ALL = ['statutory-audit-obs', 'all'] as const;
export const META_KEY = ['statutory-audit-meta'] as const;
export const recordKey = (id: number) => ['statutory-audit-obs', id] as const;
/** What a write refreshes: every list and record (the prefix) and the counts. */
export const REFRESH: ReadonlyArray<readonly unknown[]> = [['statutory-audit-obs'], META_KEY];

/** A read is tried twice more when trying again can help (the server is down, the network dropped); a refusal or a missing record is said at once. */
export const retryRead = (failures: number, error: unknown): boolean => failures < 2 && canRetry(error);

/** The record with what hangs off it (GET /observations/{id}). */
export interface Linked { id: number; label: string; href: string | null; sub?: string | null }
export interface RecordEvidence { id: number; evidence_id: number; name: string | null; file_name: string | null; relationship_type: string | null; created_at: string | null }
export interface RecordDetail extends ObservationRow {
  evidence: RecordEvidence[];
  controls: Array<{ id: number; internal_control_id: number; control_id: string | null; name: string | null }>;
  risks: Array<{ id: number; risk_id: number; title: string | null; severity: string | null }>;
  issues: Array<{ id: number; issue_id: number; code: string | null; title: string | null; status: string | null }>;
  documents: Array<{ id: number; document_id: number; title: string | null; doc_type: string | null; status: string | null }>;
  history: HistoryRow[];
  history_total: number;
}

export function useObservations() {
  return useQuery({
    queryKey: OBS_ALL,
    queryFn: () => loadAll(async (skip, limit) => (await statutoryAuditApi.list({ skip, limit })).data as { items: ObservationRow[]; total: number }),
    retry: retryRead,
    retryDelay: 800,
    staleTime: 15_000,
  });
}

export function useObservationMeta() {
  return useQuery({
    queryKey: META_KEY,
    queryFn: async () => (await statutoryAuditApi.meta()).data as ObservationMeta,
    retry: retryRead,
    retryDelay: 800,
    staleTime: 30_000,
  });
}

export function useObservation(id: number) {
  return useQuery({
    queryKey: recordKey(id),
    queryFn: async () => (await statutoryAuditApi.get(id)).data as RecordDetail,
    enabled: id > 0,
    retry: retryRead,
    retryDelay: 800,
  });
}

/** The AI import's one request: the same call as `statutoryAuditApi.uploadParse`, with a way to stop waiting (the file is not saved either way). */
export interface Hints { regulator?: string; period?: string; category?: string }
export interface Draft {
  title: string; description?: string | null; observation_type: string; regulator_source?: string | null; regulation_reference?: string | null; priority: string;
  audit_period?: string | null; due_date?: string | null; area_domain?: string | null; category?: string | null; confidence?: number | null;
  duplicate_of?: { id: number; code: string | null } | null; selected: boolean;
}
export interface ParseAnswer {
  draft_observations: Draft[]; source_file: string; import_batch_id: string; category?: string | null; count: number;
  truncated?: boolean; characters_read?: number; characters_total?: number; page_limit?: number | null;
}

export async function parseDocument(file: File, hints: Hints, signal: AbortSignal): Promise<ParseAnswer> {
  const body = new FormData();
  body.append('file', file);
  if (hints.regulator) body.append('regulator_hint', hints.regulator);
  if (hints.period) body.append('audit_period_hint', hints.period);
  if (hints.category) body.append('category_hint', hints.category);
  // Routed through the Next proxy (next.config beforeFiles) so a long PDF + AI call is not dropped by the ~30 s rewrite; clearing the JSON default lets the browser set the multipart boundary.
  return (await apiClient.post('/auditor-portal/statutory-audit/observations/upload-parse', body, { headers: { 'Content-Type': undefined }, timeout: 900000, signal })).data as ParseAnswer;
}
