// Client for the smart asset-import wizard (isolated). Reuses the configured
// axios instance so auth + baseURL are inherited. Backend: grc/modules/asset_import.
import apiClient from '@/cyber-assurance/lib/api';

export type MappingSuggestion = { field: string | null; confidence: number; why: string };

export type AnalyzeResult = {
  filename: string;
  header_row: number;
  columns: string[];
  row_count: number;
  sample_rows: Record<string, unknown>[];
  suggested_mapping: Record<string, MappingSuggestion>;
  canonical_fields: { key: string; label: string; required: boolean }[];
  ai_available?: boolean;
};

export type AiMapResult = {
  ai_used: boolean;
  mapping: Record<string, { field: string | null; confidence: 'low' | 'medium' | 'high'; why: string }>;
  error: string | null;
};

export type CommitResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
  total_errors: number;
  row_count: number;
  batch_id: string;
  message: string;
};

export type CommitOptions = { dupe_strategy: 'skip' | 'update'; header_row?: number };

const MULTIPART = { headers: { 'Content-Type': 'multipart/form-data' } };

export type ImportKind = 'asset' | 'vuln';

export type RowIssue = { level: 'warn' | 'error'; field: string; message: string };
export type ValidateRow = {
  row: number;
  identity: string | null;
  action: 'create' | 'update' | 'skip' | 'error';
  linked?: boolean;
  issues: RowIssue[];
};
export type ValidateResult = {
  kind: ImportKind;
  summary: { create: number; update: number; skip: number; error: number; linked?: number; total: number };
  rows: ValidateRow[];
  row_count: number;
  shown: number;
};
export type HistoryItem = { batch_id: string; filename: string; count: number; created_at: string | null };
export type HistoryResult = { kind: ImportKind; items: HistoryItem[] };

export const assetImportApi = {
  analyze: (file: File, kind: ImportKind = 'asset') => {
    const fd = new FormData();
    fd.append('file', file);
    return apiClient.post<AnalyzeResult>('/asset-import/analyze', fd, { ...MULTIPART, params: { kind } });
  },
  commit: (file: File, mapping: Record<string, string | null>, options: CommitOptions, kind: ImportKind = 'asset') => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('mapping', JSON.stringify(mapping));
    fd.append('options', JSON.stringify(options));
    fd.append('kind', kind);
    return apiClient.post<CommitResult>('/asset-import/commit', fd, MULTIPART);
  },
  validate: (file: File, mapping: Record<string, string | null>, options: CommitOptions, kind: ImportKind = 'asset') => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('mapping', JSON.stringify(mapping));
    fd.append('options', JSON.stringify(options));
    fd.append('kind', kind);
    return apiClient.post<ValidateResult>('/asset-import/validate', fd, MULTIPART);
  },
  history: (kind: ImportKind = 'asset') =>
    apiClient.get<HistoryResult>('/asset-import/history', { params: { kind } }),
  aiMap: (kind: ImportKind, columns: string[], samples: Record<string, unknown[]>) =>
    apiClient.post<AiMapResult>('/asset-import/ai-map', { kind, columns, samples }),
  undo: (batchId: string, kind: ImportKind = 'asset') =>
    apiClient.post<{ deleted: number; failed: number; batch_id: string; message: string }>(
      `/asset-import/undo/${batchId}`, null, { params: { kind } },
    ),
};
