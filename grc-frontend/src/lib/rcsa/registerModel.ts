// The register workspace (an uploaded Excel register: "custom RCSA template") apart from React, so `node --test` pins it (registerModel.test.ts).
//
// A register is the person's own spreadsheet: its columns are read once from the file (`column_schema`), each item is a row of values keyed by column, and the server copies a few of them
// out for the list: the risk id, the inherent and residual overall label and score (found by name hints in the column keys). The page shows what an auditor scans (a title, the two levels
// with their score, the owner, the evidence, whether the item is in the Risk Register) and keeps every column in the item's form, grouped as the sheet groups them.
import { norm } from '../status.ts';

export interface ColumnSpec {
  key: string;
  label: string;
  col_index?: number;
  group?: string | null;
  group_key?: string | null;
  data_type: string;
  sample_values?: string[];
}

export interface ColumnGroup { label: string; key: string; columns: ColumnSpec[] }

export interface ColumnSchema {
  title?: string;
  sheet_name?: string;
  groups?: ColumnGroup[];
  flat_columns?: ColumnSpec[];
  warnings?: string[];
}

export interface RegisterRow {
  id: number;
  template_id?: number;
  risk_id_text?: string | null;
  inherent_overall_label?: string | null;
  residual_overall_label?: string | null;
  inherent_overall_score?: number | null;
  residual_overall_score?: number | null;
  data: Record<string, unknown>;
  linked_risk_id?: number | null;
  assigned_user_id?: number | null;
  assigned_user_name?: string | null;
  assigned_user_email?: string | null;
  evidence_count?: number;
  has_ai_explanation?: boolean;
  ai_explanation_at?: string | null;
  updated_at?: string;
}

// ── which columns the table shows ────────────────────────────────────────────────────────────────────────────────────────────────────────

const hasAll = (c: ColumnSpec, hints: readonly string[]): boolean => hints.every((h) => c.key.toLowerCase().includes(h));
const find = (cols: readonly ColumnSpec[], hints: readonly string[]): ColumnSpec | undefined => cols.find((c) => hasAll(c, hints));

export const flatColumns = (schema: ColumnSchema | null | undefined): ColumnSpec[] => {
  if (schema?.flat_columns && schema.flat_columns.length) return schema.flat_columns;
  return (schema?.groups ?? []).reduce<ColumnSpec[]>((all, g) => all.concat(g.columns), []);
};

export interface KeyColumns {
  /** the column that names an item: the risk description, else the process, else the risk id, else the first column */
  title: ColumnSpec | null;
  /** the risk id column, when it is not the title */
  reference: ColumnSpec | null;
  /** the process column, when it is not the title */
  process: ColumnSpec | null;
}

/** The name hints of the old page (risk id / process / risk description), applied the same way; a register with none of them falls back to its first columns. */
export function keyColumns(schema: ColumnSchema | null | undefined): KeyColumns {
  const cols = flatColumns(schema);
  const description = find(cols, ['risk_description']);
  const process = find(cols, ['process']);
  const id = find(cols, ['risk_id']);
  const title = description ?? process ?? id ?? cols[0] ?? null;
  const other = cols.filter((c) => !title || c.key !== title.key);
  const reference = id && id.key !== title?.key ? id : (!description && !process && !id ? (other[0] ?? null) : null);
  const processCol = process && process.key !== title?.key ? process : (!description && !process && !id ? (other.find((c) => c.key !== reference?.key) ?? null) : null);
  return { title, reference, process: processCol };
}

const text = (v: unknown): string => (v == null ? '' : typeof v === 'object' ? '' : String(v).trim());

export const valueOf = (row: RegisterRow, col: ColumnSpec | null): string => (col ? text(row.data?.[col.key]) : '');

/** What names an item in a list: its title column, else the risk id the server copied out, else a sentence; never a number of the database. */
export function titleOf(row: RegisterRow, keys: KeyColumns): string {
  return valueOf(row, keys.title) || text(row.risk_id_text) || 'Untitled item';
}

export function referenceOf(row: RegisterRow, keys: KeyColumns): string {
  return valueOf(row, keys.reference) || (keys.title && keys.title.key.toLowerCase().includes('risk_id') ? '' : text(row.risk_id_text));
}

