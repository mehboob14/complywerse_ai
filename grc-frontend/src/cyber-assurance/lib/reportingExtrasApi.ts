/**
 * Reporting extras - API client for the parts of the Report Builder area that had
 * endpoints but no UI, plus scheduled & emailed reports:
 *
 *   savedReportsApi     /reporting/reports            saved report definitions (per user, optionally shared)
 *   trendsApi           /reporting/trends/*           metric history, RAG status, targets, on-demand snapshot
 *   reportSchedulesApi  /report-schedules             scheduled & emailed reports (backend module
 *                                                     grc/modules/report_scheduler)
 *
 * Lives in its own file so the shared api.ts stays untouched. It reuses the shared axios
 * instance (bearer token, X-Tenant-Slug, 401 handling) exactly like workflowEngineApi.ts does.
 * The Report Builder's own dataset catalog / export (`reportingApi`) and the canned
 * `/reports/*` downloads (`reportsApi`) already exist in api.ts and are not repeated here.
 */

import { apiClient } from './api';

// ── Report Builder state (shared by the builder, the Saved tab and the schedule dialog) ──

export type ExportFormat = 'csv' | 'xlsx' | 'pdf' | 'html';
export type MailFormat = 'csv' | 'xlsx' | 'pdf';
export type FilterLogic = 'AND' | 'OR';

export interface SavedFilter {
  col: string;
  op: string;
  value?: string | number | null;
}

/** What the Report Builder holds right now (and what a saved report's `spec` stores). */
export interface BuilderSnapshot {
  dataset: string;
  columns: string[];
  filters: SavedFilter[];
  logic: FilterLogic;
  format: ExportFormat;
}

/** Ask the builder to adopt a definition. `nonce` changes on every request so loading the
 *  same report twice still re-applies it. */
export interface BuilderLoadRequest {
  nonce: number;
  snapshot: BuilderSnapshot;
}

// ── Saved reports  (/reporting/reports) ─────────────────────────────────────────────────

/** The open-JSON `spec` we store. Older/foreign specs may lack keys, so every key is optional. */
export interface SavedReportSpec {
  columns?: string[];
  filters?: SavedFilter[];
  logic?: FilterLogic;
  format?: ExportFormat;
  search?: string;
  [key: string]: unknown;
}

export interface SavedReport {
  slug: string;
  name: string;
  dataset: string;
  spec: SavedReportSpec;
  is_shared: boolean;
  /** true when the caller owns it; false for a report someone shared with the workspace */
  is_mine: boolean;
  updated_at: string | null;
}

export interface SavedReportIn {
  slug: string;
  name: string;
  dataset: string;
  spec: SavedReportSpec;
  is_shared?: boolean;
}

export const savedReportsApi = {
  /** Own reports + anything shared in the workspace, newest first. */
  list: () => apiClient.get<{ reports: SavedReport[] }>('/reporting/reports'),
  get: (slug: string) => apiClient.get<SavedReport>(`/reporting/reports/${encodeURIComponent(slug)}`),
  /** Upsert keyed by (slug, owner): same slug updates your copy, a new slug creates one. */
  save: (body: SavedReportIn) => apiClient.post<SavedReport>('/reporting/reports', body),
  /** Only the owner can delete. */
  remove: (slug: string) => apiClient.delete<{ deleted: string }>(`/reporting/reports/${encodeURIComponent(slug)}`),
};

/** Client-generated identity for a saved report (the API keys on it; max 64 chars). */
export function newReportSlug(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'report';
  const rand = Math.random().toString(36).slice(2, 8);
  return `${base}-${rand}`;
}

// ── Trends  (/reporting/trends/*) ───────────────────────────────────────────────────────

export type TrendUnit = 'pct' | 'score' | 'count' | 'days';
export type TrendGoodDirection = 'up_good' | 'down_good' | 'neutral';
export type TrendStatus = 'ok' | 'warn' | 'critical' | 'none';

export interface TrendPoint {
  date: string; // YYYY-MM-DD
  value: number | null;
}

export interface TrendMetricMeta {
  key: string;
  label: string;
  module: string;
  module_label: string;
  unit: TrendUnit;
  direction: TrendGoodDirection;
  /** breakdown dimension, e.g. 'severity' for open vulnerabilities */
  dimension: string | null;
  definition: string;
  target: number | null;
  warn: number | null;
  critical: number | null;
}

export interface TrendStats {
  current: number | null;
  previous: number | null;
  delta_abs: number | null;
  delta_pct: number | null;
  status: TrendStatus;
  as_of: string | null;
}

/** One card of the Trends board: metric meta + stats + the full series. */
export interface TrendCard extends TrendMetricMeta, TrendStats {
  points: TrendPoint[];
}

export interface TrendOverview {
  days: number;
  cards: TrendCard[];
}

export interface TrendCatalog {
  modules: { key: string; label: string }[];
  metrics: TrendMetricMeta[];
}

export interface TrendSeriesResult extends TrendCard {
  dimension_value: string;
}

export interface TrendBreakdown {
  metric: string;
  dimension: string | null;
  label: string;
  unit: TrendUnit;
  series: { key: string; points: TrendPoint[] }[];
}

export interface TrendTargetIn {
  metric: string;
  dimension?: string;
  dimension_value?: string;
  target?: number | null;
  warn?: number | null;
  critical?: number | null;
}