// ── the drawer's fields ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The columns in the groups the sheet had; a schema with no groups becomes one group, and a column that is in no group is added to the last. */
export function fieldGroups(schema: ColumnSchema | null | undefined): ColumnGroup[] {
  const groups = (schema?.groups ?? []).filter((g) => g.columns.length > 0);
  const flat = flatColumns(schema);
  if (groups.length === 0) return flat.length ? [{ key: 'all', label: 'Details', columns: flat }] : [];
  const inGroups = new Set(groups.reduce<string[]>((all, g) => all.concat(g.columns.map((c) => c.key)), []));
  const missing = flat.filter((c) => !inGroups.has(c.key));
  return missing.length ? groups.slice(0, -1).concat([{ ...groups[groups.length - 1], columns: groups[groups.length - 1].columns.concat(missing) }]) : groups;
}

export type InputKind = 'number' | 'yes_no' | 'long' | 'date' | 'text';

const LONG_WORDS = /\b(description|action|actions|comment|comments|remark|remarks|mitigation|treatment|details?|notes?|rationale|justification|plan|cause|impact statement)\b/i;

/** Which control a column gets: by its data type, then a long text when its label says it holds sentences or its sample values are long. */
export function inputKind(col: Pick<ColumnSpec, 'data_type' | 'label' | 'sample_values'>): InputKind {
  const type = (col.data_type || '').toLowerCase();
  if (type === 'yes_no') return 'yes_no';
  if (type === 'number' || type === 'score') return 'number';
  if (type === 'date') return 'date';
  if (LONG_WORDS.test(col.label || '') || (col.sample_values ?? []).some((v) => String(v).length > 90)) return 'long';
  return 'text';
}

/** The value of an edited field as it is stored: a number field stores a number when it reads as one, and every other field stores the text. A cleared field stores ''. */
export function storedValue(kind: InputKind, entered: string): string | number {
  if (kind === 'number' && entered.trim() !== '' && Number.isFinite(Number(entered))) return Number(entered);
  return entered;
}

export const shownValue = (v: unknown): string => (v == null || typeof v === 'object' ? '' : String(v));

/** The body of the save: the item's data with the edited fields replaced; a field the person did not touch keeps its stored type. */
export function mergedData(original: Record<string, unknown>, edits: Record<string, string>, columns: readonly ColumnSpec[]): Record<string, unknown> {
  const out: Record<string, unknown> = { ...original };
  Object.keys(edits).forEach((key) => {
    const col = columns.find((c) => c.key === key);
    if (shownValue(original[key]) === edits[key]) return;
    out[key] = storedValue(col ? inputKind(col) : 'text', edits[key]);
  });
  return out;
}

export const hasEdits = (original: Record<string, unknown>, edits: Record<string, string>): boolean => Object.keys(edits).some((k) => shownValue(original[k]) !== edits[k]);

// ── levels ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The registry word of a label as the sheet wrote it: "Very High" -> very_high. '' when the item has none. */
export const levelWord = (label: string | null | undefined): string => norm(label);

const RANK: Record<string, number> = { very_low: 1, low: 2, medium: 3, moderate: 3, high: 4, very_high: 5, critical: 5 };

/** What a level sorts by: the score the sheet gave, else the rank of its word; nothing when it has neither (those items sort last). */
export function levelSort(label: string | null | undefined, score: number | null | undefined): number | null {
  if (typeof score === 'number' && Number.isFinite(score)) return score;
  return RANK[levelWord(label)] ?? null;
}

/** The words next to a level pill: "Score 12". Nothing when the sheet gave no score. */
export const scoreText = (score: number | null | undefined): string => (typeof score === 'number' && Number.isFinite(score) ? `Score ${score}` : '');

// ── facets ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const UNASSIGNED_VALUE = 'none';
export const NOT_RATED_VALUE = 'none';

export const ownerValue = (row: RegisterRow): string => (row.assigned_user_id ? String(row.assigned_user_id) : UNASSIGNED_VALUE);
export const levelValue = (label: string | null | undefined): string => levelWord(label) || NOT_RATED_VALUE;
export const evidenceValue = (row: RegisterRow): 'with' | 'without' => ((row.evidence_count ?? 0) > 0 ? 'with' : 'without');
export const linkedValue = (row: RegisterRow): 'yes' | 'no' => (row.linked_risk_id ? 'yes' : 'no');

export interface FacetOption { value: string; label: string }