export const trendsApi = {
  catalog: () => apiClient.get<TrendCatalog>('/reporting/trends/catalog'),
  /** Every metric the caller may see, with stats + series: enough for the whole board. days is clamped 7..730 server-side. */
  overview: (days = 180) => apiClient.get<TrendOverview>('/reporting/trends/overview', { params: { days } }),
  series: (metric: string, days = 180, dimension = 'overall', dimension_value = 'all') =>
    apiClient.get<TrendSeriesResult>('/reporting/trends/series', {
      params: { metric, days, dimension, dimension_value },
    }),
  /** All slices of a dimensional metric as parallel series (e.g. open vulns by severity). */
  breakdown: (metric: string, days = 180) =>
    apiClient.get<TrendBreakdown>('/reporting/trends/breakdown', { params: { metric, days } }),
  setTarget: (body: TrendTargetIn) =>
    apiClient.put<{ ok: boolean; metric: string; target: number | null; warn: number | null; critical: number | null }>(
      '/reporting/trends/targets',
      body,
    ),
  resetTarget: (metric: string, dimension = 'overall', dimension_value = 'all') =>
    apiClient.delete<{ ok: boolean; metric: string }>('/reporting/trends/targets', {
      params: { metric, dimension, dimension_value },
    }),
  /** Capture today's snapshot now (idempotent per day) so history starts without waiting for a sweep. */
  captureSnapshot: () => apiClient.post<{ written: number; as_of: string }>('/reporting/trends/snapshot'),
};

// ── Scheduled & emailed reports  (/report-schedules) ────────────────────────────────────

export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly';

export interface ReportSchedule {
  id: number;
  name: string;
  /** set when the schedule follows a saved report (resolved fresh on every run) */
  saved_report_slug: string | null;
  saved_report_name: string | null;
  /** the saved report was deleted: the next run will fail until the schedule is edited */
  saved_report_missing: boolean;
  dataset: string | null;
  dataset_label: string | null;
  /** inline definition (empty for saved-report schedules) */
  columns: string[];
  filters: SavedFilter[];
  logic: FilterLogic;
  frequency: ScheduleFrequency;
  recipients: string[];
  format: MailFormat;
  message: string | null;
  start_at: string;
  /** null while paused */
  next_run: string | null;
  active: boolean;
  created_by_name: string | null;
  is_mine: boolean;
  created_at: string;
  updated_at: string;
  last_run_at: string | null;
  last_status: 'sent' | 'error' | null;
  last_error: string | null;
}

export interface ReportScheduleList {
  schedules: ReportSchedule[];
  /** whether outbound email is set up for this workspace, and where from (never credentials) */
  email: { configured: boolean; source: 'tenant' | 'env' | 'helpdesk' | null; from_email: string | null };
  frequencies: ScheduleFrequency[];
  formats: MailFormat[];
  max_recipients: number;
}

/** Create/update body. Send EITHER saved_report_slug OR dataset (+ columns/filters/logic). On update only sent keys change. */
export interface ReportScheduleIn {
  name?: string;
  saved_report_slug?: string | null;
  dataset?: string;
  columns?: string[];
  filters?: SavedFilter[];
  logic?: FilterLogic;
  frequency?: ScheduleFrequency;
  recipients?: string[];
  format?: MailFormat;
  message?: string | null;
  /** first run / anchor, ISO-8601 (UTC) */
  start_at?: string;
  active?: boolean;
}

export interface ScheduleRunResult {
  ok: boolean;
  status: 'sent' | 'error';
  message: string;
  filename: string | null;
  size_bytes: number | null;
  rows: number | null;
  recipients: string[];
  refused: Record<string, string>;
  schedule: ReportSchedule;
}

export const reportSchedulesApi = {
  list: () => apiClient.get<ReportScheduleList>('/report-schedules'),
  get: (id: number) => apiClient.get<ReportSchedule>(`/report-schedules/${id}`),
  create: (body: ReportScheduleIn) => apiClient.post<ReportSchedule>('/report-schedules', body),
  update: (id: number, body: ReportScheduleIn) => apiClient.put<ReportSchedule>(`/report-schedules/${id}`, body),
  remove: (id: number) => apiClient.delete<{ id: number; deleted: boolean }>(`/report-schedules/${id}`),
  /** Build the report and email it now. Expected failures come back as a 200 with ok:false + message. */
  runNow: (id: number) => apiClient.post<ScheduleRunResult>(`/report-schedules/${id}/run`),
};

// ── small shared helpers ────────────────────────────────────────────────────────────────

/** Readable message from an axios/FastAPI error (string detail, validation array, or network failure). */
export function apiErrorMessage(e: unknown, fallback = 'Something went wrong - please try again.'): string {
  const resp = (e as { response?: { data?: { detail?: unknown } } } | null)?.response;
  const detail = resp?.data?.detail;
  if (typeof detail === 'string' && detail) return detail;
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map((d) => {
        const item = d as { msg?: string; loc?: unknown[] };
        return item?.msg ? `${(item.loc ?? []).slice(1).join('.') || 'input'}: ${item.msg}` : String(d);
      })
      .join('; ');
  }
  return fallback;
}

/** Save a Blob from an axios `responseType: 'blob'` call as a file download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** A failed blob request carries its JSON error as a Blob; decode `detail` from it. */
export async function blobErrorMessage(e: unknown, fallback = 'Download failed - please try again.'): Promise<string> {
  const data = (e as { response?: { data?: unknown } } | null)?.response?.data;
  if (data instanceof Blob) {
    try {
      const parsed = JSON.parse(await data.text());
      if (typeof parsed?.detail === 'string' && parsed.detail) return parsed.detail;
    } catch {
      /* not JSON - keep the fallback */
    }
  }
  return apiErrorMessage(e, fallback);
}