/** The owners the rows have (a person nobody has is not offered), by name, with "Unassigned" first when some item has no owner. */
export function ownerOptions(rows: readonly RegisterRow[]): FacetOption[] {
  const names: Record<string, string> = {};
  let unassigned = false;
  rows.forEach((r) => { if (r.assigned_user_id) names[String(r.assigned_user_id)] = r.assigned_user_name || r.assigned_user_email || 'Someone'; else unassigned = true; });
  const people = Object.keys(names).map((value) => ({ value, label: names[value] })).sort((a, b) => a.label.localeCompare(b.label));
  return (unassigned ? [{ value: UNASSIGNED_VALUE, label: 'Unassigned' }] : []).concat(people);
}

const LEVEL_ORDER = ['critical', 'very_high', 'high', 'medium', 'moderate', 'low', 'very_low'];

/** The levels the rows have, most serious first, then any word the sheet used that the platform does not know, then "Not rated". */
export function levelOptions(rows: readonly RegisterRow[], pick: (r: RegisterRow) => string | null | undefined, label: (word: string) => string): FacetOption[] {
  const seen: Record<string, boolean> = {};
  rows.forEach((r) => { seen[levelValue(pick(r))] = true; });
  const known = LEVEL_ORDER.filter((w) => seen[w]);
  const other = Object.keys(seen).filter((w) => w !== NOT_RATED_VALUE && LEVEL_ORDER.indexOf(w) < 0).sort();
  return known.concat(other).map((value) => ({ value, label: label(value) })).concat(seen[NOT_RATED_VALUE] ? [{ value: NOT_RATED_VALUE, label: 'Not rated' }] : []);
}

export const EVIDENCE_OPTIONS: FacetOption[] = [{ value: 'with', label: 'With evidence' }, { value: 'without', label: 'No evidence' }];
export const LINKED_OPTIONS: FacetOption[] = [{ value: 'yes', label: 'In the Risk Register' }, { value: 'no', label: 'Not in the register' }];

/** The text the search looks in: every value of the item, its owner and its risk id. */
export function searchTextOf(row: RegisterRow): string {
  const values = Object.keys(row.data || {}).map((k) => text(row.data[k]));
  return [text(row.risk_id_text), text(row.assigned_user_name), text(row.assigned_user_email), text(row.inherent_overall_label), text(row.residual_overall_label)].concat(values).filter(Boolean).join(' ');
}

// ── export ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const CSV_HEADER = ['Reference', 'Item', 'Inherent', 'Inherent score', 'Residual', 'Residual score', 'Owner', 'Evidence files', 'In the Risk Register'];

export function csvRow(row: RegisterRow, keys: KeyColumns): Array<string | number> {
  return [
    referenceOf(row, keys), titleOf(row, keys), text(row.inherent_overall_label), row.inherent_overall_score ?? '', text(row.residual_overall_label), row.residual_overall_score ?? '',
    row.assigned_user_name || 'Unassigned', row.evidence_count ?? 0, row.linked_risk_id ? 'Yes' : 'No',
  ];
}

/** The file the original workbook comes back as, and the one the current items are exported as ("Register.xlsx" -> "Register_export.xlsx"; the old page's rule broke on ".xlsm"). */
export function exportFileName(original: string): string {
  const base = (original || 'register').replace(/\.(xlsx|xlsm)$/i, '');
  return `${base}_export.xlsx`;
}

/** A saved file name from the server's, without a folder or a character a file system refuses. */
export function safeFileName(name: string, fallback: string): string {
  const clean = (name || '').split(/[\\/]/).pop()?.replace(/[:*?"<>|]+/g, '').trim() ?? '';
  return clean || fallback;
}

// ── words ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A request that failed because the person has no right to it (the server answers 403 without saying which right). */
export function isForbidden(error: unknown): boolean {
  return (error as { response?: { status?: number } } | null)?.response?.status === 403;
}

/** React Query's `retry`: a request the server refused (400 to 499: no access, not found) will be refused again, so the error is shown at once; anything else is tried twice more. */
export function retryUnlessRefused(failures: number, error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) return false;
  return failures < 2;
}

export function evidenceText(n: number | null | undefined): string {
  const c = n ?? 0;
  return c === 0 ? 'None' : c === 1 ? '1 file' : `${c} files`;
}

/** "12 KB", "1.4 MB": the size of an evidence file for a person. */
export function sizeText(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
